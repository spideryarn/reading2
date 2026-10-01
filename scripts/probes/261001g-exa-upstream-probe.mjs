/**
 * **Which upstream answers an Exa-searching chat call** —
 * docs/plans/261001g-exa-upstream-label.md. A measurement, not the build:
 * nothing in `src/` imports it.
 *
 *   node scripts/probes/261001g-exa-upstream-probe.mjs <exa|auto|none> <stream|json> '<provider json>'
 *
 * Needs OPENROUTER_API_KEY in the environment. One paid call per run (about
 * $0.02 with a search, a fraction of a cent without), to
 * `anthropic/claude-sonnet-5`, sent **raw rather than through
 * `src/ai-call.ts`** on purpose: the question is what the frames say before
 * the gateway reads them. So no ledger row is written. `auto` sends the search
 * tool with no `engine`. Prints one JSON line: the frames' `provider` counts,
 * the `openrouter_metadata` block, the usage cost, and the generation record's
 * `provider_name`, polled for up to ~24s because it is not written at once.
 */
const [engine, mode, prov] = process.argv.slice(2);
const stream = mode === "stream";
const body = {
  model: "anthropic/claude-sonnet-5",
  max_tokens: 300,
  usage: { include: true },
  provider: JSON.parse(prov),
  messages: [{ role: "user", content: "Find the arXiv page for 'Attention Is All You Need'. One search, reply with the URL only." }],
};
if (stream) body.stream = true;
if (engine !== "none")
  body.tools = [{ type: "openrouter:web_search", parameters: engine === "exa" ? { engine: "exa", max_total_results: 3, max_results: 3 } : { max_uses: 1, max_results: 3 } }];
const key = process.env.OPENROUTER_API_KEY;
const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OpenRouter-Metadata": "enabled" },
  body: JSON.stringify(body),
});
const text = await r.text();
const out = { engine, mode, prov, status: r.status, frameProviders: {}, metadata: null, id: null, cost: null };
const objs = stream
  ? text.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean)
  : [(() => { try { return JSON.parse(text); } catch { return {}; } })()];
for (const c of objs) {
  out.id ??= c.id;
  out.frameProviders[c.provider] = (out.frameProviders[c.provider] ?? 0) + 1;
  if (c.openrouter_metadata) { out.metadata = c.openrouter_metadata; out.metaChunks = (out.metaChunks ?? 0) + 1; out.metaOnUsageChunk = !!c.usage; }
  if (c.usage) out.cost = { cost: c.usage.cost, prompt: c.usage.prompt_tokens, cacheWrite: c.usage.prompt_tokens_details?.cache_write_tokens, upstreamPrompt: c.usage.cost_details?.upstream_inference_prompt_cost };
}
if (r.status !== 200) out.error = text.slice(0, 300);
let rec = null;
for (let i = 0; i < 6 && out.id; i++) {
  await new Promise((s) => setTimeout(s, 4000));
  const g = await (await fetch(`https://openrouter.ai/api/v1/generation?id=${out.id}`, { headers: { Authorization: `Bearer ${key}` } })).json();
  rec = g.data?.provider_name ?? null;
  if (rec && (g.data.provider_responses?.length || g.data.total_cost)) break;
}
out.generationProviderName = rec;
console.log(JSON.stringify(out));
