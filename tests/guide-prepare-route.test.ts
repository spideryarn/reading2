/**
 * **`POST /api/guide-prepare/<slug>`, through the real route** — plan
 * docs/plans/261019p-guide-chat-plainer.md § Stage 2b.
 *
 * Modelled on tests/guide-route.test.ts. The loaders are mocked so each test
 * says which modes are made, missing or stale; `enqueue` is mocked so nothing
 * is queued and what is asserted is the request it was handed. The claim
 * (`chatStore.claimModePreparation`) is real, against real guide threads in
 * the local Postgres, so the once-a-conversation rule is exercised where it
 * lives: in one conditional UPDATE.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.LOG_LEVEL = "warn";
  return {
    /** Per loader: a value to return, or `null` for not made yet. Unset falls through to "not made". */
    loads: {} as Record<string, unknown>,
    enqueued: [] as unknown[],
  };
});

vi.mock("../src/store/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/index.js")>();
  const { ArtefactNotMadeYet } = await import("../src/store/artefact-not-made-yet.js");
  const fake = (name: string) => async () => {
    const value = state.loads[name];
    if (value === undefined || value === null) throw new ArtefactNotMadeYet(name);
    return value;
  };
  return {
    ...real,
    loadSimpleSummary: fake("simple"),
    loadTweets: fake("tweets"),
    loadGlossary: fake("glossary"),
    loadQuotes: fake("quotes"),
    loadIdeas: fake("ideas"),
    loadQuiz: fake("quiz"),
    loadSkim: fake("skim"),
  };
});

vi.mock("../src/jobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/jobs.js")>();
  return {
    ...real,
    enqueue: async (request: { slug: string; steps?: string[] }) => {
      state.enqueued.push(request);
      return {
        id: "job-1",
        /* Any value: publicJob strips it, and the test asserts that it does. */
        ownerId: "owner-stripped-on-the-way-out",
        slug: request.slug,
        steps: [],
        status: "queued",
        createdAt: new Date().toISOString(),
        profile: "hidden",
      };
    },
  };
});

