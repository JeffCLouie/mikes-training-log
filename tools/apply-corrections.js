#!/usr/bin/env node
/*
 * apply-corrections.js — apply the provably-correct data fixes to data.json.
 *
 * Scope (intentionally conservative): only fixes that are unambiguous. Right now
 * that is the race-result cells where a finishing place (Nc = in class, Noa =
 * overall) was misread as a distance (k). A place is not a distance, so the k is
 * removed and the placement is preserved as a note. Ambiguous grid distances are
 * NOT touched here — those need Mike's rulings (see source/mike-review.md).
 *
 * Edits are done as targeted string surgery on the minified JSON so untouched
 * rows keep their exact formatting (e.g. "6.0" distances are not reflowed).
 *
 *   node tools/apply-corrections.js            # dry run: report what would change
 *   node tools/apply-corrections.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');
const ord = n => { n = +n; const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

let text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// Find the exact object substring in `text` for a row (matched by date + raw),
// so we edit the file's real bytes (distances are stored as floats like "13.0"
// which a JSON round-trip would silently reflow to "13").
function findObject(date, raw) {
  const anchor = `"r":${JSON.stringify(raw)}`;
  let from = 0, i;
  while ((i = text.indexOf(anchor, from)) !== -1) {
    const open = text.lastIndexOf('{', i);
    const close = text.indexOf('}', i);
    if (open !== -1 && close !== -1) {
      const sub = text.slice(open, close + 1);
      try { if (JSON.parse(sub).d === date) return { open, close, sub }; } catch {}
    }
    from = i + anchor.length;
  }
  return null;
}

const targets = data.rows.filter(r => /\d+\s*oa/.test(r.r || '') && r.k != null);
let applied = 0, missing = 0, kmRemoved = 0;
for (const r of targets) {
  const found = findObject(r.d, r.r);
  if (!found) { missing++; console.warn('  NOT FOUND (skipped):', r.d, JSON.stringify(r.r)); continue; }
  // build placement note from the raw cell (strip the total time first)
  const mT = (r.r.match(/\d+:\d\d(?::\d\d)?/) || [])[0];
  const rest = mT ? r.r.replace(mT, '') : r.r;
  const cls = (rest.match(/(\d+)\s*c(?=\d|\b|\s|$)/) || [])[1];
  const oa = (rest.match(/(\d+)\s*oa/) || [])[1];
  const parts = [];
  if (cls) parts.push(`${ord(cls)} in class`);
  if (oa) parts.push(`${ord(oa)} overall`);
  const note = 'race result: ' + parts.join(', ');
  // edit the real substring: strip ,"k":<num> and add/merge the note before }
  let obj = found.sub.replace(/,"k":[\d.]+/, '');
  kmRemoved += r.k;
  const noteJson = JSON.stringify(r.n ? `${r.n}; ${note}` : note);
  if (/"n":/.test(obj)) obj = obj.replace(/"n":("(?:[^"\\]|\\.)*")/, `"n":${noteJson}`);
  else obj = obj.slice(0, -1) + `,"n":${noteJson}}`;
  text = text.slice(0, found.open) + obj + text.slice(found.close + 1);
  applied++;
}

console.log(`race-place fixes: ${applied} rows corrected, ${missing} not matched`);
console.log(`phantom distance removed: ${Math.round(kmRemoved)} km`);
if (WRITE && missing === 0) {
  // sanity: still valid JSON and same row count before writing
  const check = JSON.parse(text);
  if (check.rows.length !== data.rows.length) { console.error('row count changed — aborting'); process.exit(1); }
  fs.writeFileSync(FILE, text);
  console.log('written to data.json');
} else if (WRITE) {
  console.error('some rows not matched — refusing to write');
  process.exit(1);
} else {
  console.log('(dry run — pass --write to apply)');
}
