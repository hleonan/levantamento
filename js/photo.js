/* Fotos: compressao no aparelho, data da foto (EXIF), tela de foto para cobrir rostos e placas (pixelacao irreversivel) e tela de assinatura */
(function () {
  var LV = window.LV = window.LV || {};
  var MAXLADO = 1600, QUAL = 0.7;

  function loadBitmap(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('imagem invalida')); };
      im.src = u;
    });
  }
  function toBlob(canvas, q) { return new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', q); }); }

  LV.comprimir = function (file, lado, q) {
    return loadBitmap(file).then(function (bm) {
      var w = bm.width || bm.naturalWidth, h = bm.height || bm.naturalHeight;
      var esc = Math.min(1, (lado || MAXLADO) / Math.max(w, h));
      var cw = Math.round(w * esc), ch = Math.round(h * esc);
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(bm, 0, 0, cw, ch);
      if (bm.close) bm.close();
      return toBlob(c, q || QUAL).then(function (b) { return { blob: b, w: cw, h: ch }; });
    });
  };

  /* Mosaico: a area marcada vira no maximo 6 quadros no lado maior. Assim uma placa de veiculo (larga e baixa) fica com 6 x 2 quadros,
     sem nenhum desenho de letra; com o quadro calculado pelo lado menor, sobravam uns 2 quadros por letra. */
  function pixelar(ctx, x, y, w, h) {
    var bs = Math.max(16, Math.ceil(Math.max(w, h) / 6));
    var img = ctx.getImageData(x, y, w, h), d = img.data;
    for (var by = 0; by < h; by += bs) {
      for (var bx = 0; bx < w; bx += bs) {
        var ex = Math.min(bx + bs, w), ey = Math.min(by + bs, h), r = 0, g = 0, b = 0, n = 0, i, xx, yy;
        for (yy = by; yy < ey; yy++) for (xx = bx; xx < ex; xx++) { i = (yy * w + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        for (yy = by; yy < ey; yy++) for (xx = bx; xx < ex; xx++) { i = (yy * w + xx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; }
      }
    }
    ctx.putImageData(img, x, y);
  }
  LV.pixelar = pixelar;

  /* ---------- data da foto (EXIF), sem biblioteca ---------- */
  function lerInicio(file, n) {
    var parte = file.slice(0, n);
    if (parte.arrayBuffer) return parte.arrayBuffer();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(parte); });
  }
  function exifData(buf) {
    var v = new DataView(buf), n = v.byteLength;
    if (n < 4 || v.getUint16(0) !== 0xFFD8) return '';
    var p = 2;
    while (p + 4 <= n) {
      if (v.getUint8(p) !== 0xFF) return '';
      var mk = v.getUint8(p + 1);
      if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { p += 2; continue; }
      if (mk === 0xDA || mk === 0xD9) return '';
      var len = v.getUint16(p + 2);
      if (mk === 0xE1 && p + 10 <= n && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
        var t = p + 10, le;
        if (t + 8 > n) return '';
        var bo = v.getUint16(t);
        if (bo === 0x4949) le = true; else if (bo === 0x4D4D) le = false; else return '';
        if (v.getUint16(t + 2, le) !== 42) return '';
        var ler = function (off) { /* IFD em off (relativo ao TIFF): {tag: [tipo, qtd, posicao do valor]} */
          var o = {}; if (t + off + 2 > n) return o;
          var cnt = v.getUint16(t + off, le);
          for (var i = 0; i < cnt; i++) {
            var e = t + off + 2 + i * 12; if (e + 12 > n) break;
            o[v.getUint16(e, le)] = [v.getUint16(e + 2, le), v.getUint32(e + 4, le), e + 8];
          }
          return o;
        };
        var texto = function (ent) {
          if (!ent || ent[0] !== 2 || ent[1] < 19) return '';
          var pos = ent[1] > 4 ? t + v.getUint32(ent[2], le) : ent[2], s = '';
          if (pos + 19 > n) return '';
          for (var i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(pos + i));
          return s;
        };
        var ifd0 = ler(v.getUint32(t + 4, le)), exif = ifd0[0x8769] ? ler(v.getUint32(ifd0[0x8769][2], le)) : {};
        var d = texto(exif[0x9003]) || texto(ifd0[0x0132]);
        var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(d);
        if (!m || +m[1] < 1990 || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59) return '';
        return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5];
      }
      p += 2 + len;
    }
    return '';
  }
  /* Devolve Promise com 'AAAA-MM-DDTHH:MM' (DateTimeOriginal; na falta, DateTime) ou ''. Qualquer erro devolve ''. */
  LV.dataExif = function (file) {
    try { return lerInicio(file, 262144).then(function (b) { try { return exifData(b); } catch (e) { return ''; } }, function () { return ''; }); }
    catch (e) { return Promise.resolve(''); }
  };

  /* ---------- tela cheia com a tecla Voltar do celular ----------
     Abre a tela (ov) por cima de tudo. Voltar do celular, ou mudar a rota, fecha a tela sem mudar a rota de baixo.
     Devolve {fechar}: fechar() tira a tela e desfaz o passo do historico; devolve Promise que resolve quando o historico assentou
     (assim a proxima tela so abre depois, sem a tecla Voltar desfeita no meio). aoFechar roda so quando a tela foi fechada por fora (Voltar, rota). */
  LV.abreTela = function (ov, aoFechar) {
    var fechada = false, empurrou = false, f = LV.model && LV.model.spec && LV.model.spec.teste;
    Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); }); /* nenhum aviso antigo por cima da foto ou do quadro de assinar */
    if (f && f.ativo) {
      var fx = document.createElement('div'); fx.className = 'faixa-teste'; fx.textContent = f.texto;
      var topo = ov.firstChild; ov.insertBefore(fx, topo);
    }
    document.body.appendChild(ov);
    try { history.pushState({ lvTela: true }, '', location.href); empurrou = true; } catch (e) {}
    function limpa() { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onHash); ov.remove(); }
    function onPop() { if (fechada) return; fechada = true; empurrou = false; limpa(); if (aoFechar) aoFechar(); }
    function onHash() { if (fechada) return; fechada = true; empurrou = false; limpa(); if (aoFechar) aoFechar(); }
    window.addEventListener('popstate', onPop); window.addEventListener('hashchange', onHash);
    return {
      fechar: function () {
        if (fechada) return Promise.resolve();
        fechada = true; limpa();
        if (!empurrou) return Promise.resolve();
        return new Promise(function (res) {
          var feito = false, fim = function () { if (feito) return; feito = true; window.removeEventListener('popstate', fim); res(); };
          window.addEventListener('popstate', fim); setTimeout(fim, 600);
          try { history.back(); } catch (e) { fim(); }
        });
      }
    };
  };

  /* O dedo sobre o quadro (foto ou assinatura) fica so com o aplicativo: o navegador nao rola a tela nem trata o gesto como arremesso.
     Sem isto, depois de um risco rapido o navegador engole o primeiro toque seguinte num botao (ele serve para "parar o arremesso"). */
  function soMeu(cv) {
    cv.style.touchAction = 'none';
    ['touchstart', 'touchmove', 'touchend'].forEach(function (t) { cv.addEventListener(t, function (ev) { if (ev.cancelable) ev.preventDefault(); }, { passive: false }); });
  }

  /* Pergunta de confirmacao (window.confirm) */
  function confirma(txt) { try { return window.confirm(txt); } catch (e) { return true; } }

  /* ---------- tela de foto: cobrir rostos e placas ----------
     Abre a tela. Resolve {blob,w,h,cobertas,revisada:true} em "Salvar foto" ou null em Descartar/Cancelar/Voltar.
     op: {edicao: true} quando a foto ja estava salva (o botao vira "Cancelar"). */
  LV.editorRostos = function (blob, titulo, op) {
    op = op || {};
    return loadBitmap(blob).then(function (bm) {
      return new Promise(function (resolve) {
        var w = bm.width || bm.naturalWidth, h = bm.height || bm.naturalHeight;
        var ov = document.createElement('div'); ov.className = 'overlay ov-foto'; ov.setAttribute('role', 'dialog');
        ov.innerHTML = '<div class="ovtop"><h2></h2><p class="ovinstr">Arraste o dedo sobre cada rosto ou placa de veículo e toque em Cobrir. Sem rosto nem placa, toque em Salvar foto.</p>' +
          '<p class="ovcont" id="ed-cont">Nenhuma área coberta</p></div>' +
          '<div class="edcv"><div class="edwrap"><canvas></canvas></div></div><div class="edbar">' +
          '<button class="btn sm" data-a="cobrir" disabled>Cobrir</button>' +
          '<button class="btn sm sec" data-a="desfazer" disabled>Desfazer</button>' +
          '<button class="btn sm ok" data-a="ok">Salvar foto</button>' +
          '<button class="btn sm sec" data-a="cancel"></button></div>';
        ov.querySelector('h2').textContent = titulo || 'Foto';
        ov.querySelector('[data-a=cancel]').textContent = op.edicao ? 'Cancelar' : 'Descartar';
        var tela = LV.abreTela(ov, function () { window.removeEventListener('resize', ajusta); resolve(null); });
        var cv = ov.querySelector('canvas'), wrap = ov.querySelector('.edwrap'), box = ov.querySelector('.edcv'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bm, 0, 0, w, h);
        if (bm.close) bm.close();
        /* a foto inteira, na largura e na altura que sobram, sem deformar */
        function ajusta() {
          var cw = box.clientWidth, ch = box.clientHeight; if (!cw || !ch) return;
          var s = Math.min(cw / w, ch / h); wrap.style.width = (w * s) + 'px'; wrap.style.height = (h * s) + 'px'; redrawSel();
        }
        var sel = null, drag = null, hist = [], cobertas = 0;
        function redrawSel() {
          var o = wrap.querySelector('.selbox');
          if (!sel) { if (o) o.remove(); return; }
          if (!o) { o = document.createElement('div'); o.className = 'selbox'; wrap.appendChild(o); }
          var f = cv.clientWidth / w;
          o.style.left = (sel.x * f) + 'px'; o.style.top = (sel.y * f) + 'px'; o.style.width = (sel.w * f) + 'px'; o.style.height = (sel.h * f) + 'px';
        }
        function conta() {
          ov.querySelector('#ed-cont').textContent = cobertas === 0 ? 'Nenhuma área coberta' : cobertas + (cobertas === 1 ? ' área coberta' : ' áreas cobertas');
          ov.querySelector('[data-a=desfazer]').disabled = !hist.length;
        }
        function pt(ev) {
          var r = cv.getBoundingClientRect();
          return { x: Math.max(0, Math.min(w, (ev.clientX - r.left) * w / r.width)), y: Math.max(0, Math.min(h, (ev.clientY - r.top) * h / r.height)) };
        }
        soMeu(cv);
        cv.addEventListener('pointerdown', function (ev) { drag = pt(ev); sel = null; ov.querySelector('[data-a=cobrir]').disabled = true; try { cv.setPointerCapture(ev.pointerId); } catch (e) {} ev.preventDefault(); });
        cv.addEventListener('pointermove', function (ev) {
          if (!drag) return; var p = pt(ev);
          sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
          redrawSel();
        });
        function fim() {
          drag = null;
          if (sel && (sel.w < 8 || sel.h < 8)) sel = null;
          redrawSel(); ov.querySelector('[data-a=cobrir]').disabled = !sel;
        }
        cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim);
        function fecha(v) { window.removeEventListener('resize', ajusta); tela.fechar().then(function () { resolve(v); }); }
        ov.addEventListener('click', function (ev) {
          var el = ev.target.closest ? ev.target.closest('[data-a]') : null, a = el && el.getAttribute('data-a'); if (!a || el.disabled) return;
          if (a === 'cobrir' && sel) {
            /* para o Desfazer, guarda so o pedaco que vai ser coberto (a foto inteira a cada vez pesaria demais em celular simples) */
            var rx = Math.floor(sel.x), ry = Math.floor(sel.y), rw = Math.min(w - rx, Math.max(1, Math.ceil(sel.w))), rh = Math.min(h - ry, Math.max(1, Math.ceil(sel.h)));
            hist.push({ x: rx, y: ry, img: ctx.getImageData(rx, ry, rw, rh) });
            pixelar(ctx, rx, ry, rw, rh);
            cobertas++; sel = null; redrawSel();
            ov.querySelector('[data-a=cobrir]').disabled = true; conta();
          } else if (a === 'desfazer' && hist.length) {
            var ult = hist.pop(); ctx.putImageData(ult.img, ult.x, ult.y); cobertas = Math.max(0, cobertas - 1); conta();
          } else if (a === 'ok') {
            toBlob(cv, QUAL).then(function (b) { fecha({ blob: b, w: w, h: h, cobertas: cobertas, revisada: true }); });
          } else if (a === 'cancel') {
            if (cobertas > 0 && !confirma(op.edicao ? 'Cancelar? As áreas cobertas agora serão perdidas e a foto fica como estava.' : 'Descartar a foto? As áreas já cobertas serão perdidas.')) return;
            fecha(null);
          }
        });
        window.addEventListener('resize', ajusta);
        ajusta(); setTimeout(ajusta, 60);
      });
    });
  };

  /* ---------- tela de assinatura com o dedo ----------
     op: {titulo, declara, dados, quem}. Resolve {png} ou null (Cancelar/Voltar). */
  LV.telaAssinatura = function (op) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.className = 'overlay ov-sig'; ov.setAttribute('role', 'dialog');
      ov.innerHTML = '<div class="ovtop"><h2></h2><p class="ovdecl" hidden></p><p class="ovdados" hidden></p><p class="ovquem"></p><p class="ovinstr">Assine com o dedo dentro do quadro.</p></div>' +
        '<div class="sigbox"><canvas id="sig-cv"></canvas><div class="sigbase"></div></div>' +
        '<div class="edbar sigbar"><button class="btn sm sec" data-a="limpar" disabled>Limpar</button>' +
        '<button class="btn sm ok" data-a="ok" disabled>Salvar assinatura</button><button class="btn sm sec" data-a="cancel">Cancelar</button></div>';
      ov.querySelector('h2').textContent = op.titulo || 'Assinatura';
      if (op.declara) { var dc = ov.querySelector('.ovdecl'); dc.hidden = false; dc.textContent = op.declara; }
      if (op.dados) { var dd = ov.querySelector('.ovdados'); dd.hidden = false; dd.textContent = op.dados; }
      ov.querySelector('.ovquem').textContent = op.quem || '';
      var tela = LV.abreTela(ov, function () { window.removeEventListener('resize', ajusta); resolve(null); });
      var cv = ov.querySelector('canvas'), bx = ov.querySelector('.sigbox'), ctx = cv.getContext('2d');
      var tracos = [], atual = null, dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      function desenha() {
        ctx.clearRect(0, 0, cv.width, cv.height); ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.2 * dpr;
        tracos.forEach(function (t) {
          if (t.length === 1) { ctx.beginPath(); ctx.arc(t[0].x * cv.width, t[0].y * cv.height, 1.6 * dpr, 0, 6.2832); ctx.fill(); return; }
          ctx.beginPath(); t.forEach(function (p, i) { if (i) ctx.lineTo(p.x * cv.width, p.y * cv.height); else ctx.moveTo(p.x * cv.width, p.y * cv.height); }); ctx.stroke();
        });
      }
      function ajusta() {
        var r = bx.getBoundingClientRect(); if (!r.width || !r.height) return;
        cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); desenha();
      }
      function estado() { ov.querySelector('[data-a=ok]').disabled = !tracos.length; ov.querySelector('[data-a=limpar]').disabled = !tracos.length; }
      function pt(ev) { var r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) }; }
      soMeu(cv);
      cv.addEventListener('pointerdown', function (ev) { atual = [pt(ev)]; tracos.push(atual); try { cv.setPointerCapture(ev.pointerId); } catch (e) {} desenha(); estado(); ev.preventDefault(); });
      cv.addEventListener('pointermove', function (ev) { if (!atual) return; atual.push(pt(ev)); desenha(); });
      function solta() { atual = null; }
      cv.addEventListener('pointerup', solta); cv.addEventListener('pointercancel', solta);
      /* PNG de fundo branco, recortado em volta dos tracos (com folga), para a assinatura ocupar o espaco dela no PDF.
         O recorte nunca fica menor que metade da largura e 30% da altura do quadro: um risco pequeno nao vira um borrao gigante. */
      function png() {
        var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        tracos.forEach(function (t) { t.forEach(function (p) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }); });
        function faixa(a, b, min, folga) { /* intervalo [a, b] com folga, largura minima e dentro de 0..1 */
          var c = (a + b) / 2, l = Math.min(1, Math.max(b - a + 2 * folga, min)), ini = Math.max(0, Math.min(1 - l, c - l / 2));
          return [ini, l];
        }
        var fx = faixa(x0, x1, 0.5, 0.04), fy = faixa(y0, y1, 0.3, 0.06);
        var sx = Math.round(fx[0] * cv.width), sy = Math.round(fy[0] * cv.height), sw = Math.max(1, Math.round(fx[1] * cv.width)), sh = Math.max(1, Math.round(fy[1] * cv.height));
        var W = Math.min(600, sw), H = Math.max(1, Math.round(sh * W / sw)), c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
        var x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, W, H); x2.drawImage(cv, sx, sy, sw, sh, 0, 0, W, H);
        return c2.toDataURL('image/png');
      }
      function fecha(v) { window.removeEventListener('resize', ajusta); tela.fechar().then(function () { resolve(v); }); }
      ov.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-a]') : null, a = el && el.getAttribute('data-a'); if (!a || el.disabled) return;
        if (a === 'limpar') { tracos = []; atual = null; desenha(); estado(); }
        else if (a === 'ok' && tracos.length) fecha({ png: png() });
        else if (a === 'cancel') fecha(null);
      });
      window.addEventListener('resize', ajusta);
      ajusta(); setTimeout(ajusta, 60);
    });
  };
})();
