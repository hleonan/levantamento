/* PDF A4 retrato gerado no aparelho com jsPDF (funciona sem internet) */
(function () {
  var LV = window.LV = window.LV || {};
  var AZUL = [0, 93, 159], CINZA = [242, 245, 248], LINHA = [184, 196, 206], TXT = [31, 41, 51];
  var M = 14, PW = 210, PH = 297, CW = PW - 2 * M;

  function t(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[\u2013\u2014]/g, '-').replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
      .replace(/…/g, '...').replace(/[^\x09\x0a\x0d\x20-\xff]/g, '?');
  }
  function blobDataUrl(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); });
  }

  LV.gerarPDF = function (lev, model, fotos, opts) {
    opts = opts || {};
    var spec = model.spec, D = lev.dados;
    var J = window.jspdf.jsPDF;
    var doc = new J({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    doc.setProperties({ title: t(spec.title) + ' ' + spec.version, author: 'DETRAN-RJ CGIS' });
    var y = M;

    function novaPagina() {
      doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]);
      doc.text('DETRAN-RJ - Coordenadoria-Geral de Integração de Serviços', M, 10);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 112, 124);
      doc.text(t('Unidade: ' + (lev.unidade.nome || '')), PW - M, 10, { align: 'right' });
      doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.line(M, 12, PW - M, 12);
      y = 17;
    }
    function precisa(h) { if (y + h > PH - 16) novaPagina(); }
    function barra(titulo) {
      precisa(30);
      doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]); doc.rect(M, y, CW, 7, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(t(titulo), M + 2, y + 4.9); y += 9.5;
    }
    function sub(titulo) {
      precisa(20);
      doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(t(titulo), M, y + 3); y += 6;
    }
    function para(txt, size, bold, cor) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size || 8.5);
      doc.setTextColor.apply(doc, cor || TXT);
      var lh = (size || 8.5) * 0.3528 * 1.3, ls = doc.splitTextToSize(t(txt), CW);
      ls.forEach(function (l) { precisa(lh); doc.text(l, M, y + lh * 0.8); y += lh; });
      y += 1.5;
    }

    function tabela(widths, heads, rows) {
      var fs = 8, lh = fs * 0.3528 * 1.25, pad = 1.2;
      function cabeca() {
        precisa(lh * 2 + 2 * pad + 12);
        var h = lh * 2 + 2 * pad;
        doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]); doc.rect(M, y, CW, h, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
        var x = M;
        heads.forEach(function (hd, i) {
          var ls = doc.splitTextToSize(t(hd), widths[i] - 2 * pad).slice(0, 2);
          ls.forEach(function (l, j) { doc.text(l, x + pad, y + pad + lh * 0.8 + j * lh); });
          x += widths[i];
        });
        y += h;
      }
      cabeca();
      rows.forEach(function (row, ri) {
        doc.setFontSize(fs);
        var cells = row.map(function (c, i) {
          var txt = (c && c.txt !== undefined) ? c.txt : c;
          doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
          return { lines: doc.splitTextToSize(t(txt), widths[i] - 2 * pad), it: !!(c && c.it) };
        });
        var pos = 0, total = Math.max.apply(null, cells.map(function (c) { return c.lines.length; }));
        while (pos < total) {
          var livre = Math.floor((PH - 16 - y - 2 * pad) / lh);
          if (livre < 1 || (pos === 0 && total <= 3 && livre < total)) { novaPagina(); cabeca(); continue; }
          var n = Math.min(livre, total - pos), h = n * lh + 2 * pad;
          if (ri % 2 === 0) { doc.setFillColor(CINZA[0], CINZA[1], CINZA[2]); doc.rect(M, y, CW, h, 'F'); }
          var x = M;
          cells.forEach(function (c, i) {
            doc.setFont('helvetica', i === 0 ? 'bold' : (c.it ? 'italic' : 'normal')); doc.setFontSize(fs);
            doc.setTextColor.apply(doc, c.it ? [100, 112, 124] : TXT);
            c.lines.slice(pos, pos + n).forEach(function (l, j) { doc.text(l, x + pad, y + pad + lh * 0.8 + j * lh); });
            x += widths[i];
          });
          doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.setLineWidth(0.15); doc.line(M, y + h, M + CW, y + h);
          y += h; pos += n;
          if (pos < total) { novaPagina(); cabeca(); }
        }
      });
      y += 3;
    }

    function resp(d, v) {
      if (d.cgis) return { txt: LV.CGIS_TXT, it: true };
      if (d.kind === 'sig') return { txt: 'Assinatura à mão no quadro final', it: true };
      return v === undefined || v === null ? '' : v;
    }

    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    spec.header.forEach(function (l, i) { doc.text(t(l), PW / 2, y + 4 + i * 5, { align: 'center' }); });
    y += 4 + spec.header.length * 5 + 2;
    doc.setTextColor(AZUL[0], AZUL[1], AZUL[2]); doc.setFontSize(14);
    doc.text(t(spec.title.toUpperCase()), PW / 2, y + 5, { align: 'center' }); y += 9;
    doc.setTextColor.apply(doc, TXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(t(spec.subtitle_pdf), PW / 2, y + 3, { align: 'center' }); y += 8;
    var u = lev.unidade;
    tabela([34, CW - 34], ['Dado', 'Informação'], [
      ['Unidade', (u.nome || '') + (u.id ? ' (' + u.id + ')' : '')],
      ['Tipo e município', [D.c1_03 || u.tipo || '', D.c1_06 || u.municipio || ''].filter(Boolean).join(' - ')],
      ['Data da visita', D.c1_18 || ''],
      ['Chegada e saída', (D.c1_19 || '') + (D.c1_19 || D.c1_20 ? ' a ' : '') + (D.c1_20 || '')],
      ['Levantado por', (lev.levantado_por || '') + (lev.perfil ? ' (' + lev.perfil + ')' : '')],
      ['ID do levantamento', lev.id]
    ]);

    model.blocks.forEach(function (b) {
      barra(b.title);
      b.items.forEach(function (it) {
        if (it.type === 'fields') {
          if (it.subtitle) sub(it.subtitle);
          tabela([13, 100, CW - 113], ['Código', 'Item', 'Resposta'], it.rows.map(function (d) { return [d.code, d.label, resp(d, D[d.key])]; }));
        } else if (it.type === 'grid') {
          if (it.subtitle) sub(it.subtitle);
          var nc = it.cols.length, iw = nc >= 4 ? 52 : 64, cw = (CW - 13 - iw) / nc;
          var ws = [13, iw]; for (var i = 0; i < nc; i++) ws.push(cw);
          tabela(ws, ['Código', 'Item'].concat(it.cols), it.rows.map(function (r) {
            if (r.cgis) { var row = [r.code, r.label]; for (var k = 0; k < nc; k++) row.push(k === 0 ? { txt: LV.CGIS_TXT, it: true } : ''); return row; }
            return [r.code, r.label].concat(r.cells.map(function (d) { return D[d.key] || ''; }));
          }));
        } else if (it.type === 'questions') {
          var g = model.ent[it.prefix];
          sub(g.subtitle);
          var tags = Object.keys(lev.entrevistas || {}).filter(function (x) { return x.charAt(0) === it.prefix; }).sort();
          if (!tags.length) para('Nenhuma entrevista registrada.', 8.5, false, [100, 112, 124]);
          tags.forEach(function (tag) {
            var E = lev.entrevistas[tag];
            precisa(40); para('Entrevista ' + tag, 8.5, true);
            tabela([16, 100, CW - 116], ['Código', 'Pergunta', 'Resposta'], g.fields.map(function (d) { return [d.code, d.label, E[d.key] || '']; }));
          });
        }
      });
      if (b.id === '9') {
        sub('Fotos registradas');
        if (!fotos.length) para('Nenhuma foto registrada.', 8.5, false, [100, 112, 124]);
        else if (!opts.fotos) para(fotos.length + ' foto(s) registrada(s): ' + fotos.map(function (f) { return f.codigo; }).join(', ') + '.', 8.5);
        else {
          var tw = 40, th = 30, gap = 4, per = Math.floor((CW + gap) / (tw + gap)), idx = 0;
          while (idx < fotos.length) {
            precisa(th + 8);
            for (var c = 0; c < per && idx < fotos.length; c++, idx++) {
              var f = fotos[idx], x = M + c * (tw + gap);
              try { doc.addImage(f.thumb, 'JPEG', x, y, tw, th, undefined, 'FAST'); } catch (e) {}
              doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.rect(x, y, tw, th);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor.apply(doc, TXT);
              doc.text(t('Foto ' + f.codigo), x, y + th + 3);
            }
            y += th + 6;
          }
        }
      }
    });

    precisa(60);
    barra('Assinaturas');
    var bw = (CW - 6) / 2;
    var nomeResp = D.c10_10 || '', nomeLev = D.c10_12 || D.c1_23 || lev.levantado_por || '';
    [['10.11 Assinatura do responsável pela unidade', 'Nome e cargo: ' + nomeResp], ['10.13 Assinatura de quem levantou', 'Nome e ID: ' + nomeLev]].forEach(function (b, i) {
      var x = M + i * (bw + 6);
      doc.setDrawColor.apply(doc, TXT); doc.setLineWidth(0.3); doc.line(x, y + 22, x + bw, y + 22);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor.apply(doc, TXT);
      doc.text(t(b[0]), x, y + 26);
      doc.setFont('helvetica', 'normal');
      doc.splitTextToSize(t(b[1]), bw).slice(0, 3).forEach(function (l, j) { doc.text(l, x, y + 30.5 + j * 4); });
    });
    y += 45;

    var total = doc.getNumberOfPages();
    for (var p = 1; p <= total; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 112, 124);
      doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.line(M, PH - 12, PW - M, PH - 12);
      doc.text(t('ID ' + lev.id + '  |  Instrumento ' + spec.version + '  |  App ' + LV.APP_VERSION), M, PH - 8);
      doc.text('Página ' + p + ' de ' + total, PW - M, PH - 8, { align: 'right' });
    }
    return doc.output('blob');
  };

  LV.prepararMiniaturas = function (fotos) {
    return Promise.all(fotos.map(function (f) {
      return LV.comprimir(f.blob, 320, 0.6).then(function (r) { return blobDataUrl(r.blob); }).then(function (u) { return { codigo: f.codigo, thumb: u }; });
    }));
  };
})();
