/**
 * Spike — **why a chat answer arrives in one burst rather than streaming.**
 * Evidence for docs/investigations/261024d-does-it-say-that-cost-and-latency.md
 * § "Nothing streams" and the postmortem written from it.
 *
 *   npx tsx scripts/spikes/261024q-chat-stream-burst-probe.ts [arm,arm…]
 *
 * Sends one short prompt (no article) through `openRouterStream` — the same
 * transport `converse` uses — and timestamps every parsed chunk as it is
 * yielded, which is within a newline of the raw SSE line (src/openrouter-stream.ts
 * § sseChunks splits on newlines as bytes arrive). The effort is chosen by
 * borrowing a job whose CHAT_REASONING row has that effort and whose route is
 * the same Anthropic pin as chat's; the ledger rows therefore carry that job's
 * name, under scope `eval`.
 */
import { openRouterStream, type ChatJob } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import { HIGH_POWER_MODEL_OPENROUTER, CAPABLE_MODEL_OPENROUTER } from "../../src/models.js";

interface Arm {
  name: string;
  job: ChatJob;
  model: string;
  tools: boolean;
  search?: boolean;
}

const OPUS = HIGH_POWER_MODEL_OPENROUTER;
const SONNET = CAPABLE_MODEL_OPENROUTER;
const ARMS: Arm[] = [
  { name: "opus-high-tools", job: "chat", model: OPUS, tools: true }, // what chat sends
  { name: "opus-high-notools", job: "chat", model: OPUS, tools: false },
  { name: "opus-medium-tools", job: "search", model: OPUS, tools: true },
  { name: "opus-low-tools", job: "matter", model: OPUS, tools: true },
  { name: "sonnet-default-tools", job: "chat", model: SONNET, tools: true },
  // chat's real round: OpenRouter's server-side web search beside our tools
  { name: "opus-high-search", job: "chat", model: OPUS, tools: true, search: true },
  { name: "opus-low-search", job: "matter", model: OPUS, tools: true, search: true },
  { name: "sonnet-default-search", job: "chat", model: SONNET, tools: true, search: true },
];

const SEARCH_TOOL = { type: "openrouter:web_search", parameters: { max_uses: 4, max_results: 5 } };

const DUMMY_TOOL = {
  type: "function",
  function: {
    name: "read_cited_work",
    description: "Read the full text of a work the article cites. Not needed for general questions.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
};

async function runArm(arm: Arm) {
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const content: number[] = [];
  const reasoning: number[] = [];
  let reasoningChars = 0;
  let contentChars = 0;
  const keys = new Set<string>();
  let usage: unknown;
  for await (const chunk of openRouterStream(
    arm.job,
    {
      model: arm.model,
      max_tokens: 4000,
      ...(arm.tools || arm.search
        ? { tools: [...(arm.search ? [SEARCH_TOOL] : []), ...(arm.tools ? [DUMMY_TOOL] : [])] }
        : {}),
      messages: [
        {
          role: "user",
          content:
            "In about 300 words of plain prose, explain why the sky is blue and why sunsets are red. No tools needed.",
        },
      ],
    } as never,
    { signal: AbortSignal.timeout(120_000), onActivity: () => {}, end: { terminated: false } },
  )) {
    const delta = (chunk.choices?.[0]?.delta ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(delta)) keys.add(k);
    if (typeof delta.content === "string" && delta.content) {
      content.push(at());
      contentChars += delta.content.length;
    }
    const r = delta.reasoning ?? delta.reasoning_details;
    if (r && (typeof r !== "string" || r.length > 0)) {
      reasoning.push(at());
      reasoningChars += typeof r === "string" ? r.length : JSON.stringify(r).length;
    }
    if (chunk.usage) usage = chunk.usage;
  }
  const spread = content.length ? content[content.length - 1]! - content[0]! : null;
  const u = usage as { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
  console.log(
    JSON.stringify({
      arm: arm.name,
      total_ms: at(),
      reasoning_deltas: reasoning.length,
      reasoning_first_ms: reasoning[0] ?? null,
      reasoning_last_ms: reasoning.at(-1) ?? null,
      reasoning_chars: reasoningChars,
      content_deltas: content.length,
      content_chars: contentChars,
      content_first_ms: content[0] ?? null,
      content_last_ms: content.at(-1) ?? null,
      content_spread_ms: spread,
      completion_tokens: u?.completion_tokens,
      reasoning_tokens: u?.completion_tokens_details?.reasoning_tokens,
      delta_keys: [...keys],
    }),
  );
}

loadEnvLocal();
const only = process.argv[2]?.split(",");
await withLedger("eval", async () => {
  for (const arm of ARMS) if (!only || only.includes(arm.name)) await runArm(arm);
});
