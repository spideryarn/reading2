# Review: Stage 2b — the server's stream channels, ChatController's catches, and the dev hint in production

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924 (TypeScript, ESM; server in
src/, React client in src/web; vitest). House rules: CLAUDE.md.

## The candidate

Live pre-commit on top of HEAD (stage 2 is committed as 6c7c1d0d; review **only the 2b changes**).
**Other agents are editing OTHER files in this tree — touch only the files below. Do not commit.**

Modified: src/routes.ts, src/messages.ts, src/web/chat/controller.ts, src/web/useComments.ts,
src/web/lib/reader-facing.ts, src/web/jobEngine.ts, src/web/useShelf.ts, src/web/useAdminUsers.ts,
src/web/useAdminFeedback.ts, tests/glossary-asked-term-stream-route.test.ts,
tests/describe-fetch-failure.test.ts, docs/project/copy.md,
docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md (§ Stage 2b only).
Untracked: src/reader-sentence.ts, tests/reader-sentence.test.ts.
`git diff HEAD -- <paths>` shows it. Start with the plan's § Stage 2b, src/reader-sentence.ts, then the
`sayToReader` call sites in src/routes.ts (`grep -n sayToReader src/routes.ts`).

## What it is meant to do

1. Every streaming route's `error` frame and stored `error` field carries only a sentence the server
   wrote for a reader — a declared `stageFailure` (`declaredFailure`) or a message ending in a registered
   code (`kindOfMessage`) — else `ANSWER_GAVE_UP` ([ai-gave-up], kind retry) with the real error logged via
   src/log.ts. No second convention.
2. ChatController's four catches draw `describeFetchFailure(e)`, never `e.message`.
3. `couldNotReach()`: production says `COULD_NOT_REACH` ([net-down]) without the npm hint or the browser's
   words; dev keeps the hint. Used at all five former "npm run dev" sites.

Deliberately out of scope (recorded): handleApi's JSON catch sending raw messages; the four hooks'
exact "Failed to fetch" match and passthrough of other messages.

## What you may change

Edit only the files above. Fix what is inside this stage red-first; report anything wider. Do not
commit. List every file you changed. You can run single test files; Postgres-backed ones may skip.

## Attack it

Invariants to break: a raw exception message still reaches a reader via one of these routes' frames or
stored rows (did I miss a site? `grep -n "err as Error).message\|error: message" src/routes.ts`); a
sentence that WAS written for a reader in one of these streams now becomes `ANSWER_GAVE_UP` (an uncoded
reader sentence thrown after headers — check the glossary, quiz, chat, search, referee stream code for
thrown messages without a bracketed code); a reader-stopped/superseded chat turn now shows ANSWER_GAVE_UP
where it showed something sensible; the log line leaks prose; `import.meta.env.PROD` behaving
differently under the API build (`api-dist`) or SSR if reader-facing.ts is ever bundled server-side;
the controller importing useComments creating a cycle (`npm run cycles` if you can).

Findings: IDs from F8, severity P0–P3 (P0 data loss/security/charging/broadly unusable; P1 user-visible
wrong behaviour or authoritative contract violated; P2 design risk; P3 prose), established or reasoned,
(a) reproduction, (b) fix. Refuse only on an established P0/P1.

## My own suspicions — read last

1. Uncoded reader sentences thrown mid-stream (e.g. glossary's own refusals after headers, quiz's
   "MarkStopped") — do any exist?
2. `ANSWER_GAVE_UP` retry vs `UNEXPECTED_FAILURE` bug.
