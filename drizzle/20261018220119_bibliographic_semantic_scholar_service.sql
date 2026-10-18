ALTER TABLE "spideryarn"."bibliographic_services" DROP CONSTRAINT "bibliographic_services_service";--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_services" ADD CONSTRAINT "bibliographic_services_service" CHECK ("spideryarn"."bibliographic_services"."service" in ('crossref', 'datacite', 'openalex', 'semantic-scholar'));--> statement-breakpoint
-- Hand-added to the generated file, as in 20261004164715_citation_index_and_openalex_service.sql:
-- the limiter rows for the fourth service (plan 261018o, R2). One
-- `bibliographic_services` row for Semantic Scholar and one in-flight slot.
-- src/store/pg-bibliographic.ts treats a missing row as a bug, not as "busy"
-- (`EXPECTED_SLOTS`).
INSERT INTO "spideryarn"."bibliographic_services" ("service") VALUES ('semantic-scholar') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "spideryarn"."bibliographic_service_slots" ("service", "slot") VALUES ('semantic-scholar', 1) ON CONFLICT DO NOTHING;
