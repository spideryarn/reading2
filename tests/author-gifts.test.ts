/**
 * **Author gifts** — a draft of a gift voucher for the author of one of the
 * administrator's own articles, which becomes a voucher only when *Send* is
 * pressed. docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md,
 * stage 1: the tables, the store and the routes, with no AI.
 *
 * Most of what is here is about what must **not** happen, because the feature
 * can send a stranger an email:
 *
 * - a second press, or a replay after *Send*, makes no second gift, touches no
 *   link and starts no lookup (R2-F2);
 * - *Send* queues exactly one gift email however many times it is pressed, and
 *   a replay still hands back a delivery that is waiting (R2-F1);
 * - *Send* refuses a gift with no address, and a discarded one;
 * - once frozen, the voucher's fields cannot change, but the notes can (R2-F7);
 * - a refused starter unfreezes its own attempt and no newer one (R2-F3);
 * - two lookups cannot be pending at once (D4), and a finished lookup writes
 *   only into empty fields of a draft (R2-F5);
 * - nobody but the administrator reaches any of the routes.
 *
 * **No real email can leave**: the send goes through an injected `fetch`, and
 * the Auth Admin API is replaced, as in tests/voucher-starter.test.ts. **No
 * model is called**: the after-response lookup is the seam
 * `startAuthorLookup`, replaced here by a recorder.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  deps: {} as import("../src/store/pg-voucher-emails.js").VoucherEmailDeps,
  /** Every lookup id the routes handed to the after-response seam. */
  lookupsStarted: [] as string[],
}));

vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    confirmedAccountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
    accountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
    confirmedAccountByEmail: async () => ({ kind: "none" }),
  };
});

vi.mock("../src/store/pg-voucher-emails.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/pg-voucher-emails.js")>();
  return {
    ...real,
    sendQueuedVoucherEmail: (id: string, deps?: import("../src/store/pg-voucher-emails.js").VoucherEmailDeps) =>
      real.sendQueuedVoucherEmail(id, deps ?? control.deps),
  };
});

vi.mock("../src/author-lookup-start.js", () => ({
  startAuthorLookup: async (lookupId: string) => {
    control.lookupsStarted.push(lookupId);
  },
}));

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { AUTHOR_GIFT_NOTES_MAX } from "../src/admin-author-gifts.js";
import type { AdminAuthorGift } from "../src/admin-author-gifts.js";
import type { Verifier } from "../src/auth.js";
import { getDb } from "../src/db/client.js";
import { aiCalls } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { handleApi } from "../src/routes.js";
import type { AiCallRow } from "../src/ai-spend.js";
import { aiCallInsertValues } from "../src/store/ai-calls-pg.js";
import {
  appendNotes,
  beginLookup,
  claimLookup,
  finishLookup,
  listAuthorGifts,
  parseAuthorGiftPatch,
  sendAuthorGift,
} from "../src/store/pg-author-gifts.js";
import { createVoucher } from "../src/store/pg-vouchers.js";
import type { VoucherEmailDeps } from "../src/store/pg-voucher-emails.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/author-gifts.test.ts",
  tables: [
    "spideryarn.author_gifts",
    "spideryarn.author_lookups",
    "spideryarn.billing_vouchers",
    "spideryarn.billing_voucher_emails",
  ],
  columns: [
    { table: "spideryarn.author_gifts", column: "send_attempt" },
    { table: "spideryarn.author_lookups", column: "run_id" },
  ],
  keepPool: true,
  max: 6,
});

/* Minted per run under this file's own stem, so no other file sweeps them. */
const STEM = "0000a6f7-0000-4000-8000-";
const RUN = randomUUID().slice(0, 8);
const ADMIN = ADMIN_USER_ID_LOCAL;
/** Somebody else, who owns one article. Not an administrator. */
const STRANGER = `${STEM}${randomUUID().slice(-12)}`;
const SLUG_STEM = "test-author-gift-";
const addressOf = (n: string) => `agift-${n}-${RUN}@example.invalid`;
const PROD = { VERCEL_ENV: "production", RESEND_API_KEY: "re_test_key" } as const;

let keys = 0;
/** Twenty-two base64url characters, distinct, as `articles.share_token` wants. */
function nextKey(): string {
  keys += 1;
  return `AGIFTxKEYxxxx${String(keys).padStart(9, "0")}`;
}

