/**
 * **The shelf's topics named by a model, through the route and Postgres** —
 * `GET /api/library/terms`, src/shelf-topic-sets.ts, the `shelf_topic_sets`
 * row. Plan docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md;
 * docs/project/shelf-terms.md § Topics a model names, broad to fine.
 *
 * The real route, the real store and the real `rethink` / `fileWorks`; only the
 * provider is a stand-in. **The tests run in order and share one shelf**: each
 * leaves the stored set complete and current for the next.
 *
 * 1. **No key**: the phrase pills, no claim, no call, no row.
 * 2. **A first shelf of 15 works**: the phrase pills with `refreshing: true`;
 *    by the time the handler returns the row is written and the spend is in
 *    `ai_calls` under job `shelf-topics`, this owner, request scope. The next
 *    answer is the model's tree, broad first, with `granularity` and `within`,
 *    no `count`, and no call.
 * 3. **Reading does not refresh** (opens / last opened).
 * 4. **A new article is filed**, not re-thought: one `shelf_filing` call, and
 *    it then shows under its topic and that topic's parent.
 * 5. **Growth by a quarter and five works re-thinks**; one short of it files.
 * 6. **Two concurrent requests** make the model work once (the claim).
 * 7. **A failure** counts, backs off, calls nothing inside the backoff, and
 *    the stored set keeps being served.
 * 8. **The allowance**: an owner past the cap calls nothing, and that is not
 *    counted as a failure.
 * 9. **One set serves both scopes**: an archived article's topic is absent
 *    from the active answer and present with `?archived=1`, and neither asks.
 * 10. **A changed profile** re-thinks, once.
 * 11. **An article that arrives during a re-think** is filed by the same
 *     request.
 * 11a. **A finer level that fails twice** fails the whole re-think; the
 *     stored tree stays. **A shelf shrunk** by a quarter and five re-thinks.
 * 12. **A table that cannot be read or claimed** leaves the phrase pills.
 * 13. **The logs** of a re-think and a filing carry no title, gist, topic
 *     label or profile.
 * 14. **Another reader's** stored set and live claim neither leak nor block.
 * 15. **Below eight works** (eight articles, two of them one text): no call
 *     and no row; the eighth work brings both, and the copy takes its twin's
 *     topics; back below eight the stored tree is not shown.
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
  shelfTopicSets,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { SHELF_TOPICS_MODEL } from "../src/models.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { TOPIC_SET_PROMPT_VERSION } from "../src/shelf-terms/model-topics.js";
import { defaultShelfTopicSetDeps, shelfTopicSet } from "../src/shelf-topic-sets.js";
import type { LibraryTermsResponse, Tree } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/shelf-topics-route.test.ts",
  tables: [
    "spideryarn.shelf_topic_sets",
    "spideryarn.shelf_topic_scores",
    "spideryarn.revision_phrase_runs",
    "spideryarn.rate_limit_events",
  ],
});

const { handleApi } = await import("../src/routes.js");

const OWNER = "00000000-0000-4000-8000-00000000c7a1" as OwnerId;
const PREFIX = "test-shelf-topics-route-";
const FAKE_KEY = "sk-or-test-shelf-topics-not-a-key";

/** Six two-word phrases the fallback's program can find: each article uses two. */
const PHRASES = ["coral reef", "neural network", "medieval castle", "quantum computer", "jazz trumpet", "desert irrigation"];
const UNIQUE = [
  "amberwick", "bramblefen", "cindermoss", "dovecrest", "emberlyn", "fernhollow", "gildenrow",
  "hazelmere", "ivorygate", "junipersk", "kestrelby", "larchmoor", "mossgarth", "nettlecombe", "osiergate",
];
/** A title, a gist and a profile nobody should find in a log. */
const TITLE_MARK = "Zygomorphic Lantern Essay";
const GIST_MARK = "a gist about the quillwort estuary";
const PROFILE_MARK = "I study the xanthic marshes";

/** What the stand-in model calls things. It sorts by a word in each title. */
const BROAD = [
  { label: "Neuroscience", word: "Neuro" },
  { label: "Carpentry", word: "Carpentry" },
];
const FINER = [
  { label: "Hippocampal Replay", word: "replay" },
  { label: "Retinal Circuits", word: "retinal" },
];
const LABELS = [...BROAD, ...FINER].map((t) => t.label);

const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
function blockId(n: number): string {
  let body = "";
  for (let i = 0, rest = n; i < 5; i++, rest = Math.floor(rest / 32)) body = ALPHABET.charAt(rest % 32) + body;
  return `spya-z${body}`;
}
let blockCounter = 0;
const db = () => getDb();

