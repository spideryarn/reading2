/**
 * **A gift's starter article becoming its recipient's when they sign in** —
 * `claimVouchersFor` step 5 (src/store/pg-vouchers.ts) through
 * `transferStarterOnClaim` (src/store/pg-article-transfer.ts), and what
 * `GET /api/billing/usage` and the admin lists say about it afterwards.
 * docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md § D3;
 * Tests 2.
 *
 * What is pinned:
 *
 * - a private starter with none of the creator's own words on it moves to the
 *   claimant, its activity (reading time) goes, and its slug is in `articles`;
 * - **it does not move**, and the voucher is claimed every time, when: the
 *   creator has a comment on it; it is public; another unrevoked voucher names
 *   it; the creator no longer owns it — and a revoked second voucher does not
 *   stop it;
 * - an error inside the move rolls back to the savepoint: the article stays,
 *   the claim commits;
 * - the route answers `claimedArticles`, once;
 * - the voucher list and the author gift list say whose it is now
 *   (`starter.owner`), and the gift keeps the moved article's title.
 *
 * The Auth Admin API is replaced (as in tests/article-transfer.test.ts), and
 * the creator's notice is not queued: tests/billing-voucher-emails.test.ts
 * owns that.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  /** Ids the replaced Auth service says are live with a confirmed address, and that address. */
  confirmed: new Map<string, string>(),
  /** Make the move throw after it has written, inside the claim's savepoint. */
  failMove: false,
}));

vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    confirmedAccountEmail: async (id: string) => {
      const email = control.confirmed.get(id);
      return email === undefined ? { kind: "unconfirmed" } : { kind: "confirmed", email };
    },
    accountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
  };
});

vi.mock("../src/store/pg-voucher-emails.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/pg-voucher-emails.js")>();
  return { ...real, queueClaimedEmail: async () => null };
});

vi.mock("../src/store/pg-article-transfer.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/pg-article-transfer.js")>();
  return {
    ...real,
    transferStarterOnClaim: async (...args: Parameters<typeof real.transferStarterOnClaim>) => {
      const answer = await real.transferStarterOnClaim(...args);
      if (control.failMove) throw new Error("the move failed after writing, on purpose");
      return answer;
    },
  };
});

import type { Verifier } from "../src/auth.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { handleApi } from "../src/routes.js";
import { listAuthorGifts } from "../src/store/pg-author-gifts.js";
import { claimVouchersFor, listVouchers } from "../src/store/pg-vouchers.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/claim-starter-article.test.ts",
  tables: ["spideryarn.billing_vouchers", "spideryarn.author_gifts", "spideryarn.articles"],
  keepPool: true,
  max: 4,
});

/* Minted per run under this file's own stem, so no other file sweeps them. */
const STEM = "0000c1a5-0000-4000-8000-";
const RUBBLE = `${STEM}%`;
const RUN = randomUUID().slice(0, 8);
const mint = () => `${STEM}${randomUUID().slice(-12)}`;
/** The administrator who made the gift, and owns the starter. */
const ALICE = mint();
/** The recipient. */
const BOB = mint();
/** Somebody the article was moved to by hand. */
const CAROL = mint();
const emailOf = (owner: string) => `claim-starter-${owner}@example.invalid`;
const SLUG_STEM = "test-claim-starter-";

let keys = 0;
function nextKey(): string {
  keys += 1;
  return `CLAIMSTxKEYxxx${String(keys).padStart(8, "0")}`;
}

interface Seeded {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly block: string;
}

/** One published article, private with its link on (as a gift's starter is) unless told otherwise. */
async function seed(name: string, opts: { owner?: string; visibility?: "private" | "public" } = {}): Promise<Seeded> {
  const id = randomUUID();
  const revision = randomUUID();
  const slug = `${SLUG_STEM}${name}-${RUN}`;
  const title = `The ${name} article`;
  const block = mintId();
  const key = nextKey();
  await pool.query(
    `insert into spideryarn.articles (id, owner_id, slug, short_id, visibility, public_at, share_token, share_token_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [id, opts.owner ?? ALICE, slug, mintId(), opts.visibility ?? "private", opts.visibility === "public" ? new Date() : null, key],
  );
  await pool.query(
    `insert into spideryarn.article_revisions
       (id, article_id, status, title, word_count, block_count, part_count, section_count)
     values ($1, $2, 'published', $3, 9, 1, 0, 0)`,
    [revision, id, title],
  );
  await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [id, revision]);
  await pool.query("insert into spideryarn.block_identities (article_id, block_id) values ($1, $2)", [id, block]);
  /* The creator's reading time: activity, not their words, so it never stops a move. */
  await pool.query("insert into spideryarn.reading_time (article_id, block_id, seconds) values ($1, $2, 42)", [id, block]);
  return { id, slug, title, block };
}

/** An unclaimed voucher from Alice to `to`, naming `starter`. */
async function voucher(starter: Seeded | null, to: string = BOB, opts: { revoked?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into spideryarn.billing_vouchers (id, email, articles, created_by, starter_article_id, starter_slug, revoked_at)
     values ($1, $2, 5, $3, $4, $5, $6)`,
    [id, emailOf(to), ALICE, starter?.id ?? null, starter?.slug ?? null, opts.revoked ? new Date() : null],
  );
  return id;
}

