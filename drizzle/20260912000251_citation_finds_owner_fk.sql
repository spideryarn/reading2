-- The `auth.users` foreign key on `citation_finds.owner_id`, by hand, exactly as
-- drizzle/0003_reader_state_owner_fks.sql gives `glossary_lookups` its own:
-- Drizzle does not model the `auth` schema, so the reference cannot be declared
-- in src/db/schema.ts.
--
-- ON DELETE RESTRICT, not CASCADE, as in 0001 and 0003: deleting an account must
-- not silently take reader state with it. The rows go with their article
-- (`article_id` cascades), which is how an account's articles are removed.
ALTER TABLE "spideryarn"."citation_finds"
  ADD CONSTRAINT "citation_finds_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
