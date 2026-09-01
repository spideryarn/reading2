// @vitest-environment jsdom
/**
 * **Mirror's panel, and the one thing about it that is not cosmetic.**
 *
 * Two of Mirror's five remark kinds carry `trialTested: false`, stamped by code
 * rather than by the model (`validateRemarks` in src/referee-mirror.ts). The
 * reason is written at length on `RemarkCommon.trialTested`: the ICLR 2025
 * randomised trial tested *three* categories — vagueness, overlooked content,
 * unprofessional remarks — and `coverage` and `placement` are not among them.
 *
 * **A panel that printed all five alike would be the mode telling a lie of
 * exactly the kind it exists to avoid.** The whole design rests on one
 * measured result, and a referee has to be able to tell a remark that result
 * covers from one it does not. So the distinction is a rendered, readable
 * *word* on every row — not a colour, not a border, not a tooltip — and this
 * file is what says so.
 *
 * The other three cases here are the states this feature will actually be in
 * most of the time, and each of them is one where "it worked" and "it broke"
 * look the same on a screenshot:
 *
 *  - **Empty is success.** Abstention is the design; most comments should
 *    produce no remark. A panel that renders an empty list as a blank, or as
 *    something the referee reads as a failure, has taken the commonest correct
 *    answer and made it look like a bug.
 *  - **Nothing to read is not the same as nothing to say.** A referee whose
 *    comments are all bookmarks was never asked the question, and telling them
 *    "no remarks" would be a claim about notes they have not written.
 *  - **A failure says so and offers the button again.**
 *
 * No router and no hook: `MirrorView` is a pure function of its props, which is
 * the band-owns-the-URL, panel-is-pure split every mode in this app makes.
 * Harness copied from tests/quiz-panel.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  MirrorInput,
  MirrorRemark,
  MirrorResult,
} from "../src/referee-mirror-types.js";
import { MirrorView } from "../src/web/MirrorPanel.js";
import type { MirrorApi } from "../src/web/useMirror.js";

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const BLOCK = "spya-k3m9qt";
const OTHER = "spya-p7w2dn";

function comment(id: string, over: Partial<MirrorInput["comments"][number]> = {}) {
  return {
    id,
    blockId: BLOCK,
    quote: "the controls were matched",
    body: "This is weak.",
    passage: "In the second study the controls were matched on age alone.",
    ...over,
  };
}

function input(over: Partial<MirrorInput> = {}): MirrorInput {
  return {
    comments: [comment("spya-cmt2aa"), comment("spya-cmt2bb", { blockId: OTHER })],
    placements: [],
    skippedBookmarks: 0,
    badValence: 0,
    skippedOrphans: 0,
    skippedTagged: 0,
    truncated: 0,
    clippedBodies: 0,
    clippedCriteria: 0,
    criteriaOmitted: 0,
    ...over,
  };
}

/** One of each kind, so the two labels are both on screen at once. */
const ALL_FIVE: MirrorRemark[] = [
  {
    kind: "specificity",
    trialTested: true,
    commentId: "spya-cmt2aa",
    blockId: BLOCK,
    note: "An author cannot tell from this which part of the design you mean.",
  },
  {
    kind: "misunderstanding",
    trialTested: true,
    commentId: "spya-cmt2bb",
    blockId: OTHER,
    passage: "matched on age alone",
    note: "The passage names one matching variable; your note reads as though it named none.",
  },
  {
    kind: "tone",
    trialTested: true,
    commentId: "spya-cmt2aa",
    blockId: BLOCK,
    note: "This would land as contempt rather than as criticism.",
  },
  {
    kind: "coverage",
    trialTested: false,
    criterion: "Are the controls adequate?",
    note: "None of your comments so far takes this criterion up.",
  },
  {
    kind: "placement",
    trialTested: false,
    commentId: "spya-cmt2bb",
    blockId: OTHER,
    passage: "matched on age alone",
    valence: -70,
    note: "You put a strong number on this passage and wrote nothing under it.",
  },
];

function done(over: Partial<MirrorResult> = {}): MirrorResult {
  return {
    remarks: ALL_FIVE,
    input: input(),
    coverage: { asked: true, criteriaOmitted: 0 },
    placementsOmitted: 0,
    model: "a-model",
    ...over,
  };
}

const asked: string[] = [];
const jumped: string[] = [];

