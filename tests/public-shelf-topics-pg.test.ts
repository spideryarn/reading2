/**
 * **The public shelf's topic pills, through the real routes and Postgres** —
 * src/public-shelf-topics.ts, src/store/public-topic-tree.ts and the listing.
 * Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md
 * § Tests; approved by Greg as "q-p5h2a7 A", 2026-10-09.
 *
 * The provider is `globalThis.fetch`, stubbed, with a fake key: nothing spends.
 * **The tests run in order and share one public shelf.**
 *
 * 1. **The site account** exists as the migration made it, and cannot sign in:
 *    no password, no identity, `.invalid`, banned.
 * 2. **Sharing eight articles** brings the first re-think, inside the sharing
 *    request: the stored row, the allowance row and every `ai_calls` row are the
 *    site's, the calls carry no article, and the sharing reader's own tree is
 *    untouched. A stranger's `GET /api/public/library` then carries the topics
 *    and each card's keys, and never an article id.
 * 3. **A ninth share is filed**, one filing call, not a re-think.
 * 4. **An un-share rebuilds** under 20 cards, and the gone article leaves the
 *    tree. **When that rebuild fails, nothing is sent** until one succeeds.
 * 5. **Archive and delete** trigger the same.
 * 6. **Past the cut-off** a due re-think does not run by itself, and the
 *    administrator's Rebuild runs it.
 * 7. **A stranger's request spends nothing** and makes no claim.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  aiCalls,
  articleRevisions,
  articles,
  blockIdentities,
  rateLimitEvents,
  revisionBlocks,
  shelfTopicSets,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import type { PublicLibrary } from "../src/public-library-types.js";
import {
  BY_HAND,
  PUBLIC_RETHINK_AUTO_MAX,
  publicShelfTopicsStatus,
  refreshPublicShelfTopics,
} from "../src/public-shelf-topics.js";
import { SITE_OWNER_ID } from "../src/site-account.js";
import type { Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/public-shelf-topics-pg.test.ts",
  tables: ["spideryarn.shelf_topic_sets", "spideryarn.rate_limit_events", "spideryarn.ai_calls"],
});

const { handleApi } = await import("../src/routes.js");

const ALICE = "00000000-0000-4000-8000-0000000a7a11" as OwnerId;
const BOB = "00000000-0000-4000-8000-0000000a7b22" as OwnerId;
const PREFIX = "test-public-shelf-topics-pg-";
const FAKE_KEY = "sk-or-test-public-shelf-topics-not-a-key";
const db = () => getDb();

/* ------------------------------------------------------------ fixtures -- */

const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
let blockCounter = 0;
function blockId(n: number): string {
  let body = "";
  for (let i = 0, rest = n; i < 5; i++, rest = Math.floor(rest / 32)) body = ALPHABET.charAt(rest % 32) + body;
  return `spya-p${body}`;
}

async function makeArticle(owner: OwnerId, slug: string, title: string): Promise<string> {
  const text = `A paragraph of ${title}, so the article has something to read.`;
  const [a] = await db().insert(articles).values({ ownerId: owner, slug }).returning({ id: articles.id });
  if (!a) throw new Error("no article");
  const [rev] = await db()
    .insert(articleRevisions)
    .values({
      articleId: a.id,
      status: "published",
      title,
      fetchedAt: new Date(Date.UTC(2026, 0, 1)),
      tree: { rootId: "r", nodes: { r: { id: "r", depth: 0 } } } as unknown as Tree,
      rootGist: `A gist about ${title}`,
      wordCount: 12,
      blockCount: 1,
      partCount: 0,
      sectionCount: 0,
    })
    .returning({ id: articleRevisions.id });
  if (!rev) throw new Error("no revision");
  const id = blockId(blockCounter++);
  await db().insert(blockIdentities).values({ articleId: a.id, blockId: id }).onConflictDoNothing();
  await db().insert(revisionBlocks).values({
    articleId: a.id,
    revisionId: rev.id,
    blockId: id,
    ordinal: 0,
    tag: "p",
    kind: "text" as const,
    text,
    words: 12,
    html: `<p>${text}</p>`,
    gistable: true,
  });
  await db().update(articles).set({ currentRevisionId: rev.id }).where(eq(articles.id, a.id));
  return a.id;
}

/* ------------------------------------------------------------ provider -- */

