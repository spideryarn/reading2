/**
 * The pure half of the quotes panel — src/web/QuotesPanel.tsx.
 *
 * These are the glossary's ordering functions with **`max` substituted for the
 * product**, and that substitution is the whole reason this file exists rather
 * than a line saying "same as the glossary". Several of the glossary's
 * behaviours were justified by properties a product has and a maximum does not:
 *
 *  - a product of two 0–1 scores clusters low, a maximum clusters high — so the
 *    starting bar is 0.70 rather than 0.30;
 *  - under a product a missing factor is fatal, under a maximum it is merely
 *    conservative — so `priorityOf` computes over whichever scores exist;
 *  - a product rarely ties at the top, a maximum ties often, because **either**
 *    score can produce the top value — so the right-hand end promotes every
 *    quote tied at the top and not "exactly one". The plan claimed the
 *    glossary's promise and GPT Sol showed it false twice: first the claim, and
 *    then the `0.05`-banded track that could not have kept it either way. The
 *    track is the scores themselves now — `barStops`.
 *
 * Nothing here renders. The components are covered by a person, like the rest
 * of this band — docs/project/testing.md is about pure functions.
 */
import { describe, expect, it } from "vitest";
import {
  barNote,
  barStops,
  canPrioritise,
  countAbove,
  discardedNote,
  effectiveRank,
  groupQuotes,
  priorityOf,
  PROMOTE_BAR,
  rankQuotes,
  rowScores,
  snapToStop,
  splitsOnBar,
} from "../src/web/QuotesPanel.js";
import { noneDropped } from "../src/quotes.js";
import type { Quote } from "../src/types.js";

/** A quote is a `text` and a place; these tests are only ever about the numbers. */
function q(id: string, importance?: number, striking?: number): Quote {
  return {
    id,
    blockId: `spya-${id}`,
    text: `A sentence long enough to be a real quote, number ${id}.`,
    ...(importance === undefined ? {} : { importance }),
    ...(striking === undefined ? {} : { striking }),
  };
}

describe("priorityOf", () => {
  it("is the higher of the two, not the product", () => {
    // The whole substitution, in one assertion. Under the glossary's rule this
    // would be 0.27 and would sit below even the default bar.
    expect(priorityOf(q("a", 0.9, 0.3))).toBe(0.9);
  });

  it("uses whichever score exists when only one does", () => {
    expect(priorityOf(q("a", 0.8))).toBe(0.8);
    expect(priorityOf(q("a", undefined, 0.4))).toBe(0.4);
  });

  it("is undefined when the model scored neither, and never zero", () => {
    /* The distinction the whole condition on these scores rests on: a quote the
       model declined to score is not one it scored as trivial. `0` would sort
       it as the worst thing in the list; `undefined` puts it in the lower group
       without claiming anything about it. */
    expect(priorityOf(q("a"))).toBeUndefined();
    expect(priorityOf(q("a", 0, 0))).toBe(0);
  });
});

describe("countAbove", () => {
  it("counts on or above the bar, and skips the unscored", () => {
    const list = [q("a", 0.9, 0.1), q("b", 0.7, 0.7), q("c", 0.2, 0.3), q("d")];
    expect(countAbove(list, 0.7)).toBe(2);
    expect(countAbove(list, 0.95)).toBe(0);
    expect(countAbove(list, 0)).toBe(3); // `d` has nothing to compare
  });
});

describe("canPrioritise", () => {
  it("needs a score and something to compare it against", () => {
    expect(canPrioritise([])).toBe(false);
    expect(canPrioritise([q("a", 0.9)])).toBe(false); // one quote is not an order
    expect(canPrioritise([q("a"), q("b")])).toBe(false); // no scores at all
    expect(canPrioritise([q("a", 0.9), q("b")])).toBe(true);
  });

  /**
   * **A reachable split, not merely a score.** Having scores is not enough, and
   * "are there scores" was a proxy that happened to be right most of the time:
   * every quote scoring the same has one stop above nothing and that stop
   * promotes all of them, so the order would be offered, the slider drawn, and
   * no position on it would ever divide anything. GPT Sol, 2026-08-31.
   */
  it("refuses a list no position on the slider could divide", () => {
    expect(canPrioritise([q("a", 0, 0), q("b", 0, 0)])).toBe(false);
    expect(canPrioritise([q("a", 0.5), q("b", 0.5)])).toBe(false);
    // ...and every stop of a list that CAN be divided is a real division.
    const real = [q("a", 0.9), q("b", 0.4), q("c", 0.4)];
    expect(canPrioritise(real)).toBe(true);
    expect(barStops(real).some((b) => splitsOnBar(real, b))).toBe(true);
  });
});

