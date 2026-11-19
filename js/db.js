/* Armazenamento local (IndexedDB): meta, lev (levantamentos), fotos, anexos (PDF do levantamento) */
(function () {
  var LV = window.LV = window.LV || {};
  var DB = null;
  function open() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      var rq = indexedDB.open('levantamento-detran', 2);
      /* cria so o que falta: quem vem do banco versao 1 (app 2.0.0) mantem meta, lev e fotos como estao */
      rq.onupgradeneeded = function () {
        var d = rq.result, nomes = d.objectStoreNames;
        if (!nomes.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
        if (!nomes.contains('lev')) d.createObjectStore('lev', { keyPath: 'id' });
        if (!nomes.contains('fotos')) { var f = d.createObjectStore('fotos', { keyPath: 'fid' }); f.createIndex('levId', 'levId'); }
        if (!nomes.contains('anexos')) { var a = d.createObjectStore('anexos', { keyPath: 'aid' }); a.createIndex('levId', 'levId'); }
      };
      /* outra aba (ou versao nova do app) pede para atualizar o banco: solta a conexao */
      rq.onblocked = function () { if (LV.aoBloquearBanco) LV.aoBloquearBanco(); /* a atualizacao espera as outras janelas do app fecharem; segue sozinha depois */ };
      rq.onsuccess = function () {
        DB = rq.result;
        DB.onversionchange = function () { try { DB.close(); } catch (e) {} DB = null; };
        res(DB);
      };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function tx(store, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function get(store, k) { return tx(store, 'readonly', function (s) { return s.get(k); }); }
  function put(store, v) { return tx(store, 'readwrite', function (s) { return s.put(v); }); }
  function del(store, k) { return tx(store, 'readwrite', function (s) { return s.delete(k); }); }
  function all(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); }
  LV.db = {
    getMeta: function (k) { return get('meta', k).then(function (r) { return r ? r.v : undefined; }); },
    setMeta: function (k, v) { return put('meta', { k: k, v: v }); },
    getLev: function (id) { return get('lev', id); },
    putLev: function (l) { return put('lev', l); },
    delLev: function (id) { return del('lev', id); },
    allLev: function () { return all('lev'); },
    putFoto: function (f) { return put('fotos', f); },
    getFoto: function (fid) { return get('fotos', fid); },
    delFoto: function (fid) { return del('fotos', fid); },
    fotosDe: function (levId) { return tx('fotos', 'readonly', function (s) { return s.index('levId').getAll(levId); }); },
    delFotosDe: function (levId) {
      return LV.db.fotosDe(levId).then(function (l) { return Promise.all(l.map(function (f) { return del('fotos', f.fid); })); });
    },
    /* anexos: o PDF do levantamento (aid = id do levantamento + ':pdf') */
    putAnexo: function (a) { return put('anexos', a); },
    getAnexo: function (aid) { return get('anexos', aid); },
    delAnexo: function (aid) { return del('anexos', aid); },
    anexosDe: function (levId) { return tx('anexos', 'readonly', function (s) { return s.index('levId').getAll(levId); }); },
    delAnexosDe: function (levId) {
      return LV.db.anexosDe(levId).then(function (l) { return Promise.all(l.map(function (a) { return del('anexos', a.aid); })); });
    }
  };
})();
