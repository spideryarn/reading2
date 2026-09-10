/**
 * THE LABELLED SET FOR THE ATTENTION INBOX, AND THE BASELINE IT IS SCORED AGAINST.
 *
 * Plan 260910f (docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox.md),
 * Stage 1. `tests/fixtures/overseer-turn-tails/labels.json` says, for each
 * capture, whether an ended turn handed somebody a decision and who holds the
 * information to make it. This file parses that strictly and says what the
 * MECHANICAL inbox — a dialog parse, then a `?` grep, no model — makes of the
 * same captures. A model classifier is only worth its cost if it beats that.
 *
 * Pure: no files, no tmux, no gateway. The test reads the fixtures and hands
 * them in.
 *
 * ## D12: out of scope is counted, never scored
 *
 * `out-of-scope-for-this-detector` marks misdirection — an agent confidently on
 * the wrong task, or declaring done with its gates skipped. A question detector
 * is structurally blind to those, so they are excluded from precision and
 * recall in both directions: counting them as expected-negatives would flatter
 * it, counting them as misses would punish it for a job it was never given.
 *
 * **Concluded work is NOT out of scope**, and the parser enforces it (see
 * `CATEGORIES_FOR`): a debrief ending on an optional offer is a negative, and
 * one holding a genuine cleanup decision is a question.
 */
import { grantsPermission, parsePane } from "../fleet/pane.js";
import { readTurnTail } from "./turn-tail.js";

export const LABEL_CASES = [
  "question",
  "no-question",
  "out-of-scope-for-this-detector",
  "permission-defect",
  "not-an-ended-turn",
] as const;
export type LabelCase = (typeof LABEL_CASES)[number];

export const LABEL_RECIPIENTS = ["sol", "fable", "greg", "overseer", "self"] as const;
export type LabelRecipient = (typeof LABEL_RECIPIENTS)[number];

export const LABEL_CATEGORIES = [
  "question-no-mark",
  "question-with-mark",
  "rhetorical",
  "concluded",
  "background-review",
  "permission-defect",
  "wrong-task",
  "mid-turn",
  "not-claude",
] as const;
export type LabelCategory = (typeof LABEL_CATEGORIES)[number];

/**
 * One labelled capture. A discriminated union so a question without a recipient,
 * or a recipient on anything else, cannot be constructed.
 */
export type AttentionLabel =
  | { file: string; case: "question"; recipient: LabelRecipient; why: string; category: LabelCategory }
  | {
      file: string;
      case: Exclude<LabelCase, "question">;
      recipient: null;
      why: string;
      category: LabelCategory;
    };

/**
 * Which categories each case may be filed under. A question filed as
 * `rhetorical` is a contradiction in the label, and it is cheaper to refuse it
 * here than to find it as an odd number in Stage 3.
 */
const CATEGORIES_FOR: Record<LabelCase, readonly LabelCategory[]> = {
  question: ["question-no-mark", "question-with-mark"],
  "no-question": ["rhetorical", "concluded", "background-review"],
  // D12: out of scope means MISDIRECTION and nothing else. `concluded` was
  // allowed here, which let "done — I skipped the gates" be filed as concluded
  // work and so let concluded work drift out of the scored set — the mistake
  // Sol's F7 found in the plan. A debrief is scored; misdirection wearing one is
  // `wrong-task`.
  "out-of-scope-for-this-detector": ["wrong-task"],
  "permission-defect": ["permission-defect"],
  "not-an-ended-turn": ["mid-turn", "not-claude"],
};

const KEYS = ["file", "case", "recipient", "why", "category"] as const;

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** A `.txt` path relative to tests/fixtures/ that cannot climb out of it. */
function parseFixturePath(file: unknown, where: string): string {
  if (typeof file !== "string" || file === "" || !file.endsWith(".txt")) {
    throw new Error(`${where}: file must be a .txt path relative to tests/fixtures/`);
  }
  if (file.startsWith("/") || file.split("/").includes("..")) {
    throw new Error(`${where}: file ${JSON.stringify(file)} must stay inside tests/fixtures/`);
  }
  return file;
}

/**
 * Parse labels.json. Throws, naming the entry and the reason, on anything
 * malformed — an unknown key included, because a misspelt `recipent` silently
 * dropped would read as "no recipient".
 */
export function parseLabels(raw: unknown): AttentionLabel[] {
  if (!Array.isArray(raw)) throw new Error("labels: expected an array of entries");
  const seen = new Set<string>();
  return raw.map((entry: unknown, i): AttentionLabel => {
    const where = `labels[${i}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${where}: expected an object`);
    }
    const e = entry as Record<string, unknown>;
    const extra = Object.keys(e).filter((k) => !(KEYS as readonly string[]).includes(k));
    if (extra.length > 0) throw new Error(`${where}: unknown key(s) ${extra.join(", ")}`);

    const { file: rawFile, case: kase, recipient, why, category } = e;
    const file = parseFixturePath(rawFile, where);
    if (seen.has(file)) throw new Error(`${where}: ${file} is labelled twice`);
    seen.add(file);
    if (!oneOf(LABEL_CASES, kase)) throw new Error(`${where}: unknown case ${JSON.stringify(kase)}`);
    if (!oneOf(LABEL_CATEGORIES, category)) throw new Error(`${where}: unknown category ${JSON.stringify(category)}`);
    if (!CATEGORIES_FOR[kase].includes(category)) {
      throw new Error(`${where}: case ${kase} cannot be filed under category ${category}`);
    }
    if (typeof why !== "string" || why.trim() === "") throw new Error(`${where}: why must be a non-empty sentence`);

    if (kase === "question") {
      if (!oneOf(LABEL_RECIPIENTS, recipient)) {
        throw new Error(`${where}: a question needs a recipient, one of ${LABEL_RECIPIENTS.join(", ")}`);
      }
      return { file, case: kase, recipient, why, category };
    }
    if (recipient !== null) throw new Error(`${where}: only a question has a recipient; this is ${kase}`);
    return { file, case: kase, recipient: null, why, category };
  });
}

