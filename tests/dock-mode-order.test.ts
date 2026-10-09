// @vitest-environment jsdom
/**
 * **The bar's order is Greg's, and so are the runs.** Written out whole here,
 * by hand, and never derived from `MODES_UI` (src/web/Dock.tsx) — a test that
 * read the order off the table it is checking would pass whatever the table
 * said.
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-4E): *"Move Citations further right,
 * next to Debate and Reviewer. Move Timeline further right. Move Trajectory one
 * further left, before Quotes. Move Chat right, just before Recall. Move FAQ
 * and Search a little bit further left. Add subtle vertical separator lines
 * between groups of related modes."* Reviewer is Referee, Recall is
 * Learn and Trajectory is Skim (since 2026-10-01). How each sentence was read, and the one move he did not ask for
 * (Diagram, into the shape run), is
 * docs/plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md § 1.
 *
 * Then, later the same day (SPIDERYARN-READING2-57): *"Move Glossary, Ideas,
 * Timeline modes left into the bottom-bar separator-section with Trajectory.
 * And move Search into section with Chat."* Six runs became five —
 * docs/plans/260929f-mode-bar-regroup-glossary-ideas-timeline-with-trajectory-search-with-chat.md.
 *
 * And on 2026-10-04 (spya-tnqt2t): *"Move the citations mode one to the left in
 * the bottom bar and move the glossary one to the left."* Each swapped with its
 * left-hand neighbour inside its own run —
 * docs/plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md.
 *
 * Read through `visibleModes`, which is what the bar offers; with the switch on
 * every mode is present, and with it off the lines must still fall only where
 * two surviving runs meet.
 *
 * **Offers, not draws, since 2026-10-07.** Greg, 2026-10-06 (spya-dest8x),
 * asked for *"the glossary, FAQ, ideas, timeline, quotes"* to be gathered
 * behind *"a more button in their place"*, so five rows of the guides run are
 * items of the More menu and the bar draws what `splitForMore` leaves. The
 * order above is unchanged and still what the command bar lists and the menu
 * follows; the **lines** are a fact about what is drawn, so every case about
 * them reads the drawn list.
 * docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md.
 *
 * And on 2026-10-08 (spya-wm5gu2): *"move the skim mode icon into the same
 * group after structure and summary."* Skim leaves the guides run for the shape
 * run, at its end; the guides run is the five under More, and is drawn only
 * while one of them is open —
 * docs/plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md.
 */
import { describe, expect, it } from "vitest";
import { groupStarts, splitForMore, visibleModes } from "../src/web/Dock.js";
import type { BandMode } from "../src/modes.js";

/** The five under More, in the bar's order — by hand, like `RUNS`. */
const UNDER_MORE = ["quotes", "glossary", "faq", "ideas", "timeline"] as const;

/** What the bar draws as buttons for a reader in `current`, Marginalia's toggle left out. */
const drawnBands = (on: boolean, current?: BandMode) =>
  splitForMore(visibleModes(on, current), current).drawn.filter((m) => m.mode !== "marginalia");

/** The runs, left to right. The bar is these, flattened. */
const RUNS = [
  ["plain"],
  /* Tweets stood in the shape run, beside Summary, from 2026-09-29 to
     2026-10-03; it is Summary's Thread view now, and one button fewer
     (docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md). */
  ["structure", "summary", "diagram", "skim"],
  ["quotes", "glossary", "faq", "ideas", "timeline"],
  /* Citations, Referee, Debate until 2026-10-09, when Citations and Debate
     became Peer review, in Debate's place (plan 261009l). */
  ["referee", "peer-review"],
  ["search", "chat", "learn"],
  /* Marginalia's toggle, since 2026-10-01 a switch beside the band rather than
     one of the bands, at the right-hand end like its column
     (docs/plans/261001i-annotations-column-beside-a-band-mode.md). */
  ["marginalia"],
] as const;

