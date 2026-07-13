#!/usr/bin/env node
/*
 * dedup-grid-runs.js — drop grid run cells that duplicate an exact running-log run.
 *
 * The runs in data.json come from two sources: the precise running log (src="r",
 * one line per run, exact time + distance) and the weekly training grid (src="t",
 * Mike's shorthand summary of the same weeks). When the grid re-states a run that
 * is already in the running log, the two rows share the SAME finishing time on the
 * SAME day — but the grid's distance is a doubtful transcription that often differs
 * from the real one:
 *
 *   - a warmup folded into the figure  (2006-06-28: grid "21:08  7" = the 5 km
 *     Countdown Race + a 2 km warmup, but the 21:08 is the RACE only → running log
 *     records the truth, 5.0 km @ 21:08);
 *   - a rounded distance                (1991-09-19: grid 14 km vs log 13 km);
 *   - an interval rep-count misread      (1991-10-02: grid "4@1k int" → 4 km vs
 *     log 7 km total).
 *
 * These duplicates double-count the run and, worse, pair a race-only time with an
 * inflated distance — which then drives impossibly fast "records" (a phantom 5 km
 * PR of 15:06 at 3:01/km, etc). The running log is authoritative and exact for
 * runs (README / DECODING.md), so the grid duplicate is removed and the running-log
 * row is kept untouched. Matching is on identical day + identical finishing time,
 * so only genuine re-statements of the same run are dropped.
 *
 * Edits are done as targeted string surgery on the minified JSON so untouched rows
 * keep their exact formatting (e.g. "6.0" distances are not reflowed to "6"). After
 * writing, run `node validate-data.js --fix` to rebuild the derived meta block.
 *
 *   node tools/dedup-grid-runs.js            # dry run: report what would be dropped
 *   node tools/dedup-grid-runs.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// Per day, the set of finishing times (seconds) of running-log runs. A grid run
// whose time lands in this set is the same event, already recorded exactly.
const logRunTimes = {};
for (const r of data.rows) {
  if (r.src === 'r' && r.s === 'run' && typeof r.t === 'number') {
    (logRunTimes[r.d] || (logRunTimes[r.d] = new Set())).add(r.t);
  }
}
const isDuplicateGridRun = r =>
  r.src === 't' && r.s === 'run' && typeof r.t === 'number' &&
  logRunTimes[r.d] && logRunTimes[r.d].has(r.t);

// The exact-distance the running log holds for that day+time, for the report.
const logDistAt = (d, t) => {
  const m = data.rows.find(r => r.src === 'r' && r.s === 'run' && r.d === d && r.t === t);
  return m && m.k != null ? m.k : null;
};

// Walk the "rows":[ ... ] array and split it into the exact source substrings of
// each top-level row object (respecting strings/escapes so cell text can't fool us).
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

const kept = [];
const dropped = [];
spans.forEach(([s, e], i) => {
  if (isDuplicateGridRun(data.rows[i])) dropped.push(data.rows[i]);
  else kept.push(text.slice(s, e));
});

console.log(`grid run duplicates of exact running-log runs: ${dropped.length}`);
for (const r of dropped) {
  const ld = logDistAt(r.d, r.t);
  const mm = Math.floor(r.t / 60), ss = String(r.t % 60).padStart(2, '0');
  console.log(`  ${r.d}  drop grid ${JSON.stringify(r.r)}  (grid ${r.k} km @ ${mm}:${ss} → log has ${ld} km)`);
}

if (!WRITE) { console.log('\n(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }
if (!dropped.length) { console.log('\nnothing to drop.'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);                       // must still be valid JSON
if (check.rows.length !== data.rows.length - dropped.length) {
  console.error('row count mismatch after rebuild — aborting'); process.exit(1);
}
fs.writeFileSync(FILE, rebuilt);
console.log(`\nwritten to data.json (${dropped.length} rows removed). Now run: node validate-data.js --fix`);
