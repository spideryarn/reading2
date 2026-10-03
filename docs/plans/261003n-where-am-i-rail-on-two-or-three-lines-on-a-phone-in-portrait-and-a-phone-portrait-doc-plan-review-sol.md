F1 — P1, established. `src/web/reader/Reader.tsx` § `showCrumbs`, `showBar`, `layoutKey`; `src/web/reader/useReadingPosition.ts`; `src/web/useColumnContext.ts`; `src/web/OnScreenLinksStyle.tsx`.

The proposed height follows `showCrumbs`, but `layoutKey` follows only `showBar`. For a signed-in non-owner, the read-only chip keeps `showBar` true while crumbs appear or disappear, so the bar changes between 44px and the new height without changing the key. The existing `layoutKey` comment explicitly says bar geometry must trigger remeasurement because moving the table does not resize it. This can leave reading position, Structure’s current section, or on-screen-link state measured against the old geometry.

Smallest plan change: Stage 2 is not CSS-only. Add `showCrumbs`—or an explicit effective bar-height state—to `layoutKey`, plus a regression case for a signed-in public reader whose chip keeps the bar mounted while crumbs toggle.

F2 — P1, reasoned. `src/web/HeadingsCrumbs.tsx`; `src/web/styles/crumbs.css`; `docs/project/touch.md` § “How big a thing has to be to press it”.

The plan acknowledges approximately 20px targets, then raises them only to 24px. Two vertically adjacent 24px buttons are still substantially smaller than a thumb, and pressing the wrong one immediately jumps elsewhere in the article. “The whole bar is pressable” does not help distinguish which stacked target receives the press.

Smallest plan change: make this part of the Stage 1 decision. Either budget for independently pressable coarse-pointer rows, use a reveal-before-jump interaction on touch, or explicitly accept and document the smaller targets after testing them on a real phone. Do not treat 24px padding as having resolved it.

F3 — P1, reasoned. `src/web/reader/Reader.tsx` § controls rendering; `src/web/PublicChrome.tsx` § `ViewOnlyChip`; `src/web/styles/narrow-window.css` § `.controls > *`.

The screenshot experiment does not name the signed-in non-owner state, where the fixed-width “View only” chip is a sibling of the breadcrumb and consumes scarce horizontal room. The session-unconfirmed variant is longer still. A shape chosen using an owner’s full-width breadcrumb may remain severely truncated for this reachable reader.

Smallest plan change: add the public signed-in state—preferably its longest chip variant—to the 320px and 390px screenshots and browser checks.

F4 — P2, reasoned. `src/web/styles/shell.css`; `src/web/styles/table.css`; `src/web/styles/spine.css`; `src/web/styles/mode-band.css`; `src/web/styles/marginalia.css`; `src/web/scroll.ts`; `tests/mobile-chrome.test.ts`.

The implementation machinery appears height-generic, but the proposed static CSS test does not prove the plan’s central promise about pinned chrome and jumps. The browser check is described only as checking truncation at several widths.

Smallest plan change: add explicit rendered assertions that a tall breadcrumb bar moves the table head, spine, applicable band/marginalia head, and overflow fade to the same bottom edge; then press a crumb and assert its destination clears the bar. Include a forced non-zero safe-top value. A taller-bar case in `tests/mobile-chrome.test.ts` would also prove the scroll functions are measuring rather than assuming 44px.

F5 — P2, reasoned. Candidate Stage 3; `docs/reusable/documentation-policy.md`; `docs/reusable/signposting-and-single-source-of-truth.md`.

`phone-portrait.md` is the right home: portrait-phone behavior crosses width, pointer, safe-area, layout, and WebKit concerns, so placing it inside `touch.md` would make touch own facts that are not touch facts. `reading-view-overview.md` is a suitable single parent, with `touch.md` and `narrow-windows.md` linking across.

The risky part is promising an exhaustive table of every media query and pointer rule. That becomes a manual inventory of executable facts. Keep the new doc as a short intent-and-signpost map: canonical owning sections and stable symbols, why to open each, no copied breakpoint values or exhaustive counts, and an explicit backlink to `reading-view-overview.md`.

F6 — P3, established. `src/web/styles/narrow-window.css`; `src/web/styles/shell.css`; `src/web/reader/Reader.tsx`; `src/web/scroll.ts`.

“CSS only, in `crumbs.css`” leaves current comments that describe the controls bar as invariably 44px false. The dated 44px reproductions can remain, but present-tense claims need to say “default/chip-only” or acknowledge the taller crumb state.

Smallest plan change: add a scoped comment sweep to Stage 2.

The suspected token behavior is otherwise sound. The proposed selector has specificity `(0,3,0)`, beating the base `:root` declaration, and both `--bar-bottom` and the hidden-state `--bar-hide` re-resolve through the overridden `--bar-h`. Runtime jump offsets measure the bar; I found no relevant 44px runtime assumption. Crossing 731px is covered by `windowWidth` in `layoutKey`; F1 concerns height changes without a width or `showBar` change. A fixed height per width is also the right default because it avoids section-boundary jolts.

VERDICT: refuse (F1)