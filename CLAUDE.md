# Mike's Training Log — working notes

Single static site: `index.html` + `data.json`, no build step. See `README.md`
for the data pipeline and QA workflow.

## Mobile-first (important)

This site is **primarily viewed on a phone.** Engineer every UI/UX change for
mobile first, then let it scale up to desktop:

- Design and test at a narrow viewport (~390–430px) before wide screens.
- Keep vertical space tight — controls, headers, and notes should not push the
  actual content below the fold. Avoid large empty/dead space.
- Prefer dense, glanceable layouts. Long explanations belong in a collapsed
  disclosure (`<details>`) or terse bullets, not a wall of paragraph text.
- Watch rendering performance on large DOMs: avoid animating/toggling `filter`,
  `box-shadow`, or layout properties across thousands of nodes. Prefer
  `opacity`/`transform` and class-gated static CSS over per-node style writes.
- Touch targets should be comfortably tappable; use `:active` states, not just
  `:hover`.

When in doubt, check a change with a mobile-width screenshot before committing.
