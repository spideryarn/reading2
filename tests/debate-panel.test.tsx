// @vitest-environment jsdom
/**
 * **The Debate band, and the seven things about it that can be got wrong
 * quietly.**
 *
 * This mode's whole design is a set of refusals, and a refusal is invisible on
 * a screenshot: a panel showing four rows looks identical whether it refused
 * six or refused none. So almost everything worth testing here is a *sentence*
 * that has to be present, absent, or different from its neighbour.
 *
 *  1. **The three empty states are three different sentences.** Collapsing them
 *     is the silent-success failure this mode exists to obey
 *     (docs/reusable/silent-success.md). *The search found nothing to look at*,
 *     *the search found pages we could not verify* and *the search failed* are
 *     three different facts about the world, and a reader who is told the first
 *     when the second is true has been told something false.
 *  2. **No score, anywhere.** Greg asked for a positive/negative icon and a
 *     red/green scheme *"but without a score"*. A percentage, a bar or a number
 *     hands the reader a verdict on a piece they are in the middle of reading.
 *  3. **`neutral` and `unknown` are drawn as calmly as the rest.** A model that
 *     cannot tell whether a page agrees should say so and be believed — the
 *     rule docs/project/timeline.md applies to an undated row.
 *  4. **`relation`, `valence` and `applies` are grouped under "AI
 *     interpretation", and the quotation is not.** They are the model's reading
 *     of a stranger's page; the quotation is characters we located in that
 *     page's own extract. A row that draws them alike is claiming the first is
 *     as checkable as the second.
 *  5. **The foot lines fire on the counts the artefact stores.** `reportedRows`
 *     against `keptRows`, and `returnedSources` against the count of *distinct
 *     row URLs* — the second is the one a model can walk past with every other
 *     counter reading clean (Sol's F13).
 *  6. **The excerpt is a slice of a stranger's page and is rendered as text.**
 *  7. **`searchedAt` is displayed provenance, not staleness**, and the two say
 *     different things on screen.
 *
 * Each has a positive control beside it, because a test that has never been
 * able to fail is not evidence.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BlockId,
  ClaimDebateRow,
  Debate,
  DebateCounts,
  DebateLosses,
  DebateValence,
  DirectDebateRow,
} from "../src/types.js";
import type { UseDebate } from "../src/web/useDebate.js";
import {
  DEBATE_CLAIMS_NONE,
  DEBATE_CLAIMS_UNVERIFIED,
  DEBATE_NO_RANKING,
  DEBATE_RESPONSES_NONE,
  DEBATE_RESPONSES_UNVERIFIED,
} from "../src/messages.js";

const { DebatePanel, VALENCE_APPEARANCE, keptNote, searchedOn, sourcesNote } = await import(
  "../src/web/DebatePanel.js"
);

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const KNOWN = "spya-k3m9qt" as BlockId;

function losses(over: Partial<DebateLosses> = {}): DebateLosses {
  return {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
    ...over,
  };
}

function counts(over: Partial<DebateCounts> = {}): DebateCounts {
  return {
    returnedSources: 2,
    reportedRows: 1,
    keptRows: 1,
    omittedOverCap: 0,
    lost: losses(),
    webSearches: 3,
    ...over,
  };
}

function direct(over: Partial<DirectDebateRow> = {}): DirectDebateRow {
  return {
    id: "spya-d2w4rt",
    url: "https://example.org/a-reply",
    title: "A reply to the piece",
    sourceQuote: "the argument here does not survive its own third section",
    articleReferenceQuote: "Notes on my sourdough starter, week 3",
    relation: "disputes",
    valence: "negative",
    applies: "It says the piece's third section contradicts its second.",
    ...over,
  };
}

function claim(over: Partial<ClaimDebateRow> = {}): ClaimDebateRow {
  return {
    id: "spya-c7w2dn",
    url: "https://another.example.net/on-starters",
    title: "On starters",
    sourceQuote: "warmer water is what a day-three starter wants",
    relation: "qualifies",
    valence: "neutral",
    applies: "It agrees with the claim but only above 22°C.",
    claimQuote: "a starter needs cool water",
    blockId: KNOWN,
    ...over,
  };
}

function artefact(over: Partial<Debate> = {}): Debate {
  return {
    version: "debate/1",
    generator: "a-model",
    slug: "a-piece",
    sourceHash: "hash",
    searchedAt: "2026-09-05T10:00:00.000Z",
    direct: { rows: [direct()], counts: counts() },
    claims: { rows: [claim()], counts: counts() },
    elapsedMs: 1,
    ...over,
  };
}

function owner(over: Partial<UseDebate> = {}): UseDebate {
  return {
    status: "ready",
    debate: artefact(),
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const jumped: BlockId[] = [];

function paint(o: UseDebate) {
  act(() => {
    root.render(
      createElement(DebatePanel, {
        access: { kind: "owner", owner: o },
        onJump: (id: BlockId) => jumped.push(id),
      }),
    );
  });
}

const text = () => host.textContent ?? "";

beforeEach(() => {
  jumped.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the three empty states are three different sentences", () => {
  /* The positive control for the whole section: if two of these ever become one
     string, every assertion below still passes and this one does not. */
  it("has three distinguishable sentences to say in the first place", () => {
    const all = [
      DEBATE_RESPONSES_NONE,
      DEBATE_RESPONSES_UNVERIFIED,
      DEBATE_CLAIMS_NONE,
      DEBATE_CLAIMS_UNVERIFIED,
    ];
    expect(new Set(all).size).toBe(all.length);
    /* Never *"No one has written about it"* — we cannot see the query, so what
       we have is evidence of a bounded search rather than a claim about the
       web. */
    for (const s of all) expect(s.toLowerCase()).not.toContain("no one has");
  });

  it("says the search found nothing to look at, when it returned no pages", () => {
    paint(
      owner({
        debate: artefact({
          direct: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
    );
    expect(text()).toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(DEBATE_RESPONSES_UNVERIFIED);
  });

  /* The middle row of the plan's table, and the one an implementation collapses
     first: candidates came back and not one of them could be checked. */
  it("says the excerpts were not enough, when it returned pages and kept nothing", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [],
            counts: counts({
              returnedSources: 6,
              reportedRows: 3,
              keptRows: 0,
              lost: losses({ unverifiedSource: 3 }),
            }),
          },
        }),
      }),
    );
    expect(text()).toContain(DEBATE_RESPONSES_UNVERIFIED);
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
  });

  /* The third state is the ordinary job failure, and the thing that must be
     true of it is that it says neither of the other two: a failed pass is not
     evidence about the web at all. */
  it("says neither when the step failed, and shows the failure instead", () => {
    paint(
      owner({
        status: "none",
        debate: null,
        failed: {
          message: "The search did not run.",
          retryable: false,
          retry: null,
          kind: "step",
        } as UseDebate["failed"],
      }),
    );
    expect(text()).toContain("The search did not run.");
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(DEBATE_RESPONSES_UNVERIFIED);
  });

  /* **A fourth state, and it is not one of the three**: nobody has ever run it.
     That is not a result at all, and saying either search sentence over it
     would be reporting a search that never happened — the same class of lie the
     three above are separated to avoid. What it must do instead is name the
     price before the button, because this is the dearest press in the bar. */
  it("says nothing about any search when nobody has run one", () => {
    paint(owner({ status: "none", debate: null }));
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(DEBATE_RESPONSES_UNVERIFIED);
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE);
    expect(text()).toContain("costs real money");
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        (b.textContent ?? "").includes("Search the web"),
      ),
      "a button to start it",
    ).toBe(true);
  });

  /* The two groups do not share a sentence: group one being empty is this
     mode's commonest correct output, and group two being empty is a different
     fact about a different search. */
  it("uses the claims group's own sentences, not the direct group's", () => {
    paint(
      owner({
        debate: artefact({
          claims: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
    );
    expect(text()).toContain(DEBATE_CLAIMS_NONE);
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
  });
});

describe("valence is a direction, never a score", () => {
  it("has an appearance for every valence and no number in any of them", () => {
    const keys = Object.keys(VALENCE_APPEARANCE).sort();
    expect(keys).toEqual(["negative", "neutral", "positive", "unknown"]);
    for (const [name, look] of Object.entries(VALENCE_APPEARANCE)) {
      expect(look.label, name).not.toMatch(/\d/);
      expect(look.label, name).not.toContain("%");
    }
  });

  it("prints no percentage and no score on a full panel", () => {
    paint(owner());
    expect(text()).not.toContain("%");
    expect(text().toLowerCase()).not.toContain("score");
  });

  /* Rule 3. `unclear` and `unknown` are not failure states, and the way a panel
     says so is that they get the same furniture as the rest: a named chip with
     visible words in it, not an absence and not a warning. */
  it("draws neutral and unknown with the same chip the others get", () => {
    const four: DebateValence[] = ["positive", "negative", "neutral", "unknown"];
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: four.map((valence, i) =>
              direct({ id: `spya-d2w4r${"23456789"[i] ?? "2"}`, valence }),
            ),
            counts: counts({ reportedRows: 4, keptRows: 4 }),
          },
          /* Emptied, so the four chips counted below are the four asked for
             rather than four plus whatever the other group happened to hold. */
          claims: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
    );
    const chips = [...host.querySelectorAll(".dbt-valence")];
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      expect((chip.textContent ?? "").trim().length).toBeGreaterThan(0);
      /* No chip is drawn as a fault. A dimmed or warning-coloured "unknown"
         would be the panel disbelieving its own model out loud. */
      expect(chip.className).not.toMatch(/error|warn|fail/);
    }
    for (const valence of four) {
      expect(text()).toContain(VALENCE_APPEARANCE[valence].label);
    }
  });
});

