/* **The pragma is required and it is not decoration.** Without it this file
   silently gets no DOM — `document` is undefined, and the half of the suite
   below that renders would fail with an error about the environment rather than
   about the panel. `tests/outline-panel.test.tsx` carries the same line. */
// @vitest-environment jsdom
/**
 * The timeline panel's client half: **the words it puts in the date column**,
 * and the passages it resolves.
 *
 * ## What is worth testing here, and what is not
 *
 * The panel draws no marks and computes no dates — `src/timeline-time.ts` owns
 * the arithmetic and has 69 tests of its own. What is left is exactly the thing
 * this stage could get wrong on its own: **four `dating` states that must not
 * collapse into fewer**, and a date formatter that must never touch a `Date`.
 *
 * Neither is hypothetical. Ten of the twenty-six rows on the test article carry
 * no date, and the pair most easily collapsed — `words` and `untimed` — is the
 * one where collapsing throws away something the article actually said.
 */
/* **Set before anything reads a date, and it is what makes half this file
   mean anything.** `formatDay` must never construct a `Date`, because
   `new Date("2026-01-01")` is midnight *UTC* and formats as 31 December 2025
   anywhere west of Greenwich. Under `TZ=UTC` the wrong implementation and the
   right one agree exactly, so the assertions below would pass on the bug — the
   shape docs/reusable/silent-success.md is about. Los Angeles is eight hours
   behind, so a `Date`-based rewrite goes red on the very first case.
   Verified by mutation rather than asserted: replacing the body of `formatDay`
   with `new Date(iso).toLocaleDateString("en-GB", …)` reddens **seven** of the
   twenty-one tests here, and every failure is off by one day. */
process.env.TZ = "America/Los_Angeles";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  A_CHRONOLOGY,
  datingWords,
  formatDay,
  TimelinePanel,
  whenWords,
  yearsOf,
} from "../src/web/TimelinePanel.js";
import { resolveTimelineEvent } from "../src/web/search-hits.js";
import { DATE_REJECTED_SHORT, DATE_REJECTED_WHY } from "../src/messages.js";
import type {
  Block,
  BlockId,
  Dating,
  DateRejection,
  TimelineEvent,
  TimelineModality,
  When,
} from "../src/types.js";
import type { UseTimeline } from "../src/web/useTimeline.js";

function when(over: Partial<When> = {}): When {
  return {
    earliest: "2026-05-26",
    latest: "2026-05-26",
    extent: "instant",
    phrase: "on May 26",
    at: { blockId: "spya-v9detz" as BlockId, start: 303, end: 312 },
    yearFilled: true,
    ...over,
  };
}

function event(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "spya-aaaaaa",
    label: "Agents exploit Artifactory to reach internet",
    dating: { kind: "dated", when: when() },
    order: 3,
    modality: "happened" as TimelineModality,
    occurrences: [
      { blockId: "spya-v9detz" as BlockId, quote: "the agents successfully exploited", start: 0 },
    ],
    ...over,
  };
}

describe("one ISO day, as the reader sees it", () => {
  it("reads the characters rather than constructing a Date", () => {
    /* 1 January is the case that separates the two implementations: UTC
       midnight on this string is 31 December 2025 in the timezone set above. */
    expect(formatDay("2026-01-01", false)).toBe("1 Jan");
    expect(formatDay("2026-01-01", true)).toBe("1 Jan 2026");
    expect(formatDay("2026-12-31", true)).toBe("31 Dec 2026");
    expect(formatDay("2026-05-26", false)).toBe("26 May");
    /* No leading zero on the day — the article writes "May 26", not "May 06". */
    expect(formatDay("2026-07-04", false)).toBe("4 Jul");
  });

  it("shows an unreadable date rather than NaN", () => {
    // Cannot come out of src/timeline-time.ts, which builds every one of these
    // by integer arithmetic — but this is the only function that reads the
    // artefact's characters, and it reads them off a disk.
    expect(formatDay("2026-05", false)).toBe("2026-05");
    expect(formatDay("", false)).toBe("");
  });
});

