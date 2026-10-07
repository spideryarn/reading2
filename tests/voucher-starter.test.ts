/**
 * **A gift voucher's starter article** — one of the administrator's own
 * articles, linked from the gift email: by its private link when it is
 * private, by its public address when it is public.
 * docs/plans/261007j-gift-voucher-starter-article-by-private-link.md, stage 1.
 *
 * The private link's key is a credential, so most of this file is about where
 * it may and may not end up. It may be in the kept email
 * (`billing_voucher_emails`), and so in what Resend is sent; it may not be in
 * the voucher's row, the voucher list, a log line, an HTTP error or anything
 * handed to Sentry — including when the email's insert fails and Drizzle puts
 * the whole email into its error message (Sol's F1 on the plan).
 *
 * The rest is the rules: replay first, before anything about the article is
 * looked at (F2); a readdress resolves the starter afresh and says when it
 * dropped it (F3); somebody else's article, an unpublished one and a private
 * one with its link off are refused.
 *
 * **No real email can leave**, as in tests/billing-voucher-emails.test.ts: the
 * send goes through an injected `fetch`, and the Auth Admin API is replaced.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const HOISTED = vi.hoisted(() => {
  /* Raised before any import, so src/log.ts captures info lines and "no line
     carries the key" is a claim about lines that exist. */
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "info";
  return { level };
});

const control = vi.hoisted(() => ({
  deps: {} as import("../src/store/pg-voucher-emails.js").VoucherEmailDeps,
  /** Make the gift email's insert fail for real: a voucher id nothing has, so the foreign key refuses it. */
  failQueueGift: false,
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
  const { randomUUID: uuid } = await import("node:crypto");
  return {
    ...real,
    sendQueuedVoucherEmail: (id: string, deps?: import("../src/store/pg-voucher-emails.js").VoucherEmailDeps) =>
      real.sendQueuedVoucherEmail(id, deps ?? control.deps),
    queueGiftEmail: (...args: Parameters<typeof real.queueGiftEmail>) => {
      const [tx, voucherId, ...rest] = args;
      /* A real Drizzle failure, so its message carries the real parameters —
         the rendered email, key and all — which is the leak F1 is about. */
      return real.queueGiftEmail(tx, control.failQueueGift ? uuid() : voucherId, ...rest);
    },
  };
});

/* Watched, not replaced: what a 500 hands Sentry. */
vi.mock("../src/monitoring.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/monitoring.js")>();
  return { ...actual, captureFailure: vi.fn(actual.captureFailure) };
});

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { captureFailure } from "../src/monitoring.js";
import { handleApi } from "../src/routes.js";
import { giftMessage, type GiftAudience, type VoucherEmailDeps } from "../src/store/pg-voucher-emails.js";
import { listVouchers, updateVoucher } from "../src/store/pg-vouchers.js";
import { articles, points } from "../src/billing/points.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

if (HOISTED.level === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.level;

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/voucher-starter.test.ts",
  tables: ["spideryarn.billing_vouchers", "spideryarn.billing_voucher_emails"],
  columns: [
    { table: "spideryarn.billing_vouchers", column: "starter_article_id" },
    { table: "spideryarn.billing_vouchers", column: "starter_slug" },
    { table: "spideryarn.articles", column: "share_token" },
  ],
  keepPool: true,
  max: 4,
});

/* Minted per run under this file's own stem, so no other file sweeps them. */
const STEM = "0000b0c6-0000-4000-8000-";
const RUN = randomUUID().slice(0, 8);
const mint = () => `${STEM}${randomUUID().slice(-12)}`;
const ADMIN = ADMIN_USER_ID_LOCAL;
/** Somebody else, who owns one article. Not an administrator. */
const STRANGER = mint();
const addressOf = (n: string) => `vstart-${STEM}${n}-${RUN}@example.invalid`;

