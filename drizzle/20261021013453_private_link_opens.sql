CREATE TABLE "spideryarn"."private_link_openers" (
	"article_id" uuid NOT NULL,
	"reader_id" uuid NOT NULL,
	"opens" integer DEFAULT 1 NOT NULL,
	"first_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_link_openers_article_id_reader_id_pk" PRIMARY KEY("article_id","reader_id"),
	CONSTRAINT "private_link_openers_opens" CHECK ("spideryarn"."private_link_openers"."opens" >= 1)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."private_link_signed_out_opens" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"opens" integer DEFAULT 1 NOT NULL,
	"first_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_link_signed_out_opens_opens" CHECK ("spideryarn"."private_link_signed_out_opens"."opens" >= 1)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."private_link_openers" ADD CONSTRAINT "private_link_openers_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."private_link_signed_out_opens" ADD CONSTRAINT "private_link_signed_out_opens_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The reader key, hand-added rather than declared in src/db/schema.ts for the
-- reason that file's header gives (Drizzle must not learn about `auth.users`).
-- ON DELETE CASCADE, like `article_open_times`: a record that an account opened
-- a private link is worth nothing once the account is gone, and a RESTRICT
-- would stop the account being deleted at all. Not backfilled: nothing was
-- recorded before. docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md.
ALTER TABLE "spideryarn"."private_link_openers"
  ADD CONSTRAINT "private_link_openers_reader_fk"
  FOREIGN KEY ("reader_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
