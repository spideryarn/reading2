/**
 * **Who opened a private link, end to end, against a real Postgres** — plan
 * 261021d (Greg's reply `spya-xug3kf` to q-agbc89: 1B and 2C).
 *
 * The two writes and the administrator's read, through `handleApi`:
 *
 * | | private, right key | wrong key / no key | public article | link off | owner's own id |
 * |---|---|---|---|---|---|
 * | signed-in POST | a row, then +1 | nothing | nothing | nothing | nothing |
 * | signed-out POST | a count, throttled, saturating | nothing | nothing | nothing | — |
 *
 * and `GET /api/admin/articles/:slug/access`: the administrator's own article
 * with no key; somebody else's private article only with its key (a 404
 * without it, the same 404 as no article); a public one; a non-admin is 403.
 * Nothing in the answer is a title, slug or key.
 *
 * Every case reads the tables after the request, so a 204 that wrote nothing
 * cannot pass for one that wrote.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminArticleAccess } from "../src/admin-articles.js";
import type { Verifier } from "../src/auth.js";
import { getDb } from "../src/db/client.js";
import { articles, privateLinkOpeners, privateLinkSignedOutOpens } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { handleApi } from "../src/routes.js";
import { parseShareKey, type ShareKey } from "../src/share-key.js";
import { recordOpener } from "../src/store/pg-private-link-openers.js";
import { countSignedOutOpen } from "../src/store/private-link-signed-out-opens.js";
import { AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/private-link-opens-pg.test.ts",
  tables: ["spideryarn.private_link_openers", "spideryarn.private_link_signed_out_opens"],
});

const RUN = randomUUID().slice(0, 8);
/** The administrator, on a local stack: `acceptAny`'s account. */
const ADMIN = TEST_SUB;
/** Somebody else, who owns the private articles. */
const OWNER = randomUUID();
/** A third account, who opens them. */
const VISITOR = randomUUID();

function keyOf(seed: string): ShareKey {
  const key = parseShareKey(`${seed}${"k".repeat(22)}`.slice(0, 22));
  if (key === null) throw new Error(`not a key: ${seed}`);
  return key;
}

const KEY = keyOf(`a${RUN}`);
const OTHER_KEY = keyOf(`b${RUN}`);
const ADMIN_KEY = keyOf(`c${RUN}`);
const LINKED = `plo-linked-${RUN}`;
const PUBLIC = `plo-public-${RUN}`;
const UNLINKED = `plo-unlinked-${RUN}`;
const ADMINS = `plo-admins-${RUN}`;
const SLUGS = [LINKED, PUBLIC, UNLINKED, ADMINS];

const as = (sub: string): Verifier => async () => ({
  ok: true,
  claims: { sub, email: `${sub}@example.test`, role: "authenticated", is_anonymous: false },
});

