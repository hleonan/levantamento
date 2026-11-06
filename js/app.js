/* Interface do aplicativo. Sem frameworks, sem CDN. */
(function () {
  var LV = window.LV;
  var S = { model: null, unidades: [], perfil: null, kit: null, cur: null, fotos: [], saveTimer: null, urls: [], swReg: null };
  var $app;

  /* ---------- utilidades de DOM ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) for (var k in props) {
      var v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === undefined || c === null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  function go(hash) { if (location.hash === '#' + hash) route(); else location.hash = hash; }
  function toast(msg, ms) {
    var t = h('div', { class: 'toast', role: 'status', text: msg }); document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  function fmtDataHora(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  var STATUS = { rascunho: 'Rascunho', finalizado: 'Finalizado', enviado: 'Enviado', aguardando: 'Aguardando envio' };

  /* ---------- salvamento ---------- */
  function mark() {
    var el = document.getElementById('saveind'); if (el) el.textContent = 'Salvando...';
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 200);
  }
  function save() {
    clearTimeout(S.saveTimer); S.saveTimer = null;
    if (!S.cur) return Promise.resolve();
    S.cur.atualizado_em = new Date().toISOString();
    return LV.db.putLev(S.cur).then(function () {
      var el = document.getElementById('saveind'); if (el) el.textContent = 'Salvo ' + LV.agoraHora();
    });
  }
  function flush() { if (S.saveTimer) return save(); return Promise.resolve(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  /* ---------- cabecalho e estado de rede ---------- */
  function topbar(titulo, voltar) {
    return h('header', { class: 'top' },
      voltar ? h('a', { class: 'back', href: '#' + voltar, 'aria-label': 'Voltar', text: '‹' }) : null,
      h('div', { class: 'tt', text: titulo || 'Levantamento' }),
      h('span', { id: 'netpill', class: 'pill ' + (navigator.onLine ? 'on' : 'off'), text: navigator.onLine ? 'Com internet' : 'Sem internet' }));
  }
  function atualizaRede() {
    var p = document.getElementById('netpill'); if (!p) return;
    p.className = 'pill ' + (navigator.onLine ? 'on' : 'off'); p.textContent = navigator.onLine ? 'Com internet' : 'Sem internet';
  }
  window.addEventListener('online', atualizaRede); window.addEventListener('offline', atualizaRede);

  function render(nodes) {
    $app.innerHTML = ''; add($app, nodes); window.scrollTo(0, 0);
    var b = document.getElementById('upd'); if (b && S.updPronto) b.hidden = false;
  }

  /* ---------- roteador ---------- */
  function revogaUrls() { S.urls.forEach(function (u) { URL.revokeObjectURL(u); }); S.urls = []; }
  function route() {
    revogaUrls();
    flush().then(function () {
      var raw = location.hash.slice(1) || '/', q = {}, i = raw.indexOf('?');
      if (i >= 0) { raw.slice(i + 1).split('&').forEach(function (p) { var kv = p.split('='); q[kv[0]] = decodeURIComponent(kv[1] || ''); }); raw = raw.slice(0, i); }
      var p = raw.split('/').filter(Boolean);
      if (!S.perfil && p[0] !== 'ident') return go('/ident');
      if (!p.length) return vHome();
      if (p[0] === 'ident') return vIdent();
      if (p[0] === 'config') return vConfig();
      if (p[0] === 'ajuda') return vAjuda();
      if (p[0] === 'novo') return vNovo();
      if (p[0] === 'lev' && p[1]) return abre(p[1]).then(function (l) {
        if (!l) return go('/');
        if (p[2] === 'b') return vBloco(+p[3] || 1, q.f);
        if (p[2] === 'ent') return vEntrevista(p[3], q.f);
        if (p[2] === 'finalizar') return vFinalizar();
        if (p[2] === 'resumo') return vResumo();
        return go(l.situacao === 'rascunho' ? '/lev/' + l.id + '/b/' + (l.bloco_atual || 1) : '/lev/' + l.id + '/resumo');
      });
      go('/');
    });
  }

  function abre(id) {
    return Promise.all([LV.db.getLev(id), LV.db.fotosDe(id)]).then(function (a) {
      S.cur = a[0] || null; S.fotos = a[1] || [];
      if (S.cur && S.cur.situacao === 'rascunho' && !S.cur.kit_aplicado && aplicaKit(S.cur)) mark();
      return S.cur;
    });
  }
  function recarregaFotos() { return LV.db.fotosDe(S.cur.id).then(function (f) { S.fotos = f; }); }

  /* ---------- progresso ---------- */
  function blocoProg(b, l) {
    if (b.id === '7') { var n = Object.keys(l.entrevistas || {}).length; return { f: Math.min(n, 18), t: 18, n: n }; }
    var f = 0, t = 0;
    function cont(d) { t++; var v = l.dados[d.key]; if (v !== undefined && v !== '') f++; }
    b.items.forEach(function (it) {
      if (it.type === 'fields') it.rows.forEach(function (d) { if (!d.cgis && d.kind !== 'sig') cont(d); });
      else if (it.type === 'grid') it.rows.forEach(function (r) { r.cells.forEach(cont); });
    });
    return { f: f, t: t };
  }
  function progTotal(l) {
    var f = 0, t = 0;
    S.model.blocks.forEach(function (b) { var p = blocoProg(b, l); f += p.f; t += p.t; });
    return t ? Math.round(100 * f / t) : 0;
  }
  function barra(pct) { return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: 'width:' + pct + '%' })); }

  /* ---------- kit ---------- */
  function aplicaKit(l) {
    var k = S.kit && S.kit.dados && S.kit.dados[l.unidade.id];
    if (!k) return false;
    Object.keys(k).forEach(function (key) {
      if (S.model.fields[key] && (l.dados[key] === undefined || l.dados[key] === '')) l.dados[key] = LV.clean(String(k[key]));
    });
    l.kit_aplicado = true; return true;
  }
  function kitSilencioso() {
    if (!navigator.onLine) return;
    LV.getConfig().then(function (c) { if (c.url && c.token) return LV.atualizaKit(); }).then(function (n) {
      return LV.db.getMeta('kit').then(function (k) { S.kit = k; });
    }).catch(function () {});
  }

  /* ---------- Identificacao ---------- */
  function vIdent() {
    var nome = h('input', { id: 'in-nome', type: 'text', autocomplete: 'name', value: (S.perfil && S.perfil.nome) || '' });
    var perfil = h('select', { id: 'in-perfil' }, h('option', { value: 'Supervisor Regional', text: 'Supervisor Regional' }), h('option', { value: 'AVA', text: 'AVA (Agente de Verificação do Atendimento)' }));
    if (S.perfil) perfil.value = S.perfil.perfil;
    var cod = h('input', { id: 'in-codigo', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    var url = h('input', { id: 'in-url', type: 'url', placeholder: 'https://script.google.com/macros/s/.../exec', autocapitalize: 'off' });
    var msg = h('p', { class: 'msg', id: 'ident-msg' });
    LV.getConfig().then(function (c) { if (!url.value) url.value = c.url || ''; if (!cod.value) cod.value = c.token || ''; });
    function entrar() {
      if (!nome.value.trim()) { msg.textContent = 'Informe seu nome.'; return; }
      if (!cod.value.trim()) { msg.textContent = 'Informe o código de acesso fornecido pela CGIS.'; return; }
      var perf = { nome: nome.value.trim(), perfil: perfil.value };
      var cfg = { url: url.value.trim(), token: cod.value.trim() };
      msg.textContent = 'Verificando...';
      var fim = function (aviso) {
        LV.db.setMeta('perfil', perf).then(function () { return LV.db.setMeta('config', cfg); }).then(function () {
          S.perfil = perf; if (aviso) toast(aviso, 5000); kitSilencioso(); go('/');
        });
      };
      LV.db.setMeta('config', cfg).then(function () {
        if (!navigator.onLine) return fim('Sem internet: o código será conferido quando houver conexão.');
        return LV.getConfig().then(function (c) {
          if (!c.url) return fim('Endereço do backend não informado: o envio ficará pendente até configurá-lo.');
          return LV.ping().then(function (j) {
            if (j.token_valido === false) { msg.textContent = 'Código de acesso não reconhecido. Confira com a CGIS.'; return; }
            fim();
          }).catch(function () { fim('Não foi possível conferir o código agora. Seguindo sem validar.'); });
        });
      });
    }
    render([topbar('Primeiro acesso'), h('main', { class: 'wrap' },
      h('div', { class: 'card' },
        h('h1', { text: 'Identificação' }),
        h('p', { text: 'Estes dados ficam só neste aparelho e identificam quem fez o levantamento.' }),
        h('label', { for: 'in-nome', text: 'Seu nome completo' }), nome,
        h('label', { for: 'in-perfil', text: 'Perfil' }), perfil,
        h('label', { for: 'in-codigo', text: 'Código de acesso (fornecido pela CGIS)' }), cod,
        h('label', { for: 'in-url', text: 'Endereço do backend (se a CGIS não o configurou no aplicativo)' }), url,
        msg,
        h('button', { class: 'btn', id: 'btn-entrar', onclick: entrar, text: 'Entrar' })))]);
  }

  /* ---------- Configuracoes ---------- */
  function vConfig() {
    var url = h('input', { id: 'cf-url', type: 'url', autocapitalize: 'off' });
    var cod = h('input', { id: 'cf-codigo', type: 'password', autocomplete: 'off' });
    var nome = h('input', { id: 'cf-nome', type: 'text', value: S.perfil.nome });
    var perfil = h('select', { id: 'cf-perfil' }, h('option', { value: 'Supervisor Regional', text: 'Supervisor Regional' }), h('option', { value: 'AVA', text: 'AVA' }));
    perfil.value = S.perfil.perfil;
    var msg = h('p', { class: 'msg', id: 'cf-msg' });
    var kitinfo = h('p', { class: 'hint', id: 'cf-kit' });
    function kitTxt() { LV.db.getMeta('kit').then(function (k) { S.kit = k; kitinfo.textContent = k ? 'Kit: ' + Object.keys(k.dados).length + ' unidade(s), atualizado em ' + fmtDataHora(k.em) : 'Kit ainda não baixado neste aparelho.'; }); }
    LV.db.getMeta('config').then(function (c) { c = c || {}; url.value = c.url || ''; cod.value = c.token || ''; if (!url.value) LV.defaultConfig().then(function (d) { url.value = d.backend_url || ''; }); });
    kitTxt();
    function grava() {
      var perf = { nome: nome.value.trim() || S.perfil.nome, perfil: perfil.value };
      return LV.db.setMeta('config', { url: url.value.trim(), token: cod.value.trim() }).then(function () { return LV.db.setMeta('perfil', perf); }).then(function () { S.perfil = perf; });
    }
    render([topbar('Configurações', '/'), h('main', { class: 'wrap' }, h('div', { class: 'card' },
      h('label', { for: 'cf-nome', text: 'Nome' }), nome, h('label', { for: 'cf-perfil', text: 'Perfil' }), perfil,
      h('label', { for: 'cf-url', text: 'Endereço do backend (URL do Apps Script)' }), url,
      h('label', { for: 'cf-codigo', text: 'Código de acesso' }), cod, msg,
      h('button', { class: 'btn', id: 'cf-salvar', text: 'Salvar', onclick: function () { grava().then(function () { msg.textContent = 'Configurações salvas.'; }); } }),
      h('button', { class: 'btn sec', id: 'cf-testar', text: 'Testar conexão', onclick: function () {
        msg.textContent = 'Testando...';
        grava().then(function () { return LV.ping(); }).then(function (j) { msg.textContent = j.token_valido === false ? 'Servidor responde, mas o código de acesso não foi reconhecido.' : 'Conexão ok' + (j.nome ? ' (' + j.nome + ')' : '') + '.'; })
          .catch(function (e) { msg.textContent = 'Falhou: ' + e.message; });
      } }),
      h('button', { class: 'btn sec', id: 'cf-kit-btn', text: 'Atualizar kit agora', onclick: function () {
        msg.textContent = 'Baixando kit...';
        grava().then(function () { return LV.atualizaKit(); }).then(function (n) { msg.textContent = 'Kit atualizado: ' + n + ' unidade(s).'; kitTxt(); }).catch(function (e) { msg.textContent = 'Falhou: ' + e.message; });
      } }), kitinfo,
      h('p', { class: 'hint', text: 'Versão do aplicativo ' + LV.APP_VERSION + ' | instrumento ' + S.model.spec.version + ' | lista de unidades: ' + S.unidades.length + ' unidade(s).' })))]);
  }

  /* ---------- Ajuda ---------- */
  function vAjuda() {
    var sp = S.model.spec;
    render([topbar('Ajuda', '/'), h('main', { class: 'wrap' },
      h('div', { class: 'card' }, h('h1', { text: sp.howto.title }), sp.howto.items.map(function (i) { return h('p', null, h('b', { text: i[0] + ': ' }), LV.clean(i[1])); })),
      h('div', { class: 'card' }, h('h1', { text: 'Regras de conduta' }), sp.intro.rules.map(function (i) { return h('p', null, h('b', { text: i[0] + ': ' }), LV.clean(i[1])); })),
      h('div', { class: 'card' }, h('h1', { text: 'Neste aplicativo' }),
        h('p', { text: 'Tudo é salvo no aparelho a cada alteração. Sem internet, o levantamento e o PDF funcionam normalmente; o envio acontece sozinho quando a conexão voltar. Nunca registre nome, documento, CPF ou placa de quem é atendido. Cubra os rostos nas fotos antes de finalizar.' })))]);
  }

  /* ---------- Home ---------- */
  function vHome() {
    LV.db.allLev().then(function (ls) {
      ls.sort(function (a, b) { return (b.criado_em || '') < (a.criado_em || '') ? -1 : 1; });
      var pend = ls.filter(function (l) { return l.situacao === 'finalizado' || l.situacao === 'aguardando'; }).length;
      var info = h('p', { class: 'msg', id: 'home-msg' });
      var cards = ls.length ? ls.map(function (l) {
        var st = l.situacao;
        return h('a', { class: 'lev', href: '#/lev/' + l.id, 'data-id': l.id },
          h('div', { class: 'lt' }, h('b', { text: l.unidade.nome || '(sem nome)' }), h('span', { class: 'st st-' + st, text: STATUS[st] })),
          h('div', { class: 'hint', text: (l.unidade.municipio || '') + (l.dados.c1_18 ? ' | visita ' + l.dados.c1_18 : '') }),
          st === 'rascunho' ? [barra(progTotal(l)), h('div', { class: 'hint', text: progTotal(l) + '% preenchido' })] : null,
          st === 'aguardando' && l.ultimo_erro ? h('div', { class: 'hint', text: 'Último erro: ' + l.ultimo_erro }) : null);
      }) : h('p', { class: 'hint', text: 'Nenhum levantamento neste aparelho ainda.' });
      render([topbar('Levantamentos'), h('main', { class: 'wrap' },
        h('div', { id: 'upd', class: 'upd', hidden: true }, h('span', { text: 'Nova versão do aplicativo pronta. ' }), h('button', { class: 'btn sm', id: 'btn-upd', text: 'Atualizar', onclick: atualizaApp })),
        h('p', { class: 'hint', text: S.perfil.nome + ' | ' + S.perfil.perfil }),
        h('a', { class: 'btn', id: 'btn-novo', href: '#/novo', text: 'Novo levantamento' }),
        pend ? h('button', { class: 'btn sec', id: 'btn-enviar', text: 'Enviar agora (' + pend + ')', onclick: function () { enviarAgora(info); } }) : null,
        info, h('div', { class: 'list', id: 'lista' }, cards),
        h('nav', { class: 'foot' }, h('a', { href: '#/config', text: 'Configurações' }), h('a', { href: '#/ajuda', text: 'Ajuda' }), h('span', { class: 'hint', text: 'v' + LV.APP_VERSION })))]);
    });
  }
  function enviarAgora(info) {
    if (info) info.textContent = 'Enviando...';
    LV.enviarPendentes(true).then(function (r) {
      if (info) info.textContent = r.enviados ? r.enviados + ' enviado(s).' + (r.falhas ? ' ' + r.falhas + ' com falha: ' + r.erro : '') : (r.erro ? 'Não enviado: ' + r.erro : 'Nada a enviar.');
      toast(r.enviados ? 'Enviado com sucesso.' : (r.erro ? 'Não enviado: ' + r.erro : 'Nada a enviar.'), 5000);
    });
  }
  LV.onSync(function () { if (!S.cur || location.hash.indexOf('resumo') < 0) { if ((location.hash || '#/') === '#/') { var m = document.getElementById('home-msg'); if (m && /Enviando/.test(m.textContent)) return; vHomeSoft(); } } else vResumoSoft(); });
  function vHomeSoft() { /* atualiza a lista sem apagar a mensagem */ var m = document.getElementById('home-msg'), t = m ? m.textContent : ''; vHome(); setTimeout(function () { var n = document.getElementById('home-msg'); if (n && t) n.textContent = t; }, 60); }
  function vResumoSoft() { if (S.cur) LV.db.getLev(S.cur.id).then(function (l) { if (l && S.cur && S.cur.id === l.id && l.situacao !== 'rascunho') { S.cur = l; vResumo(); } }); }

  function atualizaApp() {
    if (S.swReg && S.swReg.waiting) S.swReg.waiting.postMessage({ type: 'SKIP_WAITING' }); else location.reload();
  }

  /* ---------- Novo levantamento ---------- */
  function vNovo() {
    var tipos = Array.from(new Set(S.unidades.map(function (u) { return u.tipo; }))).sort();
    var busca = h('input', { id: 'busca', type: 'search', placeholder: 'Buscar por nome ou município', autocomplete: 'off' });
    var filtro = h('select', { id: 'ftipo' }, h('option', { value: '', text: 'Todos os tipos' }), tipos.map(function (t) { return h('option', { value: t, text: t }); }));
    var lista = h('div', { class: 'list', id: 'ulista' });
    var LIM = 50;
    function lista_() {
      var q = LV.semAcento(busca.value.trim()), ft = filtro.value;
      var r = S.unidades.filter(function (u) { return (!ft || u.tipo === ft) && (!q || LV.semAcento(u.nome + ' ' + u.municipio).indexOf(q) >= 0); });
      lista.innerHTML = '';
      r.slice(0, LIM).forEach(function (u) {
        lista.appendChild(h('button', { class: 'uni', 'data-uid': u.id, onclick: function () { cria(u); } },
          h('b', { text: u.nome }), h('span', { class: 'hint', text: u.tipo + ' | ' + u.municipio + (u.conf === 'a validar' ? ' | endereço a validar' : '') })));
      });
      if (r.length > LIM) lista.appendChild(h('p', { class: 'hint', text: 'Mostrando ' + LIM + ' de ' + r.length + '. Refine a busca.' }));
      if (!r.length) lista.appendChild(h('p', { class: 'hint', text: 'Nenhuma unidade encontrada.' }));
    }
    busca.addEventListener('input', lista_); filtro.addEventListener('change', lista_);
    var tipoOpts = S.model.fields.c1_03.opts;
    var nl = h('div', { class: 'card', id: 'nl', hidden: true },
      h('h2', { text: 'Unidade não listada' }),
      h('label', { for: 'nl-nome', text: 'Nome da unidade' }), h('input', { id: 'nl-nome', type: 'text' }),
      h('label', { for: 'nl-tipo', text: 'Tipo' }), h('select', { id: 'nl-tipo' }, h('option', { value: '', text: 'Selecione' }), tipoOpts.map(function (o) { return h('option', { value: o, text: o }); })),
      h('label', { for: 'nl-mun', text: 'Município' }), h('input', { id: 'nl-mun', type: 'text' }),
      h('label', { for: 'nl-end', text: 'Endereço' }), h('input', { id: 'nl-end', type: 'text' }),
      h('p', { class: 'msg', id: 'nl-msg' }),
      h('button', { class: 'btn', id: 'nl-ok', text: 'Criar levantamento', onclick: function () {
        var v = function (id) { return document.getElementById(id).value.trim(); };
        if (!v('nl-nome') || !v('nl-tipo') || !v('nl-mun')) { document.getElementById('nl-msg').textContent = 'Informe nome, tipo e município.'; return; }
        cria({ id: 'NL-' + LV.uuid().slice(0, 6).toUpperCase(), tipo: v('nl-tipo'), municipio: v('nl-mun'), nome: v('nl-nome'), endereco: v('nl-end'), horario: '', zona: '', conf: '', listada: false, servicos_site: [], postos: [] });
      } }));
    render([topbar('Nova visita', '/'), h('main', { class: 'wrap' }, busca, filtro, lista,
      h('button', { class: 'btn sec', id: 'btn-nl', text: 'Unidade não listada', onclick: function () { nl.hidden = !nl.hidden; } }), nl)]);
    lista_();
  }
  function cria(u) {
    var opts = S.model.fields.c1_03.opts, d = {};
    d.c1_01 = u.listada === false ? '' : u.id; d.c1_02 = u.nome; d.c1_03 = LV.mapTipo(u.tipo, u.nome, opts) || (u.listada === false ? u.tipo : '');
    d.c1_06 = u.municipio; d.c1_18 = LV.hojeBr(); d.c1_23 = S.perfil.nome;
    if (u.listada === false) { d.c1_10 = 'Corrigido'; d.c1_11 = u.endereco; }
    var l = { id: LV.uuid(), versao_instrumento: S.model.spec.version, versao_app: LV.APP_VERSION, unidade: u, levantado_por: S.perfil.nome, perfil: S.perfil.perfil,
      situacao: 'rascunho', criado_em: new Date().toISOString(), dados: d, entrevistas: {}, reaberturas: [], bloco_atual: 1 };
    aplicaKit(l);
    LV.db.putLev(l).then(function () { S.cur = l; S.fotos = []; go('/lev/' + l.id + '/b/1'); });
  }

  /* ---------- Campos ---------- */
  function inputFor(d, val, attrs) {
    var a = { 'data-key': d.key, id: 'f-' + d.key + (attrs && attrs.sfx || '') };
    var el;
    val = val === undefined ? '' : val;
    if (d.kind === 'sel') {
      el = h('select', a, h('option', { value: '', text: 'Selecione' }), d.opts.map(function (o) { return h('option', { value: o, text: o }); }));
      el.value = val;
      if (val && d.opts.indexOf(val) < 0) { el.appendChild(h('option', { value: val, text: val })); el.value = val; }
    } else if (d.kind === 'long') { el = h('textarea', a); el.value = val; el.rows = 3; }
    else if (d.kind === 'num') { el = h('input', Object.assign({ type: 'number', inputmode: 'numeric', min: '0', step: '1', pattern: '[0-9]*' }, a)); el.value = val; }
    else if (d.kind === 'date') { el = h('input', Object.assign({ type: 'date' }, a)); el.value = LV.brToIso(val); }
    else if (d.kind === 'time') { el = h('input', Object.assign({ type: 'time' }, a)); el.value = val; }
    else { el = h('input', Object.assign({ type: 'text', autocomplete: 'off' }, a)); el.value = val; }
    return el;
  }
  function fmtBox(d, val) {
    if (d.kind !== 'date' && d.kind !== 'time') return null;
    return h('small', { class: 'fmtshow', 'data-for': d.key, text: val ? 'Registrado: ' + val : (d.kind === 'date' ? 'dd/mm/aaaa' : 'hh:mm') });
  }
  function celula(d, val, extraLabel) {
    var box = h('div', { class: 'field' + (d.kind === 'long' ? ' wide' : '') + (d.kind === 'text' ? ' wide' : ''), 'data-fk': d.key });
    var campo = inputFor(d, val);
    var lbl = extraLabel ? h('label', { for: campo.id, text: extraLabel }) : null;
    add(box, [lbl, campo, fmtBox(d, val)]);
    if (d.kind === 'time') box.appendChild(h('button', { type: 'button', class: 'now', 'data-now': d.key, text: 'Agora' }));
    return box;
  }
  function campoLinha(d, val) {
    if (d.cgis) return h('div', { class: 'row', 'data-fk': d.key }, h('div', { class: 'lab' }, h('b', { text: d.code }), ' ' + d.label), h('div', { class: 'cgis', text: LV.CGIS_TXT }));
    if (d.kind === 'sig') return h('div', { class: 'row', 'data-fk': d.key }, h('div', { class: 'lab' }, h('b', { text: d.code }), ' ' + d.label), h('div', { class: 'cgis', text: 'Assinatura à mão no PDF impresso' }));
    var c = celula(d, val);
    var lab = h('label', { class: 'lab', for: c.querySelector('[data-key]').id }, h('b', { text: d.code }), ' ' + d.label);
    return h('div', { class: 'row' }, lab, c);
  }

  /* trata qualquer alteracao dentro de um container */
  function ligaCampos(cont, getStore, onchange) {
    function aplica(el) {
      var key = el.getAttribute('data-key'); if (!key) return;
      var d = S.model.fields[key] || cont._defs && cont._defs[key]; var kind = d ? d.kind : 'text';
      var v = el.value;
      if (kind === 'date') v = LV.isoToBr(v);
      if (kind === 'num') v = el.validity && el.validity.badInput ? 'inválido' : v.trim();
      getStore()[key] = v;
      var box = el.closest('.field, .row'); var fb = cont.querySelector('.fmtshow[data-for="' + key + '"]');
      if (fb) fb.textContent = v ? 'Registrado: ' + v : (kind === 'date' ? 'dd/mm/aaaa' : 'hh:mm');
      var bad = !LV.valid(kind, v); el.classList.toggle('err', bad);
      var fld = el.closest('.field'); var em = fld && fld.querySelector('.errmsg');
      if (bad) { if (!em && fld) fld.appendChild(h('div', { class: 'errmsg', text: 'Formato inválido: ' + LV.fmtMsg[kind] })); } else if (em) em.remove();
      if ((kind === 'text' || kind === 'long') && LV.pareceDadoPessoal(v)) toast('Atenção: parece CPF ou placa. Não registre dado de quem é atendido.', 6000);
      mark(); if (onchange) onchange(key, v);
    }
    cont.addEventListener('input', function (e) { if (e.target.matches('input,textarea')) aplica(e.target); });
    cont.addEventListener('change', function (e) { if (e.target.matches('select,input,textarea')) aplica(e.target); });
    cont.addEventListener('click', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-now'); if (!k) return;
      var el = cont.querySelector('[data-key="' + k + '"]'); el.value = LV.agoraHora(); aplica(el);
    });
  }

  /* ---------- Bloco ---------- */
  function vBloco(n, foco) {
    revogaUrls();
    var M = S.model, l = S.cur, b = M.blocks[n - 1];
    if (!b) return go('/lev/' + l.id + '/b/1');
    if (l.situacao !== 'rascunho') return go('/lev/' + l.id + '/resumo');
    l.bloco_atual = n; mark();
    var sel = h('select', { id: 'bsel', 'aria-label': 'Ir para o bloco', onchange: function () { go(this.value === 'fin' ? '/lev/' + l.id + '/finalizar' : '/lev/' + l.id + '/b/' + this.value); } },
      M.blocks.map(function (x) { var p = blocoProg(x, l); return h('option', { value: x.id, text: x.title.replace(/^Bloco (\d+)\. /, '$1. ') + (x.id === '7' ? ' (' + p.n + ' entrev.)' : ' (' + Math.round(100 * p.f / (p.t || 1)) + '%)') }); }),
      h('option', { value: 'fin', text: 'Revisar e finalizar' }));
    sel.value = String(n);
    var body = h('div', { class: 'blk', id: 'blk' });
    if (b.lead) body.appendChild(h('details', { class: 'lead' }, h('summary', { text: 'Orientações do bloco' }), h('p', { text: LV.clean(typeof b.lead === 'string' ? b.lead : b.lead.join(' ')) })));
    if (n === 1) body.appendChild(infoUnidade(l.unidade));
    b.items.forEach(function (it) {
      if (it.subtitle) body.appendChild(h('h3', { text: it.subtitle }));
      if (it.type === 'fields') {
        if (n === 9) { it.rows.forEach(function (d) { body.appendChild(n9linha(d)); }); return; }
        it.rows.forEach(function (d) { body.appendChild(campoLinha(d, l.dados[d.key])); });
      } else if (it.type === 'grid') {
        it.rows.forEach(function (r) {
          if (r.cgis) { body.appendChild(h('div', { class: 'row card2' }, h('div', { class: 'lab' }, h('b', { text: r.code }), ' ' + r.label), h('div', { class: 'cgis', text: LV.CGIS_TXT }))); return; }
          body.appendChild(h('div', { class: 'row card2' }, h('div', { class: 'lab' }, h('b', { text: r.code }), ' ' + r.label),
            h('div', { class: 'cells' }, r.cells.map(function (d) { return celula(d, l.dados[d.key], d.colLabel); }))));
        });
      } else if (it.type === 'paras') {
        body.appendChild(h('details', { class: 'lead', open: true }, h('summary', { text: 'Como conduzir' }), it.items.map(function (p) { return h('p', null, h('b', { text: p[0] + ': ' }), LV.clean(p[1])); })));
      } else if (it.type === 'static') {
        body.appendChild(h('details', { class: 'lead' }, h('summary', { text: 'Regras de cor (aplicadas pela CGIS na base)' }),
          it.rows.map(function (r) { return h('p', null, h('b', { text: r[0] + ': ' }), 'Vermelho: ' + LV.clean(r[1]) + ' | Amarelo: ' + LV.clean(r[2]) + ' | Verde: ' + LV.clean(r[3])); }), it.note.map(function (x) { return h('p', { class: 'hint', text: LV.clean(x) }); })));
      } else if (it.type === 'questions') {
        body.appendChild(painelEntrevistas(it.prefix));
      }
    });
    if (b.tail) body.appendChild(h('p', { class: 'hint', text: LV.clean(b.tail) }));
    ligaCampos(body, function () { return S.cur.dados; });
    var ant = n > 1 ? h('a', { class: 'btn sec', id: 'btn-ant', href: '#/lev/' + l.id + '/b/' + (n - 1), text: 'Anterior' }) : h('a', { class: 'btn sec', href: '#/', text: 'Início' });
    var prox = n < M.blocks.length ? h('a', { class: 'btn', id: 'btn-prox', href: '#/lev/' + l.id + '/b/' + (n + 1), text: 'Próximo' }) : h('a', { class: 'btn', id: 'btn-rev', href: '#/lev/' + l.id + '/finalizar', text: 'Revisar e finalizar' });
    render([topbar(l.unidade.nome, '/'), h('main', { class: 'wrap' },
      h('div', { class: 'bhead' }, sel, barra(progTotal(l)), h('div', { class: 'hint' }, h('span', { text: 'Bloco ' + n + ' de ' + M.blocks.length + ' | ' + progTotal(l) + '% do levantamento | ' }), h('span', { id: 'saveind', text: 'Salvo' }))),
      body), h('nav', { class: 'bnav' }, ant, prox)]);
    if (foco) setTimeout(function () { foca(foco); }, 50);
  }
  function foca(key) {
    var el = document.querySelector('[data-key="' + key + '"]'); if (!el) return;
    el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true });
    var bx = el.closest('.row, .field'); if (bx) { bx.classList.add('hl'); setTimeout(function () { bx.classList.remove('hl'); }, 3500); }
  }
  function infoUnidade(u) {
    var linhas = [];
    if (u.endereco) linhas.push('Endereço no cadastro: ' + u.endereco);
    if (u.horario) linhas.push('Horário no cadastro: ' + u.horario);
    if (u.tipo) linhas.push('Tipo no cadastro: ' + u.tipo);
    if (u.servicos_site && u.servicos_site.length) linhas.push('Serviços no site: ' + u.servicos_site.join(', '));
    if (u.servicos_contrato && u.servicos_contrato.length) linhas.push('Serviços no contrato: ' + [].concat(u.servicos_contrato).join(', '));
    if (u.postos && u.postos.length) linhas.push('Postos: ' + u.postos.join('; '));
    if (u.obs) linhas.push('Obs.: ' + u.obs);
    if (u.conf === 'a validar') linhas.push('Endereço a validar: confira no local e use os itens 1.10 e 1.11.');
    return h('div', { class: 'card2 info' }, h('b', { text: 'Dados do cadastro (a confirmar no local)' }), linhas.map(function (x) { return h('div', { text: LV.clean(x) }); }));
  }

  /* ---------- Bloco 9: fotos ---------- */
  function fotoDe(codigo) { return S.fotos.filter(function (f) { return f.codigo === codigo; })[0]; }
  function thumbEl(f) {
    var u = URL.createObjectURL(f.blob); S.urls.push(u);
    return h('img', { class: 'thumb', src: u, alt: 'Foto ' + f.codigo });
  }
  function n9linha(d) {
    var l = S.cur;
    if (d.code === '9.07' || d.code === '9.08') return n9extra(d);
    var f = fotoDe(d.code);
    var wrap = campoLinha(d, l.dados[d.key]);
    var area = h('div', { class: 'fotoarea', 'data-foto': d.code });
    if (f) {
      add(area, [thumbEl(f), h('div', { class: 'hint', text: f.revisada ? 'Rostos conferidos' + (f.cobertas ? ' (' + f.cobertas + ' área(s) coberta(s))' : '') : 'ATENÇÃO: cubra os rostos e conclua.' }),
        h('div', { class: 'fb' }, h('button', { class: 'btn sm sec', text: 'Cobrir rostos', onclick: function () { reedita(f); } }),
          h('button', { class: 'btn sm sec', text: 'Remover', onclick: function () { removeFoto(f); } }))]);
    }
    area.appendChild(botaoFoto(d.code, f ? 'Refazer foto' : 'Tirar foto'));
    wrap.appendChild(area); return wrap;
  }
  function n9extra(d) {
    var l = S.cur, pref = d.code;
    var fs = S.fotos.filter(function (f) { return f.codigo.indexOf(pref + '-') === 0; }).sort(function (a, b) { return a.codigo < b.codigo ? -1 : 1; });
    var wrap = campoLinha(d, l.dados[d.key]);
    var area = h('div', { class: 'fotoarea', 'data-foto': pref }, fs.map(function (f) {
      return h('div', { class: 'fx' }, thumbEl(f), h('div', { class: 'hint', text: f.codigo + (f.revisada ? ' | rostos conferidos' : ' | cubra os rostos') }),
        h('div', { class: 'fb' }, h('button', { class: 'btn sm sec', text: 'Cobrir rostos', onclick: function () { reedita(f); } }), h('button', { class: 'btn sm sec', text: 'Remover', onclick: function () { removeFoto(f); } })));
    }));
    var prox = 1; while (fotoDe(pref + '-' + prox)) prox++;
    area.appendChild(botaoFoto(pref + '-' + prox, 'Adicionar foto'));
    wrap.appendChild(area); return wrap;
  }
  function botaoFoto(codigo, texto) {
    var inp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'filein', 'data-cod': codigo, 'aria-label': texto + ' ' + codigo });
    inp.addEventListener('change', function () { var file = inp.files[0]; if (file) novaFoto(codigo, file); });
    return h('label', { class: 'btn sm filelab' }, texto, inp);
  }
  function novaFoto(codigo, file) {
    toast('Processando foto...', 1500);
    LV.comprimir(file).then(function (r) { return LV.editorRostos(r.blob, 'Foto ' + codigo).then(function (ed) { return { r: r, ed: ed }; }); }).then(function (x) {
      var fin = x.ed || { blob: x.r.blob, w: x.r.w, h: x.r.h, cobertas: 0, revisada: false };
      var velha = fotoDe(codigo);
      var rec = { fid: LV.uuid(), levId: S.cur.id, codigo: codigo, blob: fin.blob, w: fin.w, h: fin.h, revisada: !!fin.revisada, cobertas: fin.cobertas || 0, criado_em: new Date().toISOString(), enviada: false };
      return (velha ? LV.db.delFoto(velha.fid) : Promise.resolve()).then(function () { return LV.db.putFoto(rec); }).then(function () { return recarregaFotos(); }).then(function () { acertaCamposFoto(codigo); });
    }).catch(function (e) { toast('Não foi possível processar a foto: ' + e.message, 6000); });
  }
  function reedita(f) {
    LV.editorRostos(f.blob, 'Foto ' + f.codigo).then(function (ed) {
      if (!ed) return;
      f.blob = ed.blob; f.w = ed.w; f.h = ed.h; f.revisada = true; f.cobertas = (f.cobertas || 0) + ed.cobertas; f.enviada = false;
      return LV.db.putFoto(f).then(function () { return recarregaFotos(); }).then(function () { vBloco(9); });
    });
  }
  function removeFoto(f) {
    if (!confirm('Remover a foto ' + f.codigo + '?')) return;
    LV.db.delFoto(f.fid).then(recarregaFotos).then(function () { acertaCamposFoto(f.codigo, true); });
  }
  function acertaCamposFoto(codigo, removida) {
    var D = S.cur.dados;
    if (/^9\.0[1-6]$/.test(codigo)) { D['c' + codigo.replace('.', '_')] = removida ? 'Não feita' : 'Feita'; }
    ['9.07', '9.08'].forEach(function (p) {
      var n = S.fotos.filter(function (f) { return f.codigo.indexOf(p + '-') === 0; }).length;
      D['c' + p.replace('.', '_')] = String(n);
    });
    save().then(function () { vBloco(9); });
  }

  /* ---------- Entrevistas (bloco 7) ---------- */
  function painelEntrevistas(prefix) {
    var g = S.model.ent[prefix], l = S.cur, ents = l.entrevistas;
    var tags = []; for (var i = 1; i <= g.n; i++) tags.push(prefix + ('0' + i).slice(-2));
    var feitas = tags.filter(function (t) { return ents[t]; });
    var livre = tags.filter(function (t) { return !ents[t]; })[0];
    return h('div', { class: 'card2 ents', 'data-prefix': prefix },
      h('b', { text: g.subtitle + ' (' + feitas.length + ' de ' + g.n + ')' }), g.intro ? h('p', { class: 'hint', text: LV.clean(g.intro) }) : null,
      h('p', { class: 'aviso', text: 'Nunca peça nem registre nome, documento, CPF ou placa de quem é atendido.' }),
      h('div', { class: 'chips' }, feitas.map(function (t) { return h('a', { class: 'chip', href: '#/lev/' + l.id + '/ent/' + t, 'data-tag': t, text: t }); })),
      livre ? h('a', { class: 'btn sm', id: 'add-' + prefix, href: '#/lev/' + l.id + '/ent/' + livre, text: 'Nova entrevista ' + livre }) : h('p', { class: 'hint', text: 'Limite de entrevistas atingido.' }));
  }
  function vEntrevista(tag, foco) {
    var l = S.cur, prefix = tag && tag.charAt(0), g = S.model.ent[prefix];
    var num = +String(tag).slice(1);
    if (!g || !(num >= 1 && num <= g.n)) return go('/lev/' + l.id + '/b/7');
    if (l.situacao !== 'rascunho') return go('/lev/' + l.id + '/resumo');
    if (!l.entrevistas[tag]) { l.entrevistas[tag] = {}; mark(); }
    var E = l.entrevistas[tag], defs = {};
    var body = h('div', { class: 'blk' }, h('p', { class: 'aviso', text: 'Nunca peça nem registre nome, documento, CPF ou placa de quem é atendido.' }),
      g.fields.map(function (d) {
        defs[d.key] = d;
        var c = celula(d, E[d.key]); var inp = c.querySelector('[data-key]');
        return h('div', { class: 'row' }, h('label', { class: 'lab', for: inp.id }, h('b', { text: d.code }), ' ' + d.label), c);
      }));
    body._defs = defs;
    ligaCampos(body, function () { return l.entrevistas[tag]; });
    var tags = []; for (var i = 1; i <= g.n; i++) tags.push(prefix + ('0' + i).slice(-2));
    render([topbar('Entrevista ' + tag, '/lev/' + l.id + '/b/7'), h('main', { class: 'wrap' },
      h('div', { class: 'bhead' }, h('h1', { text: (prefix === 'E' ? 'Na fila: ' : 'Na saída: ') + tag }), h('div', { class: 'hint' }, h('span', { id: 'saveind', text: 'Salvo' }))), body,
      h('button', { class: 'btn sec', id: 'ent-del', text: 'Excluir esta entrevista', onclick: function () {
        if (!confirm('Excluir a entrevista ' + tag + '?')) return;
        delete l.entrevistas[tag]; save().then(function () { go('/lev/' + l.id + '/b/7'); });
      } })), h('nav', { class: 'bnav' },
      h('a', { class: 'btn sec', id: 'ent-voltar', href: '#/lev/' + l.id + '/b/7', text: 'Voltar ao bloco 7' }),
      (function () { var nx = tags.filter(function (t) { return !l.entrevistas[t]; })[0]; return nx ? h('a', { class: 'btn', id: 'ent-nova', href: '#/lev/' + l.id + '/ent/' + nx, text: 'Próxima: ' + nx }) : null; })())]);
    if (foco) setTimeout(function () { foca(foco); }, 50);
  }

  /* ---------- Finalizar ---------- */
  LV.pendencias = function (l, fotos, model) {
    var p = [], D = l.dados;
    function falta(key, msg) { var d = model.fields[key]; if (!D[key]) p.push({ bloco: d.block, key: key, msg: msg }); }
    falta('c1_02', 'Unidade: informe o nome (1.02)');
    falta('c1_18', 'Data da visita (1.18)'); falta('c1_19', 'Hora de chegada (1.19)'); falta('c1_20', 'Hora de saída (1.20)');
    falta('c1_23', 'Quem levantou: nome e ID (1.23)');
    Object.keys(D).forEach(function (k) {
      var d = model.fields[k]; if (!d) return;
      if (!LV.valid(d.kind, D[k])) p.push({ bloco: d.block, key: k, msg: d.code + (d.colLabel ? ' (' + d.colLabel + ')' : '') + ': formato inválido, ' + LV.fmtMsg[d.kind] });
    });
    if (D.c1_19 && D.c1_20 && LV.valid('time', D.c1_19) && LV.valid('time', D.c1_20) && D.c1_20 < D.c1_19) p.push({ bloco: '1', key: 'c1_20', msg: 'Hora de saída (1.20) anterior à hora de chegada (1.19)' });
    Object.keys(l.entrevistas || {}).forEach(function (t) {
      var g = model.ent[t.charAt(0)];
      g.fields.forEach(function (d) { var v = l.entrevistas[t][d.key]; if (!LV.valid(d.kind, v)) p.push({ bloco: '7', ent: t, key: d.key, msg: 'Entrevista ' + t + ', ' + d.code + ': formato inválido' }); });
    });
    fotos.forEach(function (f) { if (!f.revisada) p.push({ bloco: '9', key: undefined, cod: f.codigo, msg: 'Foto ' + f.codigo + ': cubra os rostos e conclua a edição' }); });
    return p;
  };
  function vFinalizar() {
    var l = S.cur;
    if (l.situacao !== 'rascunho') return go('/lev/' + l.id + '/resumo');
    var p = LV.pendencias(l, S.fotos, S.model);
    var porBloco = {}; p.forEach(function (x) { (porBloco[x.bloco] = porBloco[x.bloco] || []).push(x); });
    var lista = Object.keys(porBloco).sort(function (a, b) { return a - b; }).map(function (b) {
      return h('div', { class: 'card2' }, h('b', { text: S.model.blocks[b - 1].title }), porBloco[b].map(function (x) {
        var href = x.ent ? '#/lev/' + l.id + '/ent/' + x.ent + '?f=' + x.key : '#/lev/' + l.id + '/b/' + b + (x.key ? '?f=' + x.key : '');
        return h('div', { class: 'pend' }, h('span', { text: x.msg + ' ' }), h('a', { class: 'lk', href: href, text: 'Ir ao campo' }));
      }));
    });
    var tem = S.fotos.length > 0;
    var chk = h('input', { type: 'checkbox', id: 'chk-rostos' });
    var btn = h('button', { class: 'btn', id: 'btn-finalizar', text: 'Finalizar levantamento', disabled: p.length > 0 || tem, onclick: finaliza });
    chk.addEventListener('change', function () { btn.disabled = p.length > 0 || (tem && !chk.checked); });
    function finaliza() {
      l.situacao = 'finalizado'; l.finalizado_em = new Date().toISOString(); l.tentativas = 0; l.proxima_tentativa = null; l.ultimo_erro = '';
      LV.getConfig().then(function (c) { if (c.url && c.token) l.situacao = 'aguardando'; }).then(save).then(function () { go('/lev/' + l.id + '/resumo'); LV.enviarPendentes(true); });
    }
    render([topbar('Finalizar', '/lev/' + l.id + '/b/' + (l.bloco_atual || 1)), h('main', { class: 'wrap' },
      h('div', { class: 'card' }, h('h1', { text: 'Revisão final' }), h('p', { text: l.unidade.nome }),
        p.length ? h('p', { class: 'msg', id: 'npend', text: p.length + ' pendência(s) para resolver:' }) : h('p', { class: 'ok', id: 'npend', text: 'Sem pendências. Campos mínimos preenchidos e formatos válidos.' })),
      lista,
      tem ? h('label', { class: 'chk' }, chk, ' Confirmo que os rostos foram cobertos em todas as fotos.') : null, btn,
      h('a', { class: 'btn sec', href: '#/lev/' + l.id + '/b/' + (l.bloco_atual || 1), text: 'Voltar ao preenchimento' }))]);
  }

  /* ---------- Resumo / PDF / envio ---------- */
  function vResumo() {
    var l = S.cur;
    var info = h('p', { class: 'msg', id: 'rs-msg' });
    var mini = h('input', { type: 'checkbox', id: 'chk-mini', checked: true });
    function pdf(modo) {
      info.textContent = 'Gerando PDF...';
      LV.db.fotosDe(l.id).then(function (fs) {
        fs.sort(function (a, b) { return a.codigo < b.codigo ? -1 : 1; });
        return (mini.checked ? LV.prepararMiniaturas(fs) : Promise.resolve([])).then(function (th) {
          var map = {}; th.forEach(function (x) { map[x.codigo] = x.thumb; });
          var lst = fs.map(function (f) { return { codigo: f.codigo, thumb: map[f.codigo] }; });
          return LV.gerarPDF(l, S.model, lst, { fotos: mini.checked });
        });
      }).then(function (blob) {
        var nome = ((l.unidade.id || 'unidade') + ' Levantamento ' + (l.dados.c1_18 || '').replace(/\//g, '-')).replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_') + '.pdf';
        var file = new File([blob], nome, { type: 'application/pdf' });
        info.textContent = 'PDF gerado: ' + nome + ' (' + Math.round(blob.size / 1024) + ' KB)';
        if (modo === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: nome }).catch(function (e) { if (e && e.name !== 'AbortError') baixa(blob, nome); });
        }
        baixa(blob, nome);
      }).catch(function (e) { info.textContent = 'Erro ao gerar o PDF: ' + (e && e.message || e); });
    }
    function baixa(blob, nome) {
      var u = URL.createObjectURL(blob), a = h('a', { href: u, download: nome }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
    }
    var nf = S.fotos.length, ne = S.fotos.filter(function (f) { return f.enviada; }).length;
    render([topbar('Levantamento', '/'), h('main', { class: 'wrap' }, h('div', { class: 'card' },
      h('h1', { text: l.unidade.nome }), h('p', null, h('span', { class: 'st st-' + l.situacao, id: 'rs-status', text: STATUS[l.situacao] })),
      h('p', { class: 'hint', text: 'Visita ' + (l.dados.c1_18 || '') + ' | finalizado em ' + fmtDataHora(l.finalizado_em) + (l.enviado_em ? ' | enviado em ' + fmtDataHora(l.enviado_em) : '') }),
      h('p', { class: 'hint', text: 'ID ' + l.id }), h('p', { class: 'hint', text: 'Fotos: ' + ne + ' de ' + nf + ' enviadas' }),
      l.ultimo_erro && l.situacao !== 'enviado' ? h('p', { class: 'msg', text: 'Último erro de envio: ' + l.ultimo_erro + (l.proxima_tentativa ? ' (nova tentativa automática após ' + fmtDataHora(l.proxima_tentativa) + ')' : '') }) : null),
      h('div', { class: 'card' }, h('label', { class: 'chk' }, mini, ' Incluir miniaturas das fotos no PDF'),
        navigator.canShare ? h('button', { class: 'btn', id: 'btn-share', text: 'Compartilhar PDF', onclick: function () { pdf('share'); } }) : null,
        h('button', { class: navigator.canShare ? 'btn sec' : 'btn', id: 'btn-pdf', text: 'Baixar PDF', onclick: function () { pdf('down'); } }), info,
        h('p', { class: 'hint', text: 'Imprima o PDF, colete as assinaturas à mão (itens 10.11 e 10.13) e entregue à CGIS.' })),
      h('div', { class: 'card' }, l.situacao !== 'enviado' ? h('button', { class: 'btn', id: 'btn-enviar', text: 'Enviar agora', onclick: function () { enviarAgora(info); } }) : h('p', { class: 'ok', text: 'Recebido pelo servidor.' }),
        h('button', { class: 'btn sec', id: 'btn-reabrir', text: 'Reabrir para correção', onclick: function () {
          if (!confirm('Reabrir este levantamento para correção? Será preciso finalizar de novo.')) return;
          l.situacao = 'rascunho'; (l.reaberturas = l.reaberturas || []).push(new Date().toISOString()); l.proxima_tentativa = null; l.kit_aplicado = true;
          save().then(function () { go('/lev/' + l.id + '/b/1'); });
        } })),
      h('a', { class: 'btn sec', href: '#/', text: 'Voltar ao início' }),
      l.situacao === 'enviado' || true ? h('button', { class: 'btn danger', id: 'btn-apagar', text: 'Apagar do aparelho', onclick: function () {
        if (!confirm('Apagar este levantamento deste aparelho? ' + (l.situacao === 'enviado' ? '' : 'ELE AINDA NÃO FOI ENVIADO.'))) return;
        LV.db.delFotosDe(l.id).then(function () { return LV.db.delLev(l.id); }).then(function () { S.cur = null; go('/'); });
      } }) : null)]);
  }

  /* ---------- inicializacao ---------- */
  function carrega(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); }).then(function (t) { return JSON.parse(t.replace(/[\u2013\u2014]/g, '-')); });
  }
  function normUnidades(lst) {
    return (Array.isArray(lst) ? lst : (lst && lst.unidades) || []).filter(function (u) { return u && u.id && u.nome; }).map(function (u) {
      var o = Object.assign({}, u);
      ['tipo', 'municipio', 'endereco', 'horario', 'zona', 'conf'].forEach(function (k) { o[k] = o[k] === undefined || o[k] === null ? '' : String(o[k]); });
      ['servicos_site', 'postos'].forEach(function (k) { o[k] = Array.isArray(o[k]) ? o[k] : (o[k] ? [String(o[k])] : []); });
      o.listada = true; return o;
    });
  }
  function registraSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      S.swReg = reg;
      function aviso() { S.updPronto = true; var b = document.getElementById('upd'); if (b) b.hidden = false; }
      if (reg.waiting && navigator.serviceWorker.controller) aviso();
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) aviso(); });
      });
      setInterval(function () { reg.update().catch(function () {}); }, 3600000);
    }).catch(function () {});
    var recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (recarregou || !S.tinhaController) return; recarregou = true; location.reload(); });
    S.tinhaController = !!navigator.serviceWorker.controller;
  }
  function boot() {
    $app = document.getElementById('app');
    Promise.all([carrega('spec.json'), carrega('unidades_app.json'), LV.db.getMeta('perfil'), LV.db.getMeta('kit')]).then(function (a) {
      S.model = LV.buildModel(a[0]); S.unidades = normUnidades(a[1]); S.perfil = a[2] || null; S.kit = a[3] || null;
      window.LVAPP = S; // diagnostico e testes
      registraSW();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      window.addEventListener('hashchange', route);
      route(); LV.iniciaFila(); kitSilencioso();
      document.documentElement.setAttribute('data-pronto', '1');
    }).catch(function (e) {
      $app.textContent = 'Não foi possível iniciar o aplicativo: ' + e.message;
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
