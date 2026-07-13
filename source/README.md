# Source data

The raw, human-authored inputs that `data.json` is generated from. These are the
source of truth — keep them here in version control so the dataset can always be
rebuilt (they were previously lost because they lived only in scratch storage,
never in git).

- **`running.log.txt`** — the precise running log. One run per line, pipe-delimited:
  `YYYYMMDD | time | km | pace | ... | shoe | route/notes`. Originally parsed by a
  Perl script named `runparse.pl` (see the header line in the file). This is the
  **authoritative source for runs** — where the weekly grid and this log disagree
  on a run, this file wins, and grid run-entries are de-duplicated against it.

- **`training.log.txt`** — the weekly training grid. One block per week (Mon–Sun
  columns), each day cell holding shorthand entries (e.g. `36:01s 1.75k` = a
  36:01 swim of 1.75 km; `44 b 24 k` = a bike of 24 km). The left column of each
  block is that week's per-sport totals (`s` swim, `r` run, `b` bike). Covers all
  sports; runs here are reconciled against `running.log.txt`.
