#!/usr/bin/env node
/*
 * fix-tremblant-2018.js — un-garble the Tremblant Half Ironman on 2018-06-24.
 *
 * WHAT WENT WRONG
 *   The Sunday cell of the "JN 18 - JN 24" 2018 block packs a whole Half Ironman
 *   race into four stacked shorthand lines:
 *
 *     | 5:20:29 Tremblant HI        <- finish 5:20:29, event name
 *     |35:14 1.9 2:41:46 90         <- swim 35:14 / 1.9 km · bike 2:41:46 / 90 km
 *     |      21.1 1:57:57  59/247   <- run 21.1 km / 1:57:57 · 59th of 247 in division
 *     |  t1 3:45 t2 1:47   720/2627 <- T1 3:45, T2 1:47 · 720th of 2627 overall
 *
 *   The legs reconcile exactly: swim 35:14 + T1 3:45 + bike 2:41:46 + T2 1:47 +
 *   run 1:57:57 = 5:20:29 (the printed finish). But build-data.js fragmented the
 *   block and mis-read it:
 *     - the swim leg (35:14 / 1.9 km) was dropped entirely;
 *     - the bike leg kept its 90 km but lost its time (":46 90");
 *     - the run time + division place ("1:57:57 59/247") became a bogus BIKE of
 *       59 km in 7:57 — an impossible 445 km/h, the extreme outlier that surfaced
 *       on the Records page and led here;
 *     - the T2 + overall place ("t2 1:47 720/2627") became a bogus 47 km bike;
 *     - the event line collapsed to a stray "lant HI" note.
 *
 *   The authoritative running log already carries the run leg exactly, so it is
 *   the source of truth for the run and is left untouched:
 *     20180624  1:57:30  21.1 km  "RACE - Tremblant Half Ironman Triathlon"
 *   (The grid's 1:57:57 is the same run; per DECODING.md the running log wins, so
 *   the grid run figure is not re-added — no double count.)
 *
 * THE FIX (four grid rows currently dated 2018-06-24; the running-log run is kept)
 *   1. note  "lant HI"          -> rebuild as the race summary: finish time,
 *                                  transitions, and both placements as a note.
 *   2. bike  ":46 90"           -> the BIKE leg: restore the 2:41:46 time (9706 s),
 *                                  keep 90 km, promote to confident, label the leg.
 *   3. bike  "7:57  59/247"     -> was the run time + division place mis-read as a
 *                                  bike. Re-purpose the row as the recovered SWIM
 *                                  leg (35:14 / 1.9 km); the run itself is already
 *                                  in the running log, the place is in the note.
 *   4. bike  ":47   720/2627"   -> DROP: T2 + overall place, both captured in the
 *                                  note; not a ride.
 *
 *   After this, 2018-06-24 reads as a proper swim + bike + run Half Ironman with a
 *   race-summary note, the 445 km/h phantom is gone, and the day's distance drops
 *   from a chart-topping 217 km (21.1 + 90 + 59 + 47) to a real 113 km
 *   (21.1 run + 1.9 swim + 90 bike).
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact byte formatting (e.g. "90.0" is not reflowed to "90"). After writing,
 * run `node validate-data.js --fix` to rebuild the derived meta block.
 *
 *   node tools/fix-tremblant-2018.js            # dry run: report what would change
 *   node tools/fix-tremblant-2018.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

const NOTE = 'RACE - Tremblant Half Ironman — finish 5:20:29 (swim 35:14, T1 3:45, bike 2:41:46, T2 1:47, run 1:57:57); 59/247 in division, 720/2627 overall';

// Each edit matches ONE exact minified row object and either rewrites or drops it.
// Matching the whole object (not just a field) makes each target unambiguous.
const EDITS = [
  { match: '{"d":"2018-06-24","s":"note","r":"lant HI","src":"t","c":"u"}',
    to:    '{"d":"2018-06-24","s":"note","r":"5:20:29 Tremblant HI","src":"t","c":"u","n":' + JSON.stringify(NOTE) + '}',
    why:   'rebuild the collapsed event line into the race-summary note' },
  { match: '{"d":"2018-06-24","s":"bike","r":":46 90","src":"t","c":"d","k":90.0}',
    to:    '{"d":"2018-06-24","s":"bike","r":"2:41:46 90","src":"t","c":"x","t":9706,"k":90.0,"n":"Tremblant Half Ironman — bike leg"}',
    why:   'restore the bike leg time (2:41:46) and label the race leg' },
  { match: '{"d":"2018-06-24","s":"bike","r":"7:57  59/247","src":"t","c":"d","t":477,"k":59.0}',
    to:    '{"d":"2018-06-24","s":"swim","r":"35:14 1.9","src":"t","c":"x","t":2114,"k":1.9,"n":"Tremblant Half Ironman — swim leg"}',
    why:   'recover the dropped swim leg (35:14 / 1.9 km) in place of the 445 km/h phantom' },
  { match: '{"d":"2018-06-24","s":"bike","r":":47   720/2627","src":"t","c":"d","k":47.0}',
    drop:  true,
    why:   'T2 + overall place (both in the note) — not a ride' },
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
console.log(`written to data.json (${dropped} row removed). Now run: node validate-data.js --fix`);