/**
 * **What every private starter's key here begins with.** Each key is this and
 * nine digits — twenty-two base64url characters, as the CHECK on
 * `articles.share_token` wants, and distinct, as its unique index wants — so
 * wherever this string turns up, a key went there.
 */
const SENTINEL_KEY = "SENTINELxKEYx";
let keys = 0;
const nextKey = (stem = SENTINEL_KEY) => {
  keys += 1;
  return `${stem}${String(keys).padStart(9, "0")}`;
};
/** A key made after the email was sent: begins differently, so the two cannot be confused. */
const rotatedKey = () => nextKey("ROTATEDxKEYxx");

const PROD = { VERCEL_ENV: "production", RESEND_API_KEY: "re_test_key" } as const;

interface Seeded {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly key: string | null;
}

const seeded: string[] = [];

/** One article, published unless told otherwise. */
async function seed(
  name: string,
  opts: {
    owner?: string;
    visibility?: "private" | "public";
    key?: string | null;
    processing?: "minimal";
    unpublished?: boolean;
    title?: string;
  } = {},
): Promise<Seeded> {
  const id = randomUUID();
  const revision = randomUUID();
  const slug = `test-voucher-starter-${name}-${RUN}`;
  const title = opts.title ?? `The ${name} article`;
  const key = opts.key === undefined ? nextKey() : opts.key;
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
  if (opts.processing === "minimal") {
    await pool.query("update spideryarn.articles set processing = 'minimal' where id = $1", [id]);
  }
  return { id, slug, title, key };
}

async function deleteArticle(id: string): Promise<void> {
  await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
  await pool.query("delete from spideryarn.article_revisions where article_id = $1", [id]);
  await pool.query("delete from spideryarn.articles where id = $1", [id]);
}

async function sweep(): Promise<void> {
  await pool.query("delete from spideryarn.billing_vouchers where email like $1", [`vstart-${STEM}%`]);
  for (const id of seeded.splice(0)) await deleteArticle(id);
}

beforeAll(async () => {
  await sweep();
  /* `articles.owner_id` references the account, so the stranger has to exist. */
  await seedAuthUser(pool, { id: STRANGER, email: `${STRANGER}@example.invalid` });
});

afterEach(async () => {
  control.deps = {};
  control.failQueueGift = false;
  vi.mocked(captureFailure).mockClear();
  await sweep();
});

afterAll(async () => {
  await sweep();
  await pool.query("delete from auth.users where id = $1", [STRANGER]).catch(() => {});
  await pool.end();
});

/** A fake Resend that records what it was asked to send. */
function mailbox() {
  const sent: { to: string[]; subject: string; text: string; html?: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
  });
  const deps: VoucherEmailDeps = { email: { fetch, env: PROD } };
  return { sent, fetch, deps };
}

const privateLink = (slug: string, key: string) => `https://www.spideryarn.com/read/${slug}?key=${key}`;
const publicLink = (slug: string) => `https://www.spideryarn.com/read/${slug}`;

/** The voucher's emails, oldest first, bodies included — for assertions about the kept copy. */
async function emailsOf(voucherId: string) {
  const { rows } = await pool.query(
    "select status, recipient, subject, body_text, body_html from spideryarn.billing_voucher_emails where voucher_id = $1 order by created_at, id",
    [voucherId],
  );
  return rows as { status: string; recipient: string; subject: string; body_text: string; body_html: string }[];
}

async function voucherRow(id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await pool.query("select * from spideryarn.billing_vouchers where id = $1", [id]);
  return rows[0] as Record<string, unknown> | undefined;
}

function createBody(starterSlug: string | null, n = "a", id = randomUUID()) {
  return { id, email: addressOf(n), articles: 5, note: null, recipientNote: null, recipientName: null, starterSlug };
}

/* ------------------------------------------------------------ the email -- */

