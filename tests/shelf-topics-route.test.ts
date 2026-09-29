/**
 * **The shelf's topics chosen with a model, through the route and Postgres** —
 * `GET /api/library/terms`, src/shelf-topics.ts, the `shelf_topic_scores`
 * row. Plan docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Stage 2
 * (and R1–R4 in its § Reviews).
 *
 * 1. **No key**: the program's list, no claim, no call.
 * 2. **A first complete shelf**: the program's list is answered with
 *    `refreshing: true`; the handler has awaited the refresh by the time it
 *    returns, so the row is written **and the spend is in `ai_calls` under
 *    job `shelf-topics`, this owner, request scope** (R1, R4).
 * 3. **A stored row is used**: its unscored and 0-scored keys are left out,
 *    and nothing is called while the input is unchanged.
 * 4. **Reading does not refresh** (opens / last opened), and **archive**
 *    refreshes the active scope and not the `all` scope.
 * 5. **A stale row is still used** while exactly one refresh is claimed.
 * 6. **Two concurrent requests call the model once** (the claim).
 * 7. **A failure backs off**: counted, `retry_after` pushed out, and a changed
 *    shelf inside the backoff calls nothing.
 * 8. **The fuse**: an owner past the daily cap calls nothing, and that is not
 *    counted as a failure.
 * 9. **Pending**: with articles still unread, nothing is claimed.
 * 10. **The logs** carry no title, gist, label or profile.
 *
 * The provider is `globalThis.fetch`, stubbed; the key is a fake one — nothing
 * here spends.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error", "warn"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "info";
  }
  return { previousLevel };
});

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  aiCalls,
  articleRevisions,
  articles,
  blockIdentities,
  rateLimitEvents,
  readerProfiles,
  revisionBlocks,
  shelfTopicScores,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { shelfTopics, defaultShelfTopicsDeps } from "../src/shelf-topics.js";
import type { LibraryTermsResponse, Tree } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/shelf-topics-route.test.ts",
  tables: ["spideryarn.shelf_topic_scores", "spideryarn.revision_phrase_runs", "spideryarn.rate_limit_events"],
});

const { handleApi } = await import("../src/routes.js");

const OWNER = "00000000-0000-4000-8000-00000000c7a1" as OwnerId;
const PREFIX = "test-shelf-topics-route-";
const FAKE_KEY = "sk-or-test-shelf-topics-not-a-key";

/** Six two-word topics, each in three or four of ten articles — inside the band. */
const TOPICS = ["coral reef", "neural network", "medieval castle", "quantum computer", "jazz trumpet", "desert irrigation"];
/** What the fake model answers, by label. `desert irrigation` is left unscored. */
const MODEL_SAYS: Record<string, number> = {
  "coral reef": 3,
  "neural network": 3,
  "medieval castle": 2,
  "quantum computer": 2,
  "jazz trumpet": 0,
};
const UNIQUE = ["amberwick", "bramblefen", "cindermoss", "dovecrest", "emberlyn", "fernhollow", "gildenrow", "hazelmere", "ivorygate", "junipersk"];
/** Titles and a gist nobody should find in a log. */
const TITLE_MARK = "Zygomorphic Lantern Essay";
const GIST_MARK = "a gist about the quillwort estuary";
const PROFILE_MARK = "I study the xanthic marshes";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
function blockId(n: number): string {
  let body = "";
  for (let i = 0, rest = n; i < 5; i++, rest = Math.floor(rest / 32)) body = ALPHABET.charAt(rest % 32) + body;
  return `spya-z${body}`;
}
let blockCounter = 0;
const db = () => getDb();

function paragraphs(topics: readonly string[], unique: string): string[] {
  return topics.flatMap((t) => [
    `The ${t} is the subject of this piece, and the ${t} is what the ${unique} keeps coming back to.`,
    `In the end it is the ${t} that matters to the ${unique}, and it is not a small thing to have seen.`,
  ]);
}