function paragraphs(phrases: readonly string[], unique: string): string[] {
  return phrases.flatMap((t) => [
    `The ${t} is the subject of this piece, and the ${t} is what the ${unique} keeps coming back to.`,
    `In the end it is the ${t} that matters to the ${unique}, and it is not a small thing to have seen.`,
  ]);
}

async function makeArticle(owner: OwnerId, slug: string, title: string, gist: string | null, paras: string[], day: number) {
  const [a] = await db().insert(articles).values({ ownerId: owner, slug }).returning({ id: articles.id });
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

let lateCounter = 0;
/** One more article on the main owner's shelf, about `word`; answers its slug. */
async function arrive(word: "replay" | "retinal"): Promise<string> {
  const n = lateCounter++;
  const slug = `${PREFIX}late-${n}`;
  await makeArticle(
    OWNER,
    slug,
    `Neuro ${word} latecomer ${n}`,
    null,
    paragraphs([PHRASES[n % 6] ?? "", PHRASES[(n + 1) % 6] ?? ""], `latecomer${ALPHABET.charAt(n)}${ALPHABET.charAt(n + 3)}wick`),
    40 + n,
  );
  return slug;
}

/* ------------------------------------------------------------ the provider -- */

const realFetch = globalThis.fetch;
type Seen = { schema: string; within: string | null; user: string };
/** Every call the provider received since the last `beforeEach`. */
let seen: Seen[] = [];
/** `fail-finer`: the broad call answers and every call inside a topic is a 503. */
let mode: "answer" | "fail" | "fail-finer" = "answer";
let delayMs = 0;
/** Run once, while the next call is in flight — something happening on the shelf mid-work. */
let meanwhile: (() => Promise<void>) | null = null;

const nameCalls = () => seen.filter((c) => c.schema === "shelf_topics");
const topNameCalls = () => nameCalls().filter((c) => c.within === null);
const fileCalls = () => seen.filter((c) => c.schema === "shelf_filing");

/** The prompt's numbered article lines, `N. title — gist`. */
function articleLines(user: string): { n: number; text: string }[] {
  return [...user.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] ?? "" }));
}

/** A *file* prompt's tree lines, `  t2 · Label`. */
function treeIn(user: string): { id: string; label: string }[] {
  return [...user.matchAll(/^\s*(t\d+) · (.+)$/gm)].map((m) => ({ id: m[1] ?? "", label: (m[2] ?? "").trim() }));
}

function answerFor(call: Seen): unknown {
  const lines = articleLines(call.user);
  if (call.schema === "shelf_topics") {
    const offered = call.within === null ? BROAD : call.within === "Neuroscience" ? FINER : [];
    return {
      topics: offered
        .map((t) => ({ label: t.label, articles: lines.filter((l) => l.text.includes(t.word)).map((l) => l.n) }))
        .filter((t) => t.articles.length > 0),
    };
  }
  /* A filing: **only the deepest topic that fits**, so the parent has to come
     from `withAncestors` and not from this answer. */
  const tree = treeIn(call.user);
  const idOf = (label: string) => tree.find((t) => t.label === label)?.id;
  return {
    articles: lines.map((l) => {
      const finer = FINER.find((t) => l.text.includes(t.word));
      const broad = BROAD.find((t) => l.text.includes(t.word));
      const id = (finer && idOf(finer.label)) ?? (broad && idOf(broad.label));
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
    const user = sent.messages?.[1]?.content ?? "";
    const call: Seen = {
      schema: sent.response_format?.json_schema?.name ?? "",
      within: /all filed under "([^"]+)"/.exec(user)?.[1] ?? null,
      user,
    };
    seen.push(call);
    const during = meanwhile;
    meanwhile = null;
    if (during) await during();
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (mode === "fail" || (mode === "fail-finer" && call.within !== null))
      return { ok: false, status: 503, headers: new Headers(), text: async () => "upstream down" } as unknown as Response;
    const body = {
      model: "openai/gpt-6-luna",
      provider: "OpenAI",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answerFor(call)) } }],
      usage: { prompt_tokens: 900, completion_tokens: 400, cost: 0.00042 },
    };
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) } as unknown as Response;
  }) as unknown as typeof fetch;
}

/* ----------------------------------------------------------------- route -- */