async function call(method: string, url: string, verify: Verifier | null) {
  const req = Object.assign((async function* () {})(), {
    method,
    url,
    headers: verify ? AUTHED_HEADERS : {},
  }) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    setHeader() {},
    end(chunk?: string) {
      if (chunk) text = chunk;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, verify ?? as(ADMIN));
  return { status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const idOf = new Map<string, string>();

async function openers(slug: string) {
  return getDb()
    .select()
    .from(privateLinkOpeners)
    .where(eq(privateLinkOpeners.articleId, idOf.get(slug)!));
}

async function signedOut(slug: string) {
  return getDb()
    .select()
    .from(privateLinkSignedOutOpens)
    .where(eq(privateLinkSignedOutOpens.articleId, idOf.get(slug)!));
}

beforeAll(async () => {
  const db = getDb();
  await seedAuthUser(db, { id: OWNER, email: `plo-owner-${RUN}@example.invalid` });
  await seedAuthUser(db, { id: VISITOR, email: `plo-visitor-${RUN}@example.invalid` });
  const rows: { slug: string; ownerId: string; visibility: "public" | "private"; key: ShareKey | null }[] = [
    { slug: LINKED, ownerId: OWNER, visibility: "private", key: KEY },
    { slug: PUBLIC, ownerId: OWNER, visibility: "public", key: OTHER_KEY },
    { slug: UNLINKED, ownerId: OWNER, visibility: "private", key: null },
    { slug: ADMINS, ownerId: ADMIN, visibility: "private", key: ADMIN_KEY },
  ];
  for (const r of rows) {
    const id = randomUUID();
    idOf.set(r.slug, id);
    await db.insert(articles).values({
      id,
      ownerId: r.ownerId,
      slug: r.slug,
      shortId: mintId(),
      visibility: r.visibility,
      publicAt: r.visibility === "public" ? new Date() : null,
      shareToken: r.key,
      shareTokenAt: r.key ? new Date() : null,
    });
  }
});

afterAll(async () => {
  const db = getDb();
  await db.delete(articles).where(inArray(articles.slug, SLUGS));
  await db.execute(sql`delete from auth.users where id in (${OWNER}::uuid, ${VISITOR}::uuid)`);
});

beforeEach(async () => {
  const ids = [...idOf.values()];
  await getDb().delete(privateLinkOpeners).where(inArray(privateLinkOpeners.articleId, ids));
  await getDb().delete(privateLinkSignedOutOpens).where(inArray(privateLinkSignedOutOpens.articleId, ids));
});

describe("a signed-in visitor opens a private link", () => {
  it("records the account once, then counts each further open", async () => {
    expect((await call("POST", `/api/private-link-opens/${LINKED}?key=${KEY}`, as(VISITOR))).status).toBe(204);
    let [row] = await openers(LINKED);
    expect(row?.readerId).toBe(VISITOR);
    expect(row?.opens).toBe(1);
    const first = row!.firstOpenedAt;

    await call("POST", `/api/private-link-opens/${LINKED}?key=${KEY}`, as(VISITOR));
    [row] = await openers(LINKED);
    expect(row?.opens).toBe(2);
    expect(row?.firstOpenedAt.getTime()).toBe(first.getTime());
    expect(row!.lastOpenedAt.getTime()).toBeGreaterThanOrEqual(first.getTime());
  });

  it("makes one row and N increments when opened N times at once", async () => {
    await Promise.all(Array.from({ length: 6 }, () => recordOpener(LINKED, KEY, VISITOR)));
    const rows = await openers(LINKED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.opens).toBe(6);
  });

  it.each([
    ["a wrong key", LINKED, `?key=${OTHER_KEY}`],
    ["no key", LINKED, ""],
    ["a malformed key", LINKED, "?key=nope"],
    ["a public article, with its key", PUBLIC, `?key=${OTHER_KEY}`],
    ["an article with no link", UNLINKED, `?key=${KEY}`],
  ])("writes nothing for %s, and answers the same 204", async (_label, slug, query) => {
    expect((await call("POST", `/api/private-link-opens/${slug}${query}`, as(VISITOR))).status).toBe(204);
    expect(await openers(slug)).toEqual([]);
  });

  it("does not record the owner opening their own link", async () => {
    await call("POST", `/api/private-link-opens/${LINKED}?key=${KEY}`, as(OWNER));
    expect(await openers(LINKED)).toEqual([]);
  });

  it("is refused to somebody signed out", async () => {
    const r = await call("POST", `/api/private-link-opens/${LINKED}?key=${KEY}`, null);
    expect(r.status).toBe(401);
    expect(await openers(LINKED)).toEqual([]);
  });
});

describe("a signed-out visitor opens a private link", () => {
  it("counts it, through the public write", async () => {
    expect((await call("POST", `/api/public/private-link-opened/${LINKED}?key=${KEY}`, null)).status).toBe(204);
    const [row] = await signedOut(LINKED);
    expect(row?.opens).toBe(1);
  });

  it.each([
    ["a wrong key", LINKED, OTHER_KEY],
    ["a public article, with its key", PUBLIC, OTHER_KEY],
    ["an article with no link", UNLINKED, KEY],
  ])("writes nothing for %s", async (_label, slug, key) => {
    await countSignedOutOpen(slug, key);
    expect(await signedOut(slug)).toEqual([]);
  });

  it("adds at most one per two seconds, and saturates rather than overflowing", async () => {
    await countSignedOutOpen(LINKED, KEY);
    await countSignedOutOpen(LINKED, KEY);
    await countSignedOutOpen(LINKED, KEY);
    expect((await signedOut(LINKED))[0]?.opens).toBe(1);

    const back = sql`now() - interval '3 seconds'`;
    await getDb()
      .update(privateLinkSignedOutOpens)
      .set({ lastOpenedAt: back })
      .where(eq(privateLinkSignedOutOpens.articleId, idOf.get(LINKED)!));
    await countSignedOutOpen(LINKED, KEY);
    expect((await signedOut(LINKED))[0]?.opens).toBe(2);

    await getDb()
      .update(privateLinkSignedOutOpens)
      .set({ opens: 2147483647, lastOpenedAt: back })
      .where(eq(privateLinkSignedOutOpens.articleId, idOf.get(LINKED)!));
    await countSignedOutOpen(LINKED, KEY);
    expect((await signedOut(LINKED))[0]?.opens).toBe(2147483647);
  });
});

describe("GET /api/admin/articles/:slug/access", () => {
  const url = (slug: string, key?: ShareKey) => `/api/admin/articles/${slug}/access${key ? `?key=${key}` : ""}`;

  it("answers for somebody else's private article only with its key", async () => {
    await recordOpener(LINKED, KEY, VISITOR);
    await countSignedOutOpen(LINKED, KEY);

    const noKey = await call("GET", url(LINKED), as(ADMIN));
    const wrong = await call("GET", url(LINKED, OTHER_KEY), as(ADMIN));
    const nobody = await call("GET", url(`plo-nobody-${RUN}`), as(ADMIN));
    expect(noKey.status).toBe(404);
    expect(wrong).toEqual(noKey);
    expect(nobody).toEqual(noKey);

    const right = await call("GET", url(LINKED, KEY), as(ADMIN));
    expect(right.status).toBe(200);
    const body = right.body as AdminArticleAccess;
    expect(body.ownerId).toBe(OWNER);
    expect(body.mine).toBe(false);
    expect(body.privateLink).toBe(true);
    expect(body.openers.map((o) => [o.readerId, o.opens])).toEqual([[VISITOR, 1]]);
    expect(body.signedOut?.opens).toBe(1);
    /* No title, slug or key, under any name. */
    const text = JSON.stringify(body);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(LINKED);
    expect(Object.keys(body).sort()).toEqual(
      ["emailsAvailable", "mine", "openers", "ownerEmail", "ownerId", "privateLink", "signedOut"].sort(),
    );
  });

  it("answers for the administrator's own private article with no key, and for a public one", async () => {
    const own = await call("GET", url(ADMINS), as(ADMIN));
    expect(own.status).toBe(200);
    expect((own.body as AdminArticleAccess).mine).toBe(true);
    const pub = await call("GET", url(PUBLIC), as(ADMIN));
    expect(pub.status).toBe(200);
    expect((pub.body as AdminArticleAccess).ownerId).toBe(OWNER);
  });

  it("is refused to anybody else, with the key or without", async () => {
    expect((await call("GET", url(LINKED, KEY), as(VISITOR))).status).toBe(403);
    expect((await call("GET", url(LINKED, KEY), as(OWNER))).status).toBe(403);
  });
});
