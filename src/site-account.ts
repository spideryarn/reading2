/**
 * **The site account: the owner nobody signs in as.**
 *
 * The public shelf's topic pills (`/read/public`) have no reader to belong to
 * or to bill, so they are stored under, and spent by, this account. It is a
 * real `auth.users` row, made by `drizzle/20261009022454_site_account.sql`,
 * because `ai_calls`, `shelf_topic_sets` and `rate_limit_events` each keep a
 * foreign key to one. It has no password, no identity, an address at
 * `.invalid`, and is banned; it owns no articles. /admin leaves it out of the
 * reader counts and /admin/costs calls it *the site*.
 *
 * Imports nothing, so the public import graph may read it without reaching
 * src/owner.ts (tests/public-imports.test.ts).
 *
 * Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md;
 * Greg approved it as "q-p5h2a7 A" on 2026-10-09.
 */

/** Must equal the id in the migration; tests/public-shelf-topics-pg.test.ts checks it does. */
export const SITE_OWNER_ID = "5173e000-0000-4000-8000-000000000001";

/** What /admin/costs calls this owner. */
export const SITE_ACCOUNT_LABEL = "the site";
