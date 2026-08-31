/**
 * Who counts as the administrator — src/admin.ts.
 *
 * A handful of lines of code, and worth a file of its own because of what those
 * lines nearly were. The gate compares **an account id**, not an email address,
 * and the tests here are mostly about that being true rather than about it
 * being convenient:
 *
 *  - The right email on the wrong account is **not** the administrator. That is
 *    the whole reason the constant is a uuid: an email is a property of an
 *    account that its holder can change, and an id is the account.
 *  - `includes` in place of `===` would admit anything containing the id.
 *
 * GPT Sol's review of the plan, 2026-08-27, is why the first of those is here.
 * docs/project/admin.md § Who the administrator is.
 */
import { describe, expect, it } from "vitest";

import {
  ADMIN_EMAIL,
  ADMIN_USER_ID_LOCAL,
  ADMIN_USER_ID_PROD,
  ADMIN_USER_IDS,
  describeAdminMiss,
  isAdmin,
} from "../src/admin.js";
import { TEST_EMAIL, TEST_SUB } from "./helpers/authed.js";

/** Well-formed, and not Greg's. */
const SOMEBODY_ELSE = "9a1f4c2e-7b3d-4a58-9e12-0c6d8f5a41b7";

describe("the administrator", () => {
  it("is one account id per project, and the local one is what the suite signs in as", () => {
    expect(isAdmin(ADMIN_USER_ID_LOCAL)).toBe(true);
    /* `TEST_SUB` aliases the constant, so asserting they are equal compares a
       value to itself and can never fail — which is the mistake this whole file
       is now about, so it is gone. What is worth checking is the property the
       suite actually depends on: whatever the helper signs with, `isAdmin` says
       yes to it. That breaks if somebody points `TEST_SUB` somewhere else. */
    expect(isAdmin(TEST_SUB)).toBe(true);
    expect(ADMIN_EMAIL).toBe(TEST_EMAIL);
  });

  it("is the same id however it was typed", () => {
    // A uuid has no case, but nothing anywhere should depend on that.
    expect(isAdmin(ADMIN_USER_ID_LOCAL.toUpperCase())).toBe(true);
    expect(isAdmin(ADMIN_USER_ID_PROD.toUpperCase())).toBe(true);
    expect(isAdmin(`  ${ADMIN_USER_ID_PROD}  `)).toBe(true);
  });

  it("is not an id that merely contains it", () => {
    /* Both, because the list is now searched with `Array.includes` and the
       one-id version of this test could not have told that apart from a
       `String.includes` on a joined list. */
    for (const id of ADMIN_USER_IDS) {
      expect(isAdmin(`${id}0`)).toBe(false);
      expect(isAdmin(`0${id}`)).toBe(false);
      expect(isAdmin(id.slice(0, -1))).toBe(false);
    }
  });

  it("is not somebody else's account", () => {
    expect(isAdmin(SOMEBODY_ELSE)).toBe(false);
  });

  /**
   * **The point of using an id at all.**
   *
   * A signed token proves the email; it does not make the email permanent. If
   * the gate compared addresses, anybody who could get their own account's
   * email changed to Greg's would become the administrator — which today is
   * blocked by a Supabase setting rather than by anything in this repo.
   */
  it("is not the email address, however right the email is", () => {
    expect(isAdmin(ADMIN_EMAIL)).toBe(false);
    // The same person's address on a different account gets nothing.
    expect(describeAdminMiss(SOMEBODY_ELSE, ADMIN_EMAIL)).toBeDefined();
  });

  it("is nobody at all when there is no id", () => {
    /* Every one of these is a shape a caller can really have — the browser's
       user may be null, a claim may be missing. None may be the administrator. */
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin("")).toBe(false);
    expect(isAdmin("   ")).toBe(false);
  });
});

/**
 * The one refusal worth writing down, and the ones that are not.
 *
 * A silent lockout is the cost of gating on an id: a recreated account shows
 * Greg the shelf and says nothing. This turns that into one line in the log.
 */
describe("which refusals are worth a line in the log", () => {
  it("says something when the right address arrives on an unknown account", () => {
    const said = describeAdminMiss(SOMEBODY_ELSE, "Greg@GregDetre.com");
    expect(said).toBeDefined();
    /* **Nothing interpolated.** `logRequest` writes a message into a field
       where redaction, which matches key paths and never text, cannot reach —
       so an id or an address in this sentence is one written down in the clear.
       docs/project/logging.md. */
    expect(said).not.toContain(SOMEBODY_ELSE);
    expect(said).not.toContain("@");
  });

  it("says nothing about an ordinary reader on a page that is not theirs", () => {
    expect(describeAdminMiss(SOMEBODY_ELSE, "someone@example.test")).toBeUndefined();
  });

  it("says nothing at all about the administrator, who was not refused", () => {
    expect(describeAdminMiss(ADMIN_USER_ID_LOCAL, ADMIN_EMAIL)).toBeUndefined();
    expect(describeAdminMiss(ADMIN_USER_ID_PROD, ADMIN_EMAIL)).toBeUndefined();
  });
});

/**
 * **The id was read off a laptop and never checked against production.**
 *
 * `greg@gregdetre.com` is an account on the local Supabase stack *and* an
 * account on the production project, and they are two different accounts with
 * two different `auth.users(id)`s. The constant was the local one, so the Admin
 * link never drew on spideryarn.com and `/api/admin/*` answered 403 to the
 * administrator — for a day, silently, exactly the lockout `describeAdminMiss`
 * was written to explain (it did fire; nobody was reading the log).
 *
 * docs/postmortems/260828f-admin-id-was-the-local-one.md.
 */
describe("the administrator has one account per Supabase project", () => {
  /* Spelled out rather than imported. Asserting `isAdmin(ADMIN_USER_ID_PROD)`
     would pass for whatever the constant happened to say, which is exactly the
     mistake — the value is a fact about an external system, so the test has to
     carry its own copy of it. */
  it("is Greg on production, not only Greg on a laptop", () => {
    // Read from production's `auth.users` on 2026-08-28, via the GoTrue admin API.
    expect(isAdmin("001bb7a0-7720-4f1b-8b9d-1ee6e63d132a")).toBe(true);
  });

  it("is Greg on the local stack too, which is what the suite signs in as", () => {
    expect(isAdmin("f4d08b58-5573-4811-9887-e26c114fb324")).toBe(true);
  });

  it("is nobody else — the list is two accounts, not a door left ajar", () => {
    expect(ADMIN_USER_IDS).toHaveLength(2);
    expect(isAdmin(SOMEBODY_ELSE)).toBe(false);
  });
});
