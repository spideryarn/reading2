# Referee answers are not lost or overwritten (sweep 5, cluster 6a)

Cluster **6a** of the fifth codebase sweep —
[261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md), § The
clusters. Three defects in Referee mode's two stores, each a way for an answer the reader paid for
to disappear or be mislabelled. One stage; it is small.

Evidence: D1 in
[data-and-pipeline](../investigations/261003b-fifth-sweep-data-and-pipeline.md), X4 in
[cross-zone leads](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md),
and the fingerprint finding in
[Sol's review](../investigations/261003b-fifth-sweep-review-sol-on-knowledge-and-cross-zone.md)
(“Missed”, item 2). All three were re-checked against today's tree (`3c6ab877f` + dev) and hold.

## The three defects

**1. History trimming can delete a criterion that is still being answered (D1).** A referee keeps
at most 20 criteria per article. When a new one is begun, `begin` in
`src/store/pg-referee-criteria.ts` deletes the oldest rows past the cap — and its SQL does not look
at `status`. A retried criterion keeps its original `created_at`, so it can be the oldest row while
it is `pending`. Begin one more criterion in the meantime and the retry's row is deleted; its
`finish` then updates nothing, no `done` frame is sent, and the answer is gone on reload. Search had
this exact bug and fixed it on 2026-10-01 (`e630f17a4`); the Referee copy kept the old behaviour.

**2. With two tabs, a stale Claims answer overwrites the newer one (X4).** There is one Claims run
per article. `finish` in `src/store/pg-referee-claims.ts` updates `where article_id = …` and nothing
else. Tab A starts a run; tab B starts another (the row is reset to `pending`, re-stamped); A's model
call finishes first and writes its claims and `status: done` over B's row; B then writes over that.
In between, a reader sees A's answer under B's date and fingerprint. The comment defending this
cites parity with the filesystem store, which was deleted on 2026-09-05.

**3. Claims fingerprints input it may not have sent.** `runRefereeClaims` loads the article's blocks,
*then* calls `begin`, which fingerprints whatever the current revision is at that moment. If the
article is re-extracted between the two, the model is sent the old blocks and the row says it was
answered against the new ones — so a stale answer is shown as current. This needs only one tab.

## The fixes

1. **Trim.** Copy Search's shape into `pg-referee-criteria.ts`: select `status` with the candidates,
   skip `pending`, and repeat `status <> 'pending'` in the `DELETE`. The cap becomes "20, plus
   however many older criteria are still running", as it is for Search.

   And delete the pure trim. `withCriterion` and `withRun` each return a trimmed list
   (`criteria` / `runs`) that only their tests read — the Postgres stores take `row`/`run` and
   `kind` and do their own trim in SQL. A second implementation of the trim that production never
   runs is how this drifted: `withRun`'s got the pending rule, `withCriterion`'s did not, and
   neither mattered. So both functions lose the list from their return, `trimRuns` goes, and the
   pure tests that chained on the list build their inputs directly. The trim is tested where it
   runs, against Postgres.

2. **Claims attempt fence.** What Criteria has, minus what Claims does not need:

   - one additive migration: `ALTER TABLE spideryarn.referee_claims ADD COLUMN attempt_id text` —
     nullable, no default, no backfill, no constraint;
   - `begin` mints a token, stores it, and returns `{ run, attempt }`;
   - `finish(slug, patch, attempt)` takes it as a **required** argument and updates only
     `where article_id = … and status = 'pending' and attempt_id = …`, clearing the token;
   - `sweep` clears the token when it fails an abandoned run.

   No `attempt_started_at`: `created_at` is already this table's sweep clock, re-stamped by every
   `begin`. So tab A's late `finish` matches nothing and returns `null`; the handler already treats
   `null` as "say nothing", so A's stream ends without a `done` frame and B's answer stands.

3. **Fingerprint what was sent.** `begin(slug, sourceHash)` takes the fingerprint from the caller
   instead of reading the revision itself. The handler passes `hashBlocks(article.blocks)` — the
   hash of the blocks it is about to hand the model. `hashBlocks` over loaded blocks and
   `sourceHashFor` over `revision_blocks` are the same function over the same four fields; a test
   holds that they agree (the positive control — without it, a mismatch would mark every run stale
   and read as a fact about the article).

## What was passed over

- **A CHECK that a `pending` claims row has an attempt.** Criteria has the pair-check because it has
  two columns. Here it would refuse a `begin` from the old code during the minutes between the
  migration and the deploy, and buys nothing the `finish` predicate does not already enforce.
- **Refusing a second Claims run while one is pending** (a 409 for tab B). It would save a paid
  call, but it changes what the reader sees and needs the marker-lifetime work that is cluster 6b's.
  Not here.
- **A shared "attempt fence" helper across Search, Criteria and Claims.** The umbrella says no
  generic registry; three short predicates are easier to read than one abstraction.
- **Making the fingerprint fix for Criteria and Search too.** `runRefereeCriterion` and `search`
  have the same load-then-begin order, so the same mislabel is reachable there. The cluster's scope
  is Claims; this is reported to the Overseer as a follow-up rather than widened into here.
- **Keeping the pure trim and fixing it.** Simpler in the diff, but it leaves two trims, one of
  which nothing runs.

## Deploy order, and the one window that stays open

Migration first is schema-safe: the old code never names `attempt_id`, and the column is nullable.

**It is not write-safe across the deploy, and that is accepted.** Requests already running on the
old build keep running after the new one is live, for up to the Claims deadline
(`CLAIMS_TIMEOUT_MS`, a little under nine minutes). So this schedule is still open, once, for that
long: old-build A begins; the deploy lands; new-build B begins and finishes; old-build A finishes —
and the old `finish`, which updates by article id alone, writes A's answer over B's. It is the bug
this plan fixes, surviving for one deploy window. It needs one reader with two tabs running Claims
on the same article across the deploy; what is lost is one valid answer about the same paper,
rebuilt with one press. Nothing else gets worse in the mixed orders: an old `begin` leaves a newer
token in place and an old `finish` leaves a stale token on a finished row, and both are harmless
because the new `finish` also requires `pending` and the next `begin` rewrites the token.

Sol graded this P0 (PR-3) and asked for a drained or two-phase rollout, or a trigger refusing legacy
writes. **Overruled, after Opus arbitrated**: a trigger or a second phase is a second migration and
machinery to remove later, which is more risk to production than the window it closes. The only
free mitigation is to deploy when no `referee_claims` row is `pending`; not worth gating on.

## Tests, red first

- `tests/db-referee-criteria.test.ts` or the Postgres parity file: 20 criteria, the oldest failed
  and retried (so `pending`, oldest), begin a 21st → the retry's row is still there and its
  `finish` returns the row. Red today.
- `tests/store-pg-referee-claims.test.ts`: begin A, begin B, `finish` with A's token → `null`, row
  still `pending`; `finish` with B's token → `done`. A `finish` on a row that is already `done`
  writes nothing. Red today (A's finish wins).
- Same file: `begin(slug, "an-older-hash")` stores that hash, not the current revision's; and
  `hashBlocks(loadArticle(slug).blocks)` equals `store.sourceHash(slug)`.
- `tests/referee-routes-postgres.test.ts`: through the route, with a second run begun (and, in a
  second case, finished) while the first is at the model — the older stream ends with
  `CLAIMS_SUPERSEDED`, or with the newer run's stored answer, and the row is the newer run's.
- `tests/referee-claims-routes.test.ts`: `hashBlocks(loadArticle(slug).blocks)` equals the store's
  `sourceHash(slug)` — the positive control.
- A type-level change does the rest: every caller of `finish` without a token fails `typecheck`.

How red each was: the trim test failed on the missing row. The Claims store tests were written
against the new signatures, so against the old code they failed for the cheaper reason that the
old `begin` returned no token; the real evidence is a mutation — with `attempt_id = …` taken out of
`finish`'s predicate, the store's two-tab test and the route's go red, and green again with it back.

## Done means

`npm test` and `npm run typecheck` green, Sol's code review read and its findings settled, the
umbrella's 6a row updated with the commit.

## Reviews

**Plan, round 1 — [GPT Sol](261003h-referee-answers-are-not-lost-or-overwritten-review-1-sol.md):
NOT READY, six findings.** It confirmed the trim fix, that deleting the list returns is safe, that
`hashBlocks` over loaded blocks equals `sourceHashFor` for one revision, and that the bundle export
carries the new column by itself (`rowJson` over the whole row, as it does for the sibling tables'
tokens; the rollback export projects the run and leaves the token out, as it does for them).

- **PR-1 (P1), taken.** The older tab's stream ended with no `done`, so the panel said *"The claims
  stopped arriving. Try again."* — blaming the connection. The handler now looks at what is there
  when its own `finish` is refused: a finished row (the newer run's answer, or the sweep's error) is
  sent as `done`, because it is the truth; a row still `pending` gets `done` carrying
  `CLAIMS_SUPERSEDED`, a sentence that is never stored. Server-side only, so `useClaims.ts` is
  untouched. Sol asked for the client to follow the newer run; it cannot follow another tab's
  stream, and polling for it is new machinery for a two-tab case.
- **PR-2 (P1), not taken here, reported.** The live panel treats the `begin` frame's hash as the
  article's current one and never refreshes it, so a re-extraction during a run shows no *older
  version* mark until the next GET. True — and true before this change, for the whole length of the
  model call rather than the milliseconds this fix is about, and equally of Criteria and Search.
  What this plan changes is that the stored row is now right, so the next GET does show it. The
  client fix is in `src/web/useClaims.ts`, outside this cluster's files; passed to the Overseer.
- **PR-3 (P0), overruled** — § Deploy order above.
- **PR-4 (P2), taken, by type.** `ClaimsFinish` in `contracts.ts` makes `status: "pending"` a
  compile error, where Criteria refuses it at run time.
- **PR-5, PR-6 (P2), taken.** The migration is `schema.ts` + `npm run db:generate` (SQL, snapshot,
  journal). The parity walk's last step now begins a third run before failing it, since a swept
  run can no longer be finished.

**Code, round 1 — [GPT Sol](261003h-referee-answers-are-not-lost-or-overwritten-review-2-sol-code.md):
READY WITH THESE FIXES**, on commit `80ace2976`. No shape mismatch found in callers, exports,
bundles, admin or cost paths; the single upsert needs no article lock.

- **CR-1 (P1), fixed by Sol, checked and kept.** The superseded branch handed the older tab the
  newer run's finished answer even when that run was about a *different revision* — claims whose
  citations the tab's prose could not resolve. It now does so only when the fingerprints match;
  otherwise the tab gets `CLAIMS_SUPERSEDED` and no claims. Sol's test reproduced it red; I ran the
  Postgres file green (8 of 8), which Sol's sandbox could not.
- **CR-2 (P2), reported, not taken.** `ClaimsPanel.tsx` shows *Try again* beside the reload
  sentence, and pressing it supersedes the newer run. A client change outside this cluster's files;
  passed to the Overseer with PR-2.
- **CR-3 (P3), taken.** `lockArticleRow`'s comment in `src/store/pg.ts` still listed Claims among
  the stores holding the article lock. One comment, outside the cluster's file set, corrected
  because this change is what made it false.

One round, no open P0 or P1, so discovery closed there.

## What landed

Commit `80ace2976`, plus Sol's CR-1 fix and the CR-3 comment in the commit after it.

- `src/store/pg-referee-criteria.ts` — the trim skips `pending` rows, in the select and again in
  the `DELETE`.
- `src/store/pg-referee-claims.ts`, `src/store/contracts.ts`, `src/db/schema.ts` — `attempt_id`;
  `begin(slug, sourceHash)` returns `{ run, attempt }`; `finish(slug, patch, attempt)` lands only on
  the `pending` row carrying the token; `ClaimsFinish` forbids ending on `pending`; the sweep clears
  the token. `begin` is one upsert and no longer takes the article lock.
- `src/routes.ts` — `runRefereeClaims` passes `hashBlocks(article.blocks)` and the token, and a
  refused `finish` ends the stream with the truth (`CLAIMS_SUPERSEDED`, or the newer run's answer
  when it is about the same blocks).
- `src/searches.ts`, `src/referee-criteria-store.ts` — `withRun` and `withCriterion` return the row
  and its kind; the list and `trimRuns` are gone.
- **Migration `20261003114243_referee_claims_attempt`** — one statement:
  `ALTER TABLE "spideryarn"."referee_claims" ADD COLUMN "attempt_id" text;`. Nullable, no default,
  no backfill, no constraint, no index. Generated by `npm run db:generate` with its snapshot and
  journal entry. **Not applied to the shared local database or to production from this worktree**:
  the suite runs in a private database built from `drizzle/`, and production gets it from the
  Overseer's deploy.

Not done here, and handed on: the live panel's stale mark (PR-2) and its *Try again* beside the
reload sentence (CR-2), both in `src/web/`; and the same load-then-begin fingerprint order in
`runRefereeCriterion` and `search`.
