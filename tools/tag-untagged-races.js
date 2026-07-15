#!/usr/bin/env node
/*
 * tag-untagged-races.js — add the explicit RACE tag to genuine races that were
 * logged without it, so the Calendar and the Performance tab count them.
 *
 * Background: a race is detected by isRace() — an uppercase "RACE" marker, the
 * convention the running log uses ("RACE - <event>"). Mike's early triathlons /
 * duathlons and a few Dalhousie Lake Shuffles were logged only as training-grid
 * cells + a diary note, so they carried no RACE tag and showed up in NEITHER the
 * Calendar's race filter nor Performance -> Every Race. Each entry below was
 * checked by hand against the source logs; NONE beats an existing race PR (the
 * fastest 5 K here is 18:45, slower than the 17:12 record), so no fake records.
 *
 * Where a plausible run leg exists it is tagged, so the race also lands in
 * Performance -> Every Race with a clean name (matching how existing triathlon
 * run legs, e.g. "RACE - Sharbot Lake Triathlon", are already tagged). Days with
 * no run leg (the two OAC swim/bike-only tris) and the DNF marathon are tagged on
 * their diary note instead — the Calendar shows the race day, and Performance's
 * finish-time list correctly omits an effort with no run result.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact formatting (distances like "5.0" are not reflowed by a JSON round-trip).
 *
 *   node tools/tag-untagged-races.js            # dry run: report what would change
 *   node tools/tag-untagged-races.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// [date, sport, substring that uniquely identifies the row on that date, RACE name]
const TARGETS = [
  ['1993-05-09', 'note', 'National Capital',  'National Capital Marathon (DNF)'], // ran 29k, DNF
  ['1993-07-03', 'run',  '27:41',             'OAC Triathlon'],                   // tri run leg 7 km
  ['1994-07-23', 'run',  '1:05:57',           'Kingston Triathlon'],              // tri run leg 15 km
  ['1994-10-09', 'run',  '18:45',             'Dalhousie Lake Shuffle'],          // 5 km race
  ['1998-07-04', 'note', 'OAC Triathlon',     'OAC Triathlon'],                   // swim/bike only, no run leg
  ['1999-07-10', 'note', 'OAC Triathlon',     'OAC Triathlon'],                   // swim/bike only, no run leg
  ['2011-10-08', 'run',  '22:14',             'Dalhousie Lake Shuffle'],          // 5 km race
  ['2021-10-10', 'run',  'Dalhousie Lake Shuffle', 'Dalhousie Lake Shuffle'],    // running-log 5 km race
];

let text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// Locate a row's exact object substring in `text` (matched by date + raw), so we
// edit the file's real bytes rather than a reflowed JSON round-trip.
function findObject(date, raw) {
  const anchor = `"r":${JSON.stringify(raw)}`;
  let from = 0, i;
  while ((i = text.indexOf(anchor, from)) !== -1) {
    const open = text.lastIndexOf('{', i);
    const close = text.indexOf('}', i);
    if (open !== -1 && close !== -1) {
      const sub = text.slice(open, close + 1);
      try { if (JSON.parse(sub).d === date) return { open, close, sub }; } catch {}
    }
    from = i + anchor.length;
  }
  return null;
}

let applied = 0, missing = 0;
for (const [d, s, sub, name] of TARGETS) {
  const cands = data.rows.filter(r => r.d === d && r.s === s && (r.r || '').includes(sub));
  if (cands.length !== 1) {
    missing++; console.warn('  AMBIGUOUS/NOT FOUND (skipped):', d, s, JSON.stringify(sub), `(${cands.length} matches)`);
    continue;
  }
  const row = cands[0];
  if (/\bRACE\b/.test((row.n || '') + ' ' + (row.r || ''))) { console.log('  already tagged:', d, name); continue; }
  const found = findObject(row.d, row.r);
  if (!found) { missing++; console.warn('  BYTES NOT FOUND (skipped):', d, JSON.stringify(row.r)); continue; }
  const noteJson = JSON.stringify(`RACE - ${name}`);
  let obj = found.sub;
  if (/"n":/.test(obj)) obj = obj.replace(/"n":("(?:[^"\\]|\\.)*")/, `"n":${noteJson}`);
  else obj = obj.slice(0, -1) + `,"n":${noteJson}}`;
  text = text.slice(0, found.open) + obj + text.slice(found.close + 1);
  applied++;
  console.log('  tagged:', d, '·', `${s} ·`, `RACE - ${name}`);
}

console.log(`\nRACE tags: ${applied} rows tagged, ${missing} not applied`);
if (WRITE && missing === 0) {
  const check = JSON.parse(text);                       // still valid JSON …
  if (check.rows.length !== data.rows.length) { console.error('row count changed — aborting'); process.exit(1); }
  fs.writeFileSync(FILE, text);
  console.log('written to data.json');
} else if (WRITE) {
  console.error('some rows not applied — refusing to write');
  process.exit(1);
} else {
  console.log('(dry run — pass --write to apply)');
}