const realFetch = globalThis.fetch;
type Seen = { schema: string; user: string };
let seen: Seen[] = [];
let failing = false;
const nameCalls = () => seen.filter((c) => c.schema === "shelf_topics");
const fileCalls = () => seen.filter((c) => c.schema === "shelf_filing");

/** Two broad topics, by a word in each title. */
const BROAD = [
  { label: "Neuroscience", word: "Neuro" },
  { label: "Carpentry", word: "Carpentry" },
];

function articleLines(user: string): { n: number; text: string }[] {
  return [...user.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] ?? "" }));
}

function answerFor(call: Seen): unknown {
  const lines = articleLines(call.user);
  if (call.schema === "shelf_topics") {
    const within = /all filed under "([^"]+)"/.exec(call.user)?.[1] ?? null;
    if (within !== null) return { topics: [] };
    return {
      topics: BROAD.map((t) => ({ label: t.label, articles: lines.filter((l) => l.text.includes(t.word)).map((l) => l.n) })).filter(
        (t) => t.articles.length > 0,
      ),
    };
  }
  const tree = [...call.user.matchAll(/^\s*(t\d+) · (.+)$/gm)].map((m) => ({ id: m[1] ?? "", label: (m[2] ?? "").trim() }));
  return {
    articles: lines.map((l) => {
      const broad = BROAD.find((t) => l.text.includes(t.word));
      const id = broad && tree.find((t) => t.label === broad.label)?.id;
      return { article: l.n, topics: id ? [id] : [] };
    }),
  };
}

function stubProvider(): void {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: { content?: string }[];
      response_format?: { json_schema?: { name?: string } };
    };
    const call: Seen = { schema: sent.response_format?.json_schema?.name ?? "", user: sent.messages?.[1]?.content ?? "" };
    seen.push(call);
    if (failing) return { ok: false, status: 503, headers: new Headers(), text: async () => "upstream down" } as unknown as Response;
    const body = {
      model: "openai/gpt-6-luna",
      provider: "OpenAI",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answerFor(call)) } }],
      usage: { prompt_tokens: 900, completion_tokens: 400, cost: 0.00004 },
    };
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) } as unknown as Response;
  }) as unknown as typeof fetch;
}

/* --------------------------------------------------------------- routes -- */

async function call(method: string, url: string, opts: { body?: unknown; as?: OwnerId } = {}): Promise<{ status: number; text: string }> {
  const payload = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: opts.as === undefined ? {} : { authorization: "Bearer test-token" } },
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
    writableEnded: false,
    setHeader() {},
    getHeader() {
      return undefined;
    },
    writeHead(s: number) {
      status = s;
    },
    write(piece: string) {
      text += piece;
      return true;
    },
    end(chunk?: string) {
      if (chunk) text += chunk;
    },
  } as unknown as ServerResponse;
  const who = opts.as;
  const verifier: Verifier | undefined =
    who === undefined
      ? undefined
      : async () => ({ ok: true, claims: { sub: who, email: `${who}@public-shelf-topics.example.invalid`, role: "authenticated" } });
  await handleApi(req, res, verifier);
  return { status, text };
}

const share = async (owner: OwnerId, slug: string) => {
  const r = await call("PUT", `/api/article/${slug}/visibility`, { body: { visibility: "public", rightsConfirmed: true }, as: owner });
  expect(r.status, r.text).toBe(200);
};
const unshare = async (owner: OwnerId, slug: string) => {
  const r = await call("PUT", `/api/article/${slug}/visibility`, { body: { visibility: "private" }, as: owner });
  expect(r.status, r.text).toBe(200);
};

async function publicShelf(): Promise<PublicLibrary> {
  const r = await call("GET", "/api/public/library");
  expect(r.status).toBe(200);
  return JSON.parse(r.text) as PublicLibrary;
}

async function siteRow() {
  const [r] = await db().select().from(shelfTopicSets).where(eq(shelfTopicSets.ownerId, SITE_OWNER_ID));
  return r;
}

const mine = (shelf: PublicLibrary) => shelf.entries.filter((e) => e.slug.startsWith(PREFIX));
const labelsOf = (shelf: PublicLibrary, slug: string) => {
  const keys = shelf.entries.find((e) => e.slug === slug)?.topics ?? [];
  return keys.map((k) => shelf.topics.find((t) => t.key === k)?.label);
};

