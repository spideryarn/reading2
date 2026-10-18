/**
 * **What a guide turn sends, through the real route** —
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md, Stage 1.
 *
 * Modelled on tests/explore-digest-route.test.ts: `fetch` is stubbed to keep
 * the body it was handed and then fail, so nothing reaches a model and what is
 * asserted is the bytes a model would have been sent. The pure half — where the
 * line lands, the mode words, the tool list — is tests/guide-kind.test.ts.
 *
 * Asserted here: the experience line is resolved per turn from the **stored**
 * thread's kind and lands in the final message only; a failed count costs the
 * line and not the turn, and says so in the log without a count; a guide turn
 * is offered no OpenRouter search and, but for search_web, no tool that leaves
 * the article; and a guide
 * refuses `visible`, as every non-chat kind does.
 *
 * Plan 261008a read which modes were already made on every guide turn; plan
 * 261011m removed that, and the last describe below holds it removed.
 * `loadGlossary` and `loadSimpleSummary` are the real ones unless a test sets
 * `storedReads`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const storedReads = vi.hoisted(() => {
  /* Raised before src/log.ts loads, or the failed-count line is never written.
     tests/helpers/log-capture.ts. */
  process.env.LOG_LEVEL = "warn";
  return {
    glossary: null as null | (() => Promise<unknown>),
    simple: null as null | (() => Promise<unknown>),
  };
});

vi.mock("../src/store/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/index.js")>();
  return {
    ...real,
    loadGlossary: (slug: string) => (storedReads.glossary ? storedReads.glossary() : real.loadGlossary(slug)),
    loadSimpleSummary: (slug: string) => (storedReads.simple ? storedReads.simple() : real.loadSimpleSummary(slug)),
  };
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-guide-route-fixture";
const LINE = "HOW MUCH THEY HAVE USED SPIDERYARN:";

await pgReady({
  suite: "tests/guide-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, readerStore, shelfStore } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  written.length = 0;
  answerWith = null;
  replies = [];
  storedReads.glossary = null;
  storedReads.simple = null;
  vi.restoreAllMocks();
  await asTestOwner(async () => {
    for (const thread of await chatStore.load(SLUG)) await chatStore.remove(SLUG, thread.id);
  });
});

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

interface Sent {
  messages: { role: string; content: unknown }[];
  tools?: { type: string; function?: { name: string } }[];
  tool_choice?: unknown;
  response_format?: { json_schema?: { name?: unknown } };
}
const sent: Sent[] = [];
/** What the route wrote back, for the `done` frame. */
const written: string[] = [];
/** When set, the model answers with these words and finishes, instead of failing. */
let answerWith: string | null = null;
/** When set, each model request takes the next of these, before `answerWith`. */
let replies: Response[] = [];

function finishedBody(words: string): Response {
  const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
  const body =
    chunk({ model: "test/model", choices: [{ delta: { content: words } }] }) +
    chunk({ model: "test/model", choices: [{ delta: {}, finish_reason: "stop" }] }) +
    "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = ((_url: unknown, init?: { body?: unknown }) => {
    try {
      const body = JSON.parse(String(init?.body ?? "null")) as Sent | null;
      if (body?.response_format?.json_schema?.name === "conversation_gist") {
        return Promise.resolve(
          Response.json({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ gist: "A short answer" }) } }],
          }),
        );
      }
      if (body && Array.isArray(body.messages)) sent.push(body);
    } catch {
      /* not a model request */
    }
    const next = replies.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (answerWith !== null) return Promise.resolve(finishedBody(answerWith));
    return Promise.reject(new Error("no model in tests"));
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function post(body: unknown): Promise<number> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: `/api/chat/${SLUG}`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    on() {},
    write(chunk: unknown) {
      written.push(String(chunk));
      return true;
    },
    end() {
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return (res as { statusCode: number }).statusCode;
}

const text = (content: unknown): string => (typeof content === "string" ? content : JSON.stringify(content));

function lastRequest() {
  const request = sent.at(-1);
  if (!request) throw new Error("no model request went out");
  const messages = request.messages;
  return {
    head: messages.slice(0, 2).map((m) => text(m.content)).join("\n"),
    middle: messages.slice(2, -1).map((m) => text(m.content)).join("\n"),
    final: text(messages.at(-1)?.content),
    tools: (request.tools ?? []).map((t) => t.function?.name ?? t.type),
  };
}

