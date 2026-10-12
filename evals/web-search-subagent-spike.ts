/**
 * Spike — what should a "search the web" tool hand back to the conversation
 * that called it? docs/investigations/261012e-web-search-subagent-spikes.md is
 * the write-up; this is the script behind its numbers.
 *
 *     npx tsx evals/web-search-subagent-spike.ts [--runs N] [--only raw,luna,haiku,parallel,probe]
 *
 * **This one spends money** — every arm is a real OpenRouter call, recorded in
 * the ledger as an eval.
 *
 * Arms, each run once per query per run:
 *
 *   raw       GPT Luna, Exa forced, told to reply DONE. What comes back is
 *             only the `url_citation` annotations: OpenRouter has no search
 *             endpoint of its own, so this is the nearest thing to one.
 *   luna      the same search, then the model writes a short list of links
 *             with a sentence each — the "subagent hands back links and a
 *             summary" shape Greg asked about.
 *   haiku     the same as `luna` on Claude Haiku, the model the report names.
 *   parallel  `raw` on the Parallel engine, which OpenRouter prices at a
 *             seventh of Exa — does it return extracts at all?
 *   probe     GPT Sol's precondition for its in-loop design: Sonnet with Exa
 *             and a local `offer_next_steps` tool, asked to search and then
 *             call the tool with no words. Do the annotations still arrive?
 *
 * Per call: latency, the provider's cost, searches, annotations, and for the
 * summary arms whether every link written was one the search returned.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { openRouterJson } from "../src/ai-call.js";
import { withLedger } from "../src/cli-ledger.js";
import { isMain } from "../src/is-main.js";
import { collectSearchEvidence, whereSearchCountCameFrom, type Usage } from "../src/openrouter-stream.js";
import type { SearchEvidence } from "../src/types.js";

const LUNA = "openai/gpt-6-luna";
const HAIKU = "anthropic/claude-haiku-5.5";
const SONNET = "anthropic/claude-sonnet-5.5";

/** Questions a reader asks to place a piece among others — the report's own example first. */
const QUERIES = [
  "Anil Seth 'The Mythology of Conscious AI' responses and criticism",
  "Integrated information theory criticism pseudoscience letter 2023 aftermath",
  "ego depletion replication failures since 2016",
  "Ted Chiang 'ChatGPT is a blurry JPEG of the web' responses",
  "Bret Victor 'Up and Down the Ladder of Abstraction' influence on later work",
  "What has happened since the 2022 'Attention is not all you need' style critiques of transformer scaling laws",
] as const;

type Arm = "raw" | "luna" | "haiku" | "parallel" | "probe";
const ARMS: readonly Arm[] = ["raw", "luna", "haiku", "parallel", "probe"];

const SUMMARY_SYSTEM = `You are a research assistant searching the web for another model, which is \
talking to a reader about an article. Search for the query, then reply with at most five results, \
most useful first, one per line, in exactly this form:

- [title](url) — one or two plain sentences: what this page says that bears on the query.

Use only URLs your search returned. Say what each page says, not what you know. If nothing useful \
came back, reply "Nothing useful found." and nothing else.`;

function body(arm: Arm, query: string): Record<string, unknown> & { model: string } {
  const exa = { type: "openrouter:web_search", parameters: { engine: "exa", max_total_results: 5, max_results: 5 } };
  switch (arm) {
    case "raw":
      return {
        model: LUNA,
        max_completion_tokens: 2000,
        messages: [{ role: "user", content: `Search the web for: ${query}\n\nThen reply with the single word DONE.` }],
        tools: [exa],
        tool_choice: "required",
      };
    case "parallel":
      return {
        model: LUNA,
        max_completion_tokens: 2000,
        messages: [{ role: "user", content: `Search the web for: ${query}\n\nThen reply with the single word DONE.` }],
        tools: [{ type: "openrouter:web_search", parameters: { engine: "parallel", max_total_results: 5, max_results: 5 } }],
        tool_choice: "required",
      };
    case "luna":
    case "haiku":
      return {
        model: arm === "luna" ? LUNA : HAIKU,
        max_completion_tokens: 3000,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM },
          { role: "user", content: query },
        ],
        tools: [exa],
        /* Haiku on Anthropic rejects "required" alongside a server tool in some
           routes; ask, and let the witness say whether it searched. */
        ...(arm === "luna" ? { tool_choice: "required" } : {}),
      };
    case "probe":
      return {
        model: SONNET,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content:
              `Search the web for: ${query}\n\nThen call offer_next_steps with two short next steps. ` +
              `Do not write any text at all — no answer, no preamble. Only the search and the tool call.`,
          },
        ],
        tools: [
          exa,
          {
            type: "function",
            function: {
              name: "offer_next_steps",
              description: "Offer the reader up to three next steps as buttons.",
              parameters: {
                type: "object",
                properties: { steps: { type: "array", items: { type: "string" } } },
                required: ["steps"],
              },
            },
          },
        ],
      };
  }
}

