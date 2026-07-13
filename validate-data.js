#!/usr/bin/env node
/*
 * validate-data.js — integrity check for data.json
 *
 * data.json is generated output (see meta.generated). When entries are hand-
 * edited or reclassified, the derived `meta` block can drift out of sync with
 * the actual rows. This script verifies the invariants that must always hold,
 * so that kind of drift is caught before it ships instead of living silently
 * in the file.
 *
 *   node validate-data.js          # check only; exits 1 if anything is wrong
 *   node validate-data.js --fix    # rebuild meta (count/span/sports) from rows
 *
 * Zero dependencies — plain Node. No build step, same as the rest of the site.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data.json');
const FIX = process.argv.includes('--fix');

const raw = fs.readFileSync(FILE, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error('FAIL  data.json is not valid JSON:', e.message);
  process.exit(1);
}

const errors = [];
const warnings = [];

// --- structural shape ---
if (typeof data.meta !== 'object' || data.meta === null) errors.push('meta is missing or not an object');
if (!Array.isArray(data.rows)) errors.push('rows is missing or not an array');

if (errors.length) {
  for (const e of errors) console.error('FAIL  ' + e);
  process.exit(1);
}

const rows = data.rows;

// --- recompute the derived facts straight from the rows ---
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sportCounts = {};
let minDate = null;
let maxDate = null;

rows.forEach((r, i) => {
  if (typeof r.d !== 'string' || !DATE_RE.test(r.d)) errors.push(`row ${i}: bad or missing date "d" (${JSON.stringify(r.d)})`);
  if (typeof r.s !== 'string' || r.s === '') errors.push(`row ${i}: bad or missing sport "s"`);
  if (typeof r.r !== 'string') errors.push(`row ${i}: missing raw "r"`);

  if (typeof r.d === 'string') {
    if (minDate === null || r.d < minDate) minDate = r.d;
    if (maxDate === null || r.d > maxDate) maxDate = r.d;
  }
  if (typeof r.s === 'string' && r.s) sportCounts[r.s] = (sportCounts[r.s] || 0) + 1;

  // numeric sanity — warnings only, so genuinely odd historical entries
  // don't block a merge, but still get surfaced.
  if ('t' in r && !(typeof r.t === 'number' && r.t > 0)) warnings.push(`row ${i} (${r.d}): non-positive time t=${r.t}`);
  if ('k' in r && !(typeof r.k === 'number' && r.k >= 0)) warnings.push(`row ${i} (${r.d}): negative/invalid distance k=${r.k}`);
});

// --- compare meta against the recomputed truth ---
const recomputedMeta = {
  generated: data.meta.generated,
  count: rows.length,
  span: [minDate, maxDate],
  sports: sportCounts,
};

if (data.meta.count !== rows.length) {
  errors.push(`meta.count=${data.meta.count} but there are ${rows.length} rows`);
}

const span = data.meta.span || [];
if (span[0] !== minDate || span[1] !== maxDate) {
  errors.push(`meta.span=${JSON.stringify(span)} but rows span [${minDate}, ${maxDate}]`);
}

const metaSports = data.meta.sports || {};
const allSports = new Set([...Object.keys(metaSports), ...Object.keys(sportCounts)]);
for (const s of [...allSports].sort()) {
  const m = metaSports[s] ?? 0;
  const a = sportCounts[s] ?? 0;
  if (m !== a) errors.push(`meta.sports.${s}=${m} but rows contain ${a} (off by ${a - m})`);
}

const metaSportSum = Object.values(metaSports).reduce((x, y) => x + y, 0);
if (metaSportSum !== data.meta.count) {
  errors.push(`sum(meta.sports)=${metaSportSum} but meta.count=${data.meta.count}`);
}

// --- report ---
console.log(`Checked ${rows.length} rows across ${Object.keys(sportCounts).length} sports (${minDate} → ${maxDate}).`);
for (const w of warnings) console.warn('warn  ' + w);

if (errors.length === 0) {
  console.log(`OK    data.json is internally consistent${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}.`);
  process.exit(0);
}

for (const e of errors) console.error('FAIL  ' + e);

if (!FIX) {
  console.error(`\n${errors.length} problem${errors.length > 1 ? 's' : ''}. Re-run with --fix to rebuild meta from the rows.`);
  process.exit(1);
}

// --- --fix: splice a freshly-rebuilt meta block in front of the untouched rows ---
// Only the meta object is rewritten; the rows text is left byte-for-byte intact
// (meta holds no floats, so the "6.0"-style distances in rows are never reformatted).
const marker = ',"rows":[';
const idx = raw.indexOf(marker);
if (idx === -1) {
  console.error('\nFAIL  could not locate the rows delimiter; refusing to rewrite. Fix manually.');
  process.exit(1);
}
const newFile = '{"meta":' + JSON.stringify(recomputedMeta) + raw.slice(idx);
fs.writeFileSync(FILE, newFile);
console.log('\nfixed  rebuilt meta from rows. Re-run `node validate-data.js` to confirm.');