async function get(archived = false, owner: OwnerId = OWNER): Promise<LibraryTermsResponse> {
  const signedIn: Verifier = async () => ({
    ok: true,
    claims: { sub: owner, email: `${owner}@shelf-topics-route.example.invalid`, role: "authenticated" },
  });
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

/** The row as the database has it, whoever is asking. */
async function row(owner: OwnerId = OWNER) {
  const [r] = await db().select().from(shelfTopicSets).where(eq(shelfTopicSets.ownerId, owner));
  return r;
}

/** Take the backoff and any claim off the row, as if time had passed. */
async function clearBackoff(): Promise<void> {
  await db()
    .update(shelfTopicSets)
    .set({ failures: 0, retryAfter: null, claimId: null, claimedUntil: null })
    .where(eq(shelfTopicSets.ownerId, OWNER));
}

async function forget(owner: OwnerId = OWNER): Promise<void> {
  await db().delete(shelfTopicSets).where(eq(shelfTopicSets.ownerId, owner));
}

const keys = (r: LibraryTermsResponse) => r.terms.map((t) => t.key);
const slugsOf = (r: LibraryTermsResponse, key: string) => r.terms.find((t) => t.key === key)?.articles.map((a) => a.slug) ?? [];

/** Ask, key-less, until the phrase program has read every article. */
async function readTheShelf(owner: OwnerId = OWNER): Promise<LibraryTermsResponse> {
  const key = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    for (let i = 0; i < 20; i++) {
      const got = await get(false, owner);
      if (got.pending === 0) return got;
    }
    throw new Error("the phrase program never finished reading the shelf");
  } finally {
    if (key !== undefined) process.env.OPENROUTER_API_KEY = key;
  }
}

let ids: string[] = [];
const extraOwners: OwnerId[] = [];
const previousKey = process.env.OPENROUTER_API_KEY;

beforeAll(async () => {
  await seedAuthUser(db(), { id: OWNER, email: "shelf-topics-route@example.invalid", onConflictDoNothing: true });
  await db().delete(articles).where(like(articles.slug, `${PREFIX}%`));
  await db().delete(shelfTopicSets).where(eq(shelfTopicSets.ownerId, OWNER));
  /* The fallback reads stored phrase scores; none may be left from an older run. */
  await db().delete(shelfTopicScores).where(eq(shelfTopicScores.ownerId, OWNER));
  await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, OWNER));
  await db()
    .insert(readerProfiles)
    .values({ ownerId: OWNER, profile: PROFILE_MARK })
    .onConflictDoNothing();
  ids = [];
  /* Fifteen works: twelve on neuroscience (six on replay, six on the retina)
     — enough for that topic to be split — and three on carpentry, which is
     what a broad topic needs once the shelf passes twenty (`minWorks`). */
  for (let i = 0; i < 15; i++) {
    const title =
      i >= 12 ? `Carpentry joinery note ${i}` : i === 0 ? `Neuro replay ${TITLE_MARK}` : `Neuro ${i % 2 === 0 ? "replay" : "retinal"} note ${i}`;
    ids.push(
      await makeArticle(
        OWNER,
        `${PREFIX}${i}`,
        title,
        i === 0 ? GIST_MARK : null,
        paragraphs([PHRASES[i % 6] ?? "", PHRASES[(i + 1) % 6] ?? ""], UNIQUE[i] ?? ""),
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
  for (const owner of [OWNER, ...extraOwners]) {
    await db().delete(shelfTopicSets).where(eq(shelfTopicSets.ownerId, owner));
    await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, owner));
  }
  await db().delete(shelfTopicScores).where(eq(shelfTopicScores.ownerId, OWNER));
  await closeDb();
});

beforeEach(async () => {
  seen = [];
  mode = "answer";
  delayMs = 0;
  meanwhile = null;
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  /* Each test starts with a whole allowance: the file does more than twelve
     pieces of work, and the hourly cap is twelve. */
  await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, OWNER));
});

const active = (n: number) => `${PREFIX}${n}`;

