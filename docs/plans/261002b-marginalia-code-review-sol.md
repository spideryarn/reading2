No P0 findings.

1. **P1 — Citation density remains unresolved** — [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md:124), [notes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/src/web/marginalia/notes.ts:261). The plan claims a real-paper measurement happened but records neither its result nor a density policy. Forty works first cited in forty blocks still produce forty lines. I did not choose between keeping, capping, or omitting citations; that is the one wider product decision for you.

2. **P2 — Open disclosures omitted promised content** — [MarginaliaColumn.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/src/web/marginalia/MarginaliaColumn.tsx:196), [notes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/src/web/marginalia/notes.ts:243). Fixed FAQ’s surviving `+N more passages`, Debate’s source quote, and comments’ AI-answer preview. Lone bookmarks remain non-interactive lines.

3. **P2 — Debate rows used a non-unique URL key** — [MarginaliaColumn.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/src/web/marginalia/MarginaliaColumn.tsx:236). Two stored rows may share a URL. Changed the React key to the row’s stable `id` and added a duplicate-URL regression test.

4. **P2 — The ellipsis clipped the hanging chevron** — [marginalia.css](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/src/web/styles/marginalia.css:111). Moved overflow and ellipsis onto an inner label, leaving the button overflow visible.

5. **P2 — Important interaction and hook guarantees lacked end-to-end coverage** — [artefact-read-hooks.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/tests/artefact-read-hooks.test.tsx:153), [artefact-read-race.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/tests/artefact-read-race.test.tsx:339), [block-selection-by-tap.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/tests/block-selection-by-tap.test.tsx:267). Added coverage proving:

   - The actual owner feed makes only Ideas/FAQ/Debate GETs, with no job poll or POST.
   - Full FAQ and Debate hooks refresh after job completion without stale-read overwrite.
   - FAQ `retryRead` remains GET-only.
   - Disclosure and outbound-link taps neither select the TableView row nor invoke the `?at=` jump path.
   - Opening a line triggers collision relayout through the observed outer note.

6. **P3 — Docs still described comments as future/non-column content** — [marginalia.md](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/docs/project/marginalia.md:25), [interface-vision.md](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/docs/project/interface-vision.md:88). Updated the open content, visitor/owner distinction, citation visibility, and remaining voice-design question. `mode.md` was already accurate.

7. **P3 — New placement function exceeded the lint complexity threshold** — [notes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb82-marginalia-other-modes/src/web/marginalia/notes.ts:81). Extracted the final ordering pass; focused lint is now clean.

Verified without changes: placement uses current block position, `findQuote(block.text, quote, near)`, rejects empty quotes, uses `citedAt`, and excludes `criterionId`; visitors never receive margin citations, while owners receive them only when ready and fresh. Reader memo dependencies and `onFeed` are stable and loop-free. The fixed `.marg-head` contains its pseudo-elements, uses dark-aware tokens, and has no conflicting narrow-window sizing override.

Conclusion: **“nothing generates” holds.** Marginalia mounts only GET-only read halves. The full hooks retain their previous job fields, `automatic` behavior, FAQ `retryRead`, and post-job refresh.

Validation:

- Requested suite: 43 tests passed.
- Expanded focused suite: 97 tests passed.
- Doc links: 16 tests passed.
- Focused Biome lint: clean.
- All TypeScript projects passed; all 2,648 source files are covered.
- `npm run typecheck` itself was blocked by the sandbox denying `tsx`’s IPC socket, so I ran its underlying `scripts/typecheck.ts` directly.
- Full `npm test` could not initialize because Docker/Postgres was inaccessible from the sandbox; no full-suite tests ran.

Files edited:

- `docs/project/interface-vision.md`
- `docs/project/marginalia.md`
- `src/web/marginalia/MarginaliaColumn.tsx`
- `src/web/marginalia/notes.ts`
- `src/web/styles/marginalia.css`
- `tests/artefact-read-hooks.test.tsx`
- `tests/artefact-read-race.test.tsx`
- `tests/block-selection-by-tap.test.tsx`
- `tests/marginalia-notes.test.ts`
- `tests/marginalia-shut-notes.test.tsx`