describe("barStops", () => {
  it("is nothing, then every score the list actually contains", () => {
    expect(barStops([q("a", 0.62, 0.1), q("b", 0.2), q("c")])).toEqual([0, 0.2, 0.62]);
  });

  it("collapses a repeated score to one position", () => {
    // Two stops that promote the same set are one stop, or the drag has dead
    // travel in it and the reader cannot tell working from broken.
    expect(barStops([q("a", 0.5), q("b", 0.5)])).toEqual([0, 0.5]);
  });

  /**
   * **The correction.** The old track was `0.05`-stepped and ended at the top
   * score rounded DOWN to the step — so priorities of `.62`, `.61` and `.20`
   * gave an end of `.60`, which promotes two quotes that are not tied and calls
   * them the top-scored ones. GPT Sol, 2026-08-31.
   */
  it("ends where the top score is, not at the bottom of its band", () => {
    const list = [q("a", 0.62), q("b", 0.61), q("c", 0.2)];
    const stops = barStops(list);
    const end = stops[stops.length - 1];
    expect(end).toBe(0.62);
    expect(countAbove(list, end!)).toBe(1);
  });

  it("promotes every quote genuinely tied at the top, and only those", () => {
    const list = [q("a", 0.9, 0.42), q("b", 0.9, 0.88), q("c", 0.85, 0.9), q("d", 0.7, 0.7)];
    const stops = barStops(list);
    expect(countAbove(list, stops[stops.length - 1]!)).toBe(3); // a, b and c all reach 0.9
  });

  it("makes the left-hand end promote everything", () => {
    const list = [q("a", 0.9), q("b", 0.2)];
    expect(countAbove(list, barStops(list)[0]!)).toBe(2);
  });

  it("has one position when nothing can be divided", () => {
    expect(barStops([q("a", 0, 0), q("b", 0, 0)])).toEqual([0]);
    expect(barStops([q("a"), q("b")])).toEqual([0]);
  });
});

describe("snapToStop", () => {
  /**
   * A `?bar=` can arrive from a link written before the article was re-run,
   * from a hand, or from a different article. The old continuous slider took
   * `?bar=0.63` against a `step=0.05` track and put the thumb where it could
   * not be dragged.
   */
  it("brings an off-grid link onto a division that exists", () => {
    expect(snapToStop([0, 0.2, 0.62], 0.63)).toBe(0.62);
    expect(snapToStop([0, 0.2, 0.62], 0.05)).toBe(0);
  });

  it("does not fall all the way back for a value just above the top", () => {
    // "The largest stop at or below" would answer 0.2 here, which is a bigger
    // lie than rounding up by a hundredth.
    expect(snapToStop([0, 0.2, 0.9], 0.92)).toBe(0.9);
  });

  it("answers the only stop when there is only one", () => {
    expect(snapToStop([0], 0.7)).toBe(0);
  });
});

describe("splitsOnBar", () => {
  it("is about both sides being occupied, not about scores existing", () => {
    const list = [q("a", 0.9), q("b", 0.2)];
    expect(splitsOnBar(list, 0.5)).toBe(true);
    expect(splitsOnBar(list, 0)).toBe(false); // everything above
    expect(splitsOnBar(list, 1)).toBe(false); // nothing above
    expect(splitsOnBar([], 0.5)).toBe(false);
  });
});

