/* ReadLater Pro - HTML to Markdown for exports (1.3.0).
 *
 *   ExportMarkdown.fromHtml(html, { images: true }) -> Markdown string
 *   ExportMarkdown.escape(text) -> text safe to place inside Markdown
 *
 * Covers what Readability output contains: headings, paragraphs, line
 * breaks, lists (nested, ordered with start), links, emphasis, inline code,
 * code blocks, blockquotes, images, rules, figures and simple tables.
 * Scripts, styles, forms and media players are dropped.
 */
(function () {
  'use strict';

  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|SELECT|TEXTAREA|SVG|CANVAS|VIDEO|AUDIO|HEAD|META|LINK)$/;
  var BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV|FIGURE|DETAILS|SUMMARY|ADDRESS|CENTER|DL|DD|DT)$/;

  function escape(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/([*_`\[\]])/g, '\\$1')
      .replace(/^(\s*)([#>+-])(?=\s)/gm, '$1\\$2')
      .replace(/^(\s*\d+)\.(?=\s)/gm, '$1\\.');
  }

  function safeUrl(u) {
    var s = String(u || '').trim();
    if (!/^(https?:|mailto:)/i.test(s)) return '';
    return s.replace(/[()\s]/g, function (c) { return encodeURIComponent(c); });
  }

  function collapse(s) {
    return s.replace(/[ \t\r\n ]+/g, ' ');
  }

  function Converter(opts) {
    this.images = !opts || opts.images !== false;
  }

  /** Inline content of a node, as one Markdown line (may contain hard breaks). */
  Converter.prototype.inline = function (node) {
    var out = '';
    for (var c = node.firstChild; c; c = c.nextSibling) out += this.inlineNode(c);
    return out;
  };

  Converter.prototype.inlineNode = function (n) {
    if (n.nodeType === 3) return escape(collapse(n.nodeValue));
    if (n.nodeType !== 1) return '';
    var tag = n.tagName;
    if (SKIP.test(tag)) return '';
    var inner;
    switch (tag) {
      case 'BR': return '  \n';
      case 'STRONG': case 'B':
        inner = this.inline(n).trim();
        return inner ? '**' + inner + '**' : '';
      case 'EM': case 'I': case 'CITE':
        inner = this.inline(n).trim();
        return inner ? '*' + inner + '*' : '';
      case 'DEL': case 'S': case 'STRIKE':
        inner = this.inline(n).trim();
        return inner ? '~~' + inner + '~~' : '';
      case 'CODE': case 'KBD': case 'SAMP': {
        var code = n.textContent.replace(/\n/g, ' ');
        if (!code) return '';
        var ticks = /`/.test(code) ? '``' : '`';
        return ticks + (ticks === '``' ? ' ' + code + ' ' : code) + ticks;
      }
      case 'A': {
        inner = this.inline(n).trim();
        var href = safeUrl(n.getAttribute('href'));
        if (!inner) return '';
        return href ? '[' + inner + '](' + href + ')' : inner;
      }
      case 'IMG': {
        if (!this.images) return '';
        var src = safeUrl(n.getAttribute('src'));
        if (!src || /^mailto:/i.test(src)) return '';
        var alt = collapse(n.getAttribute('alt') || '').replace(/[\[\]]/g, '');
        return '![' + alt + '](' + src + ')';
      }
      case 'SUP': return '^' + this.inline(n);
      case 'SUB': return '~' + this.inline(n);
      default:
        if (BLOCK.test(tag) || /^(H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR)$/.test(tag)) {
          return ' ' + this.inline(n) + ' ';
        }
        return this.inline(n);
    }
  };

  /** Block content: an array of Markdown blocks (joined with blank lines). */
  Converter.prototype.blocks = function (node) {
    var blocks = [];
    var line = '';
    var self = this;
    function flush() {
      var s = line.replace(/[ \t]+\n/g, function (m) { return /  \n$/.test(m) ? '  \n' : '\n'; }).trim();
      if (s) blocks.push(s);
      line = '';
    }
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { line += escape(collapse(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName;
      if (SKIP.test(tag)) continue;
      var b = self.block(c);
      if (b === null) { line += self.inlineNode(c); continue; }
      flush();
      blocks = blocks.concat(b);
    }
    flush();
    return blocks;
  };

  /** Returns an array of blocks for block elements, or null for inline ones. */
  Converter.prototype.block = function (n) {
    var tag = n.tagName;
    var m = /^H([1-6])$/.exec(tag);
    if (m) {
      var h = this.inline(n).replace(/\s*\n\s*/g, ' ').trim();
      return h ? [new Array(Number(m[1]) + 1).join('#') + ' ' + h] : [];
    }
    switch (tag) {
      case 'P': {
        var p = this.inline(n).replace(/^[ \t]+|[ \t]+$/gm, '').trim();
        return p ? [p] : [];
      }
      case 'HR': return ['---'];
      case 'PRE': {
        var text = n.textContent.replace(/\n+$/, '');
        var fence = /```/.test(text) ? '~~~' : '```';
        var codeEl = n.querySelector('code[class*="language-"]');
        var lang = codeEl ? (/language-([\w+-]+)/.exec(codeEl.className) || [])[1] || '' : '';
        return [fence + lang + '\n' + text + '\n' + fence];
      }
      case 'BLOCKQUOTE': {
        var inner = this.blocks(n).join('\n\n');
        return inner ? [inner.split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n')] : [];
      }
      case 'UL': case 'OL': return [this.list(n, tag === 'OL')].filter(Boolean);
      case 'TABLE': return [this.table(n)].filter(Boolean);
      case 'FIGCAPTION': {
        var cap = this.inline(n).trim();
        return cap ? ['*' + cap + '*'] : [];
      }
      case 'IMG': {
        var img = this.inlineNode(n);
        return img ? [img] : [];
      }
      default:
        if (BLOCK.test(tag) || tag === 'LI') return this.blocks(n);
        return null;
    }
  };

  Converter.prototype.list = function (n, ordered) {
    var start = ordered ? parseInt(n.getAttribute('start'), 10) || 1 : 1;
    var items = [];
    var i = 0;
    for (var c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c.tagName !== 'LI') continue;
      var marker = ordered ? (start + i) + '. ' : '- ';
      var pad = new Array(marker.length + 1).join(' ');
      var body = this.blocks(c).join('\n\n') || '';
      var lines = body.split('\n');
      items.push(marker + lines[0] + (lines.length > 1 ? '\n' + lines.slice(1).map(function (l) { return l ? pad + l : ''; }).join('\n') : ''));
      i++;
    }
    return items.join('\n');
  };

  Converter.prototype.table = function (n) {
    var rows = [];
    var self = this;
    n.querySelectorAll('tr').forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll('th, td').forEach(function (cell) {
        cells.push(self.inline(cell).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim());
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return '';
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var line = function (r) {
      var full = r.slice();
      while (full.length < width) full.push('');
      return '| ' + full.join(' | ') + ' |';
    };
    var out = [line(rows[0]), '|' + new Array(width + 1).join(' --- |')];
    rows.slice(1).forEach(function (r) { out.push(line(r)); });
    return out.join('\n');
  };

  function fromHtml(html, opts) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    if (!doc.body) return '';
    var md = new Converter(opts).blocks(doc.body).join('\n\n');
    return md.replace(/\n{3,}/g, '\n\n').trim();
  }

  var ExportMarkdown = { fromHtml: fromHtml, escape: escape };
  if (typeof window !== 'undefined') window.ExportMarkdown = ExportMarkdown;
})();
