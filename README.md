# Mike's Training Log

A browsable, filterable website for 30+ years of Mike's training data
(1991–2022): runs, rides, swims, hockey, karate, XC skiing and more.

- **Dashboard** — lifetime totals and per-sport breakdowns.
- **Reports** — year summaries, sport summaries, a year × sport matrix, and personal bests.
- **Report Builder** — filter by year / sport / source / distance, group and measure however you like, export CSV.
- **Raw Data** — every parsed entry with its original shorthand preserved.
- **Data QA** — cross-check the live data against Mike's own written totals,
  spot-check the uncertain entries, record rulings, and edit raw values.

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

The raw source files live in `source/` (`training.log.txt`, `running.log.txt`),
with `source/DECODING.md` documenting the shorthand grammar and `source/mike-review.md`
listing entries that need Mike's judgment.

### Data accuracy & the QA workflow

The **runs are exact** — they come from the precise running log and reconcile with
Mike's own per-year run table. The **grid distances (bike/swim) are ~95% low-confidence**:
Mike's shorthand is genuinely ambiguous, so those totals overshoot his own annual
`Totals`. The **Data QA** tab surfaces all of this and lets Mike fix it:

1. Mike reviews the flagged entries in the **Data QA** tab and enters rulings / edits.
2. He clicks **Export** — a JSON of his rulings + edits downloads.
3. That file is applied to the data:

```
node tools/apply-rulings.js <export.json>          # dry run
node tools/apply-rulings.js <export.json> --write   # apply edits; free-text rulings are listed to interpret
```

Rulings/edits persist in the browser (`localStorage`) today. To back them with a
server later, set `QAStore.SYNC_URL` in `index.html` — saves then also POST there,
with no other changes.

**Supporting tools** (`tools/`): `build-data.js` (rebuild + self-check runs against
Mike's run table), `gen-review.js` (regenerate `mike-review.md`), `gen-qa-data.js`
(regenerate the `qa-data.json` checksums the QA tab reconciles against),
`apply-corrections.js` (the conservative, provably-correct fixes already applied),
`dedup-grid-runs.js` (drop grid run cells that duplicate an exact running-log run —
same day + identical finishing time — so a run isn't double-counted and a grid's
inflated distance can't pair with a race-only time to fake a record).
