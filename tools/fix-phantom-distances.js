#!/usr/bin/env node
/*
 * fix-phantom-distances.js — remove phantom swim/bike distances that corrupt the
 * records, and recover the real distances they displaced.
 *
 * Every fix here is corroborated by Mike's own column-1 weekly per-sport totals
 * (see tools/verify-weekly-totals.js) and/or the exact running log, so each is
 * provable, not a guess. The genuinely ambiguous cases (a bare "5" that might be a
 * real swim or an echo of that day's run) are deliberately NOT touched — those are
 * left for Mike's QA ruling.
 *
 * Phantom classes fixed (each cell is reclassified to a note, its raw preserved):
 *
 *   1. RUN double-counted as a swim. A run cell (with pickups / N-on-M-off / Nx.5
 *      intervals) was emitted a second time as a swim, giving it a run-length time
 *      over a tiny "distance" — i.e. a bogus fast swim pace. Detected by rule: a
 *      grid swim whose duration equals a same-day run's duration (±60 s).
 *
 *   2. Race/event NAME read as a distance. An event-name header ("Canada Day 5K",
 *      "Army 1/2", "Richmond 10K", "5 Mile", "Shuffle 5 k", "MEC Trail 13k") was
 *      read as a swim/bike distance. The race is a RUN already in the running log;
 *      the column-1 total confirms no such swim/bike that week.
 *
 *   3. Stray number / placement / note read as a distance. Body weights ("183.5",
 *      "+5 183" — both ~185 lb), an average HR ("133" in "133 5"), a race
 *      placement ("5th overall", "4c12o"), an illness
 *      note ("5k home sick"), a 5-hour ski ("sk 5 hours"), a triathlon-summary
 *      fragment ("+5"), and two run-interval cells whose same-day run carries the
 *      identical notation ("5x.5 5k", "6x.5k").
 *
 * Recovered (a real distance the phantom displaced):
 *   - 1993-07-01  ".7"      -> swim 0.7 km   (weekly swim total 4.4 = 2.5+0.7+1.2)
 *   - 2017-07-28  ".5 k sw" -> swim 0.5 km   (".5 k sw" is 0.5 km, misread as 5)
 *
 *   node tools/fix-phantom-distances.js            # dry run: report every change
 *   node tools/fix-phantom-distances.js --write     # apply, then run validate-data.js
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

let text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);
const runByDay = {};
for (const r of data.rows) if (r.src === 'r') (runByDay[r.d] = runByDay[r.d] || []).push(r);

// ---- locate a row's exact object bytes in the file (match on date + raw) ----
function findObject(date, raw) {
  const anchor = `"r":${JSON.stringify(raw)}`;
  let from = 0, i;
  while ((i = text.indexOf(anchor, from)) !== -1) {
    const open = text.lastIndexOf('{', i), close = text.indexOf('}', i);
    if (open !== -1 && close !== -1) {
      const sub = text.slice(open, close + 1);
      try { if (JSON.parse(sub).d === date) return { open, close, sub }; } catch {}
    }
    from = i + anchor.length;
  }
  return null;
}
function splice(found, obj) { text = text.slice(0, found.open) + JSON.stringify(obj) + text.slice(found.close + 1); }

// ---- assemble the target list --------------------------------------------
const seen = new Set();
const targets = [];   // { row, action:'note'|{k}, reason }
const add = (row, action, reason) => {
  const key = row.d + '|' + row.s + '|' + row.r;
  if (seen.has(key)) return; seen.add(key);
  targets.push({ row, action, reason });
};
const pick = (date, sport, rawIncludes) =>
  data.rows.find(r => r.d === date && r.s === sport && (r.r || '').includes(rawIncludes));

// Class 1 — run double-counted as a swim (rule: swim duration == same-day run duration)
for (const r of data.rows) {
  if (r.src !== 't' || r.s !== 'swim' || !r.t) continue;
  const run = (runByDay[r.d] || []).find(x => x.t && Math.abs(x.t - r.t) <= 60);
  if (run) add(r, 'note', `run double-count (t=${r.t}s == same-day run)`);
}

// Class 2 — race/event NAME read as a swim/bike distance
const raceName = [
  ['1992-07-01', 'bike', 'Canada Day 10K'], ['1993-01-31', 'bike', 'Richmond 10K'],
  ['1994-07-01', 'bike', 'Canada Day 10K'], ['1995-07-01', 'bike', 'Canada Day 10k'],
  ['2003-01-19', 'bike', 'Richmond'],       ['2019-09-15', 'bike', 'MEC Trail 13k'],
  ['1993-07-01', 'swim', 'Canada Day'],     ['1996-07-01', 'swim', 'Canada Day 5K'],
  ['1998-02-01', 'swim', 'Richmond 5K'],    ['1999-08-01', 'swim', '5 Mile'],
  ['2002-05-12', 'swim', 'Ottawa 1/2 M'],   ['2009-05-24', 'swim', 'Nordion 1/2'],
  ['2009-09-20', 'swim', 'Army 1/2'],       ['2010-09-19', 'swim', 'Army 1/2'],
  ['2012-05-27', 'swim', 'Nation Cap 1/2'], ['2012-09-23', 'swim', 'Army 1/2'],
  ['2013-05-26', 'swim', 'Nation Cap 1/2'], ['2014-09-21', 'swim', 'Army 1/2'],
  ['2015-05-24', 'swim', 'Nation Cap 1/2'], ['2016-05-29', 'swim', 'ORW 1/2'],
  ['2016-10-09', 'swim', 'Shuffle 5 k'],    ['2017-05-06', 'swim', 'Wakefield 1/2'],
  ['2019-05-26', 'swim', 'Ottawa 1/2'],     ['2020-10-10', 'swim', 'Shuffle 1'],
  ['2020-10-11', 'swim', 'Shuffle 2'],
];
for (const [d, s, inc] of raceName) { const r = pick(d, s, inc); if (r) add(r, 'note', 'race/event name read as distance'); }

// Class 3 — stray number / placement / note read as a distance
const stray = [
  ['1995-09-21', 'bike', '183.5', 'body weight (lb) — no bike total that week'],
  ['1994-05-04', 'swim', '133', 'avg HR (133) misread — weekly swim total is all 2.5 km swims, no 5 km swim'],
  ['2001-07-08', 'swim', 'a156', 'triathlon-summary fragment (+5) — weekly swim total 2 km'],
  ['2002-01-23', 'swim', '183', 'body weight (lb) — karate/hockey week, no swimming'],
  ['2002-06-22', 'swim', '5th overall', 'race placement, not a distance'],
  ['2003-01-12', 'swim', 'sk 5 hours', '5-hour XC ski, not a swim'],
  ['2005-08-14', 'swim', '4c12o', 'race placement (4th class, 12th overall)'],
  ['2005-11-16', 'swim', '5k home sick', 'illness note — the real run that day was 4 km'],
  ['2016-09-12', 'swim', '5x.5', 'run intervals — same-day run has identical 5x.5 notation'],
  ['2016-09-20', 'swim', '6x.5k', 'run intervals — same-day run has identical 6x.5 notation'],
];
for (const [d, s, inc, why] of stray) { const r = pick(d, s, inc); if (r) add(r, 'note', why); }

// Recovered real distances
const recover = [
  ['1993-07-01', 'note', '.7', 0.7, 'real 0.7 km swim (weekly total 4.4 = 2.5+0.7+1.2)'],
  ['2017-07-28', 'swim', '.5 k sw', 0.5, '".5 k sw" is a 0.5 km swim, misread as 5'],
];

// ---- apply -----------------------------------------------------------------
let applied = 0, missing = 0;
const byClass = {};
for (const t of targets) {
  const found = findObject(t.row.d, t.row.r);
  if (!found) { missing++; console.warn('  NOT FOUND:', t.row.d, JSON.stringify(t.row.r)); continue; }
  const note = { d: t.row.d, s: 'note', r: t.row.r, src: t.row.src, c: 'u' };
  splice(found, note);
  applied++;
  const cl = t.reason.startsWith('run double') ? '1 run-double-count'
    : t.reason === 'race/event name read as distance' ? '2 race-name' : '3 stray-number';
  (byClass[cl] = byClass[cl] || []).push(t);
  console.log(`  ${t.row.d} ${t.row.s}->note  k=${t.row.k ?? '-'}  ${JSON.stringify((t.row.r || '').slice(0, 26))}  (${t.reason})`);
}

let recovered = 0;
for (const [d, sport, inc, km, why] of recover) {
  const r = data.rows.find(x => x.d === d && x.s === sport && (x.r || '').includes(inc));
  if (!r) { missing++; console.warn('  RECOVER target not found:', d, inc); continue; }
  const found = findObject(r.d, r.r);
  if (!found) { missing++; console.warn('  RECOVER not found in text:', d, inc); continue; }
  splice(found, { d: r.d, s: 'swim', r: r.r, src: r.src, c: 'd', k: km });
  recovered++;
  console.log(`  ${d} ${sport}->swim k=${km}  ${JSON.stringify(inc)}  (${why})`);
}

console.log(`\nreclassified to note: ${applied}  (` +
  Object.entries(byClass).map(([k, v]) => `class ${k}: ${v.length}`).join(', ') + ')');
console.log(`recovered as real swim: ${recovered}`);
console.log(`not matched: ${missing}`);

if (WRITE && missing === 0) {
  const check = JSON.parse(text);
  if (check.rows.length !== data.rows.length) { console.error('row count changed — aborting'); process.exit(1); }
  fs.writeFileSync(FILE, text);
  console.log('\nwritten to data.json — now run: node validate-data.js --fix');
} else if (WRITE) {
  console.error('\nsome targets not matched — refusing to write');
  process.exit(1);
} else {
  console.log('\n(dry run — pass --write to apply)');
}
