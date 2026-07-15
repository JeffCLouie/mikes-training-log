#!/usr/bin/env node
/*
 * fix-race-total-other-rows.js — stop a race's finishing TIME from counting as
 * a phantom "other" sport.
 *
 * WHAT WENT WRONG
 *   Companion to fix-triathlon-other-rows.js. That script handled the triathlon
 *   days where swim+bike+run were all parsed; this one handles the remaining
 *   race days where the finishing line still landed in s="other":
 *
 *   1. Multi-sport TOTALS with an explicit keyword or placement marker that the
 *      grid parser could not attach to a sport —
 *        1992-06-28 "total 2:25:39", 1993-06-27 "tot 2:26:49",
 *        1994-06-25 "Total 58:54", 1994-08-27 "Total 4:57:15",
 *        1995-08-27 "2:02:22 oa", 2017-08-06 "8.1 1:47:08".
 *   2. Single-sport race FINISH TIMES duplicated into an "other" row when the
 *      day's real result already lives on the running-log run for that date —
 *        1993-01-31 42:22 (== Richmond 10K run), the Dalhousie Lake Shuffles
 *        (2016/2018/2020), the Ottawa Race Weekend Halves (2015/2016), and
 *        2019-09-15 (MEC Trail 13k). Each "other" time equals the same-day run.
 *
 *   Either way the site counts "other" as a real sport and the aggregate time
 *   masquerades as a session — most visibly, 1994-08-27 "Total 4:57:15" was the
 *   site's "Longest session", ahead of the genuine 1991 marathon.
 *
 * THE FIX
 *   Reclassify each such "other" row as a note (same treatment as the triathlon
 *   fix): keep the original shorthand in "r", drop the aggregate "t" (and, for
 *   2017-08-06, the phantom 8.1 km that duplicated the run leg), and preserve the
 *   finish time as readable note text. No run/bike/swim leg is touched; the
 *   running-log run remains the source of truth for every single-sport race.
 *
 * DELIBERATELY OUT OF SCOPE (left for a separate, per-row ruling)
 *   - Race LEGS misparsed as "other" — swim/run splits that still carry real
 *     split data and should be reclassified to their actual sport, not a note
 *     (e.g. 1995-06-24 "10:00 500 2:00", 1995-08-26 "7:44 500 1:28",
 *     1996-09-21 "400yd 5:36", 1997-07-13 "k 30:12", 1994-10-02 "18:22 177").
 *   - Body-weight logged as a 3-hour session — a number read as minutes
 *     (e.g. 2015-05-24 "190 lbs" -> 3:10:00, plus training-day siblings like
 *     "190 2", "191 sk"). A distinct parse bug, not a race total.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact byte formatting. After writing, run `node validate-data.js --fix`
 * to rebuild the derived meta block (other -> note counts shift).
 *
 *   node tools/fix-race-total-other-rows.js            # dry run: report changes
 *   node tools/fix-race-total-other-rows.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// One entry per target "other" row. `match` is the exact minified row as it
// currently appears; `note` is the race text it becomes. The rewrite keeps
// d/r/src/c, forces s="note", drops t (and k), and sets n.
const TARGETS = [
  { match: '{"d":"1992-06-28","s":"other","r":"total  2:25:39","src":"t","c":"u","t":8739}',
    note: 'Gatineau Triathlon — finish 2:25:39' },
  { match: '{"d":"1993-01-31","s":"other","r":"42:22","src":"t","c":"u","t":2542}',
    note: 'Richmond 10K — finish 42:22' },
  { match: '{"d":"1993-06-27","s":"other","r":"tot 2:26:49","src":"t","c":"u","t":8809}',
    note: 'Gatineau Triathlon — finish 2:26:49' },
  { match: '{"d":"1994-06-25","s":"other","r":"Total 58:54","src":"t","c":"u","t":3534}',
    note: "Smith's Falls Triathlon — finish 58:54" },
  { match: '{"d":"1994-08-27","s":"other","r":"1:30  1:40:21","src":"t","c":"u","t":90}',
    note: 'Ottawa River — race split (1:40:21, T 1:30)' },
  { match: '{"d":"1994-08-27","s":"other","r":"Total 4:57:15","src":"t","c":"u","t":17835}',
    note: 'Ottawa River — total 4:57:15' },
  { match: '{"d":"1995-08-27","s":"other","r":"2:02:22 oa","src":"t","c":"u","t":7342}',
    note: 'Triathlon — finish 2:02:22 (overall placement)' },
  { match: '{"d":"2004-10-10","s":"other","r":"Shuffle 41:16","src":"t","c":"u","t":2476}',
    note: 'Dalhousie Lake Shuffle — finish 41:16' },
  { match: '{"d":"2015-05-24","s":"other","r":"1:39:43","src":"t","c":"u","t":5983}',
    note: 'Ottawa Race Weekend Half — finish 1:39:43' },
  { match: '{"d":"2016-05-29","s":"other","r":"1:50:29","src":"t","c":"u","t":6629}',
    note: 'Ottawa Race Weekend Half — finish 1:50:29' },
  { match: '{"d":"2016-10-09","s":"other","r":"21:03","src":"t","c":"u","t":1263}',
    note: 'Dalhousie Lake Shuffle — finish 21:03' },
  { match: '{"d":"2017-08-06","s":"other","r":"8.1 1:47:08","src":"t","c":"u","t":6428,"k":8.1}',
    note: 'Deep River Triathlon — finish 1:47:08' },
  { match: '{"d":"2018-10-07","s":"other","r":"21:21","src":"t","c":"u","t":1281}',
    note: 'Dalhousie Lake Shuffle — finish 21:21' },
  { match: '{"d":"2019-09-15","s":"other","r":"1:30:10","src":"t","c":"u","t":5410}',
    note: 'MEC Trail 13k — finish 1:30:10' },
  { match: '{"d":"2020-10-11","s":"other","r":"23:20","src":"t","c":"u","t":1400}',
    note: 'Dalhousie Lake Shuffle — finish 23:20' },
];

// Build each rewrite from its match so the "other" -> "note" transform is
// mechanical: same d/r/src/c, s forced to note, t/k dropped, n set. Fixed key
// order (d, s, r, src, c, n) matches the note rows already in the file.
const EDITS = TARGETS.map(({ match, note }) => {
  const o = JSON.parse(match);
  const rebuilt = { d: o.d, s: 'note', r: o.r, src: o.src, c: o.c, n: note };
  return { match, to: JSON.stringify(rebuilt), why: `${o.d} ${o.s} -> note (${note})` };
});

const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// Split the "rows":[ ... ] array into the exact source substring of each row
// object (respecting strings/escapes so cell text can't fool the brace counter).
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
let modified = 0;
for (const [s, e] of spans) {
  const sub = text.slice(s, e);
  const idx = EDITS.findIndex(ed => ed.match === sub);
  if (idx === -1) { kept.push(sub); continue; }
  hit[idx]++;
  kept.push(EDITS[idx].to);
  modified++;
  console.log(`  REWRITE ${EDITS[idx].why}`);
}

// Every edit must match exactly once, or something drifted — refuse to write.
const problems = EDITS.filter((_, i) => hit[i] !== 1);
if (problems.length) {
  console.error('\nFAIL  these edits did not match exactly once (data.json may already be fixed or changed):');
  for (const p of problems) console.error(`   [${hit[EDITS.indexOf(p)]}x] ${p.match}`);
  process.exit(1);
}

console.log(`\n${modified} rows reclassified other -> note.`);
if (!WRITE) { console.log('(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);                        // must still be valid JSON
if (check.rows.length !== data.rows.length) {
  console.error('row count changed after rebuild — aborting'); process.exit(1);
}
fs.writeFileSync(FILE, rebuilt);
console.log('written to data.json. Now run: node validate-data.js --fix');
