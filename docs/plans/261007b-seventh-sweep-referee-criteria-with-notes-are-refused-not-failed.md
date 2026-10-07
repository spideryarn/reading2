# Seventh sweep, C5: a Referee criterion with comments on it is refused, not failed

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md), cluster **C5**, as narrowed by
its § What the review changed (U2, U10, U13, U16).

A referee can place their own comments on a criterion, and `comments_criterion_fk` refuses to delete
a criterion a comment points at. That refusal is deliberate. Nothing turned it into words, so it
reached the reader as a 500 `[db-failed]` and a Sentry report from three directions. This cluster
gives each a status and a sentence, and changes nothing else: the key is untouched, no comment is
detached, no criterion is deleted, and the trim's retention rule is exactly what it was.

The finished state is described in
[referee-mode.md § a criterion with comments on it](../project/referee-mode.md#a-criterion-with-comments-on-it)
and [comments.md § the referee's own placement](../project/comments.md#the-referees-own-placement).

## What landed

| Item | Was | Is | Reproduced first? |
|---|---|---|---|
| **SVO1 = DB1, the hand delete.** `DELETE /api/referee/criteria/:slug/:id` on a criterion with a comment placed on it | 500 `[db-failed]`; the row had already left the screen and stayed gone until a reload | **409** `CRITERION_HAS_COMMENTS`; `useCriteria` § `forget` puts the row back where it was | Yes, at the route against Postgres, and in the hook |
| **SVR1, a new comment.** `POST /api/comments/:slug` naming a criterion another tab deletes between `tidyMark`'s read and the insert | 500 `[db-failed]` | **400** `CRITERION_NOT_ON_ARTICLE`, the early check's own words | Yes, at the route |
| **SVR1, a moved placement.** `PATCH …/mark`, the same race | 500 `[db-failed]` | the same 400 | Yes, at the route |
| **The trim, said rather than changed** (the brief's item (b)). `POST /api/referee/criteria/:slug` when the list is full and the criterion the trim would remove has a comment on it | 500 `[db-failed]`, every time | **409** `CRITERIA_FULL_NEXT_TO_DROP_HAS_COMMENTS`, every time, before any stream opens; nothing inserted, nothing trimmed | Yes, at the route |

One helper carries all four: `violatesForeignKey(err, name)` in
[`src/store/db-errors.ts`](../../src/store/db-errors.ts), the 23503 sibling of `violatesConstraint`
and `violatesCheckConstraint`. It reads up to four links of the `cause` chain and matches the
constraint **by name**, and it is asked inside the store method, before `guardDbStore` drops the name.

## The simpler option passed over, and the one not built

**A pre-check** (*does this criterion have comments?* before the delete) is the obvious shape and is
not built anywhere. The transactions are READ COMMITTED, so a comment placed between the check and
the delete still raises the key's error; the plan review's U10 names that as the broken twin. The
key's own refusal is the one check that cannot be raced, so the refusals are built from it.

**The trim is not changed** (U2). Skipping a criterion with comments would let a list exceed twenty,
which is a retention decision: question 3a for Greg. Item (b) above was built because it falls out
of the same matcher and moves no policy: the same inputs are refused, with the same rollback, in the
same transaction. Only the status and the sentence differ, and the 500 was telling the referee the
app was broken when they could fix it themselves by clearing one placement.
`tests/referee-routes-postgres.test.ts` § *OPEN QUESTION 3a* pins the behaviour and says which half
turns over under each answer.

**Superseded the same day (2026-10-07).** Greg answered 3a and then the cap itself: no criterion is
ever dropped, the trim is gone, and an add at a ceiling of 200 is refused instead. The full-list
refusal described here (`CRITERIA_FULL_NEXT_TO_DROP_HAS_COMMENTS`, item (b) above, sentence 2 below)
became unreachable and was deleted; the *OPEN QUESTION 3a* case was turned over. See [261007f](261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md).

**The client restores on a 409 and on nothing else.** A 500 or a dropped connection does not say
whether the row was deleted, so those leave the row off the screen as before.

## New reader-facing wording, for Greg to veto

No existing sentence fits: the nearest is `importRunning` in `src/store/pg-shelf.ts` (*"An import is
running on this article, so it cannot be deleted yet. Stop it, or wait for it to finish, then
delete."*), which these two follow: what is in the way, then what to do, in the panel's own labels
(*Place on a criterion*, *Clear placement*). Neither carries a bracketed code, on
[copy.md](../project/copy.md)'s rule that a refusal which is an answer gets none. Both are in
[`src/referee-criteria-store.ts`](../../src/referee-criteria-store.ts).

1. Deleting a criterion with comments placed on it (`CRITERION_HAS_COMMENTS`):

   > Your comments are placed on this criterion, so it cannot be deleted until you clear those
   > placements or delete those comments.

2. Adding a criterion to a full list when the criterion the trim would remove has comments on it
   (`CRITERIA_FULL_NEXT_TO_DROP_HAS_COMMENTS`; it was `CRITERIA_FULL_OLDEST_HAS_COMMENTS` and said
   "the oldest one" until the code review's C1, see § Review status):

   > The list of criteria is full and the one that would be dropped to make room has your comments
   > placed on it, so a new criterion cannot be added until you clear those placements or delete
   > those comments.

Both are final as landed and both are still open to a veto. *(2026-10-07: the second was deleted
with the trim it described, [261007f](261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md); the first stands.)* The second was reworded by the
orchestrator after the review, not by the owner.

**Reused, not new:** *"criterionId is not one of your criteria on this article"*
(`CRITERION_NOT_ON_ARTICLE`), which is `tidyMark`'s existing 400. It is a developer's sentence
rather than a reader's and was left as found, since the brief was to return exactly what the early
check returns.

**That reused sentence reaches readers, which is GPT Sol's wider point and is not changed here.**
In the race case `useComments` shows the server's 400 as it arrives, so a referee whose criterion
was deleted in another tab a moment ago reads *"criterionId is not one of your criteria on this
article"*. It is written in a developer's register, about a field name the reader never sees.
Whether to reword it, and whether the early check and the race should then still share one
sentence, is a wording question for the owner.

## What the investigation documents and the brief got wrong, or left out

- **They say "notes"; the product says "comments".** The sentences use the panel's word.
- **SVR1 was "not reproduced against Postgres"** in Sol's review. It is now, on both write paths, by
  letting the route's own criteria read answer and then deleting the criterion before the write.
- **"The 21st criterion"** in the Opus finding is conditional, as Sol's review said: the trim skips
  `pending` rows and deletes finished rows past the cap. The builder's second sentence says
  "the oldest one", which can be false: an older pending row can have no comments while a younger
  finished row blocks the trim. The review left that wording unchanged; it was replaced afterwards
  (§ Review status, C1), and the pending-row case in `tests/referee-routes-postgres.test.ts` runs
  that scenario and refuses a sentence that says "oldest".
- **The Opus review's file list for the fix** named `tests/store-parity-referee.test.ts`. Nothing
  there was needed; the cases are in `tests/referee-routes-postgres.test.ts`, which is where both
  the constraint name and the guard that drops it are in play.
- **The panel lists newest first.** The hook holds oldest first. Restoration uses the row's
  timestamp and id, matching the store's order; a captured index goes stale when another row is
  deleted while the first refusal is in flight.

## Left for others

- **`src/routes.ts` was out of bounds for the builder.** The review was authorised to correct
  `tidyMark`'s stale header and import `CRITERION_NOT_ON_ARTICLE`; both are now done.
- **Questions 3 and 3a** are Greg's. *(2026-10-07: both answered. 3a and the cap: [261007f](261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md). 3b, the
  hand delete: keep refusing, so `CRITERION_HAS_COMMENTS` stays as built here.)*

## Code review corrections

The client initially restored a frozen row at a captured array index. Concurrent refusals could
reorder rows; frames received while deleted were lost; whichever DELETE refused first could
restore a pending snapshot after `done`; and an old article's refusal could restore into a new
article's delete using the same id. Restoration now shares a deletion record with the stream,
keeps its latest hidden row, checks the record's identity and article scope, and applies the tab's
colour choice. A stream's duplicate DELETE waits for the original and is skipped after a refusal,
so it cannot delete a row that the refusal just restored.
`tests/use-criteria-refusals.test.tsx` covers those races and stream resumption after restoration.
The trim's stored outcomes remain unchanged. These are the builder's and reviewer's implementation
choices under the orchestrator's brief, not decisions attributed to the product owner.

## Review status

**GPT Sol's verdict on the code was "do not ship yet", on C1 alone.** Its report is
[the review answer](261007b-seventh-sweep-referee-criteria-with-notes-are-refused-not-failed-code-review-sol.md)
and what it was asked is
[the prompt](261007b-seventh-sweep-referee-criteria-with-notes-are-refused-not-failed-code-review-prompt.md).
It fixed C2 to C8 itself and left C1, because C1 is reader-facing wording it had been told not to
change.

| Finding | What it was | What happened |
|---|---|---|
| C1 | The full-list sentence said "the oldest one has your comments placed on it". False when the oldest criterion is pending (the trim skips it) and a younger finished one is what blocks | **Fixed after the review**, by the orchestrator's decision: the sentence now names "the one that would be dropped to make room", and the constant is renamed to match. The wording stays on the list above for the owner to veto |
| C2 | A refused delete restored the snapshot taken when Delete was pressed, so a row could come back pending for ever after its `done` had arrived | Fixed by Sol: the deletion record keeps the latest hidden row, results and stream failure included |
| C3 | Two refusals could put two rows back in the wrong order | Fixed by Sol: restored by `(createdAt, id)`, the store's order |
| C4 | An old article's DELETE reply or stream could restore or fill a new article's delete that reused the id | Fixed by Sol: the reply is tied to its deletion record and to the article it was made on |
| C5 | The stream's duplicate DELETE could succeed after the original refused and restored the row | Fixed by Sol: the duplicate waits for the original and is skipped after a refusal |
| C6 | A restored `done` carrying an older colour beat this tab's choice | Fixed by Sol |
| C7 | The existing second-delete test did not prove the tombstone is cleared | Fixed by Sol: a new case, and a mutation that reddens it |
| C8 | Comments and docs that overclaimed; `tidyMark`'s stale header; the 400 sentence written twice | Fixed by Sol, including its two authorised edits to `src/routes.ts` and nothing else there |

**What was checked afterwards, outside Sol's sandbox** (same model family as the builder, so this
is a check and not a second cross-family review):

- C2, C3, C4 and C5 were each hand-reverted and each went red in
  `tests/use-criteria-refusals.test.tsx`, then put back.
- Two of the three article-scope guards in the stream were held by no test: removing either one
  alone left the file green. Two cases were added, one for an old article's `result` frame and one
  for an old article's stream stopping, and each reddens with its guard removed.
- **The Postgres cases Sol wrote without a database were run for the first time**: four new cases
  (another article's criterion; another owner; several trim candidates rolling back together; an
  oldest pending row kept while a younger finished one blocks) and whole-row rollback assertions on
  the existing full-list case. `tests/referee-routes-postgres.test.ts`: 18 passed, as written. No
  test needed correcting.
- One thing those cases needed that Sol could not have seen without running the wider suite: the
  other-owner case names a fixed owner id, and `tests/store-migration-registry.test.ts` went red
  until `OWNER_AUDIT` said why that owner needs no seeded row (every call made as him is refused
  before a write).
- Retention is unchanged. In the full-list cases every stored column of every criterion is equal
  before and after the refused add: nothing inserted, nothing trimmed. Sol's diff to
  `src/store/pg-referee-criteria.ts` is comments only.
- **C1's fix was not re-reviewed by a second model family.** It is one sentence, a renamed
  constant and an assertion, run against Postgres.
- `useCriteria.ts` went from 407 lines before this cluster to 441 as built and 466 after the
  review. The delete path is denser than it was, and `forget` is where it is densest: one promise
  chain that waits for the earlier request, checks the record twice, and decides restoration.
  It is one record type and one map rather than a set of flags, and each of the review's fixes has
  a test that reddens without it, so it was kept as reviewed.

**Left:**

- **An old stream can still paint another article when no deletion record exists.** The scope check
  lives on the deletion record, so a stream from the previous article that meets no delete in the
  new one still calls `put`. This predates the cluster.
- **`violatesForeignKey` does not distinguish schemas.** It matches SQLSTATE and constraint name.
  Sol found no reachable collision: the statements target the schema-qualified tables.
- **The 400 sentence's register**, above.
- *(Moot since 2026-10-07: the sentence below was deleted with the trim, [261007f](261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md).)*
  **"The one that would be dropped"** is singular, and the trim can have more than one candidate
  when older pending rows have since finished. The sentence is then true of one of them and silent
  about the rest; clearing that one lets the add through.

## Evidence

Red first, then green, then each fix broken again:

| Mutation | Went red |
|---|---|
| `COMMENTS_CRITERION_FK` renamed to a constraint that does not exist | the four refusal cases; the three controls stayed green |
| `violatesForeignKey` matching the SQLSTATE without the name | *does not take the comment table's other foreign key for this one*, and the matcher's unit case in `tests/db-error-scrub.test.ts` |
| the hook restoring on a status that is not 409 | *restores the row where it was*, *can be pressed again afterwards* |
| the hook restoring on every failure | *does not put a row back for a failure that is not a refusal* |
