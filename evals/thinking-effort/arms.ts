/**
 * The arms and the corpus of the thinking-effort eval (plan 261001p), as
 * data, shared by run.ts (which spends) and lineup.ts (which does not).
 *
 * **Two draws of every arm, not one** — GPT Sol's plan review
 * (reviews/plan-review-sol-r1.md, F1/F2): one draw of a lower arm against one
 * repeat of production cannot tell the lower arm's variance from its level,
 * and a single base/base-repeat gap is not a noise floor. So the default run
 * is `base-a`, `base-b` (today's effort, twice) and `low-a`, `low-b` (the
 * cheapest candidate, twice). `medium-*` is a possible second round, bought
 * only if `low` clearly fails, so it is supported and not run by default.
 */
import { mulberry32 } from "../debate/label-sheet.js";

export const MODES = ["sketch", "ideas", "illustrated"] as const;
export type Mode = (typeof MODES)[number];

export const ARM_NAMES = ["base-a", "base-b", "low-a", "low-b", "medium-a", "medium-b"] as const;
export type ArmName = (typeof ARM_NAMES)[number];

/** What a default run draws. */
export const DEFAULT_ARMS: readonly ArmName[] = ["base-a", "base-b", "low-a", "low-b"];

/** Which rung an arm is on. `base` is whatever production does today. */
export type Level = "base" | "low" | "medium";

export function levelOf(arm: ArmName): Level {
  switch (arm) {
    case "base-a":
    case "base-b":
      return "base";
    case "low-a":
    case "low-b":
      return "low";
    case "medium-a":
    case "medium-b":
      return "medium";
    default: {
      const never: never = arm;
      throw new Error(`unknown arm ${String(never)}`);
    }
  }
}

/**
 * The corpus: eight real articles, full length, from the local database.
 * Three typical-length essays and papers, one long encyclopedic piece, one
 * journal paper with figures, one technical essay with many, and two short.
 */
export const DEFAULT_SLUGS = [
  "replication-crisis-spya-hrjamq",
  "entropy-24-00930-spya-pywwkq",
  "noema-mythology-of-conscious-ai",
  "towards-a-theory-of-bugs-the-ruliology-of-the-unexpected",
  "analog-cognition-and-consciousness-4-28-26-spya-f03kqf",
  "after-work-we-ll-have-each-other-spya-we6h75",
  "spider-silk-spya-ge30uz",
  "cargocult-spya-rz663q",
] as const;

/**
 * Fisher-Yates over a copy, drawing from mulberry32 seeded with `seed` and a
 * string salt — so each (mode, article) gets its own order, every order is
 * reproducible from the one recorded seed, and none depends on the others
 * having been drawn first.
 */
export function seededShuffle<T>(items: readonly T[], seed: number, salt: string): T[] {
  let h = seed >>> 0;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0;
  const random = mulberry32(h);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