interface Row {
  arm: Arm;
  query: string;
  ms: number;
  costUsd: number | null;
  searches: number | null;
  annotations: number;
  withExcerpt: number;
  excerptChars: number;
  textChars: number;
  linksInText: number;
  linksNotFromSearch: string[];
  toolCalls: string[];
  finish: string | null;
  text: string;
  evidence: SearchEvidence[];
  error?: string;
}

interface Answer {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      annotations?: Parameters<typeof collectSearchEvidence>[0];
      tool_calls?: { function?: { name?: string } }[];
    };
  }[];
  usage?: Usage & { cost?: number };
}

async function runOne(arm: Arm, query: string): Promise<Row> {
  const started = Date.now();
  const job = arm === "probe" ? "chat" : "dig-deeper-search";
  try {
    const call = await openRouterJson(job, body(arm, query) as never, { signal: AbortSignal.timeout(120_000) });
    const ms = Date.now() - started;
    const answer = call.json as Answer | null;
    const choice = answer?.choices?.[0];
    const found = new Map<string, SearchEvidence>();
    collectSearchEvidence(choice?.message?.annotations, found);
    const evidence = [...found.values()];
    const text = choice?.message?.content ?? "";
    const links = [...new Set([...text.matchAll(/https?:\/\/[^\s)\]>"]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")))];
    const known = new Set(evidence.map((e) => e.url));
    return {
      arm,
      query,
      ms,
      costUsd: typeof answer?.usage?.cost === "number" ? answer.usage.cost : null,
      searches: whereSearchCountCameFrom(answer?.usage).searches,
      annotations: evidence.length,
      withExcerpt: evidence.filter((e) => e.excerpt).length,
      excerptChars: evidence.reduce((n, e) => n + (e.excerpt?.length ?? 0), 0),
      textChars: text.length,
      linksInText: links.length,
      linksNotFromSearch: links.filter((l) => !known.has(l)),
      toolCalls: (choice?.message?.tool_calls ?? []).map((t) => t.function?.name ?? "?"),
      finish: choice?.finish_reason ?? null,
      text,
      evidence,
    };
  } catch (err) {
    return {
      arm, query, ms: Date.now() - started, costUsd: null, searches: null, annotations: 0, withExcerpt: 0,
      excerptChars: 0, textChars: 0, linksInText: 0, linksNotFromSearch: [], toolCalls: [], finish: null,
      text: "", evidence: [], error: err instanceof Error ? err.message : String(err),
    };
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor((s.length - 1) / 2)]!;
};

async function main(): Promise<void> {
  const runs = Number(arg("runs") ?? "1");
  const only = (arg("only")?.split(",") as Arm[] | undefined) ?? ARMS;
  const rows: Row[] = [];
  for (let r = 0; r < runs; r++) {
    for (const query of QUERIES) {
      const batch = await Promise.all(only.map((arm) => runOne(arm, query)));
      for (const row of batch) {
        rows.push(row);
        console.log(
          `${row.arm.padEnd(8)} ${String(row.ms).padStart(6)}ms $${row.costUsd?.toFixed(4) ?? "?"} ` +
            `searches=${row.searches} ann=${row.annotations}/${row.withExcerpt}x ${row.excerptChars}ch ` +
            `text=${row.textChars} links=${row.linksInText} stray=${row.linksNotFromSearch.length} ` +
            `tools=[${row.toolCalls.join(",")}] finish=${row.finish}${row.error ? ` ERROR ${row.error}` : ""}` +
            `  — ${query.slice(0, 40)}`,
        );
      }
    }
  }
  console.log("\nper arm (medians):");
  for (const arm of only) {
    const mine = rows.filter((r) => r.arm === arm && !r.error);
    const costs = mine.map((r) => r.costUsd).filter((c): c is number => c !== null);
    console.log(
      `${arm.padEnd(8)} n=${mine.length}/${rows.filter((r) => r.arm === arm).length} ms=${median(mine.map((r) => r.ms))} ` +
        `$=${median(costs).toFixed(4)} ann=${median(mine.map((r) => r.annotations))} ` +
        `excerptChars=${median(mine.map((r) => r.excerptChars))} text=${median(mine.map((r) => r.textChars))} ` +
        `stray=${mine.reduce((n, r) => n + r.linksNotFromSearch.length, 0)} ` +
        `zeroAnn=${mine.filter((r) => r.annotations === 0).length}`,
    );
  }
  const dir = path.join("evals", "results");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `web-search-subagent-spike-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  await writeFile(file, JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${file}`);
}

if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", main).catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
