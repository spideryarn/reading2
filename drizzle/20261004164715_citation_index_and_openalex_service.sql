CREATE TABLE "spideryarn"."citation_index_citers" (
	"work_id" text NOT NULL,
	"position" integer NOT NULL,
	"openalex_id" text NOT NULL,
	"doi" text,
	"title" text NOT NULL,
	"authors" text[] NOT NULL,
	"author_count" integer NOT NULL,
	"year" integer,
	"venue" text,
	"kind" text,
	"cited_by_count" integer NOT NULL,
	CONSTRAINT "citation_index_citers_work_id_position_pk" PRIMARY KEY("work_id","position"),
	CONSTRAINT "citation_index_citers_position" CHECK ("spideryarn"."citation_index_citers"."position" >= 0),
	CONSTRAINT "citation_index_citers_openalex_id" CHECK ("spideryarn"."citation_index_citers"."openalex_id" ~ '^W[0-9]{1,15}$'),
	CONSTRAINT "citation_index_citers_doi" CHECK ("spideryarn"."citation_index_citers"."doi" is null or ("spideryarn"."citation_index_citers"."doi" = lower("spideryarn"."citation_index_citers"."doi") and "spideryarn"."citation_index_citers"."doi" ~ '^10[.][0-9]{4,9}/[^[:space:]"''<>?#]+$')),
	CONSTRAINT "citation_index_citers_title" CHECK (length("spideryarn"."citation_index_citers"."title") between 1 and 1000),
	CONSTRAINT "citation_index_citers_authors" CHECK (cardinality("spideryarn"."citation_index_citers"."authors") <= 20 and array_position("spideryarn"."citation_index_citers"."authors", null) is null
          and "spideryarn"."citation_index_citers"."author_count" >= cardinality("spideryarn"."citation_index_citers"."authors")),
	CONSTRAINT "citation_index_citers_year" CHECK ("spideryarn"."citation_index_citers"."year" is null or "spideryarn"."citation_index_citers"."year" between 1500 and 2100),
	CONSTRAINT "citation_index_citers_cited_by_count" CHECK ("spideryarn"."citation_index_citers"."cited_by_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."citation_index_lookups" (
	"work_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"openalex_id" text,
	"cited_by_count" integer,
	"returned" integer,
	"dropped" integer,
	"capped" boolean,
	"target_title" text,
	"target_authors" text[],
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "citation_index_lookups_work_id" CHECK (length("spideryarn"."citation_index_lookups"."work_id") <= 300 and "spideryarn"."citation_index_lookups"."work_id" = lower("spideryarn"."citation_index_lookups"."work_id")
          and "spideryarn"."citation_index_lookups"."work_id" ~ '^doi:10[.][0-9]{4,9}/[^[:space:]"''<>?#]+$'),
	CONSTRAINT "citation_index_lookups_state" CHECK ("spideryarn"."citation_index_lookups"."state" in ('found', 'not-indexed')),
	CONSTRAINT "citation_index_lookups_shape" CHECK (case
            when "spideryarn"."citation_index_lookups"."state" = 'found' then
              "spideryarn"."citation_index_lookups"."openalex_id" is not null and "spideryarn"."citation_index_lookups"."openalex_id" ~ '^W[0-9]{1,15}$'
              and "spideryarn"."citation_index_lookups"."cited_by_count" is not null and "spideryarn"."citation_index_lookups"."cited_by_count" >= 0
              and "spideryarn"."citation_index_lookups"."returned" is not null and "spideryarn"."citation_index_lookups"."returned" >= 0
              and "spideryarn"."citation_index_lookups"."dropped" is not null and "spideryarn"."citation_index_lookups"."dropped" between 0 and "spideryarn"."citation_index_lookups"."returned"
              and "spideryarn"."citation_index_lookups"."capped" is not null
              and "spideryarn"."citation_index_lookups"."target_title" is not null and length("spideryarn"."citation_index_lookups"."target_title") between 1 and 1000
              and "spideryarn"."citation_index_lookups"."target_authors" is not null and cardinality("spideryarn"."citation_index_lookups"."target_authors") <= 20
              and array_position("spideryarn"."citation_index_lookups"."target_authors", null) is null
            else num_nonnulls("spideryarn"."citation_index_lookups"."openalex_id", "spideryarn"."citation_index_lookups"."cited_by_count", "spideryarn"."citation_index_lookups"."returned", "spideryarn"."citation_index_lookups"."dropped",
                              "spideryarn"."citation_index_lookups"."capped", "spideryarn"."citation_index_lookups"."target_title", "spideryarn"."citation_index_lookups"."target_authors") = 0
          end)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_services" DROP CONSTRAINT "bibliographic_services_service";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_citers" ADD CONSTRAINT "citation_index_citers_work_id_citation_index_lookups_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "spideryarn"."citation_index_lookups"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_services" ADD CONSTRAINT "bibliographic_services_service" CHECK ("spideryarn"."bibliographic_services"."service" in ('crossref', 'datacite', 'openalex'));--> statement-breakpoint
-- Hand-added to the generated file, as in 20260930232254_bibliographic_lookup.sql:
-- the limiter rows for the third service. One `bibliographic_services` row for
-- OpenAlex and one in-flight slot. src/store/pg-bibliographic.ts treats a
-- missing row as a bug, not as "busy" (`EXPECTED_SLOTS`).
INSERT INTO "spideryarn"."bibliographic_services" ("service") VALUES ('openalex') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "spideryarn"."bibliographic_service_slots" ("service", "slot") VALUES ('openalex', 1) ON CONFLICT DO NOTHING;