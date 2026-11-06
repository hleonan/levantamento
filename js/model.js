/* Modelo do formulario: tudo vem de spec.json. Nomes de campo iguais ao codebook_v2.csv (campo_pdf). */
(function () {
  var LV = window.LV = window.LV || {};
  LV.CGIS_TXT = 'Preenchido pela CGIS na base';

  LV.clean = function (s) { return typeof s === 'string' ? s.replace(/[\u2013\u2014]/g, '-') : s; };

  function keyOf(code) { return 'c' + code.replace('.', '_'); }
  function norm(k) { return (k === 'txt' || k === 'text') ? 'text' : k; }

  /* Constroi blocos, itens e o dicionario de campos a partir do spec */
  LV.buildModel = function (spec) {
    var fields = {};
    function def(r, bid, extra) {
      var d = { key: keyOf(r.code), code: r.code, label: r.label, kind: norm(r.kind), opts: r.opts || null, cgis: !!r.cgis, block: bid };
      if (extra) for (var k in extra) d[k] = extra[k];
      return d;
    }
    var ent = {};
    var blocks = spec.blocks.map(function (b) {
      var items = [];
      b.groups.forEach(function (g) {
        var t = g.type;
        if (t === 'fields') {
          var rows = g.rows.map(function (r) { var d = def(r, b.id); fields[d.key] = d; return d; });
          items.push({ type: 'fields', subtitle: g.subtitle, rows: rows });
        } else if (t === 'grid' || t === 'selgrid') {
          var sel = t === 'selgrid';
          var cols = g.cols.map(function (c) { return sel ? c[0] : c; });
          var rows2 = g.rows.map(function (r) {
            var row = { code: r.code, label: r.label, cgis: !!r.cgis, cells: [] };
            if (r.cgis) return row;
            cols.forEach(function (cn, i) {
              var kind = sel ? 'sel' : (norm(r.kind) !== 'text' ? norm(r.kind) : norm(g.cell || 'txt'));
              var d = def(r, b.id, { key: keyOf(r.code) + '_c' + (i + 1), kind: kind, colLabel: cn, opts: sel ? g.cols[i][1] : null });
              fields[d.key] = d; row.cells.push(d);
            });
            return row;
          });
          items.push({ type: 'grid', subtitle: g.subtitle, cols: cols, rows: rows2 });
        } else if (t === 'questions') {
          var defs = [];
          (g.extra || []).forEach(function (e) {
            defs.push({ key: 'c7_aferi', code: 'Aferição', label: e[0], kind: norm(e[1]), opts: e[2] || null });
          });
          g.rows.forEach(function (r) { defs.push({ key: keyOf(r.code), code: r.code, label: r.label, kind: norm(r.kind), opts: r.opts || null }); });
          ent[g.prefix] = { prefix: g.prefix, n: g.n, subtitle: g.subtitle, intro: g.intro, fields: defs };
          items.push({ type: 'questions', prefix: g.prefix });
        } else if (t === 'paras') {
          items.push({ type: 'paras', items: g.items });
        } else if (t === 'static') {
          items.push({ type: 'static', subtitle: g.subtitle, cols: g.cols, rows: g.rows, note: g.note || [] });
        }
      });
      return { id: b.id, title: b.title, lead: b.lead, tail: b.tail, items: items };
    });
    return { spec: spec, blocks: blocks, fields: fields, ent: ent };
  };

  /* Lista plana de chaves gravaveis (sem entrevistas), na ordem do codebook */
  LV.fieldKeys = function (model) {
    var out = [];
    model.blocks.forEach(function (b) {
      b.items.forEach(function (it) {
        if (it.type === 'fields') it.rows.forEach(function (d) { if (!d.cgis && d.kind !== 'sig') out.push(d.key); });
        else if (it.type === 'grid') it.rows.forEach(function (r) { r.cells.forEach(function (d) { out.push(d.key); }); });
      });
    });
    return out;
  };

  /* ---------- formatos ---------- */
  function validDate(v) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); if (!m) return false;
    var d = +m[1], mo = +m[2], y = +m[3];
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
    var dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }
  LV.valid = function (kind, v) {
    if (v === undefined || v === null || v === '') return true;
    if (kind === 'date') return validDate(v);
    if (kind === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (kind === 'num') return /^\d+$/.test(v);
    return true;
  };
  LV.fmtMsg = { date: 'use dd/mm/aaaa', time: 'use hh:mm (00:00 a 23:59)', num: 'use só algarismos' };
  LV.brToIso = function (v) { var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  LV.isoToBr = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  LV.hojeBr = function () { var d = new Date(); var p = function (n) { return ('0' + n).slice(-2); }; return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
  LV.agoraHora = function () { var d = new Date(); var p = function (n) { return ('0' + n).slice(-2); }; return p(d.getHours()) + ':' + p(d.getMinutes()); };

  /* Detecta o que parece CPF ou placa (a pessoa atendida nunca deve ser identificada) */
  LV.pareceDadoPessoal = function (s) {
    if (!s) return false;
    return /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(s) || /\b[A-Za-z]{3}-?\d[A-Za-z0-9]\d{2}\b/.test(s);
  };

  LV.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };

  LV.semAcento = function (s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  /* Mapeia o tipo do cadastro do site para as opcoes do item 1.03 */
  LV.mapTipo = function (t, nome, opts) {
    var m = { 'CIRETRAN': 'CIRETRAN', 'SAT': 'SAT', 'Sede': 'Sede', 'USV': 'Posto de vistoria ou USV', 'Posto de Vistoria': 'Posto de vistoria ou USV', 'Posto de Habilitação': 'Posto de habilitação', 'Rio Poupa Tempo': 'Outro' };
    var r = m[t] || '';
    if (t === 'Posto de Atendimento') r = /shopping/i.test(nome || '') ? 'Posto em shopping' : '';
    return opts.indexOf(r) >= 0 ? r : '';
  };
})();
