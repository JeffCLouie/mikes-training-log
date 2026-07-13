#!/usr/bin/env node
/*
 * gen-qa-data.js — produce qa-data.json, the ground-truth checksums the in-site
 * Data QA tab reconciles the live data against. Pulled from the raw source files:
 *   - annual "Totals" lines (Run/Bike/Swim, plus Karate/XC in later years)
 *   - the per-year run table at the end of running.log.txt
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '');

const grid = rd('source/training.log.txt');
const runlog = rd('source/running.log.txt');

const annual = {};
for (const line of grid.split(/\r?\n/)) {
  const m = line.match(/(\d{4})\s*Totals/i); if (!m) continue;
  const y = m[1]; const e = {};
  const g = (re) => { const x = line.match(re); return x ? +x[1] : undefined; };
  const run = g(/Run\s*-?\s*([\d.]+)/i), bike = g(/Bike\s*-?\s*([\d.]+)/i), swim = g(/Swim\s*-?\s*([\d.]+)/i);
  const karate = g(/Karate\s*-?\s*([\d.]+)/i), xc = g(/XC\s*-?\s*([\d.]+)/i);
  if (run != null) e.run = run; if (bike != null) e.bike = bike; if (swim != null) e.swim = swim;
  if (karate != null) e.karate = karate; if (xc != null) e.xc = xc;
  annual[y] = { ...(annual[y] || {}), ...e };
}

const runTable = {};
for (const line of runlog.split(/\r?\n/)) {
  const m = line.match(/^\s*(19|20)(\d{2})\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+:\d\d)\s*$/);
  if (m) runTable[m[1] + m[2]] = { runs: +m[3], km: +m[4], avgDist: +m[5], avgPace: m[6] };
}

const out = { annual, runTable };
fs.writeFileSync(path.join(ROOT, 'qa-data.json'), JSON.stringify(out));
console.log(`wrote qa-data.json — ${Object.keys(annual).length} annual-total years, ${Object.keys(runTable).length} run-table years`);
