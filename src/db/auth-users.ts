/**
 * `auth.users`, as seven columns we may read and must never manage.
 *
 * ## Why this is not in schema.ts
 *
 * [schema.ts](schema.ts)'s own header says it, and it is the reason this file
 * exists rather than four more lines in that one:
 *
 * > **Foreign keys into `auth.users`.** Declaring Supabase's table here would
 * > invite migration generation to treat an Auth-owned object as ours to manage
 * > — and dropping it is not a mistake we would get to undo.
 *
 * `drizzle.config.ts` has `schema: "./src/db/schema.ts"` — one file, not a glob
 * — so `drizzle-kit generate` reads that module's exports and nothing else. A
 * table declared *beside* it is invisible to the snapshot and to every
 * generated migration, while being an ordinary Drizzle table to any query that
 * imports it.
 *
 * **There are two independent barriers, and this file is behind one of
 * them.** Widening `drizzle.config.ts` to a glob would put this module into the
 * graph the serializer reads — but `schemaFilter: ["spideryarn"]` would still
 * drop an `auth`-schema table on the way out. Either alone is enough today,
 * which is exactly why removing one would look harmless. So: nothing in this
 * file may be imported by `schema.ts`, the config stays pointed at one file,
 * and the filter stays pinned. `tests/db-schema.test.ts` already guards the companion
 * property — that the hand-written FKs into this table survive.
 *
 * ## Seven columns, and the ones deliberately left out
 *
 * `id`, `email`, `created_at`, `last_sign_in_at`, `email_confirmed_at`, the app
 * metadata that says which provider signed them in, and `deleted_at`.
 *
 * **`email_confirmed_at`, not `confirmed_at`.** Supabase has both, and
 * `confirmed_at` is a backwards-compatibility column meaning "email *or* phone
 * was confirmed". The admin page prints "unconfirmed" beside an *email address*,
 * so a phone-confirmed account with an unconfirmed email would have been
 * labelled the opposite of the truth. GPT Sol caught it, 2026-08-27, along with
 * the comment here that had claimed Google accounts never set it — they do. A Drizzle table does
 * not have to be complete to be usable — it maps the columns you name — and
 * naming only these keeps every password and token column out of a type that a
 * route hands to `select()`. `tests/auth-users-fence.test.ts` pins the list as
 * an **exact allowlist**, read off the table with `getTableColumns` — it was a
 * blacklist of five credential names first, which is a check that passes for
 * every sensitive column nobody happened to think of. A
 * `select()` with no argument returns every column a table declares, so what
 * this file declares is the ceiling on what a mistake can return.
 *
 * `email` is nullable in Supabase's own schema (a phone-only account has none),
 * so it is nullable here. The one caller drops a user with no address rather
 * than rendering an empty cell — see src/store/pg-admin.ts.
 *
 * Read-only by convention rather than by grant: nothing in this repo writes to
 * `auth`, and the way an account is created is a sign-in.
 */

import { jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Supabase's own schema. **Not** `spideryarn` — see schema.ts, where every one
 * of our tables lives, and which is the only schema our migrations touch.
 */
const auth = pgSchema("auth");

export const authUsers = auth.table("users", {
  id: uuid("id").primaryKey(),
  /** Nullable: a phone-only account has no address. */
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  /**
   * When the **email address** was confirmed, and deliberately not
   * `confirmed_at`, which also answers for a phone. See the header.
   */
  emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
  /**
   * `{"provider": "google", "providers": ["google"]}` — Supabase's own record
   * of how the account signs in. **App metadata, not user metadata**: the user
   * half is writable by the account holder, so a name read from it is a string
   * a stranger chose. This half is written by GoTrue.
   */
  rawAppMetaData: jsonb("raw_app_meta_data"),
  /**
   * Set when an account has been soft-deleted. The row stays; the account is
   * gone. The admin listing filters these out — a deleted user in a list of
   * users is a list that is wrong in the direction nobody checks.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
