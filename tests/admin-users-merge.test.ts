/**
 * The arithmetic behind the admin users table, with no database in sight.
 *
 * `listUsersAcrossOwners` is six queries and one join; the queries need a
 * Postgres (tests/admin-store.test.ts, which skips without one) and the join
 * does not. `mergeUsers` is that join, pulled out for exactly this reason —
 * GPT Sol's review of the plan, 2026-08-27:
 *
 * > The endpoint could always return 501 or an empty list and every planned
 * > automated test would remain green.
 *
 * So the cases here are the ones that a page of numbers gets wrong in ways
 * nobody notices: two owners' counts swapped, an owner with nothing in a table
 * losing the field rather than getting a zero, and an account that cannot sign
 * in appearing anyway.
 *
 * docs/project/admin.md § Where the numbers come from.
 */
import { describe, expect, it } from "vitest";

import { mergeUsers, providersOf, type AccountRow, type UserCounts } from "../src/store/pg-admin.js";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
/** A third, for the case that needs one. */
const SOMEBODY = "cccccccc-0000-4000-8000-000000000003";

function account(id: string, email: string | null, over: Partial<AccountRow> = {}): AccountRow {
  return {
    id,
    email,
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    lastSignInAt: new Date("2026-08-20T10:00:00.000Z"),
    emailConfirmedAt: new Date("2026-08-01T10:01:00.000Z"),
    meta: { provider: "google", providers: ["google"] },
    ...over,
  };
}

/** Nothing counted anywhere. Each test adds only what it is about. */
const NOTHING: UserCounts = { shelf: [], uploads: [], questions: [], chats: [], searches: [] };

describe("joining accounts to their counts", () => {
  it("gives each owner their own numbers and nobody else's", () => {
    /* **The failure this test exists for**: five separate `group by` queries
       merged by hand is a shape whose way of going wrong is quiet — one row
       misfiled, and the page is confidently wrong about two people at once.
       So every number here is distinct, and every one is checked. */
    const users = mergeUsers([account(ALICE, "alice@example.test"), account(BOB, "bob@example.test")], {
      shelf: [
        { owner: ALICE, live: 3, archived: 1, opens: 40, lastReadAt: new Date("2026-08-25T09:00:00.000Z") },
        { owner: BOB, live: 7, archived: 2, opens: 5, lastReadAt: new Date("2026-08-26T09:00:00.000Z") },
      ],
      uploads: [{ owner: ALICE, n: 11 }, { owner: BOB, n: 22 }],
      questions: [{ owner: ALICE, n: 13 }, { owner: BOB, n: 24 }],
      chats: [{ owner: ALICE, n: 15 }, { owner: BOB, n: 26 }],
      searches: [{ owner: ALICE, n: 17 }, { owner: BOB, n: 28 }],
    });

    const alice = users.find((u) => u.id === ALICE);
    const bob = users.find((u) => u.id === BOB);
    expect(alice).toMatchObject({
      articles: 3, archived: 1, opens: 40, uploads: 11, questions: 13, chats: 15, searches: 17,
      lastReadAt: "2026-08-25T09:00:00.000Z",
    });
    expect(bob).toMatchObject({
      articles: 7, archived: 2, opens: 5, uploads: 22, questions: 24, chats: 26, searches: 28,
      lastReadAt: "2026-08-26T09:00:00.000Z",
    });
  });

  it("gives an owner with nothing a zero, not a missing field", () => {
    /* A `group by` returns no row at all for an owner with nothing to count.
       Zero is the answer; absent would render as an empty cell, which reads as
       data we failed to fetch rather than as a fact. */
    const [alone] = mergeUsers([account(ALICE, "alice@example.test")], NOTHING);
    expect(alone).toMatchObject({
      articles: 0, archived: 0, uploads: 0, questions: 0, chats: 0, searches: 0, opens: 0,
    });
    /* And the dates that genuinely have no answer stay *absent*, because
       `exactOptionalPropertyTypes` makes absent the only spelling of "no
       value" and the column draws that as an em dash with a reason on it. */
    expect(alone).not.toHaveProperty("lastReadAt");
  });

  it("counts an owner who has articles but has never opened one", () => {
    const [only] = mergeUsers([account(ALICE, "alice@example.test")], {
      ...NOTHING,
      shelf: [{ owner: ALICE, live: 2, archived: 0, opens: 0, lastReadAt: null }],
    });
    expect(only?.articles).toBe(2);
    expect(only?.opens).toBe(0);
    expect(only).not.toHaveProperty("lastReadAt");
  });

  it("leaves out an account that could never sign in", () => {
    /* No email means the gate refuses it by name (`[auth-noemail]`), so it owns
       nothing and has nothing to say. Both spellings of absent. */
    const users = mergeUsers(
      [account(ALICE, null), account(BOB, ""), account(SOMEBODY, "real@example.test")],
      NOTHING,
    );
    expect(users.map((u) => u.email)).toEqual(["real@example.test"]);
  });

  it("puts every date on the wire as ISO, or not at all", () => {
    const [one] = mergeUsers(
      [account(ALICE, "alice@example.test", { lastSignInAt: null, emailConfirmedAt: null })],
      NOTHING,
    );
    expect(one?.createdAt).toBe("2026-08-01T10:00:00.000Z");
    expect(one).not.toHaveProperty("lastSignInAt");
    expect(one).not.toHaveProperty("emailConfirmedAt");
  });

  it("survives an account whose created_at is missing", () => {
    /* Nullable in Supabase's schema even though every real row has one. The
       epoch would sort as 1970 and read as a fact; an unparseable empty string
       is what `timeAgo` already draws as "—". */
    const [one] = mergeUsers([account(ALICE, "alice@example.test", { createdAt: null })], NOTHING);
    expect(one?.createdAt).toBe("");
  });
});

/**
 * The provider list is JSONB written by GoTrue — well-formed, but not typed.
 * A page that exists to look at accounts must not be takeable down by one row.
 */
describe("reading the provider list", () => {
  it("takes the list when there is one", () => {
    expect(providersOf({ provider: "google", providers: ["google", "email"] })).toEqual([
      "google",
      "email",
    ]);
  });

  it("falls back to the single provider", () => {
    expect(providersOf({ provider: "email" })).toEqual(["email"]);
  });

  it("gives an empty list for anything it does not recognise", () => {
    for (const odd of [null, undefined, {}, "google", 7, { providers: "google" }, { providers: [1, 2] }]) {
      expect(providersOf(odd)).toEqual([]);
    }
  });
});
