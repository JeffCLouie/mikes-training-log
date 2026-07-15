#!/usr/bin/env node
/*
 * fix-drifted-grid-weeks.js — un-stack the weeks the grid parser placed one week
 * too early because the week LABEL starts on the wrong day.
 *
 * WHAT WENT WRONG
 *   The weekly training grid (source/training.log.txt) heads each week with a
 *   date label like "OC13 - OC19", and the parser dates the seven day-columns by
 *   anchoring on the Monday of the week that CONTAINS the label's start date, then
 *   laying Mon..Sun across the columns. That anchor is "on or BEFORE the start
 *   date", so when a label's start day is not a Monday the whole week can resolve
 *   to the wrong Monday.
 *
 *   The damaging case is a label that starts on a SUNDAY (Mike wrote e.g. "OC13"
 *   when his real training week is Mon Oct 14 – Sun Oct 20). Sunday is the LAST day
 *   of the Mon..Sun week that contains it, so "the Monday of the containing week"
 *   is the PREVIOUS Monday — every cell of that week lands exactly 7 days early,
 *   stacked on top of the genuine prior week. 42 of the 1359 week labels do not
 *   start on a Monday; this fixes the subset whose drift is corroborated below.
 *
 *   Example that motivated this (1991-10-07): the real day held a run + two bikes,
 *   but "OC13 - OC19" (Sun Oct 13) collapsed onto Mon Oct 7, adding a phantom 60-min
 *   swim and a phantom "23:25 / 6 k" run — both actually Mike's Oct-14 sessions.
 *
 * HOW EACH WEEK IS CONFIRMED (running log = ground truth)
 *   The running log (src="r") is exact and correctly dated. A grid week is treated
 *   as drifted by +7 only when its run cells line up with running-log runs SEVEN
 *   days later: at least one grid run matches a running-log run (same finishing
 *   time, ±2 s) at parsed-date + 7, and NO grid run matches one at +0 or +14 (which
 *   would mean it is already correct, or drifted by a different amount). Weeks that
 *   don't meet this bar are left untouched.
 *
 * THE FIX (per cell of a confirmed week; same shape as fix-stacked-grid-weeks.js)
 *   - RUN cell that duplicates a running-log run at the corrected date -> DROP.
 *     The running log already holds it on its true date; the grid copy is a
 *     mis-dated duplicate that dedup-grid-runs.js could not catch (its date didn't
 *     match). A handful match on distance with a sub-minute time gap (transcription
 *     slips, e.g. grid 44:05 vs log 44:04) — still the same run, still dropped, as
 *     the running log is authoritative for runs.
 *   - Any other cell (swim / bike / hockey / squash / weights / note, or a RUN with
 *     no running-log counterpart) -> MOVE to the true date (parsed date + 7). These
 *     have no exact source of truth, so they are relocated, never dropped.
 *
 * NOT FIXED (left for Mike's review — see source/mike-review.md)
 *   Three drifted weeks need a judgment call and are deliberately left as-is:
 *     2000 MY 14-20 : grid run "43:43 / 10" vs running-log "44:43 / 10" on the
 *                     corrected day — same run mis-keyed by a minute, or two runs?
 *     2000 MY 28-JN4: a grid-only "4k 22:00" run whose corrected date already holds
 *                     a different running-log run; plus duplicate karate cells.
 *     2019 SE 23-OC6: the Tremblant week — a timeless "9k run" cell and a 5.2 km
 *                     run 6 s off the log; race-week data best adjudicated by hand.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact byte formatting. Each edit is selected by a field predicate and must
 * match its expected count (1) or the script aborts. After writing, run
 * `node validate-data.js --fix` to rebuild the derived meta block.
 *
 *   node tools/fix-drifted-grid-weeks.js            # dry run: report the plan
 *   node tools/fix-drifted-grid-weeks.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// ---- edit list -------------------------------------------------------------
// sel: predicate on the parsed row (d,s required; t or rEq to disambiguate).
// act: 'drop' | {move:'YYYY-MM-DD'}.  Every edit must match exactly one row.
const drop = (site, why, sel) => ({ site, why, sel, expect: 1, act: 'drop' });
const move = (site, why, sel, to) => ({ site, why, sel, expect: 1, act: { move: to } });

const EDITS = [
  // 1991 OC13 - OC19 — grid anchors 1991-10-07, true week +7 (1991-10-14..)
  move("1991 OC13 - OC19", "swim 60 s -> 1991-10-14", { d: "1991-10-07", s: "swim", rEq: "60 s" }, "1991-10-14"),
  move("1991 OC13 - OC19", "swim ~2k -> 1991-10-16", { d: "1991-10-09", s: "swim", rEq: "~2k" }, "1991-10-16"),
  move("1991 OC13 - OC19", "swim 60 s -> 1991-10-20", { d: "1991-10-13", s: "swim", rEq: "60 s" }, "1991-10-20"),
  drop("1991 OC13 - OC19", "23:25 r 6 k = 1991-10-14 run (running log)", { d: "1991-10-07", s: 'run', t: 1405 }),
  drop("1991 OC13 - OC19", "42:51 r 11k = 1991-10-16 run (running log)", { d: "1991-10-09", s: 'run', t: 2571 }),
  drop("1991 OC13 - OC19", "40:50r 9.5 = 1991-10-17 run (running log)", { d: "1991-10-10", s: 'run', t: 2450 }),
  drop("1991 OC13 - OC19", "39:26 10 k = 1991-10-20 run (running log)", { d: "1991-10-13", s: 'run', t: 2366 }),
  // 1991 OC20 - OC27 — grid anchors 1991-10-14, true week +7 (1991-10-21..)
  move("1991 OC20 - OC27", "swim ~2 -> 1991-10-21", { d: "1991-10-14", s: "swim", rEq: "~2" }, "1991-10-21"),
  move("1991 OC20 - OC27", "swim ~2.2 -> 1991-10-23", { d: "1991-10-16", s: "swim", rEq: "~2.2" }, "1991-10-23"),
  move("1991 OC20 - OC27", "swim ~2 -> 1991-10-24", { d: "1991-10-17", s: "swim", rEq: "~2" }, "1991-10-24"),
  move("1991 OC20 - OC27", "swim 90s 3.5 -> 1991-10-27", { d: "1991-10-20", s: "swim", rEq: "90s      3.5" }, "1991-10-27"),
  drop("1991 OC20 - OC27", "27:52r 7k = 1991-10-22 run (running log)", { d: "1991-10-15", s: 'run', t: 1672 }),
  drop("1991 OC20 - OC27", "28:24 7.4k = 1991-10-23 run (running log)", { d: "1991-10-16", s: 'run', t: 1704 }),
  drop("1991 OC20 - OC27", "30:04 r 7.4 = 1991-10-24 run (running log)", { d: "1991-10-17", s: 'run', t: 1804 }),
  drop("1991 OC20 - OC27", "75:24 r 18k = 1991-10-26 run (running log)", { d: "1991-10-19", s: 'run', t: 4524 }),
  // 1994 AU 7 - AU13 — grid anchors 1994-08-01, true week +7 (1994-08-08..)
  move("1994 AU 7 - AU13", "bike av35.8 145 52 -> 1994-08-10", { d: "1994-08-03", s: "bike", rEq: "av35.8 145  52" }, "1994-08-10"),
  drop("1994 AU 7 - AU13", "29:40 7 = 1994-08-08 run (running log)", { d: "1994-08-01", s: 'run', t: 1780 }),
  drop("1994 AU 7 - AU13", "33:20 8 = 1994-08-10 run (running log)", { d: "1994-08-03", s: 'run', t: 2000 }),
  drop("1994 AU 7 - AU13", "32:22 161 8.3 = 1994-08-11 run (running log)", { d: "1994-08-04", s: 'run', t: 1942 }),
  drop("1994 AU 7 - AU13", "28:30 7 = 1994-08-12 run (running log)", { d: "1994-08-05", s: 'run', t: 1710 }),
  // 1994 AU14 - AU20 — grid anchors 1994-08-08, true week +7 (1994-08-15..)
  drop("1994 AU14 - AU20", "35:00 8 = 1994-08-15 run (running log)", { d: "1994-08-08", s: 'run', t: 2100 }),
  drop("1994 AU14 - AU20", "1:17:00 17 = 1994-08-16 run (running log)", { d: "1994-08-09", s: 'run', t: 4620 }),
  drop("1994 AU14 - AU20", "35:00 8 = 1994-08-19 run (running log)", { d: "1994-08-12", s: 'run', t: 2100 }),
  // 1994 AU21 - AU27 — grid anchors 1994-08-15, true week +7 (1994-08-22..)
  move("1994 AU21 - AU27", "swim 1.7 -> 1994-08-25", { d: "1994-08-18", s: "swim", rEq: "1.7" }, "1994-08-25"),
  move("1994 AU21 - AU27", "swim 2 -> 1994-08-27", { d: "1994-08-20", s: "swim", rEq: "2" }, "1994-08-27"),
  move("1994 AU21 - AU27", "bike av36.1 147 52 -> 1994-08-22", { d: "1994-08-15", s: "bike", rEq: "av36.1 147  52" }, "1994-08-22"),
  move("1994 AU21 - AU27", "bike av34 137 62 -> 1994-08-23", { d: "1994-08-16", s: "bike", rEq: "av34  137   62" }, "1994-08-23"),
  move("1994 AU21 - AU27", "bike av34 40 -> 1994-08-24", { d: "1994-08-17", s: "bike", rEq: "av34        40" }, "1994-08-24"),
  move("1994 AU21 - AU27", "bike av35.6 25 -> 1994-08-25", { d: "1994-08-18", s: "bike", rEq: "av35.6     25" }, "1994-08-25"),
  move("1994 AU21 - AU27", "bike av34.6 88 -> 1994-08-27", { d: "1994-08-20", s: "bike", rEq: "av34.6      88" }, "1994-08-27"),
  drop("1994 AU21 - AU27", "37:31 147 8.3 = 1994-08-23 run (running log)", { d: "1994-08-16", s: 'run', t: 2251 }),
  drop("1994 AU21 - AU27", "44:05 154 10 = 1994-08-26 run (running log)", { d: "1994-08-19", s: 'run', t: 2645 }),
  drop("1994 AU21 - AU27", "78:30 17 = 1994-08-28 run (running log)", { d: "1994-08-21", s: 'run', t: 4710 }),
  // 1994 AU28 - SE 4 — grid anchors 1994-08-22, true week +7 (1994-08-29..)
  move("1994 AU28 - SE 4", "swim 2 -> 1994-08-29", { d: "1994-08-22", s: "swim", rEq: "2" }, "1994-08-29"),
  move("1994 AU28 - SE 4", "bike 40 -> 1994-09-01", { d: "1994-08-25", s: "bike", rEq: "40" }, "1994-09-01"),
  move("1994 AU28 - SE 4", "bike 25 -> 1994-09-02", { d: "1994-08-26", s: "bike", rEq: "25" }, "1994-09-02"),
  drop("1994 AU28 - SE 4", "35:33 154 8.5 = 1994-08-31 run (running log)", { d: "1994-08-24", s: 'run', t: 2133 }),
  // 1999 NO21 NO27 — grid anchors 1999-11-15, true week +7 (1999-11-22..)
  move("1999 NO21 NO27", "run 47:00 9 -> 1999-11-22", { d: "1999-11-15", s: "run", rEq: "47:00       9" }, "1999-11-22"),
  drop("1999 NO21 NO27", "46:13 9 = 1999-11-23 run (running log)", { d: "1999-11-16", s: 'run', t: 2773 }),
  move("1999 NO21 NO27", "hockey hockey -> 1999-11-26", { d: "1999-11-19", s: "hockey", rEq: "hockey" }, "1999-11-26"),
  // 1999 NO28 DE 5 — grid anchors 1999-11-22, true week +7 (1999-11-29..)
  move("1999 NO28 DE 5", "hockey hockey -> 1999-11-30", { d: "1999-11-23", s: "hockey", rEq: "hockey" }, "1999-11-30"),
  move("1999 NO28 DE 5", "hockey hockey -> 1999-12-03", { d: "1999-11-26", s: "hockey", rEq: "hockey" }, "1999-12-03"),
  drop("1999 NO28 DE 5", "40:37 8 = 1999-11-30 run (running log)", { d: "1999-11-23", s: 'run', t: 2437 }),
  drop("1999 NO28 DE 5", "42:44 9 = 1999-12-01 run (running log)", { d: "1999-11-24", s: 'run', t: 2564 }),
  // 2001 SE 9 SE 16 — grid anchors 2001-09-03, true week +7 (2001-09-10..)
  move("2001 SE 9 SE 16", "hockey hockey -> 2001-09-11", { d: "2001-09-04", s: "hockey", rEq: "hockey" }, "2001-09-11"),
  move("2001 SE 9 SE 16", "squash squash -> 2001-09-12", { d: "2001-09-05", s: "squash", rEq: "squash" }, "2001-09-12"),
  move("2001 SE 9 SE 16", "hockey hockey -> 2001-09-14", { d: "2001-09-07", s: "hockey", rEq: "hockey" }, "2001-09-14"),
  drop("2001 SE 9 SE 16", "44:50 9 = 2001-09-10 run (running log)", { d: "2001-09-03", s: 'run', t: 2690 }),
  // 2007 MY 7 MY 13 — grid anchors 2007-05-07, true week +7 (2007-05-14..)
  move("2007 MY 7 MY 13", "run 20:12 5 -> 2007-05-16", { d: "2007-05-09", s: "run", rEq: "20:12      5" }, "2007-05-16"),
  drop("2007 MY 7 MY 13", "43:26 9.2 = 2007-05-18 run (running log)", { d: "2007-05-11", s: 'run', t: 2606 }),
  // 2008 MY 19 MY 25 — grid anchors 2008-05-19, true week +7 (2008-05-26..)
  move("2008 MY 19 MY 25", "weights weights -> 2008-05-26", { d: "2008-05-19", s: "weights", rEq: "weights" }, "2008-05-26"),
  drop("2008 MY 19 MY 25", "9.2 46:12 = 2008-05-27 run (running log)", { d: "2008-05-20", s: 'run', t: 2772 }),
  drop("2008 MY 19 MY 25", "8.2 38:30 = 2008-05-28 run (running log)", { d: "2008-05-21", s: 'run', t: 2310 }),
  drop("2008 MY 19 MY 25", "9.2 44:55 = 2008-05-30 run (running log)", { d: "2008-05-23", s: 'run', t: 2695 }),
  drop("2008 MY 19 MY 25", "9.3 46:04 = 2008-06-01 run (running log)", { d: "2008-05-25", s: 'run', t: 2764 }),
  // 2020 MY 18 MY 24 — grid anchors 2020-05-18, true week +7 (2020-05-25..)
  move("2020 MY 18 MY 24", "bike 44 a32 -> 2020-05-25", { d: "2020-05-18", s: "bike", rEq: "44 a32" }, "2020-05-25"),
  move("2020 MY 18 MY 24", "bike 36 -> 2020-05-27", { d: "2020-05-20", s: "bike", rEq: "36" }, "2020-05-27"),
  move("2020 MY 18 MY 24", "bike 34 -> 2020-05-28", { d: "2020-05-21", s: "bike", rEq: "34" }, "2020-05-28"),
  move("2020 MY 18 MY 24", "bike 35 -> 2020-05-29", { d: "2020-05-22", s: "bike", rEq: "35" }, "2020-05-29"),
  drop("2020 MY 18 MY 24", "5 25:43 = 2020-05-28 run (running log)", { d: "2020-05-21", s: 'run', t: 1543 }),
  // 2020 MY 25 MY 31 — grid anchors 2020-05-25, true week +7 (2020-06-01..)
  move("2020 MY 25 MY 31", "bike 9 46;0 -> 2020-06-01", { d: "2020-05-25", s: "bike", rEq: "9 46;0" }, "2020-06-01"),
  drop("2020 MY 25 MY 31", "10 51:50 = 2020-06-04 run (running log)", { d: "2020-05-28", s: 'run', t: 3110 }),
  move("2020 MY 25 MY 31", "bike 9 46 -> 2020-06-06", { d: "2020-05-30", s: "bike", rEq: "9 46" }, "2020-06-06"),
];

// ---- engine (same span-surgery approach as fix-stacked-grid-weeks.js) ------
const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

const arrOpen = text.indexOf('[', text.indexOf('"rows":'));
const spans = [];
let depth = 0, objStart = -1, inStr = false, esc = false, end = -1;
for (let i = arrOpen + 1; i < text.length; i++) {
  const ch = text[i];
  if (inStr) {
    if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
    continue;
  }
  if (ch === '"') inStr = true;
  else if (ch === '{') { if (depth++ === 0) objStart = i; }
  else if (ch === '}') { if (--depth === 0) spans.push([objStart, i + 1]); }
  else if (ch === ']' && depth === 0) { end = i; break; }
}
if (end === -1) { console.error('FAIL  could not parse the rows array; refusing to touch the file.'); process.exit(1); }
if (spans.length !== data.rows.length) {
  console.error(`FAIL  scanned ${spans.length} row objects but JSON has ${data.rows.length}; refusing to touch.`);
  process.exit(1);
}

const matches = (r, sel) =>
  r.d === sel.d && r.s === sel.s &&
  (sel.t == null || r.t === sel.t) &&
  (sel.rEq == null || r.r === sel.rEq);

const seen = EDITS.map(() => 0);
const kept = [];
let dropped = 0, moved = 0;

spans.forEach(([s, e], i) => {
  const r = data.rows[i];
  const idx = EDITS.findIndex(ed => matches(r, ed.sel));
  if (idx === -1) { kept.push(text.slice(s, e)); return; }
  seen[idx]++;
  const ed = EDITS[idx];
  const sub = text.slice(s, e);
  if (ed.act === 'drop') {
    dropped++; console.log(`  DROP  [${ed.site}] ${r.d} ${r.s} ${JSON.stringify(r.r).slice(0, 28)}  — ${ed.why}`);
  } else if (ed.act.move) {
    const to = ed.act.move;
    const out = sub.replace(`"d":"${ed.sel.d}"`, `"d":"${to}"`);
    if (out === sub) { console.error(`FAIL  move could not rewrite date for: ${ed.why}`); process.exit(1); }
    kept.push(out); moved++; console.log(`  MOVE  [${ed.site}] ${r.d} -> ${to}  ${r.s} ${JSON.stringify(r.r).slice(0, 22)}  — ${ed.why}`);
  }
});

// Every edit must have matched exactly once, or the data changed under us.
const problems = EDITS.filter((ed, i) => seen[i] !== ed.expect);
if (problems.length) {
  console.error('\nFAIL  these edits did not match their expected count (data.json changed or already fixed):');
  for (const p of problems) console.error(`   saw ${seen[EDITS.indexOf(p)]}, expected ${p.expect}: [${p.site}] ${p.why}`);
  process.exit(1);
}

console.log(`\n${dropped} dropped, ${moved} moved (net rows removed: ${dropped}).`);
if (!WRITE) { console.log('(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);                          // must still be valid JSON
if (check.rows.length !== data.rows.length - dropped) {
  console.error('row count mismatch after rebuild — aborting'); process.exit(1);
}
fs.writeFileSync(FILE, rebuilt);
console.log(`written to data.json (${dropped} rows removed). Now run: node validate-data.js --fix`);
