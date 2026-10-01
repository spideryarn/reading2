The core design is sound, but the plan needs several fixes before implementation. The reserve formula itself is algebraically correct under the right box-model assumptions; the main risks are integration with existing layout/state machinery, containment, and collision measurement. No P0 findings.

## Findings

- **F1 — P1 — The reserve arithmetic omits parts of the actual box contract.**  
  Evidence: the formula is in `docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md:131-145`; `.reader` currently reserves only spine, mode, and safe-area padding in `src/web/styles/shell.css:96-103`; its inline `minWidth` similarly omits a margin reserve in `src/web/reader/Reader.tsx:2315-2329`. The masthead is centred in the unreduced viewport box in `src/web/styles/shell.css:193-200`, while the table uses auto margins in `src/web/styles/narrow-window.css:1107-1134`.  
  The formula works if `margW` means the entire outward extent after the table. If CSS adds a gap `g`, it must instead use `margExtent = g + noteWidth` and:
  `margReserve = max(0, 2*margExtent + proseW - avail)`.  
  **Fix:** put `margReserve` into `Fit.minWidth`, `.reader`’s right padding, and the masthead’s available width. Define numerical/root-relative values for `MARG_MIN`, `MARG_IDEAL`, and the gap in the plan. Test actual table, prose, masthead, and note rectangles with spine on/off, safe-area insets, and 12/16/20px roots; assert no horizontal page overflow. The controls can remain full-bleed.

- **F2 — P1 — Switching into Annotations will not preserve reading position at widths where it reflows prose.**  
  Evidence: the current layout key is only ``windowWidth|modeW|spine`` in `src/web/reader/Reader.tsx:430-436`. Plain and Annotations both have `modeW === 0`, so changing `tableW` or `margReserve` leaves the key unchanged. `useReadingPosition` only re-anchors and restarts its immediate measurement when that key changes (`src/web/reader/useReadingPosition.ts:129-143,145-192`).  
  **Fix:** make the key describe all row-reflowing geometry, at least `windowWidth`, `tableW`, `margReserve`, `modeW`, and spine. Add a mode-switch test at a medium width where Annotations narrows the prose and assert that `?at=` remains the same section.

- **F3 — P1 — `MODE_CONTAINMENT: contained` would currently protect an empty slot, not the annotation surface.**  
  Evidence: the plan places notes through `TableView` while `modeBand()` returns `null` (`plan:147-170`). The existing boundary wraps only the result of `modeBand()` in `src/web/reader/Reader.tsx:2248-2275`; `MODE_CONTAINMENT` describes bands in `src/web/reader/ModeBoundary.tsx:55-90`. The witness test explicitly proves descendants of that boundary, `tests/a-broken-mode-leaves-the-article-readable.test.tsx:1366-1479`.  
  **Fix:** either render the head/notes through a portal-owning annotation surface beneath the existing boundary, or add a dedicated annotation boundary and a throwing witness that proves the prose survives. Do not mark it contained while the real surface is outside the boundary, and do not wrap the whole `TableView`, which would take the prose with it.

- **F4 — P1 — The collision pass is not yet specified as idempotent.**  
  Evidence: the plan says it reads each note’s “natural top,” then writes `translateY` (`plan:147-153`). A later `getBoundingClientRect().top` includes the existing transform; recomputing a full translation from that value can accumulate displacement on every observer callback.  
  **Fix:** measure natural tops from the untransformed row/`td`, or subtract/reset the previous transform before the read phase. Compute absolute translations, not incremental ones. Add a test that runs layout twice over unchanged DOM geometry and gets identical transforms.

- **F5 — P2 — Observing only the table can leave collision positions stale.**  
  Evidence: the plan observes the table while also noting that absolute notes cannot resize it (`plan:149-153`). A note can change height after font loading or tooltip-trigger markup changes without changing the table border box; row heights can also redistribute while total table height remains unchanged.  
  **Fix:** observe the anchor rows and note elements as well as the table, rerun when the note set changes, and trigger once after `document.fonts.ready`. Coalesce callbacks through one animation frame with all reads before writes. Transforms do not change observed sizes, so this remains loop-free.

- **F6 — P1 — The owner/visitor Ideas seam and stale behavior need to be explicit.**  
  Evidence: `useIdeasRead` is a GET-only hook (`src/web/useIdeas.ts:113-205`), but `OwnedReader` does not mount or pass it (`src/web/article/ArticlePage.tsx:421-503`). Visitors already receive Ideas as payload data (`src/public/dto.ts:1044-1063,1229-1231`; `src/web/article/ArticlePage.tsx:593-606`). The current Ideas UI explicitly says stale occurrence links may be wrong (`src/web/IdeasPanel.tsx:233-245`).  
  **Fix:** set `POLICY.annotations` to `available`, not to the Ideas artefact. Feed visitor notes only from `capability.artefacts.ideas`; never mount `useIdeasRead` on the visitor path. For owners, mount the read at the owner capability seam and draw occurrences only when ready and not stale. Add a public network test proving Annotations makes no authenticated Ideas request and no POST. Questions already cross in the public tree, and the arc already uses payload-only data for visitors.

