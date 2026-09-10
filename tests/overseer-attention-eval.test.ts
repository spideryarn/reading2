/**
 * The attention evaluation — tools/overseer/attention-eval.ts, plan 260910f
 * Stage 3 (the metrics wording is GPT Sol's F6 on that plan).
 *
 * Every classifier here is a FAKE, answering from the labels by a rule written
 * out below, so every expected number is derivable by hand from labels.json and
 * that rule. No model is called and no key is read.
 *
 * What this pins, and why each is a separate case:
 *  - the detection counts are exactly what the fake implies — cross-checked
 *    against `scoreMechanical`, an independent scorer of the same set, for the
 *    mechanical side;
 *  - misdirection (D12) never enters precision or recall, even when the model
 *    flags it — the fake flags one on purpose so a leak would move precision;
 *  - a verdict that is not a judgement (`unreadable`, `quota-refused`, budget
 *    `notCalled`) is UNJUDGED, never a negative — a run where nothing was
 *    judged must have no recall at all rather than a recall of zero;
 *  - routing is "not measured" for version-1 verdicts, and N/R/W/K are right
 *    for verdicts that carry a recipient;
 *  - the words a person reads: "could have avoided asking Greg", "not
 *    measured", and no `$0.00` for money nobody could price.
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ClassifierSpend, ClassifierVerdict } from "../tools/overseer/attention-classify.js";
import { PROPOSAL_PROMPT_VERSION, parseVerdict } from "../tools/overseer/attention-classify.js";
import {
  describeEvaluation,
  evaluate,
  fakeClassifierFromLabels,
  loadLabelledSet,
  paidEvalClassifier,
  recipientOf,
  type EvaluationReport,
} from "../tools/overseer/attention-eval.js";
import { scoreMechanical, type AttentionLabel } from "../tools/overseer/attention-labels.js";
import type { ClassifyOutcome } from "../tools/overseer/model-budget.js";
import { readTurnTail } from "../tools/overseer/turn-tail.js";

const { labels, captures } = loadLabelledSet();

const PRICED: ClassifierSpend = { calls: 1, promptTokens: 500, completionTokens: 40, costUsd: 0.001, unpricedCalls: 0 };
const UNPRICED: ClassifierSpend = { calls: 1, promptTokens: 500, completionTokens: 40, costUsd: null, unpricedCalls: 1 };

function question(extra: Record<string, unknown> = {}): ClassifierVerdict {
  return {
    kind: "question",
    topic: "t",
    why: "it hands over a decision",
    attentionKind: "technical",
    answerability: { kind: "phone" },
    ...extra,
  } as ClassifierVerdict;
}
const NO: ClassifierVerdict = { kind: "no-question", why: "nothing handed over" };

const base = (file: string) => file.split("/").pop() ?? file;

/** tail -> label, so a fake that is only handed the tail can answer from the labels. */
function labelByTail(): Map<string, AttentionLabel> {
  const m = new Map<string, AttentionLabel>();
  for (const l of labels) {
    const t = readTurnTail(captures.get(l.file) ?? "");
    if (t.kind === "ended") m.set(t.tail, l);
  }
  return m;
}

type Answer = (label: AttentionLabel) => ClassifyOutcome;

/** A fake that counts itself, so the report's call count is checked against the fake rather than against itself. */
function fake(answer: Answer): { classify: (tail: string) => Promise<ClassifyOutcome>; asked: () => number } {
  const byTail = labelByTail();
  let asked = 0;
  return {
    asked: () => asked,
    classify: async (tail) => {
      asked += 1;
      const label = byTail.get(tail);
      if (label === undefined) throw new Error("the fake was handed a tail it has no label for");
      return answer(label);
    },
  };
}

/**
 * THE DETECTION FAKE. By file:
 *  - every question -> question, EXCEPT sol-sort-order -> no-question (a miss)
 *    and self-reuse-helper -> quota-refused (unjudged);
 *  - rhetorical-closing -> question (a false alarm);
 *  - background-review-sol-in-tmux -> unreadable (unjudged);
 *  - concluded-clean-debrief -> notCalled by the budget (unjudged);
 *  - wrong-task (out of scope) -> question, which must move nothing;
 *  - everything else -> no-question.
 *
 * Over 9 questions and 9 non-questions that gives the model TP 7, FN 1,
 * FP 1, TN 6, unjudged 3 — precision 7/8, recall 7/8.
 */
