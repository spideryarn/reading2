# Report — writer W5

## What changed, file by file

- `docs/project/new-mode.md` — new § Where else to look (the waiting state in `web-client.md`; what a visitor sees, decided by `POLICY` in `src/web/visitor.ts` and `REVISION_READ_POLICY` in `src/store/pg.ts`, with the 260929c plan and `security-map.md`; the add page starting modes after an import, via `src/web/auto-modes.ts` and `ingest-queue.md` § The add page; where browser checks are described). New § Not a mode? (a step with no band: `STEPS`, `DEFAULT_INGEST_STEPS`, ingest-queue § `STEP_ORDER` is not the default list; a per-reader setting: experimental-features § Where it lives; a URL param or a per-browser `localStorage` value instead). New § What Greg has asked of modes, across the board, with two of Greg's quotes and their dates (items marked in the prose, 2026-09-12 and 2026-08-26; a prioritised order with a threshold, 2026-09-29), pointing to `threshold.ts`, `ThresholdSlider` and the glossary/faq/citations sections. Fixed drift: `band()` → `modeBand()` in the measured table; the modeBand row no longer names `hierarchy`, and it describes `band()` as the wrapper; the `liftStrandedText` step in § Retiring now points to the `lift…` rewrites in `settleAddress`; removed the uncited mode counts ("fifteenth", "the current sixteen", "nine do", "the fourteen here"). Dated counts kept as dated history.
- `docs/project/url-state.md` — table rows for `runs`, `debatethread`, `event`, `crits` and `refscale`, each citing its parser in `params.ts`. Fixed stale lines: `?text=` "still honoured" (now: ignored since 2026-09-29), `?mode=hierarchy` "now appears in copied URLs" (now past tense), `columnLabel` (deleted; now `sectionDepth` in `position.ts`), "thirty-sixth parameter" (now "the next"). Put Greg's back-to quote (2026-09-12, 260916a) back in § The way back lives until you leave the article, along with the fact that `jumpTo` (`useReadingPosition.ts`) is the shared machinery. The opening localStorage sentence is unchanged; it is a proposal below.
- `docs/project/keyboard.md` — the H1 no longer claims ← / → choose the stride; added a history note to § The aim is visible (no `data-aim` remains, and `tests/aimed-column.test.ts` no longer exists).
- `docs/project/tooltips.md` — the four-surfaces trap, in § `ControlTip`, citing new-mode.md § The card on the button. The count is the 260907b plan's ("four of the fourteen"), not the memory note's.
- `docs/project/narrow-windows.md` — new § A row that pushes a phone page sideways: the scrollWidth check applies to band rows at 390px, finding the culprit by injection, the `nowrap`-with-no-whitespace class, and the real-Chrome test pattern (`tests/masthead-facts-wrap-in-chrome.test.tsx` after `tests/mark-sign-in-chrome.test.ts`) with its control for the fallback font. Source: 261001e.
- `docs/project/search.md` — a "when a search returns nothing" list near the top, pointing to the sections that say what can empty one: which of the three searches, the prioritised bar and a leftover `?conf=`, dropped hits counted in the log line, the fetch overwriting the box, and gistable-only on the shelf.
- `docs/project/quotes.md` — a pointer near the top to § What is still open. Its "No copy button" item now names `CopyButton` in `src/web/Tweets.tsx` as the one to lift.
- `docs/project/library.md` — a "Where to look" list near the top: dates and times in `relative-time.ts` (`timeAgo`, `relativeAgo`, `exactly`) with `useNow`; the code table; cards; search. Also a parenthetical saying the JSON-on-disk paragraph is history, with its dates.
- `docs/project/experimental-features.md` — § Where it lives now says it is the recipe for the next per-reader setting, with each layer by symbol (`readerProfiles`, `ReaderStore`, `pg-reader.ts`, `/api/reader`, the client store), and the per-browser alternative (`shelf-hidden-columns.ts`).
- `docs/project/reader-profile.md` — one line in § Where the pieces are, pointing to that recipe.
- `docs/project/public-shelf.md` — near the top, says it is not the visitor's read path, and points to security-map § The unauthenticated namespace, new-mode.md and public-readable-sharing.md.
- `docs/project/ideas.md` — says a visitor sees a stored list, and points to new-mode.md § Where else to look for where that is decided.
- `docs/project/glossary.md` — one line pointing to new-mode.md and web-client § The waiting state, for what every band shares.
- `docs/project/faq.md` — § Who sees it says why the add page's auto-modes box does not make an FAQ (FAQ is behind the switch, and `auto-modes.ts` derives its list from the switch).
- `evals/README.md` — new § Quiz listing `quiz.ts`, `quiz-build-up.ts` and `quiz-reading-goal.ts` (with its judge brief and the 261001c bars and runs). Added a line naming the eval files and directories the README does not yet describe.

