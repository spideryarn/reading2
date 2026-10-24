CREATE TABLE "spideryarn"."author_lookup_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lookup_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"address" text NOT NULL,
	"kind" text NOT NULL,
	"confidence" text NOT NULL,
	"why" text NOT NULL,
	"source_url" text,
	"pattern_seen" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_lookup_candidates_position_range" CHECK ("spideryarn"."author_lookup_candidates"."position" >= 0),
	CONSTRAINT "author_lookup_candidates_kind" CHECK ("spideryarn"."author_lookup_candidates"."kind" in ('on-page', 'on-page-disguised', 'in-result', 'guess')),
	CONSTRAINT "author_lookup_candidates_confidence" CHECK ("spideryarn"."author_lookup_candidates"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "author_lookup_candidates_guess_not_high" CHECK ("spideryarn"."author_lookup_candidates"."kind" <> 'guess' or "spideryarn"."author_lookup_candidates"."confidence" <> 'high'),
	CONSTRAINT "author_lookup_candidates_pattern_only_guess" CHECK (("spideryarn"."author_lookup_candidates"."pattern_seen" is not null) = ("spideryarn"."author_lookup_candidates"."kind" = 'guess')),
	CONSTRAINT "author_lookup_candidates_confidence_for_kind" CHECK (("spideryarn"."author_lookup_candidates"."kind" in ('on-page', 'on-page-disguised') and "spideryarn"."author_lookup_candidates"."confidence" in ('high', 'medium'))
          or ("spideryarn"."author_lookup_candidates"."kind" = 'in-result' and "spideryarn"."author_lookup_candidates"."confidence" = 'medium')
          or ("spideryarn"."author_lookup_candidates"."kind" = 'guess' and (("spideryarn"."author_lookup_candidates"."pattern_seen" and "spideryarn"."author_lookup_candidates"."confidence" = 'medium')
              or (not "spideryarn"."author_lookup_candidates"."pattern_seen" and "spideryarn"."author_lookup_candidates"."confidence" = 'low')))),
	CONSTRAINT "author_lookup_candidates_source_for_kind" CHECK (("spideryarn"."author_lookup_candidates"."kind" = 'guess' or "spideryarn"."author_lookup_candidates"."source_url" is not null)
          and ("spideryarn"."author_lookup_candidates"."pattern_seen" is distinct from true or "spideryarn"."author_lookup_candidates"."source_url" is not null)),
	CONSTRAINT "author_lookup_candidates_address_normalised" CHECK ("spideryarn"."author_lookup_candidates"."address" = lower(btrim("spideryarn"."author_lookup_candidates"."address")) and "spideryarn"."author_lookup_candidates"."address" like '%_@_%'),
	CONSTRAINT "author_lookup_candidates_text_lengths" CHECK (char_length("spideryarn"."author_lookup_candidates"."address") <= 10000 and char_length("spideryarn"."author_lookup_candidates"."why") <= 10000
          and coalesce(char_length("spideryarn"."author_lookup_candidates"."source_url"), 0) <= 10000)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookup_candidates" ADD CONSTRAINT "author_lookup_candidates_lookup_id_author_lookups_id_fk" FOREIGN KEY ("lookup_id") REFERENCES "spideryarn"."author_lookups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "author_lookup_candidates_position" ON "spideryarn"."author_lookup_candidates" USING btree ("lookup_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "author_lookup_candidates_address" ON "spideryarn"."author_lookup_candidates" USING btree ("lookup_id","address");
