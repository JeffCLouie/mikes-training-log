#!/usr/bin/env node
/*
 * verify-weekly-totals.js — cross-check data.json against the weekly per-sport
 * distance totals Mike wrote in column 1 of the training grid.
 *
 * The idea (Mike's): column 1 of each week block lists the week's per-sport
 * distance sums — and it only lists a sport that ACTUALLY HAPPENED that week.
 * So the totals are an independent checksum:
 *   - a sport parsed for a week whose column 1 has NO total for it  -> phantom
 *   - a parsed weekly sum that far exceeds the written total        -> over-parse
 *
 * Column-1 grammar:
 *   - 1991–92 (letter era):  "6.7 k s"  "22 k r"  "132k b"   (sport letter tags it)
 *   - 1993+   (positional):  rows stack swim / bike / run, RUN is always the last
 *                            row; a trailing 2nd number is a year-to-date cumulative.
 *   - some late weeks have an empty column 1 (no checksum available).
 *
 * Runs are exact (from the running log), so we anchor on them: the last column-1
 * row must equal the week's summed run km. When it does, the week's structure is
 * trustworthy and the swim/bike presence check is confident; when it doesn't, the
 * week is reported as low-confidence and its swim/bike inferences are suppressed.
 *
 *   node tools/verify-weekly-totals.js            # human report
 *   node tools/verify-weekly-totals.js --json      # machine-readable phantom list
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '');
const JSON_OUT = process.argv.includes('--json');
const pad = n => String(n).padStart(2, '0');
const MON = { JA:0, FE:1, MR:2, AP:3, MY:4, JN:5, JL:6, AU:7, SE:8, OC:9, NO:10, DE:11 };

// ---- parse the grid into week blocks (col-1 totals + the 7 day columns) ----
function parseWeeks(text) {
  const lines = text.split(/\r?\n/);
  let year = null, cur = null;
  const weeks = [];
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const f = line.split('|');
    const label = (f[1] || '').trim();
    const dv = label.match(/^-*(\d{4})-*$/);
    if (dv) { year = +dv[1]; cur = null; continue; }
    if (year == null) continue;
    const hm = label.match(/^([A-Z]{2})\s*(\d{1,2})\D+([A-Z]{2})\s*(\d{1,2})/);
    if (hm && MON[hm[1]] != null && MON[hm[3]] != null) {
      const Ms = MON[hm[1]], Ds = +hm[2], Me = MON[hm[3]];
      const startY = (Ms > Me) ? year - 1 : year;
      const start = new Date(Date.UTC(startY, Ms, Ds));
      const monday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * 86400000);
      const days = [];
      for (let c = 0; c < 7; c++) {
        const d = new Date(monday.getTime() + c * 86400000);
        days.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
      }
      cur = { year, label, days, col1: [] };
      weeks.push(cur);
      continue;
    }
    if (cur && label) cur.col1.push(label);   // a totals row inside the block
  }
  return weeks;
}

// ---- turn a week's column-1 rows into { swim, bike, run } totals (km|null) ----
// runKm = the week's exact summed run distance, used to anchor the positional form.
function readTotals(col1, runKm) {
  const t = { swim: null, bike: null, run: null };
  if (!col1.length) return { totals: t, confident: false, reason: 'empty col-1' };

  // letter era: each row self-identifies with s / r / b
  const lettered = col1.map(s => s.match(/^([\d.]+)\s*k?\s*([srb])\b/i)).filter(Boolean);
  if (lettered.length) {
    for (const m of lettered) {
      const km = parseFloat(m[1]), sp = { s: 'swim', r: 'run', b: 'bike' }[m[2].toLowerCase()];
      t[sp] = km;
    }
    const confident = t.run == null || runKm == null || Math.abs(t.run - runKm) <= 2.0;
    return { totals: t, confident, reason: confident ? 'letter' : 'letter/run-mismatch' };
  }

  // positional era: run is the LAST row; verify it against the exact run km.
  const nums = col1.map(s => parseFloat((s.match(/-?[\d.]+/) || [])[0]));
  if (nums.some(isNaN)) return { totals: t, confident: false, reason: 'non-numeric col-1' };
  const run = nums[nums.length - 1];
  const runOk = runKm != null && Math.abs(run - runKm) <= 2.0;
  t.run = run;
  const above = nums.slice(0, -1);          // swim/bike totals, top-to-bottom
  if (above.length === 2) { t.swim = above[0]; t.bike = above[1]; }
  else if (above.length === 1) { if (above[0] <= 15) t.swim = above[0]; else t.bike = above[0]; }
  // >2 rows above run is unexpected; leave swim/bike null (not confident)
  const confident = runOk && above.length <= 2;
  return { totals: t, confident, reason: runOk ? 'positional' : 'positional/run-mismatch' };
}

// ---------------------------------------------------------------------------
const weeks = parseWeeks(rd('source/training.log.txt'));
const data = JSON.parse(rd('data.json'));

// map every calendar date to its week, and index rows/runs by date
const weekOf = {};
for (const w of weeks) for (const d of w.days) if (!(d in weekOf)) weekOf[d] = w;
const runByDay = {};
for (const r of data.rows) if (r.src === 'r') (runByDay[r.d] = runByDay[r.d] || []).push(r);

// per-week parsed sums from data.json (any source), by sport
for (const w of weeks) { w.parsed = { swim: 0, bike: 0, run: 0 }; w.rows = []; }
for (const r of data.rows) {
  const w = weekOf[r.d]; if (!w) continue;
  if (r.k != null && (r.s in w.parsed)) w.parsed[r.s] += r.k;
  w.rows.push(r);
}

const SIGNS = { swim: 'swim', bike: 'bike' };
const phantomsPresence = [];   // sport parsed but absent from a confident col-1
const mismatches = [];         // parsed sum >> written total (confident weeks)
let confidentWeeks = 0;

for (const w of weeks) {
  const runKm = w.days.reduce((s, d) => s + (runByDay[d] || []).reduce((a, r) => a + (r.k || 0), 0), 0);
  const { totals, confident, reason } = readTotals(w.col1, runKm || null);
  w.totals = totals; w.confident = confident; w.reason = reason;
  if (confident) confidentWeeks++;
  if (!confident) continue;
  for (const sp of ['swim', 'bike']) {
    const parsed = w.parsed[sp];
    if (parsed > 0 && totals[sp] == null) {
      // sport parsed for a week its col-1 says never happened -> phantom
      const rows = w.rows.filter(r => r.s === sp && r.k != null);
      phantomsPresence.push({ week: w.days[0], label: w.label, sport: sp, parsedKm: +parsed.toFixed(2), rows });
    } else if (parsed > 0 && totals[sp] != null && parsed - totals[sp] > Math.max(3, totals[sp] * 0.25)) {
      mismatches.push({ week: w.days[0], sport: sp, parsedKm: +parsed.toFixed(2), writtenKm: totals[sp], diff: +(parsed - totals[sp]).toFixed(2) });
    }
  }
}

// same-day race duplicate: a grid swim/bike cell equal to a same-day logged RACE run
const raceDup = [];
for (const r of data.rows) {
  if (r.src !== 't' || !(r.s in SIGNS) || r.k == null) continue;
  const runs = runByDay[r.d] || [];
  const dup = runs.find(run => /RACE|Canada Day|Shuffle|\bMile\b|1\/2/i.test(run.n || ''));
  if (dup && /[A-Za-z]/.test(r.r || '')) raceDup.push({ date: r.d, sport: r.s, k: r.k, raw: r.r, runNote: (dup.n || '').slice(0, 50), runKm: dup.k });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ phantomsPresence, raceDup, mismatches }, null, 2));
} else {
  console.log(`weeks: ${weeks.length}, with a usable col-1 checksum: ${confidentWeeks}\n`);
  console.log(`== PHANTOM PRESENCE (${phantomsPresence.length}) — sport parsed in a week whose col-1 has no total for it ==`);
  for (const p of phantomsPresence)
    for (const r of p.rows) console.log(`  ${p.week}  ${p.sport.padEnd(4)} k=${String(r.k).padEnd(6)} raw=${JSON.stringify(r.r)}`);
  console.log(`\n== SAME-DAY RACE DUPLICATE (${raceDup.length}) — grid swim/bike = a race already in the run log ==`);
  for (const p of raceDup) console.log(`  ${p.date}  ${p.sport.padEnd(4)} k=${String(p.k).padEnd(5)} raw=${JSON.stringify(p.raw).padEnd(24)} run(${p.runKm}km): ${JSON.stringify(p.runNote)}`);
  console.log(`\n== OVER-PARSE (${mismatches.length}) — parsed weekly sum far exceeds the written total (top 25 by diff) ==`);
  for (const m of mismatches.sort((a, b) => b.diff - a.diff).slice(0, 25))
    console.log(`  ${m.week}  ${m.sport.padEnd(4)} parsed=${String(m.parsedKm).padEnd(7)} written=${String(m.writtenKm).padEnd(6)} +${m.diff}`);
}
