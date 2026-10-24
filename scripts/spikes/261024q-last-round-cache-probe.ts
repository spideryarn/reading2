/**
 * Spike — **what chat's last tool round does to the cached prefix**, and whether
 * the guide's shape (keep the definitions, send `tool_choice: "none"`) would
 * keep it warm. Evidence for docs/project/chat-tools.md § Still open, "The final
 * round changes the tools array".
 *
 *   npx tsx scripts/spikes/261024q-last-round-cache-probe.ts
 *
 * One ~6,000-token stand-in article in a user message with an explicit
 * breakpoint, as `buildConverseMessages` places it; four requests in a row on
 * the high-power model, through `openRouterStream` under `withLedger("eval")`:
 *
 *   A  tools [web search, ours]                 — writes the prefix
 *   B  the same again                           — should read it
 *   C  tools [web search, ours], tool_choice none — the guide's shape
 *   D  tools [web search] only                  — chat's last round today
 */
import { openRouterStream } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import { HIGH_POWER_MODEL_OPENROUTER } from "../../src/models.js";

const TOOL = {
  type: "function",
  function: {
    name: "read_cited_work",
    description: "Read the text of a work the article cites.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
};
const SEARCH = { type: "openrouter:web_search", parameters: { max_uses: 4, max_results: 5 } };

/* Unique per run so an earlier run's cache cannot answer A. */
const nonce = Date.now().toString(36);
const ARTICLE = `Article ${nonce}.\n\n` +
  Array.from({ length: 300 }, (_, i) => `Paragraph ${i}: the spider spins silk of remarkable tensile strength, and its draglines vary with humidity and diet in ways that remain partly unexplained.`).join("\n");

const messages = [
  { role: "system", content: "You answer questions about the article. Be brief." },
  { role: "user", content: [{ type: "text", text: ARTICLE, cache_control: { type: "ephemeral" } }] },
  { role: "user", content: "In one sentence: what is the article about? Do not use tools." },
];

async function send(label: string, extra: Record<string, unknown>) {
  let usage: Record<string, unknown> | undefined;
  for await (const chunk of openRouterStream(
    "chat",
    { model: HIGH_POWER_MODEL_OPENROUTER, max_tokens: 2000, messages, ...extra } as never,
    { signal: AbortSignal.timeout(120_000), onActivity: () => {}, end: { terminated: false } },
  )) {
    if (chunk.usage) usage = chunk.usage as Record<string, unknown>;
  }
  const d = (usage?.prompt_tokens_details ?? {}) as Record<string, unknown>;
  console.log(
    JSON.stringify({ label, prompt: usage?.prompt_tokens, cacheRead: d.cached_tokens, cacheWrite: d.cache_write_tokens ?? usage?.cache_write_tokens, cost: usage?.cost }),
  );
}

loadEnvLocal();
if (!process.argv.includes("--search-check")) {
  await withLedger("eval", async () => {
    await send("A both tools", { tools: [SEARCH, TOOL] });
    await send("B both tools again", { tools: [SEARCH, TOOL] });
    await send("C both tools, tool_choice none", { tools: [SEARCH, TOOL], tool_choice: "none" });
    await send("D search only (chat's last round)", { tools: [SEARCH] });
  });
}

/* **Does `tool_choice: "none"` also switch off OpenRouter's web search?** Chat's
   last round keeps search today; the guide's shape would trade that away if so.
   Run with `--search-check`: a question that needs a search, no article. */
if (process.argv.includes("--search-check")) {
  await withLedger("eval", async () => {
    for (const tool_choice of [undefined, "none"] as const) {
      let usage: Record<string, unknown> | undefined;
      let text = "";
      for await (const chunk of openRouterStream(
        "chat",
        {
          model: HIGH_POWER_MODEL_OPENROUTER,
          max_tokens: 2000,
          tools: [SEARCH, TOOL],
          ...(tool_choice ? { tool_choice } : {}),
          messages: [{ role: "user", content: "Search the web: what is the latest headline on bbc.co.uk/news today? One line." }],
        } as never,
        { signal: AbortSignal.timeout(120_000), onActivity: () => {}, end: { terminated: false } },
      )) {
        text += chunk.choices?.[0]?.delta?.content ?? "";
        if (chunk.usage) usage = chunk.usage as Record<string, unknown>;
      }
      console.log(JSON.stringify({ tool_choice: tool_choice ?? "auto", server_tool_use: usage?.server_tool_use, text: text.slice(0, 160) }));
    }
  });
}
