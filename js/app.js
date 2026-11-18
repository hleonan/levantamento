/* Interface do aplicativo. Sem frameworks, sem CDN. */
(function () {
  var LV = window.LV;
  var S = { model: null, unidades: [], perfil: null, cur: null, fotos: [], saveTimer: null, urls: [], swReg: null };
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
        if (l.versao_instrumento !== S.model.spec.version) return vAnterior();
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
      if (S.cur && S.cur.situacao === 'rascunho' && S.cur.versao_instrumento === S.model.spec.version) LV.deriva(S.cur, S.fotos, S.model);
      return S.cur;
    });
  }
  function recarregaFotos() { return LV.db.fotosDe(S.cur.id).then(function (f) { S.fotos = f; }); }

  /* ---------- progresso ---------- */
  function blocoProg(b, l) {
    if (b.id === '7') {
      var M = S.model, n = LV.tagsRespondidas(l, M, 'E').length + LV.tagsRespondidas(l, M, 'S').length, t = M.ent.E.n + M.ent.S.n;
      return { f: Math.min(n, t), t: t, n: n };
    }
    var f = 0, t = 0;
    function cont(d) {
      if (d.calc || !LV.visivel(d, l.dados)) return;
      t++; var v = l.dados[d.key]; if (v !== undefined && v !== '') f++;
    }
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

  /* ---------- listas do servidor e utilidades ---------- */
  function listasSilencioso() {
    if (!navigator.onLine) return;
    LV.getConfig().then(function (c) { if (c.url && c.token) return LV.atualizaListas().then(function () { return LV.db.getMeta('listas'); }).then(function (l) { LV.aplicaListas(S.model, l); }); }).catch(function () {});
  }
  window.addEventListener('online', listasSilencioso);
  function usuarioTxt(perf) { return perf.nome + (perf.idf ? ', ID ' + perf.idf : ''); }
  function ctxOpc() { return { lists: S.model.lists, municipio: S.cur ? (S.cur.dados.c1_06 || (S.cur.unidade || {}).municipio || '') : '' }; }
  function campoCodigo(id, valor) {
    var el = h('input', { id: id, type: 'text', class: 'cod', autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX' });
    el.value = valor ? LV.fmtCodigo(valor) : '';
    el.addEventListener('input', function () {
      var v = el.value, pos = el.selectionStart === null ? v.length : el.selectionStart, f = LV.fmtCodigo(v);
      if (f === v) return;
      var antes = LV.normCodigo(v.slice(0, pos)).length, c = 0, i = 0;
      el.value = f;
      for (; i < f.length && c < antes; i++) if (/[A-Z0-9]/.test(f.charAt(i))) c++;
      try { el.setSelectionRange(i, i); } catch (e) {}
    });
    return el;
  }
  var MSG_RECUSADO = 'Código de acesso não reconhecido. Confira as letras e os números com a CGIS.';

  /* ---------- Identificacao ---------- */
  function vIdent() {
    LV.defaultConfig().then(function (def) {
      var nome = h('input', { id: 'in-nome', type: 'text', autocomplete: 'name', value: (S.perfil && S.perfil.nome) || '' });
      var idf = h('input', { id: 'in-idf', type: 'text', autocomplete: 'off', value: (S.perfil && S.perfil.idf) || '' });
      var perfil = h('select', { id: 'in-perfil' }, h('option', { value: 'Supervisor Regional', text: 'Supervisor Regional' }), h('option', { value: 'AVA', text: 'AVA (Agente de Verificação do Atendimento)' }));
      if (S.perfil) perfil.value = S.perfil.perfil;
      var cod = campoCodigo('in-codigo');
      var url = def.backend_url ? null : h('input', { id: 'in-url', type: 'url', placeholder: 'https://script.google.com/macros/s/.../exec', autocapitalize: 'off' });
      var msg = h('p', { class: 'msg', id: 'ident-msg' });
      var btn = h('button', { class: 'btn', id: 'btn-entrar', text: 'Entrar' });
      LV.getConfig().then(function (c) { if (!cod.value) cod.value = LV.fmtCodigo(c.token || ''); if (url && !url.value) url.value = c.url || ''; });
      function entrar() {
        if (!nome.value.trim()) { msg.textContent = 'Informe seu nome completo.'; return; }
        if (!LV.normCodigo(cod.value)) { msg.textContent = 'Informe o código de acesso fornecido pela CGIS.'; return; }
        var perf = { nome: nome.value.trim(), idf: idf.value.trim(), perfil: perfil.value };
        var cfg = { url: url ? url.value.trim() : '', token: LV.fmtCodigo(cod.value) };
        var teste = { url: cfg.url || def.backend_url || '', token: cfg.token };
        msg.textContent = 'Verificando...'; btn.disabled = true;
        var fim = function (estado, aviso) {
          cfg.estado_codigo = estado;
          return LV.db.setMeta('perfil', perf).then(function () { return LV.db.setMeta('config', cfg); }).then(function () {
            S.perfil = perf; if (aviso) toast(aviso, 5000); listasSilencioso(); go('/');
          });
        };
        if (!navigator.onLine) return fim('pendente');
        if (!teste.url) return fim('pendente', 'Endereço do servidor não informado: o envio ficará pendente.');
        LV.ping(teste).then(function (j) {
          if (j.token_valido === false) { msg.textContent = MSG_RECUSADO; btn.disabled = false; return; }
          return fim(j.token_valido === true ? 'ok' : 'pendente');
        }, function () { return fim('pendente'); });
      }
      btn.addEventListener('click', entrar);
      render([topbar('Primeiro acesso'), h('main', { class: 'wrap' },
        h('div', { class: 'card' },
          h('h1', { text: 'Identificação' }),
          h('p', { text: 'Estes dados ficam só neste aparelho e identificam quem fez o levantamento.' }),
          h('label', { for: 'in-nome', text: 'Seu nome completo' }), nome,
          h('label', { for: 'in-idf', text: 'ID funcional (se tiver)' }), idf,
          h('label', { for: 'in-perfil', text: 'Perfil' }), perfil,
          h('label', { for: 'in-codigo', text: 'Código de acesso (fornecido pela CGIS)' }), cod,
          url ? [h('label', { for: 'in-url', text: 'Endereço do servidor' }), url] : null,
          msg, btn))]);
    });
  }

  /* ---------- Configuracoes ---------- */
  function vConfig() {
    var url = h('input', { id: 'cf-url', type: 'url', autocapitalize: 'off', placeholder: 'https://script.google.com/macros/s/.../exec' });
    var cod = campoCodigo('cf-codigo');
    var nome = h('input', { id: 'cf-nome', type: 'text', value: S.perfil.nome });
    var idf = h('input', { id: 'cf-idf', type: 'text', autocomplete: 'off', value: S.perfil.idf || '' });
    var perfil = h('select', { id: 'cf-perfil' }, h('option', { value: 'Supervisor Regional', text: 'Supervisor Regional' }), h('option', { value: 'AVA', text: 'AVA' }));
    perfil.value = S.perfil.perfil;
    var msg = h('p', { class: 'msg', id: 'cf-msg' });
    var info = h('p', { class: 'hint', id: 'cf-listas' });
    function listasTxt() {
      LV.db.getMeta('listas').then(function (l) {
        var n = (S.model.lists.empresas || []).length;
        info.textContent = l && l.dados ? 'Lista de empresas: ' + n + ' item(ns), atualizada em ' + fmtDataHora(l.em) + '.' : 'Lista de empresas: a que vem no aplicativo (' + n + ' item(ns)).';
      });
    }
    LV.db.getMeta('config').then(function (c) { c = c || {}; url.value = c.url || ''; cod.value = LV.fmtCodigo(c.token || ''); });
    listasTxt();
    function salvar() {
      if (!LV.normCodigo(cod.value)) { msg.textContent = 'Informe o código de acesso.'; return; }
      var perf = { nome: nome.value.trim() || S.perfil.nome, idf: idf.value.trim(), perfil: perfil.value };
      var tk = LV.fmtCodigo(cod.value); cod.value = tk;
      msg.textContent = 'Salvando...';
      return LV.db.setMeta('perfil', perf).then(function () { S.perfil = perf; return LV.salvaConfig({ url: url.value.trim(), token: tk, estado_codigo: 'pendente' }); }).then(function () {
        if (!navigator.onLine) { msg.textContent = 'Salvo. O código será conferido quando houver internet.'; return; }
        msg.textContent = 'Salvo. Conferindo o código...';
        return LV.getConfig().then(function (c) { return LV.ping(c); }).then(function (j) {
          if (j.token_valido === false) { msg.textContent = MSG_RECUSADO; return LV.salvaConfig({ estado_codigo: 'recusado' }); }
          msg.textContent = 'Código de acesso reconhecido' + (j.nome ? ' (' + j.nome + ')' : '') + '. Configurações salvas.';
          return LV.salvaConfig({ estado_codigo: j.token_valido === true ? 'ok' : 'pendente' }).then(function () { listasSilencioso(); LV.enviarPendentes(true); });
        }, function () { msg.textContent = 'Salvo, mas não foi possível conferir agora. O código será conferido quando houver conexão.'; });
      });
    }
    render([topbar('Configurações', '/'), h('main', { class: 'wrap' }, h('div', { class: 'card' },
      h('label', { for: 'cf-nome', text: 'Nome completo' }), nome,
      h('label', { for: 'cf-idf', text: 'ID funcional (se tiver)' }), idf,
      h('label', { for: 'cf-perfil', text: 'Perfil' }), perfil,
      h('label', { for: 'cf-codigo', text: 'Código de acesso' }), cod, msg,
      h('button', { class: 'btn', id: 'cf-salvar', text: 'Salvar e conferir', onclick: salvar }),
      h('button', { class: 'btn sec', id: 'cf-listas-btn', text: 'Atualizar listas', onclick: function () {
        msg.textContent = 'Baixando listas...';
        LV.atualizaListas().then(function () { return LV.db.getMeta('listas'); }).then(function (l) { LV.aplicaListas(S.model, l); msg.textContent = 'Listas atualizadas.'; listasTxt(); })
          .catch(function (e) { msg.textContent = LV.msgErro(e && e.codigo || (e && e.message)) || 'Não foi possível atualizar as listas.'; });
      } }), info,
      h('details', { class: 'grp' }, h('summary', { text: 'Avançado' }),
        h('label', { for: 'cf-url', text: 'Endereço do servidor (deixe em branco para usar o do aplicativo)' }), url),
      h('p', { class: 'hint', text: 'Versão do aplicativo ' + LV.APP_VERSION + ' | instrumento ' + S.model.spec.version + ' | lista de unidades: ' + S.unidades.length + ' unidade(s).' })))]);
  }

  /* ---------- Ajuda ---------- */
  function vAjuda() {
    var sp = S.model.spec;
    render([topbar('Ajuda', '/'), h('main', { class: 'wrap' },
      h('div', { class: 'card' }, h('h1', { text: sp.howto.title }), sp.howto.items.map(function (i) { return h('p', null, h('b', { text: i[0] + ': ' }), LV.clean(i[1])); })),
      h('div', { class: 'card' }, h('h1', { text: 'Regras de conduta' }), sp.intro.rules.map(function (i) { return h('p', null, h('b', { text: i[0] + ': ' }), LV.clean(i[1])); })),
      h('div', { class: 'card' }, h('h1', { text: 'Neste aplicativo' }),
        h('p', { text: 'Tudo é salvo no aparelho a cada alteração. Sem internet, o levantamento e o PDF funcionam normalmente; o envio acontece sozinho quando a conexão voltar. O aplicativo grava as horas, soma os totais e calcula a espera pelas entrevistas: não precisa preencher. Algumas perguntas só aparecem conforme a resposta anterior. Nunca registre nome, documento, CPF ou placa de quem é atendido. Cubra os rostos nas fotos antes de finalizar. O código de acesso pode ser digitado em maiúsculas ou minúsculas, com ou sem hífen.' })))]);
  }

  /* ---------- Home ---------- */
  function faixaCodigo(c) {
    if (c.estado_codigo === 'recusado') return h('a', { class: 'faixa verm', id: 'faixa-recusado', href: '#/config', text: 'Código de acesso recusado pelo servidor. Toque aqui para corrigir.' });
    if (c.estado_codigo === 'pendente') return h('div', { class: 'faixa amar', id: 'faixa-pendente', text: 'Código de acesso ainda não conferido. Será conferido quando houver internet.' });
    return null;
  }
  function vHome() {
    Promise.all([LV.db.allLev(), LV.getConfig()]).then(function (a) {
      var ls = a[0], cfg = a[1];
      ls.sort(function (a, b) { return (b.criado_em || '') < (a.criado_em || '') ? -1 : 1; });
      var pend = ls.filter(function (l) { return l.situacao === 'finalizado' || l.situacao === 'aguardando'; }).length;
      var info = h('p', { class: 'msg', id: 'home-msg' });
      var cards = ls.length ? ls.map(function (l) {
        var st = l.situacao, atual = l.versao_instrumento === S.model.spec.version;
        return h('a', { class: 'lev', href: '#/lev/' + l.id, 'data-id': l.id },
          h('div', { class: 'lt' }, h('b', { text: l.unidade.nome || '(sem nome)' }), h('span', { class: 'st st-' + st, text: STATUS[st] })),
          h('div', { class: 'hint', text: (l.unidade.municipio || '') + (l.dados.c1_18 ? ' | visita ' + l.dados.c1_18 : '') + (atual ? '' : ' | versão anterior') }),
          st === 'rascunho' && atual ? [barra(progTotal(l)), h('div', { class: 'hint', text: progTotal(l) + '% preenchido' })] : null,
          st === 'aguardando' && l.ultimo_erro ? h('div', { class: 'hint', text: 'Último erro: ' + LV.msgErro(l.ultimo_erro) }) : null);
      }) : h('p', { class: 'hint', text: 'Nenhum levantamento neste aparelho ainda.' });
      render([topbar('Levantamentos'), h('main', { class: 'wrap' },
        h('div', { id: 'upd', class: 'upd', hidden: true }, h('span', { text: 'Nova versão do aplicativo pronta. ' }), h('button', { class: 'btn sm', id: 'btn-upd', text: 'Atualizar', onclick: atualizaApp })),
        faixaCodigo(cfg),
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
      var e = LV.msgErro(r.erro);
      if (info) info.textContent = r.enviados ? r.enviados + ' enviado(s).' + (r.falhas ? ' ' + r.falhas + ' com falha: ' + e : '') : (r.erro ? 'Não enviado: ' + e : 'Nada a enviar.');
      toast(r.enviados ? 'Enviado com sucesso.' : (r.erro ? 'Não enviado: ' + e : 'Nada a enviar.'), 5000);
      if ((location.hash || '#/') === '#/') vHomeSoft(); /* atualiza lista e faixas depois do envio */
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
    var M = S.model, d = {};
    var auto = {
      unidade_id: u.listada === false ? '' : u.id, unidade_nome: u.nome, unidade_municipio: u.municipio, hoje: LV.hojeBr(), agora: LV.agoraHora(), usuario: usuarioTxt(S.perfil),
      unidade_tipo: function (k) { return LV.mapTipo(u.tipo, u.nome, M.fields[k].opts) || (u.listada === false ? u.tipo : ''); }
    };
    Object.keys(auto).forEach(function (nome) {
      (M.auto[nome] || []).forEach(function (k) { var v = typeof auto[nome] === 'function' ? auto[nome](k) : auto[nome]; if (v) d[k] = v; });
    });
    if (u.listada === false) { d.c1_10 = 'Não'; d.c1_11 = u.endereco; }
    var l = { id: LV.uuid(), versao_instrumento: M.spec.version, versao_app: LV.APP_VERSION, unidade: u, levantado_por: S.perfil.nome, perfil: S.perfil.perfil,
      situacao: 'rascunho', criado_em: new Date().toISOString(), dados: d, entrevistas: {}, reaberturas: [], bloco_atual: 1 };
    LV.deriva(l, [], M);
    LV.db.putLev(l).then(function () { S.cur = l; S.fotos = []; go('/lev/' + l.id + '/b/1'); });
  }

  /* ---------- Campos ---------- */
  function inputFor(d, val, attrs) {
    var a = { 'data-key': d.key, id: 'f-' + d.key + (attrs && attrs.sfx || '') };
    var el;
    val = val === undefined ? '' : val;
    if (d.kind === 'sel') {
      var ops = LV.opcoes(d, ctxOpc());
      el = h('select', a, h('option', { value: '', text: 'Selecione' }), ops.map(function (o) { return h('option', { value: o, text: o }); }));
      if (val && ops.indexOf(val) < 0) el.appendChild(h('option', { value: val, text: val }));
      el.value = val;
    } else if (d.kind === 'multi') {
      var ops2 = LV.opcoes(d, ctxOpc()), marc = String(val).split('; ').filter(Boolean);
      marc.forEach(function (m) { if (ops2.indexOf(m) < 0) ops2.push(m); });
      el = h('div', { 'data-key': d.key, id: a.id, class: 'multi', role: 'group' }, ops2.map(function (o) {
        return h('label', { class: 'mchk' }, h('input', { type: 'checkbox', value: o, 'data-mk': d.key, checked: marc.indexOf(o) >= 0 }), ' ' + o);
      }));
    } else if (d.kind === 'long') { el = h('textarea', a); el.value = val; el.rows = 3; }
    else if (d.kind === 'num') { el = h('input', Object.assign({ type: 'number', inputmode: 'numeric', min: '0', step: '1', pattern: '[0-9]*' }, a)); el.value = val; }
    else if (d.kind === 'date') { el = h('input', Object.assign({ type: 'date' }, a)); el.value = LV.brToIso(val); }
    else if (d.kind === 'time') { el = h('input', Object.assign({ type: 'time' }, a)); el.value = val; }
    else { el = h('input', Object.assign({ type: 'text', autocomplete: 'off' }, a)); el.value = val; }
    return el;
  }
  function fmtBox(d, val) {
    if (d.kind !== 'date' && d.kind !== 'time') return null;
    var ph = d.kind === 'date' ? 'dd/mm/aaaa' : 'hh:mm';
    return h('small', { class: 'fmtshow', 'data-for': d.key, 'data-ph': ph, text: val ? 'Registrado: ' + val : ph });
  }
  /* texto de um campo calculado (so leitura) */
  function txtCalc(d, store) {
    var v = store && store[d.key], un = /^(espera|permanencia)/.test(d.calc || '') ? ' min' : '';
    if (d.colLabel) return d.colLabel + ': ' + (v === undefined || v === '' ? '-' : v);
    return v === undefined || v === '' ? 'ainda sem dados' : v + un;
  }
  function calcNode(d, store) {
    return h('div', { class: 'calcval', 'data-calc': d.key, id: 'f-' + d.key, text: txtCalc(d, store) });
  }
  function celula(d, val, extraLabel, store) {
    var box = h('div', { class: 'field' + (d.kind === 'long' ? ' wide' : '') + (d.kind === 'text' ? ' wide' : '') + (d.calc ? ' calcf' : ''), 'data-fk': d.key });
    if (d.when) { box.setAttribute('data-when', d.key); if (!LV.visivel(d, store)) box.hidden = true; }
    if (d.calc) { box.appendChild(calcNode(d, store)); return box; }
    var campo = inputFor(d, val);
    var lbl = extraLabel ? h('label', { for: campo.id, text: extraLabel }) : null;
    add(box, [lbl, campo, fmtBox(d, val)]);
    if (d.kind === 'time') box.appendChild(h('button', { type: 'button', class: 'now', 'data-now': d.key, text: 'Agora' }));
    return box;
  }
  function campoLinha(d, val, store) {
    store = store || S.cur.dados;
    var row;
    if (d.cgis) row = h('div', { class: 'row' }, h('div', { class: 'lab' }, h('b', { text: d.code }), ' ' + d.label), h('div', { class: 'cgis', text: LV.CGIS_TXT }));
    else if (d.kind === 'sig') row = h('div', { class: 'row' }, h('div', { class: 'lab' }, h('b', { text: d.code }), ' ' + d.label), h('div', { class: 'cgis', text: 'Assinatura à mão no PDF impresso' }));
    else {
      var c = celula(d, val, null, store), campo = c.querySelector('[data-key]');
      var rot = campo && /^(INPUT|SELECT|TEXTAREA)$/.test(campo.tagName);
      var lab = h(rot ? 'label' : 'div', { class: 'lab', for: rot ? campo.id : null }, h('b', { text: d.code }), ' ' + d.label);
      row = h('div', { class: 'row' }, lab, d.hint ? h('div', { class: 'hint rhint', text: LV.clean(d.hint) }) : null, c);
      c.removeAttribute('data-when'); c.hidden = false;
    }
    if (d.when) { row.setAttribute('data-when', d.key); if (!LV.visivel(d, store)) row.hidden = true; }
    return row;
  }

  /* trata qualquer alteracao dentro de um container.
     getStore(criar) devolve o objeto onde gravar (ou null se ainda nao existe e criar e falso). */
  function ligaCampos(cont, getStore, onchange) {
    function defDe(key) { return S.model.fields[key] || (cont._defs && cont._defs[key]); }
    function aplica(el) {
      var key = el.getAttribute('data-key') || el.getAttribute('data-mk'); if (!key) return;
      var d = defDe(key); var kind = d ? d.kind : 'text';
      var v = el.value;
      if (el.type === 'checkbox') {
        v = Array.prototype.filter.call(el.closest('[data-key]').querySelectorAll('input[type=checkbox]'), function (c) { return c.checked; }).map(function (c) { return c.value; }).join('; ');
      }
      if (kind === 'date') v = LV.isoToBr(v);
      if (kind === 'num') v = el.validity && el.validity.badInput ? 'inválido' : v.trim();
      var st = getStore(v !== '');
      if (st) st[key] = v;
      var fb = cont.querySelector('.fmtshow[data-for="' + key + '"]');
      if (fb) fb.textContent = v ? 'Registrado: ' + v : fb.getAttribute('data-ph');
      var bad = !LV.valid(kind, v); el.classList.toggle('err', bad);
      var fld = el.closest('.field'); var em = fld && fld.querySelector('.errmsg');
      if (bad) { if (!em && fld) fld.appendChild(h('div', { class: 'errmsg', text: 'Formato inválido: ' + LV.fmtMsg[kind] })); } else if (em) em.remove();
      if ((kind === 'text' || kind === 'long') && LV.pareceDadoPessoal(v)) toast('Atenção: parece CPF ou placa. Não registre dado de quem é atendido.', 6000);
      if (onchange) onchange(key, v);
      LV.deriva(S.cur, S.fotos, S.model);
      sincroniza(cont, getStore(false) || {}, defDe);
      mark();
    }
    cont.addEventListener('input', function (e) { if (e.target.matches('input,textarea') && e.target.type !== 'checkbox') aplica(e.target); });
    cont.addEventListener('change', function (e) { if (e.target.matches('select,input,textarea')) aplica(e.target); });
    cont.addEventListener('click', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-now'); if (!k) return;
      var el = cont.querySelector('[data-key="' + k + '"]'); el.value = LV.agoraHora(); aplica(el);
    });
    cont._sync = function () { sincroniza(cont, getStore(false) || {}, defDe); };
  }
  /* mostra, esconde e atualiza no lugar, sem redesenhar (nao perde foco nem teclado) */
  function sincroniza(cont, store, defDe) {
    Array.prototype.forEach.call(cont.querySelectorAll('[data-when]'), function (el) {
      var d = defDe(el.getAttribute('data-when')); if (!d) return;
      var vis = LV.visivel(d, store);
      if (el.hidden === vis) {
        el.hidden = !vis;
        if (!vis) {
          Array.prototype.forEach.call(el.querySelectorAll('input,select,textarea'), function (i) { if (i.type === 'checkbox') i.checked = false; else i.value = ''; i.classList.remove('err'); });
          Array.prototype.forEach.call(el.querySelectorAll('.errmsg'), function (x) { x.remove(); });
          Array.prototype.forEach.call(el.querySelectorAll('.fmtshow'), function (x) { x.textContent = x.getAttribute('data-ph'); });
        }
      }
    });
    Array.prototype.forEach.call(cont.querySelectorAll('[data-calc]'), function (el) {
      var d = defDe(el.getAttribute('data-calc')); if (!d) return;
      var st = d.ent ? store : S.cur.dados;
      el.textContent = txtCalc(d, st);
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
      var alvo = body;
      if ((it.type === 'fields' || it.type === 'grid') && it.recolhido) {
        alvo = h('details', { class: 'grp' }, h('summary', { text: it.subtitle }), it.nota ? h('p', { class: 'hint', text: LV.clean(it.nota) }) : null);
        body.appendChild(alvo);
      } else if (it.subtitle) {
        body.appendChild(h('h3', { text: it.subtitle }));
        if (it.nota) body.appendChild(h('p', { class: 'hint', text: LV.clean(it.nota) }));
      }
      if (it.type === 'fields') {
        it.rows.forEach(function (d) {
          if (d.kind === 'foto' || d.kind === 'fotos') alvo.appendChild(n9linha(d));
          else alvo.appendChild(campoLinha(d, l.dados[d.key]));
        });
      } else if (it.type === 'grid') {
        it.rows.forEach(function (r) {
          if (r.cgis) { alvo.appendChild(h('div', { class: 'row card2' }, h('div', { class: 'lab' }, h('b', { text: r.code }), ' ' + r.label), h('div', { class: 'cgis', text: LV.CGIS_TXT }))); return; }
          alvo.appendChild(h('div', { class: 'row card2' }, h('div', { class: 'lab' }, h('b', { text: r.code }), ' ' + r.label), r.hint ? h('div', { class: 'hint rhint', text: LV.clean(r.hint) }) : null,
            h('div', { class: 'cells' }, r.cells.map(function (d) { return celula(d, l.dados[d.key], d.colLabel, l.dados); }))));
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
    ligaCampos(body, function () { return S.cur.dados; }, function (key, v) {
      var ak = M.apc[key];
      if (ak && v !== '' && !S.cur.dados[ak]) {
        var hora = LV.agoraHora(); S.cur.dados[ak] = hora;
        var inp = body.querySelector('[data-key="' + ak + '"]'); if (inp) inp.value = hora;
        var fb = body.querySelector('.fmtshow[data-for="' + ak + '"]'); if (fb) fb.textContent = 'Registrado: ' + hora;
      }
    });
    var ant = n > 1 ? h('a', { class: 'btn sec', id: 'btn-ant', href: '#/lev/' + l.id + '/b/' + (n - 1), text: 'Anterior' }) : h('a', { class: 'btn sec', href: '#/', text: 'Início' });
    var prox = n < M.blocks.length ? h('a', { class: 'btn', id: 'btn-prox', href: '#/lev/' + l.id + '/b/' + (n + 1), text: 'Próximo' }) : h('a', { class: 'btn', id: 'btn-rev', href: '#/lev/' + l.id + '/finalizar', text: 'Revisar e finalizar' });
    render([topbar(l.unidade.nome, '/'), h('main', { class: 'wrap' },
      h('div', { class: 'bhead' }, sel, barra(progTotal(l)), h('div', { class: 'hint' }, h('span', { text: 'Bloco ' + n + ' de ' + M.blocks.length + ' | ' + progTotal(l) + '% do levantamento | ' }), h('span', { id: 'saveind', text: 'Salvo' }))),
      body), h('nav', { class: 'bnav' }, ant, prox)]);
    if (foco) setTimeout(function () { foca(foco); }, 50);
  }
  function foca(key) {
    var el = document.querySelector('[data-key="' + key + '"]'); if (!el) return;
    var dt = el.closest('details'); if (dt) dt.open = true;
    el.scrollIntoView({ block: 'center' });
    (el.matches('input,select,textarea') ? el : (el.querySelector('input') || el)).focus({ preventScroll: true });
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
  function rotuloFoto(d) { return [h('div', { class: 'lab' }, h('b', { text: d.code }), ' ' + d.label), d.hint ? h('div', { class: 'hint rhint', text: LV.clean(d.hint) }) : null]; }
  function n9linha(d) {
    if (d.kind === 'fotos') return n9extra(d);
    var f = fotoDe(d.code), l = S.cur;
    var area = h('div', { class: 'fotoarea', 'data-foto': d.code });
    if (f) {
      add(area, [thumbEl(f), h('div', { class: 'hint', text: f.revisada ? 'Rostos conferidos' + (f.cobertas ? ' (' + f.cobertas + ' área(s) coberta(s))' : '') : 'ATENÇÃO: cubra os rostos e conclua.' }),
        h('div', { class: 'fb' }, h('button', { class: 'btn sm sec', text: 'Cobrir rostos', onclick: function () { reedita(f); } }),
          h('button', { class: 'btn sm sec', text: 'Remover', onclick: function () { removeFoto(f); } }))]);
    }
    area.appendChild(botaoFoto(d.code, f ? 'Refazer foto' : 'Tirar foto'));
    return h('div', { class: 'row', 'data-fk': d.key }, rotuloFoto(d), h('div', { class: 'hint fstat', id: 'f-' + d.key, 'data-calc': d.key, text: l.dados[d.key] || 'Não feita' }), area);
  }
  function n9extra(d) {
    var l = S.cur, pref = d.code;
    var fs = S.fotos.filter(function (f) { return f.codigo.indexOf(pref + '-') === 0; }).sort(function (a, b) { return a.codigo < b.codigo ? -1 : 1; });
    var area = h('div', { class: 'fotoarea', 'data-foto': pref }, fs.map(function (f) {
      return h('div', { class: 'fx' }, thumbEl(f), h('div', { class: 'hint', text: f.codigo + (f.revisada ? ' | rostos conferidos' : ' | cubra os rostos') }),
        h('div', { class: 'fb' }, h('button', { class: 'btn sm sec', text: 'Cobrir rostos', onclick: function () { reedita(f); } }), h('button', { class: 'btn sm sec', text: 'Remover', onclick: function () { removeFoto(f); } })));
    }));
    var prox = 1; while (fotoDe(pref + '-' + prox)) prox++;
    area.appendChild(botaoFoto(pref + '-' + prox, 'Adicionar foto'));
    return h('div', { class: 'row', 'data-fk': d.key }, rotuloFoto(d), h('div', { class: 'hint fstat', id: 'f-' + d.key, text: fs.length + ' foto(s)' }), area);
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
      return (velha ? LV.db.delFoto(velha.fid) : Promise.resolve()).then(function () { return LV.db.putFoto(rec); }).then(function () { return recarregaFotos(); }).then(function () { acertaCamposFoto(); });
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
    LV.db.delFoto(f.fid).then(recarregaFotos).then(function () { acertaCamposFoto(); });
  }
  function acertaCamposFoto() {
    LV.deriva(S.cur, S.fotos, S.model);
    save().then(function () { vBloco(9); });
  }

  /* ---------- Entrevistas (bloco 7) ---------- */
  function tagsDe(prefix) { var g = S.model.ent[prefix], t = []; for (var i = 1; i <= g.n; i++) t.push(prefix + ('0' + i).slice(-2)); return t; }
  function painelEntrevistas(prefix) {
    var g = S.model.ent[prefix], l = S.cur;
    var tags = tagsDe(prefix), feitas = LV.tagsRespondidas(l, S.model, prefix);
    var livre = tags.filter(function (t) { return feitas.indexOf(t) < 0; })[0];
    var e = LV.esperas(l, S.model), txt = null;
    function plural(n) { return n + (n === 1 ? ' entrevista' : ' entrevistas'); }
    if (prefix === 'E' && e.fila.n) txt = 'Espera média na fila até agora: ' + e.fila.media + ' min (' + plural(e.fila.n) + ')';
    if (prefix === 'S' && e.saida.n) txt = 'Tempo médio da chegada à saída até agora: ' + e.saida.media + ' min (' + plural(e.saida.n) + ')';
    return h('div', { class: 'card2 ents', 'data-prefix': prefix },
      h('b', { text: g.subtitle + ' (' + feitas.length + ' de ' + g.n + ')' }), g.intro ? h('p', { class: 'hint', text: LV.clean(g.intro) }) : null,
      h('p', { class: 'aviso', text: 'Nunca peça nem registre nome, documento, CPF ou placa de quem é atendido.' }),
      txt ? h('p', { class: 'calcinfo', id: 'espera-' + prefix, text: txt }) : null,
      h('div', { class: 'chips' }, feitas.map(function (t) { return h('a', { class: 'chip', href: '#/lev/' + l.id + '/ent/' + t, 'data-tag': t, text: t }); })),
      livre ? h('a', { class: 'btn sm', id: 'add-' + prefix, href: '#/lev/' + l.id + '/ent/' + livre, text: 'Nova entrevista ' + livre }) : h('p', { class: 'hint', text: 'Limite de entrevistas atingido.' }));
  }
  function vEntrevista(tag, foco) {
    var l = S.cur, prefix = tag && tag.charAt(0), g = S.model.ent[prefix];
    var num = +String(tag).slice(1);
    if (!g || !(num >= 1 && num <= g.n)) return go('/lev/' + l.id + '/b/7');
    if (l.situacao !== 'rascunho') return go('/lev/' + l.id + '/resumo');
    var body = h('div', { class: 'blk', id: 'blk-ent' }, h('p', { class: 'aviso', text: 'Nunca peça nem registre nome, documento, CPF ou placa de quem é atendido.' }),
      g.fields.map(function (d) { return campoLinha(d, (l.entrevistas[tag] || {})[d.key], l.entrevistas[tag] || {}); }));
    body._defs = g.defs;
    /* o registro so nasce na primeira resposta; nesse momento os campos auto 'agora' recebem a hora */
    ligaCampos(body, function (criar) {
      if (!l.entrevistas[tag]) {
        if (!criar) return null;
        var E = l.entrevistas[tag] = {}, hora = LV.agoraHora();
        g.fields.forEach(function (d) {
          if (d.auto !== 'agora') return;
          E[d.key] = hora;
          var inp = body.querySelector('[data-key="' + d.key + '"]'); if (inp) inp.value = hora;
          var fb = body.querySelector('.fmtshow[data-for="' + d.key + '"]'); if (fb) fb.textContent = 'Registrado: ' + hora;
        });
      }
      return l.entrevistas[tag];
    });
    var tags = tagsDe(prefix);
    render([topbar('Entrevista ' + tag, '/lev/' + l.id + '/b/7'), h('main', { class: 'wrap' },
      h('div', { class: 'bhead' }, h('h1', { text: (prefix === 'E' ? 'Na fila: ' : 'Na saída: ') + tag }), h('div', { class: 'hint' }, h('span', { id: 'saveind', text: 'Salvo' }))), body,
      h('button', { class: 'btn sec', id: 'ent-del', text: 'Excluir esta entrevista', onclick: function () {
        if (!confirm('Excluir a entrevista ' + tag + '?')) return;
        delete l.entrevistas[tag]; LV.deriva(l, S.fotos, S.model); save().then(function () { go('/lev/' + l.id + '/b/7'); });
      } })), h('nav', { class: 'bnav' },
      h('a', { class: 'btn sec', id: 'ent-voltar', href: '#/lev/' + l.id + '/b/7', text: 'Voltar ao bloco 7' }),
      (function () {
        var vazias = tags.filter(function (t) { return t !== tag && !LV.entrevistaRespondida(S.model, prefix, l.entrevistas[t]); });
        var nx = vazias.filter(function (t) { return t > tag; })[0] || vazias[0];
        return nx ? h('a', { class: 'btn', id: 'ent-nova', href: '#/lev/' + l.id + '/ent/' + nx, text: 'Próxima: ' + nx }) : null;
      })())]);
    if (foco) setTimeout(function () { foca(foco); }, 50);
  }

  /* ---------- Finalizar ---------- */
  function numOuNull(v) { return /^\d+$/.test(String(v === undefined || v === null ? '' : v).trim()) ? +String(v).trim() : null; }
  LV.pendencias = function (l, fotos, model) {
    var p = [], D = l.dados;
    function falta(key, msg) { var d = model.fields[key]; if (!D[key]) p.push({ bloco: d.block, key: key, msg: msg }); }
    falta('c1_02', 'Unidade: informe o nome (1.02)');
    falta('c1_18', 'Data da visita (1.18)'); falta('c1_19', 'Hora de chegada (1.19)');
    falta('c1_23', 'Quem levantou: nome e ID (1.23)');
    Object.keys(D).forEach(function (k) {
      var d = model.fields[k]; if (!d) return;
      if (!LV.valid(d.kind, D[k])) p.push({ bloco: d.block, key: k, msg: d.code + (d.colLabel ? ' (' + d.colLabel + ')' : '') + ': formato inválido, ' + LV.fmtMsg[d.kind] });
    });
    if (D.c1_19 && D.c1_20 && LV.valid('time', D.c1_19) && LV.valid('time', D.c1_20) && D.c1_20 < D.c1_19) p.push({ bloco: '1', key: 'c1_20', msg: 'Hora de saída (1.20) anterior à hora de chegada (1.19)' });
    Object.keys(l.entrevistas || {}).forEach(function (t) {
      var g = model.ent[t.charAt(0)]; if (!g) return;
      g.fields.forEach(function (d) { var v = l.entrevistas[t][d.key]; if (!LV.valid(d.kind, v)) p.push({ bloco: '7', ent: t, key: d.key, msg: 'Entrevista ' + t + ', ' + d.code + ': formato inválido' }); });
    });
    fotos.forEach(function (f) { if (!f.revisada) p.push({ bloco: '9', key: undefined, cod: f.codigo, msg: 'Foto ' + f.codigo + ': cubra os rostos e conclua a edição' }); });
    return p;
  };
  /* avisos: aparecem na revisao, mas nao impedem finalizar */
  LV.avisos = function (l, fotos, model) {
    var a = [], D = l.dados;
    var c6 = numOuNull(D.c6_06), c3 = numOuNull(D.c3_01_c1);
    if (c6 !== null && c3 !== null && c6 > c3) a.push({ bloco: '6', key: 'c6_06', msg: 'Guichês atendendo (6.06) em número maior que o total de guichês (3.01).' });
    model.blocks.forEach(function (b) {
      if (b.id !== '4') return;
      b.items.forEach(function (it) {
        if (it.type !== 'grid') return;
        it.rows.forEach(function (r) {
          if (r.soma_de) return;
          var pr = null, at = null;
          r.cells.forEach(function (d) { if (d.colLabel === 'Presentes') pr = d; if (d.colLabel === 'Atendendo') at = d; });
          if (!pr || !at) return;
          var vp = numOuNull(D[pr.key]), va = numOuNull(D[at.key]);
          if (vp !== null && va !== null && va > vp) a.push({ bloco: '4', key: at.key, msg: 'Item ' + r.code + ': atendendo em número maior que presentes.' });
        });
      });
    });
    var nE = LV.tagsRespondidas(l, model, 'E').length;
    if (nE < 5) a.push({ bloco: '7', key: null, msg: 'Menos de 5 entrevistas na fila: as cores de Fila e de Resolução ficam "Sem amostra".' });
    var sem = [];
    (model.calcs.foto_feita || []).forEach(function (k) { if (D[k] !== 'Feita') sem.push(model.fields[k].code); });
    if (sem.length) a.push({ bloco: '9', key: null, msg: 'Fotos obrigatórias não feitas: ' + sem.join(', ') + '.' });
    ['E', 'S'].forEach(function (pre) {
      var ka = pre === 'E' ? 'c7_01' : 'c7_10', kb = pre === 'E' ? 'c7_17' : 'c7_11';
      LV.tagsRespondidas(l, model, pre).forEach(function (t) {
        var E = l.entrevistas[t], x = LV.minutos(E[ka]), y = LV.minutos(E[kb]);
        if (x !== null && y !== null && x > y) a.push({ bloco: '7', ent: t, key: ka, msg: 'Entrevista ' + t + ': hora de chegada posterior à hora ' + (pre === 'E' ? 'da entrevista.' : 'da saída.') });
      });
    });
    if (['c6_02', 'c6_03', 'c6_04', 'c6_05', 'c6_06'].every(function (k) { return D[k] === undefined || D[k] === ''; })) a.push({ bloco: '6', key: 'c6_02', msg: 'A fila não foi contada (Bloco 6).' });
    return a;
  };
  function vFinalizar() {
    var l = S.cur;
    if (l.situacao !== 'rascunho') return go('/lev/' + l.id + '/resumo');
    LV.deriva(l, S.fotos, S.model);
    var p = LV.pendencias(l, S.fotos, S.model), av = LV.avisos(l, S.fotos, S.model);
    function href(x) { return x.ent ? '#/lev/' + l.id + '/ent/' + x.ent + '?f=' + x.key : '#/lev/' + l.id + '/b/' + x.bloco + (x.key ? '?f=' + x.key : ''); }
    var porBloco = {}; p.forEach(function (x) { (porBloco[x.bloco] = porBloco[x.bloco] || []).push(x); });
    var lista = Object.keys(porBloco).sort(function (a, b) { return a - b; }).map(function (b) {
      return h('div', { class: 'card2' }, h('b', { text: S.model.blocks[b - 1].title }), porBloco[b].map(function (x) {
        return h('div', { class: 'pend' }, h('span', { text: x.msg + ' ' }), h('a', { class: 'lk', href: href(x), text: 'Ir ao campo' }));
      }));
    });
    var listaAv = av.length ? h('div', { class: 'card2', id: 'avisos' }, h('b', { text: 'Avisos (não impedem finalizar)' }), av.map(function (x) {
      return h('div', { class: 'pend aviso-i' }, h('span', { text: x.msg + ' ' }), h('a', { class: 'lk', href: href(x), text: 'Ir ao campo' }));
    })) : null;
    var tem = S.fotos.length > 0;
    var chk = h('input', { type: 'checkbox', id: 'chk-rostos' });
    var btn = h('button', { class: 'btn', id: 'btn-finalizar', text: 'Finalizar levantamento', disabled: p.length > 0 || tem, onclick: finaliza });
    chk.addEventListener('change', function () { btn.disabled = p.length > 0 || (tem && !chk.checked); });
    function finaliza() {
      if (!l.dados.c1_20) l.dados.c1_20 = LV.agoraHora();
      LV.deriva(l, S.fotos, S.model);
      l.situacao = 'finalizado'; l.finalizado_em = new Date().toISOString(); l.tentativas = 0; l.proxima_tentativa = null; l.ultimo_erro = '';
      LV.getConfig().then(function (c) { if (c.url && c.token) l.situacao = 'aguardando'; }).then(save).then(function () { go('/lev/' + l.id + '/resumo'); LV.enviarPendentes(true); });
    }
    render([topbar('Finalizar', '/lev/' + l.id + '/b/' + (l.bloco_atual || 1)), h('main', { class: 'wrap' },
      h('div', { class: 'card' }, h('h1', { text: 'Revisão final' }), h('p', { text: l.unidade.nome }),
        p.length ? h('p', { class: 'msg', id: 'npend', text: p.length + ' pendência(s) para resolver:' }) : h('p', { class: 'ok', id: 'npend', text: 'Sem pendências. Campos mínimos preenchidos e formatos válidos.' })),
      lista, listaAv,
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
      l.ultimo_erro && l.situacao !== 'enviado' ? h('p', { class: 'msg', id: 'rs-erro', text: 'Último erro de envio: ' + LV.msgErro(l.ultimo_erro) + (l.proxima_tentativa ? ' (nova tentativa automática após ' + fmtDataHora(l.proxima_tentativa) + ')' : '') }) : null),
      h('div', { class: 'card' }, h('label', { class: 'chk' }, mini, ' Incluir miniaturas das fotos no PDF'),
        navigator.canShare ? h('button', { class: 'btn', id: 'btn-share', text: 'Compartilhar PDF', onclick: function () { pdf('share'); } }) : null,
        h('button', { class: navigator.canShare ? 'btn sec' : 'btn', id: 'btn-pdf', text: 'Baixar PDF', onclick: function () { pdf('down'); } }), info,
        h('p', { class: 'hint', text: 'Imprima o PDF, colete as assinaturas à mão (itens 10.11 e 10.13) e entregue à CGIS.' })),
      h('div', { class: 'card' }, l.situacao !== 'enviado' ? h('button', { class: 'btn', id: 'btn-enviar', text: 'Enviar agora', onclick: function () { enviarAgora(info); } }) : h('p', { class: 'ok', text: 'Recebido pelo servidor.' }),
        h('button', { class: 'btn sec', id: 'btn-reabrir', text: 'Reabrir para correção', onclick: function () {
          if (!confirm('Reabrir este levantamento para correção? Será preciso finalizar de novo.')) return;
          l.situacao = 'rascunho'; (l.reaberturas = l.reaberturas || []).push(new Date().toISOString()); l.proxima_tentativa = null;
          save().then(function () { go('/lev/' + l.id + '/b/1'); });
        } })),
      h('a', { class: 'btn sec', href: '#/', text: 'Voltar ao início' }),
      l.situacao === 'enviado' || true ? h('button', { class: 'btn danger', id: 'btn-apagar', text: 'Apagar do aparelho', onclick: function () {
        if (!confirm('Apagar este levantamento deste aparelho? ' + (l.situacao === 'enviado' ? '' : 'ELE AINDA NÃO FOI ENVIADO.'))) return;
        LV.db.delFotosDe(l.id).then(function () { return LV.db.delLev(l.id); }).then(function () { S.cur = null; go('/'); });
      } }) : null)]);
  }

  /* ---------- Levantamento de versao anterior ---------- */
  function vAnterior() {
    var l = S.cur, info = h('p', { class: 'msg', id: 'rs-msg' });
    var pode = l.situacao === 'finalizado' || l.situacao === 'aguardando';
    render([topbar('Versão anterior', '/'), h('main', { class: 'wrap' }, h('div', { class: 'card' },
      h('h1', { text: 'Levantamento da versão anterior' }), h('p', { text: l.unidade.nome || '' }),
      h('p', null, h('span', { class: 'st st-' + l.situacao, id: 'rs-status', text: STATUS[l.situacao] })),
      h('p', { class: 'hint', text: 'Este levantamento foi feito na versão ' + (l.versao_instrumento || '?') + ' do formulário e não pode mais ser editado. ' + (pode ? 'Ele ainda pode ser enviado como está.' : (l.situacao === 'enviado' ? 'Já foi recebido pelo servidor.' : 'Como é rascunho, não pode ser enviado: apague e refaça no formulário novo.')) }),
      l.ultimo_erro && l.situacao !== 'enviado' ? h('p', { class: 'msg', text: 'Último erro de envio: ' + LV.msgErro(l.ultimo_erro) }) : null,
      pode ? h('button', { class: 'btn', id: 'btn-enviar', text: 'Enviar agora', onclick: function () { enviarAgora(info); } }) : null, info,
      h('a', { class: 'btn sec', href: '#/', text: 'Voltar ao início' }),
      h('button', { class: 'btn danger', id: 'btn-apagar', text: 'Apagar do aparelho', onclick: function () {
        if (!confirm('Apagar este levantamento deste aparelho? ' + (l.situacao === 'enviado' ? '' : 'ELE AINDA NÃO FOI ENVIADO.'))) return;
        LV.db.delFotosDe(l.id).then(function () { return LV.db.delLev(l.id); }).then(function () { S.cur = null; go('/'); });
      } })))]);
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
    Promise.all([carrega('spec.json'), carrega('unidades_app.json'), LV.db.getMeta('perfil'), LV.db.getMeta('listas')]).then(function (a) {
      S.model = LV.model = LV.buildModel(a[0]); S.unidades = normUnidades(a[1]); S.perfil = a[2] || null; LV.aplicaListas(S.model, a[3]);
      window.LVAPP = S; // diagnostico e testes
      registraSW();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      window.addEventListener('hashchange', route);
      route(); LV.iniciaFila(); LV.reconfereCodigo(); listasSilencioso();
      document.documentElement.setAttribute('data-pronto', '1');
    }).catch(function (e) {
      $app.textContent = 'Não foi possível iniciar o aplicativo: ' + e.message;
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
