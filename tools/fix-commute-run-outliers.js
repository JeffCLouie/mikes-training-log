#!/usr/bin/env node
/*
 * fix-commute-run-outliers.js — clear the recurring non-triathlon impossible-speed
 * entries in the Data QA → Outliers view. These are NOT one-off garbled race cells
 * (see fix-triathlon-legs*.js for those); they are two systematic parser mistakes
 * that repeat across the 2005–2022 grid, plus a few small pattern variants.
 *
 * SAFETY: this tool only ever touches rows that are CURRENTLY physically-impossible
 * outliers (bike > 60 km/h). Every valid row is out of scope by construction. Each
 * outlier is classified by the SHAPE of its shorthand (not by hard-coded dates, so a
 * grid re-dating like #31 can't misroute it); the run counts before writing.
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
 *    This is the default for any impossible-speed bike whose shorthand is a
 *    distance-pair / interval — first number ≥ 15 km, optionally with "+", an
 *    average-speed note ("18 a28 18a36"), an interval note ("18 1on2off 34",
 *    "18 32 IMS") or a trailing week-total ("18 18 192").
 *
 * 2. A run read as a bike  (DROP as duplicate, or LEAVE if unverifiable)
 *    A run logged in the grid as "distance time" — "8 50" = 8 km in 50:xx, "9 46" =
 *    9 km in 46:00 — lost its time's seconds/colon and was read as a bike (8 km in
 *    8 min = 375 km/h). Detected as an impossible-speed bike whose first number is a
 *    run distance (≤ 12 km) with no interval/average marker. If the authoritative
 *    running log (src:"r") already has a run that day the grid bike is a duplicate →
 *    drop it (same rule as tools/dedup-grid-runs.js). If it does NOT — we cannot prove
 *    it duplicates a logged run — it is LEFT for Mike (reported, not changed).
 *
 * SMALL VARIANTS
 *   - Swim sets "100m in 1:05 2" / "100 in 1:06 2" (100 m repeats, 2 km total) were
 *     read as 2 km bikes at ~110 km/h → reclassified to distance-only 2 km swims.
 *   - "N a M" single rides ("21 a 34" = 21 km at avg 34 km/h) had the average speed
 *     taken as the distance (k=34) and the distance as minutes → rebuilt as k=N with
 *     the time implied by the average (t = N / M · 3600).
 *
 * ALSO LEFT FOR MIKE (not touched here): the impossible-PACE run entries — a mis-keyed
 * distance/time in the running log or an interval split — which need Mike's memory of
 * the real figure and are already catalogued in source/mike-review.md (Batch 4). They
 * are runs/swims, never bike outliers, so this tool's bike-only scope skips them.
 *
 *   node tools/fix-commute-run-outliers.js            # dry run
 *   node tools/fix-commute-run-outliers.js --write    # apply, then: node validate-data.js --fix
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

const _kmh = r => r.k / (r.t / 3600);
const isBikeOutlier = r => r.s === 'bike' && r.t > 0 && r.k > 0 && _kmh(r) > 60;

// Classify an impossible-speed bike by the shape of its shorthand. Returns the action.
function classify(sh) {
  const t = sh.trim();
  if (/^100m? in /.test(t)) return 'swim';                       // "100m in 1:05 2" — pool set
  const first = parseFloat((t.match(/^\d+(?:\.\d+)?/) || ['99'])[0]);
  const hasMarker = /on|off|IMS|mtb|\ba\s*\d|\d\s*a\d|\sa\s/.test(t); // interval / average-speed note
  if (first <= 12 && !hasMarker) return 'run';                   // "8 50", "9 46", "6 5:16" — a run
  const nam = t.match(/^(\d+(?:\.\d+)?)\s+a\s*(\d+(?:\.\d+)?)$/); // single "N a M" — N km at avg M
  if (nam) return { nam: { dist: parseFloat(nam[1]), avg: parseFloat(nam[2]) } };
  return 'strip';                                                // commute pair / interval — drop fabricated time
}

const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// running-log run dates — a run-as-bike is a droppable duplicate only if one exists.
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

const counts = { strip: 0, drop: 0, swim: 0, nam: 0, leave: 0 };
const kept = [];
const log = [];
let touched = 0;

for (const [s, e] of spans) {
  const sub = text.slice(s, e);
  const o = JSON.parse(sub);
  if (!isBikeOutlier(o)) { kept.push(sub); continue; }   // only ever act on impossible-speed bikes
  touched++;
  const action = classify(o.r);

  if (action === 'swim') {
    const n = { ...o, s: 'swim' }; delete n.t; delete n.p;
    counts.swim++; kept.push(ser(n)); log.push(`  SWIM    ${o.d} "${o.r}" — 100 m set reclassified to a distance-only swim`); continue;
  }

  if (action === 'run') {
    if (logRunDates.has(o.d)) { counts.drop++; log.push(`  DROP    ${o.d} "${o.r}" — a run duplicated as a ${_kmh(o).toFixed(0)} km/h bike`); continue; }
    counts.leave++; kept.push(sub); log.push(`  LEAVE   ${o.d} "${o.r}" — grid run not in the running log; flagged for Mike`); continue;
  }

  if (action.nam) {
    const { dist, avg } = action.nam;
    const n = { ...o, k: dist, t: Math.round(dist / avg * 3600) }; delete n.p;
    counts.nam++; kept.push(ser(n)); log.push(`  NAM     ${o.d} "${o.r}" — ${dist} km at avg ${avg} km/h (t=${n.t}s)`); continue;
  }

  // default: commute-pair / interval distance log — drop the fabricated time.
  const n = { ...o }; delete n.t; delete n.p;
  counts.strip++; kept.push(ser(n)); log.push(`  STRIP   ${o.d} "${o.r}" — was ${_kmh(o).toFixed(0)} km/h; kept ${o.k} km, dropped fabricated ${Math.round(o.t/60)}:00`);
}

log.sort();
for (const l of log) console.log(l);
console.log(`\nActed on ${touched} impossible-speed bikes:`);
console.log(`  strip-time ${counts.strip} · drop-dup ${counts.drop} · swim ${counts.swim} · N-a-M ${counts.nam} · left-for-Mike ${counts.leave}`);

if (!WRITE) { console.log('\n(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);
if (check.rows.length !== data.rows.length - counts.drop) { console.error('row count mismatch after rebuild — aborting'); process.exit(1); }
fs.writeFileSync(FILE, rebuilt);
console.log(`\nwritten to data.json (${counts.drop} rows removed). Now run: node validate-data.js --fix`);
