/**
 * **`CHAT_REASONING` is what goes on the wire** — src/ai-call.ts.
 *
 * The table exists because a ceiling sized for the answer alone was spent on
 * thinking, on every long paper Referee Claims was given
 * (docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md).
 * Exhaustiveness is the compiler's job; what a test has to hold is that the
 * row is what is *sent*, for every job, because a table the gateway forgot to
 * read would type-check and change nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AiRequestBody,
  CHAT_REASONING,
  type ChatJob,
  effortOf,
  openRouterJson,
  type ReasoningEffort,
} from "../src/ai-call.js";

/* OpenRouter's whole documented ladder. This is primarily a compile-time
   assertion: omitting a supported rung from `ReasoningEffort` prevents a job
   from choosing it even though the gateway accepts it. */
const ALL_REASONING_EFFORTS: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn(
    async () =>
      ({
        ok: true,
        headers: new Headers(),
        text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function sent(job: ChatJob, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  fetchMock.mockClear();
  await openRouterJson(job, { model: "test/model", ...body } as AiRequestBody);
  const init = fetchMock.mock.calls[0]?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

const JOBS = Object.keys(CHAT_REASONING) as ChatJob[];

describe("what each chat job sends about thinking", () => {
  it("models the whole effort ladder the chat wire accepts", () => {
    expect(ALL_REASONING_EFFORTS).toHaveLength(7);
  });

  it("covers the jobs this change decided, with the efforts it decided", () => {
    expect(effortOf("referee-claims")).toBe("medium");
    expect(effortOf("referee-criteria")).toBe("medium");
    expect(effortOf("link-summary")).toBe("low");
    expect(effortOf("search")).toBeNull();
  });

  for (const job of JOBS) {
    it(`${job}: sends exactly its row`, async () => {
      const row = CHAT_REASONING[job];
      const body = await sent(job);
      if ("effort" in row) expect(body.reasoning).toEqual({ effort: row.effort });
      else expect(body).not.toHaveProperty("reasoning");
    });
  }

  it("does not let a body built at run time override the table", async () => {
    /* `AiRequestBody.reasoning` is `never`, which stops a literal. A body
       assembled from something the type never saw is stopped here. */
    expect((await sent("search", { reasoning: { effort: "high" } })).reasoning).toBeUndefined();
    expect((await sent("referee-claims", { reasoning: { effort: "high" } })).reasoning).toEqual({
      effort: "medium",
    });
  });

  it("gives every provider-default row a reason", () => {
    for (const job of JOBS) {
      const row = CHAT_REASONING[job];
      if ("providerDefault" in row) expect(row.providerDefault.length, job).toBeGreaterThan(20);
    }
  });
});
