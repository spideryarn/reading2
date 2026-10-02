/**
 * **The judge panel** — three families, so no family grades itself alone
 * (plan 261001s § Judging).
 *
 * Its own file, not `arms.ts`, because `arms.ts` is part of every answer
 * cell's key (`ANSWER_SOURCE` in run.ts): a judge listed there could not be
 * changed without marking every bought answer stale. Which judges read the
 * answers does not change the answers.
 *
 * **Grok 4.7, not Kimi K3, is the third family** (2026-10-02, after the
 * answer run). Kimi K3 was the plan's pick for its long-context score, but as
 * an answer arm it delivered 3 of 18 presses: every Kuhn request (~255k
 * tokens) came back 429 across two sessions, and most others ran past
 * explain's two minutes. A judge that cannot read the Kuhn article would leave
 * those batches with two judges. Grok 4.7 is the next family on Artificial
 * Analysis's index (46) and its 500k window takes Kuhn whole.
 *
 * `arms.ts` still exports its original `JUDGES` / `judgeById` (with Kimi),
 * unused, because editing that file would re-key the answers; this file is
 * the one everything imports.
 */
import type { AiRequestBody } from "../../src/ai-call.js";
import { estimateTokens } from "../../src/article-prompt.js";
import { MODELS } from "./arms.js";

export interface Judge {
  id: string;
  model: string;
  contextTokens: number;
}

export const JUDGES: readonly Judge[] = [
  { id: "opus", model: MODELS.opus, contextTokens: 1_000_000 },
  { id: "sol", model: MODELS.sol, contextTokens: 1_050_000 },
  { id: "grok", model: MODELS.grok, contextTokens: 500_000 },
];

export function judgeById(id: string): Judge {
  const j = JUDGES.find((x) => x.id === id);
  if (!j) throw new Error(`no judge "${id}" — known: ${JUDGES.map((x) => x.id).join(", ")}`);
  return j;
}

/** Refuse locally before a replacement judge is sent more context than its listing permits. */
export function assertJudgeRequestFits(id: string, request: AiRequestBody): void {
  const judge = judgeById(id);
  const output = typeof request.max_tokens === "number" ? request.max_tokens : 0;
  const estimated = estimateTokens(JSON.stringify(request)) + output;
  if (estimated > judge.contextTokens) {
    throw new Error(`${id}: estimated ${estimated} tokens exceeds its ${judge.contextTokens}-token context window`);
  }
}
