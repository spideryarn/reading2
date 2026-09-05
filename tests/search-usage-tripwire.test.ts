/**
 * **The alarm that could not go off.**
 *
 * `searchesFrom` exists for one reason, and src/explain.ts says it in its own
 * header: OpenRouter has renamed the web-search count field once already, a
 * missing field reads as `0`, and *"no web search needed"* is a thing readers
 * legitimately see — so a broken count looks exactly like a model that was sure.
 * The value that means *it broke* is `"neither"`: usage arrived, and neither
 * spelling of the field was in it.
 *
 * `"neither"` had never been logged, and could not be. `from` was initialised
 * to `"no-usage"` and assigned only inside `if (counted.searches !== null)` —
 * and `whereSearchCountCameFrom` returns `searches: null` in exactly the case
 * where `from` is `"neither"`. So the one branch that reports the alarm was the
 * one branch that skipped the assignment. Production logged
 * `searchesFrom: "no-usage"` beside populated token counts from the same
 * `usage` object, which is the alarm already lying about which fault it saw.
 *
 * This is [silent success](../docs/reusable/silent-success.md) in its purest
 * form — a check nobody had ever seen fail, guarding a check nobody had ever
 * seen fail — so the test is written to be able to see it fail.
 *
 * ## Why it reads the log rather than a return value
 *
 * `searchesFrom` is not on `explain`'s result and should not be: it is an
 * operator's field, not a reader's. So the logger is replaced, and the object
 * the info line was called with is the evidence. src/log.ts is `silent` under
 * `NODE_ENV=test`, which is why asserting on real output would pass against a
 * logger that emits nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lines: Record<string, unknown>[] = [];

vi.mock("../src/log.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/log.js")>();
  const capture = {
    debug() {},
    info(fields: unknown) {
      if (fields && typeof fields === "object") lines.push(fields as Record<string, unknown>);
    },
    warn() {},
    error() {},
    child() {
      return capture;
    },
  };
  return { ...actual, log: () => capture };
});

const { explain } = await import("../src/explain.js");
const { whereSearchCountCameFrom } = await import("../src/openrouter-stream.js");

import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

function sse(raw: string): Response {
  const bytes = new TextEncoder().encode(raw);
  let done = false;
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (done) return c.close();
        done = true;
        c.enqueue(bytes);
      },
    }),
  } as unknown as Response;
}

/** A finished answer whose final chunk carries whatever `usage` is given. */
const reply = (usage: unknown) =>
  sse(
    frame({
      model: "anthropic/claude-sonnet-4.5",
      choices: [{ delta: { content: "Because of X." } }],
    }) +
      frame({ choices: [{ finish_reason: "stop", delta: {} }], ...(usage ? { usage } : {}) }) +
      "data: [DONE]\n\n",
  );

const ask = () => explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha" });

/** The one success line explain writes — the only one carrying `searchesFrom`. */
const searchesFrom = () => lines.find((l) => "searchesFrom" in l)?.searchesFrom;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  lines.length = 0;
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("whereSearchCountCameFrom already tells the two faults apart", () => {
  it("says `neither` for a usage object missing both spellings", () => {
    /* The helper has always been right. The bug was one level up, in the caller
       that threw the answer away — which is why this case passing proves
       nothing on its own and the ones below are the real test. */
    expect(whereSearchCountCameFrom({ prompt_tokens: 900 }).from).toBe("neither");
    expect(whereSearchCountCameFrom(undefined).from).toBe("no-usage");
  });
});

describe("explain logs which fault it actually saw", () => {
  it("logs `neither` when usage arrived without either search field", async () => {
    /* Real token counts, no search count: exactly what a third rename by
       OpenRouter would look like from here, and exactly the shape production
       was printing `no-usage` for. */
    fetchMock.mockResolvedValue(reply({ prompt_tokens: 900, completion_tokens: 40 }));
    await ask();
    expect(
      searchesFrom(),
      "`neither` is the alarm, and it could not fire: `from` was only assigned on the " +
        "branch where a count WAS found. src/explain.ts § the usage loop.",
    ).toBe("neither");
  });

  it("still logs `no-usage` when the response carried no accounting at all", async () => {
    fetchMock.mockResolvedValue(reply(undefined));
    expect(searchesFrom()).toBeUndefined();
    await ask();
    expect(searchesFrom()).toBe("no-usage");
  });

  it("still names the field it read when there was one", async () => {
    fetchMock.mockResolvedValue(
      reply({ prompt_tokens: 900, server_tool_use_details: { web_search_requests: 2 } }),
    );
    await ask();
    expect(searchesFrom()).toBe("server_tool_use_details");
  });
});