async function ownerOf(articleId: string): Promise<string> {
  const { rows } = await pool.query("select owner_id from spideryarn.articles where id = $1", [articleId]);
  return (rows[0] as { owner_id: string }).owner_id;
}

async function claimedBy(voucherId: string): Promise<string | null> {
  const { rows } = await pool.query("select claimed_by from spideryarn.billing_vouchers where id = $1", [voucherId]);
  return (rows[0] as { claimed_by: string | null }).claimed_by;
}

async function count(table: string, articleId: string): Promise<number> {
  const { rows } = await pool.query(`select count(*)::int as n from spideryarn.${table} where article_id = $1`, [articleId]);
  return (rows[0] as { n: number }).n;
}

const claimAsBob = () => claimVouchersFor({ id: BOB, email: emailOf(BOB) });

async function sweep(): Promise<void> {
  const owners = [ALICE, BOB, CAROL];
  await pool.query("delete from spideryarn.author_gifts where created_by = any($1::uuid[])", [owners]);
  await pool.query("delete from spideryarn.billing_vouchers where created_by = any($1::uuid[])", [owners]);
  await pool.query("delete from spideryarn.article_visibility_changes where slug like $1", [`${SLUG_STEM}%`]);
  await pool.query("delete from spideryarn.article_share_link_events where slug like $1", [`${SLUG_STEM}%`]);
  const { rows } = await pool.query("select id from spideryarn.articles where slug like $1", [`${SLUG_STEM}%`]);
  for (const { id } of rows as { id: string }[]) {
    await pool.query("delete from spideryarn.comments where article_id = $1", [id]);
    await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
    await pool.query("delete from spideryarn.article_revisions where article_id = $1", [id]);
    await pool.query("delete from spideryarn.articles where id = $1", [id]);
  }
  await pool.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
}

beforeAll(async () => {
  await sweep();
  for (const owner of [ALICE, BOB, CAROL]) await seedAuthUser(pool, { id: owner, email: emailOf(owner) });
});

afterEach(async () => {
  control.confirmed = new Map([[BOB, emailOf(BOB)]]);
  control.failMove = false;
  await sweep();
});

afterAll(async () => {
  await sweep();
  await pool.query("delete from auth.users where id::text like $1", [RUBBLE]).catch(() => {});
  await pool.end();
});

control.confirmed = new Map([[BOB, emailOf(BOB)]]);

/* ----------------------------------------------------------------- moves -- */

describe("claimVouchersFor — the starter moves", () => {
  it("moves a private starter with none of the creator's words on it, and says which", async () => {
    const a = await seed("moves");
    const v = await voucher(a);
    const result = await claimAsBob();
    expect(result.claimed).toBe(1);
    expect(result.articles).toEqual([a.slug]);
    expect(await ownerOf(a.id)).toBe(BOB);
    expect(await claimedBy(v)).toBe(BOB);
    /* The creator's activity went with the move; the link they handed out is off. */
    expect(await count("reading_time", a.id)).toBe(0);
    const { rows } = await pool.query("select share_token from spideryarn.articles where id = $1", [a.id]);
    expect((rows[0] as { share_token: string | null }).share_token).toBeNull();
  });

  it("moves it when the only other voucher naming it is revoked", async () => {
    const a = await seed("revoked-other");
    await voucher(a, CAROL, { revoked: true });
    await voucher(a);
    expect((await claimAsBob()).articles).toEqual([a.slug]);
    expect(await ownerOf(a.id)).toBe(BOB);
  });

  it("claims, and moves nothing, for a voucher with no starter", async () => {
    const v = await voucher(null);
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await claimedBy(v)).toBe(BOB);
  });
});

/* ----------------------------------------------------------------- stays -- */

