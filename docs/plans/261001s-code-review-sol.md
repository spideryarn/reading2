Implemented the review fixes. No commit was made.

### Findings fixed

- **P1 — [AddPage.tsx:963](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:963): edits could be lost during “Save and open”.**  
  After pressing Save, the textarea remained editable. Newer words were not in the in-flight request, but success navigated away and discarded them. The textarea is now disabled during the save, alongside both buttons.

- **P1 — [useAutosavedText.ts:150](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/useAutosavedText.ts:150), [PurposePrompt.tsx:94](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/PurposePrompt.tsx:94): Done could close before the final stored value was safe.**  
  If an older save was writing `A`, the reader returned the draft to its originally loaded value, then pressed Done, the hook considered the draft clean and declined to queue a correction. The dialog could close before `A` overwrote the server.  
  `commit()` now checks for an in-flight write before the unchanged-value shortcut, queues the correction, and exposes `inFlight`. Done waits until both the draft is clean/saved and no request remains.

  For `/profile` and Metadata, this changes only that race: returning to the loaded value while an older write is in flight now sends a corrective write. Ordinary saves are unchanged.

- **P2 — [add-page-purpose.test.tsx:518](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/tests/add-page-purpose.test.tsx:518): marking tests missed the exact exclusion boundaries.**  
  Tests now prove untouched Retry completion marks, touched Retry completion does not, and empty explicit “Open without it” / “Save and open” choices do not mark.

- **P2 — [feedback-dialog.test.tsx:1773](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/tests/feedback-dialog.test.tsx:1773): prefill tests could stay green if the host dropped the request.**  
  JobCard tested its callback and FeedbackDialog tested a direct prop, but nothing connected them. An integration test now opens through `FeedbackHost` and verifies the mounted dialog receives the body and Problem kind.

- **P2 — prompt lifecycle guard gaps.**  
  [purpose-prompt.test.tsx:305](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/tests/purpose-prompt.test.tsx:305) now proves “Not now” leaves the hook mounted to finish an in-flight save and its queued latest draft.  
  [public-network-trace.test.tsx:2538](/home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/tests/public-network-trace.test.tsx:2538) proves a signed-in visitor neither mounts the owner-only purpose reader nor consumes a matching mark.

No P0 findings.

### Checked without further changes

The Feedback prefill is applied once per request ID across StrictMode, rerenders, close/reopen, and later reports. Existing drafts and kinds survive appropriately, and the length cap is respected.

JobCard gates reader-supplied links through `isWebUrl`, uses `_blank` with `noopener noreferrer`, and offers Report only for failed jobs. The report body contains only identifiers, closed status/step/failure values, fixed copy, and timestamps—no URL, filename, title, or error prose.

The prompt retains its mark after failed reads, consumes it only after a definitive answer, remains owner-only, and uses the shared visual-viewport handling for the iOS keyboard.

### Left for the author/Greg

Whether reports may include source URLs, filenames, or error prose remains a product/privacy decision. They are deliberately omitted because adding them changes the documented Feedback consent boundary. The related trade-off remains: dismissing a job deletes the record, so a later report containing only its job ID may no longer be resolvable.

### Verification

- Core touched tests: **79 passed**
- All 15 direct `useAutosavedText` caller test files covering PurposePrompt, Metadata, and Profile: **241 passed**
- Feedback dialog: **79 passed**
- Public network trace: **74 passed**
- Original scoped stage run: **221 passed**
- Typecheck logic: all four TypeScript projects passed; all **2,625** source files were covered.
- Targeted lint exited successfully, with only the existing informational AddPage complexity notice.
- `git diff --check`: clean.

The literal `npm run typecheck` command could not start because this sandbox rejects the `tsx` CLI’s Unix IPC socket with `EPERM`. Running the same `scripts/typecheck.ts` through `node --import tsx` completed successfully.