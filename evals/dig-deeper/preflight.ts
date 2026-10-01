/**
 * **The bill, before anything is bought** — plan 261001s § Spend. Free: it
 * builds every request of the selection from the captures (or, where an
 * example is not captured yet, from the article and a stand-in for the
 * findings), counts tokens at four characters each, and prices them at
 * today's listing (`PRICES`).
 *
 * The cache is modelled the way the run will meet it: a prefix (model ×
 * system prompt × article) is written by the first call that sends it and
 * read by every later one — so `opus-b`, the Opus check and the second Kuhn
 * example read what `opus` wrote, and Kimi, with no cache discount, pays full
 * input every time. Output is assumed, per call, at the figures below; the
 * real bill is the calls' own reported cost, and the budget's reservations
 * are what stop a bad guess from overspending.
 */
import type { AiRequestBody } from "../../src/ai-call.js";
import { estimateTokens } from "../../src/article-prompt.js";
import { type Arm, articlePartText, armById, judgeById, lastPartText, priceOf, readPrice, systemText, writePrice } from "./arms.js";
import { cellRequests } from "./answer.js";
import type { Capture } from "./capture.js";
import type { Example } from "./examples.js";
import { JUDGE_SYSTEM } from "./judge.js";
import type { Selection } from "./manifest.js";

/** Assumed output tokens per call, reasoning included. Opus answers measured ~1,350-1,750 (plan 261001p). */
export const ASSUMED = {
  answerOut: 2_000,
  checkOut: 900,
  judgeOut: 2_500,
  /** Words of one answer as a judge reads it, in tokens. */
  answerAsRead: 700,
  goldTokens: 450,
  /** Search step plus, on Citations, *Look it up* and the passages call — when no capture says. */
  captureUsd: { glossary: 0.008, comment: 0.008, citation: 0.12 },
  probeUsd: 0.012,
  finalistSearchFeesUsd: 0.02,
} as const;

export interface Bill {
  parts: { part: string; usd: number; calls: number; note?: string }[];
  total: number;
}

/** A call's estimated cost against a cache that remembers which prefixes have been written. */
function priced(warm: Set<string>, model: string, prefixKey: string, prefixTokens: number, suffixTokens: number, outTokens: number): number {
  const p = priceOf(model);
  const key = `${model}|${prefixKey}`;
  const prefixPrice = warm.has(key) ? readPrice(p) : writePrice(p);
  warm.add(key);
  return (prefixTokens * prefixPrice + suffixTokens * p.input + outTokens * p.output) / 1e6;
}

function sizes(request: AiRequestBody): { prefixKey: string; prefix: number; suffix: number } {
  const system = systemText(request);
  const article = articlePartText(request);
  const last = lastPartText(request);
  return { prefixKey: `${system.length}:${system.slice(0, 64)}|${article.length}`, prefix: estimateTokens(system) + estimateTokens(article), suffix: estimateTokens(last) };
}

/**
 * The bill for `sel` (and, optionally, a finalist run of `finalists` arms
 * plus Opus). `captures` holds what exists; `standIn` builds a capture-shaped
 * request for an example that has none.
 */
