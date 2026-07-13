#!/usr/bin/env node
/*
 * apply-rulings.js — apply an export from the site's Data QA tab to data.json.
 *
 * The QA tab's "Export rulings + edits" button downloads a JSON file:
 *   { rulings: { "<id>": {val,ts} },        // free-text spot-check notes
 *     edits:   { "<id>": {orig,patch,ts} } } // structured field edits
 * where <id> is "date|sport|raw".
 *
 * Structured EDITS (distance/sport/note) are applied automatically. Free-text
 * RULINGS are printed for a human to interpret (they're natural language like
 * "swim 1.8k" or "drop — placement"), since they can't be safely auto-applied.
 *
 *   node tools/apply-rulings.js <export.json>            # dry run
 *   node tools/apply-rulings.js <export.json> --write     # apply edits to data.json
 *
 * Edits are byte-surgical so untouched rows keep their float formatting; meta is
 * rebuilt afterward if any sport changed (run `node validate-data.js` to confirm).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const WRITE = process.argv.includes('--write');
const exportPath = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
if (!exportPath) { console.error('usage: node tools/apply-rulings.js <export.json> [--write]'); process.exit(1); }

const exp = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
let text = fs.readFileSync(DATA, 'utf8');
const parseId = id => { const i = id.indexOf('|'), j = id.indexOf('|', i + 1); return { d: id.slice(0, i), s: id.slice(i + 1, j), r: id.slice(j + 1) }; };

function findObject(date, raw) {
  const anchor = `"r":${JSON.stringify(raw)}`;
  let from = 0, i;
  while ((i = text.indexOf(anchor, from)) !== -1) {
    const open = text.lastIndexOf('{', i), close = text.indexOf('}', i);
    if (open !== -1 && close !== -1) { const sub = text.slice(open, close + 1); try { if (JSON.parse(sub).d === date) return { open, close, sub }; } catch {} }
    from = i + anchor.length;
  }
  return null;
}
function setField(obj, key, valJson) {
  const re = new RegExp(`,"${key}":("(?:[^"\\\\]|\\\\.)*"|[\\d.]+)`);
  if (re.test(obj)) return obj.replace(re, `,"${key}":${valJson}`);
  return obj.slice(0, -1) + `,"${key}":${valJson}}`;   // insert before closing brace
}
function delField(obj, key) { return obj.replace(new RegExp(`,"${key}":("(?:[^"\\\\]|\\\\.)*"|[\\d.]+)`), ''); }

const edits = exp.edits || {};
let applied = 0, missing = 0, sportChanged = false;
for (const [id, e] of Object.entries(edits)) {
  const { d, r } = parseId(id);
  const found = findObject(d, r);
  if (!found) { missing++; console.warn('  edit target not found:', d, JSON.stringify(r)); continue; }
  let obj = found.sub; const p = e.patch || {};
  if (p.s && p.s !== e.orig.s) { obj = setField(obj, 's', JSON.stringify(p.s)); sportChanged = true; }
  if ('k' in p) { obj = (p.k === '' || p.k == null) ? delField(obj, 'k') : setField(obj, 'k', String(Number(p.k))); }
  if ('n' in p) { obj = (p.n === '' || p.n == null) ? delField(obj, 'n') : setField(obj, 'n', JSON.stringify(p.n)); }
  text = text.slice(0, found.open) + obj + text.slice(found.close + 1);
  applied++;
}

// If any sport changed, rebuild meta.sports/count/span from the rows.
if (sportChanged) {
  const data = JSON.parse(text);
  const sports = {}; let minD = null, maxD = null;
  for (const r of data.rows) { sports[r.s] = (sports[r.s] || 0) + 1; if (minD === null || r.d < minD) minD = r.d; if (maxD === null || r.d > maxD) maxD = r.d; }
  const meta = { generated: data.meta.generated, count: data.rows.length, span: [minD, maxD], sports };
  const marker = ',"rows":['; const idx = text.indexOf(marker);
  text = '{"meta":' + JSON.stringify(meta) + text.slice(idx);
}

console.log(`edits: ${applied} applied, ${missing} not found${sportChanged ? ' (meta rebuilt)' : ''}`);
const rulings = Object.entries(exp.rulings || {});
if (rulings.length) {
  console.log(`\nfree-text rulings to interpret by hand (${rulings.length}):`);
  for (const [id, v] of rulings) { const { d, s, r } = parseId(id); console.log(`  ${d} ${s} [${r}] -> "${v.val}"`); }
}
if (WRITE) {
  if (missing) { console.error('\nsome edits not matched — refusing to write'); process.exit(1); }
  JSON.parse(text); // validate JSON
  fs.writeFileSync(DATA, text);
  console.log('\nwritten to data.json — run `node validate-data.js` to confirm.');
} else {
  console.log('\n(dry run — pass --write to apply edits)');
}
