Changed:

- Strengthened [tests/quote-fill.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/tests/quote-fill.test.ts:65): the tier-boundary test now verifies the expected `0.01` fade step instead of merely accepting any non-decrease.
- Corrected the old quote-outline/search-wash descriptions in [annotations.css](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/src/web/styles/annotations.css:354), `prose.css`, `dialogs.css`, `shell.css`, both token files, `colourscales.css`, and comments in `types.ts`, `annotate.ts`, `search-hits.ts`, `QuotesPanel.tsx`, `DesignPage.tsx`, `ProseHoverCard.tsx`, `Spine.tsx`, `TableView.tsx`, `last-view.ts`, `Reader.tsx`, and `useQuoteMarks.ts`.
- Updated matching descriptions in `annotate`, `citation-marks`, `hit-colours`, `prioritised-defaults`, `quote-marks`, `quotes-step`, `sanitize`, mode-marking, and `xref-prose` tests.
- Corrected the live contract in [quotes.md](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/docs/project/quotes.md:513), [search.md](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/docs/project/search.md:749), `design-css-overview.md`, `touch.md`, `url-state.md`, and the stage plan. This includes documenting the deliberately shared pressed state for a quote/search overlap.
- No runtime TypeScript or sanitiser behavior changed. `src/sanitize-policy.ts` and `src/sanitize.ts` were untouched.

1. **P2 — FIXED:** Several current comments and docs still described quotes as strokes or search as a wash, and the pressed-state comment incorrectly implied quote and search had separate open attributes.

   The resulting cascade is now documented accurately:

   | Mark state | Background | Edges |
   |---|---|---|
   | Quote tier 1 / 2 | Purple at `--quote-a × 0.20 / 0.32` | No outline; page-coloured start separator |
   | Pressed quote | Same purple fill | Full inset `--toward-ink` ring |
   | Search, no hues | Transparent | Confidence-alpha top/caps in `--hit-rgb`; fixed search-colour bottom band |
   | Search, with hues | Transparent | Confidence-alpha top/caps in `--h0`; hue band as bottom edge |
   | Pressed search | Slate `0.25` fill | Top/caps become `--toward-ink`; coloured bottom band remains |
   | Quote + search | Purple quote fill | Search top/caps and coloured bottom band |
   | Quote + search, either one pressed | Purple fill, no slate | Quote’s full ink ring wins; search band remains |
   | Reader-coloured highlight over any | Reader’s `--hl` background wins | Search/ring edges and band remain; quote’s start separator remains |
   | Passage flash | Flash wash temporarily replaces the fill | All `--mk-*` edges and hue bands remain; citation flash’s stronger wash wins on citations |
   | Bare quick hit | Transparent | No mark edges; when pressed, only the paragraph cell is outlined |
   | Citation, glossary term, cross-reference | Their rest-state background is transparent; hover/open wash appears inside a search outline, while the later quote fill wins over it | Their underline/decoration channel coexists with the hit edges |

   The single composed shadow is at [annotations.css:354](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/src/web/styles/annotations.css:354), search-local defaults and hue guarding at [annotations.css:411](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/src/web/styles/annotations.css:411), and explicit mixed pressed precedence at [annotations.css:760](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/src/web/styles/annotations.css:760).

   No custom-property leak remains: `--hit-a` and `--hit-stroke-rgb` are reset on every search mark; inherited cell `--h0` is read only under `[data-hues]`; every quote sets `--quote-fill`; `--quote-a` has a fallback and is normally written inline; unset `--mk-*` edges resolve through `--mk-none`. There are no ancestor writers for `--mk-*`.

   Plan-review findings 1, 2, 5, 6’s inset requirement, and 7 are present after these fixes. The late `mark.cite { display:inline; margin:0 }` and `mark.chat { color:inherit }` fixes are also present.

   Finding 3 correctly required no sanitiser change: version 8 uses `ALLOW_DATA_ATTR: false` and only adds [ARTICLE_DATA_ATTRS](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/src/sanitize-policy.ts:27), which excludes both new attributes. [tests/sanitize.test.ts:320](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/tests/sanitize.test.ts:320) would fail if either became allowed.

   I would keep finding 8’s coloured outline. The light, dark, overlap, and WebKit screenshots show the search colour clearly distinguishing the outline without obscuring the purple fill; a neutral outline would discard useful search identity without solving a visible problem.

2. **P2 — FIXED:** The test named “continuous across the weight’s step” only asserted non-decrease, so a large discontinuity would pass. It now measures the ordinary `0.01` fade step at `0.79 → 0.80` at [quote-fill.test.ts:65](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/tests/quote-fill.test.ts:65).

   The remaining assertions are capable of failing and match their names. The calculations correctly convert achromatic OKLCH to sRGB, composite CSS alpha in encoded sRGB, linearise for WCAG luminance/contrast, interpolate the link token in OKLab, and compare circular hue distance. The deliberate solid-fill negative control proves the contrast calculation can reject a bad strength.

3. **P2 — REPORTED:** An open chat mark remains a wider cross-mark precedence problem. [dialogs.css:576](/home/greg/code/spideryarn2/.claude/worktrees/fbxrgste-quotes-filled-search-outlined/src/web/styles/dialogs.css:576) uses the `background` shorthand and is imported after annotations. On a merged open-chat/quote mark it replaces the purple fill; on a saved-search mark it also resets the hue-band image. Choosing whether the chat-open wash or the quote/search identity should win is outside this stage’s specified combinations and needs a separate product decision.

Focused checks passed: `quote-fill` 27, `annotate` 78, `sanitize` 58, `doc-links` 16, and `git diff --check`.

VERDICT: land