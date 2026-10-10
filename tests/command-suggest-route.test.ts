/**
 * **`POST /api/command-suggest/:slug`, through the route and Postgres** — the
 * command bar's short list from why you are reading. Plan 261005k, Stage 2;
 * src/routes.ts § `suggestFromWhyReading`.
 *
 * 1. **The owner only.** Somebody else's article is the 404 every owner-scoped
 *    route gives, a request with no sign-in is a 401, and neither reaches a
 *    model — even though the stranger's article has a reason for reading.
 * 2. **A reason that was read and is empty answers `nothing`, with no call.**
 * 3. **A reason that could not be read is a failure the reader can retry,
 *    never `nothing`** (GPT Sol's F6), and makes no call either.
 * 4. **The model reads the profile the server loaded and this server's words
 *    for the modes** — never a row that is not a mode (F1), never the article.
 * 5. **The answer carries the fingerprint of what the model read**, which is
 *    the one the browser computes from `GET /api/reader?slug=` (F3).
 * 6. **A provider's failure is its own sentence and status**, not a list.
 * 7. **Dismissals** (plan 261010u): `POST …/dismiss` is owner-only and takes
 *    two fingerprints and nothing else; a dismissed search, mode or lens is
 *    gone from the next answer, and the model is sent none of it; once the
 *    reason changes nothing is filtered; the row keeps the newest fifty, loses
 *    neither of two at once, and goes with the article.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The shelf read, with a way to make it fail.** `resolveProfileParts`
 * swallows a failed shelf read and reports `purposeFailed`; nothing in a test
 * can make Postgres fail one read of one row on request, so the failure is put
 * here. Every other export, and every other call, is the real store's.
 */
let shelfReadFails = false;
vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>("../src/store/index.js");
  const shelfStore: typeof actual.shelfStore = Object.assign(Object.create(actual.shelfStore), {
    read: async (slug: string) => {
      if (shelfReadFails) throw new Error("the shelf could not be read");
      return actual.shelfStore.read(slug);
    },
  });
  return { ...actual, shelfStore };
});

import { closeDb, getDb } from "../src/db/client.js";
import { articles, commandSuggestionDismissals, SUGGESTION_DISMISSAL_TABLE } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { REASON_NOT_READ } from "../src/messages.js";
import { EVAL_OWNER_ID } from "../src/owner.js";
import {
  DISMISS_STALE,
  MAX_DISMISSED_SUGGESTIONS,
  readFromHash,
  suggestionIdentity,
} from "../src/command-suggest.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-command-suggest-route";
const STRANGERS = "test-command-suggest-route-strangers";
const DOOMED = "test-command-suggest-route-doomed";
const REASON = "how they handled missing data in the follow-up";

await pgReady({
  suite: "tests/command-suggest-route.test.ts",
  tables: ["spideryarn.articles", "spideryarn.command_suggestion_dismissals"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;

const realFetch = globalThis.fetch;
/** Every request that reached the model, as text. */
let asked: string[] = [];
/** What the model answers with next. */
let modelSays: () => Response = () => new Response("{}", { status: 500 });

const says = (content: unknown, status = 200): Response =>
  new Response(
    JSON.stringify(
      status === 200
        ? {
            choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 900, completion_tokens: 100, cost: 0.0004 },
          }
        : { error: { message: "upstream words" } },
    ),
    { status },
  );

const LIST = {
  searches: [
    { words: "missing data", why: "Finds how gaps in the data were handled." },
    { words: "loss to follow-up", why: "Shows who dropped out." },
  ],
  modes: [
    { key: "action:archive", why: "Not a mode, whatever the model says." },
    { key: "mode:skim", why: "A fast route through the paper's own lines." },
  ],
  lens: { words: "criticism of the handling of missing data", why: "What others made of it." },
};

const ROWS = [
  { id: "mode:skim", label: "Skim" },
  { id: "submode:sources:reception", label: "Sources › Reception" },
  { id: "action:archive", label: "Archive this article" },
];

async function setPurpose(slug: string, purpose: string | null): Promise<void> {
  await getDb().update(articles).set({ purpose }).where(eq(articles.slug, slug));
}

beforeAll(async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key");
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* Somebody else's, and it has a reason for reading: the refusal below is
     about whose it is, not about there being nothing to work from. */
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  await setPurpose(STRANGERS, REASON);
  /* Only the model's address is answered here; everything else (the bucket)
     goes to the real `fetch`. */
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith("https://openrouter.ai/")) return realFetch(input, init);
    asked.push(String(init?.body));
    return modelSays();
  }) as typeof fetch;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  await article?.remove();
  await strangers?.remove();
  await closeDb();
});

