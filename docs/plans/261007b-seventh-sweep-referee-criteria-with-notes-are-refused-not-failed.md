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
| **The trim, said rather than changed** (the brief's item (b)). `POST /api/referee/criteria/:slug` when the list is full and the criterion the trim would remove has a comment on it | 500 `[db-failed]`, every time | **409** `CRITERIA_FULL_OLDEST_HAS_COMMENTS`, every time, before any stream opens; nothing inserted, nothing trimmed | Yes, at the route |

One helper carries all four: `violatesForeignKey(err, name)` in
[`src/store/db-errors.ts`](../../src/store/db-errors.ts), the 23503 sibling of `violatesConstraint`
and `violatesCheckConstraint`. It reads the whole `cause` chain and matches the constraint **by
name**, and it is asked inside the store method, before `guardDbStore` drops the name.

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

2. Adding a criterion to a full list whose oldest has comments on it
   (`CRITERIA_FULL_OLDEST_HAS_COMMENTS`):

   > The list of criteria is full and the oldest one has your comments placed on it, so a new
   > criterion cannot be added until you clear those placements or delete those comments.

**Reused, not new:** *"criterionId is not one of your criteria on this article"*
(`CRITERION_NOT_ON_ARTICLE`), which is `tidyMark`'s existing 400. It is a developer's sentence
rather than a reader's and was left as found, since the brief was to return exactly what the early
check returns.

## What the investigation documents and the brief got wrong, or left out

- **They say "notes"; the product says "comments".** The sentences use the panel's word.
- **SVR1 was "not reproduced against Postgres"** in Sol's review. It is now, on both write paths, by
  letting the route's own criteria read answer and then deleting the criterion before the write.
- **"The 21st criterion"** in the Opus finding is conditional, as Sol's review said: the trim skips
  `pending` rows, so the criterion in the way is the oldest *finished* one past the cap. The second
  sentence says "the oldest one", which is true in every case but that one.
- **The Opus review's file list for the fix** named `tests/store-parity-referee.test.ts`. Nothing
  there was needed; the cases are in `tests/referee-routes-postgres.test.ts`, which is where both
  the constraint name and the guard that drops it are in play.
- **Nobody mentioned that the panel lists newest first.** The hook holds oldest first, so "put the
  row back where it was" is an index into the hook's order, and a row appended instead would jump to
  the top of the panel.

## Left for others

- **`src/routes.ts` § `tidyMark`'s header** still says a foreign-key error from this key "becomes a
  generic store failure". That is no longer true of `comments_criterion_fk`. `routes.ts` was out of
  bounds for this cluster.
- **The 400's sentence is written twice**, in `tidyMark` and as `CRITERION_NOT_ON_ARTICLE`, for the
  same reason. The route test compares the two replies whole, so they cannot drift unseen; importing
  the constant into `routes.ts` is a two-line change for whoever is next in that file.
- **Questions 3 and 3a** are Greg's.

## Evidence

Red first, then green, then each fix broken again:

| Mutation | Went red |
|---|---|
| `COMMENTS_CRITERION_FK` renamed to a constraint that does not exist | the four refusal cases; the three controls stayed green |
| `violatesForeignKey` matching the SQLSTATE without the name | *does not take the comment table's other foreign key for this one*, and the matcher's unit case in `tests/db-error-scrub.test.ts` |
| the hook restoring on a status that is not 409 | *restores the row where it was*, *can be pressed again afterwards* |
| the hook restoring on every failure | *does not put a row back for a failure that is not a refusal* |
