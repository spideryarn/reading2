-- Referee mode's Claims run gets a Postgres home.
-- docs/plans/260831an-referee-mode-submodes-review-sol.md, finding 4.
--
-- ## This table was argued against, and the argument that blocked it expired
--
-- Claims shipped on 2026-08-31 with a filesystem store and no Postgres one, and
-- that was a recorded decision rather than an oversight. Two reasons were given.
--
-- The first still stands: a claims run is an article-derived reusable artefact,
-- so its right long-term home is a PIPELINE ARTEFACT -- a `StepName`, an
-- `ArtifactKind` and an `article_revisions` column -- rather than a bespoke
-- table beside `referee_criteria`. This table is therefore an INTERIM, and
-- saying so here is the point of this paragraph.
--
-- The second has expired, and it was the blocking one. `src/store/export.ts`
-- was being rewritten in another session that day, so a new table could only
-- have landed WITHOUT an `ARTICLE_TABLE_COVERAGE` entry -- which is exactly the
-- accident this repo already carries: `referee_criteria` arrived on 2026-08-31,
-- `db:export` had never heard of it, and every criterion a referee had written
-- was dropped from the rollback for a day while the command reported success.
-- That file is committed and stable, so this table lands with its coverage
-- entry AND with a fixture in tests/store-export-covers-tables.test.ts that
-- inserts a row and requires it back out of `referee-claims.json`.
--
-- Against the interim stood a sub-mode that returned 501 for every operation in
-- the only configuration that deploys. `SPIDERYARN_STORE=postgres` is what runs
-- on Vercel, and there "Pull the paper's claims" could not load, start or store
-- a run.
--
-- ## The primary key is `article_id` ALONE, and that is the shape
--
-- `referee_criteria` is keyed `(article_id, id)` because a referee writes
-- several criteria. A referee asks the paper what IT claims exactly once, so
-- there is one run per article: `begin` replaces the row, and there is no minted
-- id, no cap and no three-condition retry rule, because there is nothing to
-- collide with. A surrogate id would permit two runs and then something would
-- have to decide which one the panel shows -- a decision this key removes.
--
-- ## `claims` is JSONB and `claims_omitted` is a column
--
-- `claims` is one model call's wholesale output: written together, replaced
-- together, never edited a row at a time, and never queried across.
-- docs/project/sql.md's default is a column and this is the case that argues
-- itself out. `claims_omitted` is the opposite case -- a fact about the RUN
-- rather than about any claim in it, and it is nullable because "not recorded"
-- and "none were omitted" are different answers: the route stores `claims` and
-- `model` and nothing else today, so a run written before it learns to write
-- this has no answer, and the panel's fallback copy turns on telling that from a
-- truthful zero.
--
-- ## `created_at` is also the sweep's clock, so there is no `attempt_id`
--
-- `referee_criteria` and `search_runs` carry an attempt because a row outlives
-- its attempts and a second server must not kill a call the first one is still
-- streaming. Here a second run IS the row rewritten, so `begin` stamping
-- `created_at` gives the age of the attempt in flight with no second column to
-- disagree with it. `sweep` uses it as the grace window that `RefereeClaimsStore`
-- cannot express, because its signature carries only "is this process running
-- it" -- see src/store/pg-referee-claims.ts § `sweep`.
--
-- The owner key into auth.users is at the bottom of this file rather than in a
-- companion migration, for the reason drizzle/0043 sets out about drift: it is
-- the same drift either way, and one file is one fewer thing to apply out of
-- order. ON DELETE RESTRICT, matching every other owner key.

CREATE TABLE "spideryarn"."referee_claims" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" text NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"claims_omitted" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_hash" text,
	CONSTRAINT "referee_claims_status" CHECK ("spideryarn"."referee_claims"."status" in ('pending','done','error'))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_claims" ADD CONSTRAINT "referee_claims_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_claims" ADD CONSTRAINT "referee_claims_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
