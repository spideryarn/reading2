/**
 * Create the local development owner in `auth.users`.
 *
 *     npm run db:seed-owner
 *
 * **Why this has to exist.** Every table in `spideryarn` carries
 * `owner_id uuid not null references auth.users(id)`, from day one and on
 * purpose — docs/project/database.md. Supabase owns `auth.users`, so there is
 * nothing our migrations can put in it, and until the beta gate lands
 * (docs/plans/deploy-and-repo-move.md#the-beta-gate) there is no login to
 * create one either. Without a row here, the very first `insert into articles`
 * fails on the foreign key.
 *
 * **The id is fixed, not random.** `00000000-0000-4000-8000-000000000001` is a
 * valid v4-shaped uuid that no generator will ever mint, so it cannot collide
 * with a real user. Fixed because the alternative is worse: GoTrue hands out a
 * random id, that id goes in `.env.local`, and then `npm run db:reset` throws
 * the user away and every id in the database points at nobody. A constant
 * survives a reset, is identical on a fresh clone, and can therefore live in
 * `.env.example` as a default rather than as a setup step.
 *
 * **This is a local convenience and must not become the production answer.**
 * In production `ownerId` is the session user, resolved per request; see
 * src/owner.ts, which is the one place that difference lives. The guard below
 * refuses to run against a non-local Supabase for that reason.
 *
 * Written through GoTrue's admin API rather than as an `insert` into
 * `auth.users`. That table has a dozen not-null columns whose meanings are
 * Supabase's business and change between versions; hand-rolling the insert
 * works right up until it doesn't, and then fails somewhere else entirely.
 */

import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_EMAIL, DEV_OWNER_ID } from "../src/owner.js";

loadEnvLocal();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "  Local: npm run db:start, then they come from .env.local.\n" +
      "  See docs/project/supabase-local.md.",
  );
  process.exit(1);
}

/**
 * The same shape of guard as scripts/db-migrate.ts, for the same reason: this
 * creates a user, and creating a user in the real project is not something to
 * do by accident. There is no `ALLOW_REMOTE` escape hatch here at all — the
 * remote's owner is whoever logs in, so a remote run is never right.
 */
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error(
    `SUPABASE_URL does not look local: ${url}\n` +
      "  This seeds a development user and must only ever run against the\n" +
      "  local Docker stack. In production the owner is the logged-in user.",
  );
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

/** GoTrue's admin list, which is how we tell "already there" from "failed". */
async function findByEmail(email: string): Promise<{ id: string } | undefined> {
  const response = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers });
  if (!response.ok) {
    throw new Error(`listing users failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { users?: { id: string; email?: string }[] };
  return body.users?.find((user) => user.email === email);
}

const existing = await findByEmail(DEV_OWNER_EMAIL);

if (existing) {
  if (existing.id !== DEV_OWNER_ID) {
    // Almost certainly a user made by hand, or by an older version of this
    // script when the id was still random. Say so rather than silently using
    // the wrong id: every row already written points at one of the two.
    console.error(
      `A user with email ${DEV_OWNER_EMAIL} exists but has id ${existing.id},\n` +
        `  not the expected ${DEV_OWNER_ID}.\n` +
        "  Delete it in Studio (or via the admin API) and re-run, or set\n" +
        "  SPIDERYARN_OWNER_ID to the id above if rows already reference it.",
    );
    process.exit(1);
  }
  console.log(`✓ owner already present: ${DEV_OWNER_EMAIL} (${DEV_OWNER_ID})`);
} else {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: DEV_OWNER_ID,
      email: DEV_OWNER_EMAIL,
      email_confirm: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`creating the owner failed: ${response.status} ${await response.text()}`);
  }
  console.log(`✓ owner created: ${DEV_OWNER_EMAIL} (${DEV_OWNER_ID})`);
}
