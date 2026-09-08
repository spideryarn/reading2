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
 *  3. **`neither` and `cannot-tell` are drawn as calmly as the rest.** A model that
 *     cannot tell whether a page agrees should say so and be believed — the
 *     rule docs/project/timeline.md applies to an undated row.
 *  4. **`relation`, `lean` and `applies` are grouped under "AI
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
 *  8. **One list, and every row saying what it is** — added 2026-09-06 with the
 *     change that removed the two group headings. What the headings used to say
 *     per section, the chip now says per row, so the things that can go quiet
 *     are the ordering, the level being the *strongest* signal rather than the
 *     first, and a foot line that no longer names which search it counts.
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
  DebateLean,
  DebateLosses,
  DirectDebateRow,
  IdentificationLevel,
} from "../src/types.js";
import { DEBATE_LEVEL_DEFAULT } from "../src/web/debate-levels.js";
import type { UseDebate } from "../src/web/useDebate.js";
import {
  DEBATE_CLAIMS_FOLLOW,
  DEBATE_CLAIMS_NONE,
  DEBATE_NO_RANKING,
  DEBATE_RESPONSES_NONE,
  debateClaimsUnverified,
  debateResponsesUnverified,
} from "../src/messages.js";

const {
  DebatePanel,
  LEAN_APPEARANCE,
  identificationEvidence,
  keptNote,
  leadNote,
  searchedOn,
  sourcesNote,
} = await import("../src/web/DebatePanel.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const KNOWN = "spya-k3m9qt" as BlockId;

function losses(over: Partial<DebateLosses> = {}): DebateLosses {
  return {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
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
    lean: "leans-against",
    applies: "It says the piece's third section contradicts its second.",
    /* The evidence that this page is about this piece. A row that earned none
       could not be in this group at all. */
    identifies: [
      { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
    ],
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
    lean: "neither",
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

/** Every level the bar was dragged to, in order — `null` is its reset. */
const levelled: (IdentificationLevel | null)[] = [];

/**
 * **The bar is wound fully open unless a test is about the bar.**
 *
 * `?name=` defaults to `quoted`, and the fixture row above is `named`-only — so
 * every test in this file that is about *rows* would otherwise be testing the
 * threshold by accident, and would go green again the day somebody broke it in
 * the other direction. `named` is *show everything*, which is what these tests
 * mean when they say "the panel draws two rows". The section that owns the bar
 * passes `null`, which is what a reader who has never touched it sends.
 */
function paint(o: UseDebate, level: IdentificationLevel | null = "named") {
  act(() => {
    root.render(
      createElement(DebatePanel, {
        access: { kind: "owner", owner: o },
        onJump: (id: BlockId) => jumped.push(id),
        level,
        onLevel: (next: IdentificationLevel | null) => levelled.push(next),
      }),
    );
  });
}

const text = () => host.textContent ?? "";

beforeEach(() => {
  jumped.length = 0;
  levelled.length = 0;
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
      debateResponsesUnverified(4),
      DEBATE_CLAIMS_NONE,
      debateClaimsUnverified(4),
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
    expect(text()).not.toContain(debateResponsesUnverified(0));
    /* And it hands the reader over to the rows that *are* there, rather than
       leaving a negative sentence sitting over a list with nothing saying what
       the list is. */
    expect(text()).toContain(DEBATE_CLAIMS_FOLLOW);
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
    /* The count in it is `returnedSources` and it is real: told "6 pages", a
       reader can weigh how thin the answer is. */
    expect(text()).toContain(debateResponsesUnverified(6));
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
    expect(text()).not.toContain(debateResponsesUnverified(6));
  });

  /* **A fourth state, and it is not one of the three**: nobody has ever run it.
     That is not a result at all, and saying either search sentence over it
     would be reporting a search that never happened — the same class of lie the
     three above are separated to avoid. What it must do instead is name the
     price before the button, because this is the dearest press in the bar. */
  it("says nothing about any search when nobody has run one", () => {
    paint(owner({ status: "none", debate: null }));
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(debateResponsesUnverified(6));
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
    /* Nothing follows, so nothing may say it does. */
    expect(text()).not.toContain(DEBATE_CLAIMS_FOLLOW);
  });

  /* **Both searches empty is two facts and gets two sentences.** With the two
     headed groups gone there is one paragraph to say them in, and the way this
     goes wrong is that the second is dropped because the first already sounds
     negative — the panel then saying less than it knows. */
  it("says both when neither search kept anything", () => {
    const lead =
      leadNote({
        direct: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        claims: { rows: [], counts: counts({ returnedSources: 5, reportedRows: 2, keptRows: 0 }) },
      }) ?? "";
    expect(lead).toContain(DEBATE_RESPONSES_NONE);
    expect(lead).toContain(debateClaimsUnverified(5));
    expect(lead).not.toContain(DEBATE_CLAIMS_FOLLOW);
  });

  it("says nothing at all when both searches kept something", () => {
    expect(
      leadNote({
        direct: { rows: [{}], counts: counts() },
        claims: { rows: [{}], counts: counts() },
      }),
    ).toBeNull();
  });
});

describe("one list, and each row saying what it is", () => {
  /* The whole of § 1 of the plan: the two-group split was our epistemics, not
     the reader's question, and on a real article it produced two headings, two
     blurbs and two foot lines stacked over zero rows. */
  it("draws one list with both kinds of row in it and no group headings", () => {
    paint(owner());
    const lists = host.querySelectorAll("ol.dbt-list");
    expect(lists).toHaveLength(1);
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(2);
    expect(host.querySelectorAll(".dbt-scroll h3")).toHaveLength(0);
  });

  /* Direct rows first, then claim rows, search order within each — and *not*
     sorted by identification level, because the chip already says it and a
     sorted list would make position mean something in a feature built to have
     it mean nothing. */
  it("puts direct rows before claim rows and leaves each in search order", () => {
    const strong = direct({
      id: "spya-d2w4r3",
      url: "https://second.example/reply",
      identifies: [{ kind: "linked", url: "https://example.com/the-piece" }],
    });
    paint(
      owner({
        debate: artefact({
          /* The weaker chip first, so a list sorted by level would reorder it. */
          direct: { rows: [direct(), strong], counts: counts({ reportedRows: 2, keptRows: 2 }) },
        }),
      }),
    );
    const hosts = [...host.querySelectorAll(".dbt-host")].map((a) => a.textContent ?? "");
    expect(hosts).toEqual([
      expect.stringContaining("example.org"),
      expect.stringContaining("second.example"),
      expect.stringContaining("another.example.net"),
    ]);
  });

  it("labels a direct row by its strongest signal and a claim row by its question", () => {
    paint(owner());
    const marks = [...host.querySelectorAll(".dbt-mark")].map((m) => m.textContent ?? "");
    expect(marks).toEqual(["Names this piece", "On what it claims"]);
  });

  /* The level is the *strongest* signal, by a lookup over a fixed order — never
     the first one, and never a sum of them. */
  it("takes the strongest signal for the chip when a row has several", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [
              direct({
                identifies: [
                  { kind: "named", by: "title", witness: "Notes on my sourdough starter" },
                  { kind: "linked", url: "https://example.com/the-piece" },
                ],
              }),
            ],
            counts: counts(),
          },
        }),
      }),
    );
    expect(host.querySelector(".dbt-mark")?.textContent).toBe("Links this piece");
  });

  /* Greg asked for this tooltip by name: *"a tooltip for each showing the
     reasons"*. It is the evidence itself — the address that matched, the words
     found in the page's extract — and not a gloss on it, so what it must never
     do is summarise several signals into one line. */
  it("lists every signal in the tooltip, one line each, with the evidence in it", () => {
    const lines = identificationEvidence(
      direct({
        identifies: [
          { kind: "linked", url: "https://example.com/the-piece" },
          {
            kind: "quoted",
            quote: "a starter needs cool water",
            blockId: KNOWN,
            coverage: 0.223,
            density: 0.164,
          },
          { kind: "named", by: "title-and-byline", witness: "Notes on my starter, by A. Baker" },
        ],
      }),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("https://example.com/the-piece");
    expect(lines[1]).toContain("a starter needs cool water");
    expect(lines[1]).toContain("22%");
    expect(lines[1]).toContain("16%");
    expect(lines[2]).toContain("title and byline");
    expect(lines[2]).toContain("Notes on my starter, by A. Baker");
  });

  /* The floor fires on a single 8-word window, so a real hit on a long article
     rounds to zero — and "0% turns up here" under a chip saying the page quotes
     it reads as a contradiction. */
  it("says under 1% rather than 0% for a hit too small to round to one", () => {
    const lines = identificationEvidence(
      direct({
        identifies: [
          { kind: "quoted", quote: "eight words of the piece", blockId: KNOWN, coverage: 0.004, density: 0.65 },
        ],
      }),
    );
    expect(lines[0]).toContain("under 1%");
    expect(lines[0]).not.toContain("0%");
  });

  /* An artefact written before 2026-09-06 has no `identifies` key at all.
     `identifiesOf` reads it as `named` on the witness that kept it, so nothing
     needs re-running — and the panel must not blank the chip or throw. */
  it("draws a chip for a row stored before the field existed", () => {
    const old = direct();
    delete (old as { identifies?: unknown }).identifies;
    paint(owner({ debate: artefact({ direct: { rows: [old], counts: counts() } }) }));
    expect(host.querySelector(".dbt-mark")?.textContent).toBe("Names this piece");
    expect(identificationEvidence(old)[0]).toContain("Notes on my sourdough starter, week 3");
  });
});