describe("claimVouchersFor — the starter stays, and the voucher is claimed anyway", () => {
  it("leaves it when the creator has a comment on it", async () => {
    const a = await seed("commented");
    await pool.query(
      `insert into spideryarn.comments (article_id, id, owner_id, block_id, status, body)
       values ($1, $2, $3, $4, 'none', 'my own note')`,
      [a.id, mintId(), ALICE, a.block],
    );
    const v = await voucher(a);
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await ownerOf(a.id)).toBe(ALICE);
    expect(await claimedBy(v)).toBe(BOB);
    /* Nothing of theirs was deleted. */
    expect(await count("comments", a.id)).toBe(1);
    expect(await count("reading_time", a.id)).toBe(1);
  });

  it("leaves it when an illustration contains the creator's own direction", async () => {
    const a = await seed("illustrated-note");
    await pool.query(
      `update spideryarn.article_revisions
          set illustrated = $2::jsonb
        where article_id = $1`,
      [
        a.id,
        JSON.stringify({
          version: "illustrated/test",
          note: "Draw this in the style of my childhood home",
          style: "A personal painting",
          plates: [],
        }),
      ],
    );
    const v = await voucher(a);
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await ownerOf(a.id)).toBe(ALICE);
    expect(await claimedBy(v)).toBe(BOB);
    const { rows } = await pool.query(
      "select illustrated from spideryarn.article_revisions where article_id = $1",
      [a.id],
    );
    expect((rows[0] as { illustrated: { note: string } }).illustrated.note).toContain("childhood home");
  });

  it("leaves a public one on the public shelf", async () => {
    const a = await seed("public", { visibility: "public" });
    const v = await voucher(a);
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await ownerOf(a.id)).toBe(ALICE);
    expect(await claimedBy(v)).toBe(BOB);
  });

  it("leaves one that another unrevoked voucher names", async () => {
    const a = await seed("shared");
    await voucher(a, CAROL);
    const v = await voucher(a);
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await ownerOf(a.id)).toBe(ALICE);
    expect(await claimedBy(v)).toBe(BOB);
  });

  it("leaves one the creator no longer owns", async () => {
    const a = await seed("elsewhere", { owner: CAROL });
    const v = await voucher(a);
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await ownerOf(a.id)).toBe(CAROL);
    expect(await claimedBy(v)).toBe(BOB);
  });

  it("rolls a failed move back to its savepoint, and still claims", async () => {
    const a = await seed("fails");
    const v = await voucher(a);
    control.failMove = true;
    expect(await claimAsBob()).toMatchObject({ claimed: 1, articles: [] });
    expect(await ownerOf(a.id)).toBe(ALICE);
    expect(await count("reading_time", a.id)).toBe(1);
    expect(await claimedBy(v)).toBe(BOB);
  });
});

/* ----------------------------------------------------------------- route -- */

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

function signedInAs(owner: string): Verifier {
  return async () => ({ ok: true, claims: { sub: owner, email: emailOf(owner), role: "authenticated" } });
}

async function drive(method: string, url: string, owner: string): Promise<Reply> {
  const req = Object.assign((async function* () {})(), {
    method,
    url,
    headers: { authorization: "Bearer test-token" },
  }) as unknown as IncomingMessage;
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
  await handleApi(req, res, signedInAs(owner));
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("GET /api/billing/usage — claimedArticles", () => {
  it("answers the slugs this call moved, and none the next time", async () => {
    const a = await seed("route");
    await voucher(a);
    const first = await drive("GET", "/api/billing/usage", BOB);
    expect(first.status).toBe(200);
    expect(first.body.claimedArticles).toEqual([a.slug]);
    expect(first.body.plan).toBeDefined();
    const second = await drive("GET", "/api/billing/usage", BOB);
    expect(second.body.claimedArticles).toEqual([]);
  });
});

/* ----------------------------------------------------------- admin lists -- */

describe("the admin lists say whose the starter is now", () => {
  async function gift(a: Seeded, voucherId: string): Promise<string> {
    const { rows } = await pool.query(
      `insert into spideryarn.author_gifts (article_id, voucher_id, starter_slug, created_by, email, send_started_at, send_attempt)
       values ($1, $2, $3, $4, $5, now(), gen_random_uuid()) returning id`,
      [a.id, voucherId, a.slug, ALICE, emailOf(BOB)],
    );
    return (rows[0] as { id: string }).id;
  }
  const noEmail = { lookupEmail: async () => ({ kind: "unavailable" as const, reason: "test" }) };

  it("says claimant once it moved, with the gift keeping the title", async () => {
    const a = await seed("listed-moved");
    const v = await voucher(a);
    const g = await gift(a, v);
    expect((await listVouchers(noEmail)).find((x) => x.id === v)?.starter?.owner).toBeNull();
    await claimAsBob();
    expect((await listVouchers(noEmail)).find((x) => x.id === v)?.starter).toEqual({
      slug: a.slug,
      title: a.title,
      owner: "claimant",
    });
    const listed = (await listAuthorGifts()).find((x) => x.id === g);
    expect(listed?.status).toBe("sent");
    expect(listed?.starter).toMatchObject({ slug: a.slug, title: a.title, owner: "claimant" });
  });

  it("says creator when it was claimed and stayed", async () => {
    const a = await seed("listed-stayed", { visibility: "public" });
    const v = await voucher(a);
    const g = await gift(a, v);
    await claimAsBob();
    expect((await listVouchers(noEmail)).find((x) => x.id === v)?.starter?.owner).toBe("creator");
    expect((await listAuthorGifts()).find((x) => x.id === g)?.starter.owner).toBe("creator");
  });
});
