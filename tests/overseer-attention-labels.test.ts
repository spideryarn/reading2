/**
 * The labelled set for the attention inbox, and what the MECHANICAL inbox makes
 * of it — tests/fixtures/overseer-turn-tails/labels.json, scored by
 * tools/overseer/attention-labels.ts.
 *
 * Plan 260910f, Stage 1. The six cases the roadmap names — a prose question
 * without `?`, a rhetorical question, concluded work, a background review, a
 * permission defect, an agent working confidently on the wrong task — each
 * labelled, plus the nine real captures that were already here.
 *
 * WHAT THIS PINS AND WHY. The mechanical inbox (a dialog parse, then a `?`
 * grep over the end of an ended turn) is the baseline any model has to beat,
 * and the number that says so is only worth anything if it cannot drift
 * quietly. So its answer for every labelled capture is written out below, and a
 * change to the grep, to `readTurnTail`, to `parsePane`, or to a fixture shows
 * up here as a diff rather than as a better-looking evaluation.
 *
 * D11: `out-of-scope-for-this-detector` is counted and NEVER scored. An
 * expected-negative counts toward precision; these are cases a question
 * detector is structurally blind to, so counting them would flatter it.
 *
 * The fixtures whose names do not begin `ended-`, `mid-turn-` or
 * `no-input-box-` are HAND-WRITTEN: sanitised prose in the shape of real
 * turns, above chrome copied byte-for-byte from two real captures. The
 * original nine were taken off the box with `tmux capture-pane`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  endsWithAMark,
  mechanicalInbox,
  parseLabels,
  scoreMechanical,
  summariseMechanical,
} from "../tools/overseer/attention-labels.js";
import { readTurnTail } from "../tools/overseer/turn-tail.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function fixture(file: string): string {
  return readFileSync(new URL(file, FIXTURES), "utf8");
}

const RAW_LABELS: unknown = JSON.parse(fixture("overseer-turn-tails/labels.json"));

describe("labels.json — the set itself", () => {
  const labels = parseLabels(RAW_LABELS);

  it("names only files that exist", () => {
    const missing = labels.filter((l) => !existsSync(new URL(l.file, FIXTURES))).map((l) => l.file);
    expect(missing).toEqual([]);
  });

  it("leaves no capture in the turn-tail directory unlabelled", () => {
    const labelled = new Set(labels.map((l) => l.file));
    const unlabelled = readdirSync(new URL("overseer-turn-tails/", FIXTURES))
      .filter((f) => f.endsWith(".txt"))
      .map((f) => `overseer-turn-tails/${f}`)
      .filter((f) => !labelled.has(f));
    expect(unlabelled).toEqual([]);
  });

  it("references the permission defect by path rather than copying it", () => {
    const defects = labels.filter((l) => l.case === "permission-defect");
    expect(defects.length).toBeGreaterThan(0);
    for (const d of defects) expect(d.file.startsWith("fleet-panes/dialog-bash-permission")).toBe(true);
  });

  it("gives every judged case an ended turn, so the classifier would actually see it", () => {
    const notEnded = labels
      .filter((l) => l.case === "question" || l.case === "no-question" || l.case === "out-of-scope-for-this-detector")
      .map((l) => ({ file: l.file, kind: readTurnTail(fixture(l.file)).kind }))
      .filter((r) => r.kind !== "ended");
    expect(notEnded).toEqual([]);
  });

  it("keeps not-an-ended-turn honest: none of those reads as ended", () => {
    const ended = labels
      .filter((l) => l.case === "not-an-ended-turn")
      .filter((l) => readTurnTail(fixture(l.file)).kind === "ended")
      .map((l) => l.file);
    expect(ended).toEqual([]);
  });

  it("means it when it says a question carries no mark: no `?` anywhere in the tail", () => {
    const marked = labels
      .filter((l) => l.category === "question-no-mark")
      .filter((l) => {
        const t = readTurnTail(fixture(l.file));
        return t.kind === "ended" && t.tail.includes("?");
      })
      .map((l) => l.file);
    expect(marked).toEqual([]);
  });

  it("covers each of the five recipients at least once", () => {
    const recipients = new Set(labels.map((l) => l.recipient).filter((r) => r !== null));
    expect([...recipients].sort()).toEqual(["fable", "greg", "overseer", "self", "sol"]);
  });
});

describe("parseLabels — strict, because a mislabel is a wrong number later", () => {
  const good = {
    file: "overseer-turn-tails/x.txt",
    case: "question",
    recipient: "sol",
    why: "it asks which of two fixes",
    category: "question-no-mark",
  };

  it("accepts a well-formed entry", () => {
    expect(parseLabels([good])).toHaveLength(1);
  });

  it.each([
    ["not an array", { ...good }],
    ["an unknown case", [{ ...good, case: "maybe" }]],
    ["an unknown recipient", [{ ...good, recipient: "everyone" }]],
    ["a question with no recipient", [{ ...good, recipient: null }]],
    ["a recipient on a no-question", [{ ...good, case: "no-question", category: "concluded" }]],
    ["an unknown category", [{ ...good, category: "vibes" }]],
    ["a question filed under a non-question category", [{ ...good, category: "rhetorical" }]],
    ["an extra key", [{ ...good, verdict: "yes" }]],
    ["a missing why", [{ ...good, why: "" }]],
    ["a path that climbs out", [{ ...good, file: "../secrets.txt" }]],
    ["a duplicate file", [good, good]],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseLabels(raw)).toThrow();
  });
});

describe("the mechanical inbox — what it says without a model", () => {
  it("calls an agent's own question a dialog", () => {
    expect(mechanicalInbox(fixture("fleet-panes/dialog-ask-user-question.txt"))).toBe("dialog");
  });

  it("looks for a mark in the last three non-blank lines of the tail, and no further", () => {
    expect(endsWithAMark("a?\nb\nc\nd")).toBe(false);
    expect(endsWithAMark("a\nb?\n\n  \nc\nd")).toBe(true);
    expect(endsWithAMark("a\nb\nc\nd?")).toBe(true);
    expect(endsWithAMark("")).toBe(false);
  });

  // THE PIN. One line per labelled capture: what the mechanical inbox says.
  // Changing any of these is a change to the baseline, and should be argued for
  // in the commit that makes it.
  const PINNED: Record<string, string> = {
    "overseer-turn-tails/ended-prose-no-question-status-report.txt": "nothing",
    "overseer-turn-tails/ended-prose-no-question-two-messages.txt": "nothing",
    "overseer-turn-tails/ended-prose-question-recogniser-fixes.txt": "nothing",
    "overseer-turn-tails/ended-prose-question-shut-it-down.txt": "nothing",
    "overseer-turn-tails/ended-while-a-background-agent-runs-on.txt": "nothing",
    "overseer-turn-tails/mid-turn-spinner.txt": "nothing",
    "overseer-turn-tails/mid-turn-with-queued-message.txt": "nothing",
    "overseer-turn-tails/no-input-box-codex-tui.txt": "nothing",
    "overseer-turn-tails/no-input-box-job-shell.txt": "nothing",
    "overseer-turn-tails/question-no-mark-sol-sort-order.txt": "nothing",
    "overseer-turn-tails/question-no-mark-fable-empty-state-wording.txt": "nothing",
    "overseer-turn-tails/question-no-mark-greg-drop-remote-column.txt": "nothing",
    "overseer-turn-tails/question-overseer-merge-dev-first.txt": "question-mark",
    "overseer-turn-tails/question-overseer-whose-failures.txt": "question-mark",
    "overseer-turn-tails/question-self-reuse-helper.txt": "nothing",
    "overseer-turn-tails/question-self-commit-when-green.txt": "question-mark",
    "overseer-turn-tails/rhetorical-closing-why-tests-missed-it.txt": "question-mark",
    "overseer-turn-tails/rhetorical-mid-explanation-export-manifest.txt": "nothing",
    "overseer-turn-tails/concluded-clean-debrief.txt": "nothing",
    "overseer-turn-tails/concluded-premature-gates-skipped.txt": "nothing",
    "overseer-turn-tails/background-review-sol-in-tmux.txt": "nothing",
    "overseer-turn-tails/background-review-waiting-on-agent.txt": "nothing",
    "overseer-turn-tails/wrong-task-hard-version-in-primary.txt": "nothing",
    "fleet-panes/dialog-bash-permission.txt": "permission",
  };

  const labels = parseLabels(RAW_LABELS);
  const captures = new Map(labels.map((l) => [l.file, fixture(l.file)]));
  const score = scoreMechanical(labels, captures);

  it("says, for every labelled capture, exactly what it said when this was pinned", () => {
    expect(Object.fromEntries(score.perFile.map((r) => [r.file, r.mechanical]))).toEqual(PINNED);
  });

  it("scores to the pinned summary", () => {
    expect(summariseMechanical(score)).toBe(
      "mechanical catches 3 of 8 questions and raises 1 false alarm over 9 no-question turns; " +
        "2 of 24 labelled items are out of scope for this detector and not scored; " +
        "1 of 1 permission defect seen as a permission dialog",
    );
  });

  it("keeps out-of-scope items out of the scored counts, in both directions", () => {
    expect(score.questions.total + score.noQuestion.total + score.outOfScope.total).toBe(
      labels.filter((l) => l.case === "question" || l.case === "no-question" || l.case === "out-of-scope-for-this-detector")
        .length,
    );
    expect(score.outOfScope.total).toBe(2);
    expect(score.questions.caught + score.questions.missed).toBe(score.questions.total);
  });

  it("refuses to score a label whose capture it was not given", () => {
    expect(() => scoreMechanical(labels, new Map())).toThrow();
  });
});