describe("the gift email, with a starter", () => {
  const READER_FREE: GiftAudience = {
    kind: "reader",
    plan: { kind: "free", limit: articles(3), wallUsed: points(0), waiting: articles(0) },
  };
  const BOTH = [{ kind: "invite" } as const, READER_FREE];
  const URL = privateLink("the-bitter-lesson", `${SENTINEL_KEY}000000000`);
  const words = (title: string, recipientNote: string | null = null) => ({
    recipientName: null,
    recipientNote,
    starter: { title, url: URL },
  });

  it("carries the link in the text and the HTML, after the note and before the intro, for both audiences", () => {
    for (const audience of BOTH) {
      const mail = giftMessage(20, audience, words("The Bitter Lesson", "Hello.\n— Greg"));
      expect(mail.text).toContain(
        `Hello.\n— Greg\n\nHere is "The Bitter Lesson" in Spideryarn, to start with:\n${URL}\n\nYou have been given`,
      );
      const html = mail.html ?? "";
      expect(html).toContain("Here is &quot;The Bitter Lesson&quot; in Spideryarn, to start with:");
      expect(html).toContain(`<a href="${URL}"`);
      expect(html).toContain(">Read it</a>");
      expect(html.indexOf("<em>Hello.")).toBeLessThan(html.indexOf("Here is &quot;"));
      expect(html.indexOf(">Read it</a>")).toBeLessThan(html.indexOf("You have been given"));
      /* Never in the subject. */
      expect(mail.subject).toBe("A gift of 20 free articles on Spideryarn");
    }
  });

  it("is byte for byte the email with no starter when there is none", () => {
    for (const audience of BOTH) {
      expect(giftMessage(20, audience, { recipientName: null, recipientNote: "n", starter: null })).toEqual(
        giftMessage(20, audience, { recipientName: null, recipientNote: "n" }),
      );
    }
  });

  it("puts a title with markup in it as text, on one line, and never in the subject", () => {
    const title = `<b>Bitter</b> & "Lesson"\n<a href="https://evil.example">x</a>`;
    for (const audience of BOTH) {
      const mail = giftMessage(20, audience, words(title));
      expect(mail.text).toContain(`Here is "<b>Bitter</b> & "Lesson" <a href="https://evil.example">x</a>" in Spideryarn`);
      const html = mail.html ?? "";
      expect(html).toContain("&lt;b&gt;Bitter&lt;/b&gt; &amp; &quot;Lesson&quot; &lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;");
      expect(html).not.toContain("<b>Bitter");
      expect(html).not.toContain('href="https://evil.example"');
      expect(html).not.toMatch(/Lesson&quot;<br>/);
      expect(mail.subject).not.toContain("Bitter");
    }
  });
});

/* ------------------------------------------------------------- creating -- */