async function makeArticle(slug: string, title: string, gist: string | null, paras: string[], day: number) {
  const [a] = await db().insert(articles).values({ ownerId: OWNER, slug }).returning({ id: articles.id });
  if (!a) throw new Error("no article");
  const [rev] = await db()
    .insert(articleRevisions)
    .values({
      articleId: a.id,
      status: "published",
      title,
      fetchedAt: new Date(Date.UTC(2026, 0, 1 + day)),
      tree: { rootId: "r", nodes: { r: { id: "r", depth: 0 } } } as unknown as Tree,
      rootGist: gist,
      wordCount: paras.join(" ").split(/\s+/).length,
      blockCount: paras.length,
      partCount: 0,
      sectionCount: 0,
    })
    .returning({ id: articleRevisions.id });
  if (!rev) throw new Error("no revision");
  const ids = paras.map(() => blockId(blockCounter++));
  await db().insert(blockIdentities).values(ids.map((id) => ({ articleId: a.id, blockId: id }))).onConflictDoNothing();
  await db()
    .insert(revisionBlocks)
    .values(
      paras.map((text, i) => ({
        articleId: a.id,
        revisionId: rev.id,
        blockId: ids[i] ?? "",
        ordinal: i,
        tag: "p",
        kind: "text",
        text,
        words: text.split(/\s+/).length,
        html: `<p>${text}</p>`,
        gistable: true,
      })),
    );
  await db().update(articles).set({ currentRevisionId: rev.id }).where(eq(articles.id, a.id));
  return a.id;
}

/* ------------------------------------------------------------ the provider -- */

const realFetch = globalThis.fetch;
let calls = 0;
let mode: "answer" | "fail" = "answer";
let delayMs = 0;

/** The candidate lines of the prompt, `tNN | label | …`, as id → label. */
function candidatesIn(init: RequestInit | undefined): Map<string, string> {
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content?: string }[] };
  const user = body.messages?.[1]?.content ?? "";
  const out = new Map<string, string>();
  for (const m of user.matchAll(/^(t\d\d) \| ([^|]+?) \|/gm)) out.set(m[1] ?? "", (m[2] ?? "").trim());
  return out;
}

/** Every candidate label any prompt has carried — none may reach a log. */
const labelsShown = new Set<string>();

function stubProvider(): void {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    for (const label of candidatesIn(init).values()) labelsShown.add(label);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (mode === "fail")
      return { ok: false, status: 503, headers: new Headers(), text: async () => "upstream down" } as unknown as Response;
    const scores = [...candidatesIn(init)]
      .filter(([, label]) => label in MODEL_SAYS)
      .map(([id, label]) => ({ id, score: MODEL_SAYS[label] }));
    const body = {
      model: "openai/gpt-6-luna",
      provider: "OpenAI",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ scores }) } }],
      usage: { prompt_tokens: 900, completion_tokens: 400, cost: 0.00042 },
    };
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) } as unknown as Response;
  }) as unknown as typeof fetch;
}

/* ----------------------------------------------------------------- route -- */

const signedIn: Verifier = async () => ({
  ok: true,
  claims: { sub: OWNER, email: "shelf-topics-route@example.invalid", role: "authenticated" },
});

async function get(archived = false): Promise<LibraryTermsResponse> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: `/api/library/terms${archived ? "?archived=1" : ""}`,
    headers: { authorization: "Bearer test-token" },
  }) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    getHeader() {
      return undefined;
    },
    writeHead(s: number) {
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, signedIn);
  expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
  return JSON.parse(written) as LibraryTermsResponse;
}

async function row(scope: "active" | "all") {
  const [r] = await db()
    .select()
    .from(shelfTopicScores)
    .where(and(eq(shelfTopicScores.ownerId, OWNER), eq(shelfTopicScores.scope, scope)));
  return r;
}

