/**
 * **Ask each arm which command a sentence means, and for its argument** — plan
 * 261003k Stage 1. (The first run, plan 261002c Stage D, was this file at
 * 316e9365c; its results are `results/jev.json` and `results/chat.json`.)
 *
 *     npx tsx evals/command-pick/run.ts                         # every arm, every phrase
 *     npx tsx evals/command-pick/run.ts --arm jev-pick --only p01,n03
 *     npx tsx evals/command-pick/run.ts --force                 # redo rows that already have an answer
 *
 * **This spends money** — about $1.50 for everything. Jev goes through the
 * declared bypass in ./jev.ts and the chat models through the one in
 * ./chat.ts, both inside `withLedger("eval", …)`, so the spend is in
 * `npm run cost`. One call per phrase per arm. A row already answered without
 * an error is skipped. It stops if the run's total passes `BUDGET_USD`.
 *
 * | arm | model | asked |
 * |-----|-------|-------|
 * | `jev-pick` | `typesafe/jev-1.13` | one `choice` question: every id, plus `none` |
 * | `jev-words` | the same | that question **and**, in the same request, one yes/no question per word of the sentence: is this word part of what to look for, define or tag? |
 * | `deepseek`, `luna`, `haiku` | see `CHAT_ARMS` | the same list as text; JSON `{id, argument, confidence}` — the confidence is the model's own report, not a probability |
 * | `arg-deepseek`, `arg-luna`, `arg-haiku` | the same three | only for phrases whose right answer takes an argument: the sentence and the **right** kind, JSON `{argument}` — extraction on its own |
 * | `hyb-deepseek`, `hyb-luna`, `hyb-haiku` | the same three | the second call of "Jev picks, a small model extracts": for every phrase where `jev-pick` chose an argument command, **right or wrong**, the sentence and **Jev's** kind, JSON `{argument}`. Run after `jev-pick`. |
 *
 * **What each arm's answer is, declared before the run** (GPT Sol's F2 on the
 * plan), and scored whole by summarise.ts: an id from the list, and for an
 * argument id the words, which count only if they are not empty and appear in
 * the sentence (compared without case) — the check production will make.
 * `jev-pick` alone has no words, so an argument pick from it is incomplete.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import { PAPER_METADATA_MODEL, QUICK_MODEL_OPENROUTER } from "../../src/models.js";
import { type ArgumentKind, CATALOGUE, type CatalogueRow, NONE } from "./catalogue.js";
import { type ChatArm, chatAsk } from "./chat.js";
import { JEV_MODEL, jevDecide } from "./jev.js";
import { type Phrase, PHRASES, wantsArgument } from "./phrases.js";

loadEnvLocal();

export const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", "261003");
const BUDGET_USD = 4;

/**
 * **Thinking off, or as low as the model takes** — latency is the question.
 * Each setting was checked on the wire before the run: the row records
 * `reasoningTokens`, and summarise.ts prints the total per arm.
 */
export const CHAT_ARMS: readonly ChatArm[] = [
  {
    name: "deepseek",
    model: PAPER_METADATA_MODEL,
    reasoning: { effort: "none" },
    /* `paper-metadata`'s route (src/ai-call.ts § AI_JOB_ROUTE): the
       zero-retention upstreams only. A model we could not ship on must not be
       measured on a faster one. */
    provider: {
      order: ["fireworks", "deepinfra", "together"],
      only: ["fireworks", "deepinfra", "together"],
      zdr: true,
      require_parameters: true,
      allow_fallbacks: true,
    },
    setting: "reasoning effort `none`; Fireworks, DeepInfra or Together, zero retention",
  },
  {
    name: "luna",
    model: QUICK_MODEL_OPENROUTER,
    reasoning: { effort: "none" },
    provider: { require_parameters: true },
    setting: "reasoning effort `none`; OpenRouter's default upstream",
  },
  {
    name: "haiku",
    model: "anthropic/claude-haiku-4.5",
    /* Haiku 4.5 does not think unless asked to, so nothing is sent. */
    reasoning: null,
    provider: { require_parameters: true },
    setting: "no `reasoning` sent (it does not think unless asked); OpenRouter's default upstream",
  },
];

export const PICK_ARMS = ["jev-pick", "jev-words", ...CHAT_ARMS.map((a) => a.name)] as const;
export const ARGUMENT_ARMS = CHAT_ARMS.map((a) => `arg-${a.name}`);
export const HYBRID_ARMS = CHAT_ARMS.map((a) => `hyb-${a.name}`);
export const ALL_ARMS: readonly string[] = [...PICK_ARMS, ...ARGUMENT_ARMS, ...HYBRID_ARMS];

export interface Row {
  phrase: string;
  arm: string;
  model: string;
  at: string;
  pick: string | null;
  /** Jev's `confidence`; a chat model's own 0–1 report of how sure it is. */
  confidence: number | null;
  /** Jev: the probability of every option. */
  probabilities: Record<string, number> | null;
  argument: string | null;
  /** `jev-words`: each word of the sentence and the probability it is part of the argument. */
  words: { word: string; p: number | null }[] | null;
  latencyMs: number | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  reasoningTokens: number | null;
  upstream: string | null;
  error: string | null;
}