interface Seeded {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

const seeded: string[] = [];
const runIds: string[] = [];

/** One article, published unless told otherwise. Private with its link off by default. */
async function seed(
  name: string,
  opts: { owner?: string; visibility?: "private" | "public"; linkOn?: boolean; unpublished?: boolean } = {},
): Promise<Seeded> {
  const id = randomUUID();
  const revision = randomUUID();
  const slug = `${SLUG_STEM}${name}-${RUN}`;
  const title = `The ${name} article`;
  const key = opts.linkOn ? nextKey() : null;
  seeded.push(id);
  await pool.query(
    `insert into spideryarn.articles (id, owner_id, slug, short_id, visibility, public_at, share_token, share_token_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      opts.owner ?? ADMIN,
      slug,
      mintId(),
      opts.visibility ?? "private",
      opts.visibility === "public" ? new Date() : null,
      key,
      key === null ? null : new Date(),
    ],
  );
  await pool.query(
    `insert into spideryarn.article_revisions
       (id, article_id, status, title, word_count, block_count, part_count, section_count)
     values ($1, $2, 'published', $3, 9, 0, 0, 0)`,
    [revision, id, title],
  );
  if (!opts.unpublished) {
    await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [id, revision]);
  }
  return { id, slug, title };
}

async function deleteArticle(id: string): Promise<void> {
  await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
  await pool.query("delete from spideryarn.article_revisions where article_id = $1", [id]);
  await pool.query("delete from spideryarn.articles where id = $1", [id]);
}

async function sweep(): Promise<void> {
  await pool.query("delete from spideryarn.billing_vouchers where email like $1", ["agift-%@example.invalid"]);
  await pool.query("delete from spideryarn.article_share_link_events where slug like $1", [`${SLUG_STEM}%`]);
  if (runIds.length > 0) await pool.query("delete from spideryarn.ai_calls where run_id = any($1::uuid[])", [runIds.splice(0)]);
  /* Gifts and their lookups go with the article (cascade). */
  for (const id of seeded.splice(0)) await deleteArticle(id);
}

beforeAll(async () => {
  await sweep();
  await seedAuthUser(pool, { id: STRANGER, email: `${STRANGER}@example.invalid` });
});

afterEach(async () => {
  control.deps = {};
  control.lookupsStarted.length = 0;
  await sweep();
});

afterAll(async () => {
  await sweep();
  await pool.query("delete from auth.users where id = $1", [STRANGER]).catch(() => {});
  await pool.end();
});

/** A fake Resend that records what it was asked to send. */
function mailbox() {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
  });
  const deps: VoucherEmailDeps = { email: { fetch, env: PROD } };
  return { sent, fetch, deps };
}

async function giftRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query("select * from spideryarn.author_gifts where id = $1", [id]);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no gift ${id}`);
  return row;
}

async function lookupsOf(giftId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    "select * from spideryarn.author_lookups where author_gift_id = $1 order by created_at, id",
    [giftId],
  );
  return rows as Record<string, unknown>[];
}

async function shareTokenOf(articleId: string): Promise<string | null> {
  const { rows } = await pool.query("select share_token from spideryarn.articles where id = $1", [articleId]);
  return (rows[0] as { share_token: string | null } | undefined)?.share_token ?? null;
}

async function giftEmailsOf(voucherId: string) {
  const { rows } = await pool.query(
    "select id, status, recipient from spideryarn.billing_voucher_emails where voucher_id = $1 and kind = 'gift' order by created_at, id",
    [voucherId],
  );
  return rows as { id: string; status: string; recipient: string }[];
}

/** Make a gift through the route, as the add page would, and hand back its id and first lookup. */
async function ensured(article: Seeded): Promise<{ id: string; lookupId: string }> {
  const reply = await drive("POST", "/api/admin/author-gifts", { slug: article.slug, rightsConfirmed: true });
  expect(reply.status).toBe(202);
  return { id: String(reply.body.id), lookupId: String(reply.body.lookupId) };
}

/** Finish a gift's pending lookup with nothing found, so another may start. */
async function settle(lookupId: string): Promise<void> {
  expect((await finishLookup(lookupId, { kind: "failed", failure: "test" })).kind).toBe("finished");
}

/* ----------------------------------------------------------------- ensure -- */

