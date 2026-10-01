/**
 * **Gift vouchers** — extra free articles, given by the administrator to an
 * email address and claimed by the account that address belongs to.
 * docs/plans/261001m-gift-vouchers-for-free-articles.md, and
 * docs/project/billing.md § *Gift vouchers*.
 *
 * The quota is an abuse boundary (billing.md § *The quota*), and a voucher
 * raises it, so most of what is here is about what must **not** happen:
 *
 * - a voucher nobody has claimed, a revoked one, one addressed to somebody else,
 *   and one whose address the Auth service does not confirm grant nothing;
 * - a paid account's limit does not move;
 * - twenty concurrent ingests on a 3+2 account admit exactly five;
 * - a revoke that races an admission cannot admit past the new limit — the
 *   held-transaction shape tests/billing-quota-race.test.ts uses, because a
 *   race that passes by luck proves nothing;
 * - nobody but the administrator reaches `/api/admin/vouchers`;
 * - the reader's wire carries no note, creator or address.
 *
 * And one regression that is about arithmetic: `sum()` arrives from Postgres as
 * a string unless cast, and `3 + "20"` is `"320"` (GPT Sol, plan review F1), so
 * the limit is asserted as the exact number.
 *
 * The Auth Admin API lookup is replaced: the private test database is not the
 * one GoTrue reads, so the real lookup could only ever answer *unavailable*
 * here. `confirmedAccountEmail` itself is a fetch and a few field checks,
 * covered with a stubbed fetch below.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { articles } from "../src/billing/points.js";
import { FREE_LIFETIME_INGESTS } from "../src/billing/tiers.js";
import type { TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { handleApi } from "../src/routes.js";
import type { AccountConfirmation } from "../src/store/admin-accounts.js";
import { entitlementFromRow, freeEntitlement, reserveIngest } from "../src/store/pg-billing.js";
import type { BillingRow } from "../src/store/pg-billing.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import {
  claimVouchersFor,
  createVoucher,
  listVouchers,
  parseNewVoucher,
  parseVoucherPatch,
  updateVoucher,
} from "../src/store/pg-vouchers.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* **The route's lookup, replaced** — see the header. Per owner, so a test says
   exactly what the Auth service would answer for whom; anybody not in the map
   is `unavailable`, which is what a real outage looks like. */
const auth = vi.hoisted(() => ({ answers: new Map<string, AccountConfirmation>() }));
vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    confirmedAccountEmail: async (ownerId: string) =>
      auth.answers.get(ownerId) ?? { kind: "unavailable", reason: "not in this test's map" },
    accountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
  };
});

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/billing-vouchers.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.billing_vouchers"],
  keepPool: true,
  max: 8,
});

/* Owners minted per run under a fixed stem, so a killed run's rubble is swept
   by the next and two processes running this file cannot collide. */
const STEM = "0000b0c4-0000-4000-8000-";
const RUBBLE = `${STEM}%`;
const mint = () => `${STEM}${randomUUID().slice(-12)}`;
const READER = mint();
const OTHER = mint();
const emailOf = (owner: string) => `gift-${owner}@example.invalid`;

const READER_PRICE = "price_reader_for_voucher_tests";
const PRICES: readonly TierRow[] = [
  {
    id: "reader",
    productName: "Spideryarn Reader",
    description: "20 articles a month.",
    ingestsPerPeriod: 20,
    lookupKey: "spideryarn_reader_monthly",
    stripePriceId: READER_PRICE,
    livemode: false,
    active: true,
    sortOrder: 10,
    amounts: { usd: 1000 },
  },
];

const confirmed = (owner: string): ClaimDepsLookup => async () => ({ kind: "confirmed", email: emailOf(owner) });
type ClaimDepsLookup = (ownerId: string) => Promise<AccountConfirmation>;

beforeAll(async () => {
  if (!pool) return;
  await sweep();
  for (const owner of [READER, OTHER]) await seedAuthUser(pool, { id: owner, email: emailOf(owner) });
});

afterEach(async () => {
  auth.answers.clear();
  await sweep();
});

afterAll(async () => {
  if (!pool) return;
  await sweep();
  await pool.query("delete from auth.users where id::text like $1", [RUBBLE]).catch(() => {});
  await pool.end();
});

