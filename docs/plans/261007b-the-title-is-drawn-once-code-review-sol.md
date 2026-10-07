## Findings

- **C1 — P1 — fixed:** [`masthead-echo.ts:49`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/masthead-echo.ts:49) could classify a fresh article’s own `Author · Site · ~5 min read` paragraph as the legacy wrapper and hide it plus the preceding heading. The matcher now requires the old `debugPage` template’s exact stored line breaks and indentation. [`masthead-echo.test.ts:78`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/masthead-echo.test.ts:78) was red first: expected no hidden rows, received two.

- **C2 — P1 — fixed:** [`fold.ts:308`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:308) excluded every echo from `isFoldedAway`, even when a genuine fold also covered it. Navigation could therefore target the folded metadata row and jump to the page top. [`fold.test.ts:399`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/fold.test.ts:399) was red first: expected `true`, received `false`.

- **C3 — P1 — fixed:** [`keynav.ts:452`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/keynav.ts:452) pushed a useless history entry and started a scroll when an echo jump began at the exact page top. It now recognizes the masthead as the visible copy and returns without pushing, scrolling, or flashing. [`fold-keynav.test.ts:137`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/fold-keynav.test.ts:137) was red first: `beginJump` returned `true` instead of `false`. A control preserves real movement from part-way through the masthead.

- **C4 — P1 — fixed:** [`scroll.ts:846`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/scroll.ts:846) falsely defined `settled` as meaning the row arrived. An echo instead settles at the page top while its row remains hidden. The contract now says that explicitly.

- **C5 — P2 — fixed:** the echo-scroll test collected outcomes but never asserted them, so removing the callback survived. [`fold-keynav.test.ts:188`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/fold-keynav.test.ts:188) now waits for the final frame and checks both `settled` callbacks. The callback-removal mutation was red: expected `["settled"]`, received `[]`.

- **C6 — P3 — fixed:** `tests/extract-page-byline-is-the-chosen-one.test.ts` no longer described its subject. It is now [`extract-debug-page-omits-byline.test.ts:39`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/extract-debug-page-omits-byline.test.ts:39). This was naming-only, so no runtime red case applies.

- **C7 — P1 — fixed:** [`masthead-echo.test.ts:10`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/masthead-echo.test.ts:10) cited a nonexistent fixture path. The comment now names the real fixture. Documentation-only; no runtime red case applies.

- **C8 — P2 — reporting:** an authored paragraph can still be hidden if its stored HTML exactly imitates the legacy template, including both newlines and indentation; [`masthead-echo.ts:44`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/masthead-echo.ts:44) now admits this boundary. Eliminating it requires wider provenance: persist an extraction/template version or explicit synthetic block ids, backfill existing articles, then remove the heuristic.

## Review conclusions

- Stored fixtures confirm `Block.html` is the block’s own outer HTML, `tag` is the block element, and `text` is decoded text. Entities, digit/symbol titles, and an `h1` beneath an ancestor behave correctly. Inline markup and maths remain visible. Empty extracted titles fall back to the slug in metadata.
- Every `isFolded` caller was reviewed. Row-measuring/drawing callers should treat echoes as hidden. The three section-start callers correctly use `isFoldedAway`; C2 was the missing overlap case.
- Mid-article echo jumps still push useful history and settle at the top. They leave no arrival anchor; the reading-position writer records top as no `?at=`. Step chains invalidate against the hidden row.
- Spine, marginalia, gutter, selection, comments, Skim, and the visitor path either use the fold store or share `TableView`; no additional direct-block-zero regression was found.
- Stage 3 has no implementation fingerprint that re-extracts existing articles automatically. Rebuild and *Read this* run the default downstream stages, so blocks and Structure are rebuilt after the two ids disappear. The developer’s explicit extract-only command changes the stored page but deliberately carries blocks/tree forward; blocks cannot later run without Structure.
- The missing *Fold all* button when the wrapper heading was the only heading is correct: no visible foldable section remains.
- The postmortem accurately says the `architecture.md` sentence was proposed but not edited because that entry-point wording requires Greg’s approval.

Verification:

- All eight requested files plus the renamed extraction test: **9 files, 148 tests passed**.
- Typechecking passed for all four TypeScript projects via `node --import tsx scripts/typecheck.ts`. The normal `npm run typecheck` wrapper could not open its `tsx` IPC socket in the sandbox (`EPERM`).
- Focused lint passed apart from the pre-existing `keynav.ts` cognitive-complexity advisory.
- `git diff --check` passed. No commit made.

Files changed:

- [`docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md)
- [`src/web/fold.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts)
- [`src/web/keynav.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/keynav.ts)
- [`src/web/masthead-echo.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/masthead-echo.ts)
- [`src/web/scroll.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/scroll.ts)
- [`tests/fold-keynav.test.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/fold-keynav.test.ts)
- [`tests/fold.test.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/fold.test.ts)
- [`tests/masthead-echo.test.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/masthead-echo.test.ts)
- Renamed `tests/extract-page-byline-is-the-chosen-one.test.ts` to [`tests/extract-debug-page-omits-byline.test.ts`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/extract-debug-page-omits-byline.test.ts)

**Verdict: ready to push**