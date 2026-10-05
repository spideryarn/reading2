# Code review: the dark quote fill becomes a deeper purple, and the spine strip keeps its colour

You may fix what you find inside this change (the files below) and report anything wider for me to
decide. Work in this checkout (a git worktree at `/tmp/spideryarn-worktrees/dark-quote-prose-colour`).
Do not commit, do not run git commands that change anything, do not touch files outside the list
unless a finding requires it, and say so if you did.

The request, verbatim, from the product owner, Greg, 2026-10-05: "the purple Quote-highlights in
dark mode on an iPad screen were a little hard to see. I don't mind if they're slightly different
from the Spine". It answers option B of `[Q-dark-quote-colour]` in
`docs/user-feedback/261005_0715-quote-fill-stronger-in-the-dark-appearance.md`. Light mode must not
change. The spine strip must not change.

What was built: a new token `--quote-prose-rgb` beside `--quote-rgb` in `styles/tokens.css`. Dark:
`151 48 208` (the strip's hue, 310, darker and more saturated), with the dark fill strengths raised
from 0.28 / 0.36 to 0.48 / 0.60. Light: `127 66 166`, the same as `--quote-rgb`, strengths unchanged.
`annotations.css` § quote fills reads the new token; `spine.css` § `.spine-quote` still reads
`--quote-rgb`. Read `docs/plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md`
first; it has the table of numbers, how the values were picked and what was passed over. The plan
this follows is `docs/plans/261005f-dark-quote-fill-stronger.md`, and your two reviews of it are
beside it.

The diff is `git diff HEAD` plus the untracked files `docs/plans/261005j-*`. The files:

- `styles/tokens.css` — `--quote-prose-rgb` in both blocks, the dark strengths, the comments.
- `src/web/styles/annotations.css` — the fill reads `--quote-prose-rgb`; comment edits.
- `src/web/styles/spine.css` — comment only.
- `tests/quote-fill.test.ts` — `proseRgb`, `over()` with a ground, `stripOver()`, and the new and
  changed assertions.
- `tests/block-flash.test.ts` — the literal it replaces names the new token.
- `docs/project/quotes.md` — § Stronger on the dark page reworded as history, new § A deeper purple
  in the dark prose, the strengths paragraph.
- `docs/project/design-css-overview.md` — one sentence naming the token.
- `docs/user-feedback/261005_0715-…md` — the decision recorded.
- `docs/plans/261005j-*` — the plan and this prompt.

What I want checked:

1. **Recompute every number** in the plan's table and in the new quotes.md section with your own
   script (do not reuse the test's helpers as the only source), in gamma-encoded sRGB compositing as
   the browser does for `rgb(r g b / a)` over an opaque ground. Correct any that are wrong, in the
   docs and, if a floor is wrong, in the test. The plan's claim is that no summed foreground is
   worse than on the lavender at 0.28 / 0.36 except the faintest fill's luminance contrast with the
   page (1.37 to 1.32). Check the conclusion, not only the arithmetic: is there a pairing that IS
   worse which the table leaves out? Candidates: the reader's four highlight washes over or beside
   a quote; a comment's underline (`mark.cmt`); a citation's dashed rule (`mark.cite`); the pressed
   quote's ring (`mark.hit[data-quote][data-hit-open]`); the 1px page-coloured gap between abutting
   quotes; the search confidence outline at low `--hit-a`, not only the band; reader-pickable search
   colours `--cat-8` to `--cat-15` (`--cat-14` is a purple at hue 303); selection colour; a quote
   inside a link; a quote on `--card`, `--panel` or any other ground a `mark.hit[data-quote]` can
   be drawn on (hover cards, the Quotes band rows, the public page, /design).
2. **Every place the fill colour is drawn uses the right token**, and no place that should have
   followed was left on `--quote-rgb` (or moved when it should not have). Grep for `quote-rgb`,
   `quote-color`, `quote-prose`, and for any hard-coded `204 151 243` / `127 66 166`. The Quotes
   band, the quote hover card, ScoreBars, the `/design` swatches and the tests/appearance-palette
   lists are the places I would look. Is `--quote-prose-rgb` defined everywhere `annotations.css` is
   loaded (an undefined token makes the fill vanish silently)?
3. **The new and changed assertions can fail.** For each, say what edit would turn it red and try
   it if cheap. In particular `ruleAlpha` (does its regex really find `mark.term`'s and `mark.xref`'s
   base rules and not a later variant), the "used by the fill alone" count, and the control that the
   strip would fail in the prose colour.
4. **Light mode is unchanged**, including with no `data-theme` attribute and under the system
   setting.
5. **Every Greg quotation in the diff is his.** The only words of his that may appear in a
   blockquote or in quotation marks attributed to him are: the sentence quoted at the top of this
   prompt (or parts of it); "The quote highlighting color is not very visible against the black
   background in dark mode. Take a screenshot and see if you can slightly tweak it."; "use the same
   colour we use for their outline-border" (2026-09-10); and quotations already in the files before
   this diff. If you edit a doc, do not attribute any new sentence to Greg.
6. Anything else that is wrong: a comment or doc that now lies (anything still saying the strip and
   the fill are one colour without qualification, or stating 0.28 / 0.36 as current), a test
   elsewhere that hard-codes the old values.

**The box is overloaded and a box-wide lock is in force.** Run nothing heavy except, after any edit
you make, exactly this, through the lock:

```
flock /var/tmp/spideryarn-heavy.lock npx vitest run tests/quote-fill.test.ts tests/appearance-palette.test.ts tests/block-flash.test.ts tests/css-tokens.test.ts tests/doc-links.test.ts
```

If it prints `REFUSING TO START` that is memory pressure, not a failure: say so in your report and
do not retry more than twice or disable the guard. Do not run the full suite, a build, a browser or
`npm run typecheck`; I will run typecheck. Your own arithmetic script in plain `node` is fine.

Write findings as a list, most serious first, each marked P0 to P3 with file and line, and what you
did about it (fixed, or left for me and why). List every file you edited. Finish with a line
beginning exactly `VERDICT:` followed by one of `ship`, `ship after the fixes I made`, or
`do not ship`.
