/**
 * The explain request — src/explain.ts. See docs/project/comments.md.
 *
 * `fetch` is stubbed, so this is deterministic and costs nothing: what is under
 * test is the *shape* of the request we send and how we read the reply, not the
 * model's answer.
 *
 * That shape is worth pinning because getting it wrong is invisible. Both the
 * old `plugins` form and the server tool return an answer with url citations, so
 * the dialog looked right either way while the model had no say in whether it
 * searched — and the search count was read from a field that does not exist, so
 * it was always 0 and the dialog always said "no web search needed".
 * docs/reusable/silent-success.md is about exactly this.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN_TIMEOUT_MS, explain } from "../src/explain.js";
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [
  { id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" },
  { id: "spya-aaaaaa", html: "<p>beta</p>", text: "beta" },
] as Block[];

/** A minimal OpenRouter success, with whatever `usage` the test wants to try. */
function reply(usage: unknown, annotations: unknown[] = []) {
  return {
    ok: true,
    json: async () => ({
      model: "anthropic/claude-sonnet-4.5",
      choices: [{ message: { content: "Because of X.", annotations } }],
      usage,
    }),
  } as unknown as Response;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

const ask = () => explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha" });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the web search is the model's choice", () => {
  it("asks with the server tool, so the model decides whether to search", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await ask();
    const body = bodyOf(fetchMock);
    expect(body.tools).toEqual([
      { type: "openrouter:web_search", parameters: { max_uses: 4, max_results: 5 } },
    ]);
  });

  it("does NOT use the `plugins` form, which searches once whatever the model wants", () => {
    // The regression this file exists for. Greg asked for model-invoked search
    // (comments.md § Decision: the model decides whether to search); the plugin
    // runs one search per request regardless, and looks identical from outside.
    fetchMock.mockResolvedValue(reply({}));
    return ask().then(() => expect(bodyOf(fetchMock).plugins).toBeUndefined());
  });
});

describe("the reported search count", () => {
  // OpenRouter's docs and OpenRouter's responses disagree about the field name,
  // so both are read. This was found by calling the live API on 2026-08-25 and
  // printing `usage`, *after* a review confidently said the docs were right —
  // the count is 0 either way when you guess wrong, and 0 is a number a reader
  // believes. See src/explain.ts § Web research.
  it("reads the field the live API actually sends", async () => {
    fetchMock.mockResolvedValue(reply({ server_tool_use_details: { web_search_requests: 2 } }));
    expect((await ask()).searches).toBe(2);
  });

  it("reads the field the docs describe, in case they ever reconcile", async () => {
    fetchMock.mockResolvedValue(reply({ server_tool_use: { web_search_requests: 3 } }));
    expect((await ask()).searches).toBe(3);
  });

  it("is 0 when the model genuinely did not search", async () => {
    fetchMock.mockResolvedValue(reply({ server_tool_use_details: { web_search_requests: 0 } }));
    expect((await ask()).searches).toBe(0);
  });

  it("is 0, not undefined, when the response carries no usage at all", async () => {
    fetchMock.mockResolvedValue(reply(undefined));
    expect((await ask()).searches).toBe(0);
  });
});

describe("failures are loud", () => {
  it("gives the request a deadline, so a hung model cannot spin for ever", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await ask();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(EXPLAIN_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("explains a timeout in words, rather than passing on `AbortError`", async () => {
    // A real 20ms deadline, because `AbortSignal.timeout` runs off an internal
    // timer that fake timers do not drive — faking them here would hang.
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      // What an aborted fetch actually does: reject once the signal fires.
      return new Promise((_resolve, rejectIt) => {
        init.signal?.addEventListener("abort", () =>
          rejectIt(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
        );
      });
    });
    await expect(
      explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha", timeoutMs: 20 }),
    ).rejects.toThrow(/did not answer within/);
  });

  it("refuses a 200 with no text rather than storing a blank answer", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    } as unknown as Response);
    await expect(ask()).rejects.toThrow(/returned no text/);
  });
});

describe("citations", () => {
  it("keeps one entry per url, however many sentences it grounded", async () => {
    const cite = (url: string, title?: string) => ({ type: "url_citation", url_citation: { url, title } });
    fetchMock.mockResolvedValue(
      reply({}, [cite("https://a.test", "A"), cite("https://a.test", "A"), cite("https://b.test")]),
    );
    expect((await ask()).citations).toEqual([{ url: "https://a.test", title: "A" }, { url: "https://b.test" }]);
  });
});