async function sweep(): Promise<void> {
  if (!pool) return;
  /* Vouchers before accounts: `claimed_by` references the billing anchor. */
  await pool.query(
    "delete from spideryarn.billing_vouchers where email like 'gift-0000b0c4-%' or claimed_by::text like $1",
    [RUBBLE],
  );
  await pool.query("delete from spideryarn.ingest_events where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
  forgetCachedTiers();
}

/** `n` settled private ingests, the way a publication would have charged them. */
async function givenUsed(owner: string, n: number): Promise<void> {
  if (!pool) return;
  for (let i = 0; i < n; i += 1) {
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
       values ($1, now() - interval '1 day', now() - interval '1 hour')`,
      [owner],
    );
  }
}

/** A voucher for `owner`'s address, unclaimed. */
async function givenVoucher(owner: string, n: number, note: string | null = null): Promise<string> {
  const made = await createVoucher({ id: randomUUID(), email: emailOf(owner), articles: n, note }, ADMIN_USER_ID_LOCAL);
  if (made.kind !== "created") throw new Error(`expected a new voucher, got ${made.kind}`);
  return made.id;
}

/** How many vouchers one claim bound. */
async function claims(...args: Parameters<typeof claimVouchersFor>): Promise<number> {
  return (await claimVouchersFor(...args)).claimed;
}

async function makePaid(owner: string, status = "active"): Promise<void> {
  if (!pool) return;
  const start = new Date(Date.now() - 5 * 86_400_000);
  const end = new Date(Date.now() + 25 * 86_400_000);
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
        current_period_start, current_period_end)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (owner_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       price_id = excluded.price_id, status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end`,
    [owner, `cus_${owner}`, `sub_${owner}`, READER_PRICE, status, start, end],
  );
}

async function limitOf(owner: string): Promise<unknown> {
  const answer = await reserveIngest(owner, undefined, PRICES);
  if (answer.kind === "admitted") return answer.entitlement.limit;
  if (answer.kind === "refused") return answer.limit;
  return answer.kind;
}

/* ------------------------------------------------------------- the bonus -- */

describe("a claimed voucher raises the free allowance, and nothing else does", () => {
  it("admits a fourth ingest that a plain free account is refused, at a limit of exactly 3 + 20", async () => {
    await givenUsed(READER, 3);
    await givenUsed(OTHER, 3);
    await givenVoucher(READER, 20);
    expect(await claims({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) })).toBe(1);

    const gifted = await reserveIngest(READER, undefined, PRICES);
    expect(gifted.kind).toBe("admitted");
    if (gifted.kind !== "admitted") throw new Error("expected an admission");
    /* **The number, and its type** — `"320"` would also be truthy. F1. */
    expect(gifted.entitlement.limit).toBe(FREE_LIFETIME_INGESTS + 20);
    expect(typeof gifted.entitlement.limit).toBe("number");

    expect((await reserveIngest(OTHER, undefined, PRICES)).kind).toBe("refused");
  });

  it("grants nothing for a voucher nobody has claimed", async () => {
    await givenUsed(READER, 3);
    await givenVoucher(READER, 20);
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS);
  });

  it("does not claim a revoked voucher, and a revoke after the claim takes the gift back", async () => {
    const id = await givenVoucher(READER, 20);
    expect(await updateVoucher(id, { revoked: true })).toEqual({ kind: "updated" });
    expect(await claims({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) })).toBe(0);
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS);

    /* Restored, claimed, then revoked again. */
    await updateVoucher(id, { revoked: false });
    expect(await claims({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) })).toBe(1);
    await sweepReservations(READER);
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS + 20);
    await updateVoucher(id, { revoked: true });
    await sweepReservations(READER);
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS);
  });

  it("does not claim a voucher addressed to somebody else", async () => {
    await givenVoucher(OTHER, 20);
    expect(await claims({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) })).toBe(0);
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS);
  });

  it("does not claim when the Auth service will not confirm the address", async () => {
    await givenVoucher(READER, 20);
    const user = { id: READER, email: emailOf(READER) };
    for (const answer of [
      { kind: "unconfirmed" },
      { kind: "unavailable", reason: "down" },
      /* Confirmed, but a different address: the JWT and the record disagree. */
      { kind: "confirmed", email: "someone-else@example.invalid" },
    ] as const) {
      expect(await claims(user, { lookup: async () => answer })).toBe(0);
    }
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS);
  });

  it("matches the address however the JWT cases or pads it", async () => {
    await givenVoucher(READER, 5);
    const shouted = `  ${emailOf(READER).toUpperCase()} `;
    expect(
      await claims({ id: READER, email: shouted }, { lookup: async () => ({ kind: "confirmed", email: shouted }) }),
    ).toBe(1);
  });

  it("leaves a paid account's limit exactly where its tier puts it", async () => {
    await givenVoucher(READER, 20);
    await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });
    await makePaid(READER);
    expect(await limitOf(READER)).toBe(20);
  });

  it("gives a lapsed reader the gift back, since they are on Free again", async () => {
    await givenVoucher(READER, 20);
    await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });
    await makePaid(READER, "canceled");
    expect(await limitOf(READER)).toBe(FREE_LIFETIME_INGESTS + 20);
  });
});

