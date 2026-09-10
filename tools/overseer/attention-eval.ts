/**
 * THE EVALUATION — does the model classifier earn its cost over the mechanical
 * inbox, and where it proposes a recipient, is the recipient right?
 *
 * Plan 260910f (docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox.md),
 * Stage 3. The metrics wording is GPT Sol's F6 on that plan, and it is the
 * spec here: *N proposed; R correct against the labels; W wrong; K of the R
 * correct named a non-Greg holder* — K is **"could have avoided asking Greg"**,
 * and actual avoided waiting is **not measured**, because this stage sends
 * nothing to anybody. The report says that in words, every time.
 *
 * Pure apart from reading the labelled set off disk (`loadLabelledSet`). The
 * classifier is injected: the tests and `--fake` hand in one that answers from
 * the labels, and a real run hands in `paidEvalClassifier`, which is the
 * existing seam (`modelBudget` + `paidClassifier`) and nothing else.
 *
 * ## What is scored and what is only counted
 *
 * - **Scored**: labels of case `question` and `no-question`, in precision and
 *   recall, for the model and for the mechanical inbox side by side.
 * - **Misdirection** (`out-of-scope-for-this-detector`, D12) is counted and
 *   reported as "N of M labelled items are misdirection; this stage detects 0
 *   of them by design". What either detector did with them is shown, and is in
 *   no precision or recall — counting them as negatives would flatter the
 *   detector, as misses would punish it for a job it was never given.
 * - **Permission defects** and **turns that had not ended** are reported apart.
 *   Only an ended turn is ever sent to the classifier, as in the live pass.
 * - **Unjudged**: an `unreadable` or `quota-refused` verdict, or a budget
 *   refusal (`notCalled`), is not a judgement. It is counted as unjudged and
 *   never as a negative, because a detector that could not look has not said
 *   "nothing here" — the calm-inbox failure docs/reusable/silent-success.md is
 *   about.
 *
 * ## Routing reads a field that does not exist yet
 *
 * Stage 2 adds `recipient` to the question verdict under prompt version 2. Until
 * then no verdict carries one, so `recipientOf` reads it defensively and the
 * report says routing is "not measured: this prompt version returns no
 * recipient" rather than inventing a zero. A recipient of `"unplaced"` is read
 * as D8's visible unplaced arm and counted apart from N.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AttentionLabel, type LabelCategory, type MechanicalVerdict, mechanicalInbox, parseLabels } from "./attention-labels.js";
import { type ClassifierSpend, type ClassifierVerdict, NO_SPEND, addSpend, describeCost } from "./attention-classify.js";
import { type ClassifyOutcome, modelBudget, paidClassifier } from "./model-budget.js";
import { readTurnTail } from "./turn-tail.js";

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export type Confusion = { tp: number; fp: number; fn: number; tn: number };

/** A rate that is undefined when its denominator is zero — `null`, never NaN. */
export type Rate = number | null;

export type DetectorScore = {
  confusion: Confusion;
  precision: Rate;
  recall: Rate;
};

export type ModelDetection = DetectorScore & {
  /** Scored items the classifier actually judged. */
  judged: number;
  /** Scored items it did not: unreadable, quota-refused, or never called. Never negatives. */
  unjudged: number;
};

export type CategoryCounts = {
  category: LabelCategory;
  labelled: number;
  model: { flagged: number; notFlagged: number; unjudged: number };
  mechanical: { flagged: number; notFlagged: number };
};

/** What the classifier made of one item, or why it was not asked. */
export type ModelOutcome =
  | { kind: "judged"; verdict: ClassifierVerdict; recipient: string | null }
  | { kind: "unjudged"; why: string }
  | { kind: "not-sent"; why: string };

export type RoutingMark = "correct" | "wrong-holder" | "not-a-question" | "unplaced" | null;

export type ItemRecord = {
  file: string;
  case: AttentionLabel["case"];
  category: LabelCategory;
  labelRecipient: AttentionLabel["recipient"];
  /** In precision and recall. False for misdirection, permission defects and not-ended turns. */
  scored: boolean;
  mechanical: MechanicalVerdict;
  model: ModelOutcome;
  /** This item's proposal marked against its label, when the verdict carried one. */
  routing: RoutingMark;
};

export type CostPerRoute = { usd: number; atLeast: boolean } | { usd: null; why: string };