const APP =
  "Spideryarn is a reading app. The reader has one article open and has typed or spoken a request into the app's command bar. Each command below is something the app can do right now.";
const NONE_TEXT =
  "None of these commands does what the reader asked — the app cannot do it, or it is not a request to the app at all. Choose this rather than a command that only sounds related.";

function describe(c: CatalogueRow): string {
  return `${c.label} — ${c.description}${c.aliases.length ? ` (also called: ${c.aliases.join(", ")})` : ""}`;
}

export const sentenceWords = (text: string): string[] => text.trim().split(/\s+/);
export const WORD_THRESHOLD = 0.5;
/** A word with the punctuation round it taken off, as the argument is scored. */
export const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

function jevQuestions(p: Phrase, withWords: boolean): Record<string, unknown> {
  const criteria: Record<string, string> = Object.fromEntries(CATALOGUE.map((c) => [c.id, describe(c)]));
  criteria[NONE] = NONE_TEXT;
  const questions: Record<string, unknown> = {
    command: {
      type: "choice",
      instructions: `Which one command should run for the reader's request: "${p.text}"?`,
      criteria,
    },
  };
  if (withWords) {
    sentenceWords(p.text).forEach((word, i) => {
      questions[`w${i + 1}`] = {
        type: "noul",
        instructions: `Is word ${i + 1} ("${word}") of the reader's request part of the thing the reader wants looked for, defined or tagged, as opposed to the words asking for it?`,
      };
    });
  }
  return questions;
}

function pickMessages(p: Phrase): { role: string; content: string }[] {
  return [
    {
      role: "system",
      content: [
        APP,
        "",
        "Commands (id | what it is):",
        ...CATALOGUE.map((c) => `${c.id} | ${describe(c)}`),
        `${NONE} | ${NONE_TEXT}`,
        "",
        "Choose the one command that should run for the reader's request. Give its id exactly as it is written above.",
        "The five commands whose id starts with arg: need words from the reader: the words to look for, the term to look up, or the tag. Give those words as argument. Copy them from the reader's request as the reader wrote them, and leave out the words that ask for it and any filler such as \"um\". For every other id, argument is null.",
        "confidence is how sure you are that this is the command the reader meant, from 0 to 1.",
        'Answer with JSON only: {"id": "<command id or none>", "argument": <string or null>, "confidence": <0 to 1>}',
      ].join("\n"),
    },
    { role: "user", content: p.text },
  ];
}

const KIND_ASKS: Record<ArgumentKind, { wants: string; thing: string }> = {
  find: { wants: "find a word, a name or a phrase in the article", thing: "the words to look for" },
  "jump-first": { wants: "go to the first place the article says a word, a name or a phrase", thing: "the words to look for" },
  glossary: { wants: "know what one term means", thing: "the term" },
  "tag-add": { wants: "put a tag on the article", thing: "the tag" },
  "tag-remove": { wants: "take a tag off the article", thing: "the tag" },
};

