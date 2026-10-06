# Review: the dark quote fill, a little less saturated (plan and code together)

This is one review of a small plan and the change built from it, because the change is three
numbers in one token file. You may fix what you find inside this change (the files below) and
report anything wider for me to decide. Work in this checkout (a git worktree at
`/var/tmp/spideryarn-worktrees/quote-fill-less-saturated`). Do not commit, do not run git commands
that change anything, and do not touch files outside the list unless a finding requires it; say so
if you did.

The request, verbatim, from the product owner, Greg, 2026-10-06, a day after the dark fill was made
a deeper purple at his request (plan `docs/plans/261005j-…md`, which you reviewed): "Now the purple
Quote highlighting is a little toooo saturated. Just dial it down a bit. Take screenshot". He wants
the simplest version. The light appearance and the spine strip must not change.

What was built, dark page only: `--quote-prose-rgb` `151 48 208` to `143 70 189` (same OKLCH hue
and lightness, 0.8 of the chroma), and `--quote-fill-heavy` 0.6 to 0.58. Read
`docs/plans/261006e-dark-quote-fill-a-little-less-saturated.md` first.

The diff is `git diff HEAD` plus the untracked `docs/plans/261006e-*`. The files:

- `styles/tokens.css` — the two values and their comments.
- `tests/quote-fill.test.ts` — a new "not too saturated" check; the faintest-chroma floor 0.08 to
  0.065; the "more saturated than the strip" margin 0.05 to 0.03.
- `docs/project/quotes.md` — new § A little less saturated; a pointer at the top of the previous
  section; the strengths paragraph.
- `docs/plans/261006e-*` — the plan and this prompt.

What I want checked:

1. **Recompute every number** in the plan's table and the new quotes.md section with your own
   script, in gamma-encoded sRGB source-over compositing on the opaque grounds, as yesterday. Fix
   any figure that is wrong.
2. **Is the choice sound for "dial it down a bit"**, given yesterday's complaint was "a little hard
   to see"? I held the OKLab-distance floor (0.16) and cut chroma by about a quarter on the page. If
   you think a different point (more or less of a cut, or strengths instead of colour) is plainly
   better, say which and why; do not change the values yourself, report it.
3. **The two floors I lowered** in the test: is lowering them honest, or is it moving a goalpost to
   get green? Is the new ceiling a real check (it was red on `151 48 208`: 0.0986 against 0.09)?
4. **Pairings the test does not sum** that got worse versus yesterday's purple: low-confidence
   search outlines, the page-coloured gap between abutting quotes, the glossary and cross-reference
   rules, the reader's four washes beside a quote, the grounds other than the page (`--card`,
   `--panel`, `--muted`, `--surface-raised`). List any that regress by more than a rounding error.
5. **Anything else naming the old values** as current that I missed (`151 48 208`, 0.60 as the dark
   heavy strength) in `src/`, `styles/`, `tests/`, `docs/project/`. History in older plans and in
   the 2026-10-05 doc section is meant to stay.
6. Run `npx vitest run tests/quote-fill.test.ts tests/appearance-palette.test.ts
   tests/block-flash.test.ts tests/css-tokens.test.ts tests/doc-links.test.ts` if the box lets you,
   and say plainly if it did not.

End with a verdict line: ship, or do not ship and why. P0/P1/P2 on each finding.