describe("the interval, said in words", () => {
  it("gives a point a bare date", () => {
    expect(whenWords(when(), false)).toBe("26 May");
  });

  /**
   * **The bound, which is the whole reason this column is words and not a
   * date.** Five of the test article's twenty-four expressions say "by", and a
   * reader skimming a column reads "by 12 May" as "on 12 May" — so the two
   * extra words are the entire difference between a bound and a point.
   */
  it("spells out an upper bound and a lower one", () => {
    expect(whenWords(when({ earliest: null, latest: "2026-05-12" }), false)).toBe(
      "at or before 12 May",
    );
    expect(whenWords(when({ earliest: "2026-07-14", latest: null }), false)).toBe(
      "at or after 14 Jul",
    );
  });

  /**
   * **The same two dates mean two different things**, and this is the one
   * assertion that would go green on a panel that had dropped `extent`
   * altogether. An `extended` range is a duration; an `instant` range is
   * uncertainty about which day.
   */
  it("tells a duration apart from uncertainty about a day", () => {
    const span = { earliest: "2026-07-13", latest: "2026-07-19" };
    const lasted = whenWords(when({ ...span, extent: "extended" }), false);
    const somewhere = whenWords(when({ ...span, extent: "instant" }), false);
    expect(lasted).toBe("13 Jul – 19 Jul");
    expect(somewhere).toBe("between 13 Jul and 19 Jul");
    expect(lasted).not.toBe(somewhere);
  });

  it("carries the year on every row when it is asked to", () => {
    expect(whenWords(when({ earliest: null, latest: "2026-05-12" }), true)).toBe(
      "at or before 12 May 2026",
    );
  });
});

/**
 * **The four states, and the assertion the whole mode rests on: no two of them
 * draw the same row.**
 *
 * Written as a distinctness sweep rather than four separate expectations,
 * because the failure being guarded is a *collapse* — somebody rendering
 * `words` as a blank, or `rejected` as an ordinary absence, which is precisely
 * the demotion the review caught. Four separate assertions all pass while two
 * of the four say the same thing.
 */
describe("the four dating states", () => {
  const cases: Dating[] = [
    { kind: "dated", when: when() },
    { kind: "words", phrase: "another month later" },
    { kind: "untimed" },
    { kind: "rejected", reason: "noYearFrame", phrase: "On July 7" },
  ];

  it("draws four different rows", () => {
    const drawn = cases.map((d) => datingWords(d, false));
    expect(new Set(drawn.map((d) => d.text)).size).toBe(4);
    expect(new Set(drawn.map((d) => d.tone)).size).toBe(4);
  });

  /**
   * The pair most easily collapsed, called out on its own. A piece that said
   * "another month later" has dated the event as far as it ever will; a blank
   * there claims it said nothing.
   */
  it("does not draw the article's own words as an absence", () => {
    const words = datingWords({ kind: "words", phrase: "another month later" }, false);
    const untimed = datingWords({ kind: "untimed" }, false);
    expect(words.text).toContain("another month later");
    expect(words.text).not.toBe(untimed.text);
  });

  /**
   * **The three rejections are three sentences.** `noYearFrame` says the piece
   * gave a day and a month and we had no publication date to take the year
   * from; `phraseNotInOccurrence` says the date is not in the passage. Those
   * are facts about different parties and a reader should read them
   * differently.
   */
  it("says something different for each reason we could not read a date", () => {
    const reasons: DateRejection[] = [
      "noYearFrame",
      "phraseNotInOccurrence",
      "unparseablePhrase",
    ];
    const shown = reasons.map((reason) => datingWords({ kind: "rejected", reason, phrase: null }, false));
    expect(new Set(shown.map((s) => s.text)).size).toBe(reasons.length);
    expect(new Set(reasons.map((r) => DATE_REJECTED_WHY[r])).size).toBe(reasons.length);
    // And a rejection is not silently the same row as a genuine absence.
    for (const one of shown) expect(one.text).not.toBe(datingWords({ kind: "untimed" }, false).text);
  });
});

describe("which years the list mentions", () => {
  it("counts both ends, so a range across New Year turns the years on", () => {
    const events = [
      event({ dating: { kind: "dated", when: when({ earliest: "2025-12-30", latest: "2026-01-02", extent: "extended" }) } }),
    ];
    expect([...yearsOf(events)].sort()).toEqual(["2025", "2026"]);
  });

  it("ignores the rows that carry no date", () => {
    const events = [
      event({ id: "a", dating: { kind: "dated", when: when() } }),
      event({ id: "b", dating: { kind: "words", phrase: "eventually" } }),
      event({ id: "c", dating: { kind: "untimed" } }),
      event({ id: "d", dating: { kind: "rejected", reason: "noYearFrame", phrase: null } }),
    ];
    expect([...yearsOf(events)]).toEqual(["2026"]);
  });
});

