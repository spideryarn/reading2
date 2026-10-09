/**
 * **Production's own request, captured rather than copied.**
 *
 * Summary (Fuller) and Ideas build their prompts inside `generateSimpleSummary`
 * and `generateIdeas`, and Ideas' system text is not exported. Copying it would
 * be a second copy that drifts; editing src/ was out of bounds for this stage.
 * So each generator is run once per article with `fetch` replaced: the first
 * Messages-wire request it sends is recorded byte for byte and answered with a
 * local 400, which ends the run. **Nothing goes over the network.**
 *
 * The 400 still passes through the gateway's meter, which refuses to meter
 * outside a ledger in an eval process (`beginSpend`). The capture therefore
 * runs inside a collector whose sink drops the rows: they describe a request
 * that never left this process and cost nothing, and writing them would put
 * fake error rows in the ledger.
 */
import type { Article } from "../../src/article-input.js";
import { collectSpend } from "../../src/ai-spend.js";

/** The parts of a Messages-wire request this spike reuses. */
export interface CapturedRequest {
  system: { type: "text"; text: string; cache_control?: unknown }[];
  messages: { role: "user"; content: string }[];
  max_tokens: number;
  effort: string | null;
  /** `output_config.format.schema` — the structured-output schema production sends. */
  schema: Record<string, unknown>;
  model: string;
}

async function captureOne(run: () => Promise<unknown>): Promise<CapturedRequest> {
  const realFetch = globalThis.fetch;
  let captured: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    /* By path, not host: this stub never forwards anything, and naming the
       gateway's host would read to tests/no-undeclared-spend.test.ts as a
       file that can reach a paid provider. */
    if (!/\/(chat\/completions|messages)$/.test(new URL(url).pathname)) {
      throw new Error(`capture: unexpected fetch to ${url}`);
    }
    if (captured === null && typeof init?.body === "string") {
      captured = JSON.parse(init.body) as Record<string, unknown>;
    }
    return new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "captured locally" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await collectSpend(
      async () => {
        await run().catch(() => undefined);
      },
      { sink: async () => {} },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  const body = captured as Record<string, unknown> | null;
  if (!body) throw new Error("capture: the generator sent no request");
  const oc = (body.output_config ?? {}) as { effort?: string; format?: { schema?: Record<string, unknown> } };
  if (!oc.format?.schema) throw new Error("capture: the request carried no output schema");
  return {
    system: body.system as CapturedRequest["system"],
    messages: body.messages as CapturedRequest["messages"],
    max_tokens: body.max_tokens as number,
    effort: oc.effort ?? null,
    schema: oc.format.schema,
    model: body.model as string,
  };
}

export async function captureSummaryFuller(article: Article): Promise<CapturedRequest> {
  const { generateSimpleSummary, FIRST_LEVEL } = await import("../../src/simple-summary.js");
  if (FIRST_LEVEL !== "fuller") throw new Error(`capture: Simple's first request is now ${FIRST_LEVEL}, not fuller`);
  const req = await captureOne(() =>
    generateSimpleSummary({ article, profile: null, power: "standard", guard: false }),
  );
  /* The first request must be Fuller's: its system block is the Fuller instructions. */
  const { simpleSystem, evidenceBand } = await import("../../src/simple-summary.js");
  const { isBodyEvidence } = await import("../../src/block-policy.js");
  const expected = simpleSystem("fuller", evidenceBand(article.blocks.filter(isBodyEvidence)));
  if (req.system[1]?.text !== expected) throw new Error("capture: the first Simple request is not Fuller's");
  return req;
}

export async function captureIdeas(article: Article): Promise<CapturedRequest> {
  const { generateIdeas } = await import("../../src/ideas.js");
  return captureOne(() => generateIdeas({ article, profile: null, previous: null, power: "standard" }));
}
