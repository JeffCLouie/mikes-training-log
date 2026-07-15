#!/usr/bin/env node
/*
 * gen-review.js — regenerate source/mike-review.md from the raw source + data.json.
 *
 * Surfaces places where today's data.json disagrees with Mike's own written
 * checksums (weekly totals column, annual "Totals" lines) or is otherwise
 * uncertain. Each item needs a human ruling that becomes a pipeline correction.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '');
const ord = n => { n = +n; const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

const grid = rd('source/training.log.txt');
const data = JSON.parse(rd('data.json'));
const paceMin = r => (r.t / 60) / r.k;   // min/km
const fmtPace = p => `${Math.floor(p)}:${String(Math.round((p - Math.floor(p)) * 60)).padStart(2, '0')}`;
const fmtHMS = s => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(ss).padStart(2, '0')}`; };

// ---- Batch 1: race placements misread as distances ----
const races = data.rows.filter(r => /\d+\s*oa/.test(r.r || '')).sort((a, b) => a.d < b.d ? -1 : 1);
let b1 = `| Date | Raw cell | Current parse | Likely correct reading |\n|---|---|---|---|\n`;
for (const r of races) {
  const cur = `s=${r.s}, k=${r.k ?? '—'}, t=${r.t ?? '—'}, c=${r.c}`;
  const mT = (r.r.match(/\d+:\d\d(?::\d\d)?/) || [])[0];
  const rest = mT ? r.r.replace(mT, '') : r.r;
  const mC = (rest.match(/(\d+)\s*c(?=\d|\b|\s|$)/) || [])[1];
  const mOA = (rest.match(/(\d+)\s*oa/) || [])[1];
  const cor = []; if (mT) cor.push(`total ${mT}`); if (mC) cor.push(`${ord(mC)} class`); if (mOA) cor.push(`${ord(mOA)} overall`); cor.push('no distance');
  b1 += `| ${r.d} | \`${r.r.replace(/\|/g, '\\|').trim()}\` | ${cur} | ${cor.join(', ')} |\n`;
}

// ---- Batch 2: annual totals reconciliation ----
const totals = {};
for (const line of grid.split(/\r?\n/)) {
  const m = line.match(/(\d{4})\s*Totals/i); if (!m) continue;
  totals[m[1]] = {
    run: +(line.match(/Run\s*-?\s*([\d.]+)/i) || [])[1],
    bike: +(line.match(/Bike\s*-?\s*([\d.]+)/i) || [])[1],
    swim: +(line.match(/Swim\s*-?\s*([\d.]+)/i) || [])[1],
  };
}
const sum = {};
for (const r of data.rows) { if (!r.k) continue; const y = r.d.slice(0, 4); sum[y] = sum[y] || { run: 0, bike: 0, swim: 0 }; if (r.s in sum[y]) sum[y][r.s] += r.k; }
let b2 = `| Year | Sport | Mike's total | data.json sum | diff | off >3% |\n|---|---|--:|--:|--:|:--:|\n`;
let offCount = 0;
for (const y of Object.keys(totals).sort()) for (const sp of ['run', 'bike', 'swim']) {
  const mt = totals[y][sp]; if (mt == null || isNaN(mt)) continue;
  const ds = +(sum[y]?.[sp] || 0).toFixed(2); const diff = +(ds - mt).toFixed(2);
  const off = Math.abs(diff) > Math.max(5, mt * 0.03); if (off) offCount++;
  b2 += `| ${y} | ${sp} | ${mt} | ${ds} | ${diff > 0 ? '+' : ''}${diff} | ${off ? '⚠️' : ''} |\n`;
}

// ---- Batch 3: how much distance is low-confidence source data ----
let b3 = `| Sport | Total km | of which doubtful (c≠"x") | % |\n|---|--:|--:|--:|\n`;
for (const sp of ['bike', 'swim', 'run']) {
  const rows = data.rows.filter(r => r.s === sp && r.k);
  const tot = rows.reduce((a, r) => a + r.k, 0);
  const doubt = rows.filter(r => r.c !== 'x').reduce((a, r) => a + r.k, 0);
  b3 += `| ${sp} | ${Math.round(tot)} | ${Math.round(doubt)} | ${(100 * doubt / tot).toFixed(0)}% |\n`;
}

// ---- Batch 4: running-log runs with a physically impossible pace ----
// The running log is the exact source for runs, but a few lines carry a mis-keyed
// distance or time — a pace faster than 3:20/km, quicker than any race Mike has run
// (5 K PR 17:33 ≈ 3:30/km). The pace column was computed from the bad figure, so it
// is self-consistent: only Mike knows whether the distance or the time is the typo.
// The Records page floors run pace at 3:20/km so these can't fake a personal best.
const IMPOSSIBLE = 3.333; // min/km (= 3:20/km)
const badPace = data.rows
  .filter(r => r.src === 'r' && r.s === 'run' && r.t > 0 && r.k > 0 && paceMin(r) < IMPOSSIBLE)
  .sort((a, b) => paceMin(a) - paceMin(b));
let b4 = `| Date | Log line (time / km / pace) | Pace | Note |\n|---|---|--:|---|\n`;
for (const r of badPace) {
  const note = (r.n || '').replace(/\|/g, '\\|').trim() || '—';
  b4 += `| ${r.d} | ${fmtHMS(r.t)} / ${r.k} km / ${fmtPace(paceMin(r))} | ${fmtPace(paceMin(r))}/km | ${note} |\n`;
}

// ---- Batch 5: drifted grid weeks left for a ruling ----
// tools/fix-drifted-grid-weeks.js corrected the weeks whose label starts on a
// Sunday and so parsed one week early (stacking onto the prior week). Three of
// those weeks it deliberately left alone because un-stacking them needs a human
// call — a run that may be the same session mis-keyed, or race-week data. This is
// a fixed, hand-identified set (not recomputed), listed here so the ruling isn't lost.
const drifted = [
  { week: '2000 May 15–21 (grid "MY 14 MY 20")', cell: 'run 43:43 / 10 km (currently 2000-05-09)',
    q: 'The running log has 44:43 / 10 km on the corrected day (2000-05-16). Same run mis-keyed by a minute (drop the grid copy), or a distinct run?' },
  { week: '2000 May 29–Jun 4 (grid "MY 28 JN 4")', cell: 'run "4k 22:00" (currently 2000-05-23)',
    q: 'Its corrected day (2000-05-30) already holds a different running-log run, and the week has duplicate "karate" cells. Confirm the +7 shift and how to place the 4 km piece.' },
  { week: '2019 Sep 30–Oct 6 (grid "SE 23 OC 6", Tremblant)', cell: 'run "9k run" (no time) + 5.2 km run 6 s off the log',
    q: 'Race/travel week: the 5.2 km run matches the log within 6 s (likely the same, drop it) but the timeless "9k run" needs Mike\'s read before moving.' },
];
let b5 = `| Week (corrected) | Ambiguous cell | Question |\n|---|---|---|\n`;
for (const d of drifted) b5 += `| ${d.week} | ${d.cell} | ${d.q} |\n`;

const md = `# Data points for Mike to validate

Rebuilt from the raw source files. Places where today's \`data.json\` disagrees with
Mike's own written checksums, or where a cell is ambiguous. Each needs a ruling —
add a **Ruling:** note and it becomes a permanent correction in the pipeline.

_Generated by \`tools/gen-review.js\`._

---

## Batch 1 — race results parsed as distances (${races.length} rows)

In race summary cells, finishing places (\`Nc\` = Nth in class, \`Noa\` = Nth overall)
and field sizes were misread as a distance (\`k\`) — phantom kilometres that inflate
totals. The original parser already flagged nearly all of these low-confidence.

${b1}
**Proposed blanket ruling:** drop the phantom \`k\`; keep the total time; record the
placement as a note. _Mike to confirm or amend._

---

## Batch 2 — annual totals don't reconcile (${offCount} sport-years off by >3%)

Mike wrote a yearly \`Totals\` line (Run / Bike / Swim, in km). Today's \`data.json\`
distance sums should equal these but mostly **exceed** them — evidence the grid was
over-parsed (phantom distances, likely double-counting, misreads). Bikes come purely
from the grid, so their gaps are the cleanest signal. **These totals are the
ground-truth target for the corrected parser.**

${b2}
_Note: run gaps are partly expected — \`data.json\` runs come from the more-complete
running log, which may exceed Mike's grid-based run tally. Bike/swim gaps are the
real concern._

---

## Batch 3 — most grid distance is low-confidence source data

The original parser flagged its own confidence per row (\`c\`: x=clean, d=doubtful,
u=uncertain). Almost all grid-derived distance is a *guess* — bare numbers and
shorthand the parser wasn't sure about. This is why the numbers can't simply be
"fixed": the ambiguity is in Mike's shorthand, not in the parsing.

${b3}
**Implication:** runs are trustworthy (from the clean running log). Bike/swim
distance totals should come from Mike's own weekly/annual totals, not from summing
these doubtful cells. Reconciling cell-level distances needs Mike's eye on the
ambiguous entries — that is the bulk of the remaining work.

---

## Batch 4 — running-log runs at an impossible pace (${badPace.length} rows)

Runs are otherwise the exact, trustworthy source, but these lines carry a mis-keyed
distance or time: a pace faster than **3:20/km**, quicker than any race Mike has ever
run (his 5 K PR is 17:33, a 3:30/km pace). Each row's own \`pace\` column was computed
from the bad figure, so it agrees with the typo — only Mike can say whether the
**distance** or the **time** is wrong. The **Records** page floors run pace at 3:20/km
so these can't drive a bogus personal best, but the source rows still need a ruling.

${b4}
**Proposed ruling:** for each, Mike confirms the true distance (or time); the corrected
value replaces the typo in the running log. _Mike to supply the right figures._

---

## Batch 5 — drifted grid weeks left for a ruling (${drifted.length} weeks)

The grid heads each week with a date label and the parser dates the columns from the
Monday **on or before** that label. When a label starts on a **Sunday**, the whole week
resolves one Monday too early and stacks onto the previous week.
\`tools/fix-drifted-grid-weeks.js\` un-stacked every such week it could corroborate
against the running log (runs lining up exactly 7 days later). These three it left
in place because the fix needs a human call:

${b5}
**Proposed ruling:** confirm each week is +7 (its neighbours already were), then drop
the run if it's the same session the running log already holds, else move it +7 with
the rest of the week. _Mike to confirm._
`;
fs.writeFileSync(path.join(ROOT, 'source/mike-review.md'), md);
console.log(`wrote source/mike-review.md — Batch 1: ${races.length} rows, Batch 2: ${offCount} off-totals, Batch 4: ${badPace.length} impossible-pace runs, Batch 5: ${drifted.length} drifted weeks`);