describe("an event's passages, resolved", () => {
  const blocks = [
    { id: "spya-v9detz", html: "<p>By May 12, some agents had figured out how to talk.</p>" },
    { id: "spya-g9tjds", html: "<p>They crashed the package manager by July 4.</p>" },
  ] as unknown as Block[];

  it("finds the words and keys each occurrence by its position in the list", () => {
    const found = resolveTimelineEvent(blocks, {
      id: "spya-aaaaaa",
      occurrences: [
        { blockId: "spya-v9detz" as BlockId, quote: "figured out how to talk", start: 0 },
        { blockId: "spya-g9tjds" as BlockId, quote: "crashed the package manager", start: 0 },
      ],
    });
    expect(found.map((f) => f.key)).toEqual([
      "spya-aaaaaa:spya-v9detz:0",
      "spya-aaaaaa:spya-g9tjds:1",
    ]);
    expect(found.every((f) => f.whole === false)).toBe(true);
  });

  /**
   * A block the article no longer has is **dropped**, not drawn — which is why
   * the panel counts `found.length` and never `event.occurrences.length`. A
   * counter that disagreed with the rows under it would be the panel telling
   * the reader two things.
   */
  it("drops an occurrence whose block a re-extraction removed", () => {
    const found = resolveTimelineEvent(blocks, {
      id: "spya-aaaaaa",
      occurrences: [
        { blockId: "spya-v9detz" as BlockId, quote: "figured out how to talk", start: 0 },
        { blockId: "spya-gone00" as BlockId, quote: "anything at all", start: 0 },
      ],
    });
    expect(found).toHaveLength(1);
  });
});

