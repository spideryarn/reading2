**Verdict: land with your fixes.**

Reviewed `6830d4317` and `bc94cf25a`, the plan including **After the plan review** and **As built**,
and the preceding Sol plan review. Fixes are in the working tree; no commit was made.

## Findings

- **CR1 — P1 — A new guide can lose its automatic action when the server renames the thread.**
  `src/web/ChatPanel.tsx:456` / `src/web/guide-acts.ts:56` / `src/web/chat/controller.ts:395`
  (original defect: the Conversation subscription at `ChatPanel.tsx:1424` and its key at `:687`).
  With distinct provisional/server ids and buffered `begin → delta → done`, the old listener
  rejects the completion's server id. The new keyed Conversation mounts after the event, so the
  answer and chip appear without the promised action. Accepting the original id inside that
  Conversation alone would still lose its state on remount.

  **Fixed:** ChatPanel owns the subscription and act above the keyed transcript. `Answered` also
  carries the turn's starting thread id, retained through naming and pruned with the operation.
  The listener matches either name; the act is offered only to the confirmed conversation and
  expires when the reader leaves it. No completion replay was added.

  **Red first:** `tests/guide-acts-live-stream.test.tsx`, “acts through the real panel when a new
  guide is named and finishes in one buffered task”: the chip-presence assertion passed, then
  the runner assertion failed with **expected 1 call, got 0**. It now passes. Added coverage for
  completion after the corrected-id commit, leaving/reopening, and a hidden band. The final
  fixture follows the controller's `onThreadId` callback rather than inferring selection from
  the newest snapshot. Root cause and countermeasures are recorded in
  [261007t](../postmortems/261007t-a-completion-event-is-lost-when-its-listener-belongs-to-a-provisional-identity.md).

- **CR2 — P3 — Timing comments still describe the removed wait for purpose.**
  `src/web/last-view.ts:765`, `:801`, `:826`; `src/web/first-open-purpose.ts:93`.
  These comments claimed the marked default waits for the purpose read and may choose Summary.
  **Fixed:** comments now describe immediate application of the guide and the purpose read's
  modal-only decision. No behaviour changed, so no new failing test applies. Existing
  `first-open-purpose.test.tsx` covers immediate application, never-settled settings, phone modal,
  explicit-link precedence and reader identity.

## Other checks

- The CommandChip executor/block dependencies and press-time revalidation remain intact; I found
  no concrete stale-executor failure requiring a change to `pressRef`. Added
  `guide-acts-conversation.test.tsx` coverage proving a chip disabled at completion does **not**
  act when enabled later: the parent already spent its claim.
- `useChat` exposes the controller's stable `onAnswered` field. The finished-answer gate still
  waits for a drawn `done` row, preserving the notification-window fix. The identity-remount
  failure was CR1.
- Added controller coverage for successful retry/edit, refused retry/edit restoring the old
  answer without announcing it, and a turn superseded by deletion. Existing recovery and
  late-subscriber exclusions still pass. The completion event names the committed reply; commands
  run afterwards as before.
- Audited activation, mode runners and the allowed bands. Plain/Structure read existing content;
  Chat and Learn conversations wait for a sent message; allowed Referee views do not start a paid
  call or remote mutation on mount. Referee's source scan is a deterministic GET. Retained Quiz
  or Claims selections are not armed by a top-level Learn/Referee action. Search stays excluded,
  and generating targets stay buttons. No additional spending or remote-write escape found.
- On a marked first open, the immediate application and modal-only decision agree for stored,
  absent and failed purpose reads. Explicit article state and route/reader guards remain intact.
  No new double-modal/guide or stranded marked-arrival case found.

## Wider things not fixed

- **CR3 — P2 — Existing settings-read dependency on unmarked arrivals**, `src/web/last-view.ts:814`:
  an **unmarked** first-open default still waits for the experimental
  settings store's `loaded` flag. A failed/offline settings read can leave that arrival in Plain.
  This predates these commits and is the ordinary timing the plan explicitly retains; the marked
  path correctly bypasses it. Left unchanged.

## Validation

- Before fixes: the supplied 11-file test set passed **207 tests**; the added CR1 regression then
  failed for the missing action.
- Final supplied 11-file test set: **217 tests passed**.
- `npm run typecheck` could not start its `tsx` wrapper because the sandbox rejects its IPC socket
  (`listen EPERM`). Running the **same script** with `node --import tsx scripts/typecheck.ts`
  passed all four TypeScript projects and coverage of **3486 source files**.
- Scoped Biome lint: exit 0, seven complexity advisory diagnostics. `git diff --check`: passed.
- Postgres-dependent checks and browser checks were not run in this offline review.