/** Take the backoff and any claim off the row, as if time had passed. */
async function clearBackoff(): Promise<void> {
  await db()
    .update(shelfTopicScores)
    .set({ failures: 0, retryAfter: null, claimId: null, claimHash: null, claimedUntil: null })
    .where(eq(shelfTopicScores.ownerId, OWNER));
}

async function rename(articleId: string, title: string): Promise<void> {
  await db().update(articles).set({ titleOverride: title }).where(eq(articles.id, articleId));
}

let ids: string[] = [];
const previousKey = process.env.OPENROUTER_API_KEY;

beforeAll(async () => {
  await seedAuthUser(db(), { id: OWNER, email: "shelf-topics-route@example.invalid", onConflictDoNothing: true });
  await db().delete(articles).where(like(articles.slug, `${PREFIX}%`));
  await db().delete(shelfTopicScores).where(eq(shelfTopicScores.ownerId, OWNER));
  await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, OWNER));
  await db()
    .insert(readerProfiles)
    .values({ ownerId: OWNER, profile: PROFILE_MARK })
    .onConflictDoNothing();
  ids = [];
  for (let i = 0; i < 10; i++) {
    const topics = [TOPICS[i % 6] ?? "", TOPICS[(i + 1) % 6] ?? ""];
    ids.push(
      await makeArticle(
        `${PREFIX}${i}`,
        i === 0 ? TITLE_MARK : `Article ${i}`,
        i === 0 ? GIST_MARK : null,
        paragraphs(topics, UNIQUE[i] ?? ""),
        i,
      ),
    );
  }
  stubProvider();
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
  await db().delete(articles).where(like(articles.slug, `${PREFIX}%`));
  await db().delete(shelfTopicScores).where(eq(shelfTopicScores.ownerId, OWNER));
  await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, OWNER));
  await closeDb();
});

beforeEach(() => {
  calls = 0;
  mode = "answer";
  delayMs = 0;
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
});

const keys = (r: LibraryTermsResponse) => r.terms.map((t) => t.key);