describe("creating a voucher with a starter", () => {
  it("emails a private article's private link, and keeps which article but never the key", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const mine = await seed("private");
    const body = createBody(mine.slug);
    const reply = await drive("POST", "/api/admin/vouchers", body);
    expect(reply.status).toBe(201);

    const [mail] = box.sent;
    expect(mail?.text).toContain(privateLink(mine.slug, mine.key ?? "none"));
    expect(mail?.html).toContain(privateLink(mine.slug, mine.key ?? "none"));
    expect(mail?.text).toContain(`"${mine.title}"`);
    expect(mail?.subject).not.toContain(SENTINEL_KEY);

    /* The kept copy is the one place of ours it may be. */
    const [kept] = await emailsOf(body.id);
    expect(kept?.body_text).toContain(SENTINEL_KEY);

    const row = await voucherRow(body.id);
    expect(row).toMatchObject({ starter_article_id: mine.id, starter_slug: mine.slug });
    expect(JSON.stringify(row)).not.toContain(SENTINEL_KEY);
  });

  it("emails a public article's plain address, with no key", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const open = await seed("public", { visibility: "public" });
    const reply = await drive("POST", "/api/admin/vouchers", createBody(open.slug));
    expect(reply.status).toBe(201);
    const [mail] = box.sent;
    expect(mail?.text).toContain(`${publicLink(open.slug)}\n`);
    expect(mail?.text).not.toContain("?key=");
    expect(mail?.html).not.toContain(SENTINEL_KEY);
  });

  it("refuses another owner's article, and one that does not exist, as a 400 — and makes nothing", async () => {
    const theirs = await seed("theirs", { owner: STRANGER });
    for (const slug of [theirs.slug, `test-voucher-starter-nobody-${RUN}`]) {
      const body = createBody(slug);
      const reply = await drive("POST", "/api/admin/vouchers", body);
      expect(reply.status, slug).toBe(400);
      expect(JSON.stringify(reply.body)).not.toContain(SENTINEL_KEY);
      expect(await voucherRow(body.id)).toBeUndefined();
    }
  });

  it("refuses an unpublished article, a minimal paper and a private article with its link off, as a 409", async () => {
    const cases = [
      await seed("unpublished", { unpublished: true }),
      await seed("minimal", { processing: "minimal", key: null }),
      await seed("off", { key: null }),
    ];
    for (const article of cases) {
      const body = createBody(article.slug);
      const reply = await drive("POST", "/api/admin/vouchers", body);
      expect(reply.status, article.slug).toBe(409);
      expect(await voucherRow(body.id)).toBeUndefined();
    }
  });

  it("refuses a starterSlug that is not a slug, and a PATCH that tries to set one", async () => {
    for (const starterSlug of ["Not A Slug", 7, ""]) {
      const reply = await drive("POST", "/api/admin/vouchers", { ...createBody(null), starterSlug });
      expect(reply.status, String(starterSlug)).toBe(400);
    }
    const made = createBody(null);
    expect((await drive("POST", "/api/admin/vouchers", made)).status).toBe(201);
    const mine = await seed("late");
    const patch = await drive("PATCH", `/api/admin/vouchers/${made.id}`, { starterSlug: mine.slug });
    expect(patch.status).toBe(400);
  });
});

/* ------------------------------------------------------------- replaying -- */

