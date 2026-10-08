# Code review findings: text roles in a mode band

Scope: commit `1406562e0`, reviewed against
[`261008k`](261008k-text-styles-for-the-recurring-lines-in-a-mode-band.md) and its
[`plan review`](261008k-plan-review-sol.md).

## Findings

### F1 — P1 — `src/web/styles/faq.css:53`

**Evidence:** FAQ renders one element with both `gloss-part-text` and `faq-quote`. The body rule and
quote rule have equal specificity, so the quote size wins only because `faq.css` currently loads
after `glossary.css`. The test pins that order, but moving an import can change the visible role even
though both declarations remain locally correct. This is the shared-selector case the plan said to
split or target narrowly.

**Fix:** target the actual shared element as `.gloss-part-text.faq-quote`, giving the role override
enough specificity to be independent of sheet order, and register that selector.

### F2 — P1 — `src/web/styles/debate.css:93`

**Evidence:** `.dbt-group-head` is registered as `--type-label`, but Debate also renders
`<summary class="dbt-group-head dbt-group-claim">`. Its later `.dbt-group-claim` rule sets
`font-size: 0.85rem`, so the registry says the broad selector is a label while a real element carrying
it is deliberately not. The exact-selector test cannot see the competing compound selector.

**Fix:** move the label size to `.dbt-group-head:not(.dbt-group-claim)`, register the narrowed
selector, and record `.dbt-group-claim` as a named literal exception with its existing semantic
reason.

### F3 — P1 — `src/web/styles/referee.css:768`

**Evidence:** `.mir-quote` normally holds a reader's quoted comment, but when that comment cannot be
found the same element also has `.mir-block-id` and displays only a block id. The broad registry row
therefore classifies a non-quotation as `--type-quote`. Separately, typography.md names
`.mir-criterion` as an exception, but `EXCEPTIONS` contains only Quiz, so the test's claim that it
holds every named exception is false.

**Fix:** put the quote token on `.mir-quote:not(.mir-block-id)`, keep `.mir-block-id` at the existing
literal with a reason, and register it and `.mir-criterion` as named exceptions.

### F4 — P1 — `tests/type-roles.test.ts:250`

**Evidence:** `sizesOf()` compares selector strings exactly. A later rule such as
`.gloss-term .gloss-name { font-size: 1rem }` wins on the rendered element but is invisible to the
registry check. F2 is a counterexample already present in the reviewed commit. The test does catch a
literal put back on an exact registry selector and an exact-selector override in another sheet, but
not the broader cascade claim its prose makes.

**Fix:** add representative DOM witnesses for registered lines and assert their computed size after
loading the complete `readerSheets()` cascade. Keep the exact-selector walk as the guard for rules
inside inactive media/support blocks; the witness check covers ordinary competing selectors,
specificity, inheritance and source order.

### F5 — P2 — `src/web/DesignPage.tsx:431`

**Evidence:** the item × UI sample is labelled as a Candidate name, but the candidate name itself is
in the model's face; only the fixed hedge around its optional affiliation is UI. Conversely,
Timeline's body-sized `.gloss-part-text` contains an author-voiced `.tl-phrase`, so body × author is
used but shown as an empty cell. The dash cells themselves are accessible: the visible dash is
`aria-hidden` and an `sr-only` "not used" label remains.

**Fix:** use a citation title for item × UI and add the real Timeline body × author sample.

### F6 — P2 — `docs/project/typography.md:110`

**Evidence:** the docs say every exception is held by the test, but the existing test omits the
documented Mirror criterion and the implementation leaves Debate's claim summary and Mirror's block
id implicit. That makes the short rule sound more exhaustive than it is.

**Fix:** name the three non-role literals briefly and keep the implementation comments and exception
registry as the detailed source.

## Wider observations (no fix needed)

- `readerSheets()` walks the import graph from `src/web/styles.css` in cascade order; it is not a
  hand-maintained subset, so it includes every hand-written sheet the band loads.
- `.srch-hit-btn` sets `0.9rem` on the parent, while `.srch-hit-quote` sets its own explicit
  `--type-item`; the child declaration draws and there is no conflict. No registered element carries
  a Tailwind font-size utility or inline `fontSize`.
- The CSSOM block-count guard is sound for the current sheets: it traverses nested grouping and
  keyframe rules and fails if jsdom drops a block. Its declared `@property` subtraction is confined
  to rules that cannot contain `font-size`.