describe("the lean is a direction, never a score", () => {
  it("has an appearance for every lean and no number in any of them", () => {
    const keys = Object.keys(LEAN_APPEARANCE).sort();
    expect(keys).toEqual(["cannot-tell", "leans-against", "leans-for", "neither"]);
    for (const [name, look] of Object.entries(LEAN_APPEARANCE)) {
      expect(look.label, name).not.toMatch(/\d/);
      expect(look.label, name).not.toContain("%");
    }
  });

  it("prints no percentage and no score on a full panel", () => {
    paint(owner());
    expect(text()).not.toContain("%");
    expect(text().toLowerCase()).not.toContain("score");
  });

  /* Rule 3. `unclear` and `cannot-tell` are not failure states, and the way a
     panel says so is that they get the same furniture as the rest: a named chip
     with visible words in it, not an absence and not a warning. */
  it("draws neither and cannot-tell with the same chip the others get", () => {
    const four: DebateLean[] = ["leans-for", "leans-against", "neither", "cannot-tell"];
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: four.map((lean, i) =>
              direct({ id: `spya-d2w4r${"23456789"[i] ?? "2"}`, lean }),
            ),
            counts: counts({ reportedRows: 4, keptRows: 4 }),
          },
          /* Emptied, so the four chips counted below are the four asked for
             rather than four plus whatever the other group happened to hold. */
          claims: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
    );
    const chips = [...host.querySelectorAll(".dbt-lean")];
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      expect((chip.textContent ?? "").trim().length).toBeGreaterThan(0);
      /* No chip is drawn as a fault. A dimmed or warning-coloured "cannot-tell"
         would be the panel disbelieving its own model out loud. */
      expect(chip.className).not.toMatch(/error|warn|fail/);
    }
    for (const lean of four) {
      expect(text()).toContain(LEAN_APPEARANCE[lean].label);
    }
  });
});

