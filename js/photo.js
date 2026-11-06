/* Fotos: compressao no aparelho e editor para cobrir rostos (pixelacao irreversivel) */
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

  function pixelar(ctx, x, y, w, h) {
    var bs = Math.max(12, Math.round(Math.min(w, h) / 5));
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

  /* Abre o editor. Resolve {blob,w,h,cobertas,revisada} ou null se cancelar. */
  LV.editorRostos = function (blob, titulo) {
    return loadBitmap(blob).then(function (bm) {
      return new Promise(function (resolve) {
        var w = bm.width || bm.naturalWidth, h = bm.height || bm.naturalHeight;
        var ov = document.createElement('div'); ov.className = 'overlay'; ov.setAttribute('role', 'dialog');
        ov.innerHTML = '<div class="ed"><h2></h2><p class="aviso">Cubra todos os rostos antes de finalizar: arraste o dedo sobre o rosto para marcar um retângulo e toque em Cobrir. A área fica pixelada de forma definitiva.</p>' +
          '<div class="edcv"><canvas></canvas></div><div class="edbtn">' +
          '<button class="btn" data-a="cobrir" disabled>Cobrir área marcada</button>' +
          '<button class="btn sec" data-a="desfazer" disabled>Desfazer</button>' +
          '<button class="btn ok" data-a="ok">Concluir: rostos cobertos ou sem rostos</button>' +
          '<button class="btn sec" data-a="cancel">Fechar sem concluir</button></div></div>';
        ov.querySelector('h2').textContent = titulo || 'Foto';
        document.body.appendChild(ov);
        var cv = ov.querySelector('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bm, 0, 0, w, h);
        if (bm.close) bm.close();
        var sel = null, drag = null, hist = [], cobertas = 0;
        function redrawSel() {
          // a marcacao e desenhada em um canvas sobreposto para nao tocar nos pixels da foto
          var o = ov.querySelector('.selbox');
          if (!sel) { if (o) o.remove(); return; }
          if (!o) { o = document.createElement('div'); o.className = 'selbox'; ov.querySelector('.edcv').appendChild(o); }
          var f = cv.clientWidth / w;
          o.style.left = (cv.offsetLeft + sel.x * f) + 'px'; o.style.top = (cv.offsetTop + sel.y * f) + 'px';
          o.style.width = (sel.w * f) + 'px'; o.style.height = (sel.h * f) + 'px';
        }
        function pt(ev) {
          var r = cv.getBoundingClientRect();
          return { x: Math.max(0, Math.min(w, (ev.clientX - r.left) * w / r.width)), y: Math.max(0, Math.min(h, (ev.clientY - r.top) * h / r.height)) };
        }
        cv.style.touchAction = 'none';
        cv.addEventListener('pointerdown', function (ev) { drag = pt(ev); sel = null; cv.setPointerCapture(ev.pointerId); ev.preventDefault(); });
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
        function fecha(v) { ov.remove(); resolve(v); }
        ov.addEventListener('click', function (ev) {
          var a = ev.target.getAttribute && ev.target.getAttribute('data-a'); if (!a) return;
          if (a === 'cobrir' && sel) {
            if (hist.length >= 5) hist.shift();
            hist.push(ctx.getImageData(0, 0, w, h));
            pixelar(ctx, Math.floor(sel.x), Math.floor(sel.y), Math.max(1, Math.ceil(sel.w)), Math.max(1, Math.ceil(sel.h)));
            cobertas++; sel = null; redrawSel();
            ov.querySelector('[data-a=cobrir]').disabled = true; ov.querySelector('[data-a=desfazer]').disabled = false;
          } else if (a === 'desfazer' && hist.length) {
            ctx.putImageData(hist.pop(), 0, 0); cobertas = Math.max(0, cobertas - 1);
            ov.querySelector('[data-a=desfazer]').disabled = !hist.length;
          } else if (a === 'ok') {
            toBlob(cv, QUAL).then(function (b) { fecha({ blob: b, w: w, h: h, cobertas: cobertas, revisada: true }); });
          } else if (a === 'cancel') { fecha(null); }
        });
      });
    });
  };
})();
