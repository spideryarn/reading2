import type { NextStep } from "../../src/types.js";

/** The answer saying a mode is ready, or made, which the guide never knows. */
const SAYS_READY = /\b(is|are|it's|they're)\s+(now\s+)?(ready|made|generated|prepared)\b|\bready (for you|now)\b/i;

function saysModeIsReady(answer: string): boolean {
  return SAYS_READY.test(answer);
}

export function readyClaimProblem(answer: string): string | undefined {
  return saysModeIsReady(answer) ? "says it is ready" : undefined;
}

/**
 * Whether an answer supplied the preparation action requested by an eval case:
 * a prepare step, or the wanted mode's own button (a next step or an inline
 * chip), which starts the mode on the press too. Accepting the mode's button is
 * deliberate (docs/investigations/261020f, v1's jargon case).
 */
export function satisfiesPrepareRequest(steps: readonly NextStep[], text: string, key: RegExp | undefined): boolean {
  if (steps.some((step) => step.kind === "prepare")) return true;
  if (key === undefined) return false;
  const chips = text.match(/\[cmd:mode:[^\]]*\]/g)?.map(decodeURIComponent).join(" ") ?? "";
  return steps.some((s) => s.kind === "mode" && key.test(s.mode)) || key.test(chips);
}

/** A paid run is a check: a red or empty screen must be a failing command. */
export function prepareEvalExitCode(pass: number, total: number): number {
  return total > 0 && pass === total ? 0 : 1;
}
