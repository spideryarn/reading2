/**
 * **The emails a gift voucher sends** — to its recipient when it is made or
 * readdressed, to its creator when it is claimed — and the at-most-once outbox
 * behind them. docs/plans/261001p-voucher-emails-to-recipient-and-creator.md;
 * src/store/pg-voucher-emails.ts.
 *
 * **No real email can leave.** Every send here goes through an injected
 * `fetch` (the `EmailDeps` seam) with an env that says production, and
 * tests/setup/provider-guard.ts refuses api.resend.com anyway. Route-driven
 * sends reach the same seam because `sendQueuedVoucherEmail` and
 * `deliverReservedVoucherEmail` are wrapped below to take `control.deps` when
 * the route passes none.
 *
 * The Auth Admin API is replaced, as in tests/billing-vouchers.test.ts: the
 * private test database is not the one GoTrue reads.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const HOISTED = vi.hoisted(() => {
  /* Raised before any import, so `src/log.ts` captures it — the log-capture
     tests below need info lines to exist (tests/helpers/log-capture.ts). */
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "info";
  return { level };
});

const control = vi.hoisted(() => ({
  /** What a route-driven send is given: set per test. */
  deps: {} as import("../src/store/pg-voucher-emails.js").VoucherEmailDeps,
  /** Make the claim's outbox insert throw, inside the claim's transaction. */
  failQueueClaimed: false,
  auth: new Map<string, import("../src/store/admin-accounts.js").AccountConfirmation>(),
  /** Who has each address, for the gift email's audience (261002a). Anybody not in it is `none`. */
  byEmail: new Map<string, import("../src/store/admin-accounts.js").AccountByEmail>(),
}));

vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    confirmedAccountEmail: async (ownerId: string) =>
      control.auth.get(ownerId) ?? { kind: "unavailable", reason: "not in this test's map" },
    accountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
    confirmedAccountByEmail: async (email: string) => control.byEmail.get(email) ?? { kind: "none" },
  };
});

vi.mock("../src/store/pg-voucher-emails.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/pg-voucher-emails.js")>();
  return {
    ...real,
    sendQueuedVoucherEmail: (id: string, deps?: import("../src/store/pg-voucher-emails.js").VoucherEmailDeps) =>
      real.sendQueuedVoucherEmail(id, deps ?? control.deps),
    deliverReservedVoucherEmail: (
      id: string,
      attempts: number,
      deps?: import("../src/store/pg-voucher-emails.js").VoucherEmailDeps,
    ) => real.deliverReservedVoucherEmail(id, attempts, deps ?? control.deps),
    queueClaimedEmail: (...args: Parameters<typeof real.queueClaimedEmail>) => {
      if (control.failQueueClaimed) throw new Error("the outbox insert failed, on purpose");
      return real.queueClaimedEmail(...args);
    },
  };
});

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { loadEnvLocal } from "../src/env.js";
import { handleApi } from "../src/routes.js";
import type { AccountEmail } from "../src/store/admin-accounts.js";
import {
  type GiftAudience,
  type VoucherEmailDeps,
  deliverReservedVoucherEmail,
  giftMessage,
  reserveVoucherEmailRetry,
  sendQueuedVoucherEmail,
  voucherEmailsFor,
} from "../src/store/pg-voucher-emails.js";
import { claimVouchersFor, createVoucher, giftAudienceFor, listVouchers, updateVoucher } from "../src/store/pg-vouchers.js";
import { articles, points } from "../src/billing/points.js";
import { ADMIN_VOUCHERS_URL } from "../src/urls.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Put the level back straight away: vitest reuses a worker across files, and
   the modules above have already captured it. */
if (HOISTED.level === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.level;

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/billing-voucher-emails.test.ts",
  tables: ["spideryarn.billing_vouchers", "spideryarn.billing_voucher_emails"],
  keepPool: true,
  max: 8,
});

/* Owners minted per run under a stem of this file's own (billing-vouchers uses
   0000b0c4), so the two files cannot sweep each other's rows. */
const STEM = "0000b0c5-0000-4000-8000-";
const RUBBLE = `${STEM}%`;
const mint = () => `${STEM}${randomUUID().slice(-12)}`;
const READER = mint();
const OTHER = mint();
const CREATOR_A = mint();
const CREATOR_B = mint();
const emailOf = (owner: string) => `vmail-${owner}@example.invalid`;
const creatorEmail = (owner: string) => `creator-${owner}@example.invalid`;
const SECRET_NOTE = "SECRET-NOTE-do-not-send";

const PROD = { VERCEL_ENV: "production", RESEND_API_KEY: "re_test_key" } as const;

beforeAll(async () => {
  if (!pool) return;
  await sweep();
  for (const owner of [READER, OTHER]) await seedAuthUser(pool, { id: owner, email: emailOf(owner) });
});

afterEach(async () => {
  control.deps = {};
  control.failQueueClaimed = false;
  control.auth.clear();
  control.byEmail.clear();
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
  /* Deliveries go with their voucher (on delete cascade). */
  await pool.query(
    "delete from spideryarn.billing_vouchers where email like 'vmail-0000b0c5-%' or claimed_by::text like $1",
    [RUBBLE],
  );
  await pool.query("delete from spideryarn.ingest_events where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.articles where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
}

/* ------------------------------------------------------------- the fakes -- */

interface Sent {
  readonly to: string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly key: string | undefined;
}

/**
 * **A fake Resend**: records every request, answers 200 unless `answer` says
 * otherwise. Its `deps` also carry the creator lookup, so one object is the
 * whole outside world for a test.
 */
function mailbox(
  opts: {
    answer?: (sent: Sent) => Response | Promise<Response>;
    lookup?: (ownerId: string) => Promise<AccountEmail>;
  } = {},
) {
  const sent: Sent[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Omit<Sent, "key">;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const one: Sent = { ...body, key: headers["idempotency-key"] };
    sent.push(one);
    if (opts.answer) return await opts.answer(one);
    return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
  });
  const deps: VoucherEmailDeps = {
    email: { fetch, env: PROD },
    lookupCreator: opts.lookup ?? (async (owner) => ({ kind: "found", email: creatorEmail(owner) })),
  };
  return { sent, fetch, deps };
}

const resendError = (status: number, name: string) => async () =>
  new Response(JSON.stringify({ statusCode: status, name, message: "said something about the request" }), { status });

/** One delivery row, as the database has it. */
async function delivery(id: string): Promise<Record<string, unknown>> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query("select * from spideryarn.billing_voucher_emails where id = $1", [id]);
  const [row] = rows as Record<string, unknown>[];
  if (!row) throw new Error(`no delivery ${id}`);
  return row;
}

async function deliveriesOf(voucherId: string) {
  return await voucherEmailsFor(voucherId);
}

/** A voucher made through the store, with its gift delivery queued and unsent. */
async function givenVoucher(
  owner: string,
  n: number,
  createdBy = CREATOR_A,
  note: string | null = SECRET_NOTE,
  recipientNote: string | null = null,
): Promise<{ id: string; delivery: string }> {
  const made = await createVoucher(
    { id: randomUUID(), email: emailOf(owner), articles: n, note, recipientNote },
    createdBy,
  );
  if (made.kind !== "created") throw new Error(`expected a new voucher, got ${made.kind}`);
  return { id: made.id, delivery: made.delivery };
}

