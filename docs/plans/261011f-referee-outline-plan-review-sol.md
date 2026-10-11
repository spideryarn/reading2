The core shape is good: manual sorting, a nullable comment column, and a separate PATCH are minimal and preserve the reviewer’s authorship. I would not build the plan unchanged, chiefly because of the public-link boundary and report-scaffold framing.

## Findings

- **F1 — P0 — Plan § “Shared links do not carry it”; `src/store/public-reader.ts` / `PUBLIC_COMMENTS_WHERE`.** A criterionless note marked Major or Minor is now explicitly peer-review material, yet its body remains visible through a public shared link. Omitting `severity` from the projection does not protect the note itself. This conflicts with the existing rule that referee notes do not cross public links.  
  **Fix:** add `severity IS NULL` to `PUBLIC_COMMENTS_WHERE`; test that Major and Minor notes are withheld and that clearing severity makes an otherwise-public reading note public again. Update the shared-link section of `comments.md` and the security documentation.

- **F2 — P1 — Plan §§ “Why this is not the scaffold Greg vetoed” and “What the reviewer sees”.** The manual Major/Minor sorting is safely on the approved side of the line, but the surrounding product still calls itself a report scaffold: “bones of your report”, “Copy outline”, and a `Summary / [Yours to write.] / Major / Minor` template. That is almost the exact shape of the earlier veto. The placeholder is also application-authored text in an artifact claimed to contain only the reviewer’s words.  
  **Fix:** frame this as organizing and exporting notes: chip **Sort notes** or **Review notes**, button **Copy notes**, and copied sections Major, Minor, and Unsorted notes. Remove `Summary` and `[Yours to write.]` from the clipboard. The dedicated `RefereeNotesPanel` name would also avoid confusion with the existing `OutlinePanel`.

- **F3 — P1 — Plan Stage 1; `src/web/useComments.ts` write queue.** A queued sort modeled on `recolour` is non-optimistic. If the reviewer presses Major and immediately presses Copy, `comments` still contains the old severity and the clipboard silently gets the previous grouping. The per-comment queue correctly orders Major→Minor and interaction with body/mark/colour writes, but it does not protect a read performed while writes are pending.  
  **Fix:** expose pending severity writes or track them in the panel, disable Copy until all settle, and show the pending state on the affected row. Test with a delayed PATCH, immediate Copy, and rapid Major→Minor presses.

- **F4 — P1 — Plan § “No new store, no export work beyond one line”.** The import/export account is factually wrong. The reader-facing export in `src/store/export-bundle.ts` serializes whole rows, so the new columns arrive automatically. `src/store/export.ts` is the legacy rollback projection. There is no `db:import` or `src/store/import.ts`; both were deleted.  
  **Fix:** rewrite this decision to distinguish the automatic user export from the optional legacy rollback field list, and remove the import claim. Do not invent a replacement importer for this work.

- **F5 — P1 — Plan Stage 2, “every `Record` the compiler then names”.** Compilation will not identify all the literal five-sub-mode assumptions. The plan should explicitly include:
  - `tests/referee-mode.test.ts`
  - `tests/referee-notices.test.tsx`
  - `tests/referee-tooltips.test.tsx`
  - `tests/pressing-a-chip-arms-it.test.tsx`
  - `tests/command-bar-sub-modes.test.tsx`
  - `tests/referee-copy-is-about-the-model.test.ts`
  - both `src/web/help/pages/modes/referee.md` and `src/web/help/pages/guides/for-reviewers.md`
  - regeneration of `src/help-corpus.generated.json`
  - `docs/project/comments.md` and the operation documentation in `src/store/contracts.ts`, which currently describe five operations.

  The command bar itself is data-driven, so it needs tests rather than bespoke production wiring. Mirror uses an explicit projection and needs no severity change. MCP exposes neither comment mutation nor Referee sub-mode selection, so no MCP change is required.

- **F6 — P1 — Plan § “Copy outline”; `src/web/useCopy.ts`.** The plan does not require the shared copy mechanism. A direct clipboard write would reintroduce silent failure in insecure contexts and missing/out-of-order feedback.  
  **Fix:** require `useCopy`, visible/live copied-or-failed feedback, and component tests for success, unavailable clipboard, and rejection.

- **F7 — P2 — Plan’s `outlineText` tests.** The proposed negative checks are directionally right but incomplete. Model-owned comment fields include `answer`, `citations`, `searches`, `model`, and `error`; Mirror output is separate and therefore cannot leak unless somebody explicitly adds it.  
  **Fix:** type the formatter against a narrow `Pick<Comment, …>` containing only identity/order, anchor, `body`, and `severity`; assert exact output from a deliberately fully populated comment with sentinel values in every model-owned field. This makes leakage difficult both now and after future `Comment` growth.

- **F8 — P2 — Plan § “Each row”; `src/web/comment-nav.ts` and `src/web/comment-jump.ts`.** Orphaned comments are deliberately retained and sorted last, but the plan gives every row a jump calling `onJump(blockId)`. On a narrow screen, `bandJump` can step the band aside even though the block no longer exists.  
  **Fix:** omit or disable the jump when the block is absent, retain the “no longer in this version” passage text, and test that an orphan causes neither navigation nor a band handoff.

- **F9 — P2 — Plan Stage 1 tests; `tests/event-times.test.ts`.** The proposed tests do not pin `severity_at` or prove that `updated_at` remains unchanged.  
  **Fix:** test initial null, database-clock stamping on Major/Minor/clear, and unchanged `updated_at`. Repeating the same request is idempotent from the client’s visible `Comment` perspective; if `severity_at` follows `colour_at`, document that it records each accepted action rather than only value transitions.

- **F10 — P3 — Plan UI sketch.** “Highlights with no words” is inaccurate: excluded rows may be bookmarks or bodyless referee placements.  
  **Fix:** say “marks without a note are left out.”

On the author’s doubts: include unsorted notes so user input is never silently omitted, but call them **Unsorted notes**; do not add sorting to comment boxes in v1; place the new chip after Mirror, but name it **Sort notes** rather than Outline; and withhold any severity-marked note from public links.

**VERDICT: BUILD WITH CHANGES**