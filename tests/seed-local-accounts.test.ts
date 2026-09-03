/**
 * `localAccounts()` — which `auth.users` rows a private test database gets.
 *
 * Pure, and no database: the composition is the part that can be wrong, and the
 * insert it feeds is `seedAuthUser`, which
 * [auth-user-seeding.test.ts](auth-user-seeding.test.ts) already covers against
 * the real thing. So this file needs no lane in
 * [store-migration-registry.ts](store-migration-registry.ts) § `TEST_LANES` and
 * opens no connection — deliberately, because a helper the private lane's setup
 * calls before any test runs is the worst possible place for a suite that can
 * only be exercised once the lane already works.
 *
 * ## What is worth asserting, and what is not
 *
 * Not the three ids. They come from `SEEDED_ACCOUNTS`
 * ([`scripts/seed-accounts.ts`](../scripts/seed-accounts.ts)) and restating them
 * here would be the second list beside the data that
 * docs/reusable/silent-success.md warns about — the assertion would then agree
 * with a wrong list as happily as with a right one.
 *
 * What is worth asserting is the **composition**: that the ambient owner is
 * added when it is somebody new, that it is *not* added twice when it is one of
 * the seeded three, and that every address is distinct — because
 * `users_email_partial_key` is unique and a duplicate address turns the seeder
 * into a failed insert on a database the whole lane depends on.
 */
import { describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { SEEDED_ACCOUNTS } from "../scripts/seed-accounts.js";
import { localAccounts } from "./helpers/seed-local-accounts.js";

describe("the accounts a private test database is given", () => {
  it("carries every account `db:seed-owner` guarantees", () => {
    const ids = new Set(localAccounts(DEV_OWNER_ID).map((a) => a.id));
    /* Derived from the same list the helper reads, so adding a fourth seeded
       account does not need an edit here — what this checks is that the helper
       does not *drop* one, which a filter or a slice could. */
    for (const account of SEEDED_ACCOUNTS) {
      expect(ids, `${account.email} — ${account.why}`).toContain(account.id.toLowerCase());
    }
    expect(SEEDED_ACCOUNTS.length, "SEEDED_ACCOUNTS is empty, so this vouches for nobody")
      .toBeGreaterThan(2);
  });

  it("adds an ambient owner that is nobody else, and adds it once", () => {
    const stranger = "0e5c0001-0000-4000-8000-00000000ab01";
    const rows = localAccounts(stranger);
    expect(rows.map((r) => r.id)).toContain(stranger);
    expect(rows.filter((r) => r.id === stranger)).toHaveLength(1);
    expect(rows).toHaveLength(SEEDED_ACCOUNTS.length + 1);
  });

  it("does not add the ambient owner twice when it is already a seeded account", () => {
    /* The ordinary case on this box: `SPIDERYARN_OWNER_ID` is the local
       administrator's id, which `SEEDED_ACCOUNTS` already names. A second row
       for it would fail the primary key, or — with `on conflict do nothing` —
       silently write nothing while claiming an extra account. */
    const rows = localAccounts(ADMIN_USER_ID_LOCAL);
    expect(rows).toHaveLength(SEEDED_ACCOUNTS.length);
    expect(rows.filter((r) => r.id === ADMIN_USER_ID_LOCAL.toLowerCase())).toHaveLength(1);
  });

  it("tolerates an ambient owner written in the other case", () => {
    /* `ADMIN_USER_ID_LOCAL` is mixed case in `src/admin.ts` and
       `scripts/db-seed-dev.ts` lower-cases it before use. Postgres compares
       `uuid` by value, so an upper-cased `SPIDERYARN_OWNER_ID` is the same
       person — and a helper comparing strings would add a duplicate row for it. */
    const rows = localAccounts(ADMIN_USER_ID_LOCAL.toUpperCase());
    expect(rows).toHaveLength(SEEDED_ACCOUNTS.length);
  });

  it("gives every row an address of its own", () => {
    const rows = localAccounts("0e5c0001-0000-4000-8000-00000000ab02");
    const emails = rows.map((r) => r.email);
    expect(new Set(emails).size, `duplicate address among ${emails.join(", ")}`).toBe(emails.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("refuses a world where the local administrator has stopped being seeded", async () => {
    /**
     * The one thing this helper must not silently get away with. `isAdmin`
     * gates on `ADMIN_USER_ID_LOCAL` rather than on an address, so a private
     * database missing that row makes every `/api/admin/*` suite fail somewhere
     * three layers from the cause.
     *
     * **Asserting the id is present would not test the throw** — the first case
     * above already does that, and a `toContain` passes whether the guard
     * exists or not. So `SEEDED_ACCOUNTS` is replaced with a list that has lost
     * the administrator, which is the only way to reach the branch.
     */
    vi.resetModules();
    vi.doMock("../scripts/seed-accounts.js", () => ({
      SEEDED_ACCOUNTS: [{ id: DEV_OWNER_ID, email: "dev@spideryarn.local" }],
    }));
    const { localAccounts: withoutAdmin } = await import("./helpers/seed-local-accounts.js");
    expect(() => withoutAdmin(DEV_OWNER_ID)).toThrow(/no longer contains the local administrator/);
    vi.doUnmock("../scripts/seed-accounts.js");
    vi.resetModules();
  });
});
