Verdict: **land after fixes (made)**. No P0s and no remaining findings. Nothing committed.

### Findings

- **C1 — P1 — fixed** — Cancelling a held create left a permanent tombstone. The gutter bookmark retained that id after `create` returned `null`, so every retry was cancelled forever. Concurrent same-id creates now coalesce; a later attempt clears the retired tombstone. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:719). Tests: [use-comments-create-waits-for-the-opening-read.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:383), queued edit/recolour/place settlement at [line 411](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:411).

- **C2 — P1 — fixed** — If delete raced an in-flight POST whose response was lost, no DELETE followed; a committed row could reappear on reload. The client now repeats the identical idempotent POST to prove ownership, then deletes. A 409 collision is preserved rather than accidentally deleted. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:784). Tests: ambiguous success at [line 486](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:486), collision safety at [line 528](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:528).

- **C3 — P2 — fixed** — After a slug change, queued PATCHes correctly reached the old article but could apply their whole-row response to a same-id comment in the new article. Writes still finish against their captured slug, while stale responses and errors no longer update current React state. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:409). Test: [use-comments-create-waits-for-the-opening-read.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:266).

B1 checks out: the pageshow replay uses the frozen snapshot, and Postgres treats an exact same-id repeat as idempotent. Whether the keepalive POST landed, missed, or remains in flight, the replay returns one row; the client replaces by id, so there is no duplicate or ordinary reader-visible 409. [AnnotateDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:432), [pg-comments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/pg-comments.ts:235).

Existing edit/place/recolour ordering and documented tombstone behavior remain intact.

Checks:

- Requested six suites: **76 passed**
- Typecheck: **passed**
- Touched-file lint: no errors; two complexity advisories in `useComments.ts`
- `git diff --check`: passed
- Full `npm test`: could not start because local Postgres was unavailable (`EPERM` on `127.0.0.1:54362`)
- No commit made.