# Decoding the training log

Reverse-engineered grammar of the raw source files, so `data.json` can be
rebuilt and audited. Reconstructed from the data itself, cross-checked against
Mike's own written checksums. Confidence notes are honest — some of this is
solid, some is inference.

## Files

- **`running.log.txt`** — one run per line, pipe-delimited. **Fully decoded, exact.**
  `YYYYMMDD | H:MM:SS | km | pace | [hr] | [?] | shoe | route/notes`
  The heart-rate column and one spare column are *not* carried into `data.json`.
  Two lines have impossible dates (`19940431`, `20060631`) and are dropped.
  The file ends with Mike's own per-year summary (count, km, avg dist, avg pace)
  and a grand total (`5483 runs, 46879.8 km`) — an authoritative checksum. Our
  parse reconciles with it exactly (the 2 dropped typos account for the only gap).

- **`training.log.txt`** — a weekly grid, 8 columns per week:
  1. **Column 1** = the week's date range (e.g. `JL 8 - JL14`, later `JA 3  JA 9`)
     on the header row, then the week's **per-sport distance totals** on the
     following rows (`8.5k s`, `17 k r`, `149k b`).
  2. **Columns 2–8** = Mon → Sun. A day's entries stack vertically down the
     block's rows.

## Dates

Week labels are month-code + day: `JA FE MR AP MY JN JL AU SE OC NO DE`.
**The labels drift off the real calendar** in places (e.g. `OC13` in 1991 is
actually a Sunday). `data.json` follows the labels, snapping each week's start to
the Monday of the week *containing* the label's start date. A sequential
week-counting model scores far worse (16% vs 70%), confirming the label-based
reading is what the original parser used.

## Cell grammar (columns 2–8)

A cell is one activity in Mike's shorthand. Sport is encoded by a letter and/or
keyword, with a time and/or distance:

| Signal | Sport | Example |
|---|---|---|
| `s` after a number | swim | `36:01s 1.75k` = 36:01 swim, 1.75 km |
| `b` after a number | bike | `2:45b 77k` = 2h45 bike, 77 km |
| `r` after a number | run | `28:08 r 6.5 k` |
| `in` / `out` | bike **commute** (to/from work) | `in 24 12 k` = ride in, 24 min, 12 km |
| `gat` | bike (Gatineau park) | `gat2:02 61k` |
| `tt` | bike time-trial | `tt 22:16b 15k` |
| `mb` / `fb` | mountain / fat bike | `60 b 15k mb` |
| `int` / `rint` | run intervals | `25:33rint 5k`, `40r 4@1k int` |
| `hockey`,`karate`,`wts`,`squash`,`XC`,`skate`,`yoga`,`canoe`,… | that sport | keyword match |
| mostly letters, no numbers | note | `Sharbot lake`, `sick`, `Emily's Birthday.` |

**Distances** are a number before `k` (`24 k`, `1.75k`), but commutes often omit
the unit (`in 21:17 12` → 12 km), and some bikes have **no sport letter at all**,
inferred from position (`1:26 52 k` = a 52 km ride). Some cells sum two rides
(`18+63` = 81 km).

## Times (`N:NN` ambiguity)

- bare `N` → N minutes (`44 b` = 44 min)
- `N:NN` with **N ≤ 3** → hours:minutes (`2:45` = 2h45m — long rides/races)
- `N:NN` with **N ≥ 5** → minutes:seconds (`36:01` = 36m1s)
- `N:NN:NN` → H:MM:SS

## Confidence codes (the `c` field in data.json)

- `x` = confident / cleanly parsed
- `d` = doubtful (a guess — e.g. a bare number read as a distance)
- `u` = uncertain / unparsed (notes, race totals)

**Important:** ~95% of bike distance and ~91% of swim distance in `data.json` is
`c != "x"`. The grid distances are *overwhelmingly low-confidence source data*,
not clean records. Mike's per-year `Totals` lines (and the run table) are the
only authoritative distance figures.

## Races / compound cells

A race packs multiple legs + results into one day cell:
```
Sharbot lake        <- event (note)
19:00s1k 1:30t      <- swim 19:00 / 1k / T1 1:30
53:34b32k 1:05      <- bike 53:34 / 32k / T2 1:05
44:20r10k           <- run 44:20 / 10k  (matched & de-duped to the running log)
1:59:3613c62oa      <- total 1:59:36 / 13th in class / 62nd overall
```
`Nc` = Nth in class, `Noa` = Nth overall, `Nt` = transition. These placements are
frequently **misread as distances** in `data.json` (see `mike-review.md` Batch 1).

## Checksums (sources of truth, in the raw files)

1. **Weekly totals** — column 1 of each week block, per sport.
2. **Annual totals** — `YYYY Totals   Run - … Bike - … Swim - …` lines (later years
   add Karate and XC), maintained as a growing master list.
3. **Run table** — per-year run count / km / avg, at the end of `running.log.txt`.

A correct rebuild must reconcile with all three. `data.json` today does **not**
(72/90 sport-years exceed the annual totals) — see `mike-review.md` Batch 2.
