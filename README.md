# Mike's Training Log

A browsable, filterable website for 30+ years of Mike's training data
(1991–2022): runs, rides, swims, hockey, karate, XC skiing and more.

- **Dashboard** — lifetime totals and per-sport breakdowns.
- **Reports** — year summaries, sport summaries, a year × sport matrix, and personal bests.
- **Report Builder** — filter by year / sport / source / distance, group and measure however you like, export CSV.
- **Raw Data** — every parsed entry with its original shorthand preserved.

Built from a weekly training-log grid plus a precise running log (de-duplicated).
Single static site — `index.html` + `data.json`, no build step.

## Data & validation

`data.json` is **generated output** — it carries a `meta.generated` stamp and is
produced by parsing the raw training-log grid and running log. The scripts that
generate it are the source of truth and belong in version control alongside it,
so the data can always be reproduced (they must **not** be `.gitignore`d).

Because entries are sometimes hand-corrected or reclassified, the derived `meta`
block can drift out of sync with the rows. Run the integrity check before
committing any data change:

```
node validate-data.js        # verify meta matches the rows (exit 1 if not)
node validate-data.js --fix  # rebuild meta (count / span / sports) from rows
```

CI runs this automatically on every pull request into `main`.
