-- The `auth.users` foreign key on `citation_web_notes.owner_id`, by hand,
-- exactly as drizzle/20260930010742_citation_investigations_owner_fk.sql gives
-- `citation_investigations` its own: Drizzle does not model the `auth` schema,
-- so the reference cannot be declared in src/db/schema.ts.
--
-- ON DELETE RESTRICT, not CASCADE, as every other reader-state `owner_id`:
-- deleting an account must not silently take reader state with it. The rows go
-- with their article (`article_id` cascades), which is how an account's
-- articles are removed.
ALTER TABLE "spideryarn"."citation_web_notes"
  ADD CONSTRAINT "citation_web_notes_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
