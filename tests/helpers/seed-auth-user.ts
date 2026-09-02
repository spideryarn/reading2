/**
 * The one way a test puts a row in `auth.users`.
 *
 * ## Why it exists: four columns, and a 500 for the whole database
 *
 * `auth.users.confirmation_token`, `recovery_token`, `email_change` and
 * `email_change_token_new` are nullable **with no default** — the other four
 * token columns default to `''`. GoTrue scans all of them into non-null Go
 * strings, so one row with those left NULL makes
 * `GET /auth/v1/admin/users` answer 500:
 *
 * ```
 * "error":"unable to fetch records: sql: Scan error on column index 3,
 *  name \"confirmation_token\": converting NULL to string is unsupported"
 * ```
 *
 * That is not scoped to the row, the suite or the connection. It is the whole
 * database, for as long as the row exists — so a seeder here breaks
 * `tests/admin-store.test.ts` in another process and the dev server's `/admin`
 * page as well. Diagnosed and reproduced 3/3 in
 * docs/plans/260902c-make-the-test-suite-pass-reliably.md § Cause 2.
 *
 * Ten test files had hand-rolled the insert and none of them mentioned those
 * four columns, which is why this is a helper rather than a note: the next
 * suite that needs an owner cannot re-introduce it, and
 * tests/auth-user-seeding.test.ts fails if one tries.
 *
 * The rest of the columns Supabase's table has all default to something GoTrue
 * can read, so they are left alone.
 */
import { sql } from "drizzle-orm";

import type { Db } from "../../src/db/client.js";

/** A `pg` `Pool`, `Client` or `PoolClient` — anything that takes raw SQL. */
export interface PgQueryable {
  query(text: string, values: unknown[]): Promise<unknown>;
}

/**
 * Either driver the suites use. Drizzle is told apart by `execute`, which no
 * `pg` client has — `query` would not do it, because a Drizzle handle has a
 * `query` of its own (the relational one).
 */
export type AuthUserTarget = Db | PgQueryable;

export interface AuthUserSeed {
  /** The uuid other rows' `owner_id` will reference. */
  id: string;
  /** `users_email_partial_key` is unique, so a per-run address is safest. */
  email: string;
  /** For a seeder that may run twice against a row it left behind. */
  onConflictDoNothing?: boolean;
}

/**
 * The row, column by column, as values rather than SQL literals — so the same
 * list builds both the `$1` text and the Drizzle template, and the four columns
 * above cannot be in one and missing from the other.
 */
function row(seed: AuthUserSeed): [column: string, value: unknown][] {
  const now = new Date();
  return [
    ["id", seed.id],
    ["instance_id", "00000000-0000-0000-0000-000000000000"],
    ["aud", "authenticated"],
    ["role", "authenticated"],
    ["email", seed.email],
    ["encrypted_password", "x"],
    ["created_at", now],
    ["updated_at", now],
    /* The four with no default. GoTrue reads them as non-null strings. */
    ["confirmation_token", ""],
    ["recovery_token", ""],
    ["email_change", ""],
    ["email_change_token_new", ""],
  ];
}

/** Insert one `auth.users` row that the Auth service can list. */
export async function seedAuthUser(target: AuthUserTarget, seed: AuthUserSeed): Promise<void> {
  const columns = row(seed);
  const names = columns.map(([name]) => name).join(", ");
  const values = columns.map(([, value]) => value);
  const conflict = seed.onConflictDoNothing ? " on conflict (id) do nothing" : "";

  if ("execute" in target) {
    const placeholders = sql.join(
      values.map((value) => sql`${value}`),
      sql`, `,
    );
    await target.execute(
      sql`insert into auth.users (${sql.raw(names)}) values (${placeholders})${sql.raw(conflict)}`,
    );
    return;
  }

  const marks = values.map((_, i) => `$${i + 1}`).join(", ");
  await target.query(`insert into auth.users (${names}) values (${marks})${conflict}`, values);
}
