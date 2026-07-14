#!/usr/bin/env node
/*
 * fix-kennebunk-1994.js — untangle the six rows the parser stacked on 1994-08-07.
 *
 * WHAT WENT WRONG
 *   The weekly grid labels its blocks by month-code + day (e.g. "AU 7 - AU13").
 *   build-data.js anchors each block on the Monday of the week CONTAINING the
 *   label's start date. The "AU 7 - AU13" block's start (Aug 7 1994) is itself a
 *   SUNDAY, so it snapped back onto the Monday (Aug 1) of the PREVIOUS week —
 *   the same week the "AU 1 - AU 6" block already owns. Both blocks' Sunday
 *   columns therefore landed on 1994-08-07, merging two different real days:
 *
 *     - a plain Aug-6 training day (a 36 km ride + a 9.3 km "loop at home" run), and
 *     - the Aug-14 Kennebunk fire department triathlon (swim / bike / run legs).
 *
 *   The authoritative running log (source/running.log.txt) pins the true dates and
 *   is exact for runs (README / DECODING.md):
 *     19940806 0:40:42  9.3 km  "loop at home cclockwise"
 *     19940814 0:44:40 11.0 km  "RACE - Kennebunk fire department triathlon"
 *
 * THE FIX (six rows currently dated 1994-08-07)
 *   1. bike  "av35  147   36"  -> move to 1994-08-06 (its cell-mate run is the
 *                                  Aug-6 "loop at home" run; no ride is in the run log).
 *   2. run   "40:42 152  9.3"  -> DROP: a grid restatement of the exact Aug-6 running
 *                                  -log run (idx already present, src="r"). Mis-dated
 *                                  to Aug 7, so dedup-grid-runs.js never caught it.
 *   3. note  "Kennebunk"       -> move to 1994-08-14 (the race label).
 *   4. other ".4 8:28 1:23"    -> the SWIM leg: reclassify other->swim, add the
 *                                  0.4 km distance, keep the 8:28 swim time, record
 *                                  the 1:23 T1; move to 1994-08-14.
 *   5. bike  "46 73:30"        -> the BIKE leg (46 km / 1:13:30): move to 1994-08-14,
 *                                  label as the triathlon bike leg. (This is the entry
 *                                  that had been surfacing as the "Fastest 40K+ ride"
 *                                  record with no indication it was a race leg.)
 *   6. run   "~11 44:30"       -> DROP: the grid restatement of the exact Aug-14
 *                                  Kennebunk run leg (running log has 44:40; the grid
 *                                  "~" is an approximation of the same run).
 *
 *   After this, 1994-08-07 holds nothing (the parser had put everything there by
 *   mistake), Aug 14 reads as a proper swim+bike+run triathlon, and the two runs are
 *   no longer double-counted.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep their
 * exact byte formatting (e.g. "36.0" is not reflowed to "36"). After writing, run
 * `node validate-data.js --fix` to rebuild the derived meta block.
 *
 *   node tools/fix-kennebunk-1994.js            # dry run: report what would change
 *   node tools/fix-kennebunk-1994.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// Each edit matches ONE exact minified row object and either rewrites or drops it.
// Matching the whole object (not just a field) makes each target unambiguous.
const EDITS = [
  { match: '{"d":"1994-08-07","s":"bike","r":"av35  147   36","src":"t","c":"d","k":36.0,"h":147,"a":35.0}',
    to:    '{"d":"1994-08-06","s":"bike","r":"av35  147   36","src":"t","c":"d","k":36.0,"h":147,"a":35.0}',
    why:   'move Aug-6 training ride off the merged date' },
  { match: '{"d":"1994-08-07","s":"run","r":"40:42 152  9.3","src":"t","c":"d","t":2442,"k":9.3,"h":152}',
    drop:  true,
    why:   'duplicate of exact Aug-6 running-log run (loop at home)' },
  { match: '{"d":"1994-08-07","s":"note","r":"Kennebunk","src":"t","c":"u"}',
    to:    '{"d":"1994-08-14","s":"note","r":"Kennebunk","src":"t","c":"u"}',
    why:   'move race label to the real triathlon date' },
  { match: '{"d":"1994-08-07","s":"other","r":".4 8:28 1:23","src":"t","c":"u","t":508}',
    to:    '{"d":"1994-08-14","s":"swim","r":".4 8:28 1:23","src":"t","c":"d","t":508,"k":0.4,"n":"RACE - Kennebunk fire department triathlon - swim leg (0.4 km); T1 1:23"}',
    why:   'reclassify triathlon swim leg (other->swim, +0.4 km) and move to Aug 14' },
  { match: '{"d":"1994-08-07","s":"bike","r":"46 73:30","src":"t","c":"d","t":4410,"k":46.0}',
    to:    '{"d":"1994-08-14","s":"bike","r":"46 73:30","src":"t","c":"d","t":4410,"k":46.0,"n":"RACE - Kennebunk fire department triathlon - bike leg"}',
    why:   'move triathlon bike leg to Aug 14 and label it as a race leg' },
  { match: '{"d":"1994-08-07","s":"run","r":"~11 44:30","src":"t","c":"d","t":2670,"k":11.0}',
    drop:  true,
    why:   'duplicate of exact Aug-14 Kennebunk running-log run leg' },
];

const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// Split the "rows":[ ... ] array into the exact source substring of each row object
// (respecting strings/escapes so cell text can't fool the brace counter).
const arrOpen = text.indexOf('[', text.indexOf('"rows":'));
const spans = [];
let depth = 0, objStart = -1, inStr = false, esc = false, end = -1;
for (let i = arrOpen + 1; i < text.length; i++) {
  const ch = text[i];
  if (inStr) {
    if (esc) esc = false;
    else if (ch === '\\') esc = true;
    else if (ch === '"') inStr = false;
    continue;
  }
  if (ch === '"') inStr = true;
  else if (ch === '{') { if (depth++ === 0) objStart = i; }
  else if (ch === '}') { if (--depth === 0) spans.push([objStart, i + 1]); }
  else if (ch === ']' && depth === 0) { end = i; break; }
}
if (end === -1) { console.error('FAIL  could not parse the rows array; refusing to touch the file.'); process.exit(1); }
if (spans.length !== data.rows.length) {
  console.error(`FAIL  scanned ${spans.length} row objects but JSON has ${data.rows.length}; refusing to touch the file.`);
  process.exit(1);
}

const hit = new Array(EDITS.length).fill(0);
const kept = [];
let modified = 0, dropped = 0;
for (const [s, e] of spans) {
  const sub = text.slice(s, e);
  const idx = EDITS.findIndex(ed => ed.match === sub);
  if (idx === -1) { kept.push(sub); continue; }
  hit[idx]++;
  const ed = EDITS[idx];
  if (ed.drop) { dropped++; console.log(`  DROP    ${ed.why}`); }
  else { kept.push(ed.to); modified++; console.log(`  REWRITE ${ed.why}`); }
}

// Every edit must match exactly once, or something drifted — refuse to write.
const problems = EDITS.filter((_, i) => hit[i] !== 1);
if (problems.length) {
  console.error('\nFAIL  these edits did not match exactly once (data.json may already be fixed or changed):');
  for (const p of problems) console.error(`   [${hit[EDITS.indexOf(p)]}x] ${p.match}`);
  process.exit(1);
}

console.log(`\n${modified} rows rewritten, ${dropped} rows dropped.`);
if (!WRITE) { console.log('(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);                        // must still be valid JSON
if (check.rows.length !== data.rows.length - dropped) {
  console.error('row count mismatch after rebuild — aborting'); process.exit(1);
}
fs.writeFileSync(FILE, rebuilt);
console.log(`written to data.json (${dropped} rows removed). Now run: node validate-data.js --fix`);