function detectionAnswer(extra: (l: AttentionLabel) => Record<string, unknown> = () => ({})): Answer {
  return (l) => {
    const f = base(l.file);
    if (f === "concluded-clean-debrief.txt") {
      return { notCalled: { kind: "stopped", stopped: { kind: "exhausted", why: "day ceiling", until: "2026-09-11T00:00:00.000Z" } } };
    }
    if (f === "background-review-sol-in-tmux.txt") return { verdict: { kind: "unreadable", why: "not JSON" }, spend: PRICED };
    if (f === "question-self-reuse-helper.txt") {
      return { verdict: { kind: "quota-refused", status: 429, why: "rate limited" }, spend: PRICED };
    }
    if (f === "question-no-mark-sol-sort-order.txt") return { verdict: NO, spend: PRICED };
    if (f === "rhetorical-closing-why-tests-missed-it.txt") return { verdict: question(extra(l)), spend: PRICED };
    if (f === "wrong-task-hard-version-in-primary.txt") return { verdict: question(extra(l)), spend: PRICED };
    if (l.case === "question") return { verdict: question(extra(l)), spend: PRICED };
    return { verdict: NO, spend: PRICED };
  };
}

const OPTS = { promptVersion: 1, model: "fake/test" };

describe("the labelled set as this suite relies on it", () => {
  it("is 25 items: 9 questions, 9 non-questions, 2 misdirection, 1 permission defect, 4 not ended", () => {
    const count = (c: string) => labels.filter((l) => l.case === c).length;
    expect(labels).toHaveLength(25);
    expect([count("question"), count("no-question"), count("out-of-scope-for-this-detector")]).toEqual([9, 9, 2]);
    expect([count("permission-defect"), count("not-an-ended-turn")]).toEqual([1, 4]);
  });
});

describe("detection", () => {
  it("counts exactly what the fake implies, for the model", async () => {
    const f = fake(detectionAnswer());
    const r = await evaluate(labels, captures, f.classify, OPTS);
    expect(r.detection.model.confusion).toEqual({ tp: 7, fp: 1, fn: 1, tn: 6 });
    expect(r.detection.model.unjudged).toBe(3);
    expect(r.detection.model.judged).toBe(15);
    expect(r.detection.scored).toBe(18);
    expect(r.detection.model.precision).toBeCloseTo(7 / 8, 10);
    expect(r.detection.model.recall).toBeCloseTo(7 / 8, 10);
  });

  it("scores the mechanical inbox side by side, agreeing with scoreMechanical", async () => {
    const r = await evaluate(labels, captures, fake(detectionAnswer()).classify, OPTS);
    const independent = scoreMechanical(labels, captures);
    const m = r.detection.mechanical.confusion;
    expect(m.tp).toBe(independent.questions.caught);
    expect(m.fn).toBe(independent.questions.missed);
    expect(m.fp).toBe(independent.noQuestion.falseAlarms);
    expect(m.tn).toBe(independent.noQuestion.total - independent.noQuestion.falseAlarms);
    // And the numbers themselves, so both scorers drifting together still shows.
    expect(m).toEqual({ tp: 3, fn: 6, fp: 1, tn: 8 });
    expect(r.detection.mechanical.precision).toBeCloseTo(3 / 4, 10);
    expect(r.detection.mechanical.recall).toBeCloseTo(3 / 9, 10);
  });

  it("breaks the counts down per category", async () => {
    const r = await evaluate(labels, captures, fake(detectionAnswer()).classify, OPTS);
    const cat = (c: string) => r.detection.perCategory.find((p) => p.category === c);
    expect(cat("rhetorical")).toMatchObject({ labelled: 2, model: { flagged: 1, notFlagged: 1, unjudged: 0 } });
    expect(cat("background-review")).toMatchObject({ labelled: 4, model: { flagged: 0, notFlagged: 3, unjudged: 1 } });
    expect(cat("question-no-mark")?.model.unjudged).toBe(1);
  });

  it("keeps misdirection out of precision and recall even when the model flags it", async () => {
    const r = await evaluate(labels, captures, fake(detectionAnswer()).classify, OPTS);
    expect(r.detection.outOfScope).toEqual({ total: 2, labelled: 25, modelFlagged: 1, mechanicalFlagged: 0 });
    // A leak would make the flagged misdirection a false positive: precision 7/9.
    expect(r.detection.model.confusion.fp).toBe(1);
    expect(r.items.filter((i) => i.case === "out-of-scope-for-this-detector").every((i) => i.scored === false)).toBe(true);
  });

  it("reports the permission defect and the not-ended turns apart, and never sends a not-ended turn", async () => {
    const f = fake(detectionAnswer());
    const r = await evaluate(labels, captures, f.classify, OPTS);
    expect(r.detection.permissionDefects.total).toBe(1);
    expect(r.detection.permissionDefects.mechanicalSawPermission).toBe(1);
    expect(r.detection.notAnEndedTurn).toEqual({ total: 4, sentToModel: 0 });
    const ended = labels.filter((l) => readTurnTail(captures.get(l.file) ?? "").kind === "ended").length;
    expect(f.asked()).toBe(ended);
  });

  it("counts unreadable, quota-refused and notCalled as unjudged, never as negatives", async () => {
    for (const outcome of [
      { verdict: { kind: "unreadable", why: "x" }, spend: PRICED },
      { verdict: { kind: "quota-refused", status: 402, why: "x" }, spend: PRICED },
      { notCalled: { kind: "unavailable", why: "lock" } },
    ] as ClassifyOutcome[]) {
      const r = await evaluate(labels, captures, fake(() => outcome).classify, OPTS);
      expect(r.detection.model.confusion).toEqual({ tp: 0, fp: 0, fn: 0, tn: 0 });
      expect(r.detection.model.unjudged).toBe(18);
      // Undefined, not zero and not NaN: nothing was judged.
      expect(r.detection.model.precision).toBeNull();
      expect(r.detection.model.recall).toBeNull();
    }
  });
});

