/**
 * **`POST /api/chat/:slug/:threadId/live` — the ticket, and the two things that
 * travel with it.**
 *
 * The token is the least interesting part of this route. What matters is that
 * the browser is handed the conversation's history *and* the id of the row that
 * is currently last, **from one read**, because those two are what the whole
 * seeding barrier is built on:
 *
 *  - the seed is what stops the session answering the first question with
 *    amnesia about the last five minutes;
 *  - the tail is what the first spoken exchange claims, and a tail read
 *    separately from the history it belongs to is a claim about a conversation
 *    that never existed.
 *
 * And the ids come **out** of the seeded assistant text, which is the subtle
 * one: written chat cites by putting `[spya-k3m9qt]` in the answer, so seeding a
 * *voice* model verbatim hands it examples of its own past speech containing
 * block ids while its instructions forbid saying one aloud. Found by Fable;
 * docs/plans/260831l-live-conversation-in-chat.md § 1d.
 *
 * `fetch` is stubbed, so nothing here reaches OpenAI and no key is needed.
 *
 * ## It ran on the filesystem store until 2026-09-04
 *
 * The conversation the ticket seeds from used to be a `chat.json` under a
 * throwaway `data/<slug>/`, so the claim in this file's own title — *the
 * history and the id of the row that is currently last, from one read* — was
 * being made about a JSON array, against the store that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). Under Postgres *last* is a fact about `chat_messages.ordinal`, resolved
 * by a second query and an `orderBy` — so **the tail can now be wrong**, which
 * is the whole reason the sentence is worth asserting. On files it could not
 * be: the messages come back in the order they were written into the object.
 *
 * The other half the move buys is silent until you look for it: the ticket
 * writes a `realtime_sessions` row **before** the token leaves this server, and
 * on the filesystem store that journal is a file nobody in production reads.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. Copied
 * from tests/candidates-route.test.ts, which explains the shape.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { LIVE_MODEL } from "../src/live.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** A throwaway slug, so the conversations written below belong to nobody. */
const SLUG = "test-chat-live-ticket";

const { reachable } = await pgReady({
  suite: "tests/chat-live-ticket-route.test.ts",
  tables: [
    "spideryarn.chat_threads",
    "spideryarn.chat_messages",
    "spideryarn.realtime_sessions",
    "spideryarn.revision_blocks",
  ],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Not gated on the database being up, deliberately: a control that vanishes
       when Postgres is missing vanishes exactly when it matters. A flag that
       failed to take looks precisely like this suite working — the filesystem
       chat store hands back its messages in array order, so `tailId` is right
       there however the ordering is done. */
    expect(STORE).toBe("postgres");
  });
});

let article: ScratchArticle | undefined;

beforeAll(async () => {
  if (!reachable) return;
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner. An article seeded as
     anybody else is invisible and every route below answers 404, which looks
     exactly like a broken route — `ScratchOptions.ownerId`. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 60_000);

/**
 * Conversations, and nothing a previous case wrote beside them.
 *
 * Where the filesystem version re-copied `example/` into `data/<slug>/` after
 * every case, which threw the chat file away along with it. Deleting the
 * threads and keeping the article is the same reset: nothing here writes to the
 * article, and a published revision is not editable anyway. The
 * `realtime_sessions` rows the ticket journals go with the article at the end.
 */
beforeEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/** What OpenAI was asked to create, so a test can read the session back. */
let minted: Record<string, unknown> | null = null;
const realKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  minted = null;
  process.env.OPENAI_API_KEY = "sk-test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      minted = JSON.parse(String(init.body)) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: "ek_test",
          expires_at: 123,
          session: { model: LIVE_MODEL },
        }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (realKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = realKey;
});

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: path, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status: res.statusCode, body: (written ? JSON.parse(written) : {}) as Record<string, unknown> };
}

const ticket = (threadId: string, body: unknown = {}) =>
  post(`/api/chat/${SLUG}/${threadId}/live`, body);

/** Put one spoken exchange in the thread, so there is history to seed from. */
const speak = (threadId: string, body: Record<string, unknown>) =>
  post(`/api/chat/${SLUG}/${threadId}/spoken`, body);

