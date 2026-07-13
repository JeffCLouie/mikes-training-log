#!/usr/bin/env node
/*
 * build-data.js — regenerate data.json from the raw source files.
 *
 *   node tools/build-data.js            # build + compare to current data.json
 *   node tools/build-data.js --write    # (future) overwrite data.json
 *
 * STATUS (work in progress):
 *   - Running log  (source/running.log.txt) -> run rows : DONE, byte-exact.
 *       5481/5483 lines reproduce data.json's src="r" rows exactly.
 *       The 2 dropped lines are impossible calendar dates (19940431, 20060631).
 *   - Training grid (source/training.log.txt) -> other rows : IN PROGRESS.
 *       Structural date/text extraction ~ matches; sport/time/distance
 *       classification and the run de-duplication are not finished yet.
 *
 * Open design question still to settle (see notes): the grid's week LABELS
 * drift from the real calendar in places, and today's data.json sometimes
 * follows the labels and sometimes a sequential-week model. So "reproduce
 * data.json exactly" and "produce calendar-correct dates" are not always the
 * same target; a diff report is emitted for a human (Mike) to adjudicate.
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '');

// ---------- helpers ----------
const pad = n => String(n).padStart(2, '0');
function validYMD(y, m, d) {           // m is 1-12
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function hmsToSec(t) {                  // "0:31:27" or "5:14" (m:s) or "31" (min)
  const parts = t.split(':').map(s => parseInt(s, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// ---------- running log ----------
// Line: YYYYMMDD | H:MM:SS | km | pace | [hr] | [?] | shoe | note
function parseRunningLog(text) {
  const rows = [];
  const dropped = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d{8}\s*\|/.test(line)) continue;
    const raw = line.replace(/\s+$/, '');
    const c = raw.split('|');
    const dm = c[0].match(/^(\d{4})(\d{2})(\d{2})/);
    const y = +dm[1], mo = +dm[2], da = +dm[3];
    if (!validYMD(y, mo, da)) { dropped.push(raw); continue; }
    const row = { d: `${dm[1]}-${dm[2]}-${dm[3]}`, s: 'run', r: raw, src: 'r', c: 'x' };
    const t = hmsToSec((c[1] || '').trim()); if (t) row.t = t;   // 0:00 -> omit
    const k = parseFloat((c[2] || '').trim()); if (!isNaN(k)) row.k = k;
    const p = (c[3] || '').trim(); if (p) row.p = p;
    // NOTE: columns 5-6 (heart rate etc.) are intentionally ignored — the
    // original runparse.pl did not carry them into data.json.
    const sh = (c[6] || '').trim(); if (sh) row.sh = sh;
    const n = (c[7] || '').trim(); if (n) row.n = n;
    rows.push(row);
  }
  return { rows, dropped };
}

// ---------- training grid (WIP structural extraction) ----------
const MON = { JA:0, FE:1, MR:2, AP:3, MY:4, JN:5, JL:6, AU:7, SE:8, OC:9, NO:10, DE:11 };
function parseGrid(text) {
  const lines = text.split(/\r?\n/);
  let year = null, colDate = null;
  const out = [];
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const f = line.split('|');
    const label = (f[1] || '').trim();
    const dv = label.match(/^-*(\d{4})-*$/);
    if (dv) { year = +dv[1]; colDate = null; continue; }
    if (year == null) continue;
    const hm = label.match(/^([A-Z]{2})\s*(\d{1,2})\D+([A-Z]{2})\s*(\d{1,2})/);
    if (hm && MON[hm[1]] != null && MON[hm[3]] != null) {
      const Ms = MON[hm[1]], Ds = +hm[2], Me = MON[hm[3]];
      const startY = (Ms > Me) ? year - 1 : year;
      // Anchor on the Monday of the week CONTAINING the label's start date
      // (labels drift off Monday in places), then map all 7 Mon..Sun columns.
      const start = new Date(Date.UTC(startY, Ms, Ds));
      const monday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * 86400000);
      colDate = [];
      for (let c = 0; c < 7; c++) colDate[c] = new Date(monday.getTime() + c * 86400000);
    }
    if (!colDate) continue;
    for (let c = 0; c < 7; c++) {
      const cell = (f[2 + c] || '').trim();
      if (!cell) continue;
      const d = colDate[c];
      out.push({ d: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, raw: cell });
    }
  }
  return out;
}

// ---------- report ----------
function main() {
  const run = parseRunningLog(rd('source/running.log.txt'));
  const grid = parseGrid(rd('source/training.log.txt'));
  const gold = JSON.parse(rd('data.json'));
  const goldR = gold.rows.filter(r => r.src === 'r');

  // exact full-row check for runs
  const key = r => JSON.stringify(r);
  const goldRkeys = new Set(goldR.map(key));
  const runExact = run.rows.filter(r => goldRkeys.has(key(r))).length;
  console.log('RUN LOG');
  console.log(`  parsed ${run.rows.length} run rows, dropped ${run.dropped.length} (invalid dates)`);
  console.log(`  byte-exact vs data.json src="r": ${runExact}/${goldR.length}`);
  if (run.dropped.length) console.log('  dropped:', run.dropped.map(d => d.slice(0, 8)).join(', '));

  console.log('GRID (WIP)');
  const goldT = gold.rows.filter(r => r.src === 't');
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const goldTset = new Set(goldT.map(r => r.d + '|' + norm(r.r)));
  const gridMatch = grid.filter(e => goldTset.has(e.d + '|' + norm(e.raw))).length;
  console.log(`  extracted ${grid.length} cells; date+text match to src="t": ${gridMatch}/${goldT.length} (${(100 * gridMatch / goldT.length).toFixed(1)}%)`);
}

main();