describe("routing", () => {
  it("is not measured when the prompt version returns no recipient", async () => {
    const r = await evaluate(labels, captures, fake(detectionAnswer()).classify, OPTS);
    expect(r.routing).toEqual({ kind: "not-measured", why: "this prompt version returns no recipient" });
    expect(describeEvaluation(r).join("\n")).toContain("not measured: this prompt version returns no recipient");
  });

  it("reads a recipient only when the verdict carries one", () => {
    expect(recipientOf(question())).toBeNull();
    expect(recipientOf(question({ recipient: "sol" }))).toBe("sol");
    expect(recipientOf(NO)).toBeNull();
    expect(recipientOf(question({ recipient: 7 }))).toBeNull();
  });

  /**
   * THE ROUTING FAKE: the detection fake, with each question verdict carrying
   * the label's recipient EXCEPT fable-empty-state -> "greg" (wrong holder),
   * overseer-merge-dev-first -> "unplaced", and the rhetorical false alarm and
   * the misdirection item -> "sol". Proposals on scored items: shut-it-down,
   * fable, greg-drop, whose-failures, self-commit, cleanup, rhetorical = N 7;
   * correct R 5; wrong W 2 (one wrong holder, one on a turn that asked
   * nothing); unplaced 1; K 2 (whose-failures -> overseer, self-commit -> self).
   */
  function routingExtra(l: AttentionLabel): Record<string, unknown> {
    const f = base(l.file);
    if (f === "question-no-mark-fable-empty-state-wording.txt") return { recipient: "greg" };
    if (f === "question-overseer-merge-dev-first.txt") return { recipient: "unplaced" };
    if (l.case !== "question") return { recipient: "sol" };
    return { recipient: l.recipient };
  }

  it("computes N, R, W, K and the unplaced count from verdicts that carry a recipient", async () => {
    const f = fake(detectionAnswer(routingExtra));
    const r = await evaluate(labels, captures, f.classify, OPTS);
    if (r.routing.kind !== "measured") throw new Error("expected routing to be measured");
    expect(r.routing).toMatchObject({
      proposed: 7,
      correct: 5,
      wrong: 2,
      wrongHolder: 1,
      notAQuestion: 1,
      unplaced: 1,
      correctNonGreg: 2,
      trueQuestions: 9,
    });
    expect(r.routing.accuracy).toBeCloseTo(5 / 7, 10);
    expect(r.routing.nonGregPerTrueQuestion).toBeCloseTo(2 / 9, 10);
    // Every call that returned a verdict spent PRICED; notCalled spent nothing.
    expect(r.cost.spend.calls).toBe(f.asked() - 1);
    const perRoute = r.routing.costPerCorrectNonGregRoute;
    if (perRoute.usd === null) throw new Error("expected a priced cost per route");
    expect(perRoute.atLeast).toBe(false);
    expect(perRoute.usd).toBeCloseTo((0.001 * (f.asked() - 1)) / 2, 12);
  });

  it("counts a real version-2 verdict's recipient in routing — the shape `recipientOf` reads", async () => {
    // Built by the real parser rather than cast, so this fails if the version-2
    // verdict ever stops carrying `recipient` where `recipientOf` looks.
    const byTail = labelByTail();
    const classify = async (tail: string): Promise<ClassifyOutcome> => {
      const label = byTail.get(tail);
      if (label?.case !== "question") return { verdict: NO, spend: PRICED };
      const lastLine = tail.split("\n").filter((l) => l.trim() !== "").pop()?.trim() ?? "";
      const raw = JSON.stringify({
        asked: true,
        topic: "t",
        why: "w",
        kind: "technical",
        answerable: "phone",
        recipient: label.recipient,
        reason: "the label says so",
        asks: lastLine,
      });
      return { verdict: parseVerdict(raw, { promptVersion: PROPOSAL_PROMPT_VERSION, tail }), spend: PRICED };
    };
    const r = await evaluate(labels, captures, classify, { promptVersion: PROPOSAL_PROMPT_VERSION, model: "fake/v2" });
    if (r.routing.kind !== "measured") throw new Error(`expected routing to be measured: ${JSON.stringify(r.routing)}`);
    expect(r.routing.proposed).toBe(r.routing.trueQuestions);
    expect(r.routing.correct).toBe(r.routing.trueQuestions);
    expect(recipientOf(parseVerdict(
      JSON.stringify({ asked: true, topic: "t", why: "w", kind: "other", answerable: "phone", recipient: "fable", reason: "r", asks: "abc" }),
      { promptVersion: PROPOSAL_PROMPT_VERSION, tail: "xx abc yy" },
    ))).toBe("fable");
  });

  it("says in words what K is and that avoided waiting is not measured", async () => {
    const r = await evaluate(labels, captures, fake(detectionAnswer(routingExtra)).classify, OPTS);
    const text = describeEvaluation(r).join("\n");
    expect(text).toContain("2 of the 5 correct named a non-Greg holder — could have avoided asking Greg");
    expect(text).toMatch(/actual avoided waiting is NOT measured/);
  });
});