/* The shelf: six on neuroscience, three on carpentry, by two owners. */
const TITLES = [
  "Neuro replay one",
  "Neuro retina two",
  "Carpentry joints three",
  "Neuro sleep four",
  "Carpentry tools five",
  "Neuro memory six",
  "Neuro vision seven",
  "Carpentry finish eight",
  "Neuro latecomer nine",
  "Carpentry extra ten",
];
const slug = (i: number) => `${PREFIX}${i}`;
const ownerOf = (i: number) => (i % 2 === 0 ? ALICE : BOB);
const ids: string[] = [];
const previousKey = process.env.OPENROUTER_API_KEY;

async function forgetSite(): Promise<void> {
  await db().delete(shelfTopicSets).where(eq(shelfTopicSets.ownerId, SITE_OWNER_ID));
  await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, SITE_OWNER_ID));
}

beforeAll(async () => {
  for (const [id, email] of [
    [ALICE, "alice-public-shelf-topics@example.invalid"],
    [BOB, "bob-public-shelf-topics@example.invalid"],
  ] as const)
    await seedAuthUser(db(), { id, email, onConflictDoNothing: true });
  await db().delete(articles).where(like(articles.slug, `${PREFIX}%`));
  await forgetSite();
  await db().delete(aiCalls).where(eq(aiCalls.ownerId, SITE_OWNER_ID));
  for (let i = 0; i < TITLES.length; i++) ids.push(await makeArticle(ownerOf(i), slug(i), TITLES[i] ?? ""));
  stubProvider();
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
  await db().delete(articles).where(like(articles.slug, `${PREFIX}%`));
  await forgetSite();
  await db().delete(aiCalls).where(eq(aiCalls.ownerId, SITE_OWNER_ID));
  for (const o of [ALICE, BOB]) await db().delete(shelfTopicSets).where(eq(shelfTopicSets.ownerId, o));
  await closeDb();
});

beforeEach(async () => {
  seen = [];
  failing = false;
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  /* A whole allowance each test; the hourly cap is twelve. */
  await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, SITE_OWNER_ID));
});