async function backdateLease(id: string, minutes: number): Promise<void> {
  await pool?.query(
    `update spideryarn.billing_voucher_emails
        set attempt_started_at = now() - make_interval(mins => $2), updated_at = now() - make_interval(mins => $2)
      where id = $1`,
    [id, minutes],
  );
}

const confirmed = (owner: string) => async () => ({ kind: "confirmed" as const, email: emailOf(owner) });

/* ----------------------------------------------- the recipient's email -- */

describe("on create, the recipient is emailed once, after the response", () => {
  it("queues one gift delivery and makes exactly one call: to the address, with N and the key, and no note", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const id = randomUUID();
    const reply = await drive(
      "POST",
      "/api/admin/vouchers",
      JSON.stringify({ id, email: emailOf(READER), articles: 20, note: SECRET_NOTE }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({ id, email: "queued" });

    const [row, ...more] = await deliveriesOf(id);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({ kind: "gift", status: "sent", attempts: 1, detail: null, recipient: emailOf(READER) });

    expect(box.fetch).toHaveBeenCalledTimes(1);
    const [mail] = box.sent;
    expect(mail?.to).toEqual([emailOf(READER)]);
    expect(mail?.key).toBe(`voucher-email/${row?.id}`);
    expect(mail?.subject).toBe("A gift of 20 free articles on Spideryarn");
    for (const part of [mail?.text ?? "", mail?.html ?? ""]) {
      expect(part).toContain("20 free articles");
      expect(part).toContain("https://www.spideryarn.com/login");
      /* Never the note, the creator, or the voucher's id. */
      expect(part).not.toContain(SECRET_NOTE);
      expect(part).not.toContain(CREATOR_A);
      expect(part).not.toContain(ADMIN_USER_ID_LOCAL);
      expect(part).not.toContain(id);
    }
    expect(mail?.html).toMatch(/^<!doctype html>/);
  });

  it("says the free allowance from the constant, and pluralises one", () => {
    expect(giftMessage(20).text).toContain("on top of the three articles every free account starts with");
    expect(giftMessage(1).subject).toBe("A gift of 1 free article on Spideryarn");
  });

  it("treats a replayed create as the same create — one after the other and at once — and a different body as 409", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const id = randomUUID();
    const body = JSON.stringify({ id, email: emailOf(READER), articles: 5, note: "n" });
    expect((await drive("POST", "/api/admin/vouchers", body, ADMIN_USER_ID_LOCAL)).status).toBe(201);
    const again = await drive("POST", "/api/admin/vouchers", body, ADMIN_USER_ID_LOCAL);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id, email: "replayed" });

    const id2 = randomUUID();
    const body2 = JSON.stringify({ id: id2, email: emailOf(OTHER), articles: 5, note: null });
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => drive("POST", "/api/admin/vouchers", body2, ADMIN_USER_ID_LOCAL)),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);

    expect(await deliveriesOf(id)).toHaveLength(1);
    expect(await deliveriesOf(id2)).toHaveLength(1);
    expect(box.fetch).toHaveBeenCalledTimes(2);

    for (const different of [
      { id, email: emailOf(READER), articles: 6, note: "n" },
      { id, email: emailOf(OTHER), articles: 5, note: "n" },
      { id, email: emailOf(READER), articles: 5, note: null },
    ]) {
      const refused = await drive("POST", "/api/admin/vouchers", JSON.stringify(different), ADMIN_USER_ID_LOCAL);
      expect(refused.status).toBe(409);
    }
    expect(await deliveriesOf(id)).toHaveLength(1);
    expect(box.fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves the voucher created and the delivery failed when Resend answers 500, or fetch throws", async () => {
    for (const [answer, detail] of [
      [async () => new Response("{}", { status: 500 }), "Resend answered 500"],
      [
        async () => {
          throw new TypeError("network down");
        },
        "request outcome unknown (TypeError)",
      ],
    ] as const) {
      control.deps = mailbox({ answer }).deps;
      const id = randomUUID();
      const reply = await drive(
        "POST",
        "/api/admin/vouchers",
        JSON.stringify({ id, email: emailOf(READER), articles: 3 }),
        ADMIN_USER_ID_LOCAL,
      );
      expect(reply.status).toBe(201);
      expect((await listVouchers()).some((v) => v.id === id)).toBe(true);
      const [row] = await deliveriesOf(id);
      expect(row).toMatchObject({ status: "failed", detail });
      expect(String(row?.detail)).not.toContain("@");
    }
  });

  it("records skipped, with the reason, outside production — and sends nothing", async () => {
    const box = mailbox();
    const { delivery: id } = await givenVoucher(READER, 2);
    await sendQueuedVoucherEmail(id, { ...box.deps, email: { fetch: box.fetch, env: { RESEND_API_KEY: "k" } } });
    expect(box.fetch).not.toHaveBeenCalled();
    expect(await delivery(id)).toMatchObject({ status: "skipped", detail: "not production" });
  });

  it("keeps the 201 when reserve throws, leaving the delivery queued and retryable", async () => {
    const box = mailbox();
    control.deps = {
      ...box.deps,
      reserve: async () => {
        throw new Error("the database went away");
      },
    };
    const id = randomUUID();
    const reply = await drive(
      "POST",
      "/api/admin/vouchers",
      JSON.stringify({ id, email: emailOf(READER), articles: 3 }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(reply.status).toBe(201);
    expect(box.fetch).not.toHaveBeenCalled();
    const listed = (await listVouchers()).find((v) => v.id === id);
    expect(listed?.emails.gift).toMatchObject({ status: "queued", attempts: 0, retryable: true });
  });

  it("leaves a send whose completion threw as sending; Retry takes it after ten minutes, with the same key and body", async () => {
    const box = mailbox();
    const { id: voucher, delivery: id } = await givenVoucher(READER, 4);
    await sendQueuedVoucherEmail(id, {
      ...box.deps,
      complete: async () => {
        throw new Error("the database went away");
      },
    });
    expect(box.fetch).toHaveBeenCalledTimes(1);
    expect(await delivery(id)).toMatchObject({ status: "sending", attempts: 1 });

    /* Not yet: the lease is fresh. */
    expect(await reserveVoucherEmailRetry(id)).toEqual({ kind: "refused" });
    expect((await listVouchers()).find((v) => v.id === voucher)?.emails.gift?.retryable).toBe(false);

    await backdateLease(id, 11);
    expect((await listVouchers()).find((v) => v.id === voucher)?.emails.gift?.retryable).toBe(true);
    control.deps = box.deps;
    const reply = await drive("POST", `/api/admin/voucher-emails/${id}/retry`, "", ADMIN_USER_ID_LOCAL);
    expect(reply.status).toBe(202);
    expect(reply.headers["cache-control"]).toBe("private, no-store");

    expect(box.fetch).toHaveBeenCalledTimes(2);
    const [first, second] = box.sent;
    expect(second?.key).toBe(first?.key);
    expect(second).toEqual(first);
    expect(await delivery(id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("records a different body under a key as a breach, but keeps a concurrent same-key request ambiguous", async () => {
    const breach = mailbox({ answer: resendError(409, "invalid_idempotent_request") });
    const { delivery: a } = await givenVoucher(READER, 2);
    const said = await logLinesWhile(async () => {
      await sendQueuedVoucherEmail(a, breach.deps);
    });
    expect(await delivery(a)).toMatchObject({ status: "failed", detail: "Resend answered 409 invalid_idempotent_request" });
    expect(said).toContain("an invariant is broken");
    expect(said).not.toContain("said something about the request");

    const busy = mailbox({ answer: resendError(409, "concurrent_idempotent_requests") });
    const { id: voucher, delivery: b } = await givenVoucher(OTHER, 2);
    await sendQueuedVoucherEmail(b, busy.deps);
    expect(await delivery(b)).toMatchObject({
      status: "sending",
      detail: null,
    });
    expect((await listVouchers()).find((v) => v.id === voucher)?.emails.gift?.retryable).toBe(false);
    await backdateLease(b, 11);
    expect((await listVouchers()).find((v) => v.id === voucher)?.emails.gift?.retryable).toBe(true);
  });
});

/* -------------------------------------------------------- at most once -- */

describe("at most once", () => {
  it("makes one call however many automatic sends race for one delivery", async () => {
    const box = mailbox();
    const { delivery: id } = await givenVoucher(READER, 2);
    await Promise.all(Array.from({ length: 10 }, () => sendQueuedVoucherEmail(id, box.deps)));
    expect(box.fetch).toHaveBeenCalledTimes(1);
    expect(await delivery(id)).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("makes one call when an automatic send and Retry race for a queued delivery", async () => {
    const box = mailbox();
    const { delivery: id } = await givenVoucher(READER, 2);
    const retry = async () => {
      const reserved = await reserveVoucherEmailRetry(id);
      if (reserved.kind === "reserved") await deliverReservedVoucherEmail(id, reserved.attempts, box.deps);
    };
    await Promise.all([sendQueuedVoucherEmail(id, box.deps), retry()]);
    expect(box.fetch).toHaveBeenCalledTimes(1);
    expect(await delivery(id)).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("lets one of many concurrent Retries reserve an already-old row", async () => {
    const box = mailbox();
    const { delivery: id } = await givenVoucher(READER, 2);
    await pool?.query("update spideryarn.billing_voucher_emails set status = 'failed' where id = $1", [id]);
    await backdateLease(id, 60);
    const answers = await Promise.all(Array.from({ length: 10 }, () => reserveVoucherEmailRetry(id)));
    const won = answers.filter((a) => a.kind === "reserved");
    expect(won).toHaveLength(1);
    expect(answers.filter((a) => a.kind === "refused")).toHaveLength(9);
    const [mine] = won;
    if (mine?.kind !== "reserved") throw new Error("expected a reservation");
    await deliverReservedVoucherEmail(id, mine.attempts, box.deps);
    expect(box.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let an attempt that lost its lease record over the one that took it", async () => {
    const { delivery: id } = await givenVoucher(READER, 2);
    await pool?.query(
      "update spideryarn.billing_voucher_emails set status = 'sending', attempts = 1, attempt_started_at = now() - interval '11 minutes' where id = $1",
      [id],
    );
    const taken = await reserveVoucherEmailRetry(id);
    expect(taken).toEqual({ kind: "reserved", attempts: 2 });
    /* Attempt 1 comes back late, with a failure. */
    const stale = mailbox({ answer: async () => new Response("{}", { status: 500 }) });
    const said = await logLinesWhile(async () => {
      await deliverReservedVoucherEmail(id, 1, stale.deps);
    });
    expect(await delivery(id)).toMatchObject({ status: "sending", attempts: 2 });
    expect(stale.fetch).not.toHaveBeenCalled();
    expect(said).toContain("no longer owns the delivery");
    expect(said).not.toContain("@example.invalid");
  });

  it("refuses a Retry after sent, and while a fresh attempt is sending", async () => {
    const box = mailbox();
    const { delivery: id } = await givenVoucher(READER, 2);
    await sendQueuedVoucherEmail(id, box.deps);
    const reply = await drive("POST", `/api/admin/voucher-emails/${id}/retry`, "", ADMIN_USER_ID_LOCAL);
    expect(reply.status).toBe(409);
    expect(String(reply.body.error)).toMatch(/cannot be retried/);
    expect(box.fetch).toHaveBeenCalledTimes(1);

    const { delivery: fresh } = await givenVoucher(OTHER, 2);
    await pool?.query(
      "update spideryarn.billing_voucher_emails set status = 'sending', attempts = 1, attempt_started_at = now() - interval '1 minute' where id = $1",
      [fresh],
    );
    expect(await reserveVoucherEmailRetry(fresh)).toEqual({ kind: "refused" });
  });

  it("refuses a gift Retry once sent, revoked or readdressed, but lets a genuinely failed gift retry after claim", async () => {
    /* A delivered gift remains at most once after claim. This is distinct from
       the unclaimed `sent` case above: claimed gifts are the predicate changed
       in 261002a. */
    const delivered = mailbox();
    const sent = await givenVoucher(READER, 2);
    await sendQueuedVoucherEmail(sent.delivery, delivered.deps);
    expect((await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) })).claimed).toBe(1);
    expect(await reserveVoucherEmailRetry(sent.delivery)).toEqual({ kind: "refused" });
    expect(delivered.fetch).toHaveBeenCalledTimes(1);

    /* A definite provider refusal, followed by a claim before anybody looked:
       Retry still takes it (261002a, Sol F1), and sends its first copy. */
    let refuse = true;
    const box = mailbox({
      answer: async () =>
        refuse
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify({ id: "re_retry" }), { status: 200 }),
    });
    const claimedOne = await givenVoucher(OTHER, 2);
    await sendQueuedVoucherEmail(claimedOne.delivery, box.deps);
    expect(await delivery(claimedOne.delivery)).toMatchObject({ status: "failed", detail: "Resend answered 500" });
    expect((await claimVouchersFor({ id: OTHER, email: emailOf(OTHER) }, { lookup: confirmed(OTHER) })).claimed).toBe(1);
    refuse = false;
    const reserved = await reserveVoucherEmailRetry(claimedOne.delivery);
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind === "reserved") await deliverReservedVoucherEmail(claimedOne.delivery, reserved.attempts, box.deps);
    expect(box.fetch).toHaveBeenCalledTimes(2);
    expect(await delivery(claimedOne.delivery)).toMatchObject({ status: "sent" });
    box.fetch.mockClear();

    /* Revoked: its queued gift is skipped in the revoke's transaction, and not retryable. */
    const revoked = await givenVoucher(OTHER, 2);
    await updateVoucher(revoked.id, { revoked: true });
    expect(await delivery(revoked.delivery)).toMatchObject({ status: "skipped", detail: "voucher revoked" });
    await sendQueuedVoucherEmail(revoked.delivery, box.deps);
    expect(box.fetch).not.toHaveBeenCalled();
    expect(await reserveVoucherEmailRetry(revoked.delivery)).toEqual({ kind: "refused" });
    /* Restored, it may be retried again. */
    await updateVoucher(revoked.id, { revoked: false });
    expect((await reserveVoucherEmailRetry(revoked.delivery)).kind).toBe("reserved");

    /* Readdressed: the old delivery is for an address the voucher no longer has. */
    const moved = await givenVoucher(OTHER, 3);
    await sendQueuedVoucherEmail(moved.delivery, box.deps);
    await pool?.query("update spideryarn.billing_voucher_emails set status = 'failed' where id = $1", [moved.delivery]);
    await updateVoucher(moved.id, { email: `moved-${emailOf(OTHER)}` });
    expect(await reserveVoucherEmailRetry(moved.delivery)).toEqual({ kind: "refused" });
  });
});

/* ------------------------------------------------- the creator's notice -- */

describe("on claim, the creator is emailed", () => {
  it("sends one notice per voucher to the creator's resolved address, with the claim and no note", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const { id } = await givenVoucher(READER, 20, CREATOR_A);
    box.fetch.mockClear();
    box.sent.length = 0;
    control.auth.set(READER, { kind: "confirmed", email: emailOf(READER) });

    const reply = await drive("GET", "/api/billing/usage", "", READER);
    expect(reply.status).toBe(200);
    expect(reply.body.plan).toMatchObject({ limit: 23 });

    expect(box.fetch).toHaveBeenCalledTimes(1);
    const [mail] = box.sent;
    expect(mail?.to).toEqual([creatorEmail(CREATOR_A)]);
    expect(mail?.subject).toBe("Gift voucher claimed: 20 articles");
    expect(mail?.html).toBeUndefined();
    expect(mail?.text).toContain(`Email: ${emailOf(READER)}`);
    expect(mail?.text).toContain(`Account id: ${READER}`);
    expect(mail?.text).toContain("Articles: 20");
    expect(mail?.text).toMatch(/Claimed: \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    expect(mail?.text).toContain(`All vouchers: ${ADMIN_VOUCHERS_URL}`);
    expect(mail?.text).not.toContain(SECRET_NOTE);

    const claimed = (await deliveriesOf(id)).filter((d) => d.kind === "claimed");
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ status: "sent", recipient: creatorEmail(CREATOR_A) });
  });

  it("sends nothing when the creator's address cannot be looked up, records why, and Retry sends it later", async () => {
    const down = mailbox({ lookup: async () => ({ kind: "unavailable", reason: "Auth answered 503" }) });
    const { id } = await givenVoucher(READER, 2);
    const claim = await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) });
    const [notice] = claim.deliveries;
    if (!notice) throw new Error("expected a notice");
    await sendQueuedVoucherEmail(notice, down.deps);
    expect(down.fetch).not.toHaveBeenCalled();
    expect(await delivery(notice)).toMatchObject({ status: "failed", detail: "creator address unavailable", recipient: null });
    expect((await listVouchers()).find((v) => v.id === id)?.emails.claimed).toMatchObject({
      status: "failed",
      retryable: true,
    });

    const up = mailbox();
    control.deps = up.deps;
    expect((await drive("POST", `/api/admin/voucher-emails/${notice}/retry`, "", ADMIN_USER_ID_LOCAL)).status).toBe(202);
    expect(up.sent.map((m) => m.to)).toEqual([[creatorEmail(CREATOR_A)]]);
  });

  it("freezes the creator's address at the first lookup, so a retry is the same request", async () => {
    const first = mailbox({ answer: async () => new Response("{}", { status: 500 }) });
    await givenVoucher(READER, 2);
    const [notice] = (await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) }))
      .deliveries;
    if (!notice) throw new Error("expected a notice");
    await sendQueuedVoucherEmail(notice, first.deps);
    const later = mailbox({ lookup: async () => ({ kind: "found", email: "someone-new@example.invalid" }) });
    const reserved = await reserveVoucherEmailRetry(notice);
    if (reserved.kind !== "reserved") throw new Error("expected a reservation");
    await deliverReservedVoucherEmail(notice, reserved.attempts, later.deps);
    expect(later.sent[0]).toEqual(first.sent[0]);
    expect(later.sent[0]?.to).toEqual([creatorEmail(CREATOR_A)]);
  });

  it("does not let a creator lookup that outlived its lease call Resend", async () => {
    await givenVoucher(READER, 2);
    const [notice] = (await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) }))
      .deliveries;
    if (!notice) throw new Error("expected a notice");

    let releaseLookup: (answer: AccountEmail) => void = () => {};
    let markLookupStarted: () => void = () => {};
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const stale = mailbox({
      lookup: () => {
        markLookupStarted();
        return new Promise<AccountEmail>((resolve) => {
          releaseLookup = resolve;
        });
      },
    });
    const first = sendQueuedVoucherEmail(notice, stale.deps);
    await lookupStarted;
    await backdateLease(notice, 11);

    const current = mailbox({ lookup: async () => ({ kind: "found", email: "current-creator@example.invalid" }) });
    const reserved = await reserveVoucherEmailRetry(notice);
    if (reserved.kind !== "reserved") throw new Error("expected the stale lease to be taken");
    await deliverReservedVoucherEmail(notice, reserved.attempts, current.deps);
    releaseLookup({ kind: "found", email: "stale-creator@example.invalid" });
    await first;

    expect(current.sent).toHaveLength(1);
    expect(current.sent[0]?.to).toEqual(["current-creator@example.invalid"]);
    expect(stale.fetch).not.toHaveBeenCalled();
    expect(await delivery(notice)).toMatchObject({ status: "sent", attempts: 2, recipient: "current-creator@example.invalid" });
  });

  it("makes one notice from twenty concurrent claims of one voucher", async () => {
    const { id } = await givenVoucher(READER, 2);
    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) }),
      ),
    );
    expect(answers.reduce((n, a) => n + a.claimed, 0)).toBe(1);
    expect(answers.flatMap((a) => a.deliveries)).toHaveLength(1);
    expect((await deliveriesOf(id)).filter((d) => d.kind === "claimed")).toHaveLength(1);
  });

  it("still sends the second notice when two vouchers are claimed at once and the first fails", async () => {
    const box = mailbox({
      answer: async (sent) =>
        sent.to[0] === creatorEmail(CREATOR_A)
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify({ id: "re_ok" }), { status: 200 }),
    });
    const a = await givenVoucher(READER, 2, CREATOR_A);
    const b = await givenVoucher(READER, 3, CREATOR_B);
    control.deps = box.deps;
    control.auth.set(READER, { kind: "confirmed", email: emailOf(READER) });
    expect((await drive("GET", "/api/billing/usage", "", READER)).status).toBe(200);

    const noticeOf = async (voucher: string) => (await deliveriesOf(voucher)).find((d) => d.kind === "claimed");
    expect(await noticeOf(a.id)).toMatchObject({ status: "failed", detail: "Resend answered 500" });
    expect(await noticeOf(b.id)).toMatchObject({ status: "sent" });
  });

  it("commits neither the claim nor its notice when queueing the notice fails, serves the plan, and claims on the next visit", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const { id } = await givenVoucher(READER, 20);
    control.auth.set(READER, { kind: "confirmed", email: emailOf(READER) });

    control.failQueueClaimed = true;
    const first = await drive("GET", "/api/billing/usage", "", READER);
    expect(first.status).toBe(200);
    expect(first.body.plan).toMatchObject({ limit: 3 });
    expect(first.body.plan).not.toHaveProperty("gifts");
    expect((await listVouchers()).find((v) => v.id === id)?.claimedBy).toBeNull();
    expect((await deliveriesOf(id)).filter((d) => d.kind === "claimed")).toHaveLength(0);

    control.failQueueClaimed = false;
    const second = await drive("GET", "/api/billing/usage", "", READER);
    expect(second.body.plan).toMatchObject({ limit: 23 });
    expect((await deliveriesOf(id)).filter((d) => d.kind === "claimed" && d.status === "sent")).toHaveLength(1);
  });

  it("keeps the plan read when reserve or complete throws, leaving the notice queued or sending", async () => {
    const box = mailbox();
    control.deps = {
      ...box.deps,
      reserve: async () => {
        throw new Error("down");
      },
    };
    const a = await givenVoucher(READER, 2);
    control.auth.set(READER, { kind: "confirmed", email: emailOf(READER) });
    const reply = await drive("GET", "/api/billing/usage", "", READER);
    expect(reply.status).toBe(200);
    expect(reply.body.plan).toMatchObject({ limit: 5 });
    expect((await deliveriesOf(a.id)).find((d) => d.kind === "claimed")).toMatchObject({ status: "queued" });

    control.deps = {
      ...box.deps,
      complete: async () => {
        throw new Error("down");
      },
    };
    const b = await givenVoucher(OTHER, 2);
    control.auth.set(OTHER, { kind: "confirmed", email: emailOf(OTHER) });
    expect((await drive("GET", "/api/billing/usage", "", OTHER)).status).toBe(200);
    expect((await deliveriesOf(b.id)).find((d) => d.kind === "claimed")).toMatchObject({ status: "sending" });
  });
});

