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
import { MODELS } from "./arms.js";

export const JUDGES: readonly { id: string; model: string }[] = [
  { id: "opus", model: MODELS.opus },
  { id: "sol", model: MODELS.sol },
  { id: "grok", model: MODELS.grok },
];

export function judgeById(id: string): { id: string; model: string } {
  const j = JUDGES.find((x) => x.id === id);
  if (!j) throw new Error(`no judge "${id}" — known: ${JUDGES.map((x) => x.id).join(", ")}`);
  return j;
}