/** Release whatever `limitOf` reserved, so the next reading starts from the same usage. */
async function sweepReservations(owner: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    "delete from spideryarn.ingest_events where owner_id = $1 and succeeded_at is null and released_at is null",
    [owner],
  );
}

describe("the sum is a number, or the read refuses", () => {
  const row: BillingRow = {
    status: null,
    priceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    quotaLimitDelta: null,
    quotaPeriodStart: null,
    voucherArticles: 20,
  };

  it("adds a numeric sum", () => {
    expect(freeEntitlement(row)).toEqual({ tier: "free", limit: articles(23) });
    expect(entitlementFromRow(row, PRICES, new Date())).toEqual({ tier: "free", limit: 23 });
  });

  it("throws on the string a bare sum() would have been, rather than making 320", () => {
    expect(() => freeEntitlement({ ...row, voucherArticles: "20" as unknown as number })).toThrow(/not a count/);
    expect(() => freeEntitlement({ ...row, voucherArticles: -1 })).toThrow(/not a count/);
    expect(() => freeEntitlement({ ...row, voucherArticles: 1.5 })).toThrow(/not a count/);
  });
});

/* ------------------------------------------------------------ concurrency -- */

describe("concurrent admissions and revokes", () => {
  it("admits exactly five of twenty concurrent ingests on a 3 + 2 account", async () => {
    await givenVoucher(READER, 2);
    await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveIngest(READER, undefined, PRICES)));
    expect(results.filter((r) => r.kind === "admitted")).toHaveLength(5);
    expect(results.filter((r) => r.kind === "refused")).toHaveLength(15);
  });

  /**
   * **The revoke commits while the admission waits on the lock.** The admission
   * must read the bonus *after* it holds the lock, in a statement of its own;
   * read in the locking statement, its snapshot predates the revoke and it
   * admits against the old limit (F2).
   */
  it("an admission waiting behind a revoke sees the revoke", async () => {
    if (!pool) return;
    const id = await givenVoucher(READER, 2);
    await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });
    await givenUsed(READER, 3);

    const a = await pool.connect();
    try {
      /* What `updateVoucher` does, held open: billing row first, then the voucher. */
      await a.query("begin isolation level read committed");
      await a.query("select 1 from spideryarn.billing_accounts where owner_id = $1 for update", [READER]);
      await a.query("update spideryarn.billing_vouchers set revoked_at = now() where id = $1", [id]);

      let settled = false;
      const admission = reserveIngest(READER, undefined, PRICES).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);

      await a.query("commit");
      const answer = await admission;
      expect(answer.kind).toBe("refused");
      if (answer.kind === "refused") expect(answer.limit).toBe(FREE_LIFETIME_INGESTS);
    } finally {
      /* A failed assertion above must not hand a connection back mid-transaction, holding the lock. */
      await a.query("rollback").catch(() => {});
      a.release();
    }
  });

  /** And the other half: `updateVoucher` really does wait for the billing lock. */
  it("a revoke waits for an admission that holds the claimant's billing row", async () => {
    if (!pool) return;
    const id = await givenVoucher(READER, 2);
    await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });

    const a = await pool.connect();
    try {
      await a.query("begin isolation level read committed");
      await a.query("select 1 from spideryarn.billing_accounts where owner_id = $1 for update", [READER]);

      let settled = false;
      const revoke = updateVoucher(id, { revoked: true }).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);

      await a.query("commit");
      expect(await revoke).toEqual({ kind: "updated" });
    } finally {
      /* A failed assertion above must not hand a connection back mid-transaction, holding the lock. */
      await a.query("rollback").catch(() => {});
      a.release();
    }
  });
});