/* ----------------------------------------------------- address changes -- */

describe("changing an unclaimed voucher's address", () => {
  it("queues and sends a new gift delivery to the new address — once, however the PATCH is replayed — and no other change does", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const { id, delivery: original } = await givenVoucher(READER, 4);
    await sendQueuedVoucherEmail(original, box.deps);
    const fixed = `fixed-${emailOf(READER)}`;
    const patch = JSON.stringify({ email: fixed.toUpperCase() });

    const reply = await drive("PATCH", `/api/admin/vouchers/${id}`, patch, ADMIN_USER_ID_LOCAL);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, email: "queued" });
    expect(box.sent.map((m) => m.to)).toEqual([[emailOf(READER)], [fixed]]);

    /* The same PATCH again, one after the other and at once: nothing new. */
    expect((await drive("PATCH", `/api/admin/vouchers/${id}`, patch, ADMIN_USER_ID_LOCAL)).body).toEqual({ ok: true });
    const again = `again-${emailOf(READER)}`;
    const body = JSON.stringify({ email: again });
    await Promise.all(Array.from({ length: 5 }, () => drive("PATCH", `/api/admin/vouchers/${id}`, body, ADMIN_USER_ID_LOCAL)));
    /* Other fields: nothing. */
    await drive("PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ articles: 9, note: "x" }), ADMIN_USER_ID_LOCAL);

    const gifts = (await deliveriesOf(id)).filter((d) => d.kind === "gift");
    expect(gifts.map((g) => g.recipient)).toEqual([emailOf(READER), fixed, again]);
    expect(box.sent.map((m) => m.to)).toEqual([[emailOf(READER)], [fixed], [again]]);
  });

  it("cancels a gift still waiting for the old address", async () => {
    const { id, delivery: original } = await givenVoucher(READER, 4);
    const answer = await updateVoucher(id, { email: `new-${emailOf(READER)}` });
    expect(answer).toMatchObject({ kind: "updated", giftDelivery: expect.any(String) });
    expect(await delivery(original)).toMatchObject({ status: "skipped", detail: "address changed" });
  });

  it("keeps the PATCH and its 200 when the new address's send fails", async () => {
    const { id } = await givenVoucher(READER, 4);
    const fixed = `failed-${emailOf(READER)}`;
    control.deps = mailbox({
      answer: async () => {
        throw new TypeError("network down");
      },
    }).deps;
    const reply = await drive(
      "PATCH",
      `/api/admin/vouchers/${id}`,
      JSON.stringify({ email: fixed }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, email: "queued" });
    expect((await listVouchers()).find((v) => v.id === id)?.email).toBe(fixed);
    expect((await deliveriesOf(id)).find((d) => d.recipient === fixed)).toMatchObject({
      status: "failed",
      detail: "request outcome unknown (TypeError)",
    });
  });
});

