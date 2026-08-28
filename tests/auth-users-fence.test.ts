/**
 * The fence around `auth.users`, which Drizzle must never think it manages.
 *
 * **Nothing declares that table any more**, and this file changed shape when it
 * stopped. The admin page used to `select()` six of its columns through
 * `src/db/auth-users.ts`; it now asks the Auth service instead
 * ([`src/store/admin-accounts.ts`](../src/store/admin-accounts.ts)), because
 * the role the deployed server connects as has no grants into the `auth` schema
 * and the query could never have worked in production —
 * docs/postmortems/admin-id-was-the-local-one.md.
 *
 * So the strongest assertion available got stronger: the fence is no longer
 * "the one declaration we have lists only safe columns", it is **"there is no
 * declaration"**. [`src/db/schema.ts`](../src/db/schema.ts)'s header says why
 * that matters:
 *
 * > Declaring Supabase's table here would invite migration generation to treat
 * > an Auth-owned object as ours to manage — and dropping it is not a mistake
 * > we would get to undo.
 *
 * There are **two** things keeping a generated migration away from it, and this
 * file pins both. GPT Sol pointed out, 2026-08-27, that the plan named only one
 * and therefore described half the protection:
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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

/**
 * Declaring the `auth` schema, however it was written.
 *
 * Whitespace and newlines between the parts, and all three quote characters:
 * a grep that matched one spelling would report an empty list for the other
 * four, which is a guard that has been defeated rather than one that passed.
 */
const AUTH_SCHEMA = /pgSchema\s*\(\s*["'`]auth["'`]\s*,?\s*\)/;

/** Every `.ts` file under a directory, at any depth, repo-relative. */
function tsFilesUnder(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsFilesUnder(child));
    else if (entry.name.endsWith(".ts")) out.push(child);
  }
  return out;
}

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
    /* The one edit that would undo all of the above at once: a single import of
       a module declaring an `auth`-schema table puts it into the exports the
       serializer reads. */
    expect(read("src/db/schema.ts")).not.toMatch(/auth-users/);
  });

  it("has nothing anywhere under src/db that declares an auth-schema table", () => {
    /* **The fence, in its strongest available form.** This used to assert that
       our one declaration of `auth.users` listed six safe columns — a ceiling
       on what a `select()` could hand to a route. There is no declaration now,
       so the assertion is that there is none: a `pgSchema` for `auth` anywhere
       under `src/db/` means somebody has re-declared a table Supabase owns, and
       both guards above exist because dropping one is not a mistake we would
       get to undo.

       **Recursive, and not one spelling.** The first version read the top level
       of `src/db/` only and matched the exact string `pgSchema("auth")`, so a
       subdirectory or a single quote would have walked past it, and the test
       would have gone on reporting an empty list — the shape of guard this repo
       keeps getting caught by. GPT Sol, 2026-08-28. */
    const offenders = tsFilesUnder("src/db").filter((rel) => AUTH_SCHEMA.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it("would notice one if it came back", () => {
    /* The control. A rule whose check has never been seen to fire is a rule
       nobody can tell from an empty directory — docs/reusable/silent-success.md,
       and this repo has shipped that mistake more than once. The pattern is
       applied to a string here rather than to a file, so the check itself is
       what gets exercised. */
    const declaration = 'export const authSchema = pgSchema("auth");';
    expect(/pgSchema\(\s*["'`]auth["'`]\s*\)/.test(declaration)).toBe(true);
  });
});
