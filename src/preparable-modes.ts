/**
 * **The modes the guide may get ready in the background, and the step each
 * one's own panel starts** — plan docs/plans/261019p-guide-chat-plainer.md
 * § Stage 2b, after Greg's reply to q-y4p2ct:
 *
 * > Maybe we make it an option, so the Guide has the option to do A, but
 * > there's a minimal explanation in the prompt that this incurs expense, so
 * > if it's not confident that the user will want it, it just does B
 * >
 * > — Greg, 2026-10-20 (`spya-tgeg6v`)
 *
 * A guide `prepare` step names one of these keys (src/next-steps.ts); its
 * press, by the reader or by the page (src/web/GuideNextSteps.tsx), asks the
 * server to start the step here (src/prepare-mode.ts). **A fixed list, so a
 * model's key is a lookup, never a step name.**
 *
 * - Each step is what the mode's own band starts on open (src/web/activation.ts
 *   § `MODE_TARGET`, `subModeTarget`): Summary's Brief and Fuller both arm
 *   `simple`, its Thread writes `tweets`, Learn's Quiz arms `quiz`.
 * - **Not `mode:summary`**: its press lands on whichever view the address
 *   holds, so it has no one job (GPT Sol's F1 on the plan).
 * - Not Timeline, FAQ or Diagram: behind the experimental switch, so not guide
 *   modes (`guideModeKeys`). Not Structure: the tree, always there.
 * - Skim reads Quotes and Ideas (`STEP_READS`, src/auto-mode-steps.ts); the
 *   server adds whichever of those the panel would (src/prepare-mode.ts).
 *
 * Node-free: the page reads it to draw the button, the server to check it.
 * tests/guide-prepare-step.test.ts holds every key inside `guideModeKeys()`.
 */
import type { StepName } from "./types.js";

/** The route's one 409 that means an automatic press should fall back to the reader's button. */
export const MODE_PREPARATION_ALREADY_CLAIMED = "This conversation has already started a mode by itself.";

export interface Preparable {
  /** The step the mode's own panel starts. */
  readonly step: "simple" | "tweets" | "glossary" | "quotes" | "ideas" | "skim" | "quiz";
  /** Its name on the button: *Get «name» ready*. */
  readonly name: string;
}

export const PREPARABLE: Readonly<Record<string, Preparable>> = {
  "submode:summary:brief": { step: "simple", name: "Summary" },
  "submode:summary:fuller": { step: "simple", name: "Summary" },
  "submode:summary:thread": { step: "tweets", name: "the Summary thread" },
  "mode:glossary": { step: "glossary", name: "Glossary" },
  "mode:quotes": { step: "quotes", name: "Quotes" },
  "mode:ideas": { step: "ideas", name: "Ideas" },
  "mode:skim": { step: "skim", name: "Skim" },
  "submode:learn:quiz": { step: "quiz", name: "the Quiz" },
};

/** The entry for a key, or `undefined` for anything not on the list. */
export function preparable(key: string): Preparable | undefined {
  return Object.hasOwn(PREPARABLE, key) ? PREPARABLE[key] : undefined;
}

/** Every step a `Preparable` may name, for a test to hold against `StepName`. */
export const PREPARABLE_STEPS: readonly StepName[] = [...new Set(Object.values(PREPARABLE).map((p) => p.step))];
