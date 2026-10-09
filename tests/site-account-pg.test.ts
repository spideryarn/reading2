/**
 * **The site account**, as `drizzle/20261009022454_site_account.sql` made it:
 * the id `SITE_OWNER_ID` names (src/site-account.ts), and a row nobody can
 * sign in as — no password, no identity, an address at `.invalid`, banned —
 * with the four token columns GoTrue needs non-null. Plan 261008j, approved
 * by Greg as "q-p5h2a7 A", 2026-10-09.
 *
 * Checked by its columns rather than by trying to sign in: the suite's
 * databases have no Auth service. A sign-in against the local one was tried
 * when the migration was written (`invalid_credentials` for an empty and a
 * guessed password, and the admin user listing still answered 200).
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { SITE_OWNER_ID } from "../src/site-account.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({ suite: "tests/site-account-pg.test.ts", tables: [] });

afterAll(async () => {
  await closeDb();
});

describe("the site account", () => {
  it("is the row the migration made, and nobody can sign in as it", async () => {
    const rows = await getDb().execute(
      sql`select email, encrypted_password, banned_until > now() + interval '100 years' as banned,
                 confirmation_token, recovery_token, email_change, email_change_token_new,
                 (select count(*) from auth.identities i where i.user_id = u.id)::int as identities
          from auth.users u where id = ${SITE_OWNER_ID}`,
    );
    expect(rows.rows).toEqual([
      {
        email: "site@spideryarn.invalid",
        encrypted_password: "",
        banned: true,
        confirmation_token: "",
        recovery_token: "",
        email_change: "",
        email_change_token_new: "",
        identities: 0,
      },
    ]);
  });
});
