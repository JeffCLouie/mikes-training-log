#!/usr/bin/env node
/*
 * fix-triathlon-legs-2.js — two more triathlons whose compound cells surfaced as
 * impossible-speed "rides", found while clearing the rest of the Outliers view.
 * Same class of fix as tools/fix-triathlon-legs.js and tools/fix-tremblant-2018.js.
 *
 *   1996-06-02  Perth Triathlon (1996)   swim 500m/7:37 · bike 16k/26:38 · run 3k/11:10 · 46:12
 *       raw Sunday cell "7:37 500 :46 26:38 16 / av36.2 11:10 3 / 46:12 3c 5oa /70".
 *       "7:37 500" (swim) was read as a 5 km bike; the real bike (26:38) took k=46 from
 *       the ":46" T1 (a 104 km/h phantom). Recover the swim leg and fix the bike to 16 km
 *       (= the printed av 36.2 km/h). Legs sum to 46:11 ~ the printed 46:12.
 *
 *   1998-07-05  OAC Triathlon            swim 21:00 · bike 40:10 · run 7k/28:29 · 1:31:07
 *       raw Sunday cell "21:00 1:13 40:10 :18 / 28:29 / 1:31:07 3c18oa" records only leg
 *       TIMES, no swim/bike distances. The parser mashed the swim time 21:00 with the bike
 *       time 40:10 into a 40 km / 114 km/h phantom. Split them back into a time-only bike
 *       leg (40:10) and a time-only swim leg (21:00); distances aren't in the cell. Legs
 *       sum to 1:31:10 ~ the printed 1:31:07.
 *
 * The run leg of each race is already in the authoritative running log (src:"r") and is
 * left untouched. After writing, run `node validate-data.js --fix` to rebuild meta.
 *
 *   node tools/fix-triathlon-legs-2.js            # dry run
 *   node tools/fix-triathlon-legs-2.js --write    # apply
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

const NOTE = {
  perth96: 'RACE - Perth Triathlon (1996) — swim 500 m 7:37 (T1 :46), bike 16 km 26:38 (36.2 km/h), run 3 km 11:10; finish 46:12, 3rd in class / 5th overall (of 70)',
  oac98:   'RACE - OAC Triathlon — swim 21:00 (T1 1:13), bike 40:10 (T2 :18), run 7 km 28:29; finish 1:31:07, 3rd in class / 18th overall',
};

const EDITS = [
  // --- 1996-06-02  Perth Triathlon (1996) ---
  { match: '{"d":"1996-06-02","s":"note","r":"Perth tri","src":"t","c":"u"}',
    to:    '{"d":"1996-06-02","s":"note","r":"Perth tri","src":"t","c":"u","n":' + JSON.stringify(NOTE.perth96) + '}',
    why:   'Perth Tri 1996: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1996-06-01","s":"bike","r":"7:37 5","src":"t","c":"d","t":457,"k":5.0}',
    to:    '{"d":"1996-06-01","s":"swim","r":"7:37 500","src":"t","c":"x","t":457,"k":0.5,"n":"Perth Triathlon 1996 — swim leg (500 m; T1 :46)"}',
    why:   'Perth Tri 1996: recover the swim leg (500 m / 7:37) from "7:37 500" read as a 5 km bike' },
  { match: '{"d":"1996-06-01","s":"bike","r":"av36.2","src":"t","c":"d","a":36.2}',
    drop:  true,
    why:   'Perth Tri 1996: drop the "av36.2" fragment (the bike average speed, now noted on the bike leg)' },
  { match: '{"d":"1996-06-02","s":"bike","r":"0 :46 26:38 16","src":"t","c":"d","t":1598,"k":46.0}',
    to:    '{"d":"1996-06-02","s":"bike","r":"26:38 16","src":"t","c":"x","t":1598,"k":16.0,"n":"Perth Triathlon 1996 — bike leg (36.2 km/h)"}',
    why:   'Perth Tri 1996: fix the bike distance 46 -> 16 km (":46" was T1; 26:38 for 16 km = 36.2 km/h; was 104 km/h)' },

  // --- 1998-07-05  OAC Triathlon ---
  { match: '{"d":"1998-07-04","s":"note","r":"OAC Triathlon","src":"t","c":"u"}',
    to:    '{"d":"1998-07-04","s":"note","r":"OAC Triathlon","src":"t","c":"u","n":' + JSON.stringify(NOTE.oac98) + '}',
    why:   'OAC Tri 1998: enrich the event note with the reconciled leg summary' },
  { match: '{"d":"1998-07-04","s":"bike","r":"21:00 1:13 40:","src":"t","c":"d","t":1260,"k":40.0}',
    to:    '{"d":"1998-07-04","s":"bike","r":"40:10","src":"t","c":"d","t":2410,"n":"OAC Triathlon — bike leg (40:10; distance not recorded)"}',
    why:   'OAC Tri 1998: rebuild the bike leg (40:10, time only) from the swim/bike times mashed into a 40 km / 114 km/h phantom' },
  { match: '{"d":"1998-07-04","s":"swim","r":"1:31:07  3c18o","src":"t","c":"d","t":5467,"k":3.0}',
    to:    '{"d":"1998-07-04","s":"swim","r":"21:00","src":"t","c":"d","t":1260,"n":"OAC Triathlon — swim leg (21:00; distance not recorded)"}',
    why:   'OAC Tri 1998: recover the swim leg (21:00, time only) in place of the "1:31:07 3c18oa" finish/place phantom' },
];

const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

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

const hit = new Array(EDITS.length).fill(0);
const kept = [];
let modified = 0, dropped = 0;
for (const [s, e] of spans) {
  const sub = text.slice(s, e);
  const idx = EDITS.findIndex(ed => ed.match === sub);
  if (idx === -1) { kept.push(sub); continue; }
  hit[idx]++;
  const ed = EDITS[idx];
  if (ed.drop) { dropped++; console.log(`  DROP    ${ed.why}`); }
  else { kept.push(ed.to); modified++; console.log(`  REWRITE ${ed.why}`); }
}

const problems = EDITS.filter((_, i) => hit[i] !== 1);
if (problems.length) {
  console.error('\nFAIL  these edits did not match exactly once (data.json may already be fixed or changed):');
  for (const p of problems) console.error(`   [${hit[EDITS.indexOf(p)]}x] ${p.match}`);
  process.exit(1);
}

console.log(`\n${modified} rows rewritten, ${dropped} rows dropped.`);
if (!WRITE) { console.log('(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);
if (check.rows.length !== data.rows.length - dropped) {
  console.error('row count mismatch after rebuild — aborting'); process.exit(1);
}
fs.writeFileSync(FILE, rebuilt);
console.log(`written to data.json (${dropped} rows removed). Now run: node validate-data.js --fix`);
