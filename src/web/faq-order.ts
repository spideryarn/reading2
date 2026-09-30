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
 * The four orders — `?faqby=` in the URL. **The type lives here and the runtime
 * list, `FAQ_ORDERS`, in params.ts**, which checks the two agree both ways.
 *
 * Split like that for two reasons that pull in opposite directions. params.ts
 * is on the reader's startup path (main.tsx → App.tsx → Library.tsx →
 * params.ts), so a *value* import from it would drag this module — FAQ-only
 * code — into every reader's first load; tests/eager-client-graph.test.ts
 * failed on exactly that (2026-09-29, it blocked a deploy). And this module
 * must not import params.ts either, not even for a type: the eval imports it
 * from Node, and the server's tsconfig cannot type-check params.ts's `.tsx`
 * neighbours. A type-only import in params.ts is erased, so neither graph
 * sees an edge.
 *
 * **`centrality` and `difficulty` since 2026-09-30** — each score the
 * prioritised order is built from, as its own sort, highest first. Greg
 * (SPIDERYARN-READING2-67): *"the prioritisation must be based on some
 * dimension (or more than one). Let's also make it possible to sort by that
 * too (just as in Glossary we can sort by "hardest", "most central" etc"*. So
 * they behave as the Glossary's do (GlossaryPanel.tsx § sortEntries): every
 * question, no bar, a missing score last. `difficulty` is *hardest* first
 * rather than easiest: the prioritised order already leads with the
 * approachable ones, and hardest-first is the view it does not give.
 * docs/plans/260930d-faq-provenance-into-a-tooltip-and-sort-by-centrality-and-difficulty.md.
 */
export type FaqOrder = "prioritised" | "document" | "centrality" | "difficulty";

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

/**
 * The orders worth a button, in the order the buttons are drawn — or none,
 * when fewer than two would be (a single button is a control that does
 * nothing), and none for a single question. `prioritised` only when the bar
 * can hide something; a single-score
 * order only when at least one question carries that score, as the Glossary
 * offers `hardest` (GlossaryPanel.tsx § sortOptions).
 */
export function availableOrders(questions: readonly Scored[]): FaqOrder[] {
  const out: FaqOrder[] = [
    ...(canPrioritise(questions) ? (["prioritised"] as const) : []),
    "document",
    ...(questions.some((q) => q.centrality !== undefined) ? (["centrality"] as const) : []),
    ...(questions.some((q) => q.difficulty !== undefined) ? (["difficulty"] as const) : []),
  ];
  /* One question has no order: the Glossary offers no sort below two entries
     either (GlossaryPanel.tsx § `sorts`). GPT Sol's plan review, F1. */
  return questions.length < 2 || out.length < 2 ? [] : out;
}

/** The order actually in force: one unavailable for this list falls back to reading order. */
export function effectiveOrder(questions: readonly Scored[], order: FaqOrder): FaqOrder {
  return availableOrders(questions).includes(order) ? order : "document";
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
      return highestFirst(visible, priorityOf);
    }
    case "centrality":
    case "difficulty":
      /* Every question, one score — no bar. */
      return highestFirst(questions, (q) => q[order]);
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}

/**
 * Highest score first, reading order breaking ties, and a missing score after
 * every present one, in reading order — a question the model did not score is
 * not one it scored low.
 */
function highestFirst<Q>(questions: readonly Q[], score: (q: Q) => number | undefined): Q[] {
  return questions
    .map((question, index) => ({ question, index, s: score(question) }))
    .sort((a, b) => {
      if (a.s === undefined && b.s === undefined) return a.index - b.index;
      if (a.s === undefined) return 1;
      if (b.s === undefined) return -1;
      return b.s - a.s || a.index - b.index;
    })
    .map(({ question }) => question);
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
 * The available raw scores for `ScoreBars` — drawn, never printed, and never the
 * compound (ScoreBars.tsx § What it does NOT do). The labels say what each
 * measures *for a question*, which is not what the Glossary's say for a term.
 *
 * **A row draws the scores its position was decided on**, the Glossary's rule:
 * both under `prioritised`, the one under a single-score order, none in
 * reading order.
 */
export function scoresOf(question: Scored, order: FaqOrder): { key: string; label: string; value: number }[] {
  const all = allScoresOf(question);
  switch (order) {
    case "prioritised":
      return all;
    case "centrality":
    case "difficulty":
      return all.filter((s) => s.key === order);
    case "document":
      return [];
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}

function allScoresOf(question: Scored): { key: string; label: string; value: number }[] {
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