describe("a replayed create", () => {
  it("is answered as the same create after the link is turned off, rotated, or the article deleted — and queues nothing", async () => {
    for (const change of ["off", "rotated", "deleted"] as const) {
      const box = mailbox();
      control.deps = box.deps;
      const mine = await seed(`replay-${change}`);
      const body = createBody(mine.slug, change);
      expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);

      if (change === "off") {
        await pool.query("update spideryarn.articles set share_token = null, share_token_at = null where id = $1", [mine.id]);
      } else if (change === "rotated") {
        await pool.query("update spideryarn.articles set share_token = $2, share_token_at = now() where id = $1", [mine.id, rotatedKey()]);
      } else {
        await deleteArticle(mine.id);
      }

      const again = await drive("POST", "/api/admin/vouchers", body);
      expect(again.status, change).toBe(200);
      expect(again.body).toEqual({ id: body.id, email: "replayed" });
      expect(await emailsOf(body.id)).toHaveLength(1);
      expect(box.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("with a different starter, or none, under the same id is a 409", async () => {
    control.deps = mailbox().deps;
    const one = await seed("one");
    const two = await seed("two");
    const body = createBody(one.slug);
    expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
    for (const starterSlug of [two.slug, null]) {
      expect((await drive("POST", "/api/admin/vouchers", { ...body, starterSlug })).status).toBe(409);
    }
    const bare = createBody(null, "bare");
    expect((await drive("POST", "/api/admin/vouchers", bare)).status).toBe(201);
    expect((await drive("POST", "/api/admin/vouchers", { ...bare, starterSlug: one.slug })).status).toBe(409);
    expect(await emailsOf(body.id)).toHaveLength(1);
    expect(await emailsOf(bare.id)).toHaveLength(1);
  });
});

/* ----------------------------------------------------------- readdressing -- */

describe("changing the address of a voucher with a starter", () => {
  it("reads the key afresh: the new email carries the link as it is now, and says it was kept", async () => {
    const box = mailbox();
    control.deps = box.deps;
    const mine = await seed("readdress");
    const body = createBody(mine.slug, "first");
    expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
    const rotated = rotatedKey();
    await pool.query("update spideryarn.articles set share_token = $2, share_token_at = now() where id = $1", [mine.id, rotated]);

    const reply = await drive("PATCH", `/api/admin/vouchers/${body.id}`, { email: addressOf("second") });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, email: "queued", starter: "kept" });
    const latest = box.sent.at(-1);
    expect(latest?.to).toEqual([addressOf("second")]);
    expect(latest?.text).toContain(privateLink(mine.slug, rotated));
    expect(latest?.text).not.toContain(SENTINEL_KEY);
  });

  it("drops a starter that no longer resolves — link off, unpublished, deleted — and says so", async () => {
    for (const change of ["off", "unpublished", "deleted"] as const) {
      const box = mailbox();
      control.deps = box.deps;
      const mine = await seed(`drop-${change}`);
      const body = createBody(mine.slug, `drop-${change}`);
      expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
      if (change === "off") {
        await pool.query("update spideryarn.articles set share_token = null, share_token_at = null where id = $1", [mine.id]);
      } else if (change === "unpublished") {
        await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [mine.id]);
      } else {
        await deleteArticle(mine.id);
      }

      const reply = await drive("PATCH", `/api/admin/vouchers/${body.id}`, { email: addressOf(`moved-${change}`) });
      expect(reply.status, change).toBe(200);
      expect(reply.body, change).toEqual({ ok: true, email: "queued", starter: "dropped" });
      const latest = box.sent.at(-1);
      expect(latest?.to).toEqual([addressOf(`moved-${change}`)]);
      expect(latest?.text).not.toContain("Here is");
      expect(latest?.text).not.toContain("/read/");
      /* The slug outlives the article, which is how the PATCH knew there was one. */
      expect(await voucherRow(body.id)).toMatchObject({ starter_slug: mine.slug });
    }
  });

  it("does not look at the starter when the address does not really change, and says nothing about one there never was", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("same");
    const body = createBody(mine.slug, "same");
    expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
    const resolveStarter = vi.fn(async () => {
      throw new Error("should not be asked");
    });
    expect(await updateVoucher(body.id, { email: addressOf("same") }, { resolveStarter })).toEqual({ kind: "updated" });
    expect(await updateVoucher(body.id, { note: "only the note" }, { resolveStarter })).toEqual({ kind: "updated" });
    expect(resolveStarter).not.toHaveBeenCalled();

    const bare = createBody(null, "bare-moved");
    expect((await drive("POST", "/api/admin/vouchers", bare)).status).toBe(201);
    const reply = await drive("PATCH", `/api/admin/vouchers/${bare.id}`, { email: addressOf("bare-moved-2") });
    expect(reply.body).toEqual({ ok: true, email: "queued" });
  });

  it("fails the change, sending nothing new, when the starter cannot be read", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("unreadable");
    const body = createBody(mine.slug, "unreadable");
    expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
    const resolveStarter = async () => {
      throw new Error("the database is down");
    };
    await expect(updateVoucher(body.id, { email: addressOf("unreadable-2") }, { resolveStarter })).rejects.toThrow();
    expect(await voucherRow(body.id)).toMatchObject({ email: addressOf("unreadable") });
    expect(await emailsOf(body.id)).toHaveLength(1);
  });
});

/* -------------------------------------------- where the key does not go -- */

