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

  /* Ping com a configuracao dada (ou a guardada), com limite de 8 s */
  LV.ping = function (c) {
    return (c ? Promise.resolve(c) : cfg()).then(function (c) {
      if (!c.url) throw erro('sem_config');
      return getJson(qs(c, 'ping'), 8000);
    });
  };

  /* Confere o codigo guardado quando ainda esta pendente ou recusado: valido -> ok, invalido -> recusado */
  var conferindo = null;
  LV.reconfereCodigo = function () {
    if (conferindo) return conferindo;
    conferindo = cfg().then(function (c) {
      if (c.estado_codigo === 'ok' || !c.url || !c.token || !navigator.onLine) return c.estado_codigo;
      return LV.ping(c).then(function (j) {
        var novo = j.token_valido === true ? 'ok' : (j.token_valido === false ? 'recusado' : c.estado_codigo);
        return novo === c.estado_codigo ? novo : LV.salvaConfig({ estado_codigo: novo }).then(function () { return novo; });
      }).catch(function () { return c.estado_codigo; });
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
      return v;
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
      criado_em: l.criado_em, finalizado_em: l.finalizado_em, reaberturas: l.reaberturas || [],
      dados: l.dados, entrevistas: entrevistasEnvio(l),
      fotos: fotos.map(function (f) { return { codigo: f.codigo }; })
    };
  };

  function enviaUm(l, c) {
    return LV.db.fotosDe(l.id).then(function (fotos) {
      return post(c.url, { acao: 'levantamento', token: c.token, levantamento: LV.payloadLev(l, fotos) }).then(function () {
        var seq = Promise.resolve();
        fotos.forEach(function (f) {
          if (f.enviada) return;
          seq = seq.then(function () {
            return blobB64(f.blob).then(function (b64) {
              return post(c.url, { acao: 'foto', token: c.token, id_levantamento: l.id, unidade_id: (l.unidade || {}).id, codigo: f.codigo, data_visita: l.dados.c1_18 || '', mime: 'image/jpeg', base64: b64 });
            }).then(function () { f.enviada = true; return LV.db.putFoto(f); });
          });
        });
        return seq;
      });
    });
  }

  /* forcar = true ignora a espera crescente ("Enviar agora") */
  LV.enviarPendentes = function (forcar) {
    if (rodando) return Promise.resolve({ ocupado: true });
    rodando = true;
    var res = { enviados: 0, falhas: 0, erro: '' };
    return cfg().then(function (c) {
      if (!c.url || !c.token) { res.erro = 'sem_config'; return res; }
      if (!navigator.onLine) { res.erro = 'sem_internet'; return res; }
      return LV.reconfereCodigo().then(function () { return LV.db.allLev(); }).then(function (ls) {
        var fila = ls.filter(function (l) { return l.situacao === 'finalizado' || l.situacao === 'aguardando'; })
          .filter(function (l) { return forcar || !l.proxima_tentativa || Date.parse(l.proxima_tentativa) <= Date.now(); })
          .sort(function (a, b) { return (a.finalizado_em || '') < (b.finalizado_em || '') ? -1 : 1; });
        var V = LV.model ? LV.model.spec.version : null, parar = false, srv = null;
        var seq = Promise.resolve();
        fila.forEach(function (l) {
          seq = seq.then(function () {
            if (parar) return;
            var novo = !V || l.versao_instrumento === V;
            var pre = novo ? (srv ? srv : (srv = versaoServidor(c, forcar).then(function (v) { if (v < 2) throw erro('servidor_desatualizado'); }))) : Promise.resolve();
            return pre.then(function () { return enviaUm(l, c); }).then(function () {
              l.situacao = 'enviado'; l.enviado_em = new Date().toISOString(); l.tentativas = 0; l.ultimo_erro = ''; l.proxima_tentativa = null;
              res.enviados++;
              if (c.estado_codigo !== 'ok') { c.estado_codigo = 'ok'; return LV.salvaConfig({ estado_codigo: 'ok' }); }
            }).catch(function (e) {
              var cod = (e && e.codigo) || String(e && e.message || e);
              l.situacao = 'aguardando'; l.tentativas = (l.tentativas || 0) + 1; l.ultimo_erro = cod;
              l.proxima_tentativa = new Date(Date.now() + ESPERAS[Math.min(l.tentativas - 1, ESPERAS.length - 1)] * 1000).toISOString();
              res.falhas++; res.erro = cod;
              if (cod === 'token_invalido') { parar = true; c.estado_codigo = 'recusado'; return LV.salvaConfig({ estado_codigo: 'recusado' }); }
              if (cod === 'sem_conexao') parar = true;
            }).then(function () {
              return LV.db.getLev(l.id).then(function (fresh) {
                if (fresh && (fresh.situacao === 'rascunho' || fresh.finalizado_em !== l.finalizado_em)) return;
                return LV.db.putLev(l);
              });
            }).then(avisa);
          });
        });
        return seq.then(function () { return res; });
      });
    }).catch(function (e) { res.erro = (e && e.codigo) || String(e && e.message || e); return res; })
      .then(function (r) { rodando = false; avisa(); return r; });
  };

  LV.iniciaFila = function () {
    window.addEventListener('online', function () { LV.reconfereCodigo().then(function () { LV.enviarPendentes(false); }); });
    setInterval(function () { if (navigator.onLine) LV.enviarPendentes(false); }, 20000);
    LV.enviarPendentes(false);
  };
})();
