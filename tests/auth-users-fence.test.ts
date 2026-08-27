/**
 * The fence around `auth.users`, which Drizzle must never think it manages.
 *
 * [`src/db/auth-users.ts`](../src/db/auth-users.ts) declares six columns of
 * Supabase's own table so the admin page can query it with types and column
 * mappers. [`src/db/schema.ts`](../src/db/schema.ts)'s header is emphatic about
 * why that table is not in *it*:
 *
 * > Declaring Supabase's table here would invite migration generation to treat
 * > an Auth-owned object as ours to manage — and dropping it is not a mistake
 * > we would get to undo.
 *
 * So there are **two** things keeping a generated migration away from it, and
 * this file pins both. GPT Sol pointed out, 2026-08-27, that the plan named
 * only one and therefore described half the protection:
 *
 * - `drizzle.config.ts` names one file rather than a glob, so a table declared
 *   beside `schema.ts` is not in the module graph the serializer reads;
 * - `schemaFilter` is pinned to `spideryarn`, so even a table that *did* reach
 *   the serializer would be filtered out by schema.
 *
 * Either alone is enough today. A test that pinned only one would go green
 * through the change that removed the other, which is the whole reason this is
 * a file and not a comment.
 *
 * **It reads the config as text.** Importing it would run it, and what matters
 * here is what a future edit looks like in a diff rather than what the object
 * evaluates to.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { authUsers } from "../src/db/auth-users.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The file with its comments taken out.
 *
 * Both of these files *discuss* the things being asserted against — the config
 * explains why it has no `dbCredentials`, and the table's header explains which
 * credential columns it leaves out by name. Reading the prose as code is the
 * classic way a grep-shaped test fails on the very sentence written to explain
 * it. Same `strip` as tests/store-guarded.test.ts, for the same reason.
 */
const read = (p: string): string =>
  readFileSync(path.join(ROOT, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("drizzle cannot see auth.users", () => {
  const config = read("drizzle.config.ts");

  it("reads exactly one schema file, not a glob", () => {
    /* A glob would pull `auth-users.ts` into the serializer's module graph.
       The exact string, because `schema: ["./src/db/*.ts"]` would still contain
       "./src/db/" and a looser assertion would sail past it. */
    expect(config).toMatch(/schema:\s*"\.\/src\/db\/schema\.ts"/);
    expect(config).not.toMatch(/schema:\s*\[/);
  });

  it("is pinned to our own schema, so nothing in `auth` can be generated against", () => {
    expect(config).toMatch(/schemaFilter:\s*\[\s*"spideryarn"\s*\]/);
  });

  it("still carries no connection details, so `push` cannot introspect", () => {
    /* Not about `auth.users` specifically — it is the guard rail that stops
       `drizzle-kit push` computing a diff against a live database at all, which
       is the other way a `drop` reaches production. docs/project/database.md. */
    expect(config).not.toMatch(/dbCredentials/);
  });

  it("is not reached from the schema file by any import", () => {
    /* The one edit that would undo all of the above at once: a single
       `import … from "./auth-users.js"` in schema.ts puts the table into the
       exports the serializer reads. */
    expect(read("src/db/schema.ts")).not.toMatch(/auth-users/);
  });

  it("declares exactly the columns the admin page reads, and no others", () => {
    /* **The allowlist, from the table itself rather than from a grep.** This
       was a blacklist of five credential column names, which is a check that
       passes for every sensitive column nobody thought of — `phone`,
       `banned_until`, `is_super_admin`, the next one Supabase adds. GPT Sol,
       2026-08-27.

       It matters because `select()` with no argument returns every column a
       table *declares*, so this list is the ceiling on what a mistake in a
       query can hand to a route. Adding a column here should be a decision, and
       a red test is what makes it one. */
    expect(Object.keys(getTableColumns(authUsers)).sort()).toEqual([
      "createdAt",
      "deletedAt",
      "email",
      "emailConfirmedAt",
      "id",
      "lastSignInAt",
      "rawAppMetaData",
    ]);
  });

  it("asks for the email confirmation, not the one that also answers for a phone", () => {
    /* Supabase has both. `confirmed_at` is a backwards-compatibility column
       meaning "email *or* phone", and the page prints "email unconfirmed"
       beneath an email address — so the wrong one labels a phone-confirmed
       account the opposite of the truth. Pinned on the *database* name, which
       is the half a rename of the TypeScript field would not change. */
    expect(getTableColumns(authUsers).emailConfirmedAt.name).toBe("email_confirmed_at");
  });
});
