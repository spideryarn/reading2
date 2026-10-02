/**
 * **Ask each arm which command a typed request means** — plan 261002c Stage D.
 *
 *     npx tsx evals/command-pick/run.ts                    # both arms, every phrase
 *     npx tsx evals/command-pick/run.ts --arm jev --only p01,p02
 *     npx tsx evals/command-pick/run.ts --force            # redo rows that already have an answer
 *
 * **This spends money** — a few cents in all. Jev goes through the declared
 * bypass in ./jev.ts; the chat arm through the gateway
 * (`openRouterJson("eval", …)`); both inside `withLedger("eval", …)`, so the
 * spend is in `npm run cost`. One call per phrase per arm, the shape production
 * would have. A row already answered without an error is skipped.
 *
 * The arms, predeclared:
 *
 * | arm  | model | asked |
 * |------|-------|-------|
 * | jev  | `typesafe/jev-1.13` | one `choice` question, the catalogue ids plus `none` as options |
 * | chat | `CAPABLE_MODEL_OPENROUTER` (src/models.ts) | the same catalogue as text; JSON `{id, argument, confidence}` |
 *
 * The chat arm is the capable tier, not Luna, because it stands in for the
 * *fallback* the vision doc names — "a more powerful LLM" — and the question
 * is whether Jev can stand in front of it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openRouterJson } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import { CAPABLE_MODEL_OPENROUTER } from "../../src/models.js";
import { CATALOGUE, NONE } from "./catalogue.js";
import { JEV_MODEL, jevDecide } from "./jev.js";
import { type Phrase, PHRASES } from "./phrases.js";

loadEnvLocal();

export const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");
export const CHAT_MODEL = CAPABLE_MODEL_OPENROUTER;
export type Arm = "jev" | "chat";

export interface Row {
  phrase: string;
  arm: Arm;
  model: string;
  at: string;
  pick: string | null;
  /** Jev: the probability it gave its pick. Chat: null. */
  probability: number | null;
  /** Jev's `confidence`; the chat model's self-reported 0–1. */
  confidence: number | null;
  argument: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
}

const APP =
  "Spideryarn is a reading app. The reader has one article open and has typed or spoken a request into the app's command bar. Each command below is something the app can do right now.";
const NONE_TEXT =
  "None of these commands does what the reader asked — the app cannot do it, or it is not a request to the app at all. Choose this rather than a command that only sounds related.";

function describe(c: (typeof CATALOGUE)[number]): string {
  return `${c.label} — ${c.description}${c.aliases.length ? ` (also called: ${c.aliases.join(", ")})` : ""}`;
}

function jevQuestions(p: Phrase): Record<string, unknown> {
  const criteria: Record<string, string> = Object.fromEntries(CATALOGUE.map((c) => [c.id, describe(c)]));
  criteria[NONE] = NONE_TEXT;
  return {
    command: {
      type: "choice",
      instructions: `Which one command should run for the reader's request: "${p.text}"?`,
      criteria,
    },
  };
}

function chatMessages(p: Phrase): { role: string; content: string }[] {
  const lines = CATALOGUE.map((c) => `${c.id} | ${describe(c)}`);
  return [
    {
      role: "system",
      content: [
        APP,
        "",
        "Commands (id | what it is):",
        ...lines,
        `${NONE} | ${NONE_TEXT}`,
        "",
        "Choose the one command that should run for the reader's request.",
        `Only action:find takes an argument: the words to look for in the article, as the reader said them, without filler such as "do they talk about". For every other id the argument is null.`,
        "confidence is how sure you are that this is the command the reader meant, from 0 to 1.",
        'Answer with JSON only: {"id": "<command id or none>", "argument": <string or null>, "confidence": <0-1>}',
      ].join("\n"),
    },
    { role: "user", content: p.text },
  ];
}

