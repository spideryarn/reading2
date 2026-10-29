/**
 * **Explanations' orders and its prioritised default: which places are on
 * screen, and in what order.** Pure, beside `faq-order.ts`, so a test calls the
 * rule the reader actually gets.
 *
 * Greg, 2026-10-28 (spya-ay3u4w):
 *
 * > For the explanations mode, I suggested that you borrow from the glossary
 * > UI. So I was expecting different orderings and a prioritized default with
 * > thresholding and an option to find more.
 *
 * ## Glossary's rule, not the FAQ's
 *
 * **`difficulty × centrality` gates; reading order orders.** Glossary's
 * product measures the cost of *not knowing* a term; for a passage it is the
 * cost of *not getting past* it — the same question, so the same arithmetic
 * (GlossaryPanel.tsx § prioritised). The FAQ turns difficulty round because
 * for a question, easy-and-central is the high-level one Greg wanted first;
 * that does not apply to a place a reader gets stuck. And a product of two
 * noisy model scores groups well and ranks badly, so it decides one thing —
 * shown or hidden — and what is shown stays in the reader's own order.
 *
 * **Unscored explanations survive every bar** (threshold.ts §
 * survivesThreshold): every `explanations/1` list has no scores, and such a
 * list cannot be prioritised at all — `availableOrders` offers no order row,
 * and it looks as it did before.
 *
 * docs/plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md § 2b.
 */

import type { Explanation } from "../types.js";
import {
  applyThreshold,
  canThreshold,
  floorToGateStep,
  hiddenNote,
  survivesThreshold,
  thresholdMax,
  thresholdStops,
  type ThresholdResult,
} from "./threshold.js";

/**
 * The four orders — `?explby=` in the URL. **The type lives here and the
 * runtime list, `EXPLANATION_ORDERS`, in params.ts**, for faq-order.ts's
 * reason: params.ts is on the reader's startup path, and a value import from
 * it would drag this module into every first load.
 */
export type ExplanationOrder = "prioritised" | "document" | "difficulty" | "centrality";

/** The two scores the order reads. */
type Scored = Pick<Explanation, "difficulty" | "centrality">;

/**
 * The bar's **starting** position on `difficulty × centrality`. `?explbar=`
 * overrides it and has no default of its own, so absent means *nobody has
 * touched it*.
 *
 * **`0.10`, Glossary's, borrowed rather than measured** — Greg's 2026-09-12
 * rule is that most entries come in by default. No model could be called when
 * this was built (the key was over its limit until 1 November), so it is
 * calibrated on real `explanations/2` lists after that, as plan 260915d did
 * for the Glossary.
 */
export const EXPLANATIONS_BAR_DEFAULT = 0.1;

/** `difficulty × centrality`, or nothing if either is missing. */
export function priorityOf(explanation: Scored): number | undefined {
  if (explanation.difficulty === undefined || explanation.centrality === undefined) return undefined;
  return explanation.difficulty * explanation.centrality;
}

/** Can any position of the bar hide anything? If not, there is no prioritised order to offer. */
export function canPrioritise(explanations: readonly Scored[]): boolean {
  return canThreshold(explanations, priorityOf);
}

/** One order's button: its key, its label, and what it does in words. */
export interface ExplanationOrderOption {
  key: ExplanationOrder;
  label: string;
  title: string;
}

/**
 * The orders worth a button, in the order they are drawn — Glossary's labels,
 * except *reading order* for its *first use* (an explanation has no "use") —
 * or none, when fewer than two would be, and none below two explanations.
 * `prioritised` only when the bar can hide something; a score order only when
 * some explanation carries that score (GlossaryPanel.tsx § sortOptions).
 */
export function availableOrders(explanations: readonly Scored[]): ExplanationOrderOption[] {
  const out: ExplanationOrderOption[] = [
    ...(canPrioritise(explanations)
      ? [
          {
            key: "prioritised" as const,
            label: "prioritised",
            title:
              "Only the places most likely to stop you on the way through the argument, in reading order — the threshold below decides how many",
          },
        ]
      : []),
    { key: "document", label: "reading order", title: "In the order they come in the article" },
    ...(explanations.some((e) => e.difficulty !== undefined)
      ? [
          {
            key: "difficulty" as const,
            label: "hardest",
            title: "The model's judgment of how likely you are to get stuck at each place",
          },
        ]
      : []),
    ...(explanations.some((e) => e.centrality !== undefined)
      ? [
          {
            key: "centrality" as const,
            label: "most central",
            title: "The model's judgment of how much of the argument depends on getting past each place",
          },
        ]
      : []),
  ];
  return explanations.length < 2 || out.length < 2 ? [] : out;
}