describe("a guide turn", () => {
  it("carries how much the reader has used Spideryarn, in the final message only", async () => {
    const count = vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(0);
    expect(await post({ threadId: "spya-gdrta2", question: "Where do I start?", kind: "guide" })).toBe(200);
    expect(count).toHaveBeenCalledWith(SLUG);
    const { head, middle, final } = lastRequest();
    expect(final).toContain(`${LINE} they have opened no other article still on their shelf.`);
    expect(final.indexOf(LINE)).toBeLessThan(final.lastIndexOf("Where do I start?"));
    expect(head).not.toContain(LINE);
    expect(middle).not.toContain(LINE);
    /* The guide's prompt, not chat's. */
    expect(head).toContain("WHAT SPIDERYARN CAN SHOW THEM");
  });

  it("resolves it again on a later turn, from the stored thread's kind", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(0);
    await post({ threadId: "spya-gdrtb2", question: "first", kind: "guide" });
    const first = lastRequest().head;
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(12);
    /* No kind on the request: the stored thread decides. */
    expect(await post({ threadId: "spya-gdrtb2", question: "second" })).toBe(200);
    const { head, final } = lastRequest();
    expect(final).toContain(`${LINE} they have opened many other articles`);
    /* The cached prefix did not move when the bucket did. */
    expect(head).toBe(first);
  });

  it("is offered no OpenRouter search and no tool that leaves the article but search_web and read_web_page", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
    await post({ threadId: "spya-gdrtc2", question: "What should I read closely?", kind: "guide" });
    const { tools } = lastRequest();
    expect(tools).toEqual([
      "search_article_words",
      "search_article_meaning",
      "article_links",
      "article_glossary",
      "article_citations",
      /* A web search whose results come back as a tool message (plan 261012g). */
      "search_web",
      /* One page a turn, with Chat's checks: Greg's reply B to q-g492eq
         (plan 261017e § Stage 2). */
      "read_web_page",
      /* Its own, and it saves nothing (plan 261009q). */
      "offer_to_save",
      /* And its next steps, which run nothing (plan 261009u). */
      "offer_next_steps",
    ]);
    expect(JSON.stringify(sent.at(-1)?.tools)).not.toContain("web_search");
  });

  it("stores an offer to save with what the reason held when the turn read it", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
    const profileRead = vi.spyOn(readerStore, "readProfile");
    const call = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    replies = [
      new Response(
        call({
          model: "test/model",
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "toolu_0",
                    type: "function",
                    function: {
                      name: "offer_to_save",
                      arguments: JSON.stringify({ field: "reason", text: "For my journal club." }),
                    },
                  },
                ],
              },
            },
          ],
        }) +
          call({ model: "test/model", choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
          "data: [DONE]\n\n",
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
      finishedBody("Start with the abstract."),
    ];
    expect(await post({ threadId: "spya-gdrtf2", question: "For my journal club.", kind: "guide" })).toBe(200);
    const stored = await asTestOwner(() => chatStore.load(SLUG));
    const answer = stored.find((t) => t.id === "spya-gdrtf2")?.messages.at(-1);
    expect(answer?.tools?.[0]?.offer).toEqual({ field: "purpose", text: "For my journal club.", basis: null });
    expect(profileRead).toHaveBeenCalledTimes(1);
  });

  it("does not read the profile or make an unbased offer when profile use is off", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
    const profileRead = vi.spyOn(readerStore, "readProfile");
    const call = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    replies = [
      new Response(
        call({
          model: "test/model",
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "toolu_0",
                    type: "function",
                    function: {
                      name: "offer_to_save",
                      arguments: JSON.stringify({ field: "reason", text: "For my journal club." }),
                    },
                  },
                ],
              },
            },
          ],
        }) +
          call({ model: "test/model", choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
          "data: [DONE]\n\n",
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
      finishedBody("Start with the abstract."),
    ];
    expect(
      await post({
        threadId: "spya-gdrtg2",
        question: "For my journal club.",
        kind: "guide",
        useProfile: false,
      }),
    ).toBe(200);
    expect(profileRead).not.toHaveBeenCalled();
    const stored = await asTestOwner(() => chatStore.load(SLUG));
    const answer = stored.find((t) => t.id === "spya-gdrtg2")?.messages.at(-1);
    expect(answer?.tools?.[0]?.detail).toBe("not offered");
    expect(answer?.tools?.[0]?.offer).toBeUndefined();
  });

  /* Plan 261011s: the request's `typed: true` is what lets an offer save
     without a press, so it reaches the tool only on a new guide question. */
  describe("typed", () => {
    const offering = (text: string): Response[] => {
      const call = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
      return [
        new Response(
          call({
            model: "test/model",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "toolu_0",
                      type: "function",
                      function: { name: "offer_to_save", arguments: JSON.stringify({ field: "reason", text }) },
                    },
                  ],
                },
              },
            ],
          }) +
            call({ model: "test/model", choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
            "data: [DONE]\n\n",
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
        finishedBody("Saved; start with the abstract."),
      ];
    };
    const offerOn = async (threadId: string) =>
      (await asTestOwner(() => chatStore.load(SLUG))).find((t) => t.id === threadId)?.messages.at(-1)?.tools?.[0]?.offer;

    it("marks an offer from a typed question to save at once", async () => {
      vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
      replies = offering("For my journal club.");
      expect(await post({ threadId: "spya-gdrtt2", question: "it is for my journal club", kind: "guide", typed: true })).toBe(200);
      expect(await offerOn("spya-gdrtt2")).toEqual({ field: "purpose", text: "For my journal club.", basis: null, now: true, route: "exact" });
    });

    it("leaves the same offer to the press when the question was not typed", async () => {
      vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
      replies = offering("For my journal club.");
      expect(await post({ threadId: "spya-gdrtu2", question: "it is for my journal club", kind: "guide" })).toBe(200);
      expect(await offerOn("spya-gdrtu2")).toEqual({ field: "purpose", text: "For my journal club.", basis: null });
    });

    it.each([
      ["a value other than true", { typed: "yes" }],
      ["false", { typed: false }],
      ["a retry", { typed: true, retry: "spya-gdrtq9" }],
      ["an edit", { typed: true, edit: "spya-gdrtq9" }],
      ["a non-guide question", { typed: true, kind: "chat" }],
    ])("is refused on %s, before any model call", async (_what, extra) => {
      expect(await post({ threadId: "spya-gdrtv2", question: "for my journal club", kind: "guide", ...extra })).toBe(400);
      expect(sent).toHaveLength(0);
    });
  });

  it("refuses visible blocks before any model call", async () => {
    const id = article?.blocks[0]?.id;
    expect(await post({ threadId: "spya-gdrtd2", question: "this bit", kind: "guide", visible: [id] })).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("still answers when the count cannot be read, without the line, and logs no count", async () => {
    const count = vi
      .spyOn(shelfStore, "articlesOpenedBefore")
      .mockRejectedValueOnce(Object.assign(new Error("connection dropped"), { status: 503 }));
    let status = 0;
    const lines = await logLinesWhile(async () => {
      status = await post({ threadId: "spya-gdrte2", question: "carry on anyway", kind: "guide" });
    });
    expect(status).toBe(200);
    expect(count).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const { final } = lastRequest();
    expect(final).toContain("carry on anyway");
    expect(final).not.toContain(LINE);
    /* The control: the warning was written, so an empty capture is not what passed. */
    expect(lines).toContain("guide: could not read how many articles the reader has opened");
    expect(lines).toContain('"status":503');
    expect(lines).not.toContain("connection dropped");
  });
});

