CREATE TABLE "spideryarn"."article_revision_parts" (
	"revision_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"url" text NOT NULL,
	"raw_source_sha256" text NOT NULL,
	"raw_source_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_revision_parts_revision_id_ordinal_pk" PRIMARY KEY("revision_id","ordinal"),
	CONSTRAINT "article_revision_parts_ordinal" CHECK ("spideryarn"."article_revision_parts"."ordinal" >= 1),
	CONSTRAINT "article_revision_parts_kind" CHECK ("spideryarn"."article_revision_parts"."raw_source_kind" = 'html'),
	CONSTRAINT "article_revision_parts_url" CHECK ("spideryarn"."article_revision_parts"."url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revision_parts" ADD CONSTRAINT "article_revision_parts_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "spideryarn"."article_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revision_parts" ADD CONSTRAINT "article_revision_parts_raw_source_fk" FOREIGN KEY ("raw_source_sha256","raw_source_kind") REFERENCES "spideryarn"."raw_sources"("sha256","kind") ON DELETE no action ON UPDATE no action;