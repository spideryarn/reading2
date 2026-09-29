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
 * between groups of related modes."* Reviewer is Referee and Recall is
 * Remember. How each sentence was read, and the one move he did not ask for
 * (Diagram, into the shape run), is
 * docs/plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md § 1.
 *
 * Read through `visibleModes`, which is what the bar draws; with the switch on
 * every mode is present, and with it off the lines must still fall only where
 * two surviving runs meet.
 */
import { describe, expect, it } from "vitest";
import { groupStarts, visibleModes } from "../src/web/Dock.js";

/** The runs, left to right. The bar is these, flattened. */
const RUNS = [
  ["plain"],
  ["structure", "summary", "diagram"],
  ["trajectory", "quotes", "faq", "search"],
  ["glossary", "ideas", "timeline"],
  ["referee", "citations", "debate"],
  ["chat", "remember"],
] as const;

describe("the mode bar's order", () => {
  it("draws every mode in Greg's order, with the switch on", () => {
    expect(visibleModes(true, undefined).map((m) => m.mode)).toEqual(RUNS.flat());
  });

  it("puts a line before the first mode of each run and nowhere else", () => {
    const starts = groupStarts(visibleModes(true, undefined));
    expect([...starts].sort()).toEqual(RUNS.slice(1).map((run) => run[0]).sort());
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
    /* Structure, Summary | Trajectory, Quotes, Search | Glossary, Ideas | Chat:
       the critical run is hidden whole, so no line is left for it. */
    const drawn = visibleModes(false, undefined);
    expect(drawn.map((m) => m.mode)).toEqual([
      "plain",
      "structure",
      "summary",
      "trajectory",
      "quotes",
      "search",
      "glossary",
      "ideas",
      "chat",
    ]);
    expect([...groupStarts(drawn)].sort()).toEqual(
      ["structure", "trajectory", "glossary", "chat"].sort(),
    );
  });

  it("gives a retained experimental mode its own line when it is alone in its run", () => {
    /* A reader with the switch off, sitting in Debate by URL: the bar draws
       Debate, and it is a run of one between Ideas and Chat. */
    const drawn = visibleModes(false, "debate");
    expect([...groupStarts(drawn)]).toContain("debate");
    expect([...groupStarts(drawn)]).toContain("chat");
  });
});