/** The order actually in force: one unavailable for this list falls back to reading order. */
export function effectiveOrder(explanations: readonly Scored[], order: ExplanationOrder): ExplanationOrder {
  return availableOrders(explanations).some((o) => o.key === order) ? order : "document";
}

/** The bar applied once: what survives, in reading order, and how many went. */
export function visibleExplanations<E extends Scored>(explanations: readonly E[], bar: number): ThresholdResult<E> {
  return applyThreshold(explanations, bar, priorityOf);
}

/** The slider's rendered maximum. threshold.ts § thresholdMax. */
export function barMax(explanations: readonly Scored[], bar: number): number {
  return thresholdMax(explanations, bar, priorityOf);
}

/** The bars that change the list — threshold.ts § thresholdStops. */
export function barStops(explanations: readonly Scored[]): number[] {
  return thresholdStops(explanations, priorityOf, floorToGateStep);
}

/**
 * The list the band draws. `document` is the artefact's own order — reading
 * order, fixed at write time (src/explanations.ts). `prioritised` is what
 * survives the bar, still in reading order. A score order is every
 * explanation, highest first, reading order breaking ties, a missing score last.
 */
export function orderExplanations<E extends Scored>(
  explanations: readonly E[],
  order: ExplanationOrder,
  bar: number = EXPLANATIONS_BAR_DEFAULT,
): E[] {
  switch (order) {
    case "document":
      return [...explanations];
    case "prioritised":
      return visibleExplanations(explanations, bar).visible;
    case "difficulty":
    case "centrality":
      return explanations
        .map((e, index) => ({ e, index, s: e[order] }))
        .sort((a, b) => {
          if (a.s === undefined && b.s === undefined) return a.index - b.index;
          if (a.s === undefined) return 1;
          if (b.s === undefined) return -1;
          return b.s - a.s || a.index - b.index;
        })
        .map(({ e }) => e);
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}

/**
 * **The bar that puts a hidden explanation back**, or null when nothing should
 * move — Glossary's `gateToReveal`, for the margin's *Open in Explanations*
 * (Sol F4). Lowered, never cleared, so the slider visibly moves; null in any
 * other order, where the bar is dormant and must not move behind the reader's
 * back; floored to the step, so the value the URL prints is not above the
 * explanation it was set to reveal.
 */
export function barToReveal(
  explanations: readonly (Scored & { id: string })[],
  id: string,
  order: ExplanationOrder,
  bar: number,
): number | null {
  if (effectiveOrder(explanations, order) !== "prioritised") return null;
  const found = explanations.find((e) => e.id === id);
  const p = found ? priorityOf(found) : undefined;
  if (p === undefined || survivesThreshold(p, bar)) return null;
  return floorToGateStep(p);
}

/** The foot line under the bar. threshold.ts § hiddenNote. */
export function explanationsNote(hidden: number, total: number): string {
  return hiddenNote(hidden, total, { one: "explanation", many: "explanations" });
}

/** One score drawn on a row, with what it measures — for `ScoreBars`. */
export interface ExplanationRowScore {
  key: "difficulty" | "centrality";
  label: string;
  value: number;
}

const SCORE_LABEL: Record<ExplanationRowScore["key"], string> = {
  difficulty: "Difficulty — how likely you are to get stuck here",
  centrality: "Centrality — how much of the argument depends on getting past it",
};

/**
 * **A row shows exactly the scores its position was decided on** — Glossary's
 * `rowScores`: one under *hardest* or *most central*, both under
 * *prioritised* (and neither if either is missing, since then the row was not
 * gated), none in reading order. Never the product: that is our arithmetic,
 * not the model's judgment.
 */
export function rowScores(explanation: Scored, order: ExplanationOrder): ExplanationRowScore[] {
  const d = explanation.difficulty;
  const c = explanation.centrality;
  const row = (key: ExplanationRowScore["key"], value: number) => ({ key, label: SCORE_LABEL[key], value });
  switch (order) {
    case "difficulty":
      return d === undefined ? [] : [row("difficulty", d)];
    case "centrality":
      return c === undefined ? [] : [row("centrality", c)];
    case "prioritised":
      return d === undefined || c === undefined ? [] : [row("difficulty", d), row("centrality", c)];
    case "document":
      return [];
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}
