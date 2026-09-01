/**
 * **What `POST /api/chat/:slug` does once `candidates` is a thread kind.**
 *
 * Referee mode's fourth sub-mode is Chat with a third personality, so it adds no
 * route of its own — it adds one value to a field four separate places already
 * validate. Every test here is about one of those places being wrong in a way
 * that produces a 200: a kind refused because a chain of `!==` never heard of
 * it, or a kind *accepted* and then normalised back to `"chat"` on the next
 * read, which is a conversation answered with the wrong system prompt and
 * nothing on screen disagreeing. That is the failure `ThreadKind` exists to
 * prevent, and it is the one this file is for.
 *
 * Harness copied from tests/remember-route.test.ts, including the stubbed
 * `fetch`: everything under test happens before the first model call.
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement.
 *
 * Postgres rather than the filesystem on purpose here: the thing most likely to
 * be missed when a kind is added is the `chat_threads_kind` CHECK constraint,
 * and the filesystem store has no constraint to violate. A suite that ran on
 * files would pass with the migration unapplied.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-candidates-route-fixture";

const { reachable } = await pgReady({
  suite: "tests/candidates-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* A flag that failed to take looks exactly like the suite working: the
       filesystem store answers happily, and the CHECK constraint — the thing
       most likely to be missing — is never touched. */
    expect(STORE).toBe("postgres");
  });
});

let article: ScratchArticle | undefined;
let ANCHOR = "";

beforeAll(async () => {
  if (!reachable) return;
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  ANCHOR = article.blocks[0]?.id ?? "";
  expect(ANCHOR).toMatch(/^spya-/);
});

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

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function post(body: unknown): Promise<{ status: number; body: string }> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${SLUG}`, headers: AUTHED_HEADERS },
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
  return { status: (res as { statusCode: number }).statusCode, body: written };
}

when("a Candidates conversation can be started at all", () => {
  it("stores the kind, through the CHECK constraint and back out of it", async () => {
    /* Four places have to agree for this one assertion to hold: the union, the
       route's validation, `withTurn`'s write, and the Postgres reader's
       normaliser — which coerces anything it does not recognise to `"chat"`.
       Miss the normaliser and this comes back `"chat"` with a 200 in front of
       it and nothing anywhere saying the prompt changed. */
    const id = "spya-cnd2aa";
    const { status } = await post({ threadId: id, question: "who could review this?", kind: "candidates" });
    /* The model call fails (fetch is stubbed), so the stream carries an error
       frame — but the headers went out as a 200 and the rows were written
       before it. The row is what this asserts. */
    expect(status).toBe(200);
    const thread = (await asTestOwner(() => chatStore.load(SLUG))).find((t) => t.id === id);
    expect(thread?.kind).toBe("candidates");
  });

  it("still refuses a kind nobody has heard of", async () => {
    /* The widening must not have turned the check into "anything goes". */
    const { status, body } = await post({ threadId: "spya-cnd2bb", question: "q", kind: "editor" });
    expect(status).toBe(400);
    expect(body).toContain("candidates");
  });

  it("names all three kinds in the refusal, rather than the two it used to", async () => {
    const { body } = await post({ threadId: "spya-cnd2bc", question: "q", kind: "nonsense" });
    for (const kind of ["chat", "remember", "candidates"]) expect(body).toContain(kind);
  });
});

when("what a Candidates turn may not carry", () => {
  it("400s an anchor, because the question is about the whole paper", async () => {
    /* The rule is *only a chat may be anchored*, written that way round so a
       fourth kind is anchor-less by default. An unanchored thread draws no mark
       in the prose, which is what lets the reading view go on treating every
       mark it draws as a chat. */
    const { status, body } = await post({
      threadId: "spya-cnd2cc",
      question: "who could review this?",
      kind: "candidates",
      anchor: { blockId: ANCHOR, quote: "x", start: 0 },
    });
    expect(status).toBe(400);
    expect(body).toContain("cannot be anchored");
  });

  it("400s a stance, which only means anything in Remember", async () => {
    const { status } = await post({
      threadId: "spya-cnd2dd",
      question: "who could review this?",
      kind: "candidates",
      stance: "socratic",
    });
    expect(status).toBe(400);
  });
});

when("a thread's kind belongs to the thread", () => {
  it("409s a send that would turn a Candidates thread into a chat", async () => {
    /* A stale tab is the case: the panel it came from was Referee mode's, and
       the one it is talking to now is not. Refused rather than taken, because
       taking it would answer the rest of the conversation with a different
       system prompt under the same transcript. */
    const id = "spya-cnd2ee";
    await post({ threadId: id, question: "who could review this?", kind: "candidates" });
    const { status } = await post({ threadId: id, question: "and also", kind: "chat" });
    expect(status).toBe(409);
  });
});

describe("the search engine rule 1 depends on", () => {
  /**
   * **Not a config echo — the one setting that makes rule 1 checkable at all.**
   *
   * Candidates may show a name only if the web search returned a URL for it, and
   * the only evidence of that is OpenRouter's `url_citation` annotations. A wire
   * probe on 2026-09-01 sent the same prompt twice, two searches each, with the
   * answer told to reply `DONE` and attribute nothing: the default engine
   * emitted **zero** annotations and `engine: "exa"` emitted **nine**, all of
   * them before the first content token. So a tidy-up that folded these
   * parameters back into one object would not break a feature — it would make
   * the shortlist start deleting good names again, silently, exactly as the
   * first live run did. src/referee-candidates.ts § citedUrls.
   */
  it("asks Exa for a Candidates turn, and caps results rather than pretending to cap searches", async () => {
    const { webSearchTool } = await import("../src/converse.js");
    const tool = webSearchTool("candidates");
    expect(tool.parameters).toMatchObject({ engine: "exa" });
    /* `max_uses` is **not** enforced: the same probe sent `max_uses: 2`, asked
       for six searches, and OpenRouter reported six executed. `max_total_results`
       was honoured to the row. Asking for the one that does nothing would be a
       budget in the code and no budget on the wire. */
    expect(tool.parameters).not.toHaveProperty("max_uses");
    expect(tool.parameters).toHaveProperty("max_total_results");
  });
});
