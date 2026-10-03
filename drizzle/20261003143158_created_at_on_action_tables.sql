-- Hand-edited from what drizzle generated, on purpose. `ADD COLUMN … DEFAULT now()`
-- writes the migration's own time into every existing row: an invented time for
-- an event that happened earlier. So each column is added with no default (every
-- existing row stays null, meaning "before 2026-10-03, when we started keeping
-- it") and only then given the default, which applies to rows written from here on.
-- docs/plans/261003j-store-when-it-happened-timestamp-audit.md § The design.
ALTER TABLE "spideryarn"."citation_finds" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_finds" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_investigations" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_investigations" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_hidden_entries" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_hidden_entries" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."reader_profiles" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."reader_profiles" ALTER COLUMN "created_at" SET DEFAULT now();
