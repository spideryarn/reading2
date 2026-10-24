/**
 * Spike — **does the round after a tool call stream?** Companion to
 * scripts/spikes/261024q-chat-stream-burst-probe.ts, which found a first round
 * streams normally. This one makes round 1 ask for a tool, answers it, and
 * sends round 2 the way src/converse.ts does (assistant tool-call message with
 * no `reasoning_details`) and, for comparison, with them replayed.
 *
 *   [PROBE_NO_SEARCH=1] npx tsx scripts/spikes/261024q-chat-stream-round2-probe.ts [opus|sonnet] [low]
 *
 * Every call goes through `openRouterStream` under `withLedger("eval")`.
 */
import { openRouterStream, type ChatJob } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import { CAPABLE_MODEL_OPENROUTER, HIGH_POWER_MODEL_OPENROUTER } from "../../src/models.js";

const model = process.argv[2] === "sonnet" ? CAPABLE_MODEL_OPENROUTER : HIGH_POWER_MODEL_OPENROUTER;
/* `chat` → high on Opus; `matter` → low, same Anthropic pin. */
const job: ChatJob = process.argv[3] === "low" ? "matter" : "chat";

const TOOL = {
  type: "function",
  function: {
    name: "read_cited_work",
    description: "Read the text of the work the reader is asking about.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
};
const SEARCH = { type: "openrouter:web_search", parameters: { max_uses: 4, max_results: 5 } };
/* `PROBE_NO_SEARCH=1` leaves OpenRouter's server-side web search out of every
   round, to tell its effect from the tool loop's. */
const tools = process.env.PROBE_NO_SEARCH ? [TOOL] : [SEARCH, TOOL];

const QUESTION =
  "Call read_cited_work with id 'rayleigh' first, then in about 300 words explain, from what it says, why the sky is blue and sunsets red.";
const WORK =
  "Rayleigh (1871): light scattered by particles much smaller than its wavelength is scattered in proportion to the inverse fourth power of the wavelength, so blue light is scattered about 5.5 times more than red. ".repeat(
    20,
  );

interface Round {
  content: string;
  reasoningDetails: unknown[];
  calls: { id: string; name: string; args: string }[];
  stats: Record<string, unknown>;
}

async function round(messages: unknown[], label: string): Promise<Round> {
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const contentAt: number[] = [];
  const reasoningAt: number[] = [];
  let content = "";
  const reasoningDetails: unknown[] = [];
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let usage: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
  for await (const chunk of openRouterStream(job, { model, max_tokens: 4000, tools, messages } as never, {
    signal: AbortSignal.timeout(180_000),
    onActivity: () => {},
    end: { terminated: false },
  })) {
    const d = (chunk.choices?.[0]?.delta ?? {}) as Record<string, unknown>;
    /* `PROBE_DUMP=1` prints every chunk of the second round with its arrival time. */
    if (process.env.PROBE_DUMP && label.startsWith("round2 as")) console.log(at(), JSON.stringify(chunk).slice(0, 300));
    if (typeof d.content === "string" && d.content) {
      contentAt.push(at());
      content += d.content;
    }
    if (Array.isArray(d.reasoning_details) && d.reasoning_details.length) {
      reasoningAt.push(at());
      reasoningDetails.push(...d.reasoning_details);
    }
    for (const tc of (d.tool_calls as { index: number; id?: string; function?: { name?: string; arguments?: string } }[]) ?? []) {
      const c = calls.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name = tc.function.name;
      c.args += tc.function?.arguments ?? "";
      calls.set(tc.index, c);
    }
    if (chunk.usage) usage = chunk.usage as typeof usage;
  }
  const stats = {
    label,
    total_ms: at(),
    reasoning_deltas: reasoningAt.length,
    reasoning_first_ms: reasoningAt[0] ?? null,
    reasoning_last_ms: reasoningAt.at(-1) ?? null,
    content_deltas: contentAt.length,
    content_chars: content.length,
    content_first_ms: contentAt[0] ?? null,
    content_last_ms: contentAt.at(-1) ?? null,
    content_spread_ms: contentAt.length ? contentAt.at(-1)! - contentAt[0]! : null,
    completion_tokens: usage?.completion_tokens,
    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens,
    tool_calls: calls.size,
  };
  console.log(JSON.stringify(stats));
  return { content, reasoningDetails, calls: [...calls.values()], stats };
}

loadEnvLocal();
await withLedger("eval", async () => {
  const user = { role: "user", content: QUESTION };
  const r1 = await round([user], `${job}/${model} round1`);
  if (r1.calls.length === 0) throw new Error("round 1 asked for no tool; nothing to probe");
  const toolCalls = r1.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
  const results = r1.calls.map((c) => ({ role: "tool", tool_call_id: c.id, content: WORK }));
  // As src/converse.ts sends it: no reasoning carried back.
  await round([user, { role: "assistant", content: r1.content, tool_calls: toolCalls }, ...results], "round2 as converse sends it");
  // With the round-1 reasoning replayed, as OpenRouter's guidance asks.
  await round(
    [user, { role: "assistant", content: r1.content, tool_calls: toolCalls, reasoning_details: r1.reasoningDetails }, ...results],
    "round2 with reasoning_details",
  );
  // Control: the same work handed over in a user message, no tool history, tools still declared.
  await round(
    [{ role: "user", content: `${QUESTION}\n\n(The tool has already been called for you; its result:)\n\n${WORK}` }],
    "control: same content, no tool history",
  );
});
