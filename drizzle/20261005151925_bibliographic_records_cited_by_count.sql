ALTER TABLE "spideryarn"."bibliographic_records" ADD COLUMN "cited_by_count" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" ADD COLUMN "cited_by_count_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" ADD CONSTRAINT "bibliographic_records_cited_by_count" CHECK ("spideryarn"."bibliographic_records"."cited_by_count" is null or ("spideryarn"."bibliographic_records"."cited_by_count" >= 0
            and "spideryarn"."bibliographic_records"."state" is not distinct from 'found' and "spideryarn"."bibliographic_records"."source" is not distinct from 'crossref'
            and "spideryarn"."bibliographic_records"."cited_by_count_read_at" is not null));--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" ADD CONSTRAINT "bibliographic_records_cited_by_count_read_at" CHECK ("spideryarn"."bibliographic_records"."cited_by_count_read_at" is null
            or ("spideryarn"."bibliographic_records"."state" is not distinct from 'found' and "spideryarn"."bibliographic_records"."source" is not distinct from 'crossref'));