function api(over: Partial<MirrorApi> = {}): MirrorApi {
  return {
    status: "done",
    writing: false,
    result: done(),
    error: null,
    ask: () => {
      asked.push("ask");
    },
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

function paint(a: MirrorApi) {
  act(() => {
    root.render(
      createElement(MirrorView, { api: a, onJump: (id: string) => jumped.push(id) }),
    );
  });
}

/** The text of the panel, with whitespace flattened so wrapping cannot matter. */
function text(): string {
  return (host.textContent ?? "").replace(/\s+/g, " ");
}

function buttons(label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter(
    (b) => (b.textContent ?? "").trim() === label,
  ) as HTMLButtonElement[];
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  asked.length = 0;
  jumped.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a referee can tell a trial-tested remark from one that is not", () => {
  it("prints the evidence on every row, in words", () => {
    paint(api());

    const rows = [...host.querySelectorAll("[data-kind]")];
    expect(rows.length, "one row per remark").toBe(5);

    for (const row of rows) {
      const kind = row.getAttribute("data-kind");
      const badge = row.querySelector("[data-trial-tested]");
      expect(badge, `${kind} has no evidence label at all`).not.toBeNull();
      const says = (badge?.textContent ?? "").toLowerCase();
      /* **The words, not the attribute.** A `data-` attribute is what this test
         finds the badge by; what the referee gets is the sentence inside it,
         and a badge that carried the right attribute and no text would satisfy
         a laxer assertion while showing nothing. */
      if (kind === "coverage" || kind === "placement") {
        expect(says, `${kind} must say a trial did NOT test it`).toContain("not tested");
      } else {
        expect(says, `${kind} must say a trial tested it`).not.toContain("not tested");
        expect(says, `${kind} must say a trial tested it`).toContain("tested");
      }
    }
  });

  it("says it three times and denies it twice — the control on the assertion above", () => {
    /* Without this, a panel that printed "not tested in a trial" on all five
       rows would pass every check in the test above except one, and a panel
       that printed nothing at all on the three would pass none of them for a
       reason that reads like a typo. Counting both halves is what makes the
       claim "the two are distinguishable" rather than "one of them is right". */
    paint(api());
    const badges = [...host.querySelectorAll("[data-trial-tested]")].map((b) =>
      (b.textContent ?? "").toLowerCase(),
    );
    expect(badges.filter((b) => b.includes("not tested")).length).toBe(2);
    expect(badges.filter((b) => !b.includes("not tested")).length).toBe(3);
  });

  it("explains what the two labels mean, once, rather than leaving them as jargon", () => {
    paint(api());
    /* The footnote is the honest core of the mode in one sentence: three of
       these were measured, two were not. A badge with no explanation anywhere
       is a word a referee has to guess at. */
    expect(text().toLowerCase()).toContain("randomised trial");
  });
});

describe("every remark is an index into the piece", () => {
  it("jumps to the block a comment remark is about", () => {
    paint(api());
    const jump = host.querySelector("[data-kind='misunderstanding'] button");
    act(() => {
      jump?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(jumped).toEqual([OTHER]);
  });

  it("does not pretend a coverage remark points at a passage", () => {
    /* A coverage remark exists precisely because *no* comment bears on the
       criterion, so there is no block to jump to. A row that offered one would
       be sending the referee somewhere the model never said anything about. */
    paint(api());
    const row = host.querySelector("[data-kind='coverage']");
    expect(row?.querySelector("button")).toBeNull();
  });
});

describe("a minted placement, whose comment the model never saw", () => {
  /* The comment a `placement` remark is about is in `MirrorInput.placements`
     and not in `comments`, because it is never sent. A panel that looked the id
     up in one list only would print a block id where the referee's own marked
     words belong — and `spya-p7w2dn` is not a thing a peer reviewer can read. */
  it("shows the referee's own marked words, not the block id", () => {
    paint(
      api({
        result: done({
          input: input({
            comments: [comment("spya-cmt2aa")],
            placements: [comment("spya-cmt2bb", { blockId: OTHER })],
          }),
        }),
      }),
    );
    const row = host.querySelector("[data-kind='placement']");
    expect(row?.textContent ?? "").toContain("the controls were matched");
    expect(row?.textContent ?? "").not.toContain(OTHER);
  });

  it("says how many placements did not fit, rather than showing six of eight in silence", () => {
    paint(api({ result: done({ placementsOmitted: 2 }) }));
    const said = text().toLowerCase();
    expect(said).toContain("2 other placements");
    expect(said).toContain("furthest from zero");
  });

  it("says nothing about omitted placements when none were", () => {
    paint(api());
    expect(text().toLowerCase()).not.toContain("other placement");
  });
});

describe("the empty answer, which is the common one", () => {
  it("reads as an answer rather than as a breakage", () => {
    paint(api({ result: done({ remarks: [] }) }));

    const said = text();
    expect(said.length, "the panel must not go blank").toBeGreaterThan(20);
    /* The model read the referee's comments and had nothing to raise. That is
       what it should do most of the time, so the sentence has to say so — and
       must not be the error sentence, which is what a lazy `remarks.length ||
       error` branch would give. */
    expect(said.toLowerCase()).toContain("nothing to raise");
    expect(host.querySelector(".mir-error")).toBeNull();
  });

  it("says when there was nothing of the referee's to read in the first place", () => {
    /* Not the same answer, and the difference matters: "the model had no
       remark" is a claim about comments the referee wrote, and this referee
       has not written any. */
    paint(
      api({
        result: done({
          remarks: [],
          input: input({ comments: [], skippedBookmarks: 3 }),
          coverage: { asked: false, reason: "nothing-to-mirror" },
        }),
      }),
    );
    const said = text().toLowerCase();
    expect(said).toContain("bookmark");
    expect(said).not.toContain("nothing to raise");
  });
});

describe("the states either side of an answer", () => {
  it("shows that a run is under way, and will not start a second", () => {
    paint(api({ status: "running", result: null }));
    expect(text().toLowerCase()).toContain("reading your comments");
    for (const b of [...host.querySelectorAll("button")]) {
      expect(b.disabled, `"${b.textContent}" is live during a run`).toBe(true);
    }
  });

  it("says something different once the model has begun answering", () => {
    /* The whole point of streaming a call with no incremental extractor behind
       it: the referee can tell the difference between waiting and being
       answered. Identical copy for both would spend the bytes and buy nothing. */
    const waiting = (() => {
      paint(api({ status: "running", writing: false, result: null }));
      return text();
    })();
    paint(api({ status: "running", writing: true, result: null }));
    expect(text()).not.toBe(waiting);
  });

  it("shows a failure with its reason and offers the run again", () => {
    paint(
      api({ status: "failed", result: null, error: "The model stopped talking." }),
    );
    expect(text()).toContain("The model stopped talking.");
    expect(host.querySelector(".mir-error")).not.toBeNull();
    expect(buttons("Try again").length).toBe(1);
  });

  it("offers the run before anything has been asked for", () => {
    paint(api({ status: "idle", result: null }));
    const [run] = buttons("Read my comments back to me");
    expect(run).toBeDefined();
    act(() => {
      run?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(asked).toEqual(["ask"]);
  });
});

describe("coverage is only claimed when the question was actually put", () => {
  it("says why it was not, when the referee has criteria and some comments were dropped", () => {
    paint(
      api({
        result: done({
          remarks: [],
          input: input({ skippedOrphans: 1 }),
          coverage: { asked: false, reason: "comments-dropped" },
        }),
      }),
    );
    expect(text().toLowerCase()).toContain("could not be read");
  });

  it("says when part of what the referee wrote went in cut", () => {
    /* The cross-family review's finding 1. A comment clipped at 1,500
       characters reaches the model with its last sentence gone, and a coverage
       claim over it would range over text nobody sent. */
    paint(
      api({
        result: done({ coverage: { asked: false, reason: "text-clipped" } }),
      }),
    );
    const said = text().toLowerCase();
    expect(said).toContain("too long to send whole");
  });

  it("says when the criteria list itself was cut, even though the question was put", () => {
    /* `asked: true` on its own let a run that considered the first twenty-four
       read as one that considered all thirty — the reassuring direction to be
       wrong in. */
    paint(
      api({
        result: done({ coverage: { asked: true, criteriaOmitted: 6 } }),
      }),
    );
    expect(text().toLowerCase()).toContain("6 criteria of yours were not put to the model");
  });

  it("stays quiet about it when the referee simply has no criteria", () => {
    /* Not a gap to report. A referee who has written no criteria has not asked
       a question that went unanswered, and nagging them about it here would be
       Mirror advertising another sub-mode inside a remark list. */
    paint(
      api({
        result: done({
          remarks: [],
          coverage: { asked: false, reason: "no-criteria" },
        }),
      }),
    );
    expect(text().toLowerCase()).not.toContain("criteria");
  });
});
