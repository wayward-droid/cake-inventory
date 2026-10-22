#!/usr/bin/env node
/**
 * Minimal Markdown -> styled HTML converter.
 * Purpose-built for the Cake Slice Factory docs so they convert cleanly
 * into Word (.docx) and PDF via Microsoft Word COM automation.
 *
 * Usage: node tools/md2html.js <input.md> <output.html> "<Doc Title>"
 */
const fs = require('fs');
const path = require('path');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

/* ---------------------------------------------------------------- inline */
function inline(text) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(escapeHtml(c));
    return '\u0001' + (codes.length - 1) + '\u0001';
  });

  s = escapeHtml(s);

  // links
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  // bold, then italics
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*]+)\*/g, '$1<em>$2</em>');
  // restore code spans
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => '<code>' + codes[+i] + '</code>');
  return s;
}

/* ------------------------------------------------------------ table row */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
const isSeparatorRow = (cells) =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')));

/* -------------------------------------------------------------- convert */
function convert(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const listStack = [];
  let tableBuf = null;
  let quoteBuf = null;
  let codeBuf = null;
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) { out.push('<p>' + inline(paraBuf.join(' ')) + '</p>'); paraBuf = []; }
  };
  const flushTable = () => {
    if (!tableBuf) return;
    out.push('<table>');
    for (const row of tableBuf) {
      if (row.sep) continue;
      const tag = row.header ? 'th' : 'td';
      out.push('<tr>' + row.cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>');
    }
    out.push('</table>');
    tableBuf = null;
  };
  const flushQuote = () => {
    if (!quoteBuf) return;
    out.push('<blockquote>' + quoteBuf.map((q) => inline(q)).join('<br>') + '</blockquote>');
    quoteBuf = null;
  };
  const flushCode = () => {
    if (!codeBuf) return;
    out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
    codeBuf = null;
  };
  const flushList = (toIndent) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      out.push('</' + listStack.pop().tag + '>');
    }
  };
  const flushBlocks = () => { flushPara(); flushTable(); flushQuote(); flushCode(); flushList(-1); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code
    if (/^\s*```/.test(line)) {
      if (codeBuf) flushCode();
      else { flushPara(); flushTable(); flushQuote(); flushList(-1); codeBuf = []; }
      continue;
    }
    if (codeBuf) { codeBuf.push(escapeHtml(line)); continue; }

    if (/^\s*$/.test(line)) { flushBlocks(); continue; }

    // table
    if (/^\s*\|/.test(line)) {
      flushPara(); flushQuote(); flushList(-1);
      const cells = splitRow(line);
      if (isSeparatorRow(cells)) {
        if (tableBuf && tableBuf.length) tableBuf[tableBuf.length - 1].header = true;
        if (!tableBuf) tableBuf = [];
        tableBuf.push({ sep: true });
      } else {
        if (!tableBuf) tableBuf = [];
        tableBuf.push({ cells, header: false, sep: false });
      }
      continue;
    }

    // heading
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      flushBlocks();
      const lvl = hm[1].length;
      out.push(`<h${lvl}>${inline(hm[2])}</h${lvl}>`);
      continue;
    }

    // horizontal rule
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushBlocks(); out.push('<hr>'); continue; }

    // blockquote
    const qm = line.match(/^ {0,3}>\s?(.*)$/);
    if (qm) { flushPara(); flushTable(); flushList(-1); if (!quoteBuf) quoteBuf = []; quoteBuf.push(qm[1]); continue; }

    // list
    const lm = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (lm) {
      flushPara(); flushTable(); flushQuote();
      const indent = lm[1].length;
      const tag = /\d/.test(lm[2]) ? 'ol' : 'ul';
      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        out.push('</' + listStack.pop().tag + '>');
      }
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) { listStack.push({ tag, indent }); out.push('<' + tag + '>'); }
      else if (top.tag !== tag) { out.push('</' + listStack.pop().tag + '>'); listStack.push({ tag, indent }); out.push('<' + tag + '>'); }
      out.push('<li>' + inline(lm[3]) + '</li>');
      continue;
    }

    paraBuf.push(line.trim());
  }

  flushBlocks();
  return out.join('\n');
}

/* ----------------------------------------------------------------- css */
const CSS = `
@page { size: A4; margin: 1.9cm 1.7cm; }
* { box-sizing: border-box; }
body {
  font-family: "Segoe UI", Calibri, Arial, sans-serif;
  font-size: 10.5pt; line-height: 1.45; color: #1f2328; margin: 0;
}
h1 { font-size: 22pt; color: #7b3f00; margin: 0 0 6pt; }
h2 { font-size: 15.5pt; color: #7b3f00; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #d9c3a5; }
h3 { font-size: 12.5pt; color: #4a3416; margin: 14pt 0 5pt; }
h4 { font-size: 11pt; color: #4a3416; margin: 11pt 0 4pt; }
p { margin: 0 0 7pt; }
a { color: #0b5cad; text-decoration: underline; }
hr { border: none; border-top: 1pt solid #ddd; margin: 12pt 0; }
ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
li { margin: 0 0 3pt; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f2f4f7; padding: 0 2pt; }
pre {
  font-family: Consolas, "Courier New", monospace; font-size: 7.6pt; line-height: 1.25;
  background: #f6f8fa; border: 0.75pt solid #d6dbe1; padding: 7pt 8pt; margin: 0 0 9pt;
  white-space: pre; overflow-wrap: normal;
}
pre code { background: none; font-size: 7.6pt; padding: 0; }
blockquote { margin: 0 0 9pt; padding: 4pt 0 4pt 10pt; border-left: 3pt solid #d9c3a5; color: #444; }
table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; font-size: 9pt; }
th, td { border: 0.75pt solid #b9c0c8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f0e6d8; color: #4a3416; font-weight: bold; }
strong { color: #1a1a1a; }
`;

/* ---------------------------------------------------------------- main */
const [input, output, title] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node tools/md2html.js <input.md> <output.html> "<Title>"');
  process.exit(1);
}

const md = fs.readFileSync(input, 'utf8');
const body = convert(md);
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || path.basename(input, '.md'))}</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, '\ufeff' + html, 'utf8');
console.log('Wrote ' + output + ' (' + (html.length / 1024).toFixed(1) + ' KB)');