describe("effectiveRank", () => {
  it("falls back to document only when there is nothing to bar at all", () => {
    expect(effectiveRank([q("a"), q("b")], "prioritised")).toBe("document");
    expect(effectiveRank([q("a", 0.9), q("b", 0.1)], "prioritised")).toBe("prioritised");
  });

  /**
   * **The rule the slider reversed**, and the one most likely to be got wrong by
   * somebody tidying this up. A list whose *current* bar divides nothing does
   * NOT fall back: cancelling would take the slider away with it and strand a
   * reader mid-drag, and an undivided list here is not silent — the bar is on
   * screen with its number and `barNote` says what happened.
   */
  it("does not fall back merely because the bar divides nothing", () => {
    const list = [q("a", 0.9), q("b", 0.8)];
    expect(splitsOnBar(list, 0)).toBe(false);
    expect(effectiveRank(list, "prioritised")).toBe("prioritised");
  });

  it("leaves every other rank alone", () => {
    for (const rank of ["document", "importance", "striking"] as const) {
      expect(effectiveRank([q("a")], rank)).toBe(rank);
    }
  });
});

describe("barNote", () => {
  it("speaks only when the bar has divided nothing, and says which way", () => {
    const list = [q("a", 0.9), q("b", 0.2)];
    expect(barNote(list, 0.5)).toBeNull();
    expect(barNote(list, 0)).toMatch(/every quote/i);
    expect(barNote(list, 1)).toMatch(/no quote/i);
  });
});

