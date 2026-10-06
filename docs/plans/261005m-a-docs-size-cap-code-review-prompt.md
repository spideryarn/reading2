# Review and fix: a size cap on docs/, its postmortem, and a chat-tools test file kept off the network

Repo: this worktree, TypeScript + ESM, vitest.
You may WRITE in this worktree. Fix what is inside this work, narrowly and red-first (write or
adjust the test, see it fail, then fix). Report, do not fix, anything wider. Do not commit. Do not
edit anything under docs/reusable/, AGENTS.md or CLAUDE.md. Do not attribute any words to Greg
that are not already quoted in the repo.

## The candidate

Committed: 249db6016 (the cap test, the plan, the postmortem) and 47e99bbb4 (the chat-tools tests),
on top of c4933aa86.
  git diff c4933aa86..47e99bbb4
  changed paths: git diff --name-only c4933aa86..47e99bbb4

Start with: tests/docs-size-cap.test.ts, tests/chat-tools.test.ts (the mock block near line 57, and
the read_web_page tests), the postmortem under docs/postmortems/261005r-*, the plan
docs/plans/261005m-a-docs-size-cap-and-a-chat-tools-test-that-stops-doing-dns.md (your plan review
and what was done about F1 to F4 are recorded in it). Then src/fetch.ts and src/chat-tools.ts as far
as the tests depend on them. That is where to begin, not the limit.

## What it is meant to do

The plan says. Its two queue items, verbatim, are in the plan review prompt beside it
(docs/plans/261005m-a-docs-size-cap-plan-review-prompt.md).

## What I want from you

An independent attack first. Then in particular:

- Does every claim of fact in the postmortem hold? Check each number, commit and time against git
  and against what you established in the plan review. A postmortem with a wrong fact is a P1 here.
- Can tests/docs-size-cap.test.ts pass while a 22 MB file sits under docs/? (symlinks, dotfiles,
  what `globSync` skips, `parentPath` on this Node.)
- Can a test in tests/chat-tools.test.ts still reach a socket? Is the order of the file-level
  `afterEach` and the nested `vi.unstubAllGlobals()` calls sound, and can the counting stub be
  silently replaced so that an unstubbed fetch is not counted?
- Does the file-level mock change what any existing test in that file proves?

You may run: `npx vitest run tests/chat-tools.test.ts tests/docs-size-cap.test.ts tests/doc-links.test.ts`.
I ran the full suite and typecheck myself; a red inside your sandbox is not yet a finding, say what
it was.

Grade every finding P0 to P3 by consequence (P0 data loss or security; P1 wrong behaviour or a
contract violated; P2 design or maintainability risk; P3 prose), continue the IDs from F5, say for
each whether you fixed it, and end with one verdict: land, land after fixes, or do not land.

## My own suspicions, worth less than yours

- `globSync("docs/**/*")` may skip dot-directories.
- The postmortem's "why nothing went red" list is from one transcript and git log; a detail may be off.