describe("POST /api/admin/author-gifts — ensure", () => {
  it("makes the private link, the gift and one pending lookup, and starts that lookup after the response", async () => {
    const mine = await seed("new");
    expect(await shareTokenOf(mine.id)).toBeNull();

    const reply = await drive("POST", "/api/admin/author-gifts", { slug: mine.slug, rightsConfirmed: true });
    expect(reply.status).toBe(202);
    expect(reply.body).toMatchObject({ status: "draft", created: true });
    const id = String(reply.body.id);
    const lookupId = String(reply.body.lookupId);

    expect(await shareTokenOf(mine.id)).not.toBeNull();
    expect(await giftRow(id)).toMatchObject({
      article_id: mine.id,
      starter_slug: mine.slug,
      created_by: ADMIN,
      email: null,
      articles: 20,
      send_started_at: null,
    });
    const lookups = await lookupsOf(id);
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatchObject({ id: lookupId, outcome: null, run_id: null });
    expect(control.lookupsStarted).toEqual([lookupId]);
    /* The key is never on the wire. */
    expect(JSON.stringify(reply.body)).not.toContain("AGIFTxKEY");
  });

  it("keeps a link that is already on, and makes none for a public article", async () => {
    const linked = await seed("linked", { linkOn: true });
    const before = await shareTokenOf(linked.id);
    await ensured(linked);
    expect(await shareTokenOf(linked.id)).toBe(before);

    const open = await seed("public", { visibility: "public" });
    await ensured(open);
    expect(await shareTokenOf(open.id)).toBeNull();
  });

  it("answers a second press with the same gift, touching neither the link nor the lookups", async () => {
    const mine = await seed("twice");
    const { id } = await ensured(mine);
    control.lookupsStarted.length = 0;
    /* Greg turns the link off; a late replay must not turn it back on. */
    await pool.query("update spideryarn.articles set share_token = null, share_token_at = null where id = $1", [mine.id]);

    const again = await drive("POST", "/api/admin/author-gifts", { slug: mine.slug, rightsConfirmed: true });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id, status: "draft", created: false });
    expect(await shareTokenOf(mine.id)).toBeNull();
    expect(await lookupsOf(id)).toHaveLength(1);
    expect(control.lookupsStarted).toEqual([]);
  });

  it("answers a replay after Send with the same gift, sent, and starts nothing", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("replay-after-send", { linkOn: true });
    const { id, lookupId } = await ensured(mine);
    await settle(lookupId);
    expect((await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("rs") })).status).toBe(200);
    expect((await drive("POST", `/api/admin/author-gifts/${id}/send`, null)).status).toBe(201);
    control.lookupsStarted.length = 0;

    const again = await drive("POST", "/api/admin/author-gifts", { slug: mine.slug, rightsConfirmed: true });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id, status: "sent", created: false });
    expect(await lookupsOf(id)).toHaveLength(1);
    expect(control.lookupsStarted).toEqual([]);
  });

  it("refuses somebody else's article and one that does not exist (400), and an unpublished one (409)", async () => {
    const theirs = await seed("theirs", { owner: STRANGER });
    for (const slug of [theirs.slug, `${SLUG_STEM}nobody-${RUN}`]) {
      expect((await drive("POST", "/api/admin/author-gifts", { slug, rightsConfirmed: true })).status, slug).toBe(400);
    }
    const draft = await seed("unpublished", { unpublished: true });
    expect((await drive("POST", "/api/admin/author-gifts", { slug: draft.slug, rightsConfirmed: true })).status).toBe(409);
    const { rows } = await pool.query("select count(*)::int as n from spideryarn.author_gifts where article_id = any($1::uuid[])", [
      [theirs.id, draft.id],
    ]);
    expect(rows[0]).toEqual({ n: 0 });
    expect(await shareTokenOf(theirs.id)).toBeNull();
  });

  it("refuses a body without the rights tick, with unknown keys, or without a slug", async () => {
    const mine = await seed("body");
    for (const body of [
      { slug: mine.slug },
      { slug: mine.slug, rightsConfirmed: false },
      { slug: mine.slug, rightsConfirmed: true, keepExisting: true },
      { rightsConfirmed: true },
      { slug: "Not A Slug", rightsConfirmed: true },
      [],
    ]) {
      expect((await drive("POST", "/api/admin/author-gifts", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await shareTokenOf(mine.id)).toBeNull();
  });
});

/* ------------------------------------------------------------------- send -- */

describe("POST /api/admin/author-gifts/:id/send", () => {
  it("makes the voucher from the frozen fields and queues exactly one gift email; a repeat queues none", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const mine = await seed("send", { linkOn: true });
    const { id } = await ensured(mine);
    const patched = await drive("PATCH", `/api/admin/author-gifts/${id}`, {
      email: ` ${addressOf("send").toUpperCase()} `,
      recipientName: "Ada Lovelace",
      recipientNote: "Thank you for this.",
      articles: 30,
      notes: "Found on the lab page.",
    });
    expect(patched.status).toBe(200);

    const sent = await drive("POST", `/api/admin/author-gifts/${id}/send`, null);
    expect(sent.status).toBe(201);
    const gift = await giftRow(id);
    expect(sent.body).toEqual({ voucherId: gift.voucher_id, email: "queued" });

    const { rows } = await pool.query("select * from spideryarn.billing_vouchers where id = $1", [gift.voucher_id]);
    expect(rows[0]).toMatchObject({
      email: addressOf("send"),
      articles: 30,
      note: "Author gift",
      recipient_name: "Ada Lovelace",
      recipient_note: "Thank you for this.",
      starter_slug: mine.slug,
      starter_article_id: mine.id,
      created_by: ADMIN,
    });
    /* The notes are the gift's, and stay there. */
    expect(JSON.stringify(rows[0])).not.toContain("lab page");
    expect(await giftEmailsOf(String(gift.voucher_id))).toHaveLength(1);
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]?.to).toEqual([addressOf("send")]);

    const again = await drive("POST", `/api/admin/author-gifts/${id}/send`, null);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ voucherId: gift.voucher_id, email: "replayed" });
    expect(await giftEmailsOf(String(gift.voucher_id))).toHaveLength(1);
    expect(box.sent).toHaveLength(1);

    const listed = (await listAuthorGifts()).find((g) => g.id === id);
    expect(listed).toMatchObject({ status: "sent", voucherId: gift.voucher_id });
  });

  it("hands back a delivery still queued on a replay, so the route can send it (R2-F1)", async () => {
    const mine = await seed("send-replay", { linkOn: true });
    const { id } = await ensured(mine);
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("send-replay") });

    /* The store directly: the voucher and its email commit, and nobody sends it
       — a process that died before its after-response work ran. */
    const first = await sendAuthorGift(id);
    if (first.kind !== "created") throw new Error(`expected created, got ${first.kind}`);
    const second = await sendAuthorGift(id);
    expect(second).toEqual({ kind: "replayed", voucherId: first.voucherId, delivery: first.delivery });
    expect(await giftEmailsOf(first.voucherId)).toHaveLength(1);

    /* And the route, given that replay, sends the waiting email — once. */
    const box = mailbox();
    control.deps = box.deps;
    const pressed = await drive("POST", `/api/admin/author-gifts/${id}/send`, null);
    expect(pressed.status).toBe(200);
    expect(box.sent).toHaveLength(1);
    expect(await giftEmailsOf(first.voucherId)).toEqual([expect.objectContaining({ status: "sent" })]);
    expect((await drive("POST", `/api/admin/author-gifts/${id}/send`, null)).status).toBe(200);
    expect(box.sent).toHaveLength(1);

    /* Once it has gone, a replay has nothing to hand back. */
    expect(await sendAuthorGift(id)).toEqual({ kind: "replayed", voucherId: first.voucherId, delivery: null });
  });

  it("refuses a gift with no address, and a discarded one, with a 409 and no voucher", async () => {
    const mine = await seed("refuse");
    const { id } = await ensured(mine);
    const noAddress = await drive("POST", `/api/admin/author-gifts/${id}/send`, null);
    expect(noAddress.status).toBe(409);
    expect(String(noAddress.body.error)).toMatch(/address/i);

    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("refuse"), discarded: true });
    const discarded = await drive("POST", `/api/admin/author-gifts/${id}/send`, null);
    expect(discarded.status).toBe(409);
    expect(String(discarded.body.error)).toMatch(/discarded/i);

    const gift = await giftRow(id);
    expect(gift.send_started_at).toBeNull();
    const { rows } = await pool.query("select 1 from spideryarn.billing_vouchers where id = $1", [gift.voucher_id]);
    expect(rows).toHaveLength(0);
    expect((await drive("POST", `/api/admin/author-gifts/${randomUUID()}/send`, null)).status).toBe(404);
  });

  it("unfreezes when the starter can no longer be linked, so it can be fixed and sent again", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("unlinkable", { linkOn: true });
    const { id } = await ensured(mine);
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("unlinkable") });
    await pool.query("update spideryarn.articles set share_token = null, share_token_at = null where id = $1", [mine.id]);

    const refused = await drive("POST", `/api/admin/author-gifts/${id}/send`, null);
    expect(refused.status).toBe(409);
    expect(await giftRow(id)).toMatchObject({ send_started_at: null, send_attempt: null });

    /* Fixed: the link is made again, and Send goes through. */
    await pool.query("update spideryarn.articles set share_token = $2, share_token_at = now() where id = $1", [mine.id, nextKey()]);
    expect((await drive("POST", `/api/admin/author-gifts/${id}/send`, null)).status).toBe(201);
  });

  it("a slow refusal unfreezes only its own attempt, never a newer one (R2-F3)", async () => {
    const mine = await seed("attempts", { linkOn: true });
    const { id } = await ensured(mine);
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("attempts") });
    const newer = randomUUID();
    const answer = await sendAuthorGift(id, {
      createVoucher: async () => {
        /* While this attempt waited, it was unfrozen and frozen again by another. */
        await pool.query("update spideryarn.author_gifts set send_attempt = $2 where id = $1", [id, newer]);
        return { kind: "starter-refused", reason: "link-off" };
      },
    });
    expect(answer).toEqual({ kind: "starter-refused", reason: "link-off" });
    const gift = await giftRow(id);
    expect(gift.send_attempt).toBe(newer);
    expect(gift.send_started_at).not.toBeNull();
  });

  it("a request from an unfrozen attempt cannot create the voucher from its old snapshot", async () => {
    const mine = await seed("revoked-attempt", { linkOn: true });
    const { id } = await ensured(mine);
    const firstAddress = addressOf("revoked-first");
    const secondAddress = addressOf("revoked-second");
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: firstAddress });

    let entered!: () => void;
    const atCreate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = sendAuthorGift(id, {
      createVoucher: async (input, createdBy, deps) => {
        entered();
        await held;
        return await createVoucher(input, createdBy, deps);
      },
    });
    await atCreate;

    /* A concurrent caller sees the same freeze, refuses its starter and releases
       that attempt. Greg can now edit the draft while the first caller is still
       holding the old address. */
    expect(
      await sendAuthorGift(id, { createVoucher: async () => ({ kind: "starter-refused", reason: "link-off" }) }),
    ).toEqual({ kind: "starter-refused", reason: "link-off" });
    expect((await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: secondAddress })).status).toBe(200);

    release();
    expect(await slow).toEqual({ kind: "superseded" });
    const gift = await giftRow(id);
    expect((await pool.query("select 1 from spideryarn.billing_vouchers where id = $1", [gift.voucher_id])).rows).toHaveLength(0);

    const sent = await sendAuthorGift(id);
    expect(sent.kind).toBe("created");
    const voucher = await pool.query("select email from spideryarn.billing_vouchers where id = $1", [gift.voucher_id]);
    expect(voucher.rows).toEqual([{ email: secondAddress }]);
  });
});