function contentJson(json: unknown): unknown {
  const text = (json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function blank(p: Phrase, arm: Arm): Row {
  return {
    phrase: p.id,
    arm,
    model: arm === "jev" ? JEV_MODEL : CHAT_MODEL,
    at: new Date().toISOString(),
    pick: null,
    probability: null,
    confidence: null,
    argument: null,
    latencyMs: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    error: null,
  };
}

async function runJev(p: Phrase, row: Row): Promise<unknown> {
  const r = await jevDecide({ app: APP, reader_request: p.text }, jevQuestions(p));
  const a = r.answers.command;
  row.pick = a?.choice ?? null;
  row.confidence = a?.confidence ?? null;
  row.probability = row.pick !== null ? (a?.probabilities?.[row.pick] ?? null) : null;
  row.latencyMs = r.latencyMs;
  row.costUsd = r.costUsd;
  row.tokensIn = r.inputTokens;
  row.tokensOut = r.outputTokens;
  if (row.pick === null) row.error = "no choice in the answer";
  return r.body;
}

async function runChat(p: Phrase, row: Row): Promise<unknown> {
  const t0 = performance.now();
  /* 2,000, not the 400 of the first run: Sonnet 5 at the provider default
     thinks first, and on p04 its reasoning used all 400 and left no answer
     (finish_reason "length"). p04 alone was rerun at 2,000; no other row came
     near the cap, so the rest stand. */
  const call = await openRouterJson(
    "eval",
    { model: CHAT_MODEL, max_tokens: 2000, messages: chatMessages(p) },
    { signal: AbortSignal.timeout(120_000) },
  );
  row.latencyMs = Math.round(performance.now() - t0);
  const b = call.json as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } } | null;
  row.costUsd = b?.usage?.cost ?? null;
  row.tokensIn = b?.usage?.prompt_tokens ?? null;
  row.tokensOut = b?.usage?.completion_tokens ?? null;
  const parsed = contentJson(call.json) as { id?: unknown; argument?: unknown; confidence?: unknown } | null;
  row.pick = typeof parsed?.id === "string" ? parsed.id : null;
  row.argument = typeof parsed?.argument === "string" ? parsed.argument : null;
  row.confidence = typeof parsed?.confidence === "number" ? parsed.confidence : null;
  if (row.pick === null) row.error = "no id in the answer";
  return call.json;
}

export function loadRows(arm: Arm): Row[] {
  const file = path.join(RESULTS_DIR, `${arm}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Row[]) : [];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const force = argv.includes("--force");
  const only = flag("--only")?.split(",");
  const arms: Arm[] = flag("--arm") ? [flag("--arm") as Arm] : ["jev", "chat"];
  mkdirSync(path.join(RESULTS_DIR, "raw"), { recursive: true });

  for (const arm of arms) {
    const rows = new Map(loadRows(arm).map((r) => [r.phrase, r]));
    const todo = PHRASES.filter((p) => (!only || only.includes(p.id)) && (force || !rows.get(p.id) || rows.get(p.id)?.error));
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < todo.length) {
          const p = todo[next++];
          if (!p) break;
          const row = blank(p, arm);
          let raw: unknown = null;
          try {
            raw = await (arm === "jev" ? runJev(p, row) : runChat(p, row));
          } catch (e) {
            row.error = e instanceof Error ? e.message.slice(0, 500) : String(e);
          }
          rows.set(p.id, row);
          if (raw !== null) writeFileSync(path.join(RESULTS_DIR, "raw", `${arm}-${p.id}.json`), `${JSON.stringify(raw, null, 1)}\n`);
          console.log(
            `${arm} ${p.id}: ${row.pick} conf=${row.confidence?.toFixed(2)} p=${row.probability?.toFixed(2)} arg=${row.argument ?? "-"} ${row.latencyMs} ms $${row.costUsd ?? "?"}${row.error ? `  ERROR ${row.error.slice(0, 200)}` : ""}`,
          );
        }
      }),
    );
    const ordered = PHRASES.map((p) => rows.get(p.id)).filter((r): r is Row => r !== undefined);
    writeFileSync(path.join(RESULTS_DIR, `${arm}.json`), `${JSON.stringify(ordered, null, 1)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await withLedger("eval", main);
}