describe("what the model read, and what we located", () => {
  /* Rule 4, and it is the assertion that stops the two halves of a row being
     drawn alike. `applies`, `relation` and `lean` are inside the labelled
     block; the quotation is outside it. */
  it("groups relation, lean and applies under 'AI interpretation'", () => {
    paint(owner());
    const read = host.querySelector(".dbt-ai");
    expect(read).not.toBeNull();
    const inside = read?.textContent ?? "";
    expect(inside).toContain("AI interpretation");
    expect(inside).toContain("It says the piece's third section contradicts its second.");
    expect(inside).toContain(LEAN_APPEARANCE["leans-against"].label);
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
    expect(keptNote(counts({ reportedRows: 4, keptRows: 4 }), "direct")).toBeNull();
  });

  it("names how many were dropped when they were not", () => {
    const note =
      keptNote(counts({ reportedRows: 6, keptRows: 4, lost: losses({ uncited: 2 }) }), "direct") ??
      "";
    expect(note).toContain("6");
    expect(note).toContain("4");
  });

  /* **Each sentence names its own search**, because the headings that used to
     say it are gone and the two searches' numbers cannot be summed:
     `returnedSources` is per-pass and `distinctSources` dedupes across the whole
     list, so a page returned by both would be counted twice against once. */
  it("says which of the two searches it is counting", () => {
    const one = keptNote(counts({ reportedRows: 6, keptRows: 4 }), "direct") ?? "";
    const two = keptNote(counts({ reportedRows: 6, keptRows: 4 }), "claims") ?? "";
    expect(one).toContain("replies to this piece");
    expect(two).toContain("what it claims");
    expect(one).not.toBe(two);
  });

  /* A row past the cap was not refused — nothing was wrong with it, the list
     simply stopped — so it must not be reported as one we could not check. The
     numbers are the same either way, which is why this needs asserting. */
  it("says so when rows were lost to the cap rather than to a check", () => {
    const note = keptNote(counts({ reportedRows: 14, keptRows: 12, omittedOverCap: 2 }), "direct") ?? "";
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
        "direct",
      ) ?? "";
    expect(note).toContain("3 could not be checked");
    expect(note).toContain("1 more was past the limit");
  });

  /* **A copy was checked, and checked successfully.** It links the piece, it
     quotes it exactly, every counter reads clean — and it was refused for being
     the article rather than a reply to it. Folding it into "could not be
     checked" tells the reader we failed at something we did not fail at, which
     is the wording this clause exists to avoid. */
  it("does not say a mirror could not be checked, because it could", () => {
    const note =
      keptNote(
        counts({ reportedRows: 4, keptRows: 3, lost: losses({ sourceIsCopy: 1 }) }),
        "direct",
      ) ?? "";
    expect(note).toContain("1 turned out to be a copy of this article rather than a reply to it");
    expect(note).not.toContain("could not be checked");
  });

  it("keeps the two kinds of refusal apart when a search has both", () => {
    const note =
      keptNote(
        counts({
          reportedRows: 9,
          keptRows: 4,
          omittedOverCap: 1,
          lost: losses({ unverifiedSource: 2, sourceIsCopy: 2 }),
        }),
        "direct",
      ) ?? "";
    expect(note).toContain("2 could not be checked");
    expect(note).toContain("2 turned out to be copies");
    expect(note).toContain("1 more was past the limit");
  });

  /* **The one unacceptable outcome is a counter that stops reaching the
     reader** (docs/reusable/silent-success.md), and the way it happens is that
     somebody adds a reason to `DebateLosses` and nobody adds a clause. This
     walks every field there is, so a new one arrives here red rather than
     silent: `anyLost` makes the *type* exhaustive, and this makes the
     *sentence* exhaustive. */
  it("puts every loss reason there is into a sentence the reader gets", () => {
    for (const reason of Object.keys(losses()) as (keyof DebateLosses)[]) {
      const note = keptNote(
        counts({ reportedRows: 5, keptRows: 4, lost: losses({ [reason]: 1 }) }),
        "direct",
      );
      expect(note, reason).not.toBeNull();
      expect(note ?? "", reason).toContain("5");
      expect(note ?? "", reason).toContain("4");
      /* Not merely present: the sentence has to *account* for the missing row,
         so one clause or another has to claim it. */
      expect(note ?? "", reason).toMatch(/1 could not be checked|1 turned out to be a copy/);
    }
  });

  /* **Every debate artefact in the local database predates `sourceIsCopy`**,
     which landed on 2026-09-06 — and `isDebateDocument` validates two arrays and
     nothing else, so those artefacts reach this panel with the key simply
     absent. Read as a number it is `undefined`, and one `Math.min` away from a
     `NaN` that fails every comparison below it: the sentence keeps its counts
     and loses every clause that explains them. Found by looking at the stored
     rows rather than at the type, which says the field is always there. */
  it("still explains the losses on an artefact stored before the copy counter", () => {
    const old = losses({ unverifiedSource: 2 }) as Partial<DebateLosses>;
    delete old.sourceIsCopy;
    const note =
      keptNote(counts({ reportedRows: 5, keptRows: 3, lost: old as DebateLosses }), "direct") ?? "";
    expect(note).toContain("2 could not be checked");
    expect(note).not.toContain("NaN");
  });

  /* Rule 5, the half a model can walk past. Ten pages of evidence, three rows
     reported, all three valid: every loss counter reads zero and seven pages
     never entered the answer. */
  it("says how many returned pages contribute, when that differs", () => {
    const note =
      sourcesNote(
        counts({ returnedSources: 7 }),
        [{ url: "https://a.example" }, { url: "https://b.example" }],
        "direct",
      ) ?? "";
    expect(note).toContain("7");
    expect(note).toContain("2");
  });

  it("says nothing when every returned page contributes", () => {
    expect(
      sourcesNote(
        counts({ returnedSources: 2 }),
        [{ url: "https://a.example" }, { url: "https://b.example" }],
        "direct",
      ),
    ).toBeNull();
  });

  /* Rows are deliberately not deduplicated by URL — one review can answer two
     claims — so two rows about one page is one contributing page, and the
     sentence has to count pages rather than rows or it fires on a truth. */
  it("counts pages rather than rows when one page answers twice", () => {
    expect(
      sourcesNote(
        counts({ returnedSources: 1 }),
        [{ url: "https://a.example" }, { url: "https://a.example" }],
        "direct",
      ),
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

  /* **Both searches keep their own numbers under the one list.** The tempting
     simplification is to sum them into one pair of sentences, and it is wrong on
     a fact rather than on taste — so this asserts that a losing claims search is
     still reported when the direct one is clean. */
  it("reports each search's losses even though there is only one list", () => {
    paint(
      owner({
        debate: artefact({
          direct: { rows: [direct()], counts: counts({ returnedSources: 1 }) },
          claims: {
            rows: [claim()],
            counts: counts({
              returnedSources: 1,
              reportedRows: 7,
              keptRows: 1,
              lost: losses({ claimNotInBlock: 6 }),
            }),
          },
        }),
      }),
    );
    const foot = host.querySelector(".dbt-foot")?.textContent ?? "";
    expect(foot).toContain("what it claims");
    expect(foot).toContain("7");
    expect(foot).not.toContain("replies to this piece");
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

/**
 * **The identification bar, on the panel.**
 *
 * The rule itself is tested without a DOM in debate-bar.test.ts; what is here is
 * everything that can only go wrong once it is drawn — and the shape of every
 * one of them is *a number that disagrees with the list under it*, which
 * threshold.ts names as this feature's worst failure.
 *
 * The three counts a reader can see at once are the reason this section is long:
 * the head's **pages behind the rows on screen**, the bar's **responses it is
 * holding back**, and the foot's **pages each search returned**. They are three
 * different facts and they have to stay three different facts.
 */
describe("the bar over how firmly a page identifies this article", () => {
  const quoted = (over: Partial<DirectDebateRow> = {}) =>
    direct({
      id: "spya-d2w4r7",
      url: "https://quoting.example/reply",
      identifies: [
        {
          kind: "quoted",
          quote: "a starter needs cool water",
          blockId: KNOWN,
          coverage: 0.04,
          density: 0.13,
        },
      ],
      ...over,
    });

  it("hides a page that only names this piece, when nobody has touched it", () => {
    /* `null` is what a reader who has never touched the bar sends, and the panel
       resolves it to `quoted` — Greg's *"important that the commentary be about
       the article being read here"*. The fixture row names the piece and nothing
       more, which on the decoy article is a page about a different document
       sharing a title. */
    paint(owner(), null);
    expect(DEBATE_LEVEL_DEFAULT).toBe("quoted");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(1);
    expect(text()).not.toContain("Names this piece");
    /* The positive control: the same row, same everything, one stop to the left. */
    paint(owner(), "named");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(2);
    expect(text()).toContain("Names this piece");
  });

  it("says how many it is holding back, and calls them responses rather than pages", () => {
    /* Two page counts are already on this screen — the head's and the searches'
       — so a third noun for a third fact would be three numbers all called
       pages. `hiddenNote` counts rows, and a direct row is a page that responds
       to this piece, which is the word the lead sentence already uses. */
    paint(owner(), null);
    expect(text()).toContain("1 response is hidden by this threshold");
    expect(text()).toContain("Drag the slider left to show it");
  });

  it("says so even when it is holding nothing back", () => {
    /* Present wherever the control is, absent wherever it is not. A line that
       goes missing for a *different* reason teaches the reader nothing. */
    paint(owner(), "named");
    expect(host.querySelector(".dbt-bar-note")?.textContent).toBe(
      "Nothing is hidden by this threshold.",
    );
  });

  it("counts only direct rows, however many claim rows are under it", () => {
    /* The failure this whole section exists for. Claim rows carry no level, are
       never hidden by the bar, and must be in neither of its numbers — so a
       `0 of 1` sits over a list of three rows, and that is correct. */
    paint(
      owner({
        debate: artefact({
          direct: { rows: [direct()], counts: counts({ reportedRows: 1, keptRows: 1 }) },
          claims: {
            rows: [
              claim(),
              claim({ id: "spya-c7w2d3", url: "https://third.example/x" }),
              claim({ id: "spya-c7w2d4", url: "https://fourth.example/y" }),
            ],
            counts: counts({ returnedSources: 3, reportedRows: 3, keptRows: 3 }),
          },
        }),
      }),
      null,
    );
    expect(host.querySelector(".dbt-bar-value")?.textContent).toBe("quotes it · 0 of 1");
    expect(text()).toContain("1 response is hidden by this threshold");
    expect(text()).not.toContain("4 responses");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(3);
    expect(host.querySelectorAll(".dbt-mark-claim")).toHaveLength(3);
  });

  it("keeps the count beside the slider equal to the direct rows it drew", () => {
    /* One pass, two readings of it: the `N of M` and the list. The only way they
       can disagree is if somebody walks the list twice with two copies of the
       rule. */
    const rows = [direct(), quoted(), direct({ id: "spya-d2w4r8", url: "https://third.example/z" })];
    paint(
      owner({
        debate: artefact({ direct: { rows, counts: counts({ reportedRows: 3, keptRows: 3 }) } }),
      }),
      null,
    );
    expect(host.querySelector(".dbt-bar-value")?.textContent).toBe("quotes it · 1 of 3");
    expect(host.querySelectorAll(".dbt-mark-quoted")).toHaveLength(1);
    expect(host.querySelectorAll(".dbt-mark-named")).toHaveLength(0);
    expect(text()).toContain("2 responses are hidden by this threshold");
  });

  it("moves the head count with the bar, because it counts what is on screen", () => {
    /* `7 pages` over four rows is the same disagreement one line up. */
    paint(owner({ debate: artefact({ claims: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) } }) }), "named");
    expect(host.querySelector(".gloss-count")?.textContent).toBe("1 page");
    paint(owner({ debate: artefact({ claims: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) } }) }), null);
    expect(host.querySelector(".gloss-count")?.textContent).toBe("0 pages");
  });

  it("hands the drag back as a word, and one stop left shows the row again", () => {
    paint(owner(), null);
    const slider = document.getElementById("dbt-bar") as HTMLInputElement | null;
    expect(slider, "the bar must be on screen to be dragged").not.toBeNull();
    expect(slider?.value).toBe("1");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(slider, "0");
      slider?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    /* **The word, never the index.** The rank exists only so `applyThreshold`
       has a number; a number in the URL would be the score this feature
       refused. */
    expect(levelled).toEqual(["named"]);
    paint(owner(), "named");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(2);
  });

  it("offers a reset only once the reader has moved it", () => {
    paint(owner(), null);
    expect(host.querySelector(".dbt-bar-reset")).toBeNull();
    paint(owner(), "linked");
    const reset = host.querySelector<HTMLButtonElement>(".dbt-bar-reset");
    expect(reset).not.toBeNull();
    act(() => {
      reset?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    /* `null`, not the word `quoted`: *back to untouched* is the state the reset
       exists to reach, and it is the one that keeps the default in one file. */
    expect(levelled).toEqual([null]);
  });

  it("says nothing extra when the bar has hidden every response", () => {
    /* The fourth empty state, and it is deliberately silent: `hiddenNote` has
       already said what happened, and the lead sentence's subject is what the
       *search* came back with. Telling a reader the search found nothing when
       they hid it themselves would be false. */
    paint(owner(), null);
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(debateResponsesUnverified(2));
    /* Not *"All 1 response"* — `hiddenNote` drops the "All" at one, because it
       tells the reader nothing the count does not and is not English. */
    expect(text()).toContain("1 response is hidden by this threshold");
    /* The positive control: a group that really is empty still says so. */
    paint(
      owner({
        debate: artefact({
          direct: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
      null,
    );
    expect(text()).toContain(DEBATE_RESPONSES_NONE);
  });

  it("draws no bar at all when the search kept no responses to threshold", () => {
    /* A control that cannot change anything, over a foot line saying "nothing is
       hidden by this threshold" under an empty list, would read as an
       explanation of the emptiness. `leadNote` owns that sentence. */
    paint(
      owner({
        debate: artefact({
          direct: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
      null,
    );
    expect(host.querySelector(".dbt-bar")).toBeNull();
    expect(text()).not.toContain("hidden by this threshold");
  });

  it("never tells the reader a row is shown when the bar has taken it away", () => {
    /* `keptNote` is arithmetic about the run and says *kept*, not *shown*, since
       the bar arrived. The counts here are the artefact's own and do not move
       with the threshold — the sentence would be a lie in exactly the place this
       panel has to be trustworthy about numbers. */
    paint(
      owner({
        debate: artefact({
          direct: { rows: [direct(), quoted()], counts: counts({ reportedRows: 3, keptRows: 2 }) },
        }),
      }),
      null,
    );
    const foot = host.querySelector(".dbt-foot")?.textContent ?? "";
    expect(foot).toContain("2 were kept");
    expect(foot).not.toContain("are shown");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(2);
  });

  it("counts the pages contributing to the rows shown, not to the rows hidden", () => {
    /* `sourcesNote` ends *"contribute to the rows shown"*, so the bar decides
       which those are. Leaving it on the whole group would keep the figure
       looking right while the words went false. */
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [direct(), quoted()],
            counts: counts({ returnedSources: 5, reportedRows: 2, keptRows: 2 }),
          },
        }),
      }),
      null,
    );
    expect(text()).toContain("returned evidence from 5 pages; 1 contributes to the rows shown");
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
