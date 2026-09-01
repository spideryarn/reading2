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

import { CLAIMS_UNUSABLE } from "../src/referee-claims-run.js";
import {
  DOCUMENT_ORDER_NOTE,
  NO_PASSAGE_FOUND,
  PASSAGES_UNUSABLE,
  REASONING_WITHHELD,
  UNACCOUNTED_HEADING,
  UNACCOUNTED_NOTE,
} from "../src/referee-claims.js";
import { ANSWER_UNUSABLE } from "../src/referee-criteria-run.js";
import { ALL_DROPPED, COI_NOT_CHECKED, NO_NAMES_YET } from "../src/referee-candidates.js";

const ROOT = join(import.meta.dirname, "..");

/**
 * Every surface that can render a Referee null result. Add the panel here when
 * you build one.
 *
 * **Claims joined on 2026-09-01**, and it is the sub-mode this whole test was
 * written for: the cross-family review made "the model did not find a passage
 * for this" — never "none", never "unsupported", never "the paper does not
 * address this" — the condition of Claims surviving at all. Most of its copy
 * lives in src/referee-claims.ts as values rather than as strings inside the
 * panel, and those are checked below as values, which is the stronger of the two
 * checks. The panel is scanned as well, because the sentences it writes for
 * *itself* — the run-level "no claims at all" branch — are exactly where the
 * shorter, wrong version would be typed.
 *
 * **Mirror joined on 2026-09-01**, and it is the harder case rather than a
 * second easy one. Its null result is not about the paper at all: an empty
 * remark list means *the model had nothing to say about your comments*, and its
 * `coverage` remark means *your notes have not taken this criterion up*. Both
 * are one careless rewrite away from being about the paper instead — "nothing
 * in this paper bears on that criterion" is the shorter sentence and a claim
 * Mirror has no standing whatever to make, since it was never given the paper.
 */
const REFEREE_SURFACES = [
  "src/web/CriteriaPanel.tsx",
  "src/web/MirrorPanel.tsx",
  "src/web/ClaimsPanel.tsx",
  /* **Candidates joined on 2026-09-01**, and its null result is about neither
     the paper nor the referee's notes but about *people*. That makes the wrong
     sentence a different and larger claim: "no suitable reviewers were found" is
     about the field, and this app — which has no scholarly identity graph and
     ran a handful of web searches — has no standing whatever to make it. The
     phrase list below does not catch that one, so `ALL_DROPPED` and
     `NO_NAMES_YET` are checked as values in their own block further down. */
  "src/web/CandidatesPanel.tsx",
  /* **The source scan joined on 2026-09-01**, and it is the one surface here
     whose null result comes from no model at all — src/injection-scan.ts is
     deterministic. It is on the list anyway, because the failure it can produce
     is the same one in a worse place: a referee reading *nothing found* as *this
     manuscript is clean*, when what was actually checked was one HTML string
     with the cascade approximated, no stylesheet fetched, no script run and a
     PDF not opened at all. The phrases below are the wrong sentences for it too.
     tests/source-scan-notice.test.tsx holds the rules that are its own. */
  "src/web/SourceScanNotice.tsx",
];

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

/**
 * **The third state, added 2026-09-01.** There are three, not two: the model
 * found passages, the model found nothing, and the model found something and
 * could not produce a usable answer about it. The third used to render as the
 * second — a criterion stored `done` with no results, and the panel printing
 * "the model did not find a passage for this", which was false. GPT Sol's
 * finding 4.
 *
 * Its sentence does not live in a panel file, so the scan below cannot see it:
 * it is the stored `error` on the criterion, raised in
 * src/referee-criteria-run.ts, and it has to keep the same rule. Checked as a
 * value rather than as source text, which is the stronger check of the two.
 */