export type Routing =
  | { kind: "not-measured"; why: string }
  | {
      kind: "measured";
      /** Question verdicts on scored items that named a recipient (not `unplaced`). */
      proposed: number;
      /** Of those, the recipient the label names, on a labelled question. */
      correct: number;
      wrong: number;
      /** A labelled question, routed to somebody other than its holder. */
      wrongHolder: number;
      /** A proposal on a turn the labels say asked nothing. */
      notAQuestion: number;
      /** D8's visible arm. Counted apart, never promoted to Greg. */
      unplaced: number;
      /** K: correct and not Greg — "could have avoided asking Greg". */
      correctNonGreg: number;
      trueQuestions: number;
      /** R / N. */
      accuracy: Rate;
      /** K / labelled questions. */
      nonGregPerTrueQuestion: Rate;
      costPerCorrectNonGregRoute: CostPerRoute;
    };

export type EvaluationReport = {
  promptVersion: number;
  model: string;
  labelled: number;
  items: ItemRecord[];
  detection: {
    /** Labelled questions plus labelled non-questions. */
    scored: number;
    questions: number;
    noQuestions: number;
    model: ModelDetection;
    mechanical: DetectorScore;
    perCategory: CategoryCounts[];
    outOfScope: { total: number; labelled: number; modelFlagged: number; mechanicalFlagged: number };
    permissionDefects: { total: number; mechanicalSawPermission: number; sentToModel: number; modelFlagged: number };
    notAnEndedTurn: { total: number; sentToModel: number };
  };
  routing: Routing;
  cost: {
    /** How many times the classifier was asked, whether or not it spent. */
    asked: number;
    /** What the gateway said, summed with `addSpend`: an unpriced call is counted, never summed as zero. */
    spend: ClassifierSpend;
  };
};

export type EvaluateOptions = { promptVersion: number; model: string };

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const FIXTURES = new URL("../../tests/fixtures/", import.meta.url);

/** labels.json and every capture it names, keyed by the label's `file`. The only file reads here. */
export function loadLabelledSet(fixtures: URL = FIXTURES): {
  labels: AttentionLabel[];
  captures: Map<string, string>;
} {
  const labels = parseLabels(JSON.parse(readFileSync(new URL("overseer-turn-tails/labels.json", fixtures), "utf8")));
  const captures = new Map<string, string>();
  for (const l of labels) captures.set(l.file, readFileSync(new URL(l.file, fixtures), "utf8"));
  return { labels, captures };
}

/**
 * The recipient a verdict proposes, or null when it carries none.
 *
 * Prompt version 1 has no such field; Stage 2 adds one. Read through an `in`
 * check rather than a type that claims the field exists, so this file compiles
 * against today's verdict and needs no edit when the field arrives. A
 * non-string recipient is null, not a guess.
 */
