/**
 * **Chat and Explain count the block references they show a reader.**
 * docs/plans/260928c-block-refs-shown-to-readers.md § The fix, layer 3.
 *
 * The prompt rule is the fix; this is how anyone finds out whether it worked.
 * A model that answers "in block 39" must put `blockRefLeaks: 1` on the one
 * line each answer logs, and a clean answer `0` — the second half is what
 * tells a working counter from a field that is always zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const infos: Record<string, unknown>[] = [];

vi.mock("../src/log.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/log.js")>();
  const fake = (): unknown => ({
    info: (fields: unknown) => {
      if (fields && typeof fields === "object") infos.push(fields as Record<string, unknown>);
    },
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => fake(),
  });
  return { ...real, log: () => fake() };
});

const { converse } = await import("../src/converse.js");
const { explainStream } = await import("../src/explain.js");
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [
  { id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" },
  { id: "spya-aaaaaa", html: "<p>beta</p>", text: "beta" },
] as Block[];

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** A fetch whose every call streams `text` and stops. */
function says(text: string) {
  return vi.fn(() => {
    const bytes = new TextEncoder().encode(
      frame({ model: "test/model", choices: [{ delta: { content: text } }] }) +
        frame({ choices: [{ finish_reason: "stop", delta: {} }] }) +
        "data: [DONE]\n\n",
    );
    return Promise.resolve({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    } as unknown as Response);
  });
}

/** The count on the line that carries it, which must exist. */
function logged(): unknown {
  const line = infos.find((f) => "blockRefLeaks" in f);
  if (!line) throw new Error(`no log line carried blockRefLeaks: ${JSON.stringify(infos)}`);
  return line.blockRefLeaks;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  infos.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

async function chat() {
  for await (const _ of converse({
    meta,
    blocks,
    history: [],
    question: "why?",
    slug: "example",
    signal: new AbortController().signal,
  })) {
    // drain
  }
}

async function explained() {
  for await (const _ of explainStream({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha" })) {
    // drain
  }
}

describe("the finished-answer line counts leaked block references", () => {
  it("chat: one leak", async () => {
    vi.stubGlobal("fetch", says("You can see it again later, in block 39 [spya-k3m9qt]."));
    await chat();
    expect(logged()).toBe(1);
  });

  it("chat: none", async () => {
    vi.stubGlobal("fetch", says("He says so where he defines alpha [spya-k3m9qt]."));
    await chat();
    expect(logged()).toBe(0);
  });

  it("explain: one leak", async () => {
    vi.stubGlobal("fetch", says("Block spya-aaaaaa then defines beta."));
    await explained();
    expect(logged()).toBe(1);
  });

  it("explain: none", async () => {
    vi.stubGlobal("fetch", says("It is defined in the next paragraph."));
    await explained();
    expect(logged()).toBe(0);
  });
});