describe("rankQuotes", () => {
  const list = [q("a", 0.2, 0.9), q("b", 0.9, 0.1), q("c")];

  it("leaves document order exactly as the artefact stored it", () => {
    expect(rankQuotes(list, "document").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts each score descending, with the unscored last rather than as zero", () => {
    expect(rankQuotes(list, "importance").map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(rankQuotes(list, "striking").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps document order inside a run of equal scores", () => {
    const tied = [q("a", 0.5), q("b", 0.5), q("c", 0.9)];
    expect(rankQuotes(tied, "importance").map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("is the groups flattened, so the two can never disagree", () => {
    const flat = rankQuotes(list, "prioritised", 0.5).map((x) => x.id);
    const grouped = groupQuotes(list, "prioritised", 0.5).flatMap((g) => g.quotes.map((x) => x.id));
    expect(flat).toEqual(grouped);
  });
});

describe("groupQuotes", () => {
  it("is one unheaded group for every rank but prioritised", () => {
    const groups = groupQuotes([q("a", 0.9), q("b", 0.1)], "document");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeNull();
  });

  it("draws no divider when the bar has divided nothing", () => {
    const groups = groupQuotes([q("a", 0.9), q("b", 0.8)], "prioritised", 0.1);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeNull();
  });

  it("splits into two, each in the order the article says them", () => {
    const list = [q("a", 0.2), q("b", 0.9), q("c", 0.1), q("d", 0.95)];
    const groups = groupQuotes(list, "prioritised", 0.5);
    expect(groups.map((g) => g.label)).toEqual(["worth keeping", "the rest"]);
    // Inside a group the order is first appearance — the model chooses nothing.
    expect(groups[0]?.quotes.map((x) => x.id)).toEqual(["b", "d"]);
    expect(groups[1]?.quotes.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("puts an unscored quote in the lower group without scoring it", () => {
    const groups = groupQuotes([q("a", 0.9), q("b")], "prioritised", 0.5);
    expect(groups[1]?.quotes.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("rowScores", () => {
  /**
   * The rule this keeps, and the bug it was extracted to prevent next door: **a
   * row shows exactly the numbers its position was decided on.** A list in
   * document order was not ranked, so printing a ranking beside every row is
   * precisely the silent prioritising the condition on these scores forbids.
   */
  it("shows nothing at all in document order", () => {
    expect(rowScores(q("a", 0.9, 0.8), "document")).toEqual([]);
    expect(rowScores(q("a", 0.9, 0.8), null)).toEqual([]);
  });

  it("shows the one score the sort was on", () => {
    expect(rowScores(q("a", 0.9, 0.8), "importance")).toEqual([
      { key: "importance", value: 0.9 },
    ]);
    expect(rowScores(q("a", 0.9, 0.8), "striking")).toEqual([{ key: "striking", value: 0.8 }]);
  });

  it("shows nothing where the score it sorted on is missing", () => {
    expect(rowScores(q("a", undefined, 0.8), "importance")).toEqual([]);
  });

  /**
   * **Both, and only one of them decided the position.** That looks like a lie
   * and is the honest choice: under `max` either score could have been the
   * winning reason, so showing only the winner would tell the reader *this got
   * in for being striking* when what is true is *this got in, and here is how it
   * scored on both*. The composite itself is never shown — that is our
   * arithmetic dressed as the model's judgment.
   */
  it("shows both in prioritised order, and never the composite", () => {
    const shown = rowScores(q("a", 0.9, 0.3), "prioritised");
    expect(shown).toEqual([
      { key: "importance", value: 0.9 },
      { key: "striking", value: 0.3 },
    ]);
    expect(shown.map((s) => s.value)).not.toContain(0.9 * 0.3);
  });

  it("shows the one it has, in prioritised order, rather than nothing", () => {
    /* Different from the glossary, and it follows from `max`: an entry with one
       score there cannot be gated at all, where here it can — so the number
       that decided it is a real number and belongs on the row. */
    expect(rowScores(q("a", 0.9), "prioritised")).toEqual([{ key: "importance", value: 0.9 }]);
    expect(rowScores(q("a"), "prioritised")).toEqual([]);
  });
});

describe("discardedNote", () => {
  it("says nothing when nothing was discarded", () => {
    expect(discardedNote(undefined)).toBeNull();
    expect(discardedNote(noneDropped())).toBeNull();
  });

  /**
   * The reader is entitled to `unfound`: it means the model offered words that
   * are not in the piece. A count in a log is invisible to the person the drop
   * happened to — docs/reusable/silent-success.md.
   */
  it("names the model paraphrasing, in the singular and the plural", () => {
    expect(discardedNote({ ...noneDropped(), unfound: 1 })).toMatch(/1 suggestion was dropped/);
    expect(discardedNote({ ...noneDropped(), unfound: 3 })).toMatch(/3 suggestions were dropped/);
  });

  it("names an appearance-as-quotation separately, and joins the two", () => {
    const both = discardedNote({ ...noneDropped(), unfound: 2, otherVoice: 1 });
    expect(both).toMatch(/not in the article/);
    expect(both).toMatch(/appearing as a quotation/);
    /* And NOT a claim about authorship: an author quoting their own earlier
       work lands in this counter, and `authorVoice` refuses a blockquote
       precisely because we cannot tell those apart. */
    expect(both).not.toMatch(/somewhere else|another author|someone else/);
  });

  /**
   * The three it stays quiet about are editorial rules of **ours** — a fragment,
   * a whole paragraph, an overlap, a list past the cap. The reader has no stake
   * in those, and naming them would turn an honest disclosure into a changelog.
   */
  it("says nothing about our own editorial rules", () => {
    expect(
      discardedNote({ ...noneDropped(), wrongLength: 4, overlapping: 2, overCap: 9, malformed: 1 }),
    ).toBeNull();
  });
});

describe("the constants", () => {
  it("starts the bar high, where a maximum lives", () => {
    /* Not a taste assertion: two scores of 0.7 make 0.49 under a product and
       0.70 under a maximum, so the glossary's 0.30 would promote nearly
       everything here and the divider would say nothing. */
    expect(PROMOTE_BAR).toBeGreaterThan(0.5);
    expect(priorityOf(q("a", 0.7, 0.7))).toBe(0.7);
  });

  it("is a starting position the slider can always express", () => {
    /* It is snapped to a real stop before anything reads it, so it never has to
       be on any grid — which is the whole reason the track stopped being a grid.
       What it must still be is inside the scale. */
    expect(PROMOTE_BAR).toBeLessThanOrEqual(1);
    expect(snapToStop(barStops([q("a", 0.9), q("b", 0.4)]), PROMOTE_BAR)).toBe(0.9);
  });
});
