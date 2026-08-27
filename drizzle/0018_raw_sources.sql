CREATE TABLE "spideryarn"."raw_sources" (
	"sha256" text NOT NULL,
	"kind" text NOT NULL,
	"bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_sources_sha256_kind_pk" PRIMARY KEY("sha256","kind"),
	CONSTRAINT "raw_sources_sha256_format" CHECK ("spideryarn"."raw_sources"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "raw_sources_kind" CHECK ("spideryarn"."raw_sources"."kind" in ('pdf','html'))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "raw_source_sha256" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "raw_source_kind" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_raw_source_fk" FOREIGN KEY ("raw_source_sha256","raw_source_kind") REFERENCES "spideryarn"."raw_sources"("sha256","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_raw_source_both" CHECK (("spideryarn"."article_revisions"."raw_source_sha256" is null) = ("spideryarn"."article_revisions"."raw_source_kind" is null));