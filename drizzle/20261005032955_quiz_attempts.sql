CREATE TABLE "spideryarn"."quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"batch_id" text NOT NULL,
	"question_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"reply" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempts_answer_length" CHECK (char_length("spideryarn"."quiz_attempts"."answer") between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_attempts_latest" ON "spideryarn"."quiz_attempts" USING btree ("article_id","batch_id","question_id","created_at" DESC NULLS LAST);