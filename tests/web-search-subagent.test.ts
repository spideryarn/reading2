/**
 * **`search_web`, a conversation's search subagent** — src/web-search-subagent.ts,
 * plan docs/plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md.
 *
 * What it promises the model that called it, each of which fails silently if
 * untrue: every link handed back is one the search returned (a mistyped link is
 * a dead one with a confident sentence beside it); a search that did not run is
 * said, not dressed as "nothing found"; the results are fenced; and the
 * reader's query never reaches a log line.
 *
 * Nothing is sent: the gateway is the `call` seam.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/* `LOG_LEVEL` before the imports: src/log.ts reads it once, at load.
   tests/helpers/log-capture.ts § 1. */
const HOISTED = (() => {
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "info";
  return { previousLevel };
})();

const { ProviderRefused } = await import("../src/ai-call.js");
const { modelFor } = await import("../src/models.js");
const { SEARCH_WEB_MAX_QUERY_CHARS, keptResults, searchWeb, searchWebRequest } = await import(
  "../src/web-search-subagent.js"
);
const { GUIDE_TOOLS, SEARCH_WEB_PER_TURN, runTool, toolsFor } = await import("../src/chat-tools.js");
const { converse } = await import("../src/converse.js");
const { logLinesWhile } = await import("./helpers/log-capture.js");
import type { AiRequestBody, JsonCall } from "../src/ai-call.js";
import type { SearchEvidence } from "../src/types.js";

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

const ann = (url: string, title: string, content = "Some page text.") => ({
  type: "url_citation",
  url_citation: { url, title, content },
});

const ONE_SEARCH = { server_tool_use_details: { web_search_requests: 1 } };

function reply(content: string, annotations: unknown[], usage: unknown = ONE_SEARCH): unknown {
  return { choices: [{ finish_reason: "stop", message: { content, annotations } }], usage };
}

function stub(json: unknown) {
  const sent: AiRequestBody[] = [];
  const call = async (body: AiRequestBody): Promise<JsonCall> => {
    sent.push(body);
    return { json, answeredBy: "openai/gpt-luna-test", generationId: null };
  };
  return { sent, call };
}

const A = "https://example.org/a";
const B = "https://en.wikipedia.org/wiki/Ego_depletion_(psychology)";

describe("the request", () => {
  it("is a forced Exa search on the quick tier, billed as its own job", async () => {
    const body = searchWebRequest("ego depletion replications", "standard");
    expect(body.model).toBe(modelFor("web-search-subagent", "standard"));
    expect(body.tool_choice).toBe("required");
    expect(body.tools).toEqual([
      { type: "openrouter:web_search", parameters: { engine: "exa", max_total_results: 5, max_results: 5 } },
    ]);
  });
});

describe("keptResults", () => {
  const found = new Map<string, SearchEvidence>([
    [A, { url: A, title: "The search's title for A" }],
    [B, { url: B, title: "Ego depletion" }],
  ]);

  it("keeps a line only when its link is one the search returned, with the search's title", () => {
    const text = [
      `- [Model's own title](${A}) — It says A.`,
      "- [Stray](https://example.org/a-typo) — A link the search never returned.",
      `- [Wiki](${B}) — Brackets in the address survive.`,
    ].join("\n");
    expect(keptResults(text, found)).toEqual([
      { url: A, title: "The search's title for A", note: "It says A." },
      { url: B, title: "Ego depletion", note: "Brackets in the address survive." },
    ]);
  });

  it("keeps a repeated link once", () => {
    expect(keptResults(`- [x](${A}) — one\n- [x](${A}) — two`, found)).toHaveLength(1);
  });
});

describe("searchWeb", () => {
  it("hands back the kept lines, fenced, and says how to read one where the kind can", async () => {
    const { call } = stub(
      reply(`- [t](${A}) — It says A.\n- [t](https://evil.example/x) — invented.`, [ann(A, "Page A")]),
    );
    const out = await searchWeb("a query", { power: "standard", canReadPages: true, call });
    expect(out.detail).toBe("1 result");
    expect(out.content).toContain("Page A");
    expect(out.content).toContain("It says A.");
    expect(out.content).not.toContain("evil.example");
    expect(out.content).toMatch(/untrusted/i);
    expect(out.content).toContain("read_web_page");
  });

  it("does not mention read_web_page to a conversation that cannot read pages", async () => {
    const { call } = stub(reply(`- [t](${A}) — It says A.`, [ann(A, "Page A")]));
    const out = await searchWeb("a query", { power: "standard", canReadPages: false, call });
    expect(out.content).not.toContain("read_web_page");
  });

  it("falls back to the search's own results when no line survives", async () => {
    const { call } = stub(reply("I could not format this.", [ann(A, "Page A", "What page A says.")]));
    const out = await searchWeb("a query", { power: "standard", canReadPages: false, call });
    expect(out.detail).toBe("1 result");
    expect(out.content).toContain("What page A says.");
  });

  it("says the search did not run when the witness reports none — not 'nothing found'", async () => {
    const { call } = stub(reply(`- [t](${A}) — from memory`, [], { server_tool_use_details: { web_search_requests: 0 } }));
    const out = await searchWeb("a query", { power: "standard", canReadPages: false, call });
    expect(out.detail).toBe("failed");
    expect(out.content).toMatch(/did not run/);
  });

  it("says nothing was found when a search ran and returned nothing", async () => {
    const { call } = stub(reply("Nothing useful found.", []));
    const out = await searchWeb("a query", { power: "standard", canReadPages: false, call });
    expect(out.detail).toBe("nothing found");
  });

  it("turns a provider refusal into a result the model reads", async () => {
    const call = async (): Promise<JsonCall> => {
      throw new ProviderRefused(429, "{}", new Headers(), false);
    };
    const out = await searchWeb("a query", { power: "standard", canReadPages: false, call });
    expect(out.detail).toBe("failed");
  });

  it("refuses an empty or over-long query without calling anything", async () => {
    const { sent, call } = stub(null);
    expect((await searchWeb("  ", { power: "standard", canReadPages: false, call })).detail).toBe("no query");
    const long = "x".repeat(SEARCH_WEB_MAX_QUERY_CHARS + 1);
    expect((await searchWeb(long, { power: "standard", canReadPages: false, call })).detail).toBe("refused");
    expect(sent).toHaveLength(0);
  });

  it("says it was stopped, without throwing, when the turn's signal fired", async () => {
    const stop = new AbortController();
    const call = async (): Promise<JsonCall> => {
      stop.abort();
      throw new DOMException("aborted", "AbortError");
    };
    const out = await searchWeb("a query", { power: "standard", canReadPages: false, call, signal: stop.signal });
    expect(out.detail).toBe("stopped");
  });

  it("logs the outcome and never the query", async () => {
    const { call } = stub(reply(`- [t](${A}) — It says A.`, [ann(A, "Page A")]));
    const logged = await logLinesWhile(async () => {
      await searchWeb("badgers in the shrubbery", { power: "standard", canReadPages: false, call });
    });
    expect(logged).toContain("search_web: done");
    expect(logged).not.toContain("badgers");
  });
});

