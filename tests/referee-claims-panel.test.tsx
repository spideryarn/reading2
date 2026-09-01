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

import type { Claim, ClaimsRun } from "../src/referee-claims.js";
import { NO_PASSAGE_FOUND, PASSAGES_UNUSABLE } from "../src/referee-claims.js";
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

function render(claims: Claim[], run?: ClaimsRun | null, over: Partial<ClaimsApi> = {}) {
  const r = run === undefined ? done(claims) : run;
  act(() => {
    root.render(
      createElement(ClaimsView, {
        api: api(r, over),
        claims,
        slots: new Map(claims.map((c, i) => [c.id, i])),
        showing: [],
        onToggle: () => {},
        onJump: () => {},
      }),
    );
  });
  return host;
}

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
