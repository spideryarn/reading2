# Referee mode on the database, and the parity that would have caught it

**Status**: written 2026-09-01, after Greg asked for the filesystem to stop being where anything
lives. Stage 1 was already in flight when this was written; stages 2 and 3 are new.

**The bigger move is not this plan.** [260831b-finish-the-database-move.md](260831b-finish-the-database-move.md)
owns it, is well advanced, and belongs to another session. This plan is only the part that is
Referee-shaped, and it exists because that plan does not mention Referee's stores at all — the word
appears in it zero times.

## What Greg asked for

> Make sure we're using the Supabase database (or Supabase Storage) instead of the filesystem. If
> that requires extra stages, do it.
>
> — Greg, 2026-09-01

And, approving the note now at the top of [AGENTS.md](../../AGENTS.md) § *Writing code*:

> we're moving from filesystem -> database (in progress, hopefully finished soon), so all new
> features should use the database, and that includes local dev.

## What was already true, and what was not

**Production has been on Supabase since 2026-08-27.** `DATABASE_URL` is set on Production against
the transaction pooler on 6543, `SPIDERYARN_STORE=postgres` with it, and article sources and images
are in Supabase Storage buckets ([deployment.md](../project/deployment.md)). So the question was
never *whether* production uses the database.

**The filesystem is the local default.** `SPIDERYARN_STORE` unset means `files`
([`src/store/live.ts`](../../src/store/live.ts)). That is the whole of the problem below.

**Claims shipped filesystem-only and returned 501 in production.** Every test passed, because every
test ran on the default. A cross-family review found it, not the suite —
[260831an-referee-mode-submodes-review-sol.md](260831an-referee-mode-submodes-review-sol.md),
finding 4. The postmortem is
[260901e](../postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md).

**Nothing holds Referee's two store implementations to agreeing.**
[`tests/store-parity.test.ts`](../../tests/store-parity.test.ts) calls itself *"the test the whole
migration rests on"*, covers comments, chat, searches and identities, and contains the string
`referee` zero times. Criteria has had two implementations since 2026-08-31 and nothing has ever
compared them.

## The stages

- **Stage 1 — Claims gets a Postgres store.** Migration `0051`, `src/store/pg-referee-claims.ts`
  modelled on `pg-referee-criteria.ts` with every read and write through `ownedSlug`, the
  `ARTICLE_TABLE_COVERAGE` entry, and the `notMigrated` refusal removed. *In flight when this plan
  was written.* The recorded reason for the refusal — that `src/store/export.ts` was being rewritten,
  so a table could only land without export coverage — had expired; the reason stays in the docstring,
  amended to say when and why it changed.

- **Stage 2 — the parity that would have caught it.** A new
  `tests/store-parity-referee.test.ts` rather than an edit to `store-parity.test.ts`, which carries
  another session's in-flight work. Both Referee stores, both implementations, the same questions,
  the same answers — compared as the **API-shaped result** and not as SQL rows, which is the
  distinction the existing parity suite exists to make. It must be seen to fail: a parity test whose
  two sides are never actually different is the same theatre this mode has already shipped three
  times.

- **Stage 3 — the Referee suites run against Postgres.** Not only the stores: the routes. The 501
  was reachable through `POST /api/referee/claims/:slug` and no route test noticed, because route
  tests run on the default too. Decide and record whether the Referee route suites pin
  `SPIDERYARN_STORE=postgres`, run both, or something else — and make the choice visible rather than
  inherited.

## What was built, 2026-09-01

- **Stage 2** — [`tests/store-parity-referee.test.ts`](../../tests/store-parity-referee.test.ts).
  Both stores, the same script, compared as the wire form step by step. Two differences are asserted
  **positively** rather than normalised away: a slug that is not an article (files answer `[]`/`null`,
  Postgres 404s through `ownedSlug`) and a *young* abandoned claims run (files sweep it at once,
  Postgres waits `CLAIMS_ORPHAN_GRACE_MS`). It was watched failing on a clamped valence, a dropped
  `claimsOmitted`, a `null` where the other store answers a row, and a Postgres store that had lost
  its grace window.

- **Stage 3 — a separate suite, [`tests/referee-routes-postgres.test.ts`](../../tests/referee-routes-postgres.test.ts),
  and its header carries the argument.** Pinning the existing route suites would have cost
  `referee-claims-routes.test.ts` the property its own header calls load-bearing — nothing in it
  reaches a model — because those files build `data/<slug>/` fixtures and read the result back
  through the *filesystem* functions, so pinning means rewriting every fixture in two files several
  sessions are inside. Running them twice cannot be done in one process at all: `STORE` is read once
  at module load, deliberately, so "twice" means a second vitest project. The separate suite leaves
  the existing ones alone and owns one sentence: *these routes work under Postgres*. Its cost is
  written down too — the route logic is asserted on files and the store wiring here, so a new guard
  needs a case in both.

- **The class-level fix the postmortem asked for** —
  [`tests/store-seams-have-two-implementations.test.ts`](../../tests/store-seams-have-two-implementations.test.ts).
  Seams derived from `contracts.ts`, implementations derived from the source of `src/store/`,
  neither written down. A deliberate one-sided seam declares itself in `SEAM_ASYMMETRIES`
  ([`src/store/live.ts`](../../src/store/live.ts)), whose type makes the two directions different
  things: a missing *files* side needs a reason (there is no user list on a filesystem), a missing
  *postgres* side needs a reason **and** a sentence saying what a reader cannot do on the deployed
  app — the sentence nobody would have written about *"Pull the paper's claims"*. Today it holds
  four entries: `AdminStore`, `VisibilityStore`, `FeedbackStore`, and `GlossaryStore`, which is the
  one live example of the direction that ships outages.

## What this plan is deliberately not doing

**Flipping the local default to `postgres`.** That is the hinge in the middle of stage 4 of
[260831b](260831b-finish-the-database-move.md), it belongs to the session that owns that plan, and
moving it from underneath them would collide badly. The AGENTS.md note tells agents to set the flag
themselves in the meantime, which gets the benefit without the collision.

**Anything about the pipeline, the artefact layer or the test conversion.** Same reason.

## The simpler option passed over

**Leaving Claims filesystem-only and documenting it as local-only**, which is what Sol offered as the
alternative to building the table. Rejected: a sub-mode that does not run where it runs is not
built, and the reason it was filesystem-only in the first place — the export guard — had already
gone away. Writing "local-only" into the doc would have been recording a limitation instead of
removing one.