function argumentMessages(p: Phrase, kind: ArgumentKind): { role: string; content: string }[] {
  const ask = KIND_ASKS[kind];
  return [
    {
      role: "system",
      content: [
        `A reader has an article open in a reading app and typed or said a request. The reader wants to ${ask.wants}.`,
        `Copy ${ask.thing} out of the request, as the reader wrote them. Leave out the words that ask for it and any filler such as "um".`,
        'Answer with JSON only: {"argument": "<the words>"}',
      ].join("\n"),
    },
    { role: "user", content: p.text },
  ];
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function blank(p: Phrase, arm: string, model: string): Row {
  return {
    phrase: p.id,
    arm,
    model,
    at: new Date().toISOString(),
    pick: null,
    confidence: null,
    probabilities: null,
    argument: null,
    words: null,
    latencyMs: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    reasoningTokens: null,
    upstream: null,
    error: null,
  };
}

async function runJev(p: Phrase, row: Row, withWords: boolean): Promise<unknown> {
  const words = sentenceWords(p.text);
  const state = withWords
    ? { app: APP, reader_request: p.text, words: Object.fromEntries(words.map((w, i) => [`word ${i + 1}`, w])) }
    : { app: APP, reader_request: p.text };
  const r = await jevDecide(state, jevQuestions(p, withWords));
  const a = r.answers.command;
  row.pick = a?.choice ?? null;
  row.confidence = a?.confidence ?? null;
  row.probabilities = a?.probabilities ?? null;
  row.latencyMs = r.latencyMs;
  row.costUsd = r.costUsd;
  row.tokensIn = r.inputTokens;
  row.tokensOut = r.outputTokens;
  if (withWords) {
    row.words = words.map((word, i) => ({ word, p: r.answers[`w${i + 1}`]?.noul ?? null }));
    row.argument = row.words
      .filter((w) => (w.p ?? 0) >= WORD_THRESHOLD)
      .map((w) => bare(w.word))
      .join(" ");
    if (row.words.some((w) => w.p === null)) row.error = "a word question came back unanswered";
  }
  if (row.pick === null) row.error = "no choice in the answer";
  return r.body;
}

async function runChat(p: Phrase, row: Row, arm: ChatArm, kind: ArgumentKind | null): Promise<unknown> {
  const argumentOnly = kind !== null;
  const r = await chatAsk(arm, kind !== null ? argumentMessages(p, kind) : pickMessages(p), argumentOnly ? 100 : 200);
  row.latencyMs = r.latencyMs;
  row.costUsd = r.costUsd;
  row.tokensIn = r.inputTokens;
  row.tokensOut = r.outputTokens;
  row.reasoningTokens = r.reasoningTokens;
  row.upstream = r.upstream;
  const parsed = parseJson(r.content);
  row.argument = typeof parsed?.argument === "string" ? parsed.argument : null;
  if (argumentOnly) {
    if (row.argument === null) row.error = `no argument in the answer (finish ${r.finishReason})`;
  } else {
    row.pick = typeof parsed?.id === "string" ? parsed.id : null;
    row.confidence = typeof parsed?.confidence === "number" ? parsed.confidence : null;
    if (row.pick === null) row.error = `no id in the answer (finish ${r.finishReason})`;
  }
  return r.body;
}

export function loadRows(arm: string): Row[] {
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
  const arms = flag("--arm")?.split(",") ?? ALL_ARMS;
  for (const arm of arms) if (!ALL_ARMS.includes(arm)) throw new Error(`no arm called ${arm}; there are ${ALL_ARMS.join(", ")}`);
  mkdirSync(path.join(RESULTS_DIR, "raw"), { recursive: true });
  let spent = 0;

  for (const arm of arms) {
    const hybrid = arm.startsWith("hyb-");
    const argumentOnly = arm.startsWith("arg-") || hybrid;
    const chat = CHAT_ARMS.find((a) => a.name === (argumentOnly ? arm.slice(4) : arm));
    /* The kind the extractor is told: the right one for `arg-`, Jev's for `hyb-`. */
    const jevPicks = new Map(hybrid ? loadRows("jev-pick").map((r) => [r.phrase, r.pick]) : []);
    if (hybrid && jevPicks.size < PHRASES.length) throw new Error(`${arm} needs jev-pick's answer for every phrase first`);
    const kindFor = (p: Phrase): ArgumentKind | null => {
      if (!argumentOnly) return null;
      const id = hybrid ? (jevPicks.get(p.id) ?? "") : (p.accept[0] ?? "");
      return id.startsWith("arg:") ? (id.slice("arg:".length) as ArgumentKind) : null;
    };
    const rows = new Map(loadRows(arm).map((r) => [r.phrase, r]));
    const raws = new Map<string, unknown>();
    const rawFile = path.join(RESULTS_DIR, "raw", `${arm}.json`);
    if (existsSync(rawFile)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(rawFile, "utf8")) as Record<string, unknown>)) raws.set(k, v);
    const todo = PHRASES.filter(
      (p) =>
        (!argumentOnly || (hybrid ? kindFor(p) !== null : wantsArgument(p))) &&
        (!only || only.includes(p.id)) &&
        (force || !rows.get(p.id) || rows.get(p.id)?.error),
    );
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < todo.length) {
          if (spent > BUDGET_USD) throw new Error(`stopped: this run has spent $${spent.toFixed(2)}, over the $${BUDGET_USD} ceiling`);
          const p = todo[next++];
          if (!p) break;
          const row = blank(p, arm, chat?.model ?? JEV_MODEL);
          let raw: unknown = null;
          try {
            raw = chat ? await runChat(p, row, chat, kindFor(p)) : await runJev(p, row, arm === "jev-words");
            if (hybrid) row.pick = jevPicks.get(p.id) ?? null;
          } catch (e) {
            row.error = e instanceof Error ? e.message.slice(0, 500) : String(e);
          }
          spent += row.costUsd ?? 0;
          rows.set(p.id, row);
          if (raw !== null) raws.set(p.id, raw);
          console.log(
            `${arm} ${p.id}: ${row.pick ?? "-"} conf=${row.confidence?.toFixed(2) ?? "-"} arg=${row.argument ?? "-"} ${row.latencyMs} ms $${row.costUsd ?? "?"} think=${row.reasoningTokens ?? "-"} total=$${spent.toFixed(4)}${row.error ? `  ERROR ${row.error.slice(0, 300)}` : ""}`,
          );
        }
      }),
    );
    const ordered = PHRASES.map((p) => rows.get(p.id)).filter((r): r is Row => r !== undefined);
    writeFileSync(path.join(RESULTS_DIR, `${arm}.json`), `${JSON.stringify(ordered, null, 1)}\n`);
    writeFileSync(rawFile, `${JSON.stringify(Object.fromEntries(raws))}\n`);
  }
  console.log(`this run spent $${spent.toFixed(4)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await withLedger("eval", main);
}
