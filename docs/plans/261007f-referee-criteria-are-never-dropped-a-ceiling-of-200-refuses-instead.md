# Referee criteria are never dropped; a ceiling of 200 refuses instead

Up: [plans.md](../project/plans.md) · follows
[261007b, C5](261007b-seventh-sweep-referee-criteria-with-notes-are-refused-not-failed.md) · answers
questions 3a and the cap in
[the seventh sweep's umbrella](261006m-seventh-codebase-sweep-depth-umbrella.md) § For Greg, as
revised.

A referee's list of criteria was capped at twenty. Each add past that deleted the oldest finished
criterion in the same transaction, and nobody was told. When the criterion to delete had the
referee's comments placed on it, `comments_criterion_fk` refused the delete, the insert rolled back,
and adding a criterion failed every time (a 500, then since C5 a 409 with a sentence).

## What Greg decided

Both on 2026-10-07, relayed by the Overseer. First, to *never drop a criterion that has comments, so
a list can run past twenty*:

> yes, agreed. is there a good reason why we cap at 20 in the first place? I don't think that was an
> instruction from me
>
> — Greg, 2026-10-07

He was right that it was not his. The cap and drop-oldest came in with Criteria itself,
`b9f1d2a53` (2026-09-01, *Criteria: the referee says what they are judging the paper against*),
written by an agent: `MAX_CRITERIA = 20` with the comment *"A cap for the reason `MAX_RUNS` in
src/searches.ts is one … Oldest go first."* Then, to *never drop a reader's criterion silently;
replace drop-oldest with a high ceiling of 200; refuse a new criterion past that with a plain
sentence saying why*:

> 1 agreed
>
> — Greg, 2026-10-07

The second supersedes the first's mechanism: there is no trim left to exempt anything from.

## What changed

- **The trim is gone.** `begin` in `src/store/pg-referee-criteria.ts` deletes nothing, commented or
  not, pending or finished.
- **`MAX_CRITERIA` is 200, a ceiling** (`src/saved-criteria.ts`). `begin` counts the article's
  criteria and, at 200, throws `criterionRefusal(409, CRITERIA_AT_CEILING)` from inside the
  transaction, so nothing is inserted. The route answers before any stream opens, as C5's refusal
  did.
- **What it counts: every row on the article.** Pending, failed, with comments or without. That is
  the simplest honest rule. Each one is a criterion the referee asked for and can see and delete, so
  "how many does this article have" has one answer and the sentence's way out is real. A raw
  `count(*)`, not the length of the loaded list, because the loader drops a row whose config it
  cannot read, and a ceiling that skipped those would let the table hold more than it says. Such a
  row can only come from an import or a hand edit (check constraints forbid it); it counts without
  being shown.
- **A retry is not an add.** Re-running a failed criterion (same id, same words) resets its row and
  is never refused, at the ceiling or anywhere else.
- **The race.** `begin` already took `lockArticleRow` (`select … for update` on the article row) as
  its first statement; the count now sits after it, in the same READ COMMITTED transaction as the
  insert. A second `begin` on the article waits for the first to commit and then counts its row.
  An article belongs to one owner, so this is per owner and article. A delete takes no lock and
  needs none: it only lowers the count.
- **C5's full-list refusal is deleted.** `CRITERIA_FULL_NEXT_TO_DROP_HAS_COMMENTS`, its sentence,
  the `catch` in `begin` that produced it, its info log line, its tests and its doc row. The client
  had no handling specific to it. `CRITERION_HAS_COMMENTS`, the hand delete's refusal, is unchanged.
- **The client.** No new code. A 409 before the stream is the hook's ordinary pre-stream failure:
  `useCriteria` § `send` keeps the typed criterion on screen as a failed row carrying the server's
  sentence, with Retry, and sets the panel error. It is never shown as added, no other row is
  touched, and the referee's words are not lost (until a reload: the row was never stored).
  `tests/use-criteria-refusals.test.tsx` § *an add refused at the ceiling* pins that.

## The simpler option passed over

**Keep the trim and exempt commented criteria from it**, which was the first brief and was half
built (a `for update` on the candidates, then a `not exists (comment)` delete). It was dropped when
Greg answered the cap question: it still deleted criteria without comments silently, and it needed
the lock-then-check dance to survive a placement moved onto a candidate mid-transaction. A ceiling
that refuses deletes nothing, so it has no race with comments at all.

**No ceiling at all** was not offered: a bound on a table a script could otherwise fill is worth
one sentence.

## New reader-facing wording, for Greg to veto

`CRITERIA_AT_CEILING`, in `src/referee-criteria-store.ts`, with the number spelled from the
constant:

> This article already has 200 criteria, which is as many as it can hold. Delete one to add another.

The orchestrator's proposed wording, kept as given. **One reachable case where "Delete one" is not
enough on its own:** if a criterion has comments placed on it, deleting it is refused with its own
sentence (`CRITERION_HAS_COMMENTS`), which says to clear the placements first. Only if all 200 had
comments would no delete succeed directly. The sentence is not false there, just one step short;
left as proposed.

One sentence removed: C5's *"The list of criteria is full and the one that would be dropped to make
room has your comments placed on it…"*.

## What assumed "at most twenty"

- `src/store/pg-referee-criteria.ts`: the trim (`offset(MAX_CRITERIA - 1)`). Replaced.
- `tests/store-parity-referee.test.ts` § *never trims a criterion that is still being answered*:
  filled `MAX_CRITERIA` and expected `MAX_CRITERIA + 1` after the trim skipped a pending row. At 200
  it would have hit the ceiling. Now *never drops a criterion that is still being answered, or any
  other*, with a fixed 25 (past the old cap) and every row kept.
- `tests/referee-routes-postgres.test.ts`: C5's four full-list cases. Rewritten (below).
- **Mentions, not breakage.** Mirror has its own `MAX_CRITERIA = 24` in `src/referee-mirror.ts` (how
  many criteria go into one prompt) and already says how many it left out (`criteriaOmitted`,
  `MirrorPanel.tsx`). Past 24 was nearly unreachable under a cap of 20 and is ordinary now; noted in
  referee-mode.md. Which 24 it sends (the first in the list it is handed) is unchanged and not
  examined here. Nothing in the panel, export, public reader or a counter displays or assumes 20
  (`grep -rn MAX_CRITERIA src`, and "twenty" / "20" near "criteri" in src and docs/project).
- The investigations under `docs/investigations/` that cite `MAX_CRITERIA` (20) are dated records
  and are left as written.

## Tests

`tests/referee-routes-postgres.test.ts`, through the route against Postgres:

| Case | Old store | New |
|---|---|---|
| adds past the old cap of twenty and keeps every criterion, the commented oldest included (was *OPEN QUESTION 3a*) | red, the 409 | green |
| drops nothing when nothing has comments either | red, the oldest trimmed | green |
| accepts the two-hundredth, refuses the next with a sentence, and lets a failed one run again (199 includes a pending, a failed and a commented one; refused twice with every column of every row unchanged; delete one and the add goes through; the pending one still lands its answer) | red | green |
| lets one of several simultaneous adds at 199 through, and refuses the rest (four adds through the route at once) | red | green |
| counts this article's criteria and nobody else's (another article of the reader's and another owner's article, each holding a criterion under the same id; untouched by the refusal; the other article still adds) | red | green |

The other owner is a random uuid seeded through `seedAuthUser` for the length of the case and
deleted after it, so `OWNER_AUDIT` has nothing to account for.

## Evidence

Red first: the new cases run against `origin/dev`'s three source files (with a stand-in export for
the new constant so the file loads): **5 failed, 15 passed**. Against this change: **20 passed**.

| Mutation | Went red |
|---|---|
| `lockArticleRow` removed from `begin` | *simultaneous adds at 199*, 3 runs of 3 (more than one add got through) |
| ceiling off by one (`>= MAX_CRITERIA + 1`) | *the two-hundredth…*, *simultaneous adds*, *nobody else's* |
| count not scoped to the article | *nobody else's* |

**The concurrent case is as far as a test can go**: four requests at once on a pool of five, with no
hook to force the interleaving. Its red under the lockless mutation was 3 of 3, so it does exercise
the race, but a green run is evidence, not proof; the lock is the proof.

## Review status

Not yet reviewed by GPT Sol. The orchestrator runs that before anything is pushed.