describe("the public shelf's topic pills", () => {
  it("has a site account nobody can sign in as", async () => {
    const rows = await db().execute(
      sql`select email, encrypted_password, banned_until > now() + interval '100 years' as banned,
                 (select count(*) from auth.identities i where i.user_id = u.id)::int as identities
          from auth.users u where id = ${SITE_OWNER_ID}`,
    );
    expect(rows.rows).toEqual([{ email: "site@spideryarn.invalid", encrypted_password: "", banned: true, identities: 0 }]);
  });

  it("re-thinks inside the eighth share, as the site, and a stranger then sees the topics", async () => {
    const before = await publicShelf();
    expect(before.topics).toEqual([]);
    for (let i = 0; i < 8; i++) await share(ownerOf(i), slug(i));
    expect(nameCalls().length).toBeGreaterThan(0);

    const row = await siteRow();
    expect(row?.rethoughtAt).toBeTruthy();
    expect(Object.keys(row?.members ?? {}).sort()).toEqual(expect.arrayContaining(ids.slice(0, 8).sort()));

    /* Spend, allowance: the site's. No article on the ledger line. */
    const spent = await db()
      .select({ ownerId: aiCalls.ownerId, articleSlug: aiCalls.articleSlug })
      .from(aiCalls)
      .where(eq(aiCalls.ownerId, SITE_OWNER_ID));
    expect(spent.length).toBe(seen.length);
    expect(spent.every((c) => c.articleSlug === null)).toBe(true);
    const leaked = await db()
      .select({ id: aiCalls.id })
      .from(aiCalls)
      .where(and(inArray(aiCalls.ownerId, [ALICE, BOB]), like(aiCalls.articleSlug, `${PREFIX}%`)));
    expect(leaked).toEqual([]);
    const allowance = await db().select({ owner: rateLimitEvents.ownerId }).from(rateLimitEvents).where(eq(rateLimitEvents.ownerId, SITE_OWNER_ID));
    expect(allowance.length).toBeGreaterThan(0);
    /* The sharing readers' own trees are not touched. */
    expect(await db().select().from(shelfTopicSets).where(inArray(shelfTopicSets.ownerId, [ALICE, BOB]))).toEqual([]);

    const after = await publicShelf();
    expect(after.topics.map((t) => t.label).sort()).toEqual(["Carpentry", "Neuroscience"]);
    expect(labelsOf(after, slug(0))).toEqual(["Neuroscience"]);
    expect(labelsOf(after, slug(2))).toEqual(["Carpentry"]);
    for (const id of ids) expect(JSON.stringify(after)).not.toContain(id);
  });

  it("a stranger's request spends nothing and claims nothing", async () => {
    const row = await siteRow();
    seen = [];
    await publicShelf();
    expect(seen).toEqual([]);
    expect((await siteRow())?.claimId ?? null).toBe(row?.claimId ?? null);
  });

  it("files a ninth share with one filing call, not a re-think", async () => {
    await share(ownerOf(8), slug(8));
    expect(nameCalls()).toEqual([]);
    expect(fileCalls()).toHaveLength(1);
    const shelf = await publicShelf();
    expect(labelsOf(shelf, slug(8))).toEqual(["Neuroscience"]);
  });

  it("an un-share rebuilds the tree without the article; while the rebuild fails, nothing is sent", async () => {
    failing = true;
    await unshare(ownerOf(1), slug(1));
    const withheld = await publicShelf();
    expect(mine(withheld).length).toBe(8);
    expect(withheld.topics).toEqual([]);
    expect(mine(withheld).every((e) => e.topics.length === 0)).toBe(true);
    expect(Object.keys((await siteRow())?.members ?? {})).toContain(ids[1]);

    /* Any later trigger, once the backoff has passed, rebuilds. */
    failing = false;
    await db().update(shelfTopicSets).set({ failures: 0, retryAfter: null }).where(eq(shelfTopicSets.ownerId, SITE_OWNER_ID));
    await refreshPublicShelfTopics();
    expect(nameCalls().length).toBeGreaterThan(0);
    expect(Object.keys((await siteRow())?.members ?? {})).not.toContain(ids[1]);
    expect((await publicShelf()).topics.length).toBeGreaterThan(0);
  });

  it("archiving and deleting a shared article rebuild too", async () => {
    /* Ten listed, so an archive and a delete each leave eight or more. */
    await share(ownerOf(1), slug(1));
    await share(ownerOf(9), slug(9));
    seen = [];
    const archived = await call("PATCH", `/api/library/${slug(3)}`, { body: { archived: true }, as: ownerOf(3) });
    expect(archived.status, archived.text).toBe(200);
    expect(Object.keys((await siteRow())?.members ?? {})).not.toContain(ids[3]);
    expect(nameCalls().length).toBeGreaterThan(0);
    expect((await publicShelf()).topics.length).toBeGreaterThan(0);

    seen = [];
    const deleted = await call("DELETE", `/api/library/${slug(5)}`, { as: ownerOf(5) });
    expect(deleted.status, deleted.text).toBe(200);
    expect(nameCalls().length).toBeGreaterThan(0);
    expect(Object.keys((await siteRow())?.members ?? {})).not.toContain(ids[5]);
  });

  it("past the cut-off a due re-think waits for the administrator's Rebuild", async () => {
    /* Enough more to pass twenty listed cards, written straight to the table:
       this is about the decision, not the share route. */
    const extra: string[] = [];
    const listed = (await publicShelf()).entries.length;
    /* Twenty-two, so twenty-one after the un-share below: one past the cut-off. */
    for (let i = 0; listed + i < PUBLIC_RETHINK_AUTO_MAX + 2; i++) {
      const s = `${PREFIX}bulk-${i}`;
      extra.push(await makeArticle(ALICE, s, `Carpentry bulk ${i}`));
      await db().update(articles).set({ visibility: "public", publicAt: new Date() }).where(eq(articles.slug, s));
    }
    seen = [];
    /* An un-share now makes a re-think due, and it does not run by itself. */
    await unshare(ownerOf(0), slug(0));
    expect(nameCalls()).toEqual([]);
    expect((await publicShelf()).topics).toEqual([]);
    const status = await publicShelfTopicsStatus();
    expect(status).toMatchObject({ withheld: true, rebuildDue: true, autoMax: PUBLIC_RETHINK_AUTO_MAX });
    expect(status.cards).toBeGreaterThan(PUBLIC_RETHINK_AUTO_MAX);

    await refreshPublicShelfTopics(BY_HAND);
    expect(nameCalls().length).toBeGreaterThan(0);
    expect(await publicShelfTopicsStatus()).toMatchObject({ withheld: false, rebuildDue: false });
    expect((await publicShelf()).topics.length).toBeGreaterThan(0);
  });
});
