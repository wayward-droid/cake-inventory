#!/usr/bin/env node
/*
 * Convert a Word .docx (already unzipped) to clean Markdown.
 * Usage: node tools/docx2md.js <document.xml> <out.md> [title]
 */
const fs = require('fs');
const path = require('path');

const [, , inFile, outFile, title] = process.argv;
if (!inFile || !outFile) {
  console.error('usage: node docx2md.js <word/document.xml> <out.md> [title]');
  process.exit(1);
}

const xml = fs.readFileSync(inFile, 'utf8');
const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [, xml])[1];

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const inlineText = (chunk) =>
  decode(
    chunk
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, ' ')
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
      .replace(/<[^>]+>/g, '')
  );

function paragraphText(p) {
  return inlineText(p).replace(/\s+/g, ' ').trim();
}

function preText(p) {
  return inlineText(p).replace(/\r/g, '').replace(/[ \t]+$/g, '');
}

function styleOf(p) {
  const m = p.match(/<w:pStyle\s+w:val="([^"]+)"/);
  return m ? m[1] : '';
}

function tableToMd(tbl) {
  const rows = [];
  const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
  let tr;
  while ((tr = trRe.exec(tbl))) {
    const cells = [];
    const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
    let tc;
    while ((tc = tcRe.exec(tr[0]))) {
      const ps = tc[0].match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      cells.push(ps.map(paragraphText).filter(Boolean).join('<br>'));
    }
    // Drop fully empty leading/trailing cells (Word often emits grid padding).
    while (cells.length && cells[0] === '') cells.shift();
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push('');
    return out;
  });
  const esc = (s) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const header = norm[0];
  const sep = header.map(() => '---');
  const rest = norm.slice(1);
  return [
    `| ${header.map(esc).join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rest.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

function convertList(style, items) {
  if (!items.length) return '';
  if (/Number/i.test(style)) {
    return items.map((t, i) => `${i + 1}. ${t}`).join('\n');
  }
  return items.map((t) => `- ${t}`).join('\n');
}

const out = [];
if (title) out.push(`# ${title}`, '');

const tokenRe = /(<w:tbl\b[\s\S]*?<\/w:tbl>)|(<w:p\b[\s\S]*?<\/w:p>)/g;
let m;
let listStyle = null;
let listItems = [];
let pendingBlank = false;
let preLines = [];

function flushList() {
  if (listItems.length) {
    out.push(convertList(listStyle || '', listItems), '');
    listItems = [];
    listStyle = null;
  }
}

function flushPre() {
  if (!preLines.length) return;
  // De-indent by the common leading whitespace, then trim trailing spaces.
  const indents = preLines
    .filter((l) => l.trim() !== '')
    .map((l) => (l.match(/^[ \t]*/) || [''])[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  const lines = preLines.map((l) => l.slice(cut).replace(/[ \t]+$/g, ''));
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  out.push('```', ...lines, '```', '');
  preLines = [];
}

while ((m = tokenRe.exec(body))) {
  if (m[1]) {
    flushList();
    flushPre();
    const md = tableToMd(m[1]);
    if (md) out.push(md, '');
    continue;
  }
  const p = m[2];
  const style = styleOf(p);
  const isPre = /HTMLPreformatted|Code|SourceCode/i.test(style) ||
    /w:ascii="Consolas"|w:ascii="Courier New"/.test(p);

  if (isPre) {
    flushList();
    preLines.push(preText(p));
    pendingBlank = false;
    continue;
  }
  flushPre();

  const text = paragraphText(p);
  if (!text) {
    if (pendingBlank && out.length && out[out.length - 1] !== '') out.push('');
    pendingBlank = true;
    continue;
  }

  if (/^List/i.test(style)) {
    if (!listStyle) listStyle = style;
    listItems.push(text);
    pendingBlank = false;
    continue;
  }
  flushList();

  if (/^Heading\s*1$/i.test(style)) out.push(`# ${text}`, '');
  else if (/^Heading\s*2$/i.test(style)) out.push(`## ${text}`, '');
  else if (/^Heading\s*3$/i.test(style)) out.push(`### ${text}`, '');
  else if (/^Heading\s*4$/i.test(style)) out.push(`#### ${text}`, '');
  else if (/^Title$/i.test(style)) out.push(`# ${text}`, '');
  else if (/^Subtitle$/i.test(style)) out.push(`*${text}*`, '');
  else if (/^Quote$/i.test(style)) out.push(`> ${text}`, '');
  else out.push(text, '');
  pendingBlank = false;
}
flushList();
flushPre();

// Tidy: collapse 3+ blank lines, ensure single trailing newline.
let md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md, 'utf8');
console.log(`wrote ${outFile} (${md.length} chars)`);
