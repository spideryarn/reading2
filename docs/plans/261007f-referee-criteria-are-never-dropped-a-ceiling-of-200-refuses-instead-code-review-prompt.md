# Code review (write-capable): Referee criteria are never dropped; a ceiling of 200 refuses instead

You are reviewing, and may fix, one committed change in this worktree: commit `a95dae313` on
branch `worktree-sweep7-criteria-trim-keeps-commented` (`git show a95dae313`). The plan:
`docs/plans/261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md`. What it
replaces: `docs/plans/261007b-seventh-sweep-referee-criteria-with-notes-are-refused-not-failed.md`
(landed earlier today; your review of it is beside it).

**The decision, made by the product owner** (relayed verbatim by the Overseer, 2026-10-07): to
"never drop a criterion that has comments; the list may run past twenty" — *"yes, agreed. is there a
good reason why we cap at 20 in the first place? I don't think that was an instruction from me"* —
and then to "never drop a criterion silently; allow up to 200; refuse past that with a sentence" —
*"1 agreed"*. The counting rule, the sentence's wording and everything else are the orchestrator's
and the builder's choices, not his.

**What it does.** `begin` in `src/store/pg-referee-criteria.ts` no longer deletes anything. After
its existing `lockArticleRow` (`for update` on the article), it counts every criterion on the
article (pending, failed, unreadable, with or without comments, a raw `count(*)`) and at 200 throws
a 409 with *"This article already has 200 criteria, which is as many as it can hold. Delete one to
add another."*, inside the transaction, before the stream opens. A retry of a failed criterion
resets its own row and is never refused. C5's full-list refusal is deleted. The client shows the
refused criterion as a failed row with the server's sentence and Retry.

**Try to break it.**

1. **Nothing a reader made is ever deleted by an add.** Find any remaining path (the orphan sweep,
   a reset, the store's other writers, export/import, the public reader) that removes a criterion
   other than the reader's own delete.
2. **The ceiling.** Can 201 exist (the four-concurrent-adds test went red without the lock in 3 of
   3 runs and has no forced interleaving: reason about it; is every insert path under the same
   article lock, including any that do not go through `begin`)? Is "count everything, including
   rows the loader cannot read and does not show" right, given the sentence tells the reader to
   delete one — can a reader end up at 200 with fewer than 200 visible, unable to get under the
   ceiling? If so, what is the smallest honest fix (count only what is shown; or make the hidden
   ones deletable)? Does a retry over a row at 200 stay unrefused in every case?
3. **The refusal reaching the reader.** It is a 409 before the stream. Trace the client: the typed
   criterion stays on screen as a failed row with the sentence and Retry. Does Retry on that row
   re-send an add that will be refused again (a loop of the same refusal, or a paid call)? Is the
   reader's typed text lost on reload, and is that acceptable given the house rule the owner has
   just asked to have written down: *try hard never to lose or throw away user input*? If keeping
   the typed text would be small (it is already in the client's state), say how.
4. **The sentence.** Is it false in any reachable case? The builder notes one: if the criteria a
   reader would delete all have comments, a hand delete is refused with its own sentence. Is the
   ceiling sentence then misleading? Do not rewrite it; report.
5. **Mirror** has its own `MAX_CRITERIA = 24` (criteria sent in one prompt) and reports how many it
   left out. Lists past 24 were rare and are ordinary now. Which 24 are sent when there are more,
   and is that choice stated to the reader? Report; do not change it.
6. **Deleted code and tests.** Every reference to the removed refusal is gone (grep), and no
   remaining test still asserts drop-oldest. Every rewritten comment and doc sentence is a claim,
   including the owner's two quotes in `docs/project/referee-mode.md`: check they are exactly as
   above.

Postgres-backed tests cannot run in your sandbox (no network, not even loopback): do not report them
as failing; say which could pass against a plausible wrong implementation. jsdom tests you can run:
`npx vitest run tests/use-criteria-refusals.test.tsx` and the other `tests/referee-*.test.tsx`. No
`npm test`.

**Fix what is inside this change**, narrowly, red-first; write any Postgres test and mark it unrun.
**Report, do not fix, anything wider.** Do not change `MAX_CRITERIA`'s value, the sentence, or
Mirror. Do not commit. Do not attribute any further decision to the owner.

**Reply format.** Findings C1, C2, …; P0 (a reader's criterion or comment lost) / P1 (a reader sees
wrong behaviour) / P2 / P3; the input; reproduced or reasoned; fixed or not (and the test). Then
files changed, what you ran with raw counts, and a verdict (ship / ship with these fixes applied /
do not ship).