describe("GET /api/library/terms with a model", () => {
  it("with no key, answers the program's list and claims and calls nothing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const got = await get();
    expect(got.pending).toBe(0);
    expect(got.chosenBy).toBe("program");
    expect(got.refreshing).toBe(false);
    expect(keys(got)).toContain("jazz trumpet");
    expect(calls).toBe(0);
    expect(await row("active")).toBeUndefined();
  });

  it("refreshes a complete shelf once, after answering, and records the spend against the owner", async () => {
    const before = await db().select({ id: aiCalls.id }).from(aiCalls).where(eq(aiCalls.ownerId, OWNER));
    const got = await get();
    expect(got.chosenBy).toBe("program");
    expect(got.refreshing).toBe(true);
    expect(calls).toBe(1);

    const r = await row("active");
    expect(r?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r?.model).toBe("openai/gpt-6-luna");
    expect(r?.scores).toMatchObject({ "coral reef": 3, "jazz trumpet": 0 });
    expect(r?.claimId).toBeNull();
    expect(r?.failures).toBe(0);

    const spent = await db()
      .select({ purpose: aiCalls.purpose, scopeKind: aiCalls.scopeKind, wire: aiCalls.wire })
      .from(aiCalls)
      .where(eq(aiCalls.ownerId, OWNER));
    expect(spent.length).toBe(before.length + 1);
    expect(spent.filter((s) => s.purpose === "shelf-topics")).toEqual([
      { purpose: "shelf-topics", scopeKind: "request", wire: "chat" },
    ]);
  });

  it("uses the stored scores — unscored and 0-scored keys left out — and calls nothing while the input stands", async () => {
    const got = await get();
    expect(got.chosenBy).toBe("model");
    expect(got.refreshing).toBe(false);
    expect(keys(got)).toContain("coral reef");
    expect(keys(got)).not.toContain("jazz trumpet");
    expect(keys(got)).not.toContain("desert irrigation");
    expect(calls).toBe(0);
  });

  it("does not refresh because an article was opened", async () => {
    await db().update(articles).set({ opens: 5, lastOpenedAt: new Date() }).where(eq(articles.id, ids[3] ?? ""));
    await get();
    expect(calls).toBe(0);
  });

  it("keeps using a stale row while exactly one refresh is claimed", async () => {
    const hashBefore = (await row("active"))?.inputHash;
    await rename(ids[2] ?? "", "A new name for article two");
    const got = await get();
    expect(got.chosenBy).toBe("model");
    expect(got.refreshing).toBe(true);
    expect(keys(got)).not.toContain("jazz trumpet");
    expect(calls).toBe(1);
    expect((await row("active"))?.inputHash).not.toBe(hashBefore);
  });

  it("calls the model once for two concurrent requests", async () => {
    await rename(ids[2] ?? "", "A third name for article two");
    delayMs = 300;
    const [a, b] = await Promise.all([get(), get()]);
    expect(calls).toBe(1);
    expect([a.refreshing, b.refreshing]).toEqual([true, true]);
  });

  it("backs off after a failure, and a changed shelf inside the backoff calls nothing", async () => {
    await rename(ids[4] ?? "", "Article four, renamed");
    mode = "fail";
    const got = await get();
    expect(got.chosenBy).toBe("model");
    expect(calls).toBe(1);
    const failed = await row("active");
    expect(failed?.failures).toBe(1);
    expect(failed?.claimId).toBeNull();
    expect(failed?.retryAfter?.getTime() ?? 0).toBeGreaterThan(Date.now() + 60_000);

    mode = "answer";
    await get();
    await rename(ids[4] ?? "", "Article four, renamed again");
    await get();
    expect(calls).toBe(1);
    await clearBackoff();
  });

  it("refreshes the active scope on archive, and not the scope that includes the archive", async () => {
    await get(true);
    await get();
    const allHash = (await row("all"))?.inputHash;
    expect(allHash).toBeTruthy();
    calls = 0;

    await db().update(articles).set({ archivedAt: new Date() }).where(eq(articles.id, ids[9] ?? ""));
    await get(true);
    expect(calls).toBe(0);
    await get();
    expect(calls).toBe(1);
    await db().update(articles).set({ archivedAt: null }).where(eq(articles.id, ids[9] ?? ""));
    await get();
  });

  it("stops at the daily cap, without counting it as a failure", async () => {
    await rename(ids[5] ?? "", "Article five, renamed");
    await db()
      .insert(rateLimitEvents)
      .values(Array.from({ length: 40 }, () => ({ ownerId: OWNER, bucket: "shelf-topics" })));
    const got = await get();
    expect(calls).toBe(0);
    expect(got.refreshing).toBe(false);
    const r = await row("active");
    expect(r?.failures).toBe(0);
    expect(r?.claimId).toBeNull();
    expect(r?.retryAfter?.getTime() ?? 0).toBeGreaterThan(Date.now());
    await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, OWNER));
    await clearBackoff();
  });

  it("claims nothing while articles are still unread", async () => {
    await rename(ids[6] ?? "", "Article six, renamed");
    /* A new article with no phrase run, and a fill budget of zero: one
       article is read per call, so the first answer is still pending. */
    ids.push(await makeArticle(`${PREFIX}late`, "A late arrival", null, paragraphs(["coral reef", "jazz trumpet"], "latecomer"), 30));
    ids.push(await makeArticle(`${PREFIX}later`, "A later arrival", null, paragraphs(["neural network", "medieval castle"], "laterling"), 31));
    const answer = await runAsOwner(OWNER, () => shelfTopics(false, defaultShelfTopicsDeps(), { budgetMs: 0 }));
    expect(answer.response.pending).toBeGreaterThan(0);
    expect(answer.refresh).toBeNull();
    expect(answer.response.refreshing).toBe(false);
    expect(calls).toBe(0);
  });

  it("logs a refresh without a title, a gist, a label or the profile", async () => {
    await rename(ids[7] ?? "", "Article seven, renamed");
    const written = await logLinesWhile(async () => {
      await get();
    });
    expect(calls).toBe(1);
    /* The positive control: the capture saw this refresh's own line. */
    expect(written).toContain("scored the shelf's topics");
    /* Every title and gist this owner's shelf holds — the seeded ones and every
       rename since — and every label the model was shown, not a named few: a
       line that logged some other article's title must fail too. */
    const shelf = await db()
      .select({ title: articleRevisions.title, override: articles.titleOverride, gist: articleRevisions.rootGist })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(and(eq(articles.ownerId, OWNER), like(articles.slug, `${PREFIX}%`)));
    const titles = shelf.flatMap((a) => [a.title, a.override]).filter((t): t is string => Boolean(t));
    const gists = shelf.map((a) => a.gist).filter((g): g is string => Boolean(g));
    expect(titles).toEqual(expect.arrayContaining([TITLE_MARK, "Article 9", "A later arrival", "Article seven, renamed"]));
    expect(gists).toContain(GIST_MARK);
    expect(labelsShown.size).toBeGreaterThanOrEqual(TOPICS.length);
    for (const secret of [...titles, ...gists, ...labelsShown, PROFILE_MARK, ...TOPICS])
      expect(written, secret).not.toContain(secret);
  });

  it("reads, fences and writes only the requesting owner's row — another reader's live claim blocks nothing", async () => {
    /* A second reader with a row of their own for the `all` scope: a result
       that would put `jazz trumpet` and `desert irrigation` on top, and a live
       claim. This owner has no `all` row, so a read that forgot the owner
       could only find theirs. Minted per run — tests/fixture-ids.test.ts. */
    const other = randomUUID() as OwnerId;
    await seedAuthUser(db(), { id: other, email: `other-${other}@shelf-topics-route.example.invalid` });
    await db().delete(shelfTopicScores).where(and(eq(shelfTopicScores.ownerId, OWNER), eq(shelfTopicScores.scope, "all")));
    try {
      await db()
        .insert(shelfTopicScores)
        .values({
          ownerId: other,
          scope: "all",
          inputHash: "b".repeat(64),
          model: "openai/gpt-6-luna",
          promptVersion: 1,
          scores: { "jazz trumpet": 3, "desert irrigation": 3, "coral reef": 0, "neural network": 0 },
          computedAt: new Date(),
          claimId: randomUUID(),
          claimHash: "c".repeat(64),
          claimedUntil: new Date(Date.now() + 10 * 60_000),
        });
      const theirs = async () =>
        (await db().select().from(shelfTopicScores).where(eq(shelfTopicScores.ownerId, other)));
      const before = await theirs();

      const got = await get(true);
      /* Not their scores: this owner has none, so the program's list. */
      expect(got.chosenBy).toBe("program");
      expect(keys(got)).toContain("jazz trumpet");
      /* Not blocked by their claim: this owner's refresh ran and wrote. */
      expect(got.refreshing).toBe(true);
      expect(calls).toBe(1);
      const mine = await row("all");
      expect(mine?.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(mine?.scores).toMatchObject({ "coral reef": 3, "jazz trumpet": 0 });
      /* And theirs is exactly as it was. */
      expect(await theirs()).toEqual(before);

      /* The next answer uses this owner's own row, not theirs. */
      const again = await get(true);
      expect(again.chosenBy).toBe("model");
      expect(keys(again)).toContain("coral reef");
      expect(keys(again)).not.toContain("jazz trumpet");
      expect(calls).toBe(1);
    } finally {
      await db().delete(shelfTopicScores).where(eq(shelfTopicScores.ownerId, other));
    }
  });
});
