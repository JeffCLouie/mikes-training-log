#!/usr/bin/env node
/*
 * fix-triathlon-legs.js — un-garble the six early triathlons whose compound race
 * cells surfaced as physically-impossible "rides" in the Data QA → Outliers view.
 *
 * WHY
 *   A triathlon packs swim + T1 + bike + T2 + run + finish + placement into one
 *   stacked shorthand cell (see source/DECODING.md "Races / compound cells"). When
 *   build-data.js fragments such a cell it reliably mis-reads three things as bike
 *   rides, each producing an impossible average speed:
 *     - a finish/total line (H:MM:SS) read as a short M:SS bike time, with the
 *       adjacent placement digits ("49o13c") taken as the distance;
 *     - a bike-leg time that lost its leading digit (65:13 -> 5:13, ~12x too short);
 *     - a transition time (":59") or a swim distance in metres ("500") read as km.
 *   This is the same failure the 2018 Tremblant Half Ironman had — see
 *   tools/fix-tremblant-2018.js, whose approach this file follows.
 *
 *   Every leg below reconciles: the recovered swim/bike/run/transition times sum to
 *   the finish time printed in the same cell (checked to within a few seconds, the
 *   transitions the shorthand rounds away). The RUN leg of each race is already in
 *   the authoritative running log (src:"r", c:"x") and is LEFT UNTOUCHED — the grid
 *   run is never re-added, so the run is not double-counted (DECODING.md: the
 *   running log wins).
 *
 * THE SIX RACES  (raw cell -> reconciled legs; finish = sum of legs)
 *   1993-07-18  National Capital Tri  swim 1.5k/20:06 · bike 44k/1:14:40 · run 11.5k/46:41 · ~2:24
 *       legs already parsed correctly; only the "2:24: 15o3c" finish/place phantom (375 km/h) is dropped.
 *   1994-07-24  Kingston Tri          swim 2k/34:50 · bike 56k/1:35:39 · run 15k/1:05:57 · 3:18:17
 *       drop the "3:18:17 49o13c" finish/place phantom (161 km/h), an "av149 8 31" heart-rate
 *       phantom, and a grid run that duplicates the running-log race run.
 *   1995-08-27  Kingston Y Tri        swim 500m/7:44 · bike 38.4k/65:13 · run 11.5k/47:29 · 2:02:22
 *       restore the bike time 5:13 -> 65:13 (was 441.7 km/h), and recover the dropped
 *       swim leg (500 m / 7:44) from a distance-less "other" row.  [the reported entry]
 *   1996-08-05  Sharbot Lake Tri      swim 1k/16:47 · bike 50:10 · run 10k/39:59 · 1:48:49
 *       the bike's ":59" T2 time was read as 59 km (70.6 km/h); drop the bogus distance,
 *       keep the real 50:10 leg time (the cell records no bike distance).
 *   1996-08-11  Mactaquac Tri         swim 1k/16:33 · bike 30k/56:30 · run 7k/27:45 · 1:41:40
 *       a two-loop cell: the swim splits (7:12+9:21) and run splits (14:59+13:45) became
 *       four phantom bikes (60-233 km/h). Rebuild one swim (2x0.5k) and one bike (2x15k,
 *       28:15 each); the run (2x3.5k = 7k) is the running-log leg. Loop sum 1:41:47 ~ 1:41:40.
 *   1997-06-01  Perth Tri             swim 500m/7:51 · bike 16k/25:40 · run 3k/12:04 · 46:26
 *       "7:51 500" (swim) was read as a 50 km bike (382 km/h) -> recover the swim leg;
 *       the real bike kept 25:40 but took k=50 (should be 16, = the printed 37.4 km/h) -> fix;
 *       drop "2:04 3" (the run "12:04 3", already in the running log) and the "av37.4" fragment.
 *
 * Together these clear all 11 triathlon-caused entries from the Outliers view. (They
 * are a minority of the ~130 outliers — most are the recurring "N N" commute/interval
 * doubling and swim-set mis-parses, a separate root cause left for another pass.)
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep their
 * exact byte formatting. Each edit matches ONE whole minified row object exactly, and
 * every edit must match exactly once or the tool refuses to write. After writing, run
 * `node validate-data.js --fix` to rebuild the derived meta block.
 *
 *   node tools/fix-triathlon-legs.js            # dry run: report what would change
 *   node tools/fix-triathlon-legs.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// Reconciled race-summary notes. Placement tokens that don't follow the usual
// "Nc Noa" convention (1993, 1994) are preserved verbatim rather than guessed.
const NOTE = {
  natcap:   'RACE - National Capital Triathlon — swim 1.5 km 20:06 (T1 3:40), bike 44 km 1:14:40, run 11.5 km 46:41; finish ~2:24 (raw place "15o3c")',
  kingston: 'RACE - Kingston Triathlon — swim 2 km 34:50 (T1 1:18), bike 56 km 1:35:39 (T2 :31), run 15 km 1:05:57; finish 3:18:17 (raw place "49o13c")',
  kingstoY: 'RACE - Kingston Y Triathlon — swim 500 m 7:44 (T1 1:28), bike 38.4 km 65:13 (T2 :28), run 11.5 km 47:29; finish 2:02:22, 3rd overall',
  sharbot:  'RACE - Sharbot Lake Triathlon — swim 1 km 16:47 (T1 1:02), bike 50:10 (T2 :59), run 10 km 39:59; finish 1:48:49, 3rd in class / 13th overall',
  mactaquac:'RACE - Mactaquac Triathlon — swim 1 km 16:33 (2×0.5), bike 30 km 56:30 (2×15), run 7 km 27:45 (2×3.5); finish 1:41:40, 3rd in class / 6th overall',
  perth:    'RACE - Perth Triathlon — swim 500 m 7:51 (T1 :50), bike 16 km 25:40 (37.4 km/h), run 3 km 12:04; finish 46:26, 3rd in class / 5th overall',
};

// Each edit matches ONE exact minified row object and either rewrites or drops it.
const EDITS = [
  // --- 1993-07-18  National Capital Triathlon ---
  { match: '{"d":"1993-07-18","s":"note","r":"Nat.Cap.Tri","src":"t","c":"u"}',
    to:    '{"d":"1993-07-18","s":"note","r":"Nat.Cap.Tri","src":"t","c":"u","n":' + JSON.stringify(NOTE.natcap) + '}',
    why:   'Nat.Cap.Tri: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1993-07-18","s":"bike","r":"2:24: 15o3c","src":"t","c":"d","t":144,"k":15.0}',
    drop:  true,
    why:   'Nat.Cap.Tri: drop the finish/place line "2:24: 15o3c" mis-read as a 15 km / 375 km/h bike (real bike 44 km/1:14:40 already present)' },

  // --- 1994-07-24  Kingston Triathlon ---
  { match: '{"d":"1994-07-23","s":"note","r":"Kingston Tri","src":"t","c":"u"}',
    to:    '{"d":"1994-07-23","s":"note","r":"Kingston Tri","src":"t","c":"u","n":' + JSON.stringify(NOTE.kingston) + '}',
    why:   'Kingston Tri: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1994-07-23","s":"run","r":"15  1:05:57","src":"t","c":"d","t":3957,"k":15.0}',
    drop:  true,
    why:   'Kingston Tri: drop the grid run (15 km/1:05:57) that duplicates the running-log race run' },
  { match: '{"d":"1994-07-24","s":"bike","r":"av149 8 31","src":"t","c":"d","k":31.0,"a":149.0}',
    drop:  true,
    why:   'Kingston Tri: drop the "av149 8 31" phantom (an average-HR annotation, not a 31 km ride)' },
  { match: '{"d":"1994-07-24","s":"bike","r":":18:17 49o13c","src":"t","c":"d","t":1097,"k":49.0}',
    drop:  true,
    why:   'Kingston Tri: drop the finish/place line "3:18:17 49o13c" mis-read as a 49 km / 161 km/h bike' },

  // --- 1995-08-27  Kingston Y Triathlon  (the reported entry) ---
  { match: '{"d":"1995-08-26","s":"note","r":"kingston y tri","src":"t","c":"u"}',
    to:    '{"d":"1995-08-26","s":"note","r":"kingston y tri","src":"t","c":"u","n":' + JSON.stringify(NOTE.kingstoY) + '}',
    why:   'Kingston Y Tri: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1995-08-26","s":"other","r":"7:44 500 1:28","src":"t","c":"u","t":464}',
    to:    '{"d":"1995-08-26","s":"swim","r":"7:44 500 1:28","src":"t","c":"x","t":464,"k":0.5,"n":"Kingston Y Triathlon — swim leg (500 m)"}',
    why:   'Kingston Y Tri: recover the dropped swim leg (500 m / 7:44) from the distance-less "other" row' },
  { match: '{"d":"1995-08-27","s":"bike","r":"5:13 38.4","src":"t","c":"d","t":313,"k":38.4}',
    to:    '{"d":"1995-08-27","s":"bike","r":"65:13 38.4","src":"t","c":"x","t":3913,"k":38.4,"n":"Kingston Y Triathlon — bike leg"}',
    why:   'Kingston Y Tri: restore the bike time 5:13 -> 65:13 (was 441.7 km/h, now 35.3 km/h)' },

  // --- 1996-08-05  Sharbot Lake Triathlon ---
  { match: '{"d":"1996-08-05","s":"note","r":"Sharbot Lake","src":"t","c":"u"}',
    to:    '{"d":"1996-08-05","s":"note","r":"Sharbot Lake","src":"t","c":"u","n":' + JSON.stringify(NOTE.sharbot) + '}',
    why:   'Sharbot Lake Tri: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1996-08-05","s":"bike","r":"50:10     :59","src":"t","c":"d","t":3010,"k":59.0}',
    to:    '{"d":"1996-08-05","s":"bike","r":"50:10     :59","src":"t","c":"d","t":3010,"n":"Sharbot Lake Triathlon — bike leg (:59 = T2; distance not recorded)"}',
    why:   'Sharbot Lake Tri: drop the bogus 59 km distance (":59" is the T2 time), keep the real 50:10 bike leg' },

  // --- 1996-08-11  Mactaquac Triathlon  (two-loop cell) ---
  { match: '{"d":"1996-08-10","s":"note","r":"|mactaquac","src":"t","c":"u"}',
    to:    '{"d":"1996-08-10","s":"note","r":"|mactaquac","src":"t","c":"u","n":' + JSON.stringify(NOTE.mactaquac) + '}',
    why:   'Mactaquac Tri: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1996-08-10","s":"swim","r":"| .5      1","src":"t","c":"d","k":1.0}',
    to:    '{"d":"1996-08-10","s":"swim","r":"16:33 1","src":"t","c":"x","t":993,"k":1.0,"n":"Mactaquac Triathlon — swim leg (2×0.5 km, splits 7:12 + 9:21)"}',
    why:   'Mactaquac Tri: rebuild the swim leg (1 km / 16:33) from the two loop splits' },
  { match: '{"d":"1996-08-10","s":"bike","r":"|7:12    28","src":"t","c":"d","t":432,"k":28.0}',
    to:    '{"d":"1996-08-10","s":"bike","r":"56:30 30","src":"t","c":"x","t":3390,"k":30.0,"n":"Mactaquac Triathlon — bike leg (2×15 km, splits 28:15 + 28:15)"}',
    why:   'Mactaquac Tri: rebuild the bike leg (30 km / 56:30) in place of a 7:12 / 233 km/h phantom' },
  { match: '{"d":"1996-08-10","s":"bike","r":"|9:21    28","src":"t","c":"d","t":561,"k":28.0}',
    drop:  true,
    why:   'Mactaquac Tri: drop the "9:21 28" phantom (swim split, 180 km/h; folded into the rebuilt swim)' },
  { match: '{"d":"1996-08-10","s":"swim","r":"| 1:41:40 3","src":"t","c":"d","t":6100,"k":3.0}',
    drop:  true,
    why:   'Mactaquac Tri: drop the "1:41:40 3" phantom (the finish time, now in the note)' },
  { match: '{"d":"1996-08-11","s":"bike","r":"15    14:59","src":"t","c":"d","t":899,"k":15.0}',
    drop:  true,
    why:   'Mactaquac Tri: drop the "15 14:59" phantom (run split, 60 km/h; run is the running-log leg)' },
  { match: '{"d":"1996-08-11","s":"swim","r":"3.5","src":"t","c":"d","k":3.5}',
    drop:  true,
    why:   'Mactaquac Tri: drop the stray 3.5 (a run loop distance, not a swim)' },
  { match: '{"d":"1996-08-11","s":"bike","r":"15    13:45","src":"t","c":"d","t":825,"k":15.0}',
    drop:  true,
    why:   'Mactaquac Tri: drop the "15 13:45" phantom (run split, 65 km/h; run is the running-log leg)' },

  // --- 1997-06-01  Perth Triathlon ---
  { match: '{"d":"1997-06-01","s":"note","r":"Perth Tri","src":"t","c":"u"}',
    to:    '{"d":"1997-06-01","s":"note","r":"Perth Tri","src":"t","c":"u","n":' + JSON.stringify(NOTE.perth) + '}',
    why:   'Perth Tri: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1997-05-31","s":"bike","r":"7:51 50","src":"t","c":"d","t":471,"k":50.0}',
    to:    '{"d":"1997-05-31","s":"swim","r":"7:51 500","src":"t","c":"x","t":471,"k":0.5,"n":"Perth Triathlon — swim leg (500 m; T1 :50)"}',
    why:   'Perth Tri: recover the swim leg (500 m / 7:51) from the "7:51 500" mis-read as a 50 km / 382 km/h bike' },
  { match: '{"d":"1997-05-31","s":"bike","r":"av37.4","src":"t","c":"d","a":37.4}',
    drop:  true,
    why:   'Perth Tri: drop the "av37.4" fragment (the bike average speed, now noted on the bike leg)' },
  { match: '{"d":"1997-06-01","s":"bike","r":":50 25:40 16","src":"t","c":"d","t":1540,"k":50.0}',
    to:    '{"d":"1997-06-01","s":"bike","r":"25:40 16","src":"t","c":"x","t":1540,"k":16.0,"n":"Perth Triathlon — bike leg (37.4 km/h)"}',
    why:   'Perth Tri: fix the bike distance 50 -> 16 km (25:40 for 16 km = the printed 37.4 km/h; was 117 km/h)' },
  { match: '{"d":"1997-06-01","s":"bike","r":"2:04 3","src":"t","c":"d","t":124,"k":3.0}',
    drop:  true,
    why:   'Perth Tri: drop the "2:04 3" phantom (the run "12:04 3", already in the running log; was 87 km/h)' },
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