describe("the key, when the email's insert fails (Sol's F1)", () => {
  it("rolls the create back, and reaches neither the answer, the log nor Sentry", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("fails");
    const body = createBody(mine.slug, "fails");
    let reply: Reply | undefined;
    const said = await logLinesWhile(async () => {
      control.failQueueGift = true;
      reply = await drive("POST", "/api/admin/vouchers", body);
    });
    expect(reply?.status).toBe(500);
    /* The failure was really logged, so the absence below is about a line that exists. */
    expect(said).toContain("POST /api/admin/vouchers 500");
    expect(said).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(reply?.body)).not.toContain(SENTINEL_KEY);
    expect(vi.mocked(captureFailure)).toHaveBeenCalled();
    expect(sentryCalls()).not.toContain(SENTINEL_KEY);
    expect(await voucherRow(body.id)).toBeUndefined();
  });

  it("rolls the readdress back, and reaches neither the answer, the log nor Sentry", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("fails-later");
    const body = createBody(mine.slug, "fails-later");
    expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
    let reply: Reply | undefined;
    const said = await logLinesWhile(async () => {
      control.failQueueGift = true;
      reply = await drive("PATCH", `/api/admin/vouchers/${body.id}`, { email: addressOf("fails-later-2") });
    });
    expect(reply?.status).toBe(500);
    expect(said).toContain("PATCH /api/admin/vouchers/");
    expect(said).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(reply?.body)).not.toContain(SENTINEL_KEY);
    expect(vi.mocked(captureFailure)).toHaveBeenCalled();
    expect(sentryCalls()).not.toContain(SENTINEL_KEY);
    expect(await voucherRow(body.id)).toMatchObject({ email: addressOf("fails-later") });
    expect(await emailsOf(body.id)).toHaveLength(1);
  });
});

describe("the voucher list", () => {
  it("names the starter by slug and title, and never carries the key", async () => {
    control.deps = mailbox().deps;
    const mine = await seed("listed");
    const body = createBody(mine.slug, "listed");
    expect((await drive("POST", "/api/admin/vouchers", body)).status).toBe(201);
    const bare = createBody(null, "listed-bare");
    expect((await drive("POST", "/api/admin/vouchers", bare)).status).toBe(201);

    const listed = await listVouchers();
    expect(listed.find((v) => v.id === body.id)?.starter).toEqual({ slug: mine.slug, title: mine.title });
    expect(listed.find((v) => v.id === bare.id)?.starter).toBeNull();
    const reply = await drive("GET", "/api/admin/vouchers", null);
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).toContain(mine.slug);
    expect(JSON.stringify(reply.body)).not.toContain(SENTINEL_KEY);

    /* Deleted: the slug stays, the title goes with the article. */
    await deleteArticle(mine.id);
    expect((await listVouchers()).find((v) => v.id === body.id)?.starter).toEqual({ slug: mine.slug, title: null });
  });

  it("reads the emails' state, never their bodies", () => {
    /* The kept email is where the key is, so the list's read of it is pinned
       to the status columns. Comments stripped, so prose may name them. */
    const source = readFileSync(new URL("../src/store/pg-voucher-emails.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const latest = /export async function latestVoucherEmails[\s\S]*?\n}\n/.exec(source)?.[0] ?? "";
    expect(latest).toContain("distinct on");
    expect(latest).not.toMatch(/body_text|body_html|bodyText|bodyHtml|e\.\*|select \*/);
  });
});

/* ---------------------------------------------------------------- driving -- */

/** Everything handed to Sentry's capture, as one string. */
function sentryCalls(): string {
  return vi
    .mocked(captureFailure)
    .mock.calls.map((args) =>
      args
        .map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack ?? ""} ${JSON.stringify(a)}` : JSON.stringify(a)))
        .join(" "),
    )
    .join("\n");
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

function signedInAs(owner: string): Verifier {
  return async () => ({ ok: true, claims: { sub: owner, email: `${owner}@example.invalid`, role: "authenticated" } });
}

/** Drive `handleApi` as the administrator, as tests/billing-voucher-emails.test.ts does. */
async function drive(method: string, url: string, body: unknown): Promise<Reply> {
  const raw = body === null ? "" : JSON.stringify(body);
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method, url, headers: { authorization: "Bearer test-token", "content-type": "application/json" } },
  ) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, signedInAs(ADMIN));
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}
