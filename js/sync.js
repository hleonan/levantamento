/* Envio: fila local, reenvio com espera crescente, idempotente pelo ID do levantamento */
(function () {
  var LV = window.LV = window.LV || {};
  var ESPERAS = [30, 60, 120, 300, 900, 1800]; // segundos
  var rodando = false, ouvintes = [];

  LV.onSync = function (fn) { ouvintes.push(fn); };
  function avisa() { ouvintes.forEach(function (f) { try { f(); } catch (e) {} }); }

  function cfg() {
    return Promise.all([LV.db.getMeta('config'), LV.defaultConfig()]).then(function (a) {
      var c = a[0] || {}, d = a[1] || {};
      return { url: (c.url || d.backend_url || '').trim(), token: (c.token || '').trim(), estado_codigo: c.estado_codigo || 'pendente' };
    });
  }
  LV.getConfig = cfg;
  LV.defaultConfig = function () {
    return fetch('config.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  };
  /* grava parte da configuracao guardada (url, token, estado_codigo) sem apagar o resto */
  LV.salvaConfig = function (patch) {
    return LV.db.getMeta('config').then(function (c) {
      c = Object.assign({}, c || {}, patch);
      return LV.db.setMeta('config', c);
    }).then(avisa);
  };

  /* Mensagens em portugues claro para os codigos de erro */
  var MSG = {
    token_invalido: 'Código de acesso recusado. Corrija o código em Configurações; o envio sai sozinho depois.',
    servidor_desatualizado: 'Servidor da CGIS desatualizado. Avise a CGIS.',
    levantamento_nao_encontrado: 'O servidor ainda não tem este levantamento. O aplicativo tenta de novo sozinho.',
    pdf_vazio_ou_grande: 'O PDF não foi aceito pelo servidor (vazio ou grande demais). Avise a CGIS.',
    setup_nao_executado: 'Planilha da CGIS ainda não preparada. Avise a CGIS.',
    servidor_ocupado: 'Servidor ocupado. O aplicativo tenta de novo sozinho.',
    erro_interno: 'Erro no servidor. O aplicativo tenta de novo sozinho.',
    sem_conexao: 'Sem conexão com o servidor.',
    sem_internet: 'Sem internet.',
    sem_config: 'Informe o código de acesso em Configurações.'
  };
  LV.msgErro = function (e) {
    if (!e) return '';
    return MSG[e] || ('Erro no servidor (' + e + '). O aplicativo tenta de novo sozinho.');
  };

  function erro(codigo) { var e = new Error(codigo); e.codigo = codigo; return e; }
  function comTempo(url, opts, ms) {
    if (!ms || typeof AbortController === 'undefined') return fetch(url, opts);
    var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, ms);
    return fetch(url, Object.assign({}, opts, { signal: ac.signal })).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  function post(url, obj) {
    return comTempo(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(obj), redirect: 'follow' }, 0)
      .catch(function () { throw erro('sem_conexao'); })
      .then(function (r) { if (!r.ok) throw erro('erro_interno'); return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw erro('erro_interno'); } if (!j.ok) throw erro(j.erro || 'erro_interno'); return j; });
  }
  function getJson(url, ms) {
    return comTempo(url, { redirect: 'follow' }, ms).catch(function () { throw erro('sem_conexao'); })
      .then(function (r) { if (!r.ok) throw erro('erro_interno'); return r.json().catch(function () { throw erro('erro_interno'); }); });
  }
  function qs(c, p) {
    var s = 'acao=' + encodeURIComponent(p) + '&token=' + encodeURIComponent(c.token);
    return c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + s;
  }

  /* Ping com a configuracao dada (ou a guardada), com limite de 8 s. Leva a versao do aplicativo (app=).
     Se o servidor achar o codigo dentro de um texto maior, devolve token_limpo (formatado) e o c.token passa a ser ele. */
  LV.ping = function (c) {
    return (c ? Promise.resolve(c) : cfg()).then(function (c) {
      if (!c.url) throw erro('sem_config');
      return getJson(qs(c, 'ping') + '&app=' + encodeURIComponent(LV.APP_VERSION), 8000).then(function (j) {
        if (j && j.token_limpo) { j.token_limpo = LV.fmtCodigo(j.token_limpo); c.token = j.token_limpo; }
        if (j && typeof j.token_valido === 'boolean') LV.db.setMeta('ping_dia', hojeChave());
        return j;
      });
    });
  };
  function hojeChave() { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  /* Confere o codigo guardado:
     - pendente: confere (como antes);
     - recusado: so ao abrir o app, quando a internet volta, ao salvar as Configuracoes (forcar = true) e, na fila, no maximo a cada 5 minutos;
     - ok: faz um ping no primeiro uso do dia (acesso do dia, guardado em meta 'ping_dia'); se voltar token_valido false, vira recusado.
     Devolve o estado do codigo. */
  var conferindo = null, ultimaConsulta = 0, ultimaTentativaDia = 0;
  LV.reconfereCodigo = function (forcar) {
    if (conferindo) return conferindo;
    conferindo = cfg().then(function (c) {
      if (!c.url || !c.token || !navigator.onLine) return c.estado_codigo;
      var quer;
      if (c.estado_codigo === 'ok') {
        if (!forcar && Date.now() - ultimaTentativaDia < 300000) return c.estado_codigo;
        quer = LV.db.getMeta('ping_dia').then(function (d) { return d !== hojeChave(); });
      } else if (c.estado_codigo === 'recusado') {
        quer = Promise.resolve(!!forcar || Date.now() - ultimaConsulta >= 300000);
      } else quer = Promise.resolve(true);
      return quer.then(function (vai) {
        if (!vai) return c.estado_codigo;
        ultimaConsulta = Date.now(); if (c.estado_codigo === 'ok') ultimaTentativaDia = Date.now();
        return LV.ping(c).then(function (j) {
          var novo = j.token_valido === true ? 'ok' : (j.token_valido === false ? 'recusado' : c.estado_codigo);
          var antes = j.token_limpo ? LV.salvaConfig({ token: c.token }) : Promise.resolve();
          var dia = j.token_valido === true || j.token_valido === false ? LV.db.setMeta('ping_dia', hojeChave()) : Promise.resolve();
          return Promise.all([antes, dia]).then(function () {
            return novo === c.estado_codigo ? novo : LV.salvaConfig({ estado_codigo: novo }).then(function () { return novo; });
          });
        }).catch(function () { return c.estado_codigo; });
      });
    }).then(function (r) { conferindo = null; return r; }, function () { conferindo = null; });
    return conferindo;
  };

  /* Listas vindas do servidor (empresas): guardadas em meta 'listas' */
  LV.atualizaListas = function () {
    return cfg().then(function (c) {
      if (!c.url || !c.token) throw erro('sem_config');
      return getJson(qs(c, 'listas'), 15000).then(function (j) {
        if (!j.ok) throw erro(j.erro || 'erro_interno');
        var dados = j.listas || {};
        return LV.db.setMeta('listas', { dados: dados, em: new Date().toISOString() }).then(function () { return dados; });
      });
    });
  };

  /* Versao do servidor pelo ping, guardada por 10 minutos */
  var cacheVer = null;
  LV.limpaCacheServidor = function () { cacheVer = null; };
  function versaoServidor(c, forcar) {
    if (!forcar && cacheVer && cacheVer.url === c.url && Date.now() - cacheVer.em < 600000) return Promise.resolve(cacheVer.v);
    return LV.ping(c).then(function (j) {
      if (j.token_valido === false) throw erro('token_invalido');
      var v = j.versao ? parseInt(String(j.versao).split('.')[0], 10) : 1;
      cacheVer = { url: c.url, em: Date.now(), v: v };
      return j.token_limpo ? LV.salvaConfig({ token: c.token }).then(function () { return v; }) : v;
    });
  }

  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob);
    });
  }

  /* so vao entrevistas com resposta (versao antiga segue como esta) */
  function entrevistasEnvio(l) {
    var M = LV.model, E = l.entrevistas || {};
    return Object.keys(E).sort().filter(function (t) { return !M || l.versao_instrumento !== M.spec.version || LV.entrevistaRespondida(M, t.charAt(0), E[t]); })
      .map(function (t) { return { pessoa: t, dados: E[t] }; });
  }

  LV.payloadLev = function (l, fotos) {
    var u = l.unidade || {};
    if (LV.model && l.versao_instrumento === LV.model.spec.version) LV.deriva(l, fotos, LV.model);
    return {
      id: l.id, versao_instrumento: l.versao_instrumento, versao_app: l.versao_app,
      unidade_id: u.id, unidade_nome: u.nome, tipo: (l.dados.c1_03 || u.tipo || ''), municipio: (l.dados.c1_06 || u.municipio || ''), zona: u.zona || '',
      levantado_por: l.levantado_por, perfil: l.perfil, situacao: 'finalizado',
      teste: !!(LV.model && LV.model.spec.teste && LV.model.spec.teste.ativo),
      criado_em: l.criado_em, primeira_finalizacao_em: l.primeira_finalizacao_em || l.finalizado_em, finalizado_em: l.finalizado_em, reaberturas: l.reaberturas || [],
      dados: l.dados, entrevistas: entrevistasEnvio(l),
      fotos: fotos.map(function (f) { return { codigo: f.codigo }; })
    };
  };

  function atual(l) { return !LV.model || l.versao_instrumento === LV.model.spec.version; }

  /* levantamento e fotos (o PDF vem depois, em pdfEnvia) */
  function enviaUm(l, c) {
    return LV.db.fotosDe(l.id).then(function (fotos) {
      return post(c.url, { acao: 'levantamento', token: c.token, levantamento: LV.payloadLev(l, fotos) }).then(function () {
        var seq = Promise.resolve();
        fotos.forEach(function (f) {
          if (f.enviada) return;
          seq = seq.then(function () {
            var info = LV.fotoInfo(f, '');
            return blobB64(f.blob).then(function (b64) {
              return post(c.url, { acao: 'foto', token: c.token, id_levantamento: l.id, unidade_id: (l.unidade || {}).id, codigo: f.codigo, data_visita: l.dados.c1_18 || '', mime: 'image/jpeg', base64: b64,
                origem: info.origem, tirada_em: info.sem ? '' : info.dia.split('/').reverse().join('-') + 'T' + info.hora });
            }).then(function () { f.enviada = true; return LV.db.putFoto(f); });
          });
        });
        return seq;
      });
    });
  }

  /* ---------- PDF do levantamento (com as assinaturas feitas na tela) ---------- */
  var geracoes = {};
  /* Garante o PDF guardado em anexos para a finalizacao atual; gera de novo se faltar ou se for de outra finalizacao. */
  LV.garantePdf = function (l) {
    var aid = l.id + ':pdf', chave = aid + '|' + l.finalizado_em;
    if (geracoes[chave]) return geracoes[chave];
    var p = LV.db.getAnexo(aid).then(function (a) {
      if (a && a.blob && a.finalizado_em === l.finalizado_em) return a;
      return LV.pdfDoLevantamento(l, true).then(function (blob) {
        var novo = { aid: aid, levId: l.id, finalizado_em: l.finalizado_em, blob: blob, criado_em: new Date().toISOString() };
        return LV.db.putAnexo(novo).then(function () { return novo; });
      });
    });
    geracoes[chave] = p;
    var limpa = function () { delete geracoes[chave]; };
    p.then(limpa, limpa);
    return p;
  };
  /* estado do PDF de uma finalizacao: pendente | enviado | erro */
  LV.novoEstadoPdf = function (l) { return { estado: 'pendente', finalizado_em: l.finalizado_em, enviado_em: '', erro: '', tentativas: 0, proxima_tentativa: null }; };
  function pdfPendente(l) {
    return atual(l) && l.situacao !== 'rascunho' && l.pdf && l.pdf.estado !== 'enviado' && l.pdf.finalizado_em === l.finalizado_em;
  }
  function pdfNaVez(l, forcar) {
    return pdfPendente(l) && (forcar || !l.pdf.proxima_tentativa || Date.parse(l.pdf.proxima_tentativa) <= Date.now());
  }
  /* Envia o PDF (acao pdf). Falha aqui nunca mexe no estado do levantamento: so em l.pdf. Devolve o codigo de erro ou ''. */
  function pdfEnvia(l, c) {
    var pdf = l.pdf;
    return LV.garantePdf(l).then(function (a) {
      return blobB64(a.blob).then(function (b64) {
        return post(c.url, { acao: 'pdf', token: c.token, id_levantamento: l.id, unidade_id: (l.unidade || {}).id, data_visita: l.dados.c1_18 || '', base64: b64 });
      });
    }).then(function () {
      pdf.estado = 'enviado'; pdf.enviado_em = new Date().toISOString(); pdf.erro = ''; pdf.tentativas = 0; pdf.proxima_tentativa = null; return '';
    }, function (e) {
      var cod = (e && e.codigo) || 'erro_pdf';
      pdf.estado = 'erro'; pdf.erro = cod; pdf.tentativas = (pdf.tentativas || 0) + 1;
      pdf.proxima_tentativa = new Date(Date.now() + ESPERAS[Math.min(pdf.tentativas - 1, ESPERAS.length - 1)] * 1000).toISOString();
      return cod;
    }).then(function (cod) {
      /* grava so o campo pdf sobre o registro atual (sem pisar em edicao feita no meio do caminho) */
      return LV.db.getLev(l.id).then(function (fresh) {
        if (!fresh || fresh.situacao === 'rascunho' || fresh.finalizado_em !== l.finalizado_em) return;
        fresh.pdf = pdf; return LV.db.putLev(fresh);
      }).then(function () { return cod; });
    });
  }

  /* forcar = true ignora a espera crescente ("Enviar agora") */
  LV.enviarPendentes = function (forcar) {
    if (rodando) return Promise.resolve({ ocupado: true });
    rodando = true;
    var res = { enviados: 0, falhas: 0, erro: '', pdfs: 0 };
    return cfg().then(function (c) {
      if (!c.url || !c.token) { res.erro = 'sem_config'; return res; }
      if (!navigator.onLine) { res.erro = 'sem_internet'; return res; }
      return LV.reconfereCodigo(false).then(function (estado) {
        if (estado === 'recusado' && !forcar) { res.erro = 'token_invalido'; return null; }
        return LV.db.allLev();
      }).then(function (ls) {
        if (!ls) return res;
        ls.forEach(function (l) { /* levantamento finalizado sem estado do PDF (por exemplo, interrompido no meio): cria o estado */
          if (atual(l) && (l.situacao === 'enviado' || l.situacao === 'finalizado' || l.situacao === 'aguardando') && l.finalizado_em && (!l.pdf || l.pdf.finalizado_em !== l.finalizado_em)) {
            l.pdf = LV.novoEstadoPdf(l); if (l.situacao === 'enviado') LV.db.putLev(l);
          }
        });
        var fila = ls.filter(function (l) {
          var dados = l.situacao === 'finalizado' || l.situacao === 'aguardando';
          if (dados) return forcar || !l.proxima_tentativa || Date.parse(l.proxima_tentativa) <= Date.now();
          return l.situacao === 'enviado' && pdfNaVez(l, forcar);
        }).sort(function (a, b) { return (a.finalizado_em || '') < (b.finalizado_em || '') ? -1 : 1; });
        var V = LV.model ? LV.model.spec.version : null, parar = false, srv = null;
        var seq = Promise.resolve();
        fila.forEach(function (l) {
          seq = seq.then(function () {
            if (parar) return;
            var precisaDados = l.situacao === 'finalizado' || l.situacao === 'aguardando';
            var novo = !V || l.versao_instrumento === V;
            var pre = novo ? (srv ? srv : (srv = versaoServidor(c, forcar).then(function (v) { if (v < 3) throw erro('servidor_desatualizado'); }))) : Promise.resolve();
            var etapaDados = !precisaDados ? Promise.resolve(false) : pre.then(function () { return enviaUm(l, c); }).then(function () {
              l.situacao = 'enviado'; l.enviado_em = new Date().toISOString(); l.tentativas = 0; l.ultimo_erro = ''; l.proxima_tentativa = null;
              res.enviados++;
              return (c.estado_codigo !== 'ok' ? (c.estado_codigo = 'ok', LV.salvaConfig({ estado_codigo: 'ok' })) : Promise.resolve()).then(function () { return true; });
            }).catch(function (e) {
              var cod = (e && e.codigo) || String(e && e.message || e);
              l.situacao = 'aguardando'; l.tentativas = (l.tentativas || 0) + 1; l.ultimo_erro = cod;
              l.proxima_tentativa = new Date(Date.now() + ESPERAS[Math.min(l.tentativas - 1, ESPERAS.length - 1)] * 1000).toISOString();
              res.falhas++; res.erro = cod;
              if (cod === 'token_invalido') { parar = true; c.estado_codigo = 'recusado'; return LV.salvaConfig({ estado_codigo: 'recusado' }).then(function () { return false; }); }
              if (cod === 'sem_conexao') parar = true;
              return false;
            });
            return etapaDados.then(function (enviou) {
              var grava = !precisaDados ? Promise.resolve() : LV.db.getLev(l.id).then(function (fresh) {
                if (fresh && (fresh.situacao === 'rascunho' || fresh.finalizado_em !== l.finalizado_em)) return;
                var inteiro = Object.assign({}, l); if (fresh && fresh.pdf) inteiro.pdf = fresh.pdf; /* nao pisa no estado do PDF */
                return LV.db.putLev(inteiro);
              });
              return grava.then(avisa).then(function () {
                if (parar && !enviou && precisaDados) return;
                if (l.situacao !== 'enviado' || !pdfNaVez(l, forcar || enviou)) return;
                return pdfEnvia(l, c).then(function (cod) {
                  if (!cod) res.pdfs++;
                  else if (cod === 'token_invalido') { parar = true; c.estado_codigo = 'recusado'; return LV.salvaConfig({ estado_codigo: 'recusado' }); }
                  else if (cod === 'sem_conexao') parar = true;
                }).then(avisa);
              });
            });
          });
        });
        return seq.then(function () { return res; });
      });
    }).catch(function (e) { res.erro = (e && e.codigo) || String(e && e.message || e); return res; })
      .then(function (r) { rodando = false; avisa(); return r; });
  };

  LV.iniciaFila = function () {
    window.addEventListener('online', function () { LV.reconfereCodigo(true).then(function () { LV.enviarPendentes(false); }); });
    setInterval(function () { if (navigator.onLine) LV.enviarPendentes(false); }, 20000);
    LV.enviarPendentes(false);
  };
})();