describe("GET /api/library/terms with a model-named topic set", () => {
  it("with no key, answers the phrase pills and claims and calls nothing", async () => {
    const got = await readTheShelf();
    expect(got.pending).toBe(0);
    expect(got.chosenBy).toBe("program");
    expect(got.refreshing).toBe(false);
    expect(got.terms.length).toBeGreaterThan(0);
    for (const t of got.terms) expect(PHRASES).toContain(t.key);
    expect(seen).toEqual([]);
    expect(await row()).toBeUndefined();
  });

  it("re-thinks a first shelf once, after answering with the phrase pills, and records the spend against the owner", async () => {
    const before = await db().select({ id: aiCalls.id }).from(aiCalls).where(eq(aiCalls.ownerId, OWNER));
    const got = await get();
    /* The answer that went out: the fallback, and a promise of more. */
    expect(got.chosenBy).toBe("program");
    expect(got.refreshing).toBe(true);
    expect(got.terms.length).toBeGreaterThan(0);
    for (const t of got.terms) {
      expect(PHRASES).toContain(t.key);
      expect(t.granularity).toBeUndefined();
    }

    /* The handler awaited the work: one call for the broad topics over all
       fifteen works, one for what is inside the only topic big enough. */
    expect(seen.map((c) => [c.schema, c.within])).toEqual([
      ["shelf_topics", null],
      ["shelf_topics", "Neuroscience"],
    ]);
    expect(articleLines(seen[0]?.user ?? "")).toHaveLength(15);
    expect(articleLines(seen[1]?.user ?? "")).toHaveLength(12);
    /* What the model is shown: the title, the gist and the reader's profile. */
    expect(seen[0]?.user).toContain(TITLE_MARK);
    expect(seen[0]?.user).toContain(GIST_MARK);
    expect(seen[0]?.user).toContain(PROFILE_MARK);

    const r = await row();
    expect(r?.model).toBe(SHELF_TOPICS_MODEL);
    expect(r?.promptVersion).toBe(TOPIC_SET_PROMPT_VERSION);
    expect(r?.topics?.map((t) => [t.label, t.depth, t.parent])).toEqual([
      ["Neuroscience", 0, null],
      ["Carpentry", 0, null],
      ["Hippocampal Replay", 1, "t1"],
      ["Retinal Circuits", 1, "t1"],
    ]);
    expect(r?.works).toBe(15);
    expect(r?.unplaced).toBe(0);
    expect(r?.profileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(r?.members ?? {}).sort()).toEqual([...ids].sort());
    expect(r?.members?.[ids[0] ?? ""]).toEqual(["t1", "t3"]);
    expect(r?.members?.[ids[14] ?? ""]).toEqual(["t2"]);
    expect(r?.rethoughtAt).toBeInstanceOf(Date);
    expect(r?.filedAt).toBeNull();
    expect(r?.claimId).toBeNull();
    expect(r?.failures).toBe(0);

    const spent = await db()
      .select({ purpose: aiCalls.purpose, scopeKind: aiCalls.scopeKind, wire: aiCalls.wire })
      .from(aiCalls)
      .where(eq(aiCalls.ownerId, OWNER));
    expect(spent.length).toBe(before.length + 2);
    expect(spent.filter((s) => s.purpose === "shelf-topics")).toEqual([
      { purpose: "shelf-topics", scopeKind: "request", wire: "chat" },
      { purpose: "shelf-topics", scopeKind: "request", wire: "chat" },
    ]);
  });

  it("answers the stored tree, broad first, with granularity and within and no count, and calls nothing", async () => {
    const got = await get();
    expect(got.chosenBy).toBe("model");
    expect(got.refreshing).toBe(false);
    expect(got.pending).toBe(0);
    expect(got.terms.map((t) => ({ key: t.key, label: t.label, granularity: t.granularity, within: t.within, n: t.articles.length }))).toEqual([
      { key: "neuroscience", label: "Neuroscience", granularity: 0, within: undefined, n: 12 },
      { key: "carpentry", label: "Carpentry", granularity: 0, within: undefined, n: 3 },
      { key: "hippocampal replay", label: "Hippocampal Replay", granularity: 0.5, within: "neuroscience", n: 6 },
      { key: "retinal circuits", label: "Retinal Circuits", granularity: 0.5, within: "neuroscience", n: 6 },
    ]);
    /* A broad topic carries no `within` key at all, and no member a `count`. */
    expect(Object.keys(got.terms[0] ?? {})).not.toContain("within");
    for (const t of got.terms) for (const a of t.articles) expect(Object.keys(a)).toEqual(["slug"]);
    expect(slugsOf(got, "carpentry").sort()).toEqual([active(12), active(13), active(14)]);
    expect(slugsOf(got, "hippocampal replay").sort()).toEqual([0, 2, 4, 6, 8, 10].map(active).sort());
    /* The model read every article: the scope is the shelf, and nothing waits. */
    expect(got.scope).toEqual({ articles: 15, works: 15, skipped: 0 });
    expect(got.sorting).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("does not refresh because an article was opened", async () => {
    await db().update(articles).set({ opens: 5, lastOpenedAt: new Date() }).where(eq(articles.id, ids[3] ?? ""));
    const got = await get();
    expect(got.refreshing).toBe(false);
    expect(seen).toEqual([]);
  });

  it("files a new article into the stored tree — one filing call, no re-think — and shows it under its topic and the parent", async () => {
    const rethoughtAt = (await row())?.rethoughtAt;
    const slug = await arrive("replay");
    const got = await get();
    /* Still the stored tree, without the newcomer, and a promise of more. */
    expect(got.chosenBy).toBe("model");
    expect(got.refreshing).toBe(true);
    expect(got.sorting).toBe(1);
    expect(slugsOf(got, "neuroscience")).not.toContain(slug);
    expect(nameCalls()).toHaveLength(0);
    expect(fileCalls()).toHaveLength(1);
    /* It was asked about that one work only, and shown the whole tree. */
    expect(articleLines(fileCalls()[0]?.user ?? "")).toHaveLength(1);
    expect(treeIn(fileCalls()[0]?.user ?? "").map((t) => t.label)).toEqual(["Neuroscience", "Hippocampal Replay", "Retinal Circuits", "Carpentry"]);

    const r = await row();
    expect(r?.filedAt).toBeInstanceOf(Date);
    expect(r?.rethoughtAt).toEqual(rethoughtAt);
    expect(r?.works).toBe(15);
    expect(r?.claimId).toBeNull();

    seen = [];
    const next = await get();
    expect(next.refreshing).toBe(false);
    expect(next.sorting).toBeUndefined();
    /* The model named only the finer topic; the parent is ours to add. */
    expect(slugsOf(next, "hippocampal replay")).toContain(slug);
    expect(slugsOf(next, "neuroscience")).toContain(slug);
    expect(slugsOf(next, "retinal circuits")).not.toContain(slug);
    expect(slugsOf(next, "carpentry")).not.toContain(slug);
    expect(slugsOf(next, "neuroscience")).toHaveLength(13);
    expect(seen).toEqual([]);
  });

  it("files while the shelf has grown by less than a quarter and five works, and re-thinks when it has", async () => {
    /* Sixteen works now, fifteen at the last re-think: a re-think is due at
       fifteen plus five. Three more is nineteen — one short. */
    for (let i = 0; i < 3; i++) await arrive("retinal");
    await get();
    expect(nameCalls()).toHaveLength(0);
    expect(fileCalls()).toHaveLength(1);
    expect(articleLines(fileCalls()[0]?.user ?? "")).toHaveLength(3);
    expect((await row())?.works).toBe(15);

    seen = [];
    const slug = await arrive("retinal");
    const got = await get();
    expect(got.refreshing).toBe(true);
    expect(fileCalls()).toHaveLength(0);
    expect(topNameCalls()).toHaveLength(1);
    expect(articleLines(topNameCalls()[0]?.user ?? "")).toHaveLength(20);
    /* A re-think is shown the labels it chose last time. */
    expect(topNameCalls()[0]?.user).toContain('Last time the topics here were: "Neuroscience", "Carpentry"');
    const r = await row();
    expect(r?.works).toBe(20);
    expect(r?.filedAt).toBeNull();

    seen = [];
    const next = await get();
    expect(next.refreshing).toBe(false);
    expect(slugsOf(next, "retinal circuits")).toContain(slug);
    expect(slugsOf(next, "neuroscience")).toHaveLength(17);
    expect(seen).toEqual([]);
  });

  it("makes the model work once for two concurrent requests", async () => {
    await forget();
    delayMs = 300;
    const [a, b] = await Promise.all([get(), get()]);
    expect(topNameCalls()).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect([a.refreshing, b.refreshing]).toEqual([true, true]);
    const r = await row();
    expect(r?.works).toBe(20);
    expect(r?.claimId).toBeNull();
  });

  it("counts a failure and backs off, calls nothing inside the backoff, and keeps serving the stored set", async () => {
    const slug = await arrive("replay");
    mode = "fail";
    const got = await get();
    expect(got.chosenBy).toBe("model");
    expect(keys(got)).toContain("neuroscience");
    expect(seen).toHaveLength(1);
    const failed = await row();
    expect(failed?.failures).toBe(1);
    expect(failed?.claimId).toBeNull();
    expect(failed?.retryAfter?.getTime() ?? 0).toBeGreaterThan(Date.now() + 60_000);
    expect(failed?.topics).toHaveLength(4);

    /* The provider is well again, the work is still due — and nothing asks. */
    mode = "answer";
    seen = [];
    const inside = await get();
    expect(seen).toEqual([]);
    expect(inside.chosenBy).toBe("model");
    expect(inside.refreshing).toBe(false);
    expect(slugsOf(inside, "neuroscience")).toHaveLength(17);
    expect(slugsOf(inside, "neuroscience")).not.toContain(slug);
    expect((await row())?.failures).toBe(1);

    /* Once the backoff has passed, the filing happens and the count resets. */
    await clearBackoff();
    await get();
    expect(fileCalls()).toHaveLength(1);
    expect((await row())?.failures).toBe(0);
    expect(slugsOf(await get(), "hippocampal replay")).toContain(slug);
  });

  it("stops at the daily cap, without calling and without counting it as a failure", async () => {
    const slug = await arrive("replay");
    await db()
      .insert(rateLimitEvents)
      .values(Array.from({ length: 40 }, () => ({ ownerId: OWNER, bucket: "shelf-topics" })));
    const got = await get();
    expect(seen).toEqual([]);
    expect(got.chosenBy).toBe("model");
    expect(got.refreshing).toBe(false);
    const r = await row();
    expect(r?.failures).toBe(0);
    expect(r?.claimId).toBeNull();
    expect(r?.retryAfter?.getTime() ?? 0).toBeGreaterThan(Date.now() + 60_000);
    expect(r?.members?.[slug]).toBeUndefined();

    await db().delete(rateLimitEvents).where(eq(rateLimitEvents.ownerId, OWNER));
    await clearBackoff();
    await get();
    expect(fileCalls()).toHaveLength(1);
  });

  it("serves the active shelf and the archive from one stored set, and asks for neither", async () => {
    const before = await row();
    const archivedIds = [ids[12] ?? "", ids[13] ?? "", ids[14] ?? ""];
    for (const id of archivedIds) await db().update(articles).set({ archivedAt: new Date() }).where(eq(articles.id, id));
    try {
      const without = await get();
      expect(without.chosenBy).toBe("model");
      expect(without.refreshing).toBe(false);
      expect(keys(without).sort()).toEqual(["hippocampal replay", "neuroscience", "retinal circuits"]);

      const withArchive = await get(true);
      expect(withArchive.chosenBy).toBe("model");
      expect(withArchive.refreshing).toBe(false);
      expect(keys(withArchive)).toContain("carpentry");
      expect(slugsOf(withArchive, "carpentry").sort()).toEqual([active(12), active(13), active(14)]);
      expect(withArchive.scope.articles).toBe(without.scope.articles + 3);

      expect(seen).toEqual([]);
      const rows = await db().select().from(shelfTopicSets).where(eq(shelfTopicSets.ownerId, OWNER));
      expect(rows).toEqual([before]);
    } finally {
      for (const id of archivedIds) await db().update(articles).set({ archivedAt: null }).where(eq(articles.id, id));
    }
    expect(keys(await get())).toContain("carpentry");
  });

  it("re-thinks when the reader's profile changes, and not again once it has", async () => {
    const before = await row();
    const changed = `${PROFILE_MARK}, and lately the fens`;
    await db().update(readerProfiles).set({ profile: changed }).where(eq(readerProfiles.ownerId, OWNER));
    const got = await get();
    expect(got.chosenBy).toBe("model");
    expect(got.refreshing).toBe(true);
    expect(fileCalls()).toHaveLength(0);
    expect(topNameCalls()).toHaveLength(1);
    expect(topNameCalls()[0]?.user).toContain(changed);
    const after = await row();
    expect(after?.profileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(after?.profileHash).not.toBe(before?.profileHash);
    expect(after?.rethoughtAt?.getTime() ?? 0).toBeGreaterThan(before?.rethoughtAt?.getTime() ?? Infinity);

    seen = [];
    expect((await get()).refreshing).toBe(false);
    expect(seen).toEqual([]);
  });

  it("files an article that arrived while the re-think ran, in the same request", async () => {
    await forget();
    let slug = "";
    meanwhile = async () => {
      slug = await arrive("retinal");
    };
    const got = await get();
    expect(got.refreshing).toBe(true);
    expect(seen.map((c) => c.schema)).toEqual(["shelf_topics", "shelf_topics", "shelf_filing"]);
    expect(articleLines(fileCalls()[0]?.user ?? "")).toHaveLength(1);
    const r = await row();
    expect(r?.filedAt).toBeInstanceOf(Date);
    expect(r?.claimId).toBeNull();

    seen = [];
    const next = await get();
    expect(next.refreshing).toBe(false);
    expect(next.sorting).toBeUndefined();
    expect(slug).not.toBe("");
    expect(slugsOf(next, "retinal circuits")).toContain(slug);
    expect(slugsOf(next, "neuroscience")).toContain(slug);
    expect(seen).toEqual([]);
  });

  it("fails the whole re-think when a finer level fails twice, and keeps the stored tree", async () => {
    const before = await row();
    /* A re-think is due: the profile has changed again. */
    await db().update(readerProfiles).set({ profile: `${PROFILE_MARK}, and now the saltings` }).where(eq(readerProfiles.ownerId, OWNER));
    mode = "fail-finer";
    const got = await get();
    expect(got.chosenBy).toBe("model");
    /* The broad call, then the one finer level asked twice. */
    expect(seen.map((c) => [c.schema, c.within])).toEqual([
      ["shelf_topics", null],
      ["shelf_topics", "Neuroscience"],
      ["shelf_topics", "Neuroscience"],
    ]);
    const failed = await row();
    expect(failed?.failures).toBe(1);
    expect(failed?.claimId).toBeNull();
    expect(failed?.rethoughtAt).toEqual(before?.rethoughtAt);
    expect(failed?.topics).toEqual(before?.topics);
    expect(failed?.profileHash).toBe(before?.profileHash);

    mode = "answer";
    seen = [];
    const inside = await get();
    expect(seen).toEqual([]);
    expect(keys(inside).sort()).toEqual(["carpentry", "hippocampal replay", "neuroscience", "retinal circuits"]);

    await clearBackoff();
    await get();
    expect(topNameCalls()).toHaveLength(1);
    expect((await row())?.failures).toBe(0);
  });

  it("re-thinks when the shelf has shrunk by a quarter and five works, and not for one fewer", async () => {
    const works = (await row())?.works ?? 0;
    const due = Math.max(5, Math.ceil(works * 0.25));
    /* The newest latecomers go, the first stays. */
    const going = Array.from({ length: due }, (_, i) => `${PREFIX}late-${lateCounter - 1 - i}`);
    expect(lateCounter).toBeGreaterThan(due);
    for (const slug of going.slice(1)) await db().delete(articles).where(eq(articles.slug, slug));
    expect((await get()).refreshing).toBe(false);
    expect(seen).toEqual([]);

    await db().delete(articles).where(eq(articles.slug, going[0] ?? ""));
    const got = await get();
    expect(got.refreshing).toBe(true);
    expect(fileCalls()).toHaveLength(0);
    expect(topNameCalls()).toHaveLength(1);
    expect((await row())?.works).toBe(works - due);
  });

  it("still answers with the phrase pills when the topic-set table cannot be read or claimed — a deploy ahead of its migration", async () => {
    /* Production gets this code before the migration is applied. The reader's
       topics must not become a 500 because a cache table is absent. */
    await forget();
    const base = defaultShelfTopicSetDeps();
    const missing = async (): Promise<never> => {
      throw new Error('relation "spideryarn.shelf_topic_sets" does not exist');
    };
    const unreadable = Object.create(base.store) as typeof base.store;
    unreadable.readTopicSet = missing;
    const unclaimable = Object.create(base.store) as typeof base.store;
    unclaimable.claimTopicSet = missing;
    for (const store of [unreadable, unclaimable]) {
      const answer = await runAsOwner(OWNER, () => shelfTopicSet(false, { ...base, store }));
      expect(answer.response.chosenBy).toBe("program");
      expect(answer.response.terms.length).toBeGreaterThan(0);
      expect(answer.refresh).toBeNull();
    }
    expect(seen).toEqual([]);
    expect(await row()).toBeUndefined();
  });

  it("logs a re-think and a filing without a title, a gist, a topic label or the profile", async () => {
    await forget();
    const written = await logLinesWhile(async () => {
      await get();
      await arrive("replay");
      await get();
    });
    expect(topNameCalls()).toHaveLength(1);
    expect(fileCalls()).toHaveLength(1);
    /* The positive controls: the capture saw both jobs' own lines, and the
       model really was shown what must not be logged. */
    expect(written).toContain("re-thought the shelf's topics");
    expect(written).toContain("filed new works into the shelf's topics");
    expect(written).not.toContain("the claim had moved on");
    const sent = seen.map((c) => c.user).join("\n");
    for (const shown of [TITLE_MARK, GIST_MARK, PROFILE_MARK, ...LABELS]) expect(sent, shown).toContain(shown);

    /* Every title and gist this owner's shelf holds, not a named few: a line
       that logged some other article's title must fail too. */
    const shelf = await db()
      .select({ title: articleRevisions.title, override: articles.titleOverride, gist: articleRevisions.rootGist })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(and(eq(articles.ownerId, OWNER), like(articles.slug, `${PREFIX}%`)));
    const titles = shelf.flatMap((a) => [a.title, a.override]).filter((t): t is string => Boolean(t));
    const gists = shelf.map((a) => a.gist).filter((g): g is string => Boolean(g));
    expect(titles).toEqual(expect.arrayContaining([`Neuro replay ${TITLE_MARK}`, "Carpentry joinery note 14", "Neuro replay latecomer 0"]));
    expect(gists).toContain(GIST_MARK);
    const lower = written.toLowerCase();
    for (const secret of [...titles, ...gists, ...LABELS, TITLE_MARK, PROFILE_MARK, ...PHRASES])
      expect(lower, secret).not.toContain(secret.toLowerCase());
  });

  it("reads, fences and writes only the requesting owner's row — another reader's set and live claim neither leak nor block", async () => {
    /* A second reader whose stored set files **this** owner's articles under
       a topic of their own, with a live claim. This owner has no row, so a
       read that forgot the owner could only find theirs, and a claim that
       forgot it would be refused. Minted per run — tests/fixture-ids.test.ts. */
    const other = randomUUID() as OwnerId;
    extraOwners.push(other);
    await seedAuthUser(db(), { id: other, email: `other-${other}@shelf-topics-route.example.invalid` });
    await forget();
    const mine = await db().select({ id: articles.id }).from(articles).where(eq(articles.ownerId, OWNER));
    try {
      await db()
        .insert(shelfTopicSets)
        .values({
          ownerId: other,
          model: SHELF_TOPICS_MODEL,
          promptVersion: TOPIC_SET_PROMPT_VERSION,
          profileHash: "f".repeat(64),
          topics: [{ id: "t1", key: "their own subject", label: "Their Own Subject", parent: null, depth: 0 }],
          members: Object.fromEntries(mine.map((a) => [a.id, ["t1"]])),
          works: mine.length,
          unplaced: 0,
          rethoughtAt: new Date(),
          claimId: randomUUID(),
          claimedUntil: new Date(Date.now() + 10 * 60_000),
        });
      const before = await row(other);
      expect(before?.topics).toHaveLength(1);

      const got = await get();
      /* Not their set: this owner has none, so the phrase pills. */
      expect(got.chosenBy).toBe("program");
      expect(keys(got)).not.toContain("their own subject");
      /* Not blocked by their claim: this owner's re-think ran and wrote. */
      expect(got.refreshing).toBe(true);
      expect(topNameCalls()).toHaveLength(1);
      const own = await row();
      expect(own?.topics?.map((t) => t.label)).toEqual(LABELS);
      expect(own?.claimId).toBeNull();
      /* And theirs is exactly as it was. */
      expect(await row(other)).toEqual(before);

      /* The next answer uses this owner's own row, not theirs. */
      seen = [];
      const again = await get();
      expect(again.chosenBy).toBe("model");
      expect(keys(again).sort()).toEqual(["carpentry", "hippocampal replay", "neuroscience", "retinal circuits"]);
      expect(seen).toEqual([]);
    } finally {
      await forget(other);
    }
  });

  it("asks nothing and stores nothing below eight works — eight articles, two of them one text — and both arrive with the eighth work", async () => {
    const small = randomUUID() as OwnerId;
    extraOwners.push(small);
    await seedAuthUser(db(), { id: small, email: `small-${small}@shelf-topics-route.example.invalid` });
    const words = ["oakmantle", "pinebrook", "quillfen", "rowanside", "sedgewick", "thornlea", "umberfall", "vetchwood"];
    const slug = (i: number) => `${PREFIX}small-${small.slice(0, 8)}-${i}`;
    const seedSmall = (i: number, text: number) =>
      makeArticle(
        small,
        slug(i),
        /* The title is part of the counted text, so a copy shares it. */
        `Neuro replay small ${text}`,
        null,
        paragraphs([PHRASES[text % 6] ?? "", PHRASES[(text + 1) % 6] ?? ""], words[text] ?? ""),
        i,
      );
    /* Seven texts, and an eighth article that is an exact copy of the first. */
    for (let i = 0; i < 7; i++) await seedSmall(i, i);
    await seedSmall(7, 0);
    /* The copy is only known to be one once the phrase program has read both. */
    await readTheShelf(small);
    seen = [];

    const got = await get(false, small);
    expect(got.scope.articles).toBe(8);
    expect(got.chosenBy).toBe("program");
    expect(got.refreshing).toBe(false);
    expect(seen).toEqual([]);
    expect(await row(small)).toBeUndefined();

    /* The control: one more text is eight works, and now it asks — about
       eight works, not nine articles. */
    await seedSmall(8, 7);
    await readTheShelf(small);
    const first = await get(false, small);
    expect(first.refreshing).toBe(true);
    expect(topNameCalls()).toHaveLength(1);
    expect(articleLines(topNameCalls()[0]?.user ?? "")).toHaveLength(8);
    expect((await row(small))?.works).toBe(8);
    /* And the copy takes its twin's topics. */
    const next = await get(false, small);
    expect(next.chosenBy).toBe("model");
    expect(slugsOf(next, "neuroscience").sort()).toEqual(Array.from({ length: 9 }, (_, i) => slug(i)).sort());

    /* Back below eight works, the stored tree is not shown and nothing is asked. */
    seen = [];
    await db().delete(articles).where(eq(articles.slug, slug(8)));
    const fewer = await get(false, small);
    expect(fewer.chosenBy).toBe("program");
    expect(fewer.refreshing).toBe(false);
    expect(seen).toEqual([]);
    expect((await row(small))?.works).toBe(8);
  });
});
