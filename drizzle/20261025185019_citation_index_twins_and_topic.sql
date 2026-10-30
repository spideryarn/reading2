-- Cited by's twins and topic view: plan 261025h, decisions 2 and 10
-- (docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md).
-- Additive: the key CHECK widened to admit a work held as up to four OpenAlex records (openalex:w1|w2) and
-- a '#topic' row beside any key; one nullable column, target_keyword, only on a found row. Every row the
-- old CHECKs admitted, the new ones admit; no row is rewritten.
ALTER TABLE "spideryarn"."citation_index_lookups" DROP CONSTRAINT "citation_index_lookups_work_id";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" DROP CONSTRAINT "citation_index_lookups_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" ADD COLUMN "target_keyword" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" ADD CONSTRAINT "citation_index_lookups_work_id" CHECK (length("spideryarn"."citation_index_lookups"."work_id") <= 600 and "spideryarn"."citation_index_lookups"."work_id" = lower("spideryarn"."citation_index_lookups"."work_id")
          and ("spideryarn"."citation_index_lookups"."work_id" ~ '^doi:10[.][0-9]{4,9}/[^[:space:]"''<>?#]+(#topic)?$'
               or "spideryarn"."citation_index_lookups"."work_id" ~ '^openalex:w[0-9]{1,15}([|]w[0-9]{1,15}){0,3}(#topic)?$'));--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" ADD CONSTRAINT "citation_index_lookups_shape" CHECK (case
            when "spideryarn"."citation_index_lookups"."state" = 'found' then
              "spideryarn"."citation_index_lookups"."openalex_id" is not null and "spideryarn"."citation_index_lookups"."openalex_id" ~ '^W[0-9]{1,15}$'
              and "spideryarn"."citation_index_lookups"."cited_by_count" is not null and "spideryarn"."citation_index_lookups"."cited_by_count" >= 0
              and "spideryarn"."citation_index_lookups"."returned" is not null and "spideryarn"."citation_index_lookups"."returned" >= 0
              and "spideryarn"."citation_index_lookups"."dropped" is not null and "spideryarn"."citation_index_lookups"."dropped" between 0 and "spideryarn"."citation_index_lookups"."returned"
              and "spideryarn"."citation_index_lookups"."capped" is not null
              and "spideryarn"."citation_index_lookups"."target_title" is not null and length("spideryarn"."citation_index_lookups"."target_title") between 1 and 10000
              and "spideryarn"."citation_index_lookups"."target_authors" is not null and cardinality("spideryarn"."citation_index_lookups"."target_authors") <= 20
              and array_position("spideryarn"."citation_index_lookups"."target_authors", null) is null
              and ("spideryarn"."citation_index_lookups"."target_keyword" is null or length("spideryarn"."citation_index_lookups"."target_keyword") between 1 and 200)
            else num_nonnulls("spideryarn"."citation_index_lookups"."openalex_id", "spideryarn"."citation_index_lookups"."cited_by_count", "spideryarn"."citation_index_lookups"."returned", "spideryarn"."citation_index_lookups"."dropped",
                              "spideryarn"."citation_index_lookups"."capped", "spideryarn"."citation_index_lookups"."target_title", "spideryarn"."citation_index_lookups"."target_authors", "spideryarn"."citation_index_lookups"."target_keyword") = 0
          end);