when("the ticket", () => {
  it("hands back a key, and never the prompt", async () => {
    /* A client that is handed the instructions is a client that can be talked
       into sending different ones. The created session already holds all of it.
       src/live.ts § mintLiveToken. */
    const out = await ticket("spya-vaaaaa");
    expect(out.status).toBe(200);
    expect(out.body.token).toBe("ek_test");
    expect(JSON.stringify(out.body)).not.toContain("THE ARTICLE");
    expect(out.body).not.toHaveProperty("instructions");
  });

  it("says the conversation is empty when it is", async () => {
    const out = await ticket("spya-vaaaab");
    expect(out.body.seed).toEqual([]);
    /* `null`, not absent: "I believe this conversation is empty" is the claim
       the first append makes, and it has to be a claim rather than a shrug. */
    expect(out.body).toHaveProperty("tailId", null);
  });

  it("seeds from the thread, and names the row that is last", async () => {
    const first = await speak("spya-vaaaac", {
      question: "Why does he reject it?",
      answer: "Because it does not compute.",
      expectedTailId: null,
    });
    const thread = first.body.thread as { id: string; messages: { id: string }[] };

    const out = await ticket(thread.id);
    expect(out.body.seed).toEqual([
      { role: "user", text: "Why does he reject it?" },
      { role: "assistant", text: "Because it does not compute." },
    ]);
    expect(out.body.tailId, "the tail did not come from the same read as the seed").toBe(
      thread.messages.at(-1)?.id,
    );
  });

  it("takes the block ids OUT of what the model is shown of its own speech", async () => {
    /* The nasty one. A typed answer cites by writing `[spya-k3m9qt]` inline, so
       seeding verbatim gives the voice model examples of *itself* saying an id
       aloud — while its instructions forbid exactly that. The symptom would be a
       companion that starts spelling ids out with no apparent cause. */
    const first = await speak("spya-vaaaad", {
      question: "Where does he say that?",
      answer: "He says it in the third paragraph [spya-aaa222], plainly.",
      expectedTailId: null,
    });
    const thread = first.body.thread as { id: string };

    const out = await ticket(thread.id);
    const seed = out.body.seed as { role: string; text: string }[];
    const assistant = seed.find((s) => s.role === "assistant");
    expect(assistant?.text, "a block id was seeded into the voice model").not.toContain("spya-");
    expect(assistant?.text).toContain("third paragraph");
    /* The reader's own words are untouched — if they said something id-shaped,
       that is theirs and not ours to edit. */
    expect(seed.find((s) => s.role === "user")?.text).toBe("Where does he say that?");
  });
});

when("the tool a live session may ask us to run", () => {
  /* **The one route where the browser names the tool.** In typed chat the name
     comes off the model's own output on this server; here the model is talking
     to the browser, so the call arrives second-hand. That is one step further
     out, which is why the name is checked against a list rather than handed to
     `runTool` — which answers an unknown name with a friendly sentence listing
     the others, the right reply to a confused model and the wrong one to a
     caller that is not one. */
  const tool = (body: unknown) => post(`/api/chat/${SLUG}/live-tool`, body);

  it("runs one of the article's own searches", async () => {
    const out = await tool({ name: "search_article_words", args: { query: "the" } });
    expect(out.status).toBe(200);
    expect(typeof out.body.content).toBe("string");
    expect(typeof out.body.label).toBe("string");
  });

  it("refuses show_passage, which belongs in the browser", async () => {
    /* It is answered in the frame it arrives in, and that is the whole reason
       it exists — everything else makes a talking companion go quiet while it
       waits. A server that would run it is a second implementation of the one
       tool that must never leave the page. */
    const out = await tool({ name: "show_passage", args: { blockIds: ["spya-aaa222"] } });
    expect(out.status).toBe(400);
  });

  it("refuses a name that is not a tool at all", async () => {
    const out = await tool({ name: "rm_rf", args: {} });
    expect(out.status).toBe(400);
    /* And says nothing about what the others are called. `runTool`'s helpful
       list is for a model that got it wrong, not for a caller probing. */
    expect(JSON.stringify(out.body)).not.toContain("search_article_words");
  });

  it("refuses a body with no name in it", async () => {
    expect((await tool({ args: {} })).status).toBe(400);
  });
});

when("what the session is created with", () => {
  it("maps the reader's placement onto the field OpenAI takes", async () => {
    /* `near_field` / `far_field` runs before the voice-activity detector, so it
       decides how often a room is treated as somebody talking — which is the
       bug Greg reported. The two ends declare `MicPlacement` once, in types.ts,
       and this is the mapping between it and the API's own two words. */
    await ticket("spya-vaaaae", { placement: "headset" });
    const audio = (minted?.session as Record<string, Record<string, Record<string, unknown>>>)
      ?.audio;
    expect(audio?.input?.noise_reduction).toEqual({ type: "near_field" });

    await ticket("spya-vaaaae", { placement: "laptop" });
    const again = (minted?.session as Record<string, Record<string, Record<string, unknown>>>)
      ?.audio;
    expect(again?.input?.noise_reduction).toEqual({ type: "far_field" });
  });

  it("refuses a placement that is not one of ours", async () => {
    /* Validated, never cast. A string off the wire becoming a `Record` lookup
       that answers `undefined` would spread into the session as a missing field
       and turn noise reduction off without a word. */
    const out = await ticket("spya-vaaaaf", { placement: "wibble" });
    expect(out.status).toBe(400);
  });
});
