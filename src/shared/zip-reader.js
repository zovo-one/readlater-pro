/* ReadLater Pro - minimal zip reader (1.3.0).
 *
 * Reads the central directory of a .zip held in an ArrayBuffer and inflates
 * entries on demand with DecompressionStream('deflate-raw'). Supports the two
 * methods real exports use (0 = stored, 8 = deflate). No zip64, no encryption.
 *
 *   ZipReader.open(arrayBuffer) -> Promise<{ entries, has(name), find(re), readText(name), readBytes(name) }>
 *   entries: [{ name, size, compressedSize, method, offset }]
 *
 * Limits protect the page from hostile or broken files: entry count, size of
 * a single entry, and the total of everything inflated in one session.
 */
(function () {
  'use strict';

  var LIMITS = {
    maxArchiveBytes: 512 * 1024 * 1024,
    maxEntries: 50000,
    maxEntryBytes: 128 * 1024 * 1024,
    maxTotalBytes: 1024 * 1024 * 1024
  };

  var SIG_EOCD = 0x06054b50;
  var SIG_CEN = 0x02014b50;
  var SIG_LOC = 0x04034b50;

  function ZipError(message, code) {
    var e = new Error(message);
    e.code = code || 'ZIP_ERROR';
    return e;
  }

  // Names are UTF-8 in every export we read (flag bit 11 or plain ASCII).
  function decodeName(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function findEocd(view) {
    // The end record is 22 bytes plus a comment of up to 65535 bytes.
    var min = Math.max(0, view.byteLength - 22 - 65535);
    for (var i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  function inflateRaw(bytes, expected, limit) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(ZipError('This browser cannot unpack zip files.', 'ZIP_UNSUPPORTED'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes).catch(function () {});
    writer.close().catch(function () {});
    var reader = ds.readable.getReader();
    var chunks = [];
    var total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        total += r.value.byteLength;
        if (total > limit) {
          reader.cancel().catch(function () {});
          throw ZipError('A file inside the zip is too large to read.', 'ZIP_TOO_LARGE');
        }
        chunks.push(r.value);
        return pump();
      });
    }
    return pump().then(function () {
      var out = new Uint8Array(total);
      var pos = 0;
      chunks.forEach(function (c) { out.set(c, pos); pos += c.byteLength; });
      return out;
    }, function (err) {
      if (err && err.code) throw err;
      throw ZipError('A file inside the zip is damaged.', 'ZIP_CORRUPT');
    });
  }

  function open(buffer, opts) {
    var limits = Object.assign({}, LIMITS, opts || {});
    return new Promise(function (resolve) {
      if (!(buffer instanceof ArrayBuffer)) throw ZipError('Not a zip file.', 'ZIP_INVALID');
      if (buffer.byteLength > limits.maxArchiveBytes) throw ZipError('This zip file is too large.', 'ZIP_TOO_LARGE');
      var view = new DataView(buffer);
      if (view.byteLength < 22) throw ZipError('Not a zip file.', 'ZIP_INVALID');
      var eocd = findEocd(view);
      if (eocd < 0) throw ZipError('Not a zip file, or the zip is damaged.', 'ZIP_INVALID');
      var count = view.getUint16(eocd + 10, true);
      var cdSize = view.getUint32(eocd + 12, true);
      var cdOffset = view.getUint32(eocd + 16, true);
      if (count === 0xffff || cdOffset === 0xffffffff) throw ZipError('This zip uses a format (zip64) that isn\'t supported.', 'ZIP_UNSUPPORTED');
      if (count > limits.maxEntries) throw ZipError('This zip has too many files.', 'ZIP_TOO_LARGE');
      if (cdOffset + cdSize > view.byteLength) throw ZipError('The zip is damaged.', 'ZIP_CORRUPT');

      var bytes = new Uint8Array(buffer);
      var entries = [];
      var p = cdOffset;
      for (var i = 0; i < count; i++) {
        if (p + 46 > view.byteLength || view.getUint32(p, true) !== SIG_CEN) throw ZipError('The zip is damaged.', 'ZIP_CORRUPT');
        var flags = view.getUint16(p + 8, true);
        var method = view.getUint16(p + 10, true);
        var csize = view.getUint32(p + 20, true);
        var usize = view.getUint32(p + 24, true);
        var nlen = view.getUint16(p + 28, true);
        var xlen = view.getUint16(p + 30, true);
        var clen = view.getUint16(p + 32, true);
        var local = view.getUint32(p + 42, true);
        var name = decodeName(bytes.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + xlen + clen;
        if (/\/$/.test(name)) continue; // directory
        entries.push({
          name: name,
          size: usize,
          compressedSize: csize,
          method: method,
          encrypted: !!(flags & 1),
          offset: local
        });
      }

      var inflated = 0;
      var byName = {};
      entries.forEach(function (e) { byName[e.name] = e; });

      function readBytes(nameOrEntry) {
        var e = typeof nameOrEntry === 'string' ? byName[nameOrEntry] : nameOrEntry;
        return Promise.resolve().then(function () {
          if (!e) throw ZipError('File not found in zip.', 'ZIP_MISSING');
          if (e.encrypted) throw ZipError('This zip is password protected.', 'ZIP_UNSUPPORTED');
          if (e.size > limits.maxEntryBytes) throw ZipError('A file inside the zip is too large to read.', 'ZIP_TOO_LARGE');
          if (inflated + e.size > limits.maxTotalBytes) throw ZipError('This zip holds too much data to read at once.', 'ZIP_TOO_LARGE');
          var lp = e.offset;
          if (lp + 30 > view.byteLength || view.getUint32(lp, true) !== SIG_LOC) throw ZipError('The zip is damaged.', 'ZIP_CORRUPT');
          var start = lp + 30 + view.getUint16(lp + 26, true) + view.getUint16(lp + 28, true);
          var end = start + e.compressedSize;
          if (end > view.byteLength) throw ZipError('The zip is damaged.', 'ZIP_CORRUPT');
          var data = bytes.subarray(start, end);
          var cap = Math.min(limits.maxEntryBytes, limits.maxTotalBytes - inflated);
          if (e.method === 0) {
            inflated += data.byteLength;
            return data.slice();
          }
          if (e.method === 8) {
            return inflateRaw(data, e.size, cap).then(function (out) {
              inflated += out.byteLength;
              return out;
            });
          }
          throw ZipError('This zip uses a compression method that isn\'t supported.', 'ZIP_UNSUPPORTED');
        });
      }

      function readText(nameOrEntry) {
        return readBytes(nameOrEntry).then(function (b) {
          return new TextDecoder('utf-8').decode(b);
        });
      }

      resolve({
        entries: entries,
        has: function (name) { return !!byName[name]; },
        get: function (name) { return byName[name] || null; },
        find: function (re) { return entries.filter(function (e) { return re.test(e.name); }); },
        readBytes: readBytes,
        readText: readText
      });
    });
  }

  /** True when the first bytes look like a zip local header. */
  function looksLikeZip(buffer) {
    if (!buffer || buffer.byteLength < 4) return false;
    return new DataView(buffer).getUint32(0, true) === SIG_LOC;
  }

  var ZipReader = { open: open, looksLikeZip: looksLikeZip, LIMITS: LIMITS };
  if (typeof self !== 'undefined') self.ZipReader = ZipReader;
  if (typeof window !== 'undefined') window.ZipReader = ZipReader;
})();
