# Review: stage 1 of 261003l — `reader_notes`, a Chat tool that reads the reader's own notes

Repo: the current directory (Spideryarn; TypeScript, ESM, Postgres through drizzle). You reviewed
the plan: `docs/plans/261003l-reader-notes-plan-review-sol.md` (PR-1..PR-7). The plan is
`docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md`; its Reviews
section is what was to be built, and "Stage 1, what landed" is the implementer's account.

## The candidate

Committed: `05a1dc3f8`. `git show --stat 05a1dc3f8`; `git diff 05a1dc3f8^..05a1dc3f8`.
Start with `src/reader-notes.ts`, `src/chat-tools.ts` (`READER_NOTES_TOOL`, `toolsFor`,
`readReaderNotes`, the `runTool` gate), `src/converse.ts` (`toolsFor(kind)` in the request, the
tool context, the new `SYSTEM` bullet, `recentHistory` now calling `settledExchanges`),
`src/routes.ts` (`streamChat`'s `threadId`, `liveTool`), `tests/reader-notes-tool.test.ts`,
`tests/reader-notes-owner-isolation.test.ts`, `docs/project/chat-tools.md`. Not the limit.

## What it is meant to do

One read-only tool. No arguments: the signed-in owner's comments, highlights and bookmarks on the
open article, then an index of their other conversations on it. `{thread}`: one of those
conversations, settled exchanges only. Statements I want checked for accuracy, each against code:

1. Only the article's owner's data can be returned, on every path that reaches the tool.
2. The tool is offered to `chat` threads only, and cannot run for Recall, Tutorial, Candidates or
   Live, including through Live's independently callable tool endpoint.
3. Every cap is announced, every total is exact, and no answer exceeds its stated budget.
4. Stored text is inside the fence, our sentences are outside, and stored text cannot close the
   fence or forge one of our rows.
5. A failed, pending, interrupted or unanswered exchange is never shown as finished discussion.
6. `recentHistory` returns exactly what it returned before the refactor, for every history.
7. Nothing logged carries a note, a quote, a title or a thread id.
8. `docs/project/chat-tools.md` and the header of `src/chat-tools.ts` match the code.

## What you may do

Your sandbox is workspace-write. Fix what you find **inside this stage**, narrowly and red-first
(a failing test, then the fix). Report, do not fix, anything wider. Do not commit. Run no git
command that discards work. Do not run `npm test` in full, nor `db:generate`, `db:migrate`,
`db:reset`. Run `node --import tsx scripts/typecheck.ts` and
`npx vitest run tests/reader-notes-tool.test.ts` and any other file that needs nothing outside the
tree. You have no network or database: say which Postgres-backed files you could not run
(`tests/reader-notes-owner-isolation.test.ts`, `tests/chat-live-ticket-route.test.ts`) and I will
run them. My raw result for them at `05a1dc3f8`: 8 files, 276 tests passed, including both.

Severity: P0 data loss, exploitable security, wrong charging, service unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk; P3
prose. IDs continue the chain: start at `CR-8`. For each: file:line, established or reasoned,
fixed (and how) or left. End with a verdict: land, land with the fixes named, or do not land.

## My own suspicions (already mine; spend most of the run elsewhere)

- Three cross-owner tests were never seen red; the boundary is the store's.
- Whether the new `SYSTEM` bullet makes Chat reach for the tool too often; it is unmeasured.
- Whether notes made in Referee mode belong in the list.
