#!/usr/bin/env node
/*
 * fix-triathlon-transitions.js — apply the Tremblant treatment to every
 * triathlon whose weekly-grid cell was mis-parsed the same way.
 *
 * THE PATTERN
 *   A triathlon packs swim / T1 / bike / T2 / run / total / placement into one
 *   Sunday cell. build-data.js split each cell across TWO adjacent days: the real
 *   swim & bike legs (with correct distances/times) landed on the running-log run's
 *   date, while the leftovers — the TRANSITIONS (t1/t2, the seconds between legs)
 *   and PLACEMENTS (7c20o = 7th class / 20th overall), the finish time, and a stray
 *   half of the event name — landed on the next day, where the transitions/placements
 *   were then read as bike DISTANCES (a phantom 53 km "ride" from "t1 :53", etc.).
 *   The 2018 Tremblant Half Ironman was fixed by hand in fix-tremblant-2018.js; this
 *   does the same for the rest.
 *
 *   So the fix is NOT to invent legs (they already exist on the run's date) — it is
 *   to (a) clean those real legs: promote them to confident and annotate the leg /
 *   transition, (b) rebuild the finish-time row into a proper race-summary note co-
 *   located with the run, and (c) DROP the phantom rides, the duplicate run copy, and
 *   the event-name fragments. Each recovery is corroborated twice: the legs reconcile
 *   to the printed finish time AND close the week's column-1 sport totals (e.g. 2001
 *   week bike 107 = 30 + 36 + the kept 41; swim 3.1 = 1.6 + the kept 1.5). The exact
 *   run stays in the running log — the grid run is never re-added, so no double count.
 *
 * THE RACES (grid date's phantoms dropped; run date's legs kept & cleaned)
 *   2018-06-24  Tremblant HI  — legs already rebuilt (fix-tremblant-2018.js). Stamp the
 *               summary note with its finish time; drop the 4 stray 06-23 fragments.
 *   2001-08-25  Sharbot Lake  — keep swim 1.5/21:55 & bike 41/1:12:40; finish 2:19:39.
 *   2005-08-13  Sharbot Lake  — keep swim 1.5/23:43 & bike 41/1:07:08; finish 2:19:23.
 *   1994-07-09  OAC Triathlon — keep swim 1.2/20:11 & bike 22.4/39:41; finish 1:30:46.
 *   1998-07-05  OAC Triathlon — cell carried leg TIMES but no distances; rebuild the
 *               summary note only (drop the phantom rides). Finish 1:31:07.
 *   1996-07-21  Kingston Tri  — legs already recovered; stamp the finish time (3:16:45).
 *
 * Targeted find -> replace on the minified JSON so untouched rows keep their exact byte
 * formatting. After writing, run `node validate-data.js --fix` to rebuild meta.
 *
 *   node tools/fix-triathlon-transitions.js            # dry run
 *   node tools/fix-triathlon-transitions.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// find -> repl on the raw text. repl:"" is a DROP (find MUST include the leading comma;
// none of these rows are the array's first element). Every find must occur EXACTLY ONCE.
const EDITS = [
  // ============================ 2018 Tremblant Half Ironman ============================
  { why: 'Tremblant: stamp the 5:20:29 finish onto the summary note',
    find: '{"d":"2018-06-24","s":"note","r":"5:20:29 Tremblant HI","src":"t","c":"u","n":',
    repl: '{"d":"2018-06-24","s":"note","r":"5:20:29 Tremblant HI","src":"t","c":"u","t":19229,"n":' },
  { why: 'Tremblant: drop stray 06-23 finish fragment (dup of 06-24)',
    find: ',{"d":"2018-06-23","s":"other","r":"| 5:20:29 Trem","src":"t","c":"u","t":19229}', repl: '' },
  { why: 'Tremblant: drop stray 06-23 swim fragment (dup of 06-24)',
    find: ',{"d":"2018-06-23","s":"swim","r":"|35:14 1.9 2:4","src":"t","c":"d","t":2114,"k":1.9}', repl: '' },
  { why: 'Tremblant: drop stray 06-23 phantom "21.1 bike" (the run distance)',
    find: ',{"d":"2018-06-23","s":"bike","r":"|      21.1 1:","src":"t","c":"d","k":21.1}', repl: '' },
  { why: 'Tremblant: drop stray 06-23 phantom "run" (the T1 transition, 3:45)',
    find: ',{"d":"2018-06-23","s":"run","r":"|  t1 3:45 t2","src":"t","c":"d","t":225,"k":1.0}', repl: '' },

  // ============================ 2001 Sharbot Lake Triathlon ============================
  { why: '2001 Sharbot: confirm swim leg + note the T1 transition',
    find: '{"d":"2001-08-25","s":"swim","r":"1.5 21:55 a153","src":"t","c":"d","t":1315,"k":1.5,"h":153}',
    repl: '{"d":"2001-08-25","s":"swim","r":"1.5 21:55 a153","src":"t","c":"x","t":1315,"k":1.5,"h":153,"n":"RACE - Sharbot Lake Triathlon — swim leg (1.5 km, 21:55); T1 :53"}' },
  { why: '2001 Sharbot: confirm bike leg, drop the bogus 15 km/h (it was avg HR 153), note T2',
    find: '{"d":"2001-08-25","s":"bike","r":"41 1:12:40 a15","src":"t","c":"d","t":4360,"k":41.0,"a":15.0}',
    repl: '{"d":"2001-08-25","s":"bike","r":"41 1:12:40 a153","src":"t","c":"x","t":4360,"k":41.0,"h":153,"n":"RACE - Sharbot Lake Triathlon — bike leg (41 km, 1:12:40, avg ~34 km/h); T2 :50"}' },
  { why: '2001 Sharbot: finish-time row -> summary note (2:19:39), co-located with the run',
    find: '{"d":"2001-08-26","s":"swim","r":"2:19:39 4c11oa","src":"t","c":"d","t":8379,"n":"race result: 4th in class, 11th overall"}',
    repl: '{"d":"2001-08-25","s":"note","r":"2:19:39 Sharbot Lake Tri","src":"t","c":"u","t":8379,"n":"RACE - Sharbot Lake Triathlon — finish 2:19:39 (swim 21:55, T1 :53, bike 1:12:40, T2 :50, run 43:20); 4th in class, 11th overall"}' },
  { why: '2001 Sharbot: drop truncated event-name note',
    find: ',{"d":"2001-08-25","s":"note","r":"Sharbot Lake T","src":"t","c":"u"}', repl: '' },
  { why: '2001 Sharbot: drop event-name fragment',
    find: ',{"d":"2001-08-26","s":"note","r":"iathlon a155","src":"t","c":"u","h":155}', repl: '' },
  { why: '2001 Sharbot: drop phantom 53 km ride ("t1 :53" transition)',
    find: ',{"d":"2001-08-26","s":"bike","r":"t1 :53  mx168","src":"t","c":"d","k":53.0,"h":168}', repl: '' },
  { why: '2001 Sharbot: drop phantom 50 km ride ("t2 :50" transition)',
    find: ',{"d":"2001-08-26","s":"bike","r":"t2 :50  a34","src":"t","c":"d","k":50.0,"a":34.0}', repl: '' },

  // ============================ 2005 Sharbot Lake Triathlon ============================
  { why: '2005 Sharbot: confirm swim leg + note the T1 transition',
    find: '{"d":"2005-08-13","s":"swim","r":"1.5 23:43 t1","src":"t","c":"d","t":1423,"k":1.5}',
    repl: '{"d":"2005-08-13","s":"swim","r":"1.5 23:43 t1","src":"t","c":"x","t":1423,"k":1.5,"n":"RACE - Sharbot Lake Triathlon — swim leg (1.5 km, 23:43); T1 1:02"}' },
  { why: '2005 Sharbot: confirm bike leg + note the T2 transition',
    find: '{"d":"2005-08-13","s":"bike","r":"41 1:07:08 a36","src":"t","c":"d","t":4028,"k":41.0,"a":36.0}',
    repl: '{"d":"2005-08-13","s":"bike","r":"41 1:07:08 a36","src":"t","c":"x","t":4028,"k":41.0,"a":36.0,"n":"RACE - Sharbot Lake Triathlon — bike leg (41 km, 1:07:08); T2 :20"}' },
  { why: '2005 Sharbot: finish-time row -> summary note (2:19:23), co-located with the run',
    find: '{"d":"2005-08-14","s":"note","r":"2:19:23 4c12o","src":"t","c":"u"}',
    repl: '{"d":"2005-08-13","s":"note","r":"2:19:23 Sharbot Lake Tri","src":"t","c":"u","t":8363,"n":"RACE - Sharbot Lake Triathlon — finish 2:19:23 (swim 23:43, T1 1:02, bike 1:07:08, T2 :20, run 47:09); 4th in class, 12th overall"}' },
  { why: '2005 Sharbot: drop truncated event-name note',
    find: ',{"d":"2005-08-13","s":"note","r":"Sharbot Lake T","src":"t","c":"u"}', repl: '' },
  { why: '2005 Sharbot: drop event-name fragment',
    find: ',{"d":"2005-08-14","s":"note","r":"iathlon","src":"t","c":"u"}', repl: '' },
  { why: '2005 Sharbot: drop phantom 2 km swim (":02", half of T1 1:02)',
    find: ',{"d":"2005-08-14","s":"swim","r":":02","src":"t","c":"d","k":2.0}', repl: '' },
  { why: '2005 Sharbot: drop phantom 20 km ride ("t2 :20" transition)',
    find: ',{"d":"2005-08-14","s":"bike","r":"7 t2 :20","src":"t","c":"d","k":20.0}', repl: '' },

  // ============================ 1994 OAC Triathlon ============================
  { why: '1994 OAC: confirm swim leg, carry avg HR 157, note the T1 transition',
    find: '{"d":"1994-07-09","s":"swim","r":"1.2 20:11 1:03","src":"t","c":"d","t":1211,"k":1.2}',
    repl: '{"d":"1994-07-09","s":"swim","r":"1.2 20:11 1:03","src":"t","c":"x","t":1211,"k":1.2,"h":157,"n":"RACE - OAC Triathlon — swim leg (1.2 km, 20:11); T1 1:03, avg HR 157"}' },
  { why: '1994 OAC: confirm bike leg + note the T2 transition',
    find: '{"d":"1994-07-09","s":"bike","r":"22.4 39:41 :24","src":"t","c":"d","t":2381,"k":22.4}',
    repl: '{"d":"1994-07-09","s":"bike","r":"22.4 39:41 :24","src":"t","c":"x","t":2381,"k":22.4,"n":"RACE - OAC Triathlon — bike leg (22.4 km, 39:41); T2 :24"}' },
  { why: '1994 OAC: event note -> summary note (1:30:46)',
    find: '{"d":"1994-07-09","s":"note","r":"OAC triathlon","src":"t","c":"u"}',
    repl: '{"d":"1994-07-09","s":"note","r":"1:30:46 OAC Triathlon","src":"t","c":"u","t":5446,"n":"RACE - OAC Triathlon — finish 1:30:46 (swim 20:11, T1 1:03, bike 39:41, T2 :24, run 29:27); 7th in class, 20th overall"}' },
  { why: '1994 OAC: drop phantom ride ("av157" = avg HR, not a distance)',
    find: ',{"d":"1994-07-10","s":"bike","r":"av157","src":"t","c":"d","a":157.0}', repl: '' },
  { why: '1994 OAC: drop phantom 20 km ride ("7c20o" = 7th class / 20th overall)',
    find: ',{"d":"1994-07-10","s":"bike","r":"7c20o","src":"t","c":"d","k":20.0}', repl: '' },

  // ============================ 1998 OAC Triathlon ============================
  // The swim/bike legs and the event note are recovered by fix-triathlon-legs-2.js
  // (kept as the reconciliation of the #34/#35 overlap on this race). Here we keep
  // only the two phantom-drops that that pass does not do, so no stray rows remain.
  { why: '1998 OAC: drop the run time captured as a stray "other" (run is in the running log)',
    find: ',{"d":"1998-07-04","s":"other","r":"28:29","src":"t","c":"u","t":1709}', repl: '' },
  { why: '1998 OAC: drop phantom 18 km ride ("0 :18" = the T2 transition)',
    find: ',{"d":"1998-07-05","s":"bike","r":"0 :18","src":"t","c":"d","k":18.0}', repl: '' },

  // ============================ 1996 Kingston Triathlon ============================
  { why: '1996 Kingston: stamp the 3:16:45 finish + full leg breakdown onto the summary note',
    find: '{"d":"1996-07-21","s":"note","r":"3:16:45 35o7c","src":"t","c":"u","n":"RACE - Kingston Triathlon - overall 3:16:45 (35th overall, 7th in category)"}',
    repl: '{"d":"1996-07-21","s":"note","r":"3:16:45 35o7c","src":"t","c":"u","t":11805,"n":"RACE - Kingston Triathlon — finish 3:16:45 (swim 39:58, T1 1:43, bike 1:29:00, T2 :50, run 1:05:02); 35th overall, 7th in category"}' },
];

let text = fs.readFileSync(FILE, 'utf8');
const before = JSON.parse(text);

let dropped = 0;
for (const ed of EDITS) {
  const n = text.split(ed.find).length - 1;
  if (n !== 1) {
    console.error(`FAIL  edit matched ${n}x (expected 1): ${ed.why}\n      find: ${ed.find.slice(0, 90)}…`);
    process.exit(1);
  }
  const isDrop = ed.repl === '';
  console.log(`  ${isDrop ? 'DROP   ' : 'REWRITE'} ${ed.why}`);
  text = text.replace(ed.find, () => ed.repl);   // function form: no $-substitution surprises
  if (isDrop) dropped++;
}

const after = JSON.parse(text);                    // must still be valid JSON
if (after.rows.length !== before.rows.length - dropped) {
  console.error(`FAIL  row count ${after.rows.length} != expected ${before.rows.length - dropped}`);
  process.exit(1);
}
console.log(`\n${dropped} phantom/duplicate rows dropped; ${EDITS.length - dropped} rows rewritten.`);
console.log(`rows ${before.rows.length} -> ${after.rows.length}.`);

if (!WRITE) { console.log('(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }
fs.writeFileSync(FILE, text);
console.log('written to data.json. Now run: node validate-data.js --fix');