- **F7 — P2 — The new margin map can defeat `memo(TableView)`.**  
  Evidence: both comparable props explicitly require caller memoisation in `src/web/TableView.tsx:647-672`, and the component avoids 87–88 renders per article scroll through shallow memoisation (`src/web/TableView.tsx:675-706`).  
  **Fix:** memoise the annotation map from tree/Ideas/blocks only. Keep the `at`-driven sticky head outside that map, so ordinary reading-position updates do not recreate every row’s React element.

- **F8 — P2 — Idea stamps need an explicit interaction element.**  
  Evidence: selection offsets are safe because `selection.ts` only accepts starts inside `td.text .prose` (`src/web/selection.ts:47-49`), but a click elsewhere in the cell selects the row unless it matches the exclusion list (`src/web/TableView.tsx:362-469,1449-1457`). Buttons are already excluded. The full Idea statement being available only through hover would also miss keyboard and reliable touch access; `src/web/Tooltip.tsx:108-125` explains why touch needs controlled behavior.  
  **Fix:** render each Idea stamp as a real button, with focus and click/tap-controlled tooltip behavior and Escape dismissal. This also prevents the stamp from triggering block selection. Keep it outside `.prose` and `user-select: none`.

- **F9 — P1 — The narrow fallback has no non-overlapping place to live, and Annotations loses `ModeHerald`.**  
  Evidence: below the breakpoint the plan reserves no margin but keeps a head “at the top right” (`plan:123-127`), so a fixed/sticky head there must cover masthead or prose. `ModeHerald` is suppressed whenever `bandOpen` is false in `src/web/reader/Reader.tsx:2792-2799`, despite its touch-device rationale in `src/web/ModeHerald.tsx:5-15`.  
  **Fix:** on narrow screens, remove the margin head and use a small in-flow, full-width empty state such as “Annotations need a wider window.” On wide screens, give the sticky head an opaque background/z-index so notes pass behind rather than through it. Either provide a margin-column herald slot or briefly include the mode name in that head after a press.

- **F10 — P2 — Ideas can make the margin much denser than the plan claims.**  
  Evidence: the plan stamps every occurrence (`plan:114-116`). An Ideas artefact contains 3–10 Ideas (`src/ideas.ts:43-46,102-121`), and the prompt requests 2–5 occurrences for each (`src/ideas.ts:653-680`): potentially about 50 stamps, before questions.  
  **Fix:** for v1, show only the first valid occurrence of each Idea, or at minimum cap to one Idea stamp per block. That preserves the experiment while making “not a second article” true and reducing collision work.

- **F11 — P2 — Last-view restoration works by default, but the plan misses its regression test.**  
  Evidence: `mode` is remembered in `src/web/last-view.ts:66-97`, and only four active modes are excluded in `src/web/last-view.ts:142-178`, so Annotations should restore correctly. The “keeps every other mode” test is a hand-written subset in `tests/last-view.test.ts:89-96`.  
  **Fix:** add `annotations` to that inert-mode test and assert restoring it makes no POST.

- **F12 — P3 — “Depth-1 section” is the wrong hierarchy term.**  
  Evidence: the plan uses that wording at `plan:111-113`; the hierarchy prompt asks for questions on the root and depth-1 nodes (`src/hierarchy.ts:174-177`), which this project otherwise calls parts.  
  **Fix:** say “root and each depth-1 part,” so nobody looks for nonexistent depth-2 section questions.

## What checks out

- `left: 100%` on `td.text` is viable: the cell is positioned (`src/web/styles/prose.css:75-93`), and neither the table body nor cell clips overflow. `table-layout: fixed` controls column sizing; it does not clip absolutely positioned descendants. Only the header cells have `overflow: hidden` (`src/web/styles/table.css:65-87`).
- The generated notes remain outside `.prose`, so they do not alter saved selection offsets. The gutter and reading-time hairline are on the left side of the same cell, so there is no direct geometric collision with a right margin.
- `bandOpen = false` gives the correct `proseOnScreen` behavior. The stray `band-covers` class is harmless because the relevant CSS rules also require a `.mode-band`.
- Visitor questions, an existing arc, and existing Ideas are all available without a visitor POST. An absent visitor arc simply remains absent.
- Deferring relation words is the right call. It is new paid/dense content, whereas root/part questions, the existing arc, and a capped set of Ideas are enough to test whether the surface works.
- Cutting automatic ask-for-help is also right: it would spend and write reader data without an explicit request.

Review was pinned to commit `c2a06ff5`; I made no edits.

VERDICT: build with fixes