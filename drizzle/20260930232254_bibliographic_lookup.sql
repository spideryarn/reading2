CREATE TABLE "spideryarn"."bibliographic_records" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text,
	"source" text,
	"title" text,
	"authors_family" text[],
	"authors_given" text[],
	"year" integer,
	"venue" text,
	"doi" text,
	"fetched_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	CONSTRAINT "bibliographic_records_id" CHECK (length("spideryarn"."bibliographic_records"."id") <= 300 and "spideryarn"."bibliographic_records"."id" = lower("spideryarn"."bibliographic_records"."id") and (
            "spideryarn"."bibliographic_records"."id" ~ '^doi:10[.][0-9]{4,9}/[^[:space:]"''<>?#]+$'
            or "spideryarn"."bibliographic_records"."id" ~ '^arxiv:([0-9]{4}[.][0-9]{4,5}|[a-z-]+([.][a-z]{2})?/[0-9]{7})$'
          )),
	CONSTRAINT "bibliographic_records_state" CHECK ("spideryarn"."bibliographic_records"."state" is null or "spideryarn"."bibliographic_records"."state" in ('found', 'not-found')),
	CONSTRAINT "bibliographic_records_source" CHECK ("spideryarn"."bibliographic_records"."source" is null or "spideryarn"."bibliographic_records"."source" in ('crossref', 'datacite')),
	CONSTRAINT "bibliographic_records_year" CHECK ("spideryarn"."bibliographic_records"."year" is null or "spideryarn"."bibliographic_records"."year" between 1500 and 2100),
	CONSTRAINT "bibliographic_records_authors" CHECK (coalesce(cardinality("spideryarn"."bibliographic_records"."authors_family"), -1) = coalesce(cardinality("spideryarn"."bibliographic_records"."authors_given"), -1)
          and coalesce(cardinality("spideryarn"."bibliographic_records"."authors_family"), 0) <= 100
          and array_position("spideryarn"."bibliographic_records"."authors_family", null) is null),
	CONSTRAINT "bibliographic_records_shape" CHECK (case
            when "spideryarn"."bibliographic_records"."state" = 'found' then "spideryarn"."bibliographic_records"."source" is not null and "spideryarn"."bibliographic_records"."title" is not null
              and length("spideryarn"."bibliographic_records"."title") between 1 and 1000
              and "spideryarn"."bibliographic_records"."authors_family" is not null and "spideryarn"."bibliographic_records"."doi" is not null and "spideryarn"."bibliographic_records"."fetched_at" is not null
            when "spideryarn"."bibliographic_records"."state" = 'not-found' then "spideryarn"."bibliographic_records"."fetched_at" is not null
              and num_nonnulls("spideryarn"."bibliographic_records"."source", "spideryarn"."bibliographic_records"."title", "spideryarn"."bibliographic_records"."authors_family", "spideryarn"."bibliographic_records"."authors_given", "spideryarn"."bibliographic_records"."year", "spideryarn"."bibliographic_records"."venue", "spideryarn"."bibliographic_records"."doi") = 0
            else "spideryarn"."bibliographic_records"."claimed_until" is not null and "spideryarn"."bibliographic_records"."fetched_at" is null
              and num_nonnulls("spideryarn"."bibliographic_records"."source", "spideryarn"."bibliographic_records"."title", "spideryarn"."bibliographic_records"."authors_family", "spideryarn"."bibliographic_records"."authors_given", "spideryarn"."bibliographic_records"."year", "spideryarn"."bibliographic_records"."venue", "spideryarn"."bibliographic_records"."doi") = 0
          end)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."bibliographic_service_slots" (
	"service" text NOT NULL,
	"slot" smallint NOT NULL,
	"lease_until" timestamp with time zone,
	CONSTRAINT "bibliographic_service_slots_service_slot_pk" PRIMARY KEY("service","slot"),
	CONSTRAINT "bibliographic_service_slots_slot" CHECK ("spideryarn"."bibliographic_service_slots"."slot" >= 1)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."bibliographic_services" (
	"service" text PRIMARY KEY NOT NULL,
	"next_start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cooldown_until" timestamp with time zone,
	CONSTRAINT "bibliographic_services_service" CHECK ("spideryarn"."bibliographic_services"."service" in ('crossref', 'datacite'))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_service_slots" ADD CONSTRAINT "bibliographic_service_slots_service_bibliographic_services_service_fk" FOREIGN KEY ("service") REFERENCES "spideryarn"."bibliographic_services"("service") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-added to the generated file: the rows the lookup's politeness runs on.
-- One `bibliographic_services` row per registry, and its in-flight slots —
-- 2 for Crossref (under its x-concurrency-limit of 3), 1 for DataCite.
-- src/store/pg-bibliographic.ts treats a missing row as a bug, not as "busy".
INSERT INTO "spideryarn"."bibliographic_services" ("service") VALUES ('crossref'), ('datacite') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "spideryarn"."bibliographic_service_slots" ("service", "slot") VALUES ('crossref', 1), ('crossref', 2), ('datacite', 1) ON CONFLICT DO NOTHING;
