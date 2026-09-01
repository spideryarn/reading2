// @vitest-environment jsdom
/**
 * **Claims' panel, and the three things about it that are not cosmetic.**
 *
 * Every one of them is a rule the cross-family review made the condition of this
 * sub-mode surviving at all
 * (docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2), and every one is
 * a place where "it worked" and "it quietly went back to the rejected design"
 * look identical on a screenshot.
 *
 * 1. **Document order, never thinness order**, and **nothing on a row that could
 *    become a ranking.** The rejected design put the claims with the fewest
 *    passages at the top and called the empty row a finding. The failure it
 *    invites is named in the plan: *a tired referee opens Claims first, reads the
 *    top "thin" rows, and treats everything unlisted as clean.* So the fixture
 *    below is arranged so that document order and thinness order disagree, and
 *    there is a test that no number appears beside a claim at all — because a
 *    count is one glance from a ranking, and a rank badge is the ranking.
 * 2. **Three empty states, not two.** *Found passages*, *named none*, and *named
 *    some that could not be found in the paper* are three different things, and
 *    the middle sentence is false about the third. That distinction is exactly
 *    the one that went wrong in Criteria and needed GPT Sol's finding 4 to catch.
 * 3. **The null result is about the model.** The sentences come from
 *    src/referee-claims.ts as values; this file checks they reach the screen, and
 *    tests/referee-copy-is-about-the-model.test.ts checks what they may say.
 *
 * No router and no hook: `ClaimsView` is a pure function of its props, which is
 * the band-owns-the-state, panel-is-pure split every mode in this app makes.
 * Harness copied from tests/referee-mirror-panel.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Claim, ClaimsRun, OtherText } from "../src/referee-claims.js";
import {
  CLAIM_WITHHELD,
  CLAIMS_AT_CAP,
  claimsOmittedNote,
  MAX_CLAIMS,
  NO_PASSAGE_FOUND,
  OTHER_TEXT_NOTE,
  PASSAGES_CAPPED,
  PASSAGES_UNUSABLE,
  REASONING_WITHHELD,
  withheldNote,
} from "../src/referee-claims.js";
import { ClaimsView, inDocumentOrder } from "../src/web/ClaimsPanel.js";
import type { ClaimsApi } from "../src/web/useClaims.js";

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const FIRST = "spya-anc234";
const SECOND = "spya-bqd345";

/** The claim the paper states **first**, with two passages under it. */
const THICK: Claim = {
  id: `${FIRST}:8`,
  blockId: FIRST,
  quote: "the method halves annotation time",
  start: 8,
  claim: "The method halves annotation time",
  passages: [
    { blockId: "spya-cmr456", quote: "fell by about half", start: 0, reasoning: "the timing" },
    { blockId: "spya-dfw567", quote: "across both cohorts", start: 0, reasoning: "the second cohort" },
  ],
  discarded: 0,
};

/** The claim the paper states **second**, with one. */
const THIN: Claim = {
  id: `${SECOND}:9`,
  blockId: SECOND,
  quote: "it generalises to three unseen domains",
  start: 9,
  claim: "It generalises to three unseen domains",
  passages: [
    { blockId: "spya-ekn678", quote: "law, medicine and finance", start: 0, reasoning: "the domains" },
  ],
  discarded: 0,
};

function api(run: ClaimsRun | null, over: Partial<ClaimsApi> = {}): ClaimsApi {
  return {
    run,
    stale: false,
    loaded: true,
    loadFailed: false,
    pull: () => {},
    error: null,
    ...over,
  };
}

