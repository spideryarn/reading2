/**
 * The `auth.users` rows a **local** database is expected to already have —
 * put into a freshly minted private test database.
 *
 * ## Why this exists, and why it is not fifty edits instead
 *
 * A private test database ([`scripts/db-test-create.ts`](../../scripts/db-test-create.ts))
 * is a schema-only clone: every table is empty, `auth.users` included. Measured
 * on 2026-09-03, running the 93 Postgres-touching suites one at a time against
 * one of those, **the single commonest failure by a wide margin was one row
 * missing**:
 *
 * ```
 * insert or update on table "articles" violates foreign key constraint
 *   "articles_owner_fk"
 * Key (owner_id)=(f4d08b58-…) is not present in table "users".
 * ```
 *
 * That id is not a fixture. It is the **ambient owner** — what
 * `currentOwnerId()` answers outside a request, from `SPIDERYARN_OWNER_ID` in
 * `.env.local` ([`src/owner.ts`](../../src/owner.ts) § `environmentOwnerId`) —
 * and roughly fifty suites write a row owned by it without ever naming it,
 * because on the shared database it has been there since somebody ran
 * `npm run db:seed-owner`.
 *
 * So the choice was between fifty files each calling `seedAuthUser` on the same
 * id, and one place that makes a clone resemble a local database in the one
 * respect every one of those files depends on. **Fifty copies of one fact is
 * the wrong answer**: they would all say the same thing, drift separately, and
 * bury the genuinely interesting dependencies — a *second* owner, a fixture id,
 * a row somebody's `beforeAll` really does own — under fifty that are not
 * interesting at all. This is that one place.
 *
 * **The cost, stated rather than hidden:** a private database is now not a bare
 * clone. It carries these rows, so a suite cannot use it to prove *"this works
 * with no accounts at all"*. Nothing needs that today; if something does, it
 * should mint its own database rather than ask this to stop.
 *
 * ## Derived from `SEEDED_ACCOUNTS`, never a second list beside it
 *
 * The ids come from [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts)
 * § `SEEDED_ACCOUNTS`, which is the repo's own declaration of what
 * `db:seed-owner` guarantees — the development owner, the eval owner and the
 * local administrator. A fourth account added there arrives here for free.
 * Hand-copying three ids into this file is exactly the shape that stopped
 * `db:export` writing `shelf.json` (docs/reusable/silent-success.md).
 *
 * The ambient owner is added **on top of** that list rather than assumed to be
 * in it: it usually is (this box's `SPIDERYARN_OWNER_ID` is the administrator's
 * id) and on a machine configured differently it is not, and the difference is
 * invisible until a foreign key says so.
 *
 * ## Why `seedAuthUser` and not a plain insert
 *
 * Four `auth.users` columns are nullable with no default and GoTrue scans them
 * into non-null Go strings, so one row with them NULL makes
 * `GET /auth/v1/admin/users` answer 500 **for the whole database**.
 * [`seed-auth-user.ts`](seed-auth-user.ts) is the one place that knows this and
 * `tests/auth-user-seeding.test.ts` fails if somebody hand-rolls the insert
 * again. It matters here even though these rows are in a clone GoTrue never
 * reads: the point of the helper is that nobody has to remember which case is
 * which.
 */
import { ADMIN_USER_ID_LOCAL } from "../../src/admin.js";
import { environmentOwnerId } from "../../src/owner.js";
import { SEEDED_ACCOUNTS } from "../../scripts/seed-accounts.js";

import { type AuthUserTarget, seedAuthUser } from "./seed-auth-user.js";

/** One row to write: the id, and an address unique among the others. */
export interface LocalAccount {
  readonly id: string;
  readonly email: string;
}

/**
 * Which rows a local database is expected to have, lower-cased.
 *
 * Lower-cased because `scripts/db-seed-dev.ts` does the same to
 * `ADMIN_USER_ID_LOCAL` before using it as an owner (`src/admin.ts` writes it
 * in mixed case), and Postgres compares `uuid` by value — so the case is
 * irrelevant to the database and confusing in a list somebody reads.
 *
 * Pure, so a test can check the composition without a database.
 */
export function localAccounts(ambient: string = environmentOwnerId()): readonly LocalAccount[] {
  const rows = SEEDED_ACCOUNTS.map((a) => ({ id: a.id.toLowerCase(), email: a.email }));
  const seen = new Set(rows.map((r) => r.id));
  const id = ambient.toLowerCase();
  if (!seen.has(id)) {
    /* A deliberately unmistakable address. `users_email_partial_key` is unique,
       so it must not collide with a seeded one, and somebody reading
       `auth.users` in a clone should be able to tell where the row came from. */
    rows.push({ id, email: `ambient-owner-${id}@spideryarn.test` });
  }
  /* Named separately from the loop above so the administrator is present even on
     a machine whose ambient owner is somebody else — `db:seed-dev` seeds it, and
     `ADMIN_USER_ID_LOCAL` is what `isAdmin` gates on rather than an address. */
  if (!rows.some((r) => r.id === ADMIN_USER_ID_LOCAL.toLowerCase())) {
    throw new Error(
      "SEEDED_ACCOUNTS no longer contains the local administrator, so a private " +
        "test database would have no admin row. Check scripts/seed-accounts.ts.",
    );
  }
  return rows;
}

/**
 * Write them, idempotently.
 *
 * `on conflict (id) do nothing` because a lane setup may run against a database
 * a previous file in the same run already seeded, and because a clone made from
 * a database that somehow had these rows is not an error worth failing a run
 * over.
 */
export async function seedLocalAccounts(target: AuthUserTarget): Promise<readonly LocalAccount[]> {
  const rows = localAccounts();
  for (const row of rows) {
    await seedAuthUser(target, { id: row.id, email: row.email, onConflictDoNothing: true });
  }
  return rows;
}