## Proposals (rule wording — need approval)

1. **`docs/project/url-state.md`, opening paragraph.**
   - **Before:** "Nothing the reader can change lives in `useState`, and nothing lives in `localStorage` — with one exception since 2026-09-05, which is about *which address you arrive at* rather than about where state lives while you are here: [§ Reopening an article where you left it](../../project/url-state.md#reopening-an-article-where-you-left-it)."
   - **After:** "Nothing about *how you are looking at an article* lives in `useState` or `localStorage`: if a link should carry it, it is in the URL. `localStorage` holds what belongs to this browser rather than to the view — the address you last left an article at ([§ Reopening an article where you left it](../../project/url-state.md#reopening-an-article-where-you-left-it)), and per-browser preferences and dismissals: the referee card (`src/web/referee-card.ts`), hidden shelf columns (`shelf-hidden-columns.ts`), the add page's tick box (`auto-modes.ts`), the install and small-screen hints (`install-hint.ts`, `small-screen-hint.ts`), the chosen microphone and its placement (`mic-devices.ts`, `live/mic-placement.ts`), the offline cache's partition (`lib/offline-store.ts`), the `spya-perf` flag (`perf.ts`) and the auth SDK's session (`lib/supabase.ts`). Each wraps its access, because a private window throws."
   - **Reason:** the rule as written is false in at least eight places. `docs/plans/260902f-make-referee-mode-understandable.md` sent this edit to Greg, and it never came back (trawl C Q1 item 1).
2. **`docs/project/new-mode.md` § What Greg has asked of modes, across the board, second sentence** (new): "Read the mode doc named beside each before choosing a shape, and reuse its machinery rather than writing a second." This is borderline. It restates CLAUDE.md's "Reuse the machinery that's already here", applied to these two conventions. If it counts as a new instruction, cut it to "Each names the mode doc that holds its machinery."
3. **`docs/project/new-mode.md` residue list** (new, optional): turn the two conventions into a checklist bullet: "**Mark its items in the prose, and order a rated list by priority with a threshold**, unless there is a reason not to." This is the "must" phrasing. I have not made it; the section quotes Greg instead.

## Found, left for someone else

- **Code comments (not mine, no code changes allowed):**
  - `src/web/SourceScanNotice.tsx` (its comment near the top) still says "localStorage is banned".
  - The `ReaderStore` comments and the `src/store/pg-reader.ts` header still name the deleted filesystem store (P08).
  - The `src/web/auto-run-targets.ts` header says "Eleven" (P07).
  - `src/web/params.ts` § `refScaleParam` says "There is no control for it yet"; check whether that is still true.
- **Docs that are not mine:**
  - `docs/project/ingest-queue.md` § The add page lists the auto-started modes by name ("Tweets, Glossary, Quotes, Ideas, then Trajectory"). That copy will drift; it should cite `auto-modes.ts` § `autoModeSteps`.
  - `docs/project/browser-testing.md` should point to the real-Chrome layout test pattern, which `narrow-windows.md` now names.
  - `docs/project/icons.md` should point to `CopyButton` (cross-cutting miss 5).
- **Memory:** `tooltip-copy-is-read-on-four-surfaces.md` says "eleven of the twelve". The 260907b plan says four of fourteen opened that way. The note can now be cut to a pointer to `tooltips.md` § `ControlTip`.
- **`keyboard.md`:** the body is still mostly stride-era history under its banner. A cut is worth doing, but it is bigger than a signpost.
- **`evals/README.md`:** a dozen evals have no section; I listed them by name only.
- **260930b:** trawl C's "grep for 'not designed' / 'nobody' comments" lesson could not be found in any 260930b file, so it is not in `new-mode.md`.

## doc-links

`npx vitest run tests/doc-links.test.ts`: 1 file, 16 tests, all passed (run after all link-bearing edits).