import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client.js";
import { chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { hashProfile } from "../src/profile.js";
import { profileNoticeKey } from "../src/skim.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-guide-prepare-route-fixture";

await pgReady({
  suite: "tests/guide-prepare-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, readerStore, shelfStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 120_000);

/** The profile the route resolves when "About you" says `A nurse.` and no purpose is set. */
const ABOUT = "A nurse.";
const RENDERED = `About the reader: ${ABOUT}`;

beforeEach(async () => {
  state.loads = {};
  state.enqueued.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(readerStore, "readProfile").mockResolvedValue(ABOUT);
  vi.spyOn(shelfStore, "read").mockResolvedValue({ opens: 0 });
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

async function post(body: unknown): Promise<{ status: number; body: unknown }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/guide-prepare/${SLUG}`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  const chunks: string[] = [];
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
      return this;
    },
    flushHeaders() {},
    on() {},
    write(chunk: unknown) {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) chunks.push(String(chunk));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  const text = chunks.join("");
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: (res as { statusCode: number }).statusCode, body: parsed };
}

/** A stored thread of `kind`, its first turn finished. */
async function thread(kind: "guide" | "chat"): Promise<string> {
  return asTestOwner(async () => {
    const turn = await chatStore.begin(SLUG, { threadId: mintId(), question: "Where do I start?", kind });
    await chatStore.finish(SLUG, turn.thread.id, turn.reply.id, { status: "done", text: "Here." }, { attempt: turn.attempt });
    return turn.thread.id;
  });
}

async function preparedAt(threadId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: chatThreads.modePreparedAt })
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId));
  if (!row) throw new Error(`no thread ${threadId}`);
  return row.at;
}

const enqueued = () => state.enqueued as { slug: string; steps: string[]; force?: string[]; profile?: string }[];

describe("POST /api/guide-prepare", () => {
  it.each(["mode:summary", "mode:sources"])("refuses %s with 400 and queues nothing", async (mode) => {
    const res = await post({ mode });
    expect(res.status).toBe(400);
    expect(enqueued()).toHaveLength(0);
  });

  it("answers ready for a made Glossary and queues nothing", async () => {
    state.loads.glossary = { glossary: { entries: [] } };
    const res = await post({ mode: "mode:glossary" });
    expect(res).toEqual({ status: 200, body: { status: "ready" } });
    expect(enqueued()).toHaveLength(0);
  });

  it("starts a missing Glossary with the reader's profile", async () => {
    const res = await post({ mode: "mode:glossary" });
    expect(res.status).toBe(202);
    const body = res.body as { status: string; job: Record<string, unknown> };
    expect(body.status).toBe("started");
    expect(body.job.id).toBe("job-1");
    /* publicJob strips the profile and owner on the way out. */
    expect(body.job).not.toHaveProperty("profile");
    expect(body.job).not.toHaveProperty("ownerId");
    expect(enqueued()).toEqual([{ slug: SLUG, steps: ["glossary"], profile: RENDERED }]);
  });

  it("starts a missing Glossary with no profile field when the reader has none", async () => {
    vi.spyOn(readerStore, "readProfile").mockResolvedValue(null);
    expect((await post({ mode: "mode:glossary" })).status).toBe(202);
    expect(enqueued()).toEqual([{ slug: SLUG, steps: ["glossary"] }]);
  });

  describe("a missing Skim", () => {
    it("adds Ideas when it is missing and Quotes is made and fresh", async () => {
      state.loads.quotes = { stale: false };
      expect((await post({ mode: "mode:skim" })).status).toBe(202);
      expect(enqueued().map((r) => r.steps)).toEqual([["ideas", "skim"]]);
      expect(enqueued()[0]?.force).toBeUndefined();
    });

    it("adds Quotes when it is stale and Ideas is fresh", async () => {
      state.loads.quotes = { stale: true };
      state.loads.ideas = { stale: false };
      expect((await post({ mode: "mode:skim" })).status).toBe(202);
      expect(enqueued().map((r) => r.steps)).toEqual([["quotes", "skim"]]);
    });

    it("asks for skim alone when both are made and fresh", async () => {
      state.loads.quotes = { stale: false };
      state.loads.ideas = { stale: false };
      expect((await post({ mode: "mode:skim" })).status).toBe(202);
      expect(enqueued().map((r) => r.steps)).toEqual([["skim"]]);
    });
  });

  describe("a made Skim", () => {
    const GENERATED = "2026-10-01T00:00:00.000Z";
    const route = (profileHash: string | null, dismissedFor?: string) => ({
      skim: { profileHash, generatedAt: GENERATED },
      ...(dismissedFor !== undefined ? { profileNoticeDismissedFor: dismissedFor } : {}),
    });

    it("is planned again, skim forced, when it was made for another profile and the notice is not dismissed", async () => {
      state.loads.skim = route(hashProfile("About the reader: someone else"));
      expect((await post({ mode: "mode:skim" })).status).toBe(202);
      expect(enqueued()).toEqual([{ slug: SLUG, steps: ["skim"], force: ["skim"], profile: RENDERED }]);
    });

    it("is left ready when the notice was dismissed for the current profile", async () => {
      state.loads.skim = route(
        hashProfile("About the reader: someone else"),
        profileNoticeKey(GENERATED, hashProfile(RENDERED)),
      );
      expect(await post({ mode: "mode:skim" })).toEqual({ status: 200, body: { status: "ready" } });
      expect(enqueued()).toHaveLength(0);
    });

    it("is planned again when the notice was dismissed for an older profile", async () => {
      state.loads.skim = route(
        hashProfile("About the reader: someone else"),
        profileNoticeKey(GENERATED, hashProfile("About the reader: a third person")),
      );
      expect((await post({ mode: "mode:skim" })).status).toBe(202);
      expect(enqueued().map((r) => r.force)).toEqual([["skim"]]);
    });

    it("is left ready when it was made for this profile", async () => {
      state.loads.skim = route(hashProfile(RENDERED));
      expect(await post({ mode: "mode:skim" })).toEqual({ status: 200, body: { status: "ready" } });
      expect(enqueued()).toHaveLength(0);
    });
  });

  describe("now: true", () => {
    it("claims once per guide conversation: a second claim is 409, a plain press still works", async () => {
      const id = await thread("guide");
      expect(await preparedAt(id)).toBeNull();
      expect((await post({ mode: "mode:glossary", threadId: id, now: true })).status).toBe(202);
      expect(await preparedAt(id)).toBeInstanceOf(Date);
      expect(enqueued()).toHaveLength(1);

      expect((await post({ mode: "mode:quotes", threadId: id, now: true })).status).toBe(409);
      expect(enqueued()).toHaveLength(1);

      expect((await post({ mode: "mode:quotes", threadId: id, now: false })).status).toBe(202);
      expect(enqueued()).toHaveLength(2);
    });

    it("claims even when the mode is already made, and answers ready", async () => {
      const id = await thread("guide");
      state.loads.glossary = { glossary: { entries: [] } };
      expect(await post({ mode: "mode:glossary", threadId: id, now: true })).toEqual({
        status: 200,
        body: { status: "ready" },
      });
      expect(await preparedAt(id)).toBeInstanceOf(Date);
      expect((await post({ mode: "mode:glossary", threadId: id, now: true })).status).toBe(409);
    });

    it("refuses an ordinary chat thread with 409", async () => {
      const id = await thread("chat");
      expect((await post({ mode: "mode:glossary", threadId: id, now: true })).status).toBe(409);
      expect(enqueued()).toHaveLength(0);
      expect(await preparedAt(id)).toBeNull();
    });

    it("refuses a thread that does not exist with 409", async () => {
      expect((await post({ mode: "mode:glossary", threadId: mintId(), now: true })).status).toBe(409);
      expect(enqueued()).toHaveLength(0);
    });

    it("needs a threadId: 400 without one", async () => {
      expect((await post({ mode: "mode:glossary", now: true })).status).toBe(400);
      expect(enqueued()).toHaveLength(0);
    });

    it("lets exactly one of two concurrent presses through", async () => {
      const id = await thread("guide");
      const results = await Promise.all([
        post({ mode: "mode:glossary", threadId: id, now: true }),
        post({ mode: "mode:glossary", threadId: id, now: true }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([202, 409]);
      expect(enqueued()).toHaveLength(1);
    });
  });
});