const done = (claims: Claim[]): ClaimsRun => ({
  status: "done",
  createdAt: "2026-09-01T00:00:00.000Z",
  claims,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(
  claims: Claim[],
  run?: ClaimsRun | null,
  over: Partial<ClaimsApi> = {},
  otherText: OtherText[] = [],
) {
  const r = run === undefined ? done(claims) : run;
  act(() => {
    root.render(
      createElement(ClaimsView, {
        api: api(r, over),
        claims,
        otherText,
        slots: new Map(claims.map((c, i) => [c.id, i])),
        showing: [],
        onToggle: () => {},
        onJump: () => {},
      }),
    );
  });
  return host;
}

/**
 * Two sentences of the paper's own that no claim above is anchored in — the
 * shape `otherTextInQuotes` produces, and deliberately carrying words that
 * would read as claims, because that is the case where the wording has to work.
 */
const OTHER_TEXT: OtherText[] = [
  { blockId: FIRST, text: "uses less peak memory than the current allocator,", start: 74 },
  { blockId: FIRST, text: "and is robust to adversarially constructed inputs.", start: 123 },
];

/* ------------------------------------------------- rule 1, on the screen -- */

describe("the order, and the absence of any way to rank", () => {
  it("draws the claims in the order it is given, thinnest last", () => {
    /* The band hands `ClaimsView` an already-sorted list, so this is the half
       that says the panel does not re-sort. The list is fed document-first and
       has to come out document-first — and the fixture is built so that a
       thinness sort would swap them, which is what makes the assertion mean
       something. */
    const rows = [...render([THICK, THIN]).querySelectorAll(".clm-claim")].map(
      (n) => n.textContent,
    );
    expect(rows).toEqual([THICK.claim, THIN.claim]);
  });

  it("prints no number anywhere on a claim row", () => {
    /* A rank badge, a passage count, a "2 of 5" — any of them is the rejected
       design arriving through the presentation layer. `CriterionResult` next
       door leads with an ordinal and is right to; this panel has nothing to
       number, because a claim's place is where the paper makes it.

       Scoped to the rows rather than the whole panel, so the note above the list
       is free to contain ordinary prose — and **the fixture's quotes carry no
       digits**, deliberately, because the paper's own words may. The first
       version of this assertion failed on "fell from 40 to 19 minutes", which is
       the test being wrong rather than the panel. */
    const list = render([THICK, THIN]).querySelector(".clm-list");
    expect(list).not.toBeNull();
    expect(list?.textContent ?? "").not.toMatch(/\d/);
  });

  it("sorts what the band is holding by position, even mid-stream", () => {
    /* The band's half of rule 1, and it needs its own test: `ClaimsView` is
       handed an already-sorted list, so a mutation making `inDocumentOrder` sort
       by `passages.length` left every assertion above green. That mutation is
       the whole reason this test and its export exist.

       It matters during the stream rather than after it: the authoritative
       answer is sorted by `validateClaims` on the server, but a claim previewed
       mid-stream cannot be placed there, because the claims after it have not
       arrived. */
    const at = new Map([
      [FIRST, 0],
      [SECOND, 1],
    ]);
    expect(inDocumentOrder([THIN, THICK], at).map((c) => c.claim)).toEqual([
      THICK.claim,
      THIN.claim,
    ]);
    // The claim that wins has MORE passages, so no ranking by support count in
    // either direction could produce this order.
    expect(THICK.passages.length).toBeGreaterThan(THIN.passages.length);
  });

  it("offers no sort control", () => {
    const panel = render([THICK, THIN]);
    expect(panel.querySelectorAll("select")).toHaveLength(0);
    expect(panel.textContent ?? "").not.toMatch(/sort/i);
  });
});

/* ------------------------------------------------- rule 2, the three states -- */

describe("the three things an empty claim can mean", () => {
  it("says the model did not find a passage when the model named none", () => {
    const panel = render([{ ...THIN, passages: [], discarded: 0 }]);
    expect(panel.textContent).toContain(NO_PASSAGE_FOUND);
    expect(panel.textContent).not.toContain(PASSAGES_UNUSABLE);
  });

  it("says something different when the model named passages and none could be found", () => {
    /* The state that used to be missing one sub-mode over, where a criterion
       whose every result was thrown away printed the *other* sentence and it was
       false. GPT Sol's finding 4. */
    const panel = render([{ ...THIN, passages: [], discarded: 2 }]);
    expect(panel.textContent).toContain(PASSAGES_UNUSABLE);
    expect(panel.textContent).not.toContain(NO_PASSAGE_FOUND);
  });

  it("says neither when there are passages to show", () => {
    const panel = render([THIN]);
    expect(panel.textContent).not.toContain(NO_PASSAGE_FOUND);
    expect(panel.textContent).not.toContain(PASSAGES_UNUSABLE);
  });

  it("draws a claim with no passages at the same weight as one with them", () => {
    /* Not an error colour and not an error shape: `.clm-none` is a quiet line,
       and dressing it as a warning is how it comes to be read as a finding about
       the paper rather than about the run. */
    const panel = render([{ ...THIN, passages: [], discarded: 0 }]);
    expect(panel.querySelector(".clm-none")).not.toBeNull();
    expect(panel.querySelector(".clm-error")).toBeNull();
  });
});

/* -------------------------------------------------- rule 3, and the doors -- */

describe("what the panel says a row is", () => {
  it("says linkage rather than adequacy, above the list rather than under it", () => {
    /* Above, because a note under a list is a note read after the list has
       already been read the wrong way. */
    const panel = render([THICK]);
    const note = panel.querySelector(".clm-what");
    expect(note?.textContent ?? "").toMatch(/yours to judge/i);
  });

  it("says the order is the paper's and is not a ranking", () => {
    expect(render([THICK]).querySelector(".clm-order")?.textContent ?? "").toMatch(/not ranked|nothing here is ranked/i);
  });

  it("makes every claim and every passage a button into the prose", () => {
    /* Rule 2 of the whole mode: every row is an index into the piece. One button
       for the claim's own sentence and one per passage. */
    const panel = render([THICK]);
    expect(panel.querySelectorAll(".clm-jump")).toHaveLength(3);
  });

  it("offers no way to copy the rows out", () => {
    // Greg vetoed a report scaffold, and a copy button on a claim with its
    // passages under it is that feature by another door.
    expect((render([THICK]).textContent ?? "").toLowerCase()).not.toContain("copy");
  });
});

/* ----------------------------------------------------------- other states -- */

describe("the run's own states", () => {
  it("says nothing about the paper when the model found no claims at all", () => {
    const panel = render([], done([]));
    expect(panel.textContent).toMatch(/The model did not find any claims/);
  });

  it("shows a failure and offers the button again", () => {
    const panel = render([], {
      status: "error",
      createdAt: "2026-09-01T00:00:00.000Z",
      claims: [],
      error: "The model stopped answering.",
    });
    expect(panel.textContent).toContain("The model stopped answering.");
    expect(panel.textContent).toContain("Try again");
  });

  it("says the paper has moved on, when it has", () => {
    const panel = render([THICK], done([THICK]), { stale: true });
    expect(panel.textContent).toMatch(/earlier version of this paper/i);
  });
});

/* ------------------------------------ the hole none of the three rules covered -- */

/**
 * **A claim that never gets a row is invisible, and this panel looked exactly
 * as tidy either way.**
 *
 * The sub-mode's defence against *a tired referee treats everything unlisted as
 * clean* is `NO_PASSAGE_FOUND` — a row, and an honest sentence under it. It
 * cannot fire for a claim the model never listed, because there is no row. The
 * eval found two papers dropping a claim from their own abstract, twice each,
 * with the dropped claim's words swallowed inside a neighbouring claim's quote
 * (evals/results/referee-claims.md).
 *
 * What is asserted here is the **wording**, because the wording is the whole
 * value: *what the answer did not account for*, never *the claims you missed*.
 * The second is a judgement about the paper made with worse evidence than the
 * one this sub-mode already refuses to make.
 */
describe("the rest of the text inside the passages the claims quote", () => {
  it("prints them, with the note that says what they are and are not", () => {
    const panel = render([THICK], undefined, {}, OTHER_TEXT);
    expect(panel.textContent).toContain(OTHER_TEXT_NOTE);
    for (const row of OTHER_TEXT) expect(panel.textContent).toContain(row.text);
  });

  it("draws nothing at all when the claims account for everything", () => {
    const panel = render([THICK]);
    expect(panel.textContent).not.toContain(OTHER_TEXT_NOTE);
  });

  it("keeps them out of the claims list, so no count of them can become a rank", () => {
    /* The list is where the no-digit rule holds, and these sentences are the
       paper's own words — full of numbers. Outside the list they are prose;
       inside it they would be a second column the eye reads as thinness. */
    const panel = render([THICK], undefined, {}, OTHER_TEXT);
    const list = panel.querySelector(".clm-list");
    expect(list?.textContent ?? "").not.toContain(OTHER_TEXT[0]?.text ?? "");
    expect(list?.textContent ?? "").not.toMatch(/\d/);
  });

  it("puts no number on them anywhere", () => {
    /* Six of these is not a worse answer than two. A count is one glance from a
       ranking, which is the whole reason this sub-mode survived its review. */
    const panel = render([THICK], undefined, {}, OTHER_TEXT);
    const section = [...panel.querySelectorAll("section.clm-row")].at(-1);
    expect(section).not.toBeNull();
    expect(section?.textContent ?? "").not.toMatch(/\b(two|2|6|six)\b/i);
  });

  it("stays away until the run is finished", () => {
    /* Mid-stream, every claim that has not arrived yet is a sentence nothing is
       anchored in. That is true of an incomplete answer and misleading on a
       screen — the band withholds the list until `done`, and this is the panel
       half of the same thought: it never draws a section it was handed nothing
       for. */
    const panel = render([THICK], { status: "pending", createdAt: "2026-09-01T00:00:00.000Z", claims: [THICK] }, {}, []);
    expect(panel.textContent).not.toContain(OTHER_TEXT_NOTE);
  });

  it("makes each one a door into the prose, like every other row", () => {
    const panel = render([THICK], undefined, {}, OTHER_TEXT);
    const section = [...panel.querySelectorAll("section.clm-row")].at(-1);
    expect(section?.querySelectorAll(".clm-jump")).toHaveLength(OTHER_TEXT.length);
  });
});

/* --------------------------------------------- the fail-safe, made visible -- */

/**
 * **A fail-safe nobody can see is a fail-safe nobody can check.**
 *
 * `validateClaims` blanks a `reasoning` line that reads as a verdict on whether
 * a passage carries its claim. If those frames ever start firing on ordinary
 * linkage sentences, the referee is the only one in a position to notice — and
 * they cannot notice a thing that only ever reached a log line.
 * docs/reusable/silent-success.md.
 */
describe("what the panel says when a line was withheld", () => {
  const withheldPassage: Claim = {
    ...THIN,
    passages: [
      { blockId: "spya-ekn678", quote: "law, medicine and finance", start: 0, reasoning: "", withheld: true },
    ],
  };

  it("says so where the line would have been, and says the passage survived", () => {
    const panel = render([withheldPassage]);
    expect(panel.textContent).toContain(REASONING_WITHHELD);
    expect(panel.textContent).toContain("law, medicine and finance");
  });

  it("counts them out loud rather than only in a log line", () => {
    expect(render([withheldPassage]).textContent).toContain(withheldNote(1));
  });

  it("says nothing when nothing was withheld", () => {
    const panel = render([THICK]);
    expect(panel.textContent).not.toContain(REASONING_WITHHELD);
    expect(panel.textContent).not.toContain(withheldNote(1));
  });
});

/* ------------------------------------------- the fail-safe, one row up -- */

/**
 * **The claim's own headline is model prose too, and it was the one piece of it
 * nothing scanned.**
 *
 * GPT Sol's second review, finding 2: the adequacy fail-safe read `reasoning`
 * only, so a verdict written into the biggest text on the row reached the
 * referee untouched — and a committed test pinned exactly that. The fallback is
 * the paper's own sentence, which is on the row already and is not the model's
 * judgement, so the row keeps a true label instead of losing the claim.
 */
describe("what the panel draws when a claim's own line was withheld", () => {
  const headlineWithheld: Claim = { ...THIN, claim: "", claimWithheld: true };

  it("says so, and lets the paper's own words be the label", () => {
    const panel = render([headlineWithheld]);
    expect(panel.textContent).toContain(CLAIM_WITHHELD);
    // The paper's sentence is still there, and still a door into the prose.
    expect(panel.textContent).toContain(THIN.quote);
    expect(panel.querySelectorAll(".clm-jump").length).toBeGreaterThan(0);
  });

  it("counts it in the same sentence as a withheld passage line", () => {
    /* One fail-safe, one number. A referee who is told two lines were withheld
       and can find only one has been told something false. */
    const panel = render([headlineWithheld]);
    expect(panel.textContent).toContain(withheldNote(1));
  });

  it("prints no empty headline where the line used to be", () => {
    const panel = render([headlineWithheld]);
    expect(panel.querySelectorAll(".clm-claim")).toHaveLength(0);
  });
});

/* ------------------------------------------------------ the caps, said -- */

/**
 * **A cap nobody is told about is a ranking.**
 *
 * GPT Sol's second review, finding 5: Claims sorts into document order and then
 * deletes everything past claim twenty and passage eight. The counts reached the
 * outcome and the server log and nothing reached the referee — so the panel
 * showed an apparently complete list in which the claims the paper makes last
 * had been dropped. That is a fourth ranking signal, visibility itself, in a
 * sub-mode built to have none, and the document-order comparators cannot save it
 * because they never see it.
 */
describe("what the panel says when a cap cut something", () => {
  it("says a claim's passage list is incomplete, without a number", () => {
    /* Numberless on the row, because a count of passages is one glance from a
       ranking and *how many were cut* is that count by another route. The
       number is on `Claim.passagesOmitted` for a log to read. */
    const panel = render([{ ...THIN, passagesOmitted: 4 }]);
    expect(panel.textContent).toContain(PASSAGES_CAPPED);
    expect(panel.querySelector(".clm-list")?.textContent ?? "").not.toMatch(/\d/);
  });

  it("says nothing on a row the cap did not touch", () => {
    expect(render([THICK]).textContent).not.toContain(PASSAGES_CAPPED);
  });

  it("says how many claims were cut, when the run carries the count", () => {
    const run: ClaimsRun = { ...done([THICK, THIN]), claimsOmitted: 3 };
    expect(render([THICK, THIN], run).textContent).toContain(claimsOmittedNote(3));
  });

  it("still says the cap was reached when the count did not survive the store", () => {
    /* Every run stored so far is this case: `validateClaims` counts the
       truncation and the route writes `claims` and `model` only. A full list is
       still proof the cap fired, and saying that beats saying nothing. */
    const full = Array.from({ length: MAX_CLAIMS }, (_, i) => ({
      ...THIN,
      id: `${SECOND}:${i}`,
      start: i,
    }));
    const panel = render(full);
    expect(panel.textContent).toContain(CLAIMS_AT_CAP);
    expect(panel.textContent).not.toContain(claimsOmittedNote(1));
  });

  it("says neither when the list is short of the cap", () => {
    const panel = render([THICK, THIN]);
    expect(panel.textContent).not.toContain(CLAIMS_AT_CAP);
  });
});