describe("a turn of any other kind", () => {
  it.each(["chat", "learn", "tutorial", "explore", "candidates"] as const)(
    "%s neither asks for the count nor carries the line",
    async (kind) => {
      const count = vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(0);
      expect(await post({ threadId: mintId(), question: "what about this", kind })).toBe(200);
      expect(sent).toHaveLength(1);
      expect(count).not.toHaveBeenCalled();
      expect(JSON.stringify(sent.at(-1))).not.toContain(LINE);
    },
  );
});

/* Plan 261011m: the guide opens nothing itself, so the route no longer reads
   which modes are already made (plan 261008a's `guideMade`), tells the model,
   or puts `opensFree` on the `done` frame. */
describe("a guide turn reads nothing about which modes are made", () => {
  const doneFrame = (): Record<string, unknown> => {
    const frame = written.find((w) => w.startsWith("event: done\n"));
    if (frame === undefined) throw new Error(`no done frame in ${written.length} writes`);
    return JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as Record<string, unknown>;
  };

  it("neither reads the stored Glossary nor tells the model or the page about it", async () => {
    vi.spyOn(shelfStore, "articlesOpenedBefore").mockResolvedValue(3);
    const glossary = vi.fn(async () => ({ glossary: { entries: [] } }));
    storedReads.glossary = glossary;
    answerWith = "Glossary would list the terms. Press it to open it.";
    expect(await post({ threadId: "spya-gdrtm2", question: "Which terms matter?", kind: "guide" })).toBe(200);
    expect(glossary).not.toHaveBeenCalled();
    expect(lastRequest().final).not.toContain("ALREADY MADE");
    const done = doneFrame();
    expect(done.text, "the control: this is the answer's done frame").toBe(answerWith);
    expect(done).not.toHaveProperty("opensFree");
  });
});
