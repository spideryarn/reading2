CREATE TABLE "spideryarn"."checkpoints" (
	"article_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_article_id_namespace_key_pk" PRIMARY KEY("article_id","namespace","key"),
	CONSTRAINT "checkpoints_namespace" CHECK ("spideryarn"."checkpoints"."namespace" in ('toc-labels','pdf-chunk')),
	CONSTRAINT "checkpoints_key_format" CHECK ("spideryarn"."checkpoints"."key" ~ '^[a-z0-9][a-z0-9_-]{0,127}$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."checkpoints" ADD CONSTRAINT "checkpoints_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkpoints_last_used_at" ON "spideryarn"."checkpoints" USING btree ("last_used_at");