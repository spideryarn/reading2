/**
 * A null result in Referee mode is evidence about the model, never about the
 * paper — and the copy has to say so.
 *
 * This is rule 1 of docs/plans/260831an-referee-mode-for-peer-reviewers.md
 * ("no verdict, ever") applied to the place it is easiest to break by accident.
 * When a criterion runs and matches nothing, there are two very different
 * sentences available:
 *
 *   "Nothing in this paper bears on that."      ← a claim about the paper
 *   "The model did not find a passage for this" ← a claim about the model
 *
 * Only the second one is true. A zero-result row can mean the extractor missed
 * a table, a figure or a supplement; that the paper words the thing differently;
 * or that the model simply failed. GPT Sol's review of the plan made this the
 * condition of Claims surviving at all, and the same reasoning binds every
 * sub-mode: the danger is a tired referee reading "nothing bears on that" and
 * treating the passage as cleared.
 *
 * **This is a tripwire, not a proof.** It scans source text for the handful of
 * phrasings that put the paper in the subject position, so it cannot catch a
 * new sentence nobody has thought of. What it does catch is the specific
 * regression — somebody rewriting the empty state into the shorter, more
 * natural, wrong sentence — which is how this one arrived in the first place
 * (found in a browser pass on 2026-09-01, committed and unnoticed by six
 * unit tests over the panel).
 *
 * Deterministic, no network, no model call, like everything under tests/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/**
 * Every surface that can render a Referee null result. Add the panel here when
 * you build it — Claims and Mirror are the two still to come, and both have a
 * "found nothing" state by construction.
 */
const REFEREE_SURFACES = ["src/web/CriteriaPanel.tsx"];

/**
 * Comments are stripped before the scan, because the rule is about what a
 * reader sees. A comment explaining *why* a sentence is banned has to be able
 * to quote it — the first version of this test failed on its own fix, which is
 * a tripwire doing something close to the right thing for the wrong reason.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Sentences that make the *paper* the subject of a null result. Each is here
 * because it reads as a finding rather than as a failure to find.
 */
const ABOUT_THE_PAPER = [
  "nothing in this paper",
  "nothing in the paper",
  "this paper does not",
  "the paper does not address",
  "is unsupported",
  "no passage supports",
  "nothing bears on",
];

describe("what Referee says when it found nothing", () => {
  it("never puts the paper in the subject position", () => {
    const offenders: string[] = [];
    for (const rel of REFEREE_SURFACES) {
      const text = withoutComments(readFileSync(join(ROOT, rel), "utf8")).toLowerCase();
      for (const phrase of ABOUT_THE_PAPER) {
        if (text.includes(phrase)) offenders.push(`${rel}: "${phrase}"`);
      }
    }
    expect(
      offenders,
      offenders.length
        ? `A null result is only ever evidence about the model. Rewrite so the ` +
          `model is the subject — "the model did not find …" — rather than the paper.`
        : "",
    ).toEqual([]);
  });

  it("says the model is the one that did not find it", () => {
    const panel = withoutComments(
      readFileSync(join(ROOT, "src/web/CriteriaPanel.tsx"), "utf8"),
    );
    expect(
      panel,
      `The zero-result branch has to name the model as the thing that came up ` +
        `empty, or the reader has no way to tell a failure to find from a finding.`,
    ).toMatch(/did not find/i);
  });
});
