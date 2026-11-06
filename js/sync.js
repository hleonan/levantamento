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
      return { url: (c.url || d.backend_url || '').trim(), token: (c.token || '').trim() };
    });
  }
  LV.getConfig = cfg;
  LV.defaultConfig = function () {
    return fetch('config.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  };

  function post(url, obj) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(obj), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Resposta inesperada do servidor'); } if (!j.ok) throw new Error(j.erro || 'Recusado pelo servidor'); return j; });
  }
  function getJson(url) {
    return fetch(url, { redirect: 'follow' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function qs(c, p) {
    var s = 'acao=' + encodeURIComponent(p) + '&token=' + encodeURIComponent(c.token);
    return c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + s;
  }

  LV.ping = function () { return cfg().then(function (c) { if (!c.url) throw new Error('Endereço do backend não configurado'); return getJson(qs(c, 'ping')); }); };

  LV.atualizaKit = function () {
    return cfg().then(function (c) {
      if (!c.url || !c.token) throw new Error('Configure o endereço e o código de acesso');
      return getJson(qs(c, 'kit')).then(function (j) {
        if (!j.ok) throw new Error(j.erro || 'Kit recusado');
        var n = Object.keys(j.kit || {}).length;
        return LV.db.setMeta('kit', { dados: j.kit || {}, em: new Date().toISOString() }).then(function () { return n; });
      });
    });
  };

  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob);
    });
  }

  LV.payloadLev = function (l, fotos) {
    var u = l.unidade || {};
    return {
      id: l.id, versao_instrumento: l.versao_instrumento, versao_app: l.versao_app,
      unidade_id: u.id, unidade_nome: u.nome, tipo: (l.dados.c1_03 || u.tipo || ''), municipio: (l.dados.c1_06 || u.municipio || ''), zona: u.zona || '',
      levantado_por: l.levantado_por, perfil: l.perfil, situacao: 'finalizado',
      criado_em: l.criado_em, finalizado_em: l.finalizado_em, reaberturas: l.reaberturas || [],
      dados: l.dados, entrevistas: Object.keys(l.entrevistas || {}).sort().map(function (t) { return { pessoa: t, dados: l.entrevistas[t] }; }),
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
      if (!c.url || !c.token) { res.erro = 'Configure o endereço do backend e o código de acesso.'; return res; }
      if (!navigator.onLine) { res.erro = 'Sem internet.'; return res; }
      return LV.db.allLev().then(function (ls) {
        var fila = ls.filter(function (l) { return l.situacao === 'finalizado' || l.situacao === 'aguardando'; })
          .filter(function (l) { return forcar || !l.proxima_tentativa || Date.parse(l.proxima_tentativa) <= Date.now(); })
          .sort(function (a, b) { return (a.finalizado_em || '') < (b.finalizado_em || '') ? -1 : 1; });
        var seq = Promise.resolve();
        fila.forEach(function (l) {
          seq = seq.then(function () {
            return enviaUm(l, c).then(function () {
              l.situacao = 'enviado'; l.enviado_em = new Date().toISOString(); l.tentativas = 0; l.ultimo_erro = ''; l.proxima_tentativa = null;
              res.enviados++;
            }).catch(function (e) {
              l.situacao = 'aguardando'; l.tentativas = (l.tentativas || 0) + 1; l.ultimo_erro = String(e && e.message || e);
              l.proxima_tentativa = new Date(Date.now() + ESPERAS[Math.min(l.tentativas - 1, ESPERAS.length - 1)] * 1000).toISOString();
              res.falhas++; res.erro = l.ultimo_erro;
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
    }).catch(function (e) { res.erro = String(e && e.message || e); return res; })
      .then(function (r) { rodando = false; avisa(); return r; });
  };

  LV.iniciaFila = function () {
    window.addEventListener('online', function () { LV.enviarPendentes(false); });
    setInterval(function () { if (navigator.onLine) LV.enviarPendentes(false); }, 20000);
    LV.enviarPendentes(false);
  };
})();