/* --------------------------------- an existing reader, or an invitation -- */

/* docs/plans/261002a-fb99-voucher-email-for-existing-user.md. */
describe("the recipient's email is written for who they are", () => {
  const noLeaks = (part: string, voucherId: string) => {
    expect(part).not.toContain(SECRET_NOTE);
    expect(part).not.toContain(CREATOR_A);
    expect(part).not.toContain(ADMIN_USER_ID_LOCAL);
    expect(part).not.toContain(voucherId);
  };

  it("tells an existing reader on Free how many articles they had left, and have now", async () => {
    const box = mailbox();
    control.deps = box.deps;
    control.byEmail.set(emailOf(READER), { kind: "one", id: READER });
    const id = randomUUID();
    const reply = await drive(
      "POST",
      "/api/admin/vouchers",
      JSON.stringify({ id, email: emailOf(READER), articles: 20, note: SECRET_NOTE }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(reply.status).toBe(201);
    const [mail] = box.sent;
    expect(mail?.to).toEqual([emailOf(READER)]);
    expect(mail?.subject).toBe("A gift of 20 free articles on Spideryarn");
    for (const part of [mail?.text ?? "", mail?.html ?? ""]) {
      /* A fresh account: the three every free account starts with, then twenty-three. */
      expect(part).toContain("Before this gift you had 3 articles left on your free allowance. With it, you have 23 articles.");
      expect(part).toContain("https://www.spideryarn.com/");
      expect(part).not.toContain("/login");
      expect(part).not.toContain("create an account");
      noLeaks(part, id);
    }
  });

  it("counts before and after with the wall's own arithmetic, including at the edge", () => {
    const free = (limit: number, used: number, waiting = 0): GiftAudience => ({
      kind: "reader",
      plan: { kind: "free", limit: articles(limit), wallUsed: points(used), waiting: articles(waiting) },
    });
    /* Exactly at the budget: nothing left, and one gift makes one. */
    expect(giftMessage(1, free(3, 600)).text).toContain("you had 0 articles left on your free allowance. With it, you have 1 article.");
    /* A half-price public add in `used`: two left, then three. */
    expect(giftMessage(1, free(3, 300)).text).toContain("you had 2 articles left on your free allowance. With it, you have 3 articles.");
    /* Gifts already waiting are claimed with this one, so they are in the after. */
    expect(giftMessage(1, free(3, 0, 10)).text).toContain(
      "you had 3 articles left on your free allowance. With it, and 10 articles given to you earlier and still waiting, you have 14 articles.",
    );
  });

  it("counts a gift already waiting at the address in the after, read from the database", async () => {
    await givenVoucher(READER, 10);
    expect(await giftAudienceFor(emailOf(READER), { lookup: async () => ({ kind: "one", id: READER }) })).toEqual({
      kind: "reader",
      plan: { kind: "free", limit: 3, wallUsed: 0, waiting: 10 },
    });
  });

  it("writes the reader's email without numbers when their plan cannot be read", async () => {
    const audience = await giftAudienceFor(emailOf(READER), {
      lookup: async () => ({ kind: "one", id: READER }),
      standing: async () => {
        throw new Error("database down");
      },
    });
    expect(audience).toEqual({ kind: "reader", plan: { kind: "unknown" } });
  });

  it("tells a paid reader the gift waits for Free, and says no numbers when the plan is unknown", () => {
    const paid = giftMessage(5, { kind: "reader", plan: { kind: "paid" } });
    expect(paid.text).toContain("You are on a paid plan, so you do not need them today.");
    expect(paid.text).not.toContain("Before this gift");
    const unknown = giftMessage(5, { kind: "reader", plan: { kind: "unknown" } });
    expect(unknown.text).not.toContain("Before this gift");
    expect(unknown.text).not.toContain("paid plan");
    expect(unknown.text).toContain("Open Spideryarn: https://www.spideryarn.com/");
  });

  it("invites anybody it cannot name as one reader: nobody, several, or a failed lookup", async () => {
    const standing = vi.fn(async () => {
      throw new Error("billing must not be read");
    });
    for (const found of [
      { kind: "none" },
      { kind: "several" },
      { kind: "unavailable", reason: "timed out" },
    ] as const) {
      expect(await giftAudienceFor(emailOf(READER), { lookup: async () => found, standing })).toEqual({ kind: "invite" });
    }
    expect(standing).not.toHaveBeenCalled();
    const box = mailbox();
    control.deps = box.deps;
    control.byEmail.set(emailOf(READER), { kind: "several" });
    const id = randomUUID();
    await drive("POST", "/api/admin/vouchers", JSON.stringify({ id, email: emailOf(READER), articles: 2 }), ADMIN_USER_ID_LOCAL);
    expect(box.sent[0]?.text).toContain("Sign in or create an account: https://www.spideryarn.com/login");
  });

  it("falls back to the invitation when the audience lookup throws, without failing a create or PATCH", async () => {
    const failed = async () => {
      throw new Error(`${emailOf(READER)} must not reach a log`);
    };
    const said = await logLinesWhile(async () => {
      expect(await giftAudienceFor(emailOf(READER), { lookup: failed })).toEqual({ kind: "invite" });

      const made = await createVoucher(
        { id: randomUUID(), email: emailOf(READER), articles: 2, note: null, recipientNote: null },
        CREATOR_A,
        { audience: failed },
      );
      expect(made.kind).toBe("created");
      if (made.kind !== "created") throw new Error("expected a created voucher");
      expect((await delivery(made.delivery)).body_text).toContain("Sign in or create an account");

      const original = await givenVoucher(OTHER, 3);
      const updated = await updateVoucher(original.id, { email: emailOf(READER) }, { audience: failed });
      expect(updated).toMatchObject({ kind: "updated", giftDelivery: expect.any(String) });
      if (updated.kind !== "updated" || !updated.giftDelivery) throw new Error("expected a queued address-change email");
      expect((await delivery(updated.giftDelivery)).body_text).toContain("Sign in or create an account");
    });
    expect(said).toContain("account lookup failed, inviting");
    expect(said).toContain("audience unavailable, inviting");
    expect(said).not.toContain(emailOf(READER));
  });

  it("reads a found reader's plan from the database", async () => {
    expect(await giftAudienceFor(emailOf(READER), { lookup: async () => ({ kind: "one", id: READER }) })).toEqual({
      kind: "reader",
      plan: { kind: "free", limit: 3, wallUsed: 0, waiting: 0 },
    });
  });

  it("reads the wall's public, minimal, in-flight and high-power costs for the email", async () => {
    if (!pool) return;
    const { rows } = await pool.query<{ id: string }>(
      `insert into spideryarn.articles (owner_id, slug, visibility, public_at)
       values ($1, $2, 'public', now()) returning id`,
      [READER, `voucher-email-usage-${randomUUID()}`],
    );
    const article = rows[0]?.id;
    if (!article) throw new Error("expected an article id");
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, article_id)
       values
         ($1, 'ingest', now(), now(), $2),
         ($1, 'minimal', now(), now(), null),
         ($1, 'ingest', now(), null, null),
         ($1, 'high_power', now(), now(), $2)`,
      [READER, article],
    );
    expect(await giftAudienceFor(emailOf(READER), { lookup: async () => ({ kind: "one", id: READER }) })).toEqual({
      kind: "reader",
      plan: { kind: "free", limit: 3, wallUsed: 402, waiting: 0 },
    });
  });

  it("includes claimed gifts in a lapsed reader's Free limit", async () => {
    const old = await givenVoucher(READER, 4);
    expect((await claimVouchersFor({ id: READER, email: emailOf(READER) }, { lookup: confirmed(READER) })).claimed).toBe(1);
    await pool?.query(
      `update spideryarn.billing_accounts
          set status = 'canceled', stripe_subscription_id = $2, stripe_customer_id = $3
        where owner_id = $1`,
      [READER, `sub_lapsed_${READER}`, `cus_lapsed_${READER}`],
    );
    expect(await giftAudienceFor(emailOf(READER), { lookup: async () => ({ kind: "one", id: READER }) })).toEqual({
      kind: "reader",
      plan: { kind: "free", limit: 7, wallUsed: 0, waiting: 0 },
    });
    expect((await deliveriesOf(old.id)).filter((row) => row.kind === "gift")).toHaveLength(1);
  });

  it("uses the new count when a PATCH changes the address and the articles together", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const { id } = await givenVoucher(OTHER, 4);
    control.byEmail.set(emailOf(READER), { kind: "one", id: READER });
    await drive("PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ email: emailOf(READER), articles: 9 }), ADMIN_USER_ID_LOCAL);
    const toReader = box.sent.find((m) => m.to[0] === emailOf(READER));
    expect(toReader?.subject).toBe("A gift of 9 free articles on Spideryarn");
    expect(toReader?.text).toContain("With it, you have 12 articles.");
  });

  it("writes the reader's email when an address is changed to a reader's", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const { id, delivery: original } = await givenVoucher(OTHER, 4);
    await sendQueuedVoucherEmail(original, box.deps);
    control.byEmail.set(emailOf(READER), { kind: "one", id: READER });
    const reply = await drive("PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ email: emailOf(READER) }), ADMIN_USER_ID_LOCAL);
    expect(reply.body).toEqual({ ok: true, email: "queued" });
    expect(box.sent.map((m) => m.to)).toEqual([[emailOf(OTHER)], [emailOf(READER)]]);
    expect(box.sent[0]?.text).toContain("/login");
    expect(box.sent[1]?.text).toContain("With it, you have 7 articles.");
    noLeaks(box.sent[1]?.text ?? "", id);
  });
});

/* ------------------------------------------------- logs, and the route -- */

describe("a note to them, from whoever gave the gift", () => {
  /* Greg, 2026-10-01 (spya-hc5q0e): "add a note for them so that I can add a
     sentence or two that they will see". Plan 261002b stage 1. Written by the
     administrator and drawn in a stranger's mail client, so untrusted on render. */
  const NOTE = 'Great to meet you today!\nSee <script>alert(1)</script> & <a href="https://evil.example">this</a>';
  const READER_FREE: GiftAudience = {
    kind: "reader",
    plan: { kind: "free", limit: articles(3), wallUsed: points(0), waiting: articles(0) },
  };

  it("sits under the heading, above everything we wrote, in both audiences' text and HTML", () => {
    for (const audience of [{ kind: "invite" } as const, READER_FREE]) {
      const mail = giftMessage(20, audience, NOTE);
      expect(mail.text).toContain("Great to meet you today!\nSee <script>alert(1)</script>");
      expect(mail.text.indexOf("Great to meet you")).toBeLessThan(mail.text.indexOf("You have been given"));
      expect(mail.text.indexOf("Great to meet you")).toBeGreaterThan(mail.text.indexOf("A gift of 20"));
      const html = mail.html ?? "";
      expect(html).toContain(
        "Great to meet you today!<br>See &lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;a href=&quot;https://evil.example&quot;&gt;this&lt;/a&gt;",
      );
      expect(html.indexOf("Great to meet you")).toBeLessThan(html.indexOf("You have been given"));
      expect(html).not.toContain("<script>");
      expect(html).not.toContain('href="https://evil.example"');
      expect(mail.subject).toBe("A gift of 20 free articles on Spideryarn");
    }
  });

  it("says who it is from, in both parts", () => {
    const mail = giftMessage(20, { kind: "invite" }, "Hello.");
    expect(mail.text).toContain("A note from the person who gave you this gift:\nHello.");
    expect(mail.html).toContain("A note from the person who gave you this gift:");
  });

  it("turns every kind of line break into one, and every other control character into a space", () => {
    /* Sol, plan review F4: a lone CR or a Unicode separator draws a line a
       `\n`-only rule would not see, and NUL has no business in a mail. Built
       from char codes so this file holds no raw separator byte. */
    const controls = [0, 13, 0x2028, 0x2029, 9, 0x7f, 0x85].map((c) => String.fromCharCode(c));
    const [nul, cr, ls, ps, tab, del, nextLine] = controls;
    const raw = `one${cr}\ntwo${cr}three${ls}four${ps}five${nul}six${tab}seven${del}eight${nextLine}nine\n\n\n\nten`;
    const mail = giftMessage(3, { kind: "invite" }, raw);
    expect(mail.text).toContain("one\ntwo\nthree\nfour\nfive six seven eight nine\n\nten");
    expect(mail.html).toContain("one<br>two<br>three<br>four<br>five six seven eight nine<br><br>ten");
    for (const c of controls) {
      expect(mail.text.includes(c)).toBe(false);
      expect((mail.html ?? "").includes(c)).toBe(false);
    }
    /* Blank once cleaned is no note at all. */
    expect(giftMessage(3, { kind: "invite" }, `${nul} ${cr}\n`)).toEqual(giftMessage(3));
  });

  it("leaves no empty block when there is no note", () => {
    const without = giftMessage(20);
    const blank = giftMessage(20, { kind: "invite" }, null);
    expect(blank).toEqual(without);
    expect(without.html).not.toContain("border-left");
  });

  it("is sent with the gift, refuses a replay with a different note, and never reaches the creator's notice", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const id = randomUUID();
    const body = { id, email: emailOf(READER), articles: 5, note: SECRET_NOTE, recipientNote: "Lovely to meet you." };
    expect((await drive("POST", "/api/admin/vouchers", JSON.stringify(body), ADMIN_USER_ID_LOCAL)).status).toBe(201);
    expect(box.sent[0]?.text).toContain("Lovely to meet you.");
    expect(box.sent[0]?.html).toContain("Lovely to meet you.");

    const replay = await drive("POST", "/api/admin/vouchers", JSON.stringify(body), ADMIN_USER_ID_LOCAL);
    expect(replay.status).toBe(200);
    const different = { ...body, recipientNote: "Something else." };
    expect((await drive("POST", "/api/admin/vouchers", JSON.stringify(different), ADMIN_USER_ID_LOCAL)).status).toBe(409);

    const listed = (await listVouchers()).find((v) => v.id === id);
    expect(listed?.recipientNote).toBe("Lovely to meet you.");

    box.sent.length = 0;
    control.auth.set(READER, { kind: "confirmed", email: emailOf(READER) });
    expect((await drive("GET", "/api/billing/usage", "", READER)).status).toBe(200);
    const notice = box.sent.find((m) => m.subject.startsWith("Gift voucher claimed"));
    expect(notice?.text).toBeDefined();
    expect(notice?.text).not.toContain("Lovely to meet you.");
  });

  it("is checked like the private note: trimmed, blank is none, at most 500 characters", async () => {
    const make = (recipientNote: unknown) =>
      drive(
        "POST",
        "/api/admin/vouchers",
        JSON.stringify({ id: randomUUID(), email: emailOf(OTHER), articles: 1, note: null, recipientNote }),
        ADMIN_USER_ID_LOCAL,
      );
    expect((await make("x".repeat(501))).status).toBe(400);
    /* Postgres char_length counts Unicode code points, not JavaScript UTF-16
       code units: one emoji is one character at this seam. */
    expect((await make("😀".repeat(500))).status).toBe(201);
    expect((await make("😀".repeat(501))).status).toBe(400);
    /* The input limit applies before cleaning too. Otherwise an arbitrarily
       large request made only of trimmable/control characters evades it. */
    expect((await make(`${"x".repeat(500)}\u0000`)).status).toBe(400);
    expect((await make(7)).status).toBe(400);
    const blank = await make("   ");
    expect(blank.status).toBe(201);
    const listed = (await listVouchers()).find((v) => v.id === (blank.body as { id: string }).id);
    expect(listed?.recipientNote).toBeNull();
  });

  it("changing it sends nothing; a new address sends the note as it now stands", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const { id, delivery } = await givenVoucher(READER, 4, CREATOR_A, null, "First words.");
    await sendQueuedVoucherEmail(delivery, box.deps);
    expect(box.sent[0]?.text).toContain("First words.");

    const edit = await drive(
      "PATCH",
      `/api/admin/vouchers/${id}`,
      JSON.stringify({ recipientNote: "Second words." }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(edit.status).toBe(200);
    expect(edit.body).toEqual({ ok: true });
    expect(box.sent).toHaveLength(1);
    expect((await listVouchers()).find((v) => v.id === id)?.recipientNote).toBe("Second words.");

    const moved = `moved-${emailOf(READER)}`;
    await drive("PATCH", `/api/admin/vouchers/${id}`, JSON.stringify({ email: moved }), ADMIN_USER_ID_LOCAL);
    expect(box.sent.map((m) => m.to)).toEqual([[emailOf(READER)], [moved]]);
    expect(box.sent[1]?.text).toContain("Second words.");
    expect(box.sent[1]?.text).not.toContain("First words.");

    /* Both at once: the new address gets the new note. */
    const again = `again-${emailOf(READER)}`;
    await drive(
      "PATCH",
      `/api/admin/vouchers/${id}`,
      JSON.stringify({ email: again, recipientNote: "Third words." }),
      ADMIN_USER_ID_LOCAL,
    );
    expect(box.sent[2]?.to).toEqual([again]);
    expect(box.sent[2]?.text).toContain("Third words.");
  });

  it("retries the body frozen at create time after the stored note changes", async () => {
    const first = mailbox({ answer: async () => new Response("{}", { status: 500 }) });
    control.deps = first.deps;
    const { id, delivery } = await givenVoucher(READER, 4, CREATOR_A, null, "First words.");
    await sendQueuedVoucherEmail(delivery, first.deps);

    await drive(
      "PATCH",
      `/api/admin/vouchers/${id}`,
      JSON.stringify({ recipientNote: "Second words." }),
      ADMIN_USER_ID_LOCAL,
    );

    const retried = mailbox();
    control.deps = retried.deps;
    const answer = await drive(
      "POST",
      `/api/admin/voucher-emails/${delivery}/retry`,
      "",
      ADMIN_USER_ID_LOCAL,
    );
    expect(answer.status).toBe(202);
    expect(retried.sent[0]?.text).toContain("First words.");
    expect(retried.sent[0]?.text).not.toContain("Second words.");
  });
});

describe("what is said, and to whom", () => {
  it("puts no address and no note in any log line or detail", async () => {
    const said = await logLinesWhile(async () => {
      control.deps = mailbox({
        answer: async () =>
          new Response(
            JSON.stringify({
              name: "validation_error",
              message: `${emailOf(READER)} ${SECRET_NOTE} provider-body-secret`,
            }),
            { status: 422 },
          ),
      }).deps;
      const id = randomUUID();
      await drive(
        "POST",
        "/api/admin/vouchers",
        JSON.stringify({ id, email: emailOf(READER), articles: 2, note: SECRET_NOTE }),
        ADMIN_USER_ID_LOCAL,
      );
      /* A fetch error is outside our control and may echo its request. It is
         reduced to its class before either the log or `detail` sees it. */
      control.deps = mailbox({
        answer: async () => {
          throw new Error(`${emailOf(OTHER)} ${SECRET_NOTE} provider-body-secret`);
        },
      }).deps;
      await drive(
        "POST",
        "/api/admin/vouchers",
        JSON.stringify({ id: randomUUID(), email: emailOf(OTHER), articles: 2, note: SECRET_NOTE }),
        ADMIN_USER_ID_LOCAL,
      );
      /* A successful response's provider id is provider-controlled too. */
      control.deps = mailbox({
        answer: async () =>
          new Response(JSON.stringify({ id: `${emailOf(OTHER)}-${SECRET_NOTE}-provider-body-secret` }), {
            status: 200,
          }),
      }).deps;
      await drive(
        "POST",
        "/api/admin/vouchers",
        JSON.stringify({ id: randomUUID(), email: emailOf(OTHER), articles: 3, note: SECRET_NOTE }),
        ADMIN_USER_ID_LOCAL,
      );
      control.deps = mailbox({ lookup: async () => ({ kind: "unavailable", reason: "Auth answered 503" }) }).deps;
      control.auth.set(READER, { kind: "confirmed", email: emailOf(READER) });
      await pool?.query("update spideryarn.billing_voucher_emails set status = 'failed' where status = 'queued'");
      await drive("GET", "/api/billing/usage", "", READER);
      control.deps = mailbox().deps;
      const notice = (await deliveriesOf(id)).find((d) => d.kind === "claimed");
      if (notice) await drive("POST", `/api/admin/voucher-emails/${notice.id}/retry`, "", ADMIN_USER_ID_LOCAL);
    });
    /* An empty capture would satisfy every `not` below; these say it caught the path. */
    expect(said).toContain("voucher: gift");
    expect(said).toContain("voucher: claimed");
    expect(said).toContain("creator's address could not be looked up");
    for (const secret of [
      emailOf(READER),
      emailOf(OTHER),
      creatorEmail(CREATOR_A),
      SECRET_NOTE,
      "@example.invalid",
      "provider-body-secret",
    ]) {
      expect(said).not.toContain(secret);
    }
    if (!pool) return;
    const { rows } = await pool.query(
      "select detail from spideryarn.billing_voucher_emails e join spideryarn.billing_vouchers v on v.id = e.voucher_id where v.email like 'vmail-0000b0c5-%'",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as { detail: string | null }[]) expect(row.detail ?? "").not.toContain("@");
  });

  it("refuses the Retry route to anybody but the administrator, and checks the id", async () => {
    const box = mailbox();
    const { delivery: id } = await givenVoucher(READER, 2);
    await pool?.query("update spideryarn.billing_voucher_emails set status = 'failed' where id = $1", [id]);
    control.deps = box.deps;
    expect((await drive("POST", `/api/admin/voucher-emails/${id}/retry`, "", READER)).status).toBe(403);
    expect(box.fetch).not.toHaveBeenCalled();
    expect(await delivery(id)).toMatchObject({ status: "failed", attempts: 0 });

    expect((await drive("POST", "/api/admin/voucher-emails/not-a-uuid/retry", "", ADMIN_USER_ID_LOCAL)).status).toBe(400);
    const missing = await drive("POST", `/api/admin/voucher-emails/${randomUUID()}/retry`, "", ADMIN_USER_ID_LOCAL);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("There is no such voucher email.");
  });

  it("lists the latest delivery of each kind, with its state", async () => {
    const box = mailbox();
    const { id, delivery: gift } = await givenVoucher(READER, 2);
    await sendQueuedVoucherEmail(gift, box.deps);
    const listed = (await listVouchers()).find((v) => v.id === id);
    expect(listed?.emails).toEqual({
      gift: {
        id: gift,
        kind: "gift",
        status: "sent",
        attempts: 1,
        detail: null,
        updatedAt: expect.any(String),
        attemptStartedAt: expect.any(String),
        retryable: false,
      },
      claimed: null,
    });
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

/** Drive `handleApi` with a fake request/response pair, as tests/billing-vouchers.test.ts does. */
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

  /* `handleApi` drains every after-response task before it returns, so the
     sends have happened by the time this does. */
  await handleApi(req, res, signedInAs(owner));
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers };
}
