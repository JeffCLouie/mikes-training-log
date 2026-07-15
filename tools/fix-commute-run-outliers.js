#!/usr/bin/env node
/*
 * fix-commute-run-outliers.js — clear the recurring non-triathlon impossible-speed
 * entries in the Data QA → Outliers view. These are NOT one-off garbled race cells
 * (see fix-triathlon-legs*.js for those); they are two systematic parser mistakes
 * that repeat across the 2005–2022 grid, plus a few small pattern variants.
 *
 * SAFETY: this tool only ever touches rows that are CURRENTLY physically-impossible
 * outliers (bike > 60 km/h). Every valid row is out of scope by construction. Each
 * targeted row is matched by exact (date, shorthand); the run counts before writing.
 *
 * THE TWO SYSTEMATIC MISTAKES
 *
 * 1. Commute-pair distance logs read as a timed ride  (STRIP TIME)
 *    On a normal commuting day Mike logged two ride legs as bare distances, e.g.
 *    "25 25" (25 km in, 25 km out) or "18 + 19". build-data.js kept the summed
 *    distance (50 km, 37 km) but ALSO read the first number as a duration in minutes
 *    (25 → 25:00), implying 50 km in 25 min = 120 km/h. The distance is fine; the
 *    duration is fabricated. Fix: drop the time, leaving a distance-only ride — the
 *    exact shape Mike's genuine distance-only rides already have (e.g. a "55" Sunday
 *    ride parses with no time and is never flagged). Distances are UNCHANGED, so
 *    annual bike totals do not move. Verified against 2011 (≈36 km/day × commute days
 *    ≈ the logged 3306 km) and the weekly figures in the grid.
 *    This also covers the same shape with an average-speed annotation ("18 a28 18a36"),
 *    an interval note ("18 1on2off 34", "18 32 IMS") or a trailing week-total ("18 18 192").
 *
 * 2. A run read as a bike  (DROP as duplicate)
 *    A run logged in the grid as "distance time" — "8 50" = 8 km in 50:xx, "9 46" =
 *    9 km in 46:00 — lost its time's seconds/colon and was read as a bike (8 km in
 *    8 min = 375 km/h). The run itself is already in the authoritative running log
 *    (src:"r"), so the grid bike is a duplicate artifact. Fix: drop it (same rule as
 *    tools/dedup-grid-runs.js). Each drop below is guarded: the tool refuses unless a
 *    real running-log run exists on that date.
 *
 * SMALL VARIANTS
 *   - Swim sets "100m in 1:05 2" / "100 in 1:06 2" (100 m repeats, 2 km total) were
 *     read as 2 km bikes at ~110 km/h → reclassified to distance-only 2 km swims.
 *   - "N a M" single rides ("21 a 34" = 21 km at avg 34 km/h) had the average speed
 *     taken as the distance (k=34) and the distance as minutes → rebuilt as k=N with
 *     the time implied by the average (t = N / M · 3600).
 *
 * LEFT FOR MIKE (reported, not changed here)
 *   - 4 grid "runs" read as bikes ("10 52" 2015-06-13, "8 40:24" 2019-09-02,
 *     "9 46" 2019-12-07, "9 46;0" 2020-05-25) that are NOT in the running log — can't
 *     prove they duplicate a logged run, so they are left for Mike rather than dropped.
 *   - The 10 impossible-PACE run entries (a mis-keyed distance/time in the running log
 *     or an interval split) — these need Mike's memory of the real figure and are
 *     already catalogued in source/mike-review.md (Batch 4).
 *
 *   node tools/fix-commute-run-outliers.js            # dry run
 *   node tools/fix-commute-run-outliers.js --write    # apply, then: node validate-data.js --fix
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

const k = (d, r) => d + '|' + r;

// (2) runs read as bikes — drop as duplicates of the authoritative running-log run.
const DROP_DUP = new Set([
  k('2017-07-01', '10 53'), k('2018-03-24', '8 50'),  k('2018-04-17', '10 54'),
  k('2018-04-20', '10 51'), k('2019-07-27', '9 45'),  k('2019-08-03', '9 50 15'),
  k('2019-11-06', '8 44'),  k('2019-12-08', '8 41'),  k('2020-05-30', '9 46'),
  k('2020-06-01', '9  46'), k('2020-08-12', '10 50'), k('2022-01-07', '6 5:16'),
]);

// runs read as bikes with NO running-log run on that date — leave for Mike (report).
const LEAVE = new Set([
  k('2015-06-13', '10 52'), k('2019-09-02', '8 40: 24'),
  k('2019-12-07', '9 46'),  k('2020-05-25', '9 46;0'),
]);

// swim sets read as bikes — reclassify to a distance-only swim (2 km total).
const RECLASS_SWIM = new Set([ k('1994-02-09', '100m in 1:05 2'), k('1995-04-19', '100 in 1:06 2') ]);

// "N a M" single rides — k is the distance N, time implied by the average speed M.
const NAM = {
  [k('2001-08-06', '21 a 34')]:   { dist: 21, avg: 34 },
  [k('2017-06-27', '30 a 35.4')]: { dist: 30, avg: 35.4 },
  [k('2020-07-07', '30 a 32')]:   { dist: 30, avg: 32 },
};

const _kmh = r => r.k / (r.t / 3600);
const isBikeOutlier = r => r.s === 'bike' && r.t > 0 && r.k > 0 && _kmh(r) > 60;

const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// running-log run dates, to guard the DROP_DUP set.
const logRunDates = new Set(data.rows.filter(r => r.s === 'run' && r.src === 'r').map(r => r.d));

const arrOpen = text.indexOf('[', text.indexOf('"rows":'));
const spans = [];
let depth = 0, objStart = -1, inStr = false, esc = false, end = -1;
for (let i = arrOpen + 1; i < text.length; i++) {
  const ch = text[i];
  if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
  if (ch === '"') inStr = true;
  else if (ch === '{') { if (depth++ === 0) objStart = i; }
  else if (ch === '}') { if (--depth === 0) spans.push([objStart, i + 1]); }
  else if (ch === ']' && depth === 0) { end = i; break; }
}
if (end === -1 || spans.length !== data.rows.length) {
  console.error('FAIL  could not cleanly scan the rows array; refusing to touch the file.'); process.exit(1);
}

// serialize a row object with the file's field order, keeping the ".0" float style.
const ORDER = ['d', 's', 'r', 'src', 'c', 't', 'k', 'p', 'sh', 'n', 'a'];
function ser(o) {
  const parts = [];
  for (const f of ORDER) {
    if (o[f] === undefined) continue;
    let v;
    if (f === 'k' || f === 'a') v = Number.isInteger(o[f]) ? o[f].toFixed(1) : String(o[f]); // 0.5, 16.0, 38.4
    else v = JSON.stringify(o[f]);
    parts.push(JSON.stringify(f) + ':' + v);
  }
  return '{' + parts.join(',') + '}';
}

const counts = { strip: 0, drop: 0, swim: 0, nam: 0, leave: 0, skip: 0 };
const kept = [];
const log = [];
let touchedOutliers = 0;

for (const [s, e] of spans) {
  const sub = text.slice(s, e);
  const o = JSON.parse(sub);
  if (!isBikeOutlier(o)) { kept.push(sub); continue; }   // only ever act on impossible-speed bikes
  touchedOutliers++;
  const key = k(o.d, o.r);

  if (LEAVE.has(key)) { counts.leave++; kept.push(sub); log.push(`  LEAVE   ${o.d} "${o.r}" — grid run not in the running log; flagged for Mike`); continue; }

  if (DROP_DUP.has(key)) {
    if (!logRunDates.has(o.d)) { console.error(`FAIL  DROP guard: no running-log run on ${o.d} for "${o.r}"`); process.exit(1); }
    counts.drop++; log.push(`  DROP    ${o.d} "${o.r}" — a run duplicated as a ${_kmh(o).toFixed(0)} km/h bike`); continue;
  }

  if (RECLASS_SWIM.has(key)) {
    const n = { ...o, s: 'swim' }; delete n.t; delete n.p;
    counts.swim++; kept.push(ser(n)); log.push(`  SWIM    ${o.d} "${o.r}" — 100 m set reclassified to a distance-only swim`); continue;
  }

  if (NAM[key]) {
    const { dist, avg } = NAM[key];
    const n = { ...o, k: dist, t: Math.round(dist / avg * 3600) }; delete n.p;
    counts.nam++; kept.push(ser(n)); log.push(`  NAM     ${o.d} "${o.r}" — ${dist} km at avg ${avg} km/h (t=${n.t}s)`); continue;
  }

  // default: commute-pair / interval distance log — drop the fabricated time.
  const n = { ...o }; delete n.t; delete n.p;
  counts.strip++; kept.push(ser(n)); log.push(`  STRIP   ${o.d} "${o.r}" — was ${_kmh(o).toFixed(0)} km/h; kept ${o.k} km, dropped fabricated ${Math.round(o.t/60)}:00`);
}

log.sort();
for (const l of log) console.log(l);
console.log(`\nActed on ${touchedOutliers} impossible-speed bikes:`);
console.log(`  strip-time ${counts.strip} · drop-dup ${counts.drop} · swim ${counts.swim} · N-a-M ${counts.nam} · left-for-Mike ${counts.leave}`);

const droppedTotal = counts.drop;
if (!WRITE) { console.log('\n(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);
if (check.rows.length !== data.rows.length - droppedTotal) { console.error('row count mismatch after rebuild — aborting'); process.exit(1); }
fs.writeFileSync(FILE, rebuilt);
console.log(`\nwritten to data.json (${droppedTotal} rows removed). Now run: node validate-data.js --fix`);
