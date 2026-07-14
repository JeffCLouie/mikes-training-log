#!/usr/bin/env node
/*
 * fix-stacked-grid-weeks.js — un-stack the weeks the grid parser piled onto a
 * single week wherever a week separator lost its year marker.
 *
 * WHAT WENT WRONG
 *   The weekly training grid (source/training.log.txt) separates weeks with a
 *   "---YYYY----" marker line, and the grid parser advances to a new week only
 *   when it sees that year marker. In exactly SEVEN places the separator between
 *   two weeks is a plain "-----------" dash run with no year (1694 separators
 *   carry the year; only these 7 do not). At each of those, the following week
 *   was NOT advanced onto its own dates — its cells were written column-by-column
 *   onto the PREVIOUS (year-marked) week's Mon..Sun dates, stacking two (or three)
 *   real weeks onto one. The next year-marked week re-syncs, so the damage is
 *   local to each site.
 *
 *   Six of the seven yearless separators start a stacked week (the seventh,
 *   training.log.txt:622, is a year-end section divider before the Totals — no
 *   week follows it). They cluster into FOUR sites:
 *
 *     1992 Aug : AU10-16 stacked onto AU 3-9      (sep L290)
 *     1993 Feb : FE 8-14 stacked onto FE 1-7      (sep L412)
 *     1996 Jul : JY15-21 and JY22-28 stacked onto JY 8-14   (sep L1207, L1212)
 *     2000 Jun : JN19-25 and JN26-JL2 stacked onto JN12-18  (sep L2051, L2056)
 *
 *   The 1996 site is the worst: three weeks (Jul 8-28) collapsed onto Jul 8-14,
 *   producing a phantom "Biggest week" record of 710 km (527 of it bike) — three
 *   weeks' riding plus the Kingston Triathlon, all counted in seven days.
 *
 * THE FIX (see per-site EDITS below)
 *   The row objects are PARSED correctly (right sport / distance / time) — only
 *   their DATE is wrong. So the repair is, per stacked cell:
 *     - RUN cells  -> DROP. The running log (src="r") is authoritative and exact
 *       for runs and already holds every one of these on its true date; the grid
 *       copy is a mis-dated duplicate that dedup-grid-runs.js could not catch
 *       (its date didn't match the running-log run's date). Every dropped run is
 *       verified to have a running-log twin (same finishing time) in-window.
 *     - non-RUN cells (swim / bike / note) -> MOVE to the true date
 *       (true week Monday + column offset). These have no running-log counterpart,
 *       so they are relocated, never dropped.
 *   The 1996 Kingston Triathlon (really Jul 21, split across Jul 13-14 by the bug)
 *   is reconstructed as a swim + bike + run day on Jul 21, folding the transition
 *   times into the leg notes and turning the mis-parsed 35 km "run" (the 3:16:45
 *   overall time) into an overall-result note — mirroring fix-kennebunk-1994.js.
 *
 * NOT FIXED (documented, left as-is)
 *   In 1992/1993/2000 the parser also FUSED some adjacent-week cells into one row
 *   (e.g. 1992-08-06 bike "hills 10 ... 24" merges AU3-9's "hills 10" with
 *   AU10-16's "24"; 1993-02-01 bike "2.7 ... 55" merges FE1-7's "2.7" swim with
 *   FE8-14's "55"; 2000-06-13 karate fuses three days' "karate"). A fused row
 *   cannot be split without inventing data, so it is left on its (anchor-week)
 *   date. These carry little distance and are noted here for the record.
 *
 * Edits are targeted string surgery on the minified JSON so untouched rows keep
 * their exact byte formatting. Each edit is selected by a field predicate and must
 * match its expected count or the script aborts. After writing, run
 * `node validate-data.js --fix` to rebuild the derived meta block.
 *
 *   node tools/fix-stacked-grid-weeks.js            # dry run: report the plan
 *   node tools/fix-stacked-grid-weeks.js --write    # apply to data.json
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

// ---- edit list -------------------------------------------------------------
// sel: predicate on the parsed row (d,s required; t/k/rEq/rHas optional).
// expect: how many rows the predicate must match (drift guard).
// apply:  how many of those to act on (default = expect); the rest are left as-is
//         (used when identical rows split between "stay" and "move", e.g. two
//         "1.2" swims on the same day where one belongs to a later week).
// act:    'drop' | {move:'YYYY-MM-DD'} | {replace:'<exact minified object>'}
const drop = (site, why, sel, expect = 1, apply) => ({ site, why, sel, expect, apply, act: 'drop' });
const move = (site, why, sel, to, expect = 1, apply) => ({ site, why, sel, expect, apply, act: { move: to } });
const repl = (site, why, sel, obj) => ({ site, why, sel, expect: 1, act: { replace: obj } });

const EDITS = [
  // ===================== 1996 Jul (JY8 anchor; JY15 +7; JY22 +14) ============
  // --- run duplicates of exact running-log runs -> DROP ---
  drop('1996-07', '42:34 = Jul 7 run (log)',  { d: '1996-07-08', s: 'run', t: 2554 }),
  drop('1996-07', '43:22 = Jul 15 run (log)', { d: '1996-07-08', s: 'run', t: 2602 }),
  drop('1996-07', '35:24 = Jul 8 run (log)',  { d: '1996-07-09', s: 'run', t: 2124 }),
  drop('1996-07', '38:35 = Jul 16 run (log)', { d: '1996-07-09', s: 'run', t: 2315 }),
  drop('1996-07', '43:34 = Jul 23 run (log)', { d: '1996-07-09', s: 'run', t: 2614 }),
  drop('1996-07', '8x.5 int = Jul 24 run (log)', { d: '1996-07-10', s: 'run', rHas: '8x.5 1:26 7.5' }),
  drop('1996-07', '34:35 = Jul 18 run (log)', { d: '1996-07-11', s: 'run', t: 2075 }),
  drop('1996-07', '43:05 = Jul 25 run (log)', { d: '1996-07-11', s: 'run', t: 2585 }),
  drop('1996-07', '30:51 = Jul 19 run (log)', { d: '1996-07-12', s: 'run', t: 1851 }),
  drop('1996-07', '40:00/8.5 = Jul 26 run (log)', { d: '1996-07-12', s: 'run', t: 2400 }),
  drop('1996-07', '65:02 = Jul 21 tri run (log)', { d: '1996-07-13', s: 'run', t: 3902 }),
  // --- JY15 non-run cells -> +7 days ---
  move('1996-07', 'JY15 Mon swim',  { d: '1996-07-08', s: 'swim', rEq: '1.6' }, '1996-07-15'),
  move('1996-07', 'JY15 Tue note',  { d: '1996-07-09', s: 'note', rEq: '12312312' }, '1996-07-16'),
  move('1996-07', 'JY15 Thu swim (1 of the two 1.2s)', { d: '1996-07-11', s: 'swim', rEq: '1.2' }, '1996-07-18', 2, 1),
  repl('1996-07', 'JY15 Wed bike -> Jul 17 (drop fused "184")',
    { d: '1996-07-10', s: 'bike', k: 40 },
    '{"d":"1996-07-17","s":"bike","r":"av34.4 139 40","src":"t","c":"d","k":40.0,"h":139,"a":34.4}'),
  // --- JY22 non-run cells -> +14 days ---
  move('1996-07', 'JY22 Wed bike',  { d: '1996-07-10', s: 'bike', k: 39 }, '1996-07-24'),
  move('1996-07', 'JY22 Fri swim',  { d: '1996-07-12', s: 'swim', rEq: '1.4' }, '1996-07-26'),
  move('1996-07', 'JY22 Fri bike',  { d: '1996-07-12', s: 'bike', k: 48.5 }, '1996-07-26'),
  move('1996-07', 'JY22 Sat swim',  { d: '1996-07-13', s: 'swim', rEq: '1.8' }, '1996-07-27'),
  move('1996-07', 'JY22 Sat bike',  { d: '1996-07-13', s: 'bike', k: 38.5 }, '1996-07-27'),
  move('1996-07', 'JY22 Sun swim',  { d: '1996-07-14', s: 'swim', rEq: '1.4' }, '1996-07-28'),
  move('1996-07', 'JY22 Sun bike',  { d: '1996-07-14', s: 'bike', k: 52 }, '1996-07-28'),
  // --- Kingston Triathlon (JY15 Sun) reconstructed on Jul 21 ---
  repl('1996-07', 'tri swim leg -> Jul 21 (fold T1 1:43)',
    { d: '1996-07-13', s: 'swim', t: 2398 },
    '{"d":"1996-07-21","s":"swim","r":"2.4 39:58 1:43","src":"t","c":"d","t":2398,"k":2.4,"n":"RACE - Kingston Triathlon - swim leg (2.4 km, 39:58); T1 1:43"}'),
  repl('1996-07', 'tri bike leg -> Jul 21 (fold T2 :50)',
    { d: '1996-07-13', s: 'bike', t: 5340 },
    '{"d":"1996-07-21","s":"bike","r":"52  89:00 :50","src":"t","c":"d","t":5340,"k":52.0,"n":"RACE - Kingston Triathlon - bike leg (52 km, 1:29:00); T2 :50"}'),
  repl('1996-07', 'tri overall 3:16:45 -> note (kill phantom 35 km run)',
    { d: '1996-07-14', s: 'run', t: 11805 },
    '{"d":"1996-07-21","s":"note","r":"3:16:45 35o7c","src":"t","c":"u","n":"RACE - Kingston Triathlon - overall 3:16:45 (35th overall, 7th in category)"}'),
  drop('1996-07', 'tri T1 1:43 (folded into swim leg note)', { d: '1996-07-14', s: 'other', t: 103 }),
  drop('1996-07', 'tri T2 :50 mis-parsed as 50 km bike (folded into bike leg note)', { d: '1996-07-14', s: 'bike', k: 50 }),
  repl('1996-07', 'JY8 Sat bike stays Jul 13; strip fused "|Kingston T"',
    { d: '1996-07-13', s: 'bike', k: 32 },
    '{"d":"1996-07-13","s":"bike","r":"av34.7 134  32","src":"t","c":"d","k":32.0,"h":134,"a":34.7}'),

  // ===================== 1992 Aug (AU3-9 anchor; AU10-16 +7) =================
  // Only clean cells are the run duplicates; AU10-16's "24" bikes and race notes
  // were fused into anchor rows (see header) and are left as-is.
  drop('1992-08', '33:35 = Aug 10 run (log)', { d: '1992-08-03', s: 'run', t: 2015 }),
  drop('1992-08', '8x.5 int = Aug 11 run (log)', { d: '1992-08-04', s: 'run', rHas: '8@ 475' }),
  drop('1992-08', '29:38 = Aug 13 run (log)', { d: '1992-08-06', s: 'run', t: 1778 }),
  drop('1992-08', '38:43 = Aug 15 NT Summer Games run (log)', { d: '1992-08-08', s: 'run', t: 2323 }),

  // ===================== 1993 Feb (FE1-7 anchor; FE8-14 +7) ==================
  drop('1993-02', '39:08/9.7 = Feb 12 run (log)', { d: '1993-02-05', s: 'run', t: 2348 }),
  drop('1993-02', '1:13:33/17.5 = Feb 14 run (log 1:13:31)', { d: '1993-02-07', s: 'run', t: 4413 }),
  move('1993-02', 'FE8-14 Mon swim', { d: '1993-02-01', s: 'swim', rEq: '2.9' }, '1993-02-08'),
  move('1993-02', 'FE8-14 Wed swim', { d: '1993-02-03', s: 'swim', rEq: '2.7' }, '1993-02-10'),
  move('1993-02', 'FE8-14 Thu swim', { d: '1993-02-04', s: 'swim', rEq: '2.4' }, '1993-02-11'),
  move('1993-02', 'FE8-14 Sun swim (the clean "3.0")', { d: '1993-02-07', s: 'swim', rEq: '3.0' }, '1993-02-14'),

  // ===================== 2000 Jun (JN12-18 anchor; JN19 +7; JN26 +14) ========
  drop('2000-06', '42:40 = Jun 19 run (log)', { d: '2000-06-12', s: 'run', t: 2560 }),
  drop('2000-06', '45:03 = Jun 28 run (log)', { d: '2000-06-14', s: 'run', t: 2703 }),
  drop('2000-06', '30:07 = Jun 22 run (log; mis-tagged karate)', { d: '2000-06-15', s: 'karate', t: 1807 }),
  drop('2000-06', '44:22 = Jun 23 run (log)', { d: '2000-06-16', s: 'run', t: 2662 }),
  drop('2000-06', '45:15 = Jul 2 run (log)', { d: '2000-06-18', s: 'run', t: 2715 }),
  move('2000-06', 'JN19 Mon dragon-boat (1 of the two)', { d: '2000-06-12', s: 'swim', rEq: 'db 1 hour' }, '2000-06-19', 2, 1),
  move('2000-06', 'JN19 Wed dragon-boat', { d: '2000-06-14', s: 'swim', rEq: 'db 1 hour' }, '2000-06-21'),
  repl('2000-06', 'JN19 Sat Dragon Boat result -> note Jun 24 (kill phantom 30 km bike)',
    { d: '2000-06-17', s: 'bike', rHas: '2nd overall' },
    '{"d":"2000-06-24","s":"note","r":"2nd overall 2:16.5","src":"t","c":"u","n":"Dragon Boat Races - 2nd overall 2:16.5"}'),
];

// ---- engine ----------------------------------------------------------------
const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);

// Split "rows":[ ... ] into the exact source substring of each row object.
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
  (sel.k == null || r.k === sel.k) &&
  (sel.rEq == null || r.r === sel.rEq) &&
  (sel.rHas == null || (r.r || '').includes(sel.rHas));

const seen = EDITS.map(() => 0);
const acted = EDITS.map(() => 0);
const kept = [];
let dropped = 0, moved = 0, replaced = 0;

spans.forEach(([s, e], i) => {
  const r = data.rows[i];
  const idx = EDITS.findIndex(ed => matches(r, ed.sel));
  if (idx === -1) { kept.push(text.slice(s, e)); return; }
  seen[idx]++;
  const ed = EDITS[idx];
  const cap = ed.apply == null ? ed.expect : ed.apply;
  if (acted[idx] >= cap) { kept.push(text.slice(s, e)); return; } // leave the rest untouched
  acted[idx]++;
  const sub = text.slice(s, e);
  if (ed.act === 'drop') {
    dropped++; console.log(`  DROP    [${ed.site}] ${r.d} ${r.s} ${JSON.stringify(r.r).slice(0, 30)}  — ${ed.why}`);
  } else if (ed.act.move) {
    const to = ed.act.move;
    const out = sub.replace(`"d":"${ed.sel.d}"`, `"d":"${to}"`);
    if (out === sub) { console.error(`FAIL  move could not rewrite date for ${ed.why}`); process.exit(1); }
    kept.push(out); moved++; console.log(`  MOVE    [${ed.site}] ${r.d} -> ${to}  ${r.s} ${JSON.stringify(r.r).slice(0, 24)}  — ${ed.why}`);
  } else if (ed.act.replace) {
    JSON.parse(ed.act.replace);            // the replacement must be valid JSON
    kept.push(ed.act.replace); replaced++; console.log(`  REWRITE [${ed.site}] ${r.d} ${r.s}  — ${ed.why}`);
  }
});

// Every edit must have matched its expected count, or something drifted.
const problems = EDITS.filter((ed, i) => seen[i] !== ed.expect);
if (problems.length) {
  console.error('\nFAIL  these edits did not match their expected count (data.json changed or already fixed):');
  for (const p of problems) console.error(`   saw ${seen[EDITS.indexOf(p)]}, expected ${p.expect}: [${p.site}] ${p.why}`);
  process.exit(1);
}

console.log(`\n${dropped} dropped, ${moved} moved, ${replaced} rewritten (net rows removed: ${dropped}).`);
if (!WRITE) { console.log('(dry run — pass --write to apply, then run: node validate-data.js --fix)'); process.exit(0); }

const rebuilt = text.slice(0, arrOpen + 1) + kept.join(',') + text.slice(end);
const check = JSON.parse(rebuilt);                          // must still be valid JSON
if (check.rows.length !== data.rows.length - dropped) {
  console.error('row count mismatch after rebuild — aborting'); process.exit(1);
}
fs.writeFileSync(FILE, rebuilt);
console.log(`written to data.json (${dropped} rows removed). Now run: node validate-data.js --fix`);
