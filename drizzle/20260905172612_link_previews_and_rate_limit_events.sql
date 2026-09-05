-- Two new tables, both additive, neither touching anything that exists.
--
-- `link_previews` is what a page on the far end of one of an article's
-- hyperlinks says about itself — fetched by our server once and cached for
-- everybody. **It is the first ownerless table in this schema**, and that is the
-- decision worth reading before applying this: src/db/schema.ts §
-- `linkPreviews` has the disclosure argument, the three things that had to be
-- true first, and why the sharing is the privacy feature rather than a lapse.
-- The key is `requestTarget(url)` — the WHATWG serialization with the fragment
-- cleared, and deliberately not `urlKey`, which folds `http`/`https`, `www.` and
-- tracking parameters together.
--
-- `claim_id` is the single-flight fencing token. Without one a lease is a lock
-- with no way to tell two holders apart, and a stalled claimant that woke up
-- after its lease could delete its successor's claim. GPT Sol, 2026-09-05.
--
-- `link_previews_shape` enforces the union rather than describing it: an alias
-- has a final target and nothing else, a failure has a reason and no content, a
-- claim has a token and no content. Three code paths write this table and a rule
-- that lives in one of them is not a rule.
--
-- `rate_limit_events` is one row per outbound fetch a reader's pointer caused.
-- Owner-scoped, and it holds no URL, no host and no article — the two tables are
-- kept apart on purpose and must never grow a column that joins them.
--
-- docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
-- § Stage 2. The `auth.users` foreign key on `owner_id` is the next migration,
-- by hand, for the reason src/db/schema.ts's header gives.
CREATE TABLE "spideryarn"."link_previews" (
	"target" text PRIMARY KEY NOT NULL,
	"final_target" text,
	"outcome" text NOT NULL,
	"failure" text,
	"title" text,
	"site_name" text,
	"description" text,
	"first_paragraph" text,
	"words" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "link_previews_outcome" CHECK ("spideryarn"."link_previews"."outcome" in ('pending','ok','transient','permanent','alias')),
	CONSTRAINT "link_previews_shape" CHECK (case "spideryarn"."link_previews"."outcome"
            when 'alias' then "spideryarn"."link_previews"."final_target" is not null and "spideryarn"."link_previews"."failure" is null
                        and "spideryarn"."link_previews"."claim_id" is null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."site_name", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph", "spideryarn"."link_previews"."words") = 0
            when 'ok' then "spideryarn"."link_previews"."final_target" is null and "spideryarn"."link_previews"."failure" is null
                        and "spideryarn"."link_previews"."claim_id" is null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph") > 0
            when 'pending' then "spideryarn"."link_previews"."final_target" is null and "spideryarn"."link_previews"."failure" is null
                        and "spideryarn"."link_previews"."claim_id" is not null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."site_name", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph", "spideryarn"."link_previews"."words") = 0
            else "spideryarn"."link_previews"."final_target" is null and "spideryarn"."link_previews"."failure" is not null
                        and "spideryarn"."link_previews"."claim_id" is null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."site_name", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph", "spideryarn"."link_previews"."words") = 0
          end),
	CONSTRAINT "link_previews_words" CHECK ("spideryarn"."link_previews"."words" is null or "spideryarn"."link_previews"."words" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch'))
);
--> statement-breakpoint
CREATE INDEX "link_previews_expires_at" ON "spideryarn"."link_previews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_events_owner_bucket_started" ON "spideryarn"."rate_limit_events" USING btree ("owner_id","bucket","started_at");