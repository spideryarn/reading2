CREATE TABLE "spideryarn"."skim_briefs" (
	"article_id" uuid NOT NULL,
	"id" text NOT NULL,
	"brief" text NOT NULL,
	"skim" jsonb,
	"profile_notice_dismissed_for" text,
	"profile_notice_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"planned_at" timestamp with time zone,
	CONSTRAINT "skim_briefs_article_id_id_pk" PRIMARY KEY("article_id","id"),
	CONSTRAINT "skim_briefs_id_format" CHECK ("spideryarn"."skim_briefs"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "skim_briefs_brief_length" CHECK (length(btrim("spideryarn"."skim_briefs"."brief")) > 0 and length("spideryarn"."skim_briefs"."brief") <= 600),
	CONSTRAINT "skim_briefs_planned_both" CHECK (("spideryarn"."skim_briefs"."skim" is null) = ("spideryarn"."skim_briefs"."planned_at" is null))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."skim_briefs" ADD CONSTRAINT "skim_briefs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;