/* ----------------------------------------------------- the administrator -- */

describe("the administrator's side", () => {
  it("refuses to change the address of a claimed voucher, and allows it before", async () => {
    const id = await givenVoucher(READER, 3);
    /* A real change of address queues the recipient's email again (261001p). */
    expect(await updateVoucher(id, { email: emailOf(OTHER) })).toEqual({ kind: "updated", giftDelivery: expect.any(String) });
    expect(await claims({ id: OTHER, email: emailOf(OTHER) }, { lookup: confirmed(OTHER) })).toBe(1);
    expect(await updateVoucher(id, { email: emailOf(READER) })).toEqual({ kind: "claimed" });
    expect(await updateVoucher(id, { articles: 7, note: "raised" })).toEqual({ kind: "updated" });
    expect(await updateVoucher(randomUUID(), { articles: 7 })).toEqual({ kind: "not-found" });
  });

  it("lists a claimed voucher with the claimant's free usage", async () => {
    await givenUsed(READER, 1);
    const id = await givenVoucher(READER, 4, "for the reading group");
    await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });
    const listed = (await listVouchers()).find((v) => v.id === id);
    expect(listed).toMatchObject({
      email: emailOf(READER),
      articles: 4,
      note: "for the reading group",
      claimedBy: READER,
      claimant: { kind: "free", used: 1, limit: 7, remaining: 6, lapsed: false },
    });
  });

  it("validates a body strictly", () => {
    const id = randomUUID();
    expect(parseNewVoucher({ id, email: " A@B.example ", articles: 20 })).toEqual({
      ok: true,
      value: { id, email: "a@b.example", articles: 20, note: null },
    });
    /* The id is the browser's, and required: it is what makes a replay the same create. */
    expect(parseNewVoucher({ email: "a@b.example", articles: 20 }).ok).toBe(false);
    expect(parseNewVoucher({ id: "not-a-uuid", email: "a@b.example", articles: 20 }).ok).toBe(false);
    for (const bad of [
      { email: "a@b.example", articles: 0 },
      { email: "a@b.example", articles: 1001 },
      { email: "a@b.example", articles: 2.5 },
      { email: "a@b.example", articles: "20" },
      { email: "not an address", articles: 2 },
      { email: "a@b.example", articles: 2, note: "x".repeat(501) },
      { email: "a@b.example", artcles: 2 },
      [],
      null,
    ]) {
      expect(parseNewVoucher(bad).ok).toBe(false);
    }
    expect(parseVoucherPatch({}).ok).toBe(false);
    expect(parseVoucherPatch({ revoked: "yes" }).ok).toBe(false);
    expect(parseVoucherPatch({ revoked: true, note: "  " })).toEqual({ ok: true, value: { revoked: true, note: null } });
  });
});

/* -------------------------------------------------------------- the wire -- */

