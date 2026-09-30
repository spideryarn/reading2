-- The `auth.users` foreign key on `citation_investigations.owner_id`, by hand,
-- exactly as drizzle/20260912000251_citation_finds_owner_fk.sql gives
-- `citation_finds` its own: Drizzle does not model the `auth` schema, so the
-- reference cannot be declared in src/db/schema.ts.
--
-- ON DELETE RESTRICT, not CASCADE, as every other `owner_id`: deleting an
-- account must not silently take reader state with it. The rows go with their
-- article (`article_id` cascades), which is how an account's articles are removed.
ALTER TABLE "spideryarn"."citation_investigations"
  ADD CONSTRAINT "citation_investigations_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
