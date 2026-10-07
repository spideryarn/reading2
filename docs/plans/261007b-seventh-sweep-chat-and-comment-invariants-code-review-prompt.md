# Code review (write-capable): chat and comment invariants

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** five commits on branch `worktree-sweep7-chat-comment-invariants` (base
`edce9846f`): `17ae67ee6` (A, SV1), `63c49bb72` (B, SV3 = SVO4, and SVO9), `8836f40ab` (mutation
records for A and B), `d3a25af1d` (C, SV2 + WC1 and the reverse interleaving), `5c0b8d45a` (D,
comments only). Read each with `git show`. The plan:
`docs/plans/261007b-seventh-sweep-chat-and-comment-invariants.md`. The umbrella:
`docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C4 and § What the review
changed (U7, U9, U16). The findings: `docs/investigations/261006d-seventh-sweep-depth-server-*`
(SV1–SV4 are from your family's read; SVO4, SVO9 from Opus's) and
`…reader-client-and-per-mode-hooks-sol.md` § WC1, with the cross-reviews.

**Try to break each item rather than confirm it.**

A. **SV1.** `requireTail` now runs in `streamChat`'s gate before `settleThread` when an edit carries
   a tail. An edit with NO tail (older clients) still stops the answer first: is that the old
   behaviour exactly? Can the early check refuse an edit the transactional check would have
   accepted (a tail that moved and moved back; a stopped-and-saved answer whose id the client
   holds)? Does the early refusal leak that another tab is streaming, or hold `inTurnOrder`
   longer?

B. **SV3 = SVO4.** `withTurn` refuses a different anchor (409) and a non-first-turn `help` (400,
   through a new small `ChatTurnRefused` class) before either message is minted. `sameAnchor` moved
   to `src/types.ts`. The builder's "an ordinary request cannot reach this" rests on:
   `ChatDialog.tsx` § `ask` always mints a fresh thread id, and follow-ups carry neither field.
   **Test that claim against every sender of a chat turn** (`grep -rn "api/chat" src/web`, the
   command bar, live conversation, Learn/Quiz hand-offs, retry/resend after a dropped stream,
   an edit-and-resend of the first message, a "?" press retried after a network error). Find one
   ordinary single-tab sequence that now gets a 409 or 400 it did not get before. Two existing
   tests in `tests/chat-anchor.test.ts` asserted the old behaviour (a different anchor is ignored
   and the question appended) and were changed to expect the refusal: was the old behaviour ever
   a deliberate tolerance (read the test's history: `git log -p -S` on its name)?
   **SVO9:** the four early checks now share one read, taken only when the send carries one of the
   four fields. Does any path now decide on a snapshot older than before, or skip a check it used
   to make?

C. **SV2 + WC1.** Server: `settle` frames the matching row from the store's returned list; with no
   matching row (comment deleted meanwhile) it frames the answer over the opening snapshot. Is
   that last branch right — does the client then resurrect a deleted comment? Client
   (`src/web/useComments.ts`): `send` writes only answer-owned fields over the current row in five
   places; `edit` / `place` / `recolour` end in one `landPatch` which keeps the stream's answer
   fields "when a stream was open at any point while the PATCH was out" (a mark that counts stream
   starts and endings). Break the mark: two streams on one comment; a stream on comment X and a
   PATCH on comment Y; a PATCH that fails; a stream that errors; StrictMode double effects; a
   comment removed mid-stream; PATCH responses arriving out of order (the reverse interleaving the
   client-zone review warned about). Which fields are "answer-owned" — is the list complete and
   in one place, or will the next field added be forgotten?

D. Every rewritten comment is a claim: check each against the code.

Postgres-backed tests cannot run in your sandbox (no network, not even loopback): **do not report
them as failing**; reason about whether each could pass against a plausible WRONG implementation
and say which. jsdom and pure tests you can run: `npx vitest run tests/<file>`. No `npm test`.

**Fix what is inside this stage**, narrowly, each finding red-first; for anything needing Postgres,
write the test and mark it unrun for the orchestrator. **Report, do not fix, anything wider.** Do
not touch `src/store/pg-referee-criteria.ts`, `src/store/db-errors.ts`, `src/jobs.ts`,
`src/db/schema.ts`, `drizzle/`, or any hook but `useComments.ts`. Do not commit. No new
reader-facing sentence. Do not attribute any decision to the product owner in docs: the choices
here were the orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; severity P0 (a reader's words lost) / P1 (a reader sees
wrong behaviour, or an ordinary request newly refused) / P2 / P3. For each: the input, reproduced
or reasoned, fixed or not (and the test, run or unrun). Then: files changed; what you ran, raw
counts; verdict (ship / ship with these fixes applied / do not ship); wider notes.