describe("the mode bar's order", () => {
  it("offers every mode in Greg's order, with the switch on", () => {
    expect(visibleModes(true, undefined).map((m) => m.mode)).toEqual(RUNS.flat());
  });

  it("draws that order less the five under More, which the menu lists in the same order", () => {
    const bar = splitForMore(visibleModes(true, undefined), undefined);
    const gathered: readonly string[] = UNDER_MORE;
    expect(bar.drawn.map((m) => m.mode)).toEqual(RUNS.flat().filter((m) => !gathered.includes(m)));
    expect(bar.menu.map((m) => m.mode)).toEqual(UNDER_MORE);
    /* The five are the whole of one run, so More takes nothing from any other,
       and that run is drawn only while one of them is open. */
    expect(RUNS[2]).toEqual(UNDER_MORE);
  });

  it("puts a line before each band run, while Marginalia's own frame supplies its edge", () => {
    /* Both Dock arms pass only the bands to `groupStarts`; Plain and
       Marginalia already have frame edges (Dock.tsx § the three frames). The
       guides run is all under More, so with none of it open it draws no line. */
    const starts = groupStarts(drawnBands(true));
    expect([...starts].sort()).toEqual(["structure", "referee", "search"].sort());
  });

  it("keeps each run in one piece, so a run never draws two lines", () => {
    const seen = new Set<string>();
    let last: string | undefined;
    for (const m of visibleModes(true, undefined)) {
      if (m.group !== last) {
        expect(seen.has(m.group), `run ${m.group} is split`).toBe(false);
        seen.add(m.group);
        last = m.group;
      }
    }
  });

  it("with the switch off, draws lines only where two surviving runs meet", () => {
    /* Structure, Summary, Skim | Quotes, Glossary, Ideas | Peer review |
       Search, Chat, Learn: the critical run was hidden whole from 2026-10-05
       (spya-cnqcjf) until Peer review came out of the switch on 2026-10-09
       (plan 261009l); Referee, still behind it, leaves Peer review alone in
       the run. Marginalia's toggle is last, in a frame of its own, since it
       left the switch on 2026-10-05 (spya-vv54j2). */
    const offered = visibleModes(false, undefined);
    expect(offered.map((m) => m.mode)).toEqual([
      "plain",
      "structure",
      "summary",
      "skim",
      "quotes",
      "glossary",
      "ideas",
      "peer-review",
      "search",
      "chat",
      "learn",
      "marginalia",
    ]);
    /* Of those the bar draws Structure, Summary, Skim | Peer review | Search,
       Chat, Learn — More since 2026-10-07, with Quotes, Glossary and Ideas
       under it, and Skim in Structure's run since 2026-10-08. */
    expect(drawnBands(false).map((m) => m.mode)).toEqual([
      "plain",
      "structure",
      "summary",
      "skim",
      "peer-review",
      "search",
      "chat",
      "learn",
    ]);
    /* The bar asks about the bands only: the toggle's frame is its own edge
       (Dock.tsx § the three frames). */
    expect([...groupStarts(drawnBands(false))].sort()).toEqual(["structure", "peer-review", "search"].sort());
  });

  it("a gathered mode drawn while it is open is a run of its own, after Skim, with its line", () => {
    for (const current of ["quotes", "glossary", "ideas", "timeline"] as const) {
      const drawn = drawnBands(false, current);
      expect(drawn.map((m) => m.mode), current).toEqual([
        "plain",
        "structure",
        "summary",
        "skim",
        current,
        "peer-review",
        "search",
        "chat",
        "learn",
      ]);
      expect([...groupStarts(drawn)].sort(), current).toEqual(["structure", current, "peer-review", "search"].sort());
    }
  });

  it("puts a retained experimental mode in its run, and the run's line before it", () => {
    /* A reader with the switch off, sitting in Referee by URL: the bar draws
       Referee beside Peer review, and the critical run's line moves to
       Referee, its first. It was Debate alone in its run until 2026-10-09,
       when Debate became Peer review and left the switch (plan 261009l). */
    const drawn = drawnBands(false, "referee");
    expect(drawn.map((m) => m.mode)).toContain("referee");
    expect([...groupStarts(drawn)]).toContain("referee");
    expect([...groupStarts(drawn)]).not.toContain("peer-review");
    expect([...groupStarts(drawn)]).toContain("search");
  });
});