export function estimateBill(args: {
  sel: Selection;
  examples: readonly Example[];
  captures: ReadonlyMap<string, Capture>;
  standIn: (example: Example) => Capture;
  finalists: readonly string[];
  /** Captures already bought are not billed again. */
  includeCapture: boolean;
}): Bill {
  const { sel } = args;
  const warm = new Set<string>();
  const parts = new Map<string, { usd: number; calls: number; note?: string }>();
  const add = (part: string, usd: number, note?: string) => {
    const p = parts.get(part) ?? { usd: 0, calls: 0, ...(note ? { note } : {}) };
    p.usd += usd;
    p.calls += 1;
    parts.set(part, p);
  };

  /* Same-article examples next to each other, as the runner orders them. */
  const ordered = orderForCache(args.examples.filter((e) => sel.examples.includes(e.id)));
  const capOf = (e: Example) => args.captures.get(e.id) ?? args.standIn(e);

  if (args.includeCapture) {
    for (const e of ordered) {
      const cap = args.captures.get(e.id);
      if (cap) continue;
      add("capture", ASSUMED.captureUsd[e.entry], "estimated");
    }
  }

  for (const e of ordered) {
    const cap = capOf(e);
    for (let run = 1; run <= sel.runs; run++) {
      /* `opus` first in every run, so the others read its prefix. */
      const arms = [...sel.arms].sort((a, b) => (a === "opus" ? -1 : b === "opus" ? 1 : 0));
      for (const id of arms) {
        const arm: Arm = armById(id);
        const reqs = cellRequests({ capture: cap, arm, ceiling: 4_000, mode: "isolated", article: { meta: {} as never, blocks: [] } });
        let usd = 0;
        reqs.forEach((r, i) => {
          const z = sizes(r.request);
          const isCheck = arm.kind === "check" && i === 1;
          usd += priced(warm, r.request.model, z.prefixKey, z.prefix, z.suffix + (isCheck ? ASSUMED.answerAsRead : 0), isCheck ? ASSUMED.checkOut : ASSUMED.answerOut);
        });
        add(`answers: ${id}`, usd);
      }
    }
  }

  const judgeCalls = (pass: string, runs: number, batchSize: number[], judges: readonly string[]) => {
    for (const e of ordered) {
      const cap = capOf(e);
      const req = cellRequests({ capture: cap, arm: armById("opus"), ceiling: 4_000, mode: "isolated", article: { meta: {} as never, blocks: [] } })[0]?.request;
      if (!req) continue;
      const article = estimateTokens(articlePartText(req));
      const last = estimateTokens(lastPartText(req));
      for (let run = 1; run <= runs; run++) {
        for (const j of judges) {
          const judge = judgeById(j);
          for (const size of batchSize) {
            add(
              `judges${pass}: ${j}`,
              priced(warm, judge.model, `judge|${e.slug}`, estimateTokens(JUDGE_SYSTEM) + article, last + ASSUMED.goldTokens + size * ASSUMED.answerAsRead, ASSUMED.judgeOut),
            );
          }
        }
      }
    }
  };
  const others = sel.arms.filter((a) => a !== "opus").length;
  const count = Math.max(1, Math.ceil(others / 4));
  const batchSizes = Array.from({ length: count }, (_, i) => Math.floor(others / count) + (i < others % count ? 1 : 0) + 1);
  judgeCalls("", sel.runs, batchSizes, sel.judges);
  if (sel.rejudge) judgeCalls(" (re-judge)", 1, batchSizes, sel.judges);

  if (args.finalists.length > 0) {
    for (const e of ordered) {
      const cap = capOf(e);
      for (const id of ["opus", ...args.finalists.filter((a) => a !== "opus")]) {
        const arm = armById(id);
        const r = cellRequests({ capture: cap, arm, ceiling: 4_000, mode: "production", article: { meta: {} as never, blocks: [] } })[0];
        if (!r) continue;
        const z = sizes(r.request);
        add("finalists: answers", priced(warm, r.request.model, `prod|${z.prefixKey}`, z.prefix, z.suffix, ASSUMED.answerOut) + ASSUMED.finalistSearchFeesUsd);
      }
    }
    judgeCalls(" (finalists)", 1, [args.finalists.length + 1], sel.judges);
    for (const _ of args.finalists) add("probe", ASSUMED.probeUsd, "estimated");
  }

  const list = [...parts.entries()].map(([part, p]) => ({ part, ...p }));
  return { parts: list, total: list.reduce((n, p) => n + p.usd, 0) };
}

/** Examples on the same article next to each other, first-seen order kept, so the second reads the first's cache. */
export function orderForCache<T extends { slug: string }>(examples: readonly T[]): T[] {
  const slugs = [...new Set(examples.map((e) => e.slug))];
  return slugs.flatMap((s) => examples.filter((e) => e.slug === s));
}

export function renderBill(bill: Bill, cap: number): string {
  const lines = bill.parts.map((p) => `  ${p.part.padEnd(34)} ${String(p.calls).padStart(4)} calls  $${p.usd.toFixed(2).padStart(7)}${p.note ? `  (${p.note})` : ""}`);
  lines.push(`  ${"TOTAL".padEnd(34)}             $${bill.total.toFixed(2).padStart(7)}  — ${bill.total <= cap ? "fits under" : "OVER"} the $${cap.toFixed(2)} cap`);
  return lines.join("\n");
}