describe("what Referee says when the answer it got was unusable", () => {
  it("makes the model the subject, not the paper", () => {
    expect(ANSWER_UNUSABLE.toLowerCase()).toMatch(/^the model /);
    for (const phrase of ABOUT_THE_PAPER) {
      expect(ANSWER_UNUSABLE.toLowerCase(), phrase).not.toContain(phrase);
    }
  });

  it("says the model gave an answer, so it cannot be read as having found nothing", () => {
    /* The whole point of the sentence: "found nothing" and "found something
       and could not say anything usable about it" call for different actions,
       so they must not be one sentence. */
    expect(ANSWER_UNUSABLE).not.toMatch(/did not find/i);
  });

  it("carries a bracketed code, so a referee can quote four characters", () => {
    // docs/project/copy.md § The bracketed code.
    expect(ANSWER_UNUSABLE).toMatch(/\[[a-z0-9-]+\]$/);
  });
});

/**
 * **Claims' own copy, checked as values.**
 *
 * Four sentences, and each is a rule rather than a phrasing:
 *
 * - `NO_PASSAGE_FOUND` is the second outcome — the model looked and named
 *   nothing — and it has to put the model in the subject position, because a
 *   zero-passage row is evidence about a search rather than about a paper.
 * - `PASSAGES_UNUSABLE` is the **third** outcome, which Criteria did not have a
 *   sentence for until GPT Sol's finding 4: the model named passages and none of
 *   them could be found in the paper. It must not be readable as "did not find",
 *   because those two call for different actions.
 * - `CLAIMS_UNUSABLE` is the same distinction at the level of the whole run.
 * - `DOCUMENT_ORDER_NOTE` is the other half of the review's finding: the list is
 *   in the paper's order and is not a ranking, and a reader who assumes
 *   best-first reads the top and stops.
 */
describe("what Claims says about an empty answer", () => {
  it("makes the model the subject of both empty states", () => {
    for (const sentence of [NO_PASSAGE_FOUND, PASSAGES_UNUSABLE, CLAIMS_UNUSABLE]) {
      expect(sentence.toLowerCase()).toMatch(/^the model /);
      for (const phrase of ABOUT_THE_PAPER) {
        expect(sentence.toLowerCase(), phrase).not.toContain(phrase);
      }
    }
  });

  it("keeps 'found nothing' and 'found things I could not use' apart", () => {
    /* The whole reason there are three sentences and not two. Both of these
       would be false about the other's state, and the panel picks between them
       on `Claim.discarded`. */
    expect(NO_PASSAGE_FOUND).toMatch(/did not find/i);
    expect(PASSAGES_UNUSABLE).not.toMatch(/did not find/i);
    expect(CLAIMS_UNUSABLE).not.toMatch(/did not find/i);
  });

  it("carries a bracketed code on the run-level failure", () => {
    // docs/project/copy.md § The bracketed code.
    expect(CLAIMS_UNUSABLE).toMatch(/\[[a-z0-9-]+\]$/);
  });

  it("says the order is not a ranking, which is the other half of the finding", () => {
    expect(DOCUMENT_ORDER_NOTE.toLowerCase()).toContain("ranked");
    // And says nothing that could be read as one claim being weaker than another.
    expect(DOCUMENT_ORDER_NOTE.toLowerCase()).not.toMatch(/weakest|strongest|least supported/);
  });
});

/**
 * **Candidates' own copy, checked as values.**
 *
 * Three sentences, and each is a rule rather than a phrasing:
 *
 * - `NO_NAMES_YET` and `ALL_DROPPED` are two of the three states, kept apart for
 *   the reason Claims keeps its three apart: *nobody was named* and *people were
 *   named and none survived the rules* call for different actions from the
 *   editor.
 * - `COI_NOT_CHECKED` is the one that has to say what did **not** happen. Half
 *   of what publishers call a conflict is mechanically checkable from public
 *   data and this app checks none of it; the other half is not automatable by
 *   anybody. Any sentence that could be read as "we checked and it is clear" is
 *   the specific move the editor research says editors already distrust, and it
 *   is worse here than an ordinary null result: an editor who believes a
 *   conflict filter ran will not run one.
 */