describe("which conversations have it", () => {
  const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name);

  it("the typed guide does, and Live's list (GUIDE_TOOLS) does not", () => {
    expect(names(toolsFor("guide"))).toContain("search_web");
    expect(names(GUIDE_TOOLS)).not.toContain("search_web");
  });

  it("runTool refuses it for a kind that does not list it", async () => {
    const out = await runTool("search_web", { query: "x" }, {
      slug: "s",
      meta: { title: "t" } as never,
      blocks: [],
      power: "standard",
      kind: "learn",
    });
    expect(out.content).not.toMatch(/untrusted/i);
    expect(out.label).not.toBe("searched the web");
  });
});

/* ------------------------------------------------- the per-turn budget -- */

describe("the per-turn budget", () => {
  it("runs two searches in a turn and refuses a third without calling anything", async () => {
    const ctx = { slug: "s", meta: { title: "t" } as never, blocks: [], power: "standard" as const, kind: "guide" as const };
    /* No gateway is stubbed here: an over-long query is refused before one is
       reached, yet still spends a slot of the budget, so the third's refusal is
       the budget's and not the query check's. */
    const long = "x".repeat(SEARCH_WEB_MAX_QUERY_CHARS + 1);
    for (let i = 0; i < SEARCH_WEB_PER_TURN; i++) {
      expect((await runTool("search_web", { query: long }, ctx)).detail).toBe("refused");
    }
    expect((await runTool("search_web", { query: long }, ctx)).detail).toBe("limit reached");
    /* A new turn is a new context, and starts again. */
    expect((await runTool("search_web", { query: long }, { ...ctx })).detail).toBe("refused");
  });
});

/* ------------------------------------------- converse, the 261011t shape -- */

describe("converse, when the guide searches and offers next steps with no words", () => {
  const frame = (b: unknown) => `data: ${JSON.stringify(b)}\n\n`;
  const stream = (frames: string[]): ReadableStream<Uint8Array> => {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands both results to the next round, which writes the answer from the search", async () => {
    const rounds = [
      [
        frame({
          model: "test/model",
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "toolu_0", type: "function", function: { name: "search_web", arguments: '{"query":"reception"}' } },
                  {
                    index: 1,
                    id: "toolu_1",
                    type: "function",
                    function: { name: "offer_next_steps", arguments: '{"steps":[{"kind":"share"}]}' },
                  },
                ],
              },
            },
          ],
        }),
        frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] }),
      ],
      [
        frame({ model: "test/model", choices: [{ delta: { content: "It was widely discussed." } }] }),
        frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
      ],
    ];
    let n = 0;
    const sent: { messages: { role: string; tool_call_id?: string; content: unknown }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body ?? "{}")));
        return { ok: true, status: 200, headers: new Headers(), body: stream(rounds[n++] ?? []) } as Response;
      }),
    );
    /* `search_web` is answered here, so nothing leaves; everything else is the real dispatcher. */
    const runToolWith: typeof runTool = async (name, args, c) =>
      name === "search_web"
        ? { label: "searched the web", detail: "1 result", content: "1. Page A\n   https://example.org/a\n   It says A." }
        : runTool(name, args, c);
    let text: string | undefined;
    for await (const event of converse({
      power: "standard",
      meta: { title: "A piece", url: "https://example.com/a" } as never,
      blocks: [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as never,
      history: [],
      question: "Is this well regarded?",
      slug: "example",
      kind: "guide",
      saved: { purpose: null, profile: null },
      runToolWith,
    })) {
      if (event.type === "done") text = event.text;
    }
    expect(sent).toHaveLength(2);
    const results = sent[1]!.messages.filter((m) => m.role === "tool");
    expect(results.map((m) => m.tool_call_id)).toEqual(["toolu_0", "toolu_1"]);
    expect(String(results[0]!.content)).toContain("https://example.org/a");
    expect(text).toBe("It was widely discussed.");
  });
});
