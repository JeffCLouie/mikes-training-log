# Data points for Mike to validate

A running list of entries where the original parse is uncertain or looks wrong,
rebuilt from the raw source files. Each needs a human ruling — add a **Ruling:**
note under any row and we encode it as a permanent correction in the pipeline.

---

## Batch 1 — race results parsed as distances (30 rows)

In triathlon/race summary cells, finishing places (`Nc` = Nth in class, `Noa` =
Nth overall) and field sizes were misread as a distance (`k`) — phantom kilometres
that inflate distance totals. The original parser already flagged nearly all of
these low-confidence (`c`: "d" doubtful / "u" uncertain).

| Date | Raw cell | Current parse | Likely correct reading |
|---|---|---|---|
| 1991-08-05 | `1:59:3613c62oa` | s=other, k=13, t=7176, c=u | total 1:59:36, 13th class, 62nd overall, no distance |
| 1992-07-04 | `1:32:08 5c17oa` | s=swim, k=5, t=5528, c=d | total 1:32:08, 5th class, 17th overall, no distance |
| 1992-07-19 | `2:03:56 3c20oa` | s=run, k=20, t=7436, c=d | total 2:03:56, 3rd class, 20th overall, no distance |
| 1992-08-03 | `1:54:06 7c25oa --------------` | s=other, k=7, t=6846, c=u | total 1:54:06, 7th class, 25th overall, no distance |
| 1993-08-02 | `1:51:47 5c16oa` | s=swim, k=5, t=6707, c=d | total 1:51:47, 5th class, 16th overall, no distance |
| 1994-06-26 | `7oa 4c` | s=bike, k=7, t=—, c=d | 4th class, 7th overall, no distance |
| 1994-08-01 | `1:51:17 5c20oa` | s=swim, k=5, t=6677, c=d | total 1:51:17, 5th class, 20th overall, no distance |
| 1994-08-28 | `c9oa   52:37` | s=run, k=9, t=3157, c=d | total 52:37, 9th overall, no distance |
| 1995-05-07 | `T 58:10 4c8oa` | s=swim, k=4, t=3490, c=d | total 58:10, 4th class, 8th overall, no distance |
| 1995-06-25 | `9oa 5c` | s=bike, k=9, t=—, c=d | 5th class, 9th overall, no distance |
| 1995-07-09 | `54  5c 18oa` | s=bike, k=54, t=—, c=d | 5th class, 18th overall, no distance |
| 1995-07-29 | `5c17oa` | s=bike, k=17, t=—, c=d | 5th class, 17th overall, no distance |
| 1995-08-07 | `1:52:50 6c14oa` | s=other, k=6, t=6770, c=u | total 1:52:50, 6th class, 14th overall, no distance |
| 1995-08-27 | `2:02:22 oa` | s=other, k=—, t=7342, c=u | total 2:02:22, no distance |
| 1996-06-02 | `3c 5oa    /70` | s=bike, k=70, t=—, c=d | 3rd class, 5th overall, no distance |
| 1996-06-22 | `6c 21oa` | s=bike, k=21, t=—, c=d | 6th class, 21st overall, no distance |
| 1996-08-05 | `1:48:49 3c13oa` | s=swim, k=3, t=6529, c=d | total 1:48:49, 3rd class, 13th overall, no distance |
| 1996-08-11 | `6oa` | s=bike, k=6, t=—, c=d | 6th overall, no distance |
| 1996-08-18 | `2:04:08 2c8oa` | s=other, k=8, t=7448, c=u | total 2:04:08, 2nd class, 8th overall, no distance |
| 1996-09-21 | `53:29 6oa` | s=run, k=6, t=3209, c=d | total 53:29, 6th overall, no distance |
| 1997-06-01 | `c 5oa` | s=swim, k=5, t=—, c=d | 5th overall, no distance |
| 1997-07-13 | `c 7oa` | s=bike, k=7, t=—, c=d | 7th overall, no distance |
| 1999-07-04 | `c 7oa` | s=bike, k=7, t=—, c=d | 7th overall, no distance |
| 2001-07-01 | `3c9oa` | s=bike, k=9, t=—, c=d | 3rd class, 9th overall, no distance |
| 2001-07-08 | `a163   4c19oa` | s=bike, k=19, t=—, c=d | 4th class, 19th overall, no distance |
| 2001-08-05 | `Tri  2c 3oa` | s=swim, k=3, t=—, c=d | 2nd class, 3rd overall, no distance |
| 2001-08-26 | `2:19:39 4c11oa` | s=swim, k=4, t=8379, c=d | total 2:19:39, 4th class, 11th overall, no distance |
| 2002-08-04 | `i  2c 4oa` | s=swim, k=4, t=—, c=d | 2nd class, 4th overall, no distance |
| 2005-07-31 | `r Tri 4c 12oa` | s=bike, k=12, t=—, c=d | 4th class, 12th overall, no distance |
| 2017-08-06 | `iver 5c 13oa` | s=bike, k=13, t=—, c=d | 5th class, 13th overall, no distance |

**Proposed blanket ruling:** drop the phantom `k` on all Batch-1 rows; keep the
total time; record class/overall placement as a note. _Mike to confirm or amend._