/* ------------------------------------------------------------------ patch -- */

describe("PATCH /api/admin/author-gifts/:id", () => {
  it("refuses the voucher's fields once Send has started, and still takes the notes", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("frozen", { linkOn: true });
    const { id } = await ensured(mine);
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("frozen") });
    expect((await drive("POST", `/api/admin/author-gifts/${id}/send`, null)).status).toBe(201);

    for (const body of [
      { email: addressOf("other") },
      { articles: 5 },
      { recipientName: "Someone" },
      { recipientNote: "x" },
      { discarded: true },
      { notes: "with a field", articles: 5 },
    ]) {
      expect((await drive("PATCH", `/api/admin/author-gifts/${id}`, body)).status, JSON.stringify(body)).toBe(409);
    }
    expect(await giftRow(id)).toMatchObject({ email: addressOf("frozen"), articles: 20, notes: null });

    const notes = await drive("PATCH", `/api/admin/author-gifts/${id}`, { notes: "Sent on Thursday." });
    expect(notes.status).toBe(200);
    const gift = await giftRow(id);
    expect(gift.notes).toBe("Sent on Thursday.");
    expect(gift.notes_updated_at).not.toBeNull();
  });

  it("clears a field's provenance when the administrator edits it, and only then", async () => {
    const mine = await seed("provenance", { linkOn: true });
    const { id, lookupId } = await ensured(mine);
    expect(
      await finishLookup(lookupId, {
        kind: "found",
        authorName: "Ada Lovelace",
        authorSourceUrl: "https://example.org/ada",
        email: addressOf("found"),
        emailSourceUrl: "https://example.org/ada",
        suggestedEmail: null,
        contactUrl: null,
        searches: 2,
        model: "anthropic/claude-sonnet-5",
        notes: null,
      }),
    ).toMatchObject({ kind: "finished", applied: { email: true, name: true } });
    expect(await giftRow(id)).toMatchObject({ email_lookup_id: lookupId, name_lookup_id: lookupId });

    /* The same address again, as a replayed PATCH would send, is not an edit. */
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("found") });
    expect(await giftRow(id)).toMatchObject({ email_lookup_id: lookupId, name_lookup_id: lookupId });

    await drive("PATCH", `/api/admin/author-gifts/${id}`, { email: addressOf("typed") });
    expect(await giftRow(id)).toMatchObject({ email: addressOf("typed"), email_lookup_id: null, name_lookup_id: lookupId });
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { recipientName: "A. Lovelace" });
    expect(await giftRow(id)).toMatchObject({ name_lookup_id: null });
  });

  it("validates strictly, and discards and restores", async () => {
    const mine = await seed("validate");
    const { id } = await ensured(mine);
    for (const body of [{}, { artcles: 5 }, { articles: 0 }, { email: "nope" }, { notes: 7 }, { discarded: "yes" }]) {
      expect((await drive("PATCH", `/api/admin/author-gifts/${id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(parseAuthorGiftPatch({ notes: "x".repeat(AUTHOR_GIFT_NOTES_MAX + 1) }).ok).toBe(false);
    expect(parseAuthorGiftPatch({ email: null, notes: "  " })).toEqual({ ok: true, value: { email: null, notes: null } });
    expect((await drive("PATCH", `/api/admin/author-gifts/${randomUUID()}`, { notes: "x" })).status).toBe(404);

    expect((await drive("PATCH", `/api/admin/author-gifts/${id}`, { discarded: true })).status).toBe(200);
    expect((await listAuthorGifts()).find((g) => g.id === id)?.status).toBe("discarded");
    expect((await drive("PATCH", `/api/admin/author-gifts/${id}`, { discarded: false })).status).toBe(200);
    expect((await listAuthorGifts()).find((g) => g.id === id)?.status).toBe("draft");
  });
});

/* ---------------------------------------------------------------- lookups -- */

describe("the lookup's store transactions", () => {
  it("starts one of two concurrent lookups, and leaves one pending row", async () => {
    const mine = await seed("concurrent");
    const { id, lookupId } = await ensured(mine);
    await settle(lookupId);

    const answers = await Promise.all([beginLookup(id), beginLookup(id), beginLookup(id)]);
    expect(answers.filter((a) => a.kind === "started")).toHaveLength(1);
    expect(answers.filter((a) => a.kind === "running")).toHaveLength(2);
    expect((await lookupsOf(id)).filter((l) => l.outcome === null)).toHaveLength(1);
  });

  it("refuses while one runs, marks one over five minutes old stale, and refuses a gift that is not a draft", async () => {
    const mine = await seed("stale");
    const { id, lookupId } = await ensured(mine);
    expect((await drive("POST", `/api/admin/author-gifts/${id}/lookups`, null)).status).toBe(409);

    await pool.query("update spideryarn.author_lookups set created_at = now() - interval '6 minutes' where id = $1", [lookupId]);
    control.lookupsStarted.length = 0;
    const again = await drive("POST", `/api/admin/author-gifts/${id}/lookups`, null);
    expect(again.status).toBe(202);
    const fresh = String(again.body.lookupId);
    expect(control.lookupsStarted).toEqual([fresh]);
    const [old] = (await lookupsOf(id)).filter((l) => l.id === lookupId);
    expect(old).toMatchObject({ outcome: "failed", failure: "stale" });
    expect(old?.finished_at).not.toBeNull();

    /* A stale run that comes back writes nothing. */
    expect(await finishLookup(lookupId, { kind: "failed", failure: "late" })).toEqual({ kind: "lost" });

    await settle(fresh);
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { discarded: true });
    expect((await drive("POST", `/api/admin/author-gifts/${id}/lookups`, null)).status).toBe(409);
    expect((await drive("POST", `/api/admin/author-gifts/${randomUUID()}/lookups`, null)).status).toBe(404);
  });

  it("claims a row once, by compare-and-swap", async () => {
    const mine = await seed("claim");
    const { lookupId } = await ensured(mine);
    const run = randomUUID();
    expect(await claimLookup(lookupId, run)).toBe(true);
    expect(await claimLookup(lookupId, randomUUID())).toBe(false);
    const [row] = (await pool.query("select run_id from spideryarn.author_lookups where id = $1", [lookupId])).rows;
    expect(row).toEqual({ run_id: run });
    await settle(lookupId);
    expect(await claimLookup(lookupId, randomUUID())).toBe(false);
  });

  it("fills only the empty fields, records itself as their source, and appends to the notes", async () => {
    const mine = await seed("fill");
    const { id, lookupId } = await ensured(mine);
    await drive("PATCH", `/api/admin/author-gifts/${id}`, { recipientName: "Typed By Greg", notes: "Mine." });

    const answer = await finishLookup(lookupId, {
      kind: "found",
      authorName: "Found Name",
      authorSourceUrl: "https://example.org/about",
      email: ` ${addressOf("fill").toUpperCase()}`,
      emailSourceUrl: "https://example.org/about",
      suggestedEmail: null,
      contactUrl: "https://example.org/contact",
      searches: 3,
      model: "anthropic/claude-sonnet-5",
      notes: "Seen at https://example.org/about.",
    });
    expect(answer).toEqual({ kind: "finished", outcome: "address", applied: { email: true, name: false, notes: true } });
    const gift = await giftRow(id);
    expect(gift).toMatchObject({
      email: addressOf("fill"),
      email_lookup_id: lookupId,
      recipient_name: "Typed By Greg",
      name_lookup_id: null,
      notes: "Mine.\n\nSeen at https://example.org/about.",
    });
    const [run] = await lookupsOf(id);
    expect(run).toMatchObject({ outcome: "address", author_name: "Found Name", email: addressOf("fill"), searches: 3 });

    /* A second lookup never overwrites what the first wrote. */
    const second = await beginLookup(id);
    if (second.kind !== "started") throw new Error(second.kind);
    const later = await finishLookup(second.lookupId, {
      kind: "found",
      authorName: "Another",
      authorSourceUrl: null,
      email: addressOf("different"),
      emailSourceUrl: "https://example.org/x",
      suggestedEmail: null,
      contactUrl: null,
      searches: 1,
      model: null,
      notes: null,
    });
    expect(later).toMatchObject({ applied: { email: false, name: false, notes: false } });
    expect(await giftRow(id)).toMatchObject({ email: addressOf("fill"), email_lookup_id: lookupId });

    const listed = (await listAuthorGifts()).find((g) => g.id === id);
    expect(listed?.lookups.map((l) => l.id)).toEqual([second.lookupId, lookupId]);
  });

  it("applies nothing to a gift that was discarded or sent meanwhile, and keeps what it found on the run", async () => {
    control.deps = mailbox().deps;
    const found = {
      kind: "found",
      authorName: "Late Name",
      authorSourceUrl: null,
      email: addressOf("late"),
      emailSourceUrl: "https://example.org/late",
      suggestedEmail: null,
      contactUrl: null,
      searches: 1,
      model: null,
      notes: "Late notes.",
    } as const;

    const thrown = await seed("discarded");
    const a = await ensured(thrown);
    await drive("PATCH", `/api/admin/author-gifts/${a.id}`, { discarded: true });
    expect(await finishLookup(a.lookupId, found)).toMatchObject({
      kind: "finished",
      applied: { email: false, name: false, notes: false },
    });
    expect(await giftRow(a.id)).toMatchObject({ email: null, recipient_name: null, notes: null });
    expect((await lookupsOf(a.id))[0]).toMatchObject({ outcome: "address", email: addressOf("late") });

    const gone = await seed("sent", { linkOn: true });
    const b = await ensured(gone);
    await drive("PATCH", `/api/admin/author-gifts/${b.id}`, { email: addressOf("sent") });
    expect((await drive("POST", `/api/admin/author-gifts/${b.id}/send`, null)).status).toBe(201);
    expect(await finishLookup(b.lookupId, found)).toMatchObject({ applied: { email: false, name: false, notes: false } });
    expect(await giftRow(b.id)).toMatchObject({ email: addressOf("sent"), recipient_name: null, notes: null });
  });

  it("does not fill an address that is not one, or a name that is not one line of at most 80", async () => {
    const mine = await seed("bad-fill");
    const { id, lookupId } = await ensured(mine);
    const answer = await finishLookup(lookupId, {
      kind: "found",
      authorName: "x".repeat(81),
      authorSourceUrl: null,
      email: "not an address",
      emailSourceUrl: null,
      suggestedEmail: null,
      contactUrl: null,
      searches: 1,
      model: null,
      notes: null,
    });
    expect(answer).toMatchObject({ outcome: "author", applied: { email: false, name: false } });
    expect(await giftRow(id)).toMatchObject({ email: null, recipient_name: null });
  });
});

describe("appendNotes", () => {
  it("appends under a blank line, and cuts the block to fit with a line saying so", () => {
    expect(appendNotes(null, "Block.", 100)).toBe("Block.");
    expect(appendNotes("Mine.", "Block.", 100)).toBe("Mine.\n\nBlock.");
    const cut = appendNotes("Mine.", "y".repeat(200), 100);
    expect(cut).not.toBeNull();
    expect([...(cut ?? "")].length).toBeLessThanOrEqual(100);
    expect(cut).toMatch(/^Mine\.\n\ny+\n\[Cut to fit/);
    /* No room at all: nothing appended, rather than a pending lookup. */
    expect(appendNotes("z".repeat(100), "Block.", 100)).toBeNull();
    /* Code points, as Postgres counts. */
    expect([...(appendNotes("😀".repeat(50), "😀".repeat(80), 100) ?? "")].length).toBeLessThanOrEqual(100);
  });
});

/* ------------------------------------------------------------------- list -- */

describe("GET /api/admin/author-gifts", () => {
  it("lists every gift with its status, its lookups and what each cost from the ledger, never the key", async () => {
    const mine = await seed("listed");
    const { id, lookupId } = await ensured(mine);
    const run = randomUUID();
    runIds.push(run);
    expect(await claimLookup(lookupId, run)).toBe(true);
    for (const over of [
      { creditsUsedNanos: 1500 },
      { creditsUsedNanos: 2500 },
      /* A call that said nothing about its cost: the figure is a floor. */
      { costSource: "none", creditsUsedNanos: null },
    ] as const) {
      await getDb().insert(aiCalls).values(aiCallInsertValues(aiCall(run, over), null));
    }
    await settle(lookupId);

    const reply = await drive("GET", "/api/admin/author-gifts", null);
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    const gifts = reply.body.gifts as AdminAuthorGift[];
    const gift = gifts.find((g) => g.id === id);
    expect(gift).toMatchObject({ status: "draft", starter: { slug: mine.slug, title: mine.title }, voucherId: null });
    expect(gift?.lookups[0]).toMatchObject({ id: lookupId, outcome: "failed", cost: { nanos: 4000, calls: 3, unpricedCalls: 1 } });
    expect(JSON.stringify(reply.body)).not.toContain("AGIFTxKEY");
    expect(JSON.stringify(reply.body)).not.toMatch(/share_?token/i);
  });
});

/* ----------------------------------------------------------------- admins -- */

describe("the namespace gate", () => {
  it("refuses every author-gift route to anybody but the administrator, and writes nothing", async () => {
    const theirs = await seed("gate", { owner: STRANGER });
    const id = randomUUID();
    for (const [method, url, body] of [
      ["POST", "/api/admin/author-gifts", { slug: theirs.slug, rightsConfirmed: true }],
      ["GET", "/api/admin/author-gifts", null],
      ["PATCH", `/api/admin/author-gifts/${id}`, { notes: "x" }],
      ["POST", `/api/admin/author-gifts/${id}/lookups`, null],
      ["POST", `/api/admin/author-gifts/${id}/send`, null],
    ] as const) {
      const reply = await drive(method, url, body, STRANGER);
      expect(reply.status, `${method} ${url}`).toBe(403);
    }
    const { rows } = await pool.query("select count(*)::int as n from spideryarn.author_gifts where article_id = $1", [theirs.id]);
    expect(rows[0]).toEqual({ n: 0 });
    expect(await shareTokenOf(theirs.id)).toBeNull();
  });
});

/* ---------------------------------------------------------------- driving -- */

/** One ledger row for `run`, owned by the administrator. The shape of tests/never-published-tidy.test.ts's. */
function aiCall(run: string, over: Partial<AiCallRow> = {}): AiCallRow {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), runId: run, generationId: null, scopeKind: "request",
    ownerId: ADMIN, articleSlug: null, jobId: null, stepName: null, wire: "chat", job: "author-lookup",
    requestedModel: "anthropic/claude-sonnet-5", answeredModel: "anthropic/claude-sonnet-5", upstream: "Anthropic",
    providerAccount: "openrouter", costSource: "provider", computedCostNanos: null, priceVersion: null,
    credentialFingerprint: null, startedAt: now, finishedAt: now,
    durationMs: 1, outcome: "ok", attempt: null, failurePhase: null, failureClass: null, failureStatus: null,
    creditsUsedNanos: 1, byokUpstreamNanos: null, isByok: false, reportedInputTokens: 1, outputTokens: 1,
    cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0,
    webSearches: null, serviceTier: null, inferenceGeo: null, realtimeSessionId: null, providerEventId: null,
    eventKind: null, providerStatus: null, inputTextTokens: null, inputAudioTokens: null, inputImageTokens: null,
    cachedTextTokens: null, cachedAudioTokens: null, outputTextTokens: null, outputAudioTokens: null,
    transcriptionSeconds: null, voiceSeconds: null,
    ...over,
  };
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function signedInAs(owner: string): Verifier {
  return async () => ({ ok: true, claims: { sub: owner, email: `${owner}@example.invalid`, role: "authenticated" } });
}

/** Drive `handleApi`, as tests/voucher-starter.test.ts does; the administrator unless told otherwise. */
async function drive(method: string, url: string, body: unknown, owner: string = ADMIN): Promise<Reply> {
  const raw = body === null ? "" : JSON.stringify(body);
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