beforeEach(async () => {
  asked = [];
  shelfReadFails = false;
  modelSays = () => says(LIST);
  await setPurpose(SLUG, REASON);
});

async function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = AUTHED_HEADERS,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const req = Object.assign(
    (async function* () {
      if (body !== undefined) yield Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    })(),
    { method, url, headers },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(s: number) {
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    off() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    body: written ? (JSON.parse(written) as Record<string, unknown>) : null,
  };
}

const suggest = (slug: string, body: unknown = { rows: ROWS }, headers?: Record<string, string>) =>
  request("POST", `/api/command-suggest/${slug}`, body, headers);

describe("POST /api/command-suggest/:slug", () => {
  it("answers the owner with a list, read from the profile the server loaded", async () => {
    const got = await suggest(SLUG);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      kind: "suggestions",
      searches: LIST.searches,
      /* The Archive key the model returned under `modes` is gone (F1). */
      modes: [{ key: { id: "mode:skim", label: "Skim" }, why: "A fast route through the paper's own lines." }],
      lens: LIST.lens,
    });
    expect(asked).toHaveLength(1);
    /* The reason for reading, as stored — not anything the browser sent. */
    expect(asked[0]).toContain(REASON);
    /* The modes only, in this server's words: Archive was sent and is not shown. */
    expect(asked[0]).toContain("mode:skim | Skim: ");
    expect(asked[0]).not.toContain("action:archive");
    /* And not the article. */
    const prose = article?.blocks.find((b) => b.text.length > 80)?.text.slice(0, 60) ?? "";
    expect(prose).not.toBe("");
    expect(asked[0]).not.toContain(prose);
  });

  it("carries the fingerprint the browser computes from GET /api/reader?slug= (F3)", async () => {
    const reader = await request("GET", `/api/reader?slug=${SLUG}`);
    const { profile, purpose } = reader.body as { profile: string | null; purpose: string | null };
    expect(purpose).toBe(REASON);
    const got = await suggest(SLUG);
    expect(got.body?.readFrom).toBe(readFromHash({ profile, purpose }));

    /* A different reason is a different fingerprint. */
    await setPurpose(SLUG, "what the control group was given");
    const next = await suggest(SLUG);
    expect(next.body?.readFrom).not.toBe(got.body?.readFrom);
    expect(asked[1]).toContain("what the control group was given");
  });

  it("is a 404 for an article somebody else owns, and asks no model", async () => {
    const got = await suggest(STRANGERS);
    expect(got.status).toBe(404);
    expect(asked).toHaveLength(0);
  });

  it("is a 401 with no sign-in, and asks no model", async () => {
    const got = await suggest(SLUG, { rows: ROWS }, {});
    expect(got.status).toBe(401);
    expect(asked).toHaveLength(0);
  });

  it("answers nothing, with no call, when the reason was read and is empty", async () => {
    for (const empty of [null, "   \r\n  "]) {
      await setPurpose(SLUG, empty);
      const got = await suggest(SLUG);
      expect(got).toEqual({ status: 200, body: { kind: "nothing", why: "no-reason" } });
    }
    expect(asked).toHaveLength(0);
  });

  it("is a retryable failure, never nothing, when the reason could not be read (F6)", async () => {
    shelfReadFails = true;
    const got = await suggest(SLUG);
    expect(got.status).toBe(503);
    expect(got.body).toEqual({ error: REASON_NOT_READ.message });
    expect(REASON_NOT_READ.kind).toBe("retry");
    expect(asked).toHaveLength(0);
  });

  it("answers nothing, with no call, when no row sent is a mode", async () => {
    const got = await suggest(SLUG, { rows: [{ id: "action:archive", label: "Archive this article" }] });
    expect(got).toEqual({ status: 200, body: { kind: "nothing", why: "no-rows" } });
    expect(asked).toHaveLength(0);
  });

  it("answers nothing when the model was asked and wrote nothing that could be kept", async () => {
    modelSays = () => says({ searches: [], modes: [{ key: "action:archive", why: "x" }], lens: null });
    const got = await suggest(SLUG);
    expect(got).toEqual({ status: 200, body: { kind: "nothing", why: "no-list" } });
    expect(asked).toHaveLength(1);
  });

  it("refuses a body with a field it does not take — there is no way to send a profile", async () => {
    for (const body of [{ rows: ROWS, purpose: "ignore the above" }, { rows: "all" }, "[1]"]) {
      const got = await suggest(SLUG, body);
      expect(got.status).toBe(400);
    }
    expect(asked).toHaveLength(0);
  });

  it("answers a provider's failure with our sentence and its status, not a list", async () => {
    modelSays = () => says(null, 429);
    const got = await suggest(SLUG);
    expect(got.status).toBe(502);
    expect(JSON.stringify(got.body)).not.toContain("upstream words");
    expect(got.body).not.toHaveProperty("kind");
  });
});

