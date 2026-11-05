/* ReadLater Pro - RFC 4180 CSV parser for the importer (1.3.0).
 *
 *   ImportCsv.parse(text) -> { rows: string[][], error: string|null }
 *   ImportCsv.toRecords(rows) -> { header: string[], index: {lowercased name: col}, records: string[][] }
 *   ImportCsv.stringify(rows) -> CSV text (CRLF, quotes only where needed)
 *
 * Handles a UTF-8 BOM, CRLF / LF / CR line ends, quoted fields with embedded
 * commas, quotes ("") and newlines, and a missing final newline. Rows that
 * are completely empty are dropped. Excel-style "sep=;" first lines and
 * tab- or semicolon-separated files are detected from the header line.
 */
(function () {
  'use strict';

  var MAX_ROWS = 250000;
  var MAX_CHARS = 64 * 1024 * 1024;

  function sniffDelimiter(text) {
    var end = text.indexOf('\n');
    var first = end === -1 ? text : text.slice(0, end);
    var commas = (first.match(/,/g) || []).length;
    var tabs = (first.match(/\t/g) || []).length;
    var semis = (first.match(/;/g) || []).length;
    if (tabs > commas && tabs >= semis) return '\t';
    if (semis > commas && semis > tabs) return ';';
    return ',';
  }

  function parse(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') return { rows: [], error: 'empty' };
    if (text.length > MAX_CHARS) return { rows: [], error: 'tooLarge' };
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var delim = opts.delimiter;
    var sep = /^sep=(.)\r?\n/i.exec(text);
    if (sep) { delim = sep[1]; text = text.slice(sep[0].length); }
    if (!delim) delim = sniffDelimiter(text);

    var rows = [];
    var row = [];
    var field = '';
    var i = 0;
    var n = text.length;
    var inQuotes = false;
    var fieldStarted = false;
    var error = null;

    function endField() {
      row.push(field);
      field = '';
      fieldStarted = false;
    }
    function endRow() {
      endField();
      var empty = row.length === 1 && row[0] === '';
      if (!empty) rows.push(row);
      row = [];
    }

    while (i < n) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
        i++;
        continue;
      }
      if (c === delim) { endField(); i++; continue; }
      if (c === '\r') {
        endRow();
        i += text.charAt(i + 1) === '\n' ? 2 : 1;
        if (rows.length >= MAX_ROWS) { error = 'tooManyRows'; break; }
        continue;
      }
      if (c === '\n') {
        endRow();
        i++;
        if (rows.length >= MAX_ROWS) { error = 'tooManyRows'; break; }
        continue;
      }
      // A stray quote inside an unquoted field is kept as text (lenient, like Excel).
      field += c;
      fieldStarted = true;
      i++;
    }
    if (!error) {
      if (inQuotes) error = 'unclosedQuote';
      if (field !== '' || row.length) endRow();
    }
    return { rows: rows, error: error };
  }

  function toRecords(rows) {
    var header = (rows[0] || []).map(function (h) { return String(h).trim(); });
    var index = {};
    header.forEach(function (h, col) {
      var key = h.toLowerCase();
      if (!(key in index)) index[key] = col;
    });
    return { header: header, index: index, records: rows.slice(1) };
  }

  function quote(value) {
    var s = value == null ? '' : String(value);
    // Neutralise spreadsheet formulas so an exported title can't run in Excel.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function stringify(rows) {
    return rows.map(function (r) { return r.map(quote).join(','); }).join('\r\n') + '\r\n';
  }

  var ImportCsv = { parse: parse, toRecords: toRecords, stringify: stringify, MAX_ROWS: MAX_ROWS };
  if (typeof self !== 'undefined') self.ImportCsv = ImportCsv;
  if (typeof window !== 'undefined') window.ImportCsv = ImportCsv;
})();
