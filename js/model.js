/* Modelo do formulario: tudo vem de spec.json. Chaves de dados conforme o contrato com o servidor. */
(function () {
  var LV = window.LV = window.LV || {};
  LV.CGIS_TXT = 'Preenchido pela CGIS na base';

  LV.clean = function (s) { return typeof s === 'string' ? s.replace(/[\u2013\u2014]/g, '-') : s; };

  function keyOf(code) { return 'c' + code.replace('.', '_'); }
  function norm(k) { return (k === 'txt' || k === 'text') ? 'text' : k; }

  /* Constroi blocos, itens e o dicionario de campos a partir do spec */
  LV.buildModel = function (spec) {
    var fields = {}, ent = {}, auto = {}, calcs = {}, apc = {};
    var lists = {};
    Object.keys(spec.lists || {}).forEach(function (k) { lists[k] = spec.lists[k].slice(); });
    function def(r, bid, ex) {
      var d = { key: keyOf(r.code), code: r.code, label: r.label, kind: norm(r.kind), opts: r.opts || null, cgis: !!r.cgis, block: bid,
        opts_ref: r.opts_ref || null, extra: r.extra || null, primeiro: r.primeiro || null, hint: r.hint || '', when: r.when || null,
        auto: r.auto || null, calc: r.calc || null, sem_agora: !!r.sem_agora, declara: r.declara || '',
        foto_em: r.foto_em || null, foto_quando: r.foto_quando || null, foto_hint: r.foto_hint || '' };
      if (ex) for (var k in ex) d[k] = ex[k];
      return d;
    }
    function registra(d, ehEnt) {
      if (ehEnt) return;
      if (d.auto) (auto[d.auto] = auto[d.auto] || []).push(d.key);
      if (d.calc) (calcs[d.calc] = calcs[d.calc] || []).push(d.key);
    }
    var blocks = spec.blocks.map(function (b) {
      var items = [];
      b.groups.forEach(function (g) {
        var t = g.type;
        if (t === 'fields') {
          var rows = g.rows.map(function (r) { var d = def(r, b.id); fields[d.key] = d; registra(d); return d; });
          var apcKey = null;
          rows.forEach(function (d) { if (d.auto === 'agora_primeira_contagem') apcKey = d.key; });
          if (apcKey) rows.forEach(function (d) { if (d.key !== apcKey) apc[d.key] = apcKey; });
          items.push({ type: 'fields', subtitle: g.subtitle, nota: g.nota || '', recolhido: !!g.recolhido, rows: rows });
        } else if (t === 'grid' || t === 'selgrid') {
          var sel = t === 'selgrid';
          var cols = g.cols.map(function (c) { return sel ? c[0] : c; });
          var ids = g.ids || cols.map(function (_, i) { return i + 1; });
          var rows2 = g.rows.map(function (r) {
            var row = { code: r.code, label: r.label, hint: r.hint || '', cgis: !!r.cgis, soma_de: r.soma_de || null, cells: [] };
            if (r.cgis) return row;
            cols.forEach(function (cn, i) {
              var kind = sel ? 'sel' : (norm(r.kind) !== 'text' ? norm(r.kind) : norm(g.cell || 'txt'));
              var ex = { key: keyOf(r.code) + '_c' + ids[i], kind: kind, colLabel: cn, colId: ids[i], opts: sel ? g.cols[i][1] : null, row: row };
              var d = def(r, b.id, ex);
              if (r.soma_de) { d.calc = 'soma_linha'; d.somaFrom = r.soma_de.map(function (rc) { return keyOf(rc) + '_c' + ids[i]; }); }
              else if (g.soma && g.soma.col === ids[i]) { d.calc = 'soma'; d.somaFrom = g.soma.de.map(function (id) { return keyOf(r.code) + '_c' + id; }); }
              if (sel && g.dep) g.dep.forEach(function (dp) { if (dp.col === ids[i]) d.when = { key: keyOf(r.code) + '_c' + dp.de, in: dp.in }; });
              fields[d.key] = d; row.cells.push(d);
            });
            return row;
          });
          items.push({ type: 'grid', subtitle: g.subtitle, nota: g.nota || '', cols: cols, ids: ids, rows: rows2 });
        } else if (t === 'questions') {
          var defs = {}, arr = [];
          g.rows.forEach(function (r) { var d = def(r, b.id); d.ent = g.prefix; defs[d.key] = d; arr.push(d); });
          ent[g.prefix] = { prefix: g.prefix, n: g.n, subtitle: g.subtitle, intro: g.intro, fields: arr, defs: defs };
          items.push({ type: 'questions', prefix: g.prefix });
        } else if (t === 'paras') {
          items.push({ type: 'paras', items: g.items });
        } else if (t === 'static') {
          items.push({ type: 'static', subtitle: g.subtitle, cols: g.cols, rows: g.rows, note: g.note || [] });
        }
      });
      return { id: b.id, title: b.title, lead: b.lead, tail: b.tail, items: items };
    });
    return { spec: spec, blocks: blocks, fields: fields, ent: ent, lists: lists, auto: auto, calcs: calcs, apc: apc };
  };

  /* Troca a lista de empresas pela baixada do servidor (se tiver ao menos 1 item); sem ela, vale a do spec */
  LV.aplicaListas = function (model, baixada) {
    var e = baixada && baixada.dados && baixada.dados.empresas;
    if (Array.isArray(e) && e.length) model.lists.empresas = e.map(String);
    else model.lists.empresas = (model.spec.lists.empresas || []).slice();
  };

  /* Lista plana de chaves gravaveis (sem entrevistas), na ordem do spec. Inclui auto, calc e sig; exclui so cgis. */
  LV.fieldKeys = function (model) {
    var out = [];
    model.blocks.forEach(function (b) {
      b.items.forEach(function (it) {
        if (it.type === 'fields') it.rows.forEach(function (d) { if (!d.cgis) out.push(d.key); });
        else if (it.type === 'grid') it.rows.forEach(function (r) { r.cells.forEach(function (d) { out.push(d.key); }); });
      });
    });
    return out;
  };

  /* ---------- opcoes de um campo ---------- */
  function semPrep(s) { return LV.semAcento(s).replace(/\b(de|do|da|dos|das)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  LV.opcoes = function (d, ctx) {
    ctx = ctx || {};
    var lists = ctx.lists || (LV.model && LV.model.lists) || {};
    var base = d.opts ? d.opts.slice() : (d.opts_ref && lists[d.opts_ref] ? lists[d.opts_ref].slice() : []);
    if (d.primeiro === 'unidade_municipio' && ctx.municipio) {
      var alvo = semPrep(ctx.municipio), i;
      for (i = 0; i < base.length; i++) if (semPrep(base[i]) === alvo) break;
      if (i < base.length) base.unshift(base.splice(i, 1)[0]);
    }
    if (d.extra) d.extra.forEach(function (x) { if (base.indexOf(x) < 0) base.push(x); });
    return base;
  };

  /* ---------- condicoes (when) ---------- */
  function cond(c, st) {
    if (!c) return true;
    if (c.any) return c.any.some(function (x) { return cond(x, st); });
    if (c.all) return c.all.every(function (x) { return cond(x, st); });
    var v = st && st[c.key] !== undefined && st[c.key] !== null ? String(st[c.key]) : '';
    if (c.in) return c.in.indexOf(v) >= 0;
    if (c.gt !== undefined) return /^\d+$/.test(v.trim()) && +v.trim() > c.gt;
    if (c.filled) return v.trim() !== '';
    if (c.has) return v.split('; ').indexOf(c.has) >= 0;
    return true;
  }
  LV.visivel = function (d, store) { return !d || !d.when || cond(d.when, store || {}); };

  /* ---------- codigo de acesso ---------- */
  LV.normCodigo = function (x) { return String(x === undefined || x === null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  LV.fmtCodigo = function (x) {
    var n = LV.normCodigo(x);
    if (n.length > 12) return n;
    return n.replace(/(.{4})(?=.)/g, '$1-');
  };

  /* Texto colado com o nome junto: se ha exatamente um trecho XXXX-XXXX-XXXX (sem letra ou numero colado antes ou depois)
     e sobra mais coisa, devolve so o trecho; senao null. */
  LV.extraiCodigo = function (bruto) {
    var s = String(bruto === undefined || bruto === null ? '' : bruto), re = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/, achados = [], i;
    for (i = 0; i < s.length; i++) {
      if (i > 0 && /[A-Za-z0-9]/.test(s.charAt(i - 1))) continue;
      var m = re.exec(s.slice(i));
      if (m && !/[A-Za-z0-9]/.test(s.charAt(i + 14) || '')) achados.push(m[0]);
    }
    if (achados.length !== 1) return null;
    return LV.normCodigo(s).length > LV.normCodigo(achados[0]).length ? achados[0] : null;
  };

  /* ---------- fotos: origem e dia ---------- */
  function p2(n) { return ('0' + n).slice(-2); }
  /* ISO completo -> 'AAAA-MM-DDTHH:MM' no horario do aparelho */
  LV.isoParaMin = function (iso) {
    var d = new Date(iso); if (!iso || isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  /* ISO -> 'dd/mm/aaaa hh:mm' no horario do aparelho */
  LV.isoParaBr = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(LV.isoParaMin(iso)); return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : '';
  };
  /* Origem, data e avisos de uma foto (registro antigo sem origem vale como camera, com a data de criado_em) */
  LV.fotoInfo = function (f, visitaBr) {
    var origem = f.origem === 'galeria' ? 'galeria' : 'camera';
    var t = f.tirada_em !== undefined && f.tirada_em !== null ? f.tirada_em : (origem === 'camera' ? LV.isoParaMin(f.criado_em) : '');
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t || '');
    var dia = m ? m[3] + '/' + m[2] + '/' + m[1] : '', hora = m ? m[4] + ':' + m[5] : '';
    var rotulo = origem === 'camera' ? (m ? 'Câmera, ' + dia + ' ' + hora : 'Câmera') : (m ? 'Galeria, foto de ' + dia + ' ' + hora : 'Galeria, sem data na foto');
    var fora = !!m && !!visitaBr && dia !== visitaBr, sem = !m;
    return { origem: origem, dia: dia, hora: hora, rotulo: rotulo, fora: fora, sem: sem,
      aviso: fora ? 'Esta foto não é do dia da visita.' : (sem ? 'Não foi possível confirmar o dia desta foto.' : '') };
  };

  /* ---------- entrevistas ---------- */
  function minutos(v) { var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; }
  LV.minutos = minutos;
  LV.entrevistaRespondida = function (model, prefix, E) {
    var g = model.ent[prefix]; if (!g || !E) return false;
    return g.fields.some(function (d) { return !d.auto && E[d.key] !== undefined && E[d.key] !== null && String(E[d.key]).trim() !== ''; });
  };
  /* tags (E01.., S01..) com resposta, em ordem */
  LV.tagsRespondidas = function (l, model, prefix) {
    return Object.keys(l.entrevistas || {}).filter(function (t) { return t.charAt(0) === prefix && LV.entrevistaRespondida(model, prefix, l.entrevistas[t]); }).sort();
  };
  /* Espera calculada pelas entrevistas: {media, maior, n} (fila) e {media, n} (saida) */
  LV.esperas = function (l, model) {
    var ds = [], ps = [];
    LV.tagsRespondidas(l, model, 'E').forEach(function (t) {
      var E = l.entrevistas[t], a = minutos(E.c7_01), b = minutos(E.c7_17);
      if (a !== null && b !== null && b - a >= 0) ds.push(b - a);
    });
    LV.tagsRespondidas(l, model, 'S').forEach(function (t) {
      var E = l.entrevistas[t], a = minutos(E.c7_10), b = minutos(E.c7_11);
      if (a !== null && b !== null && b - a >= 0) ps.push(b - a);
    });
    var soma = function (x) { return x.reduce(function (s, v) { return s + v; }, 0); };
    return { fila: { media: ds.length ? Math.round(soma(ds) / ds.length) : null, maior: ds.length ? Math.max.apply(null, ds) : null, n: ds.length },
      saida: { media: ps.length ? Math.round(soma(ps) / ps.length) : null, n: ps.length } };
  };

  /* Apaga o valor dos campos cuja condicao e falsa (repete ate estabilizar: um campo escondido pode esconder outro) */
  LV.limpaEscondidos = function (l, model) {
    var mudou = true, n = 0;
    while (mudou && n++ < 8) {
      mudou = false;
      Object.keys(model.fields).forEach(function (k) {
        var d = model.fields[k];
        if (d.when && l.dados[k] !== undefined && !LV.visivel(d, l.dados)) { delete l.dados[k]; mudou = true; }
      });
      Object.keys(l.entrevistas || {}).forEach(function (t) {
        var g = model.ent[t.charAt(0)], E = l.entrevistas[t]; if (!g || !E) return;
        g.fields.forEach(function (d) { if (d.when && E[d.key] !== undefined && !LV.visivel(d, E)) { delete E[d.key]; mudou = true; } });
      });
    }
  };

  /* Numero sem zero a esquerda: "04" -> "4", "00" -> "0". Outros valores ficam como estao. */
  LV.semZeroEsq = function (v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : v;
  };
  /* Na finalizacao: tira zero a esquerda dos campos numericos (levantamento e entrevistas) e, na grade com soma,
     na linha em que uma coluna somada tem numero e a outra esta vazia, a vazia vira "0". Linha toda vazia fica vazia. */
  LV.normalizaNumeros = function (l, model) {
    var D = l.dados;
    Object.keys(D).forEach(function (k) { var d = model.fields[k]; if (d && d.kind === 'num') D[k] = LV.semZeroEsq(D[k]); });
    Object.keys(l.entrevistas || {}).forEach(function (t) {
      var g = model.ent[t.charAt(0)], E = l.entrevistas[t]; if (!g || !E) return;
      g.fields.forEach(function (d) { if (d.kind === 'num' && E[d.key] !== undefined) E[d.key] = LV.semZeroEsq(E[d.key]); });
    });
    function temNum(v) { return /^\d+$/.test(String(v === undefined || v === null ? '' : v).trim()); }
    function vazio(v) { return v === undefined || v === null || String(v).trim() === ''; }
    Object.keys(model.fields).forEach(function (k) {
      var d = model.fields[k];
      if (d.calc !== 'soma' || !LV.visivel(d, D)) return;
      var origem = d.somaFrom;
      if (origem.some(function (kk) { return temNum(D[kk]); })) origem.forEach(function (kk) { if (vazio(D[kk]) && LV.visivel(model.fields[kk], D)) D[kk] = '0'; });
    });
    return l;
  };

  /* Calcula somas, medias e contagens de foto e grava em l.dados; chamada em todo salvamento e na finalizacao */
  LV.deriva = function (l, fotos, model) {
    var D = l.dados; fotos = fotos || [];
    function num(v) { return /^\d+$/.test(String(v === undefined || v === null ? '' : v).trim()) ? +String(v).trim() : null; }
    function poe(k, v) { if (v === null || v === undefined || v === '') delete D[k]; else D[k] = String(v); }
    Object.keys(model.fields).forEach(function (k) {
      var d = model.fields[k];
      if (d.calc === 'soma' || d.calc === 'soma_linha') {
        var s = 0, algum = false;
        d.somaFrom.forEach(function (kk) { var n = num(D[kk]); if (n !== null) { s += n; algum = true; } });
        poe(k, algum ? s : null);
      } else if (d.calc === 'foto_feita') {
        D[k] = fotos.some(function (f) { return f.codigo === d.code; }) ? 'Feita' : 'Não feita';
      } else if (d.calc === 'conta_fotos') {
        D[k] = String(fotos.filter(function (f) { return f.codigo.indexOf(d.code + '-') === 0; }).length);
      } else if (d.calc === 'assinatura') {
        var as = l.assinaturas && l.assinaturas[d.code];
        D[k] = as ? 'Assinada na tela em ' + LV.isoParaBr(as.em) : 'Não assinada na tela';
      }
    });
    var e = LV.esperas(l, model), c = model.calcs;
    (c.espera_media_fila || []).forEach(function (k) { poe(k, e.fila.media); });
    (c.espera_maior_fila || []).forEach(function (k) { poe(k, e.fila.maior); });
    (c.permanencia_media_saida || []).forEach(function (k) { poe(k, e.saida.media); });
    LV.limpaEscondidos(l, model);
    return l;
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
    return true; /* multi, foto e fotos nao tem formato a validar */
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
    var m = { 'CIRETRAN': 'CIRETRAN', 'SAT': 'SAT', 'Sede': 'Sede', 'USV': 'Posto de vistoria ou USV', 'Posto de Vistoria': 'Posto de vistoria ou USV', 'Posto de Habilitação': 'Posto de habilitação', 'Rio Poupa Tempo': 'Rio Poupa Tempo' };
    var r = m[t] || '';
    if (t === 'Posto de Atendimento') r = /shopping/i.test(nome || '') ? 'Posto em shopping' : '';
    return opts.indexOf(r) >= 0 ? r : '';
  };
})();