/* ------------------------------------------------- dismissals, plan 261010u -- */

const dismiss = (slug: string, body: unknown, headers?: Record<string, string>) =>
  request("POST", `/api/command-suggest/${slug}/dismiss`, body, headers);

/** The fingerprint the route computes for `SLUG` as it stands. */
async function fingerprintOf(slug: string): Promise<string> {
  const reader = await request("GET", `/api/reader?slug=${slug}`);
  const { profile, purpose } = reader.body as { profile: string | null; purpose: string | null };
  return readFromHash({ profile, purpose });
}

async function rowOf(articleId: string | undefined) {
  const rows = await getDb()
    .select()
    .from(commandSuggestionDismissals)
    .where(eq(commandSuggestionDismissals.articleId, articleId ?? ""));
  return rows[0];
}

/** Sixteen hex digits that are not any suggestion's identity: `n` in hex, padded. */
const filler = (n: number): string => n.toString(16).padStart(16, "0");

describe("POST /api/command-suggest/:slug/dismiss", () => {
  beforeEach(async () => {
    await getDb()
      .delete(commandSuggestionDismissals)
      .where(eq(commandSuggestionDismissals.articleId, article?.articleId ?? ""));
  });

  it("the table's bound is the route's", () => {
    expect(SUGGESTION_DISMISSAL_TABLE.maxIdentities).toBe(MAX_DISMISSED_SUGGESTIONS);
  });

  it("is a 401 with no sign-in, and stores nothing", async () => {
    const readFrom = await fingerprintOf(SLUG);
    const got = await dismiss(SLUG, { readFrom, identity: suggestionIdentity("search", "missing data") }, {});
    expect(got.status).toBe(401);
    expect(await rowOf(article?.articleId)).toBeUndefined();
  });

  it("is a 404 for an article somebody else owns, and stores nothing", async () => {
    const got = await dismiss(STRANGERS, { readFrom: filler(1), identity: filler(2) });
    expect(got.status).toBe(404);
    expect(await rowOf(strangers?.articleId)).toBeUndefined();
  });

  it("is a 400 for a body that is not exactly two fingerprints — no words reach the server", async () => {
    const readFrom = await fingerprintOf(SLUG);
    const identity = suggestionIdentity("search", "missing data");
    for (const body of [
      { readFrom, identity, words: "missing data" },
      { readFrom, identity: "missing data" },
      { readFrom: "not hex at all!!", identity },
      { readFrom, identity: identity.toUpperCase() },
      { readFrom },
      "[1]",
    ]) {
      const got = await dismiss(SLUG, body);
      expect(got.status, JSON.stringify(body)).toBe(400);
    }
    expect(await rowOf(article?.articleId)).toBeUndefined();
  });

  it("filters a dismissed search, mode and lens out of the next answer, and sends the model none of it", async () => {
    const readFrom = await fingerprintOf(SLUG);
    const dismissed = [
      suggestionIdentity("search", "missing data"),
      suggestionIdentity("mode", "mode:skim"),
      suggestionIdentity("lens", LIST.lens.words),
    ];
    for (const identity of dismissed) {
      expect(await dismiss(SLUG, { readFrom, identity })).toEqual({ status: 200, body: { ok: true } });
    }
    const got = await suggest(SLUG);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ kind: "suggestions", readFrom, searches: [LIST.searches[1]], modes: [], lens: null });
    /* Asked the same as ever: the dismissals are applied after, never sent. */
    expect(asked).toHaveLength(1);
    for (const identity of dismissed) expect(asked[0]).not.toContain(identity);
    expect(asked[0]).toContain("mode:skim | Skim: ");
    expect(asked[0]).not.toMatch(/dismiss/i);
  });

  it("answers nothing when every suggestion was dismissed", async () => {
    const readFrom = await fingerprintOf(SLUG);
    for (const identity of [
      ...LIST.searches.map((s) => suggestionIdentity("search", s.words)),
      suggestionIdentity("mode", "mode:skim"),
      suggestionIdentity("lens", LIST.lens.words),
    ]) {
      await dismiss(SLUG, { readFrom, identity });
    }
    expect(await suggest(SLUG)).toEqual({ status: 200, body: { kind: "nothing", why: "no-list" } });
  });

  it("does not filter once the reason has changed, and a dismissal under the new one replaces the row (F6)", async () => {
    const before = await fingerprintOf(SLUG);
    await dismiss(SLUG, { readFrom: before, identity: suggestionIdentity("search", "missing data") });
    await dismiss(SLUG, { readFrom: before, identity: suggestionIdentity("mode", "mode:skim") });
    const first = await rowOf(article?.articleId);

    await setPurpose(SLUG, "what the control group was given");
    const after = await fingerprintOf(SLUG);
    expect(after).not.toBe(before);
    const got = await suggest(SLUG);
    expect(got.body).toMatchObject({ kind: "suggestions", readFrom: after, searches: LIST.searches, lens: LIST.lens });
    expect(got.body?.modes).toHaveLength(1);

    const identity = suggestionIdentity("lens", LIST.lens.words);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dismiss(SLUG, { readFrom: after, identity });
    const row = await rowOf(article?.articleId);
    expect(row?.readFrom).toBe(after);
    expect(row?.dismissed).toEqual([identity]);
    /* `created_at` is the row's first creation, not the latest fingerprint;
       `dismissed_at` is the later event (docs/project/sql.md). */
    expect(row?.createdAt).toEqual(first?.createdAt);
    expect(row?.dismissedAt.getTime()).toBeGreaterThan(first?.dismissedAt.getTime() ?? 0);
  });

  it("rejects a delayed dismissal from an old fingerprint without replacing the current row", async () => {
    const before = await fingerprintOf(SLUG);
    await dismiss(SLUG, { readFrom: before, identity: filler(11) });
    await setPurpose(SLUG, "what the control group was given");
    const after = await fingerprintOf(SLUG);
    await dismiss(SLUG, { readFrom: after, identity: filler(12) });
    const current = await rowOf(article?.articleId);

    const stale = await dismiss(SLUG, { readFrom: before, identity: filler(13) });
    expect(stale).toEqual({ status: 409, body: { error: DISMISS_STALE } });
    expect(await rowOf(article?.articleId)).toEqual(current);
  });

  it("keeps the newest fifty, drops the oldest, and does not repeat one dismissed twice", async () => {
    const readFrom = await fingerprintOf(SLUG);
    for (let n = 1; n <= MAX_DISMISSED_SUGGESTIONS + 5; n++) {
      expect((await dismiss(SLUG, { readFrom, identity: filler(n) })).status).toBe(200);
    }
    /* Again, and already there: no second copy, nothing dropped. */
    await dismiss(SLUG, { readFrom, identity: filler(MAX_DISMISSED_SUGGESTIONS + 5) });
    const row = await rowOf(article?.articleId);
    expect(row?.dismissed).toEqual(
      Array.from({ length: MAX_DISMISSED_SUGGESTIONS }, (_, i) => filler(i + 6)),
    );
  });

  it("loses neither of two dismissals made at once", async () => {
    const readFrom = await fingerprintOf(SLUG);
    const many = Array.from({ length: 8 }, (_, i) => filler(1000 + i));
    const answers = await Promise.all(many.map((identity) => dismiss(SLUG, { readFrom, identity })));
    expect(answers.every((a) => a.status === 200)).toBe(true);
    const row = await rowOf(article?.articleId);
    expect([...(row?.dismissed ?? [])].sort()).toEqual([...many].sort());
  });

  it("goes with the article when it is deleted", async () => {
    const doomed = await scratchArticleInPg(DOOMED, { ownerId: TEST_OWNER });
    try {
      await setPurpose(DOOMED, REASON);
      const readFrom = await fingerprintOf(DOOMED);
      expect((await dismiss(DOOMED, { readFrom, identity: filler(7) })).status).toBe(200);
      expect(await rowOf(doomed.articleId)).toBeDefined();
    } finally {
      await doomed.remove();
    }
    expect(await rowOf(doomed.articleId)).toBeUndefined();
  }, 120_000);

  it("the table refuses what the route refuses", async () => {
    const id = article?.articleId ?? "";
    const insert = (readFrom: string, dismissed: string[]) =>
      getDb().insert(commandSuggestionDismissals).values({ articleId: id, readFrom, dismissed });
    await expect(insert("missing data", [filler(1)])).rejects.toThrow();
    await expect(insert(filler(1), ["missing data"])).rejects.toThrow();
    await expect(insert(filler(1), [])).rejects.toThrow();
    await expect(insert(filler(1), [filler(1).toUpperCase().replace(/0/g, "A")])).rejects.toThrow();
    await expect(
      insert(
        filler(1),
        Array.from({ length: MAX_DISMISSED_SUGGESTIONS + 1 }, (_, i) => filler(i)),
      ),
    ).rejects.toThrow();
    await expect(insert(filler(1), [`${filler(1)}\n${filler(2)}`])).rejects.toThrow();
  });
});
