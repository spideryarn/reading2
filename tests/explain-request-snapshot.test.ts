/**
 * **The whole explain request, pinned byte for byte** — the job name and the
 * body `explainStream` hands `openRouterStream`, for an ordinary call, a deep
 * one and a profiled one.
 *
 * Written before the stream runner was pulled out of src/explain.ts
 * (docs/plans/260930a-citations-investigate-one-work-on-demand.md § Mechanism),
 * and the reason is money rather than correctness: comments and the glossary
 * both ride on explain's cached prefix, and a request that changed by one byte
 * — a reordered key, a tool definition rebuilt with a different shape — still
 * answers perfectly well. The only symptom would be a second cache write of the
 * whole article on every call. docs/project/prompt-caching.md.
 *
 * **Two pins per case, on purpose.** The snapshot file gives a readable diff of
 * what moved; the inline hash is what makes a deleted or regenerated snapshot
 * unable to pass quietly, because vitest writes a missing snapshot rather than
 * failing on it. If you changed the request deliberately, update both, and say
 * why in the commit.
 *
 * Captured at the `openRouterStream` seam by wrapping the real function — the
 * same partial `vi.mock` of src/ai-call.ts the stream-lifetime tests use — so
 * the job name is observed directly rather than inferred from a URL. `fetch` is
 * stubbed underneath, as in tests/explain.test.ts, so nothing is sent.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explain } from "../src/explain.js";
import type { Block, Meta } from "../src/types.js";

const seen = vi.hoisted(() => ({ calls: [] as Array<{ job: unknown; body: unknown }> }));

vi.mock("../src/ai-call.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ai-call.js")>();
  return {
    ...real,
    openRouterStream(...args: Parameters<typeof real.openRouterStream>) {
      seen.calls.push({ job: args[0], body: args[1] });
      return real.openRouterStream(...args);
    },
  };
});

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [
  { id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" },
  { id: "spya-aaaaaa", html: "<p>beta</p>", text: "beta" },
] as Block[];

/** A model named here, so the snapshot does not move with src/models.ts or the environment. */
const MODEL = "anthropic/claude-snapshot-test";

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

function finished(): Response {
  const bytes = new TextEncoder().encode(
    frame({ model: MODEL, choices: [{ delta: { content: "Because of X." } }] }) +
      frame({ choices: [{ finish_reason: "stop", delta: {} }], usage: {} }) +
      "data: [DONE]\n\n",
  );
  let sent = false;
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) c.close();
        else {
          sent = true;
          c.enqueue(bytes);
        }
      },
    }),
  } as unknown as Response;
}

/** The request as `openRouterStream` received it, serialised the way `outgoing` will serialise it. */
async function requestFor(extra: { deep?: boolean; profile?: string }): Promise<string> {
  await explain({ power: "standard", meta, blocks, blockId: "spya-k3m9qt", quote: "alpha", model: MODEL, ...extra });
  expect(seen.calls).toHaveLength(1);
  return JSON.stringify(seen.calls[0], null, 2);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  seen.calls.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => finished()));
});
afterEach(() => vi.unstubAllGlobals());

describe("the explain request does not move", () => {
  it("ordinary", async () => {
    const serialised = await requestFor({});
    expect(serialised).toMatchSnapshot();
    expect(sha(serialised)).toMatchInlineSnapshot(`"582dd39acb6878fed1c3de8849cfb06506ef0d1074d6ba41ab3db14633d0420d"`);
  });

  it("deep", async () => {
    const serialised = await requestFor({ deep: true });
    expect(serialised).toMatchSnapshot();
    expect(sha(serialised)).toMatchInlineSnapshot(`"b922da46c90958c2ce9e230e0f0e8979e2e1877dd42fd49d7a5628b0a13fc505"`);
  });

  it("with a profile", async () => {
    const serialised = await requestFor({
      profile: "A statistician who reads economics for work, and knows little biology.",
    });
    expect(serialised).toMatchSnapshot();
    expect(sha(serialised)).toMatchInlineSnapshot(`"57f519bd564e17158105ba362d5517ce9f0c2c4b8a142e7695b28222eb682269"`);
  });
});
