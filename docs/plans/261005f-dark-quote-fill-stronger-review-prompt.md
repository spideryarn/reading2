# Plan review: the dark quote fill, stronger and more saturated

You are reviewing a plan before it is built. Read-only: do not edit anything. Work in this checkout
(a git worktree of the repo).

Read, in this order:

1. `docs/plans/261005f-dark-quote-fill-stronger.md` — the plan under review. (It was
   `…-stronger-and-more-saturated.md` when this prompt ran, and proposed a new colour as well; the
   review is why it no longer does.)
2. `docs/project/quotes.md` § "A highlighter pen, which is how a quote says how much it matters".
3. `src/web/styles/annotations.css` § quote fills (search for `quote fills`), and the pressed-quote
   rules further down (`mark.hit[data-quote][data-hit-open]`).
4. `styles/tokens.css` around `--quote-rgb` in both the dark block and the
   `:root[data-theme="light"]` block, and `src/web/styles/tokens.css` for `--ink-soft`,
   `--highlight-ink` and `--hl-*`.
5. `tests/quote-fill.test.ts`, the test that will hold the new values, and
   `tests/appearance-palette.test.ts`, which polices tokens set in one theme and not the other.
6. `src/web/styles/spine.css` § `.spine-quote`, the other user of the colour.

The request, verbatim, from the product owner: "The quote highlighting color is not very visible
against the black background in dark mode. Take a screenshot and see if you can slightly tweak it."
Light mode must not change.

What I want from you:

- **Check the arithmetic independently.** Do not trust the plan's table. Write your own small script
  (in a temp directory, not the repo) that composites `187 85 249` at the proposed alphas over the
  dark page and computes the WCAG contrasts the plan lists: soft ink, ink and link on the strongest
  fill; faintest fill vs page; heavy vs light at the tier boundary (priority 0.80, where
  `quoteAlpha` is 0.88); the spine strip at alpha 0.70 vs page. Also confirm `187 85 249` is at
  OKLCH hue about 310 and at least 39 degrees from the reader's highlight hues 270 and 350. Say
  where your numbers differ from the plan's.
- **Find every other place `--quote-rgb`, `--quote-color` or `--quote-fill` is used or assumed**
  (CSS, TSX, tests, the `/design` page, the Quotes band, hover cards, the fleet dashboard if it
  shares `styles/tokens.css`) and say whether any of them is hurt by a darker, more saturated dark
  colour: for example text drawn IN `--quote-color` on the dark page, or a place where the pale
  lavender was chosen for legibility as a foreground.
- **Is there a foreground the test does not cover that now falls below a sensible floor on the
  strongest dark fill?** Glossary terms, citation marks, comment underlines, `<code>`, a search
  outline over a quote, the reader's own highlight over a quote, the pressed ring, selection colour.
- **Is putting the two strengths in `styles/tokens.css` as `--quote-fill-light` /
  `--quote-fill-heavy` the right home**, given `tests/appearance-palette.test.ts` and how other
  per-theme numbers are held in this repo? Is there an existing convention I should copy instead?
- **Is the simpler option the plan passed over (strengths only, colour kept) actually enough?** Argue
  it if you think so.
- Anything that would make light mode change by accident.

Write your findings as a list, most serious first, each marked P0/P1/P2/P3 with the file and line it
is about and what you would do instead. Finish with a line that begins exactly `VERDICT:` followed by
one of `build as planned`, `build with the changes above`, or `do not build`, so that an empty review
cannot be mistaken for a clean one.
