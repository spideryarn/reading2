CREATE TABLE "spideryarn"."command_suggestion_dismissals" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"read_from" text NOT NULL,
	"dismissed" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_suggestion_dismissals_read_from" CHECK ("spideryarn"."command_suggestion_dismissals"."read_from" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "command_suggestion_dismissals_dismissed" CHECK (cardinality("spideryarn"."command_suggestion_dismissals"."dismissed") between 1 and 50 and array_ndims("spideryarn"."command_suggestion_dismissals"."dismissed") = 1 and array_position("spideryarn"."command_suggestion_dismissals"."dismissed", null) is null and array_to_string("spideryarn"."command_suggestion_dismissals"."dismissed", '') ~ '^[0-9a-f]+$' and array_to_string("spideryarn"."command_suggestion_dismissals"."dismissed", chr(10)) ~ '^[0-9a-f]{16}(\n[0-9a-f]{16})*$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."command_suggestion_dismissals" ADD CONSTRAINT "command_suggestion_dismissals_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;