describe("what Candidates says about an empty shortlist, and about conflicts", () => {
  it("makes the model the subject when names were dropped", () => {
    expect(ALL_DROPPED.toLowerCase()).toMatch(/^the model /);
    for (const phrase of ABOUT_THE_PAPER) {
      expect(ALL_DROPPED.toLowerCase(), phrase).not.toContain(phrase);
    }
  });

  it("never says the field has no suitable reviewers", () => {
    /* The larger wrong claim, and the one the phrase list above cannot see. */
    for (const sentence of [ALL_DROPPED, NO_NAMES_YET]) {
      expect(sentence.toLowerCase()).not.toMatch(/no (suitable|qualified|good) (reviewers|candidates)/);
      expect(sentence.toLowerCase()).not.toMatch(/nobody (is|would be) suitable/);
    }
  });

  it("keeps 'nobody named' and 'named and none shown' apart", () => {
    expect(NO_NAMES_YET).not.toMatch(/none of them could be shown/i);
    expect(ALL_DROPPED).toMatch(/none of them could be shown/i);
  });

  it("says the conflict check did not run, and never that it came back clear", () => {
    expect(COI_NOT_CHECKED.toLowerCase()).toMatch(/no conflict-of-interest check has run/);
    for (const claim of [
      /no conflicts? (were )?found/,
      /no conflicts? of interest(?! check)/,
      /clear of/,
      /independent of the authors/,
    ]) {
      expect(COI_NOT_CHECKED.toLowerCase(), String(claim)).not.toMatch(claim);
    }
  });

  it("names both halves, so it cannot be read as a partial filter having run", () => {
    /* Saying only "we did not check co-authorship" would imply the rest was
       handled. Saying only "some things cannot be checked by anyone" would imply
       the checkable half was. Both halves, or neither is honest. */
    expect(COI_NOT_CHECKED.toLowerCase()).toContain("co-authorship");
    expect(COI_NOT_CHECKED.toLowerCase()).toContain("advisor");
  });
});

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

/**
 * **The two sentences added on 2026-09-01, and they are the ones most likely to
 * drift into being about the paper.**
 *
 * An eval found that Claims could drop a claim from a paper's own abstract and
 * leave a panel that looked perfectly tidy — the sub-mode's whole defence,
 * `NO_PASSAGE_FOUND`, cannot fire for a claim that never got a row. The answer
 * is a list of the sentences no claim above is anchored in, and **the wording is
 * the entire value of it**. One word in the wrong direction and it becomes
 * *here are the claims the model missed*, which is a judgement about the paper
 * made with worse evidence than the judgement this sub-mode already refuses to
 * make: a block a claim came from carries background, citation and setup as
 * well as claims.
 *
 * `REASONING_WITHHELD` has the same shape of danger one field over. A line was
 * taken out because it read as a verdict; the sentence in its place must say
 * that about the *model's line*, and must not become *this passage does not
 * carry the claim*, which is the verdict itself wearing our clothes.
 */
describe("what Claims says about the sentences it did not account for", () => {
  it("never puts the paper in the subject position", () => {
    for (const sentence of [UNACCOUNTED_HEADING, UNACCOUNTED_NOTE, REASONING_WITHHELD]) {
      for (const phrase of ABOUT_THE_PAPER) {
        expect(sentence.toLowerCase(), phrase).not.toContain(phrase);
      }
    }
  });

  it("never calls them claims the model missed, which is the same judgement in reverse", () => {
    const note = `${UNACCOUNTED_HEADING} ${UNACCOUNTED_NOTE}`.toLowerCase();
    for (const phrase of [
      "missed",
      "missing",
      "omitted",
      "left out",
      "overlooked",
      "should have",
      "failed to",
      "unlisted claim",
    ]) {
      expect(note, phrase).not.toContain(phrase);
    }
  });

  it("says out loud that some of them will not be claims, and hands the judgement over", () => {
    /* Without this the list reads as an accusation, and a referee who reads it
       that way will either dismiss it or over-trust it. Both are worse than
       reading three sentences of the paper, which is what it is for. */
    expect(UNACCOUNTED_NOTE.toLowerCase()).toContain("background");
    expect(UNACCOUNTED_NOTE.toLowerCase()).toMatch(/decide for yourself/);
  });

  it("makes the model's line the thing that was withheld, not the passage", () => {
    expect(REASONING_WITHHELD.toLowerCase()).toMatch(/^the model's line/);
    // And says the passage is still there, or a referee wonders what else went.
    expect(REASONING_WITHHELD.toLowerCase()).toContain("untouched");
  });
});