describe("what the model read, and what we located", () => {
  /* Rule 4, and it is the assertion that stops the two halves of a row being
     drawn alike. `applies`, `relation` and `valence` are inside the labelled
     block; the quotation is outside it. */
  it("groups relation, valence and applies under 'AI interpretation'", () => {
    paint(owner());
    const read = host.querySelector(".dbt-ai");
    expect(read).not.toBeNull();
    const inside = read?.textContent ?? "";
    expect(inside).toContain("AI interpretation");
    expect(inside).toContain("It says the piece's third section contradicts its second.");
    expect(inside).toContain(VALENCE_APPEARANCE.negative.label);
    expect(inside).toContain("disputes");
    /* The positive control: the located quotation is *not* in there. */
    expect(inside).not.toContain("the argument here does not survive its own third section");
  });

  /* The host is the only authority signal a reader can judge, and it is free —
     so it leads the row, and the panel says the order means nothing. */
  it("puts the host first on the row and disclaims any ranking", () => {
    paint(owner());
    const first = host.querySelector(".dbt-row .dbt-host");
    expect(first?.textContent).toContain("example.org");
    expect(text()).toContain(DEBATE_NO_RANKING);
  });

  /* Rule 6. The excerpt is a slice of a stranger's page. React escapes by
     default, so this passes the day it is written — and it is here because the
     one way to lose it is a `dangerouslySetInnerHTML` added later for
     highlighting, which nothing else would catch. */
  it("renders a source quote as text and never as markup", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [direct({ sourceQuote: "<img src=x onerror=alert(1)> and <b>bold</b>" })],
            counts: counts(),
          },
        }),
      }),
    );
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".dbt-quote b")).toBeNull();
    expect(text()).toContain("<img src=x onerror=alert(1)> and <b>bold</b>");
  });
});

describe("the owner's foot lines", () => {
  it("says nothing when the model's rows all survived", () => {
    expect(keptNote(counts({ reportedRows: 4, keptRows: 4 }))).toBeNull();
  });

  it("names how many were dropped when they were not", () => {
    const note = keptNote(counts({ reportedRows: 6, keptRows: 4, lost: losses({ uncited: 2 }) })) ?? "";
    expect(note).toContain("6");
    expect(note).toContain("4");
  });

  /* A row past the cap was not refused — nothing was wrong with it, the list
     simply stopped — so it must not be reported as one we could not check. The
     numbers are the same either way, which is why this needs asserting. */
  it("says so when rows were lost to the cap rather than to a check", () => {
    const note = keptNote(counts({ reportedRows: 14, keptRows: 12, omittedOverCap: 2 })) ?? "";
    expect(note).toContain("12");
    expect(note).toContain("past the limit");
    expect(note).not.toContain("could not be checked");
  });

  it("says both when some were refused and some were past the cap", () => {
    const note =
      keptNote(
        counts({
          reportedRows: 16,
          keptRows: 12,
          omittedOverCap: 1,
          lost: losses({ unverifiedSource: 3 }),
        }),
      ) ?? "";
    expect(note).toContain("3 could not be checked");
    expect(note).toContain("1 more was past the limit");
  });

  /* Rule 5, the half a model can walk past. Ten pages of evidence, three rows
     reported, all three valid: every loss counter reads zero and seven pages
     never entered the answer. */
  it("says how many returned pages contribute, when that differs", () => {
    const note =
      sourcesNote(counts({ returnedSources: 7 }), [
        { url: "https://a.example" },
        { url: "https://b.example" },
      ]) ?? "";
    expect(note).toContain("7");
    expect(note).toContain("2");
  });

  it("says nothing when every returned page contributes", () => {
    expect(
      sourcesNote(counts({ returnedSources: 2 }), [
        { url: "https://a.example" },
        { url: "https://b.example" },
      ]),
    ).toBeNull();
  });

  /* Rows are deliberately not deduplicated by URL — one review can answer two
     claims — so two rows about one page is one contributing page, and the
     sentence has to count pages rather than rows or it fires on a truth. */
  it("counts pages rather than rows when one page answers twice", () => {
    expect(
      sourcesNote(counts({ returnedSources: 1 }), [
        { url: "https://a.example" },
        { url: "https://a.example" },
      ]),
    ).toBeNull();
  });

  it("draws the foot lines on the panel, not only in the helpers", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [direct()],
            counts: counts({ returnedSources: 9, reportedRows: 5, keptRows: 1, lost: losses({ uncited: 4 }) }),
          },
        }),
      }),
    );
    expect(text()).toContain("9");
    expect(text()).toContain("5");
  });
});

