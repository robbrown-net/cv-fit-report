#!/usr/bin/env node
'use strict';
// Text extraction from PDF, DOCX, MD or TXT.
// Usage: node bin/extract.js <cv.pdf|docx|md|txt> <out.txt> [--force]
// Adapted from cv-agent-kit engine/pdf_info.js and engine/import_doc.js.
const fs = require('fs');
const path = require('path');

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => typeof i.str === 'string')
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.height || i.transform[3] || 10) }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= Math.max(2, it.h / 3)) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    const out = [];
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      let text = '';
      let endX = null;
      for (const it of ln.items) {
        if (endX !== null && it.s !== '') {
          const gap = it.x - endX;
          const cw = it.h * 0.5;
          if (gap > cw * 1.5) text += ' '.repeat(Math.min(Math.round(gap / cw), 12));
          else if (gap > cw * 0.2 && !text.endsWith(' ') && !it.s.startsWith(' ')) text += ' ';
        }
        text += it.s;
        endX = it.x + it.w;
      }
      out.push(text.replace(/\s+$/, ''));
    }
    pages.push(out.join('\n'));
    page.cleanup();
  }
  try { await doc.destroy(); } catch (_) { /* ignore */ }
  return pages.join('\n');
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return (await pdfText(file)).trim() + '\n';
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ path: file });
    return r.value.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(file, 'utf8');
  if (ext === '.doc') throw new Error('.doc is an old binary format. Please re-save it as .docx and try again.');
  throw new Error('unsupported file type "' + ext + '" (use .pdf, .docx, .md, .txt)');
}

module.exports = { extractText };

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const pos = args.filter((a) => a !== '--force');
  if (pos.length !== 2) { console.error('usage: node bin/extract.js <cv.pdf|docx|md|txt> <out.txt> [--force]'); process.exit(2); }
  const [file, out] = pos;
  if (!fs.existsSync(file)) { console.error('error: no such file: ' + file); process.exit(2); }
  if (fs.existsSync(out) && !force) { console.error('error: ' + out + ' exists; use --force to overwrite'); process.exit(3); }
  extractText(file).then((text) => {
    fs.writeFileSync(out, text, 'utf8');
    console.log('Wrote ' + out + ' (' + text.length + ' chars)');
  }).catch((e) => { console.error('error: ' + e.message); process.exit(1); });
}
