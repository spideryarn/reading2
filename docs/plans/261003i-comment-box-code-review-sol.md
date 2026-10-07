Verdict: **land after fixes (made)**. No P0s and no remaining findings. Nothing committed.

### Findings

- **B1 — P1 — fixed** — A bfcache restore left the already-saved builder usable. Changed words then reused the same draft ID; Postgres compares the body and returns `CommentIdTaken`/409. `pageshow` now reconciles the frozen snapshot through ordinary `create` and closes the builder. [AnnotateDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:432), [pg-comments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/pg-comments.ts:261). Test: [annotate-dialog-keeps-a-draft.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/annotate-dialog-keeps-a-draft.test.tsx:397).

- **B2 — P1 — fixed** — An edit could PATCH before a create held behind the opening read had POSTed. Create is now the first link in that comment’s write queue. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:408). Test: [use-comments-create-waits-for-the-opening-read.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:266).

- **B3 — P1 — fixed** — Delete did not coordinate with a held or in-flight create: it could DELETE before the row existed, then allow the create response to resurrect it. A held create is now cancelled; an in-flight create re-deletes after its response; queued patches observe the tombstone. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:750), [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:999). Tests: [use-comments-create-waits-for-the-opening-read.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:300).

- **B4 — P2 — fixed** — Help promised that leaving the page “saves” the draft, despite `pagehide` being best effort. It now says leaving or reloading tries to save and names the failure limit. [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/help/help-topics.tsx:681). Test: [annotate-dialog-copy.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/annotate-dialog-copy.test.tsx:224).

D1–D6 otherwise check out, including immutable keyed anchors, StrictMode, discard, conditional Reader closing, passed-anchor chat drafts, opening-read failure/timeout/unmount/slug behavior, the arbitrated mid-dictation flush, and Ask AI being the sole `ask: true` path. D6 remains the documented deliberate limit.

Checks:

- Requested seven suites: **143 passed**
- Typecheck: **passed**
- Doc links: **16 passed**
- Touched-file lint: no errors; one pre-existing complexity advisory in `useComments.send`
- `git diff --check`: passed
- Postgres tests were not run, as requested. I added the exact case to run:
  `npx vitest run tests/store-comments.test.ts -t "refuses changed words under the same id and anchor"`
- No commit made. The pre-existing untracked review-prompt file was left untouched.