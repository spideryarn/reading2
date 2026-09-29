/**
 * **The FAQ's prioritised order: which questions are on screen, and in what
 * order.** Pure, and apart from the panel so the eval can call the rule the
 * reader actually gets (evals/faq-levels/run.ts) rather than a copy of it.
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-5D):
 *
 * > The FAQ questions seemed pretty kind of dense and low level. I wonder if we
 * > could perhaps start with a few that are a little bit more high level. […]
 * > we could have a prioritized ordering by default with a threshold, and the
 * > threshold could be some compound of difficulty and centrality. And then it
 * > would show them in order given that threshold.
 *
 * ## The compound, and why it is not the Glossary's
 *
 * **`centrality × (1 − difficulty)`** — central and approachable scores
 * highest. The Glossary multiplies `difficulty × centrality` because it
 * measures the cost of *not knowing a term*, which sends easy-and-central to
 * the bottom; for a question, easy-and-central is exactly the high-level one
 * Greg asked to see first. So the same two scores, the same multiplication, and
 * difficulty turned round.
 *
 * ## One number gates and orders
 *
 * The Glossary gates on its product and orders by first use, because two noisy
 * scores multiplied "group well and rank badly". Here the order *is* the point
 * of the request — start with the high-level ones — so the same number orders
 * the survivors, highest first, with reading order breaking ties. One number
 * doing both jobs means dragging the bar right trims the list **from the
 * bottom**, which is what a reader expects of it; gating on one score and
 * ordering on the other made the slider pull rows out of the middle (GPT Sol's
 * plan review, F1). If this sort proves unstable between runs, the fallback is
 * the Glossary's rule: gate on the product, order by reading order.
 *
 * **Unscored questions survive every bar** (threshold.ts § survivesThreshold)
 * and go after the scored ones, in reading order: a question the model did not
 * score is not one it scored low. A list with no scores at all — every list
 * before `faq/4` — cannot be prioritised, and falls back to reading order with
 * no slider, exactly as it was drawn before.
 *
 * docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md.
 */

import type { FaqQuestion } from "../types.js";
import {
  applyThreshold,
  canThreshold,
  hiddenNote,
  thresholdMax,
  type ThresholdResult,
} from "./threshold.js";

/**
 * The two orders — `?faqby=` in the URL (params.ts § faqOrderParam). Here
 * rather than in params.ts so this module stays importable from Node (the
 * eval) without the client-only modules params.ts pulls in.
 */
export const FAQ_ORDERS = ["prioritised", "document"] as const;
export type FaqOrder = (typeof FAQ_ORDERS)[number];

/** The two scores the order reads — structurally, so a visitor's question and the eval's both fit. */
type Scored = Pick<FaqQuestion, "difficulty" | "centrality">;

/**
 * The bar's **starting** position on `centrality × (1 − difficulty)`. `?faqbar=`
 * overrides it and has no default of its own, so absent keeps meaning *nobody
 * has touched it*.
 *
 * **`0.20`, measured** — Greg, 2026-09-12: *"most of the entries are coming
 * in by default"*. Over twelve `faq/4` lists on six articles
 * (evals/faq-levels/calibrate.ts) it shows 89% on the three it was chosen on
 * and 91% on the three held out, against a predeclared floor of 80% and the
 * Glossary's 87%; the lowest single list shows 71%. `0.10` would show 97% and
 * hide almost nothing, which is not the density Greg asked to have trimmed;
 * `0.25` falls to 75% on the calibration half. The table is in the plan's
 * § Progress.
 */
export const FAQ_BAR_DEFAULT = 0.2;

/** `centrality × (1 − difficulty)`, or nothing if either is missing. */
export function priorityOf(question: Scored): number | undefined {
  if (question.difficulty === undefined || question.centrality === undefined) return undefined;
  return question.centrality * (1 - question.difficulty);
}

/** Can any position of the bar hide anything? If not, there is no prioritised order to offer. */
export function canPrioritise(questions: readonly Scored[]): boolean {
  return canThreshold(questions, priorityOf);
}

/** The order actually in force: `prioritised` falls back to reading order when there is nothing to gate. */
export function effectiveOrder(questions: readonly Scored[], order: FaqOrder): FaqOrder {
  if (order !== "prioritised") return order;
  return canPrioritise(questions) ? "prioritised" : "document";
}

/** The bar applied once: what survives, in reading order, and how many went. */
export function visibleQuestions<Q extends Scored>(questions: readonly Q[], bar: number): ThresholdResult<Q> {
  return applyThreshold(questions, bar, priorityOf);
}

/** The slider's rendered maximum. threshold.ts § thresholdMax. */
export function barMax(questions: readonly Scored[], bar: number): number {
  return thresholdMax(questions, bar, priorityOf);
}

/**
 * The list the panel draws. `document` is the artefact's own order — reading
 * order, fixed at write time (src/faq.ts). `prioritised` is what survives the
 * bar, highest priority first, reading order breaking ties, unscored last.
 */
export function orderQuestions<Q extends Scored>(
  questions: readonly Q[],
  order: FaqOrder,
  bar: number = FAQ_BAR_DEFAULT,
): Q[] {
  switch (order) {
    case "document":
      return [...questions];
    case "prioritised": {
      const { visible } = visibleQuestions(questions, bar);
      return visible
        .map((question, index) => ({ question, index, p: priorityOf(question) }))
        .sort((a, b) => {
          if (a.p === undefined && b.p === undefined) return a.index - b.index;
          if (a.p === undefined) return 1;
          if (b.p === undefined) return -1;
          return b.p - a.p || a.index - b.index;
        })
        .map(({ question }) => question);
    }
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}

/** What a reader sees on opening the mode with nothing in the URL. */
export function defaultView<Q extends Scored>(questions: readonly Q[]): Q[] {
  return orderQuestions(questions, effectiveOrder(questions, "prioritised"), FAQ_BAR_DEFAULT);
}

/** The foot line under the bar. threshold.ts § hiddenNote. */
export function faqNote(hidden: number, total: number): string {
  return hiddenNote(hidden, total, { one: "question", many: "questions" });
}

/**
 * The two raw scores for `ScoreBars` — drawn, never printed, and never the
 * compound (ScoreBars.tsx § What it does NOT do). The labels say what each
 * measures *for a question*, which is not what the Glossary's say for a term.
 */
export function scoresOf(question: Scored): { key: string; label: string; value: number }[] {
  /* Centrality on top, as in the Glossary: the upper bar takes the accent and
     is the load-bearing one (quotes.css § `.score-bar-fill.centrality`). */
  const out: { key: string; label: string; value: number }[] = [];
  if (question.centrality !== undefined) {
    out.push({
      key: "centrality",
      label: "centrality (how much of the argument turns on it)",
      value: question.centrality,
    });
  }
  if (question.difficulty !== undefined) {
    out.push({
      key: "difficulty",
      label: "difficulty (how much of the piece you need first)",
      value: question.difficulty,
    });
  }
  return out;
}
