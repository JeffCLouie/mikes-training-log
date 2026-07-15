#!/usr/bin/env node
/*
 * fix-bodyweight-other-rows.js — stop a logged body weight from becoming a
 * phantom 3-hour "other" session.
 *
 * WHAT WENT WRONG
 *   On scattered days Mike jotted his body weight in the grid's misc row (the
 *   same row that holds event names like "OAC relay"): a bare number in the
 *   180-191 range, sometimes tagged "lbs" or trailed by a stray note ("sore
 *   leg", "sk", "snowboa"). build-data.js had no sport to attach it to, so it
 *   became s="other" and then mis-read the weight three ways at once:
 *     - the weight was read as MINUTES, so 190 -> a 3:10:00 "session"
 *       (weight x 60 s); every one lands near 3 hours and inflates total time;
 *     - the same number was also stored as a HEART RATE (h=190 -> "190 bpm");
 *     - three rows carried a trailing figure read as a phantom distance
 *       (1992-09-17 "184  7.5" k=7.5, 1992-09-18 "188  5.5" k=5.5,
 *       1992-09-28 "190 2" k=2.0).
 *   These are unmistakably weights: two say "lbs", the values track Mike's
 *   weight across the years (his 2017 race note reads "~193 lbs"), and they sit
 *   in the grid's weight/notes row — not a workout.
 *
 * THE FIX
 *   Reclassify each as a note (same treatment as the race-total fix): keep the
 *   original shorthand in "r", drop the bogus t / h / k, and record the weight
 *   as readable note text ("body weight 190 lbs"). Any trailing fragment stays
 *   visible in "r" for a later ruling. No run/bike/swim row is touched.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact byte formatting. After writing, run `node validate-data.js --fix`
 * to rebuild the derived meta block (other -> note counts shift).
 *
 *   node tools/fix-bodyweight-other-rows.js            # dry run: report changes
 *   node tools/fix-bodyweight-other-rows.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// One entry per weight row. `match` is the exact minified row as it currently
// appears; `note` is the text it becomes. The rewrite keeps d/r/src/c, forces
// s="note", drops the bogus t/h/k, and sets n.
const TARGETS = [
  { match: '{"d":"1992-09-17","s":"other","r":"184        7.5","src":"t","c":"u","t":11040,"k":7.5,"h":184}',
    note: 'body weight 184 lbs' },
  { match: '{"d":"1992-09-18","s":"other","r":"188        5.5","src":"t","c":"u","t":11280,"k":5.5,"h":188}',
    note: 'body weight 188 lbs' },
  { match: '{"d":"1992-09-28","s":"other","r":"190 2","src":"t","c":"u","t":11400,"k":2.0,"h":190}',
    note: 'body weight 190 lbs' },
  { match: '{"d":"1995-06-15","s":"other","r":"180 sore leg","src":"t","c":"u","t":10800,"h":180}',
    note: 'body weight 180 lbs — sore leg' },
  { match: '{"d":"1998-01-02","s":"other","r":"191         sk","src":"t","c":"u","t":11460,"h":191}',
    note: 'body weight 191 lbs — sk' },
  { match: '{"d":"2003-02-21","s":"other","r":"187 snowboa","src":"t","c":"u","t":11220,"h":187}',
    note: 'body weight 187 lbs — snowboa' },
  { match: '{"d":"2012-05-14","s":"other","r":"186 ab 182 ar","src":"t","c":"u","t":11160,"h":186}',
    note: 'body weight 186→182 lbs' },
  { match: '{"d":"2012-06-26","s":"other","r":"185 -> 182","src":"t","c":"u","t":11100,"h":185}',
    note: 'body weight 185→182 lbs' },
  { match: '{"d":"2015-05-24","s":"other","r":"190 lbs","src":"t","c":"u","t":11400,"h":190}',
    note: 'body weight 190 lbs' },
  { match: '{"d":"2020-12-10","s":"other","r":"190 lbs","src":"t","c":"u","t":11400,"h":190}',
    note: 'body weight 190 lbs' },
];

// Build each rewrite from its match so the "other" -> "note" transform is
// mechanical: same d/r/src/c, s forced to note, t/h/k dropped, n set. Fixed key
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
