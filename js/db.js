/* Armazenamento local (IndexedDB): meta, lev (levantamentos), fotos */
(function () {
  var LV = window.LV = window.LV || {};
  var DB = null;
  function open() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      var rq = indexedDB.open('levantamento-detran', 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        d.createObjectStore('meta', { keyPath: 'k' });
        d.createObjectStore('lev', { keyPath: 'id' });
        var f = d.createObjectStore('fotos', { keyPath: 'fid' });
        f.createIndex('levId', 'levId');
      };
      rq.onsuccess = function () { DB = rq.result; res(DB); };
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
    }
  };
})();
