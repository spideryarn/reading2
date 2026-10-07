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
  criteria and, at 200 or more, throws `criterionRefusal(409, criteriaAtCeiling(n))` from inside
  the transaction, so nothing is inserted. The route answers before any stream opens, as C5's
  refusal did. `n` is the real count, so a list inherited above 200 is told the truth (Review
  status, C2).
- **What it counts: every row on the article.** Pending, failed, with comments or without;
  raw `count(*)`, not the loaded list. Current database constraints make every config readable.
  A row written outside those constraints would count without being shown, so the sentence's
  way out cannot be promised for such a database. A visible criterion with comments requires its
  placements to be cleared before it can be deleted. The counting rule is the builder's choice.
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
- **The client.** The pre-stream failure keeps the typed criterion on screen with Retry and
  the server's sentence. Review reproduced loss on reload and added
  `src/web/criterion-refusal-drafts.ts`: ceiling refusals are retained in this tab's session
  storage, keyed by reader and article, until acceptance (`begin`) or explicit deletion. Nothing
  is automatically re-submitted. If storage is unavailable the hook still keeps the row while
  mounted. `tests/use-criteria-refusals.test.tsx` pins reload, retry, owner/article separation and
  draft consumption. This implementation is the reviewer's, not a further product-owner decision.
  The client recognises the refusal at any count with `isCriteriaAtCeiling`, which reads the
  number back out of the sentence and rebuilds it, so there is still one definition of the words.

## The simpler option passed over

**Keep the trim and exempt commented criteria from it**, which was the first brief and was half
built (a `for update` on the candidates, then a `not exists (comment)` delete). It was dropped when
Greg answered the cap question: it still deleted criteria without comments silently, and it needed
the lock-then-check dance to survive a placement moved onto a candidate mid-transaction. A ceiling
that refuses deletes nothing, so it has no race with comments at all.

**No ceiling at all** was not offered: a bound on a table a script could otherwise fill is worth
one sentence.

## New reader-facing wording, for Greg to veto

`criteriaAtCeiling(n)`, in `src/referee-criteria-store.ts`, with the ceiling spelled from the
constant and `n` the article's real count. Two forms. At exactly 200 (`CRITERIA_AT_CEILING`), which
is every refusal a list built since 2026-10-07 can get:

> This article already has 200 criteria, which is as many as it can hold. Delete one to add another.

Above 200, only for a list inherited from the old trim (for 201, 202, …):

> This article already has 201 criteria, and it can hold 200. Delete 2 to add another.

`Delete {n − 199}` is how many deletes leave 199, so the next add makes 200.

The orchestrator's proposed wording, kept as given; the second form is the orchestrator's
correction after review C2, the first form's words otherwise unchanged. **One reachable case where "Delete one" is not
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
| tells an inherited list above the ceiling its real count, and how many to delete (202 seeded directly; the 202 and 201 sentences, then the 200 one, then the add goes through after the three deletes the first sentence asked for) — added after review C2 | — | green |

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

GPT Sol code review of `a95dae313`, write-capable:
[prompt](261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead-code-review-prompt.md),
[answer](261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead-code-review-sol.md).
**Verdict: "do not ship yet", on C2 only.** C2 is now fixed, below.

| | Finding | What happened |
|---|---|---|
| C1 | P0. A criterion refused at the ceiling stayed on screen, but its words and poles vanished on reload or a mode change: the server never stored it and the hook dropped it on unmount. | **Fixed by Sol**: `src/web/criterion-refusal-drafts.ts`, session storage keyed by reader and article, cleared on `begin` or an explicit delete, never re-sent by itself. Checked on landing: with `useCriteria.ts` hand-reverted, **3 failed, 17 passed** in `tests/use-criteria-refusals.test.tsx`; restored, all pass. No existing client mechanism does this (`chat-draft.ts` and `search-draft.ts` are in memory by design; there is no autosave helper), so the module stays. Added on landing: a case with `window.sessionStorage` throwing, red with the module's `try/catch` removed, green with it. [Postmortem](../postmortems/261007f-a-refused-row-on-screen-is-not-a-saved-draft.md). |
| C2 | P1. A list already above 200 (reachable before 2026-10-07: the old trim spared pending rows) was told "already has 200 … Delete one", false twice. | **Fixed** (orchestrator's decision): `criteriaAtCeiling(n)` names the real count and `n − 199` deletes; at 200 the words are unchanged. Both forms are under *New reader-facing wording* above. Sol's characterisation test was turned into the assertion and was red first against Postgres (*Received: "This article already has 200 criteria, which is as many…"*). A hook case pins that the above-200 refusal is kept as a draft too, red first. Production's largest list was 4, so no reader is known to be in this state. |
| C3 | P2. If every criterion has comments placed on it, "Delete one" omits that the placements must be cleared first. | **Left.** The delete's own refusal (`CRITERION_HAS_COMMENTS`) then says so; one step short rather than false. |
| C4 | P2. Mirror sends the **oldest** 24 criteria by `(created_at, id)` when there are more, and says how many it left out but not which. | **Left**, reported, not changed. |
| C5 | P3. Comments and docs claimed every counted row is visible and deletable. | **Fixed by Sol**; checked against `referee_criteria_kind` and `referee_criteria_diverging_shape`, which do make every config `configFromRow` reads valid. Greg's two quotes in referee-mode.md are byte-for-byte as committed in `a95dae313`. |

**Postgres, run for real on landing** (Sol's sandbox had no database): Sol's characterisation as
written passed (21 of 21 in `tests/referee-routes-postgres.test.ts`, asserting the false sentence);
rewritten for C2 it went red (1 failed), then green with the fix. Final gates before landing:
typecheck 4 projects, all 3,374 files covered; `tests/referee-*` **35 files, 627 passed**;
`referee-routes-postgres`, `store-parity-referee`, `db-referee-criteria`,
`store-migration-registry`, `doc-links` and `use-criteria-refusals` **6 files, 97 passed**, none
skipped; Biome on the touched files, 1 info (the existing complexity advisory on `send`).

The concurrent-add case can pass a lockless implementation when requests happen to serialise; its
mutation reds are evidence rather than proof. The article lock and the sole insert path are the
ordering argument.