export function recipientOf(verdict: ClassifierVerdict): string | null {
  if (verdict.kind !== "question") return null;
  if (!("recipient" in verdict)) return null;
  const r: unknown = verdict.recipient;
  return typeof r === "string" ? r : null;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

function rate(num: number, den: number): Rate {
  return den === 0 ? null : num / den;
}

function score(c: Confusion): DetectorScore {
  return { confusion: c, precision: rate(c.tp, c.tp + c.fp), recall: rate(c.tp, c.tp + c.fn) };
}

/** Whether the mechanical inbox puts this in front of somebody. Permission dialogs are counted, not shown. */
function mechanicalFlags(v: MechanicalVerdict): boolean {
  return v === "dialog" || v === "question-mark";
}

function isScored(l: AttentionLabel): boolean {
  return l.case === "question" || l.case === "no-question";
}

function toModelOutcome(o: ClassifyOutcome): ModelOutcome {
  if ("notCalled" in o) {
    const r = o.notCalled;
    return { kind: "unjudged", why: r.kind === "stopped" ? `the budget refused: ${r.stopped.why}` : `the budget was unavailable: ${r.why}` };
  }
  const v = o.verdict;
  if (v.kind === "unreadable") return { kind: "unjudged", why: `unreadable: ${v.why}` };
  if (v.kind === "quota-refused") return { kind: "unjudged", why: `the gateway refused with HTTP ${v.status}` };
  return { kind: "judged", verdict: v, recipient: recipientOf(v) };
}

function routingMark(label: AttentionLabel, model: ModelOutcome): RoutingMark {
  if (model.kind !== "judged" || model.verdict.kind !== "question" || model.recipient === null) return null;
  if (model.recipient === "unplaced") return "unplaced";
  if (label.case !== "question") return "not-a-question";
  return model.recipient === label.recipient ? "correct" : "wrong-holder";
}

/**
 * Score the classifier against the labels, and the mechanical inbox beside it.
 *
 * Calls `classify` once per labelled item whose capture reads as an ended turn,
 * **sequentially** — one call in flight, as in the live pass (plan D4). A
 * label whose capture is missing throws rather than scoring as a miss.
 */
export async function evaluate(
  labels: readonly AttentionLabel[],
  captures: ReadonlyMap<string, string>,
  classify: (tail: string) => Promise<ClassifyOutcome>,
  opts: EvaluateOptions,
): Promise<EvaluationReport> {
  const items: ItemRecord[] = [];
  let spend: ClassifierSpend = NO_SPEND;
  let asked = 0;

  for (const label of labels) {
    const capture = captures.get(label.file);
    if (capture === undefined) throw new Error(`evaluate: no capture for ${label.file}`);
    const tail = readTurnTail(capture);
    let model: ModelOutcome;
    if (tail.kind === "ended") {
      asked += 1;
      // Sequential on purpose: the budget allows one call in flight per process.
      const outcome = await classify(tail.tail);
      if ("verdict" in outcome) spend = addSpend(spend, outcome.spend);
      model = toModelOutcome(outcome);
    } else {
      model = { kind: "not-sent", why: `not an ended turn (${tail.kind}): ${tail.why}` };
    }
    items.push({
      file: label.file,
      case: label.case,
      category: label.category,
      labelRecipient: label.recipient,
      scored: isScored(label),
      mechanical: mechanicalInbox(capture),
      model,
      routing: routingMark(label, model),
    });
  }

  return {
    promptVersion: opts.promptVersion,
    model: opts.model,
    labelled: labels.length,
    items,
    detection: detectionOf(items),
    routing: routingOf(items, spend),
    cost: { asked, spend },
  };
}

function modelFlags(m: ModelOutcome): boolean {
  return m.kind === "judged" && m.verdict.kind === "question";
}

/** One scored, judged item into its cell: labelled question or not, flagged or not. */
function tally(c: Confusion, positive: boolean, flagged: boolean): void {
  if (positive && flagged) c.tp += 1;
  else if (positive) c.fn += 1;
  else if (flagged) c.fp += 1;
  else c.tn += 1;
}

function detectionOf(items: readonly ItemRecord[]): EvaluationReport["detection"] {
  const scored = items.filter((i) => i.scored);
  const model: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const mech: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  let unjudged = 0;
  const perCategory = new Map<LabelCategory, CategoryCounts>();

  for (const i of scored) {
    const positive = i.case === "question";
    const mFlag = mechanicalFlags(i.mechanical);
    tally(mech, positive, mFlag);

    const cat = perCategory.get(i.category) ?? {
      category: i.category,
      labelled: 0,
      model: { flagged: 0, notFlagged: 0, unjudged: 0 },
      mechanical: { flagged: 0, notFlagged: 0 },
    };
    perCategory.set(i.category, cat);
    cat.labelled += 1;
    if (mFlag) cat.mechanical.flagged += 1;
    else cat.mechanical.notFlagged += 1;

    // A scored item is always an ended turn (the labels test pins it), but if
    // one were not, it was never asked — unjudged, not a negative.
    if (i.model.kind !== "judged") {
      unjudged += 1;
      cat.model.unjudged += 1;
      continue;
    }
    const flag = modelFlags(i.model);
    if (flag) cat.model.flagged += 1;
    else cat.model.notFlagged += 1;
    tally(model, positive, flag);
  }

  const ofCase = (c: AttentionLabel["case"]) => items.filter((i) => i.case === c);
  const oos = ofCase("out-of-scope-for-this-detector");
  const perm = ofCase("permission-defect");
  const notEnded = ofCase("not-an-ended-turn");
  const sent = (i: ItemRecord) => i.model.kind !== "not-sent";

  return {
    scored: scored.length,
    questions: scored.filter((i) => i.case === "question").length,
    noQuestions: scored.filter((i) => i.case === "no-question").length,
    model: { ...score(model), judged: scored.length - unjudged, unjudged },
    mechanical: score(mech),
    perCategory: [...perCategory.values()],
    outOfScope: {
      total: oos.length,
      labelled: items.length,
      modelFlagged: oos.filter((i) => modelFlags(i.model)).length,
      mechanicalFlagged: oos.filter((i) => mechanicalFlags(i.mechanical)).length,
    },
    permissionDefects: {
      total: perm.length,
      mechanicalSawPermission: perm.filter((i) => i.mechanical === "permission").length,
      sentToModel: perm.filter(sent).length,
      modelFlagged: perm.filter((i) => modelFlags(i.model)).length,
    },
    notAnEndedTurn: { total: notEnded.length, sentToModel: notEnded.filter(sent).length },
  };
}

function routingOf(items: readonly ItemRecord[], spend: ClassifierSpend): Routing {
  const anyRecipient = items.some((i) => i.model.kind === "judged" && i.model.recipient !== null);
  if (!anyRecipient) return { kind: "not-measured", why: "this prompt version returns no recipient" };

  // Scored items only: misdirection is in no metric (D12), routing included.
  const scored = items.filter((i) => i.scored);
  const count = (m: RoutingMark) => scored.filter((i) => i.routing === m).length;
  const correct = count("correct");
  const wrongHolder = count("wrong-holder");
  const notAQuestion = count("not-a-question");
  const proposed = correct + wrongHolder + notAQuestion;
  const correctNonGreg = scored.filter(
    (i) => i.routing === "correct" && i.model.kind === "judged" && i.model.recipient !== "greg",
  ).length;
  const trueQuestions = scored.filter((i) => i.case === "question").length;

  let costPerCorrectNonGregRoute: CostPerRoute;
  if (correctNonGreg === 0) costPerCorrectNonGregRoute = { usd: null, why: "no correct non-Greg route to divide by" };
  else if (spend.costUsd === null) costPerCorrectNonGregRoute = { usd: null, why: "the gateway reported no cost" };
  else costPerCorrectNonGregRoute = { usd: spend.costUsd / correctNonGreg, atLeast: spend.unpricedCalls > 0 };

  return {
    kind: "measured",
    proposed,
    correct,
    wrong: wrongHolder + notAQuestion,
    wrongHolder,
    notAQuestion,
    unplaced: count("unplaced"),
    correctNonGreg,
    trueQuestions,
    accuracy: rate(correct, proposed),
    nonGregPerTrueQuestion: rate(correctNonGreg, trueQuestions),
    costPerCorrectNonGregRoute,
  };
}

/* ------------------------------------------------------------------ *
 * In words
 * ------------------------------------------------------------------ */

function fmtRate(r: Rate, num: number, den: number): string {
  return r === null ? `undefined (${num}/${den})` : `${r.toFixed(2)} (${num}/${den})`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The money, never as `$0.00` for calls nobody priced — `describeCost`'s rule, plus the no-call case. */
function costLine(cost: EvaluationReport["cost"]): string {
  const s = cost.spend;
  if (s.calls === 0) return `cost: no paid calls were made (the classifier was asked ${plural(cost.asked, "time")})`;
  return `cost: ${plural(s.calls, "call")}, ${s.promptTokens + s.completionTokens} tokens (${s.promptTokens} prompt, ${s.completionTokens} completion), ${describeCost(s)}`;
}

function routingLines(r: Routing): string[] {
  if (r.kind === "not-measured") return [`routing: not measured: ${r.why}`];
  const perRoute =
    r.costPerCorrectNonGregRoute.usd === null
      ? `not computable (${r.costPerCorrectNonGregRoute.why})`
      : `${r.costPerCorrectNonGregRoute.atLeast ? "at least " : ""}$${r.costPerCorrectNonGregRoute.usd.toFixed(6)}`;
  return [
    `routing: ${r.proposed} proposed; ${r.correct} correct against the labels; ${r.wrong} wrong ` +
      `(${r.wrongHolder} to the wrong holder, ${r.notAQuestion} on a turn that asked nothing); ` +
      `${r.unplaced} unplaced, counted apart`,
    `  ${r.correctNonGreg} of the ${r.correct} correct named a non-Greg holder — could have avoided asking Greg`,
    "  actual avoided waiting is NOT measured: this stage sends nothing to anybody, so nobody was spared a wait",
    `  routing accuracy ${fmtRate(r.accuracy, r.correct, r.proposed)}; ` +
      `correct non-Greg routes per true question ${fmtRate(r.nonGregPerTrueQuestion, r.correctNonGreg, r.trueQuestions)}; ` +
      `cost per correct non-Greg route ${perRoute}`,
  ];
}

/** The report as short plain-English lines, header first. */
export function describeEvaluation(report: EvaluationReport): string[] {
  const d = report.detection;
  const m = d.model;
  const k = d.mechanical;
  const o = d.outOfScope;
  const lines = [
    `prompt version ${report.promptVersion} · model ${report.model} · ${report.labelled} labelled items, ` +
      `${report.cost.asked} sent to the classifier`,
    `${o.total} of ${o.labelled} labelled items are misdirection; this stage detects 0 of them by design, ` +
      `so they are in no precision or recall (the model raised a question on ${o.modelFlagged}, the mechanical inbox on ${o.mechanicalFlagged})`,
    `detection over ${d.scored} scored items (${plural(d.questions, "question")}, ${plural(d.noQuestions, "non-question")}):`,
    `  model: judged ${m.judged} of ${d.scored} (${m.unjudged} unjudged, never counted as negatives); ` +
      `caught ${m.confusion.tp}, missed ${m.confusion.fn}, ${plural(m.confusion.fp, "false alarm")}; ` +
      `precision ${fmtRate(m.precision, m.confusion.tp, m.confusion.tp + m.confusion.fp)}, ` +
      `recall ${fmtRate(m.recall, m.confusion.tp, m.confusion.tp + m.confusion.fn)}`,
    `  mechanical: caught ${k.confusion.tp} of ${d.questions}, ${plural(k.confusion.fp, "false alarm")}; ` +
      `precision ${fmtRate(k.precision, k.confusion.tp, k.confusion.tp + k.confusion.fp)}, ` +
      `recall ${fmtRate(k.recall, k.confusion.tp, k.confusion.tp + k.confusion.fn)}`,
    ...d.perCategory.map(
      (c) =>
        `    ${c.category} (${c.labelled}): model ${c.model.flagged} flagged, ${c.model.notFlagged} not, ${c.model.unjudged} unjudged; ` +
        `mechanical ${c.mechanical.flagged} flagged`,
    ),
    `${plural(d.permissionDefects.total, "permission defect")}: the mechanical inbox saw ${d.permissionDefects.mechanicalSawPermission} ` +
      `as a permission dialog; ${d.permissionDefects.sentToModel} sent to the model, which flagged ${d.permissionDefects.modelFlagged}`,
    `${plural(d.notAnEndedTurn.total, "labelled item")} not an ended turn; ${d.notAnEndedTurn.sentToModel} sent to the model`,
    ...routingLines(report.routing),
    costLine(report.cost),
  ];
  return lines;
}

/* ------------------------------------------------------------------ *
 * The two classifiers the CLI can use
 * ------------------------------------------------------------------ */

/**
 * `--fake`: a deterministic classifier that answers from the labels, perturbed
 * so the numbers are not the trivial all-correct ones. It makes no call and
 * reports no spend. The perturbation, by label:
 *
 *  - a `question` answers question — except the FIRST labelled question whose
 *    recipient is `sol`, which it misses (a false negative);
 *  - a `rhetorical` no-question answers question (the false alarm the
 *    mechanical `?` grep also raises);
 *  - the FIRST `background-review` answers `unreadable` (unjudged — never a
 *    negative);
 *  - every other item answers no-question, misdirection included.
 *
 * Verdicts are prompt-version-1 shaped (no recipient), so routing reads "not
 * measured", which is the truth about version 1.
 */
export function fakeClassifierFromLabels(
  labels: readonly AttentionLabel[],
  captures: ReadonlyMap<string, string>,
): (tail: string) => Promise<ClassifyOutcome> {
  const byTail = new Map<string, AttentionLabel>();
  for (const l of labels) {
    const t = readTurnTail(captures.get(l.file) ?? "");
    if (t.kind === "ended") byTail.set(t.tail, l);
  }
  const missed = labels.find((l) => l.case === "question" && l.recipient === "sol")?.file;
  const unreadable = labels.find((l) => l.category === "background-review")?.file;

  return async (tail) => {
    const l = byTail.get(tail);
    if (l === undefined) return { verdict: { kind: "unreadable", why: "fake: a tail with no label" }, spend: NO_SPEND };
    if (l.file === unreadable) return { verdict: { kind: "unreadable", why: "fake: perturbed to unreadable" }, spend: NO_SPEND };
    const asks = (l.case === "question" && l.file !== missed) || l.category === "rhetorical";
    const verdict: ClassifierVerdict = asks
      ? {
          kind: "question",
          topic: "fake",
          why: `fake: answered from the label (${l.case}/${l.category})`,
          attentionKind: "other",
          answerability: { kind: "phone" },
        }
      : { kind: "no-question", why: `fake: answered from the label (${l.case}/${l.category})` };
    return { verdict, spend: NO_SPEND };
  };
}

/**
 * The real classifier for an evaluation run, built ONLY through the existing
 * seam: a day budget on a fresh ledger under the temp dir, and `paidClassifier`.
 *
 * A fresh root rather than the daemon's, so an evaluation neither eats the live
 * inbox's day ceiling nor is refused by it; the ceiling still bounds the run.
 * The key is a parameter: this file does not read the environment.
 */
export function paidEvalClassifier(apiKey: string): {
  classify: (tail: string) => Promise<ClassifyOutcome>;
  budgetRoot: string;
} {
  const budgetRoot = mkdtempSync(join(tmpdir(), "attention-eval-budget-"));
  return { classify: paidClassifier(modelBudget({ root: budgetRoot }), { apiKey }), budgetRoot };
}