describe("the panel, rendered", () => {
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

  function owner(over: Partial<UseTimeline> = {}): UseTimeline {
    return {
      status: "ready",
      timeline: null,
      stale: false,
      outdated: false,
      slug: "openai-huggingface",
      error: null,
      job: null,
      failed: null,
      /* The tab can reach the server — src/job-state.ts § `driverStalled`. */
      stalled: false,
      starting: false,
      automatic: false,
      ensure: async () => {},
      regenerate: async () => {},
      cancel: () => {},
      ...over,
    };
  }

  function draw(events: TimelineEvent[], over: Partial<UseTimeline> = {}) {
    const timeline = {
      version: "timeline/1",
      generator: "test",
      slug: "openai-huggingface",
      sourceHash: "x",
      events,
      orderConflicts: 0,
      generatedAt: "2026-08-31T10:14:21.120Z",
      elapsedMs: 1,
    };
    act(() => {
      /* `createElement` rather than JSX, because this file is `.ts` — and
         rather than calling `TimelinePanel(props)` directly, which would run
         its hooks outside React's render phase. */
      root.render(
        createElement(TimelinePanel, {
          owner: owner({ timeline, ...over }),
          eventId: null,
          onEvent: () => {},
          found: [],
          openKey: null,
          onOpenKey: () => {},
          onJump: () => {},
        }),
      );
    });
    return host;
  }

  /** The four states on screen at once, each drawing its own row. */
  it("puts a different thing in the date column for each of the four states", () => {
    const el = draw([
      event({ id: "a", dating: { kind: "dated", when: when({ earliest: null, latest: "2026-05-12" }) } }),
      event({ id: "b", dating: { kind: "words", phrase: "another month later" } }),
      event({ id: "c", dating: { kind: "untimed" } }),
      event({ id: "d", dating: { kind: "rejected", reason: "noYearFrame", phrase: "On July 7" } }),
    ]);
    const cells = [...el.querySelectorAll(".tl-when")].map((n) => n.textContent ?? "");
    expect(cells[0]).toContain("at or before 12 May");
    expect(cells[1]).toContain("another month later");
    expect(cells[2]).toContain("—");
    expect(cells[3]).toContain(DATE_REJECTED_SHORT.noYearFrame);
    /* Four different tone classes, so the stylesheet can tell them apart —
       a rejection styled like an absence is the failure the review caught. */
    const tones = [...el.querySelectorAll(".tl-when")].map(
      (n) => [...n.classList].find((c) => c.startsWith("tl-when-")) ?? "",
    );
    expect(new Set(tones).size).toBe(4);
  });

  /**
   * An em dash is silence to a screen reader, so the one row whose whole
   * content is an em dash carries the sentence saying so. This is the accessible
   * half of "v1 writes the words", and it is the only row that needs it.
   */
  it("says out loud that an untimed row has no time", () => {
    const el = draw([event({ id: "c", dating: { kind: "untimed" } })]);
    expect(el.querySelector(".tl-when .sr-only")?.textContent).toMatch(/no time/i);
    expect(el.querySelector(".tl-when [aria-hidden]")?.textContent).toBe("—");
  });

  /**
   * **The year is said once, not on twenty-six rows.** On a piece like the test
   * article seventeen of eighteen dates have a year we supplied, so a per-row
   * note would be a wall — and the column would spend its width repeating 2026.
   */
  it("states the year once above the list and keeps it off the rows", () => {
    const el = draw([
      event({ id: "a", dating: { kind: "dated", when: when() } }),
      event({ id: "b", dating: { kind: "dated", when: when({ earliest: "2026-07-07", latest: "2026-07-07" }) } }),
      event({ id: "c", dating: { kind: "dated", when: when({ earliest: "2026-07-11", latest: "2026-07-11" }) } }),
    ]);
    expect(el.querySelector(".tl-frame")?.textContent).toContain("2026");
    for (const cell of el.querySelectorAll(".tl-when")) {
      expect(cell.textContent).not.toContain("2026");
    }
  });

  it("puts the year on every row once the list spans more than one", () => {
    const el = draw([
      event({ id: "a", dating: { kind: "dated", when: when({ earliest: "2019-05-26", latest: "2019-05-26" }) } }),
      event({ id: "b", dating: { kind: "dated", when: when() } }),
      event({ id: "c", dating: { kind: "dated", when: when({ earliest: "2026-07-11", latest: "2026-07-11" }) } }),
    ]);
    expect([...el.querySelectorAll(".tl-when")].map((n) => n.textContent)).toEqual([
      "26 May 2019",
      "26 May 2026",
      "11 Jul 2026",
    ]);
  });

  /**
   * Predictions and hypotheticals get their own headings, and the history above
   * them gets none — the divider exists so a reader's eye does not run from a
   * date into a forecast.
   */
  it("puts what the piece expects under its own heading", () => {
    const el = draw([
      event({ id: "a" }),
      event({ id: "b", modality: "predicted", dating: { kind: "words", phrase: "over the next six months" } }),
      event({ id: "c", modality: "hypothetical", dating: { kind: "words", phrase: "at some point after July 12" } }),
    ]);
    const headings = [...el.querySelectorAll(".tl-group h3")].map((n) => n.textContent ?? "");
    expect(headings).toHaveLength(2);
    expect(headings.join(" ")).toMatch(/expects/);
    expect(headings.join(" ")).toMatch(/might have happened/);
    /* Three groups, and the first — what happened — carries no heading at all.
       A heading over the history would be labelling the default. */
    expect(el.querySelectorAll(".tl-group")).toHaveLength(3);
  });

  it("draws no heading over a group with nothing in it", () => {
    const el = draw([event({ id: "a" }), event({ id: "b" })]);
    expect(el.querySelectorAll(".tl-group h3")).toHaveLength(0);
  });

  /**
   * **Two dates in a piece is not a chronology.** The rows still show — the
   * reader asked and there is something to show them — and what is withdrawn is
   * the claim, because they cannot tell from the rows alone.
   */
  it("withdraws the claim below the threshold and keeps the rows", () => {
    const few = Array.from({ length: A_CHRONOLOGY - 1 }, (_, i) => event({ id: `e${i}` }));
    const el = draw(few);
    expect(el.querySelector(".tl-thin")).not.toBeNull();
    expect(el.querySelectorAll(".tl-item")).toHaveLength(A_CHRONOLOGY - 1);

    const enough = Array.from({ length: A_CHRONOLOGY }, (_, i) => event({ id: `e${i}` }));
    expect(draw(enough).querySelector(".tl-thin")).toBeNull();
  });

  /**
   * **A piece with no chronology is a real answer, not a failure**, and it must
   * offer no retry: running it again would find the same nothing and cost
   * another model call.
   */
  it("says the piece has no chronology, and offers nothing to press", () => {
    const el = draw([]);
    expect(el.textContent).toMatch(/does not tell a story in time/);
    /* **The assertion that matters, and the first version of this test did not
       make it.** It counted `.tl-item` and found none, which is a check that
       cannot fail on a list built from an empty array — docs/reusable/silent-success.md.
       Meanwhile the footer button rendered happily on the empty panel,
       contradicting the comment three lines above it in the panel, and a
       browser pass is what found it. The button is the thing being withheld, so
       the button is what to assert about. */
    expect(el.querySelector(".tl-again")).toBeNull();
    expect(el.querySelectorAll("button")).toHaveLength(0);

    /* The control, so "no button" cannot start meaning "no panel": with events
       the footer button is there. */
    expect(draw([event({ id: "a" })]).querySelector(".tl-again")).not.toBeNull();
  });

  /**
   * **A stale empty timeline is the one case that does get a button.** Nothing
   * to re-run is a statement about *this* article, and a stale artefact is by
   * definition about a different one — so the banner's own button stands while
   * the footer's stays away.
   */
  it("still offers the stale banner's button when there is nothing in the list", () => {
    const el = draw([], { stale: true });
    expect(el.querySelector(".gloss-stale")).not.toBeNull();
    expect(el.querySelector(".tl-again")).toBeNull();
    expect(el.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});
