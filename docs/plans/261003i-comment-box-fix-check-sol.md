- **C1 — CORRECT.** Same-id calls return the existing promise before clearing the tombstone ([useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:727)). The registry remains populated until the original task—including any compensating DELETE—settles. Thus clearing cannot expose an unrelated outstanding ordinary-create response. Both callers receive the same `Comment | null`; added direct coverage at [use-comments-create-waits-for-the-opening-read.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:455).

- **C2 — WRONG, fixed red-first.** The retry was bounded to one attempt and safely preserved 409 collisions, but if that retry also failed, the reader saw the comment disappear with no warning although it could return after reload. The failing regression is at [use-comments-create-waits-for-the-opening-read.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:598). The narrow fix reports the failed confirmation while continuing to suppress the deliberate 409 collision ([useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:797)). There is still no loop. Different-payload same-id drafts produce 409 and are not deleted; exact same ID and payload are, by the store contract, the same idempotent save. Owner-scoped article lookup prevents reaching another owner’s row.

Checks:

- Requested Vitest suites: **24 passed**
- Requested typecheck: **passed**
- `git diff --check`: passed
- No commit made
- Extra full `npm test` could not start because local Postgres was unavailable on `127.0.0.1:54362`

fixed