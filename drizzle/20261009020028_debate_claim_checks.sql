-- Debate's reader-picked claim checks: one row per press of Check or Dig
-- further in Debate's Claims, holding what was searched for and what the
-- search found — docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3.
--
-- Additive: one new table, its index and its keys. No existing table, column,
-- constraint or row is touched. src/db/schema.ts § `debateClaimChecks` says
-- what each column is for.
--
-- `debate_claim_checks_one_pending` is the partial unique index the route's
-- reservation leans on: at most one `pending` check per article, so two
-- presses at once get one search and one 409.
--
-- The app role reads and writes it through the default privileges
-- docs/project/database.md § Roles sets on the `spideryarn` schema; nothing is
-- granted here.
--
-- The `auth.users` foreign key is appended by hand at the bottom, as
-- `referee_claims_owner_fk` is, and for the same reason.
CREATE TABLE "spideryarn"."debate_claim_checks" (
	"article_id" uuid NOT NULL,
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" text NOT NULL,
	"attempt_id" text,
	"list_source_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"dig_further" boolean DEFAULT false NOT NULL,
	"targets" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb,
	"web_searches" integer,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "debate_claim_checks_article_id_id_pk" PRIMARY KEY("article_id","id"),
	CONSTRAINT "debate_claim_checks_id_format" CHECK ("spideryarn"."debate_claim_checks"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "debate_claim_checks_status" CHECK ("spideryarn"."debate_claim_checks"."status" in ('pending','done','error')),
	CONSTRAINT "debate_claim_checks_attempt_while_pending" CHECK (("spideryarn"."debate_claim_checks"."status" = 'pending') = ("spideryarn"."debate_claim_checks"."attempt_id" is not null)),
	CONSTRAINT "debate_claim_checks_results_only_done" CHECK ("spideryarn"."debate_claim_checks"."status" = 'done' or jsonb_array_length("spideryarn"."debate_claim_checks"."results") = 0)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."debate_claim_checks" ADD CONSTRAINT "debate_claim_checks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "debate_claim_checks_one_pending" ON "spideryarn"."debate_claim_checks" USING btree ("article_id") WHERE "spideryarn"."debate_claim_checks"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "spideryarn"."debate_claim_checks"
  ADD CONSTRAINT "debate_claim_checks_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