describe("the routes", () => {
  it("refuses every voucher route to anybody but the administrator", async () => {
    const id = await givenVoucher(OTHER, 3);
    for (const [method, url, body] of [
      ["GET", "/api/admin/vouchers", ""],
      ["POST", "/api/admin/vouchers", JSON.stringify({ id: randomUUID(), email: emailOf(READER), articles: 1000 })],
      ["PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ articles: 1000 })],
      /* 261001p: the Retry, which can make Spideryarn email an address. */
      ["POST", `/api/admin/voucher-emails/${randomUUID()}/retry`, ""],
    ] as const) {
      const reply = await drive(method, url, body, READER);
      expect(reply.status, `${method} ${url}`).toBe(403);
    }
    /* And nothing was written on the way past. */
    expect((await listVouchers()).filter((v) => v.email === emailOf(READER))).toHaveLength(0);
  });

  it("lets the administrator create, list and revoke", async () => {
    const created = await drive(
      "POST",
      "/api/admin/vouchers",
      JSON.stringify({ id: randomUUID(), email: emailOf(READER), articles: 20, note: "private" }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(created.status).toBe(201);
    const id = String(created.body.id);
    const listed = await drive("GET", "/api/admin/vouchers", "", ADMIN_USER_ID_LOCAL);
    expect(listed.status).toBe(200);
    expect(listed.headers["cache-control"]).toBe("private, no-store");
    expect(JSON.stringify(listed.body)).toContain(id);
    const revoked = await drive("PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ revoked: true }), ADMIN_USER_ID_LOCAL);
    expect(revoked.status).toBe(200);
    const bad = await drive("PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ articles: 5000 }), ADMIN_USER_ID_LOCAL);
    expect(bad.status).toBe(400);
  });

  it("claims on GET /api/billing/usage, and tells the reader the gift without the note, creator or address", async () => {
    await givenUsed(READER, 1);
    const id = await givenVoucher(READER, 20, "SECRET-NOTE");
    auth.answers.set(READER, { kind: "confirmed", email: emailOf(READER) });

    const reply = await drive("GET", "/api/billing/usage", "", READER);
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    const plan = reply.body.plan as Record<string, unknown>;
    expect(plan).toMatchObject({ kind: "free", limit: 23, used: 1, remaining: 22 });
    const gifts = plan.gifts as Record<string, unknown>[];
    expect(gifts).toHaveLength(1);
    expect(Object.keys(gifts[0] ?? {}).sort()).toEqual(["articles", "claimedAt", "noticeKey"]);
    expect(gifts[0]).toMatchObject({ articles: 20, noticeKey: id });
    const wire = JSON.stringify(reply.body);
    expect(wire).not.toContain("SECRET-NOTE");
    expect(wire).not.toContain(ADMIN_USER_ID_LOCAL);
    expect(wire).not.toContain(emailOf(READER));
  });

  it("leaves `gifts` off entirely for a reader without one", async () => {
    const reply = await drive("GET", "/api/billing/usage", "", OTHER);
    expect(reply.status).toBe(200);
    expect(reply.body.plan).not.toHaveProperty("gifts");
  });

  it("serves the plan without the gift when the Auth service cannot confirm", async () => {
    await givenVoucher(READER, 20);
    const reply = await drive("GET", "/api/billing/usage", "", READER);
    expect(reply.status).toBe(200);
    expect(reply.body.plan).toMatchObject({ kind: "free", limit: FREE_LIFETIME_INGESTS });
  });
});

/* ---------------------------------------------------- the Auth lookup -- */

describe("confirmedAccountEmail, the real one", () => {
  /* The module is mocked for the routes; the original is what is under test here. */
  const real = vi.importActual<typeof import("../src/store/admin-accounts.js")>("../src/store/admin-accounts.js");
  const ENDPOINT = () => ({ url: "http://auth.invalid", key: "k" });
  const answering = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("confirms only an address with email_confirmed_at, about this account", async () => {
    const { confirmedAccountEmail: lookup } = await real;
    const id = randomUUID();
    const deps = (body: unknown, status?: number) => ({ endpoint: ENDPOINT, fetch: answering(body, status) });
    expect(await lookup(id, deps({ id, email: "a@b.example", email_confirmed_at: "2026-10-01T00:00:00Z" }))).toEqual({
      kind: "confirmed",
      email: "a@b.example",
    });
    expect(await lookup(id, deps({ id, email: "a@b.example", email_confirmed_at: null }))).toEqual({ kind: "unconfirmed" });
    /* `confirmed_at` is email *or* phone — not enough. */
    expect(await lookup(id, deps({ id, email: "a@b.example", confirmed_at: "2026-10-01T00:00:00Z" }))).toEqual({
      kind: "unconfirmed",
    });
    expect(
      await lookup(id, deps({ id, email: "a@b.example", email_confirmed_at: "2026-10-01T00:00:00Z", deleted_at: "2026-10-01T00:00:00Z" })),
    ).toEqual({ kind: "unconfirmed" });
    expect((await lookup(id, deps({ id: randomUUID(), email: "a@b.example", email_confirmed_at: "2026-10-01T00:00:00Z" }))).kind).toBe(
      "unavailable",
    );
    expect((await lookup(id, deps({}, 500))).kind).toBe("unavailable");
  });
});

/* ---------------------------------------------------------------- driving -- */

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Says yes, as whichever owner is asked for, with that owner's address. */
function signedInAs(owner: string): Verifier {
  return async () => ({ ok: true, claims: { sub: owner, email: emailOf(owner), role: "authenticated" } });
}

/** Drive `handleApi` with a fake request/response pair, as tests/billing-usage-route.test.ts does. */
async function drive(method: string, url: string, raw: string, owner: string): Promise<Reply> {
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method, url, headers: { authorization: "Bearer test-token", "content-type": "application/json" } },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, signedInAs(owner));
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers };
}