describe("searchedAt is displayed provenance, not staleness", () => {
  /* The date is asserted through the panel's own formatter rather than as
     `5 September 2026`: the browser's locale decides the word order, and a test
     that hardcodes one is testing the box it runs on. */
  it("says when the search ran, on an artefact that is perfectly current", () => {
    paint(owner());
    expect(text()).toContain("Searched on");
    expect(text()).toContain(searchedOn("2026-09-05T10:00:00.000Z"));
    expect(searchedOn("2026-09-05T10:00:00.000Z")).toContain("2026");
  });

  it("says something different when the article has moved underneath it", () => {
    paint(owner({ stale: true }));
    /* Both, and they are not the same sentence: the search is still dated, and
       the article changing is a separate fact with its own banner. */
    expect(text()).toContain("Searched on");
    expect(text()).toContain("The article has changed");
  });
});

describe("the claim a group-two row answers", () => {
  it("shows the article's own words and offers the way to them", () => {
    paint(owner());
    expect(text()).toContain("a starter needs cool water");
    /* `BlockRef` is a real `<a href>` so the browser's own affordances work —
       status bar, ⌘-click, copy link address — and a plain left click jumps in
       place. src/web/BlockRef.tsx. */
    const ref = host.querySelector<HTMLAnchorElement>(".dbt-claim a.block-ref");
    expect(ref, "a block reference for the claim's block").not.toBeNull();
    expect(ref?.textContent).toContain(KNOWN.slice(-6));
    act(() => {
      ref?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(jumped).toEqual([KNOWN]);
  });
});