describe("the report as a person reads it", () => {
  it("leads with the prompt version, the model, the item count and the misdirection sentence", async () => {
    const r = await evaluate(labels, captures, fake(detectionAnswer()).classify, OPTS);
    const lines = describeEvaluation(r);
    expect(lines[0]).toContain("prompt version 1");
    expect(lines[0]).toContain("fake/test");
    expect(lines[0]).toContain("25 labelled items");
    expect(lines[1]).toContain("2 of 25 labelled items are misdirection; this stage detects 0 of them by design");
  });

  it("never renders an all-unpriced run as $0.00", async () => {
    const answer = detectionAnswer();
    const unpriced: Answer = (l) => {
      const o = answer(l);
      return "verdict" in o ? { verdict: o.verdict, spend: UNPRICED } : o;
    };
    const r = await evaluate(labels, captures, fake(unpriced).classify, OPTS);
    expect(r.cost.spend.costUsd).toBeNull();
    const text = describeEvaluation(r).join("\n");
    expect(text).not.toContain("$0.00");
    expect(text).toContain("cost not reported by the gateway");
  });

  it("round-trips through JSON, so --out writes the whole artefact", async () => {
    const r: EvaluationReport = await evaluate(labels, captures, fake(detectionAnswer()).classify, OPTS);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("the CLI's two classifiers", () => {
  it("the labelled fake makes no call and answers deterministically", async () => {
    const a = await evaluate(labels, captures, fakeClassifierFromLabels(labels, captures), OPTS);
    const b = await evaluate(labels, captures, fakeClassifierFromLabels(labels, captures), OPTS);
    expect(a).toEqual(b);
    expect(a.cost.spend.calls).toBe(0);
    // Perturbed, so the numbers are not the trivial all-correct ones.
    const c = a.detection.model.confusion;
    expect(c.fn + c.fp + a.detection.model.unjudged).toBeGreaterThan(0);
    expect(c.tp).toBeGreaterThan(0);
  });

  it("the paid one is built on a fresh budget root under the temp dir, and is not called here", () => {
    for (const version of [1, PROPOSAL_PROMPT_VERSION] as const) {
      const { classify, budgetRoot } = paidEvalClassifier("not-a-real-key", version);
      expect(typeof classify).toBe("function");
      expect(budgetRoot.startsWith(tmpdir())).toBe(true);
      expect(existsSync(budgetRoot)).toBe(true);
    }
  });
});
