# Code review (write-capable): referee criteria with comments are refused, not failed

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** commit `0c5c71e16` on branch `worktree-sweep7-referee-refusals` (base `c25a46a8d`;
`git show --stat 0c5c71e16`). The plan:
`docs/plans/261007b-seventh-sweep-referee-criteria-with-notes-are-refused-not-failed.md`. The
umbrella: `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C5 and § What the
review changed — **U2 narrowed this cluster: the trim's retention rule is a product decision
waiting on the owner (question 3a) and must be unchanged**; U10 and U16 also apply. The findings:
SVO1 / DB1 / SVR1 in `docs/investigations/261006d-seventh-sweep-depth-server-*` and
`…database-schema-*`.

**What it does.** `comments_criterion_fk` refuses deleting a Referee criterion that a comment is
placed on. Three paths that hit it were 500s: a hand delete; a placement (new comment, or a moved
one) that loses a race with a delete; and adding a criterion to a full list whose oldest finished
criterion has comments (the trim's delete is refused and the insert rolls back). Now: the hand
delete is a 409 with a new sentence and the client (`src/web/useCriteria.ts`) puts the row back;
the placement race is a 400 in the early check's existing words; the full-list add is a 409 with a
second new sentence and **the same rollback as before**. A new `violatesForeignKey(err,
constraint)` in `src/store/db-errors.ts` matches SQLSTATE 23503 by constraint name over the cause
chain.

**Try to break it.**

1. **U2: is anything about retention changed?** The builder built the full-list 409 judging it "not
   a policy change: same inputs refused, same transaction rolled back". Verify from the code and a
   test that, in that case, nothing is inserted, nothing is trimmed, and a pending criterion is
   handled as before. If the 409 changes any stored outcome, it must come out.
2. **The matcher.** Can `violatesForeignKey` match the wrong error (another constraint with the
   same name in another schema; a wrapped Drizzle error whose cause chain has a different shape; an
   error from a DIFFERENT statement in the same transaction, so that a 409 is returned after some
   other write was the one refused)? After the store guard scrubs errors, is the constraint name
   still present at the point of the catch on every path? Does a matched error still roll the
   transaction back?
3. **The refusals must not refuse what succeeds today**, and must not turn a real fault into a
   polite 409: a different FK on the same tables stays a store failure (tested, the builder says);
   what about a criterion belonging to another article or another owner?
4. **The client restore** (`forget` takes the removed row and its index and restores on a 409
   only). Break it: two deletes in flight; a delete refused after a new criterion was added (the
   index is stale); the row restored while a stream for it is running; a 409 from some other cause
   on the same request; a refused delete whose row was since removed by a reload. The builder notes
   one untested half: "the tombstone-clearing half of the client restore has no case that would
   catch its removal". Write that case.
5. **The two new reader-facing sentences** (in `src/referee-criteria-store.ts`, for the owner to
   veto). Do not rewrite them. Check only: do they state something false in any reachable case
   (the builder admits "the oldest one" is loose because the trim skips pending criteria — is the
   sentence then wrong, and can the reader act on it)? Do they use the product's own words
   ("comments", "Place on a criterion", "Clear placement")? Is the reused 400 sentence
   (`criterionId is not one of your criteria on this article`), which is developer-register, ever
   actually shown to a reader in the race case, or does the client replace it?
6. `src/routes.ts` was out of bounds for the builder: the header comment above `tidyMark` now says
   something false about this foreign key, and the 400 sentence exists twice (a literal in
   `tidyMark` and the constant). **You may make those two edits in `src/routes.ts`** (correct the
   comment; import the constant), and nothing else there.
7. Every rewritten comment and doc sentence is a claim; check each against the code.

Postgres-backed tests cannot run in your sandbox (no network, not even loopback): do not report
them as failing; reason about whether each could pass against a plausible WRONG implementation,
and say which. jsdom and pure tests you can run with `npx vitest run tests/<file>`. No `npm test`.

**Fix what is inside this stage**, narrowly, red-first; write any Postgres test and mark it unrun.
**Report, do not fix, anything wider.** Do not touch `src/db/schema.ts`, `drizzle/`,
`CriteriaPanel.tsx`, `MirrorPanel.tsx`. Do not commit. Do not attribute any decision to the product
owner in docs: these choices were the orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; P0 (a reader's comments lost) / P1 (a reader sees wrong
behaviour, or policy changed without the owner) / P2 / P3; the input; reproduced or reasoned; fixed
or not (and the test, run or unrun). Then files changed, what you ran with raw counts, a verdict
(ship / ship with these fixes applied / do not ship), and wider notes.