/**
 * What the mechanical inbox says about a pane, with no model.
 *
 * - `dialog` — a conversation dialog (`AskUserQuestion`): an inbox item.
 * - `permission` — a permission-class dialog: counted, deliberately NOT an item
 *   (see attention-pass.ts's header).
 * - `question-mark` — an ended turn whose tail ENDS with a `?` (`endsWithAMark`).
 * - `nothing` — everything else, which is where the prose questions that end in
 *   a full stop go. That is the finding this whole stage exists for.
 */
export type MechanicalVerdict = "dialog" | "permission" | "question-mark" | "nothing";

/** How many non-blank lines, counted from the end of the tail, the `?` grep looks at. */
export const MARK_WINDOW_LINES = 3;

/**
 * Whether one of the last `MARK_WINDOW_LINES` non-blank lines of a tail
 * contains a `?`.
 *
 * The end and not the whole tail, because a `?` anywhere would flag every
 * rhetorical question in every explanation; the end because that is where a
 * turn that asks does its asking. Lines are the pane's wrapped lines, so a
 * long closing sentence can occupy two of the three.
 */
export function endsWithAMark(tail: string): boolean {
  return tail
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(-MARK_WINDOW_LINES)
    .some((l) => l.includes("?"));
}

export function mechanicalInbox(capture: string): MechanicalVerdict {
  const question = parsePane(capture);
  if (question.kind === "question") return grantsPermission(question.gate) ? "permission" : "dialog";
  const tail = readTurnTail(capture);
  if (tail.kind === "ended" && endsWithAMark(tail.tail)) return "question-mark";
  return "nothing";
}

/** Whether the mechanical inbox would put this in front of somebody. Permission dialogs are not. */
function flags(verdict: MechanicalVerdict): boolean {
  return verdict === "dialog" || verdict === "question-mark";
}

export type MechanicalScore = {
  perFile: { file: string; case: LabelCase; mechanical: MechanicalVerdict }[];
  labelled: number;
  /** Labelled questions: how many the mechanical inbox surfaces, and how many it misses. */
  questions: { total: number; caught: number; missed: number };
  /** Labelled non-questions it surfaces anyway. */
  noQuestion: { total: number; falseAlarms: number };
  /** D12: counted, and what the mechanical inbox did with them, but in no precision or recall. */
  outOfScope: { total: number; flagged: number };
  permissionDefects: { total: number; seenAsPermission: number };
  notAnEndedTurn: { total: number; flagged: number };
};

/**
 * Score the mechanical inbox against the labels. `captures` is keyed by the
 * label's `file`; a label with no capture throws rather than scoring as a miss,
 * because a missing fixture would otherwise read as a worse baseline.
 */
export function scoreMechanical(
  labels: readonly AttentionLabel[],
  captures: ReadonlyMap<string, string>,
): MechanicalScore {
  const score: MechanicalScore = {
    perFile: [],
    labelled: labels.length,
    questions: { total: 0, caught: 0, missed: 0 },
    noQuestion: { total: 0, falseAlarms: 0 },
    outOfScope: { total: 0, flagged: 0 },
    permissionDefects: { total: 0, seenAsPermission: 0 },
    notAnEndedTurn: { total: 0, flagged: 0 },
  };
  for (const label of labels) {
    const capture = captures.get(label.file);
    if (capture === undefined) throw new Error(`scoreMechanical: no capture for ${label.file}`);
    const mechanical = mechanicalInbox(capture);
    score.perFile.push({ file: label.file, case: label.case, mechanical });
    const flagged = flags(mechanical);
    switch (label.case) {
      case "question":
        score.questions.total += 1;
        if (flagged) score.questions.caught += 1;
        else score.questions.missed += 1;
        break;
      case "no-question":
        score.noQuestion.total += 1;
        if (flagged) score.noQuestion.falseAlarms += 1;
        break;
      case "out-of-scope-for-this-detector":
        score.outOfScope.total += 1;
        if (flagged) score.outOfScope.flagged += 1;
        break;
      case "permission-defect":
        score.permissionDefects.total += 1;
        if (mechanical === "permission") score.permissionDefects.seenAsPermission += 1;
        break;
      case "not-an-ended-turn":
        score.notAnEndedTurn.total += 1;
        if (flagged) score.notAnEndedTurn.flagged += 1;
        break;
      default: {
        const unreachable: never = label;
        throw new Error(`scoreMechanical: unhandled case ${JSON.stringify(unreachable)}`);
      }
    }
  }
  return score;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The score in one sentence, the form the evaluation quotes. */
export function summariseMechanical(s: MechanicalScore): string {
  return (
    `mechanical catches ${s.questions.caught} of ${plural(s.questions.total, "question", "questions")} ` +
    `and raises ${plural(s.noQuestion.falseAlarms, "false alarm", "false alarms")} ` +
    `over ${plural(s.noQuestion.total, "no-question turn", "no-question turns")}; ` +
    `${s.outOfScope.total} of ${s.labelled} labelled items are out of scope for this detector and not scored; ` +
    `${s.permissionDefects.seenAsPermission} of ` +
    `${plural(s.permissionDefects.total, "permission defect", "permission defects")} seen as a permission dialog`
  );
}
