#!/usr/bin/env node
/*
 * fix-triathlon-other-rows.js — stop a triathlon's summary line from counting
 * as a phantom 4th sport.
 *
 * WHAT WENT WRONG
 *   A race day packs the whole triathlon into one stacked grid cell: an event
 *   name, the swim / bike / run legs, and a final line with the finishing TOTAL
 *   and placement (see source/DECODING.md "Races / compound cells"). That last
 *   line has no sport letter, so build-data.js could not tell it was the total —
 *   it dropped the cell into s="other". The site then treats "other" as a real
 *   sport, so every such day reads as FOUR sports (Run, Swim, Bike, Other) and
 *   tops the Records page's "Most sports in a day" with a race that was really a
 *   three-sport triathlon. The stray "other" time (e.g. 1:59:36) is also the
 *   race total — an aggregate of the legs, not a session of its own — so it
 *   double-counts against "Longest session" and the like.
 *
 *   Example — 1991-08-05 Sharbot Lake Triathlon:
 *     | Sharbot lake        <- event (note)
 *     | 19:00s1k 1:30t      <- swim 19:00 / 1k / T1 1:30
 *     | 53:34b32k 1:05      <- bike 53:34 / 32k / T2 1:05
 *     | 44:20r10k           <- run 44:20 / 10k   (from the running log)
 *     | 1:59:3613c62oa      <- TOTAL 1:59:36 / 13th class / 62nd overall  -> s="other"
 *
 * THE FIX
 *   On every swim+bike+run day that also carries an "other" row, reclassify that
 *   "other" row as a note (mirroring fix-tremblant-2018.js, which turned the same
 *   finish-line summary into a race note). The original shorthand in "r" is kept
 *   verbatim for the Raw Data view; the aggregate "t" is dropped so it can no
 *   longer masquerade as a session; the finish time / placement is preserved as
 *   readable note text. Some of these rows are a finishing total, others a split
 *   or transition — but on a triathlon day none is a genuine separate sport, so
 *   all become notes. Notes are excluded from every sport/time/distance rollup,
 *   so "Most sports in a day" drops back to the correct 3 and the phantom session
 *   time disappears; no swim/bike/run leg is touched.
 *
 *   These rows are exactly mike-review.md "Batch 1" (race results parsed as
 *   distances) for the triathlon days — the phantom `k` was already removed; this
 *   completes the ruling by clearing the phantom sport too.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact byte formatting. After writing, run `node validate-data.js --fix`
 * to rebuild the derived meta block (other -> note counts shift).
 *
 *   node tools/fix-triathlon-other-rows.js            # dry run: report changes
 *   node tools/fix-triathlon-other-rows.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// One entry per triathlon day. `match` is the exact minified "other" row as it
// currently appears; `note` is the race-summary text it becomes. The rewritten
// row keeps d/r/src/c, forces s="note", drops the aggregate t, and sets n.
const TARGETS = [
  { match: '{"d":"1991-08-05","s":"other","r":"1:59:3613c62oa","src":"t","c":"u","t":7176,"n":"race result: 13th in class, 62nd overall"}',
    note: 'Sharbot Lake Triathlon — finish 1:59:36; 13th in class, 62nd overall' },
  { match: '{"d":"1992-08-03","s":"other","r":"1:54:06 7c25oa --------------","src":"t","c":"u","t":6846,"n":"race result: 7th in class, 25th overall"}',
    note: 'Sharbot Lake Triathlon — finish 1:54:06; 7th in class, 25th overall' },
  { match: '{"d":"1992-09-12","s":"other","r":"2:20:57 total","src":"t","c":"u","t":8457}',
    note: 'World Triathlon Championships — finish 2:20:57' },
  { match: '{"d":"1995-05-07","s":"other","r":"500 7:44 3:13","src":"t","c":"u","t":464}',
    note: 'Early Bird Triathlon — race split (500 7:44 3:13)' },
  { match: '{"d":"1995-07-08","s":"other","r":"27:26     1:30","src":"t","c":"u","t":1646}',
    note: 'OAC Triathlon — race split (27:26, T 1:30)' },
  { match: '{"d":"1995-08-07","s":"other","r":"1:52:50 6c14oa","src":"t","c":"u","t":6770,"n":"race result: 6th in class, 14th overall"}',
    note: 'Sharbot Lake Triathlon — finish 1:52:50; 6th in class, 14th overall' },
  { match: '{"d":"1996-08-05","s":"other","r":"39:59","src":"t","c":"u","t":2399}',
    note: 'Sharbot Lake Triathlon — run split 39:59' },
  { match: '{"d":"1996-08-18","s":"other","r":"2:04:08 2c8oa","src":"t","c":"u","t":7448,"n":"race result: 2nd in class, 8th overall"}',
    note: 'Parlee Beach Triathlon — finish 2:04:08; 2nd in class, 8th overall' },
  { match: '{"d":"2001-08-05","s":"other","r":"3:38","src":"t","c":"u","t":218}',
    note: 'Deep River Triathlon — race split 3:38' },
  { match: '{"d":"2002-08-04","s":"other","r":"1:37:37","src":"t","c":"u","t":5857}',
    note: 'Deep River Triathlon — finish 1:37:37' },
  // NOTE: the 2018-06-23 "| 5:20:29 Trem" row is a date-drift duplicate of the real
  // 2018-06-24 Tremblant Half Ironman; it is DROPPED entirely by
  // fix-triathlon-transitions.js, so it is intentionally not reclassified here.
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
