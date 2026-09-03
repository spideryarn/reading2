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
 *    score can produce the top value — so the right-hand end keeps every quote
 *    tied at the top and not "exactly one". The plan claimed the
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
  discardedNote,
  effectiveRank,
  priorityOf,
  QUOTE_BAR_DEFAULT,
  rankQuotes,
  rowScores,
  snapToStop,
  visibleQuotes,
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

/**
 * The foot line the panel would print, composed the way `BarSlider` composes
 * it: one `visibleQuotes` pass, and the counts out of it handed to `barNote`.
 *
 * A helper rather than a call to `barNote(list, bar)`, because `barNote`
 * deliberately takes counts and not a list — that is what keeps the sentence
 * and the `N of M` above it from being two passes that could disagree.
 */
function noteFor(quotes: Quote[], bar: number): string {
  return barNote(visibleQuotes(quotes, bar).hiddenCount, quotes.length);
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
       it as the worst thing in the list; `undefined` shows it at every position
       of the bar without claiming anything about it — threshold.ts. */
    expect(priorityOf(q("a"))).toBeUndefined();
    expect(priorityOf(q("a", 0, 0))).toBe(0);
  });
});

describe("visibleQuotes", () => {
  it("shows what is on or above the bar, and every unscored quote", () => {
    /* Greg's interim rule, 2026-09-03: "In the interim, always show them." A
       quote the model scored on neither axis is not one it scored as trivial,
       and the quotes prompt explicitly permits omitting both. */
    const list = [q("a", 0.9, 0.1), q("b", 0.7, 0.7), q("c", 0.2, 0.3), q("d")];
    const out = visibleQuotes(list, 0.7);
    expect(out.visible.map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(out.hiddenCount).toBe(1);
    expect(out.unscoredCount).toBe(1);
    // The identity a drifting count would break.
    expect(out.visible.length + out.hiddenCount).toBe(list.length);
  });

  it("can hide every scored quote and still show the unscored one", () => {
    const out = visibleQuotes([q("a", 0.9), q("d")], 0.95);
    expect(out.visible.map((x) => x.id)).toEqual(["d"]);
    expect(out.hiddenCount).toBe(1);
  });
});

describe("canPrioritise", () => {
  it("needs two distinct scored priorities", () => {
    expect(canPrioritise([])).toBe(false);
    expect(canPrioritise([q("a", 0.9)])).toBe(false); // one quote is not an order
    expect(canPrioritise([q("a"), q("b")])).toBe(false); // no scores at all
    expect(canPrioritise([q("a", 0.9), q("b", 0.1)])).toBe(true);
  });

  /**
   * **The rule the hiding change tightened, 2026-09-03.** `[0.90, unscored]`
   * used to answer true, because the unscored quote formed *"the rest"* and the
   * bar at `0.90` therefore divided the list. Once the unscored quote always
   * survives, **no reachable position of the bar hides anything** — the order
   * would be offered and the slider drawn over a control that visibly does
   * nothing, which is the exact thing this question exists to stop.
   */
  it("refuses a list where the unscored quote was the only thing below the bar", () => {
    expect(canPrioritise([q("a", 0.9), q("b")])).toBe(false);
    expect(visibleQuotes([q("a", 0.9), q("b")], 0.9).hiddenCount).toBe(0);
  });

  /**
   * **A reachable filter, not merely a score.** Having scores is not enough:
   * every quote scoring the same gives one stop, and that stop shows all of
   * them. The all-zero case is the same shape and is the one GPT Sol named,
   * 2026-08-31.
   */
  /**
   * **The property the glossary had to be rewritten to hold, asserted here to
   * record that this panel already holds it.**
   *
   * GPT Sol's blocker on the built code was that the glossary offered the order
   * whenever two scores differed, while its slider could only stop on
   * hundredths — so `[0.501, 0.509]` got a prioritised order whose every
   * reachable position showed both terms. Quotes cannot have that bug, and the
   * reason is `barStops`: the track's positions **are** the scores, so there is
   * no grid to fall between, and the top stop is a real quote's score with
   * every lower-scoring quote strictly beneath it. Nothing to fix here, and this
   * is the test that says why rather than a comment claiming it.
   */
  it("offers the order exactly when the top of the track hides something", () => {
    const lists = [
      [],
      [q("a", 0.9)],
      [q("a"), q("b")],
      [q("a", 0.9), q("b")],
      [q("a", 0.9), q("b", 0.1)],
      [q("a", 0.5), q("b", 0.5)],
      [q("a", 0, 0), q("b", 0, 0)],
      /* A hundredth apart, which the glossary's grid could not have reached and
         this track can, because it is not a grid. */
      [q("a", 0.501), q("b", 0.509)],
    ];
    for (const list of lists) {
      const stops = barStops(list);
      const top = stops[stops.length - 1]!;
      expect(canPrioritise(list)).toBe(visibleQuotes(list, top).hiddenCount > 0);
    }
  });

  it("refuses a list no position on the slider could filter", () => {
    expect(canPrioritise([q("a", 0, 0), q("b", 0, 0)])).toBe(false);
    expect(canPrioritise([q("a", 0.5), q("b", 0.5)])).toBe(false);
  });
});

describe("barStops", () => {
  /**
   * **The synthetic `0` went on 2026-09-03**, and it is the subtle half of the
   * hiding change. While the bar grouped, `0` was a real position: it emptied
   * "the rest" into the top group. Now that it hides, `0` and the lowest real
   * score show exactly the same list — every score is `>= 0` and the unscored
   * survive everywhere — so the first step of the drag would have been the
   * no-op this function exists to prevent.
   */
  it("is every score the list actually contains, and nothing else", () => {
    expect(barStops([q("a", 0.62, 0.1), q("b", 0.2), q("c")])).toEqual([0.2, 0.62]);
  });

  it("collapses a repeated score to one position", () => {
    // Two stops that show the same list are one stop, or the drag has dead
    // travel in it and the reader cannot tell working from broken.
    expect(barStops([q("a", 0.5), q("b", 0.5)])).toEqual([0.5]);
  });

  /**
   * **Every ADJACENT pair, not merely some pair.** The old test asserted that
   * *some* stop divided the list, which does not prove what the comment claims
   * — a track can satisfy that and still have a dead step in the middle of it,
   * which is exactly what the leading `0` was. This is the assertion the
   * docstring's promise actually needs.
   */
  it("gives a different visible list at every adjacent pair of stops", () => {
    const lists = [
      [q("a", 0.62, 0.1), q("b", 0.2), q("c")],
      [q("a", 0.9, 0.42), q("b", 0.9, 0.88), q("c", 0.85, 0.9), q("d", 0.7, 0.7)],
      [q("a", 0.62), q("b", 0.61), q("c", 0.2), q("d")],
      [q("a", 0, 0), q("b", 0.4), q("c")],
    ];
    for (const list of lists) {
      const stops = barStops(list);
      for (let i = 1; i < stops.length; i += 1) {
        const below = visibleQuotes(list, stops[i - 1]!).visible.map((x) => x.id);
        const above = visibleQuotes(list, stops[i]!).visible.map((x) => x.id);
        expect(above).not.toEqual(below);
        // And strictly fewer, never a different set of the same size: the bar
        // only ever takes rows away as it rises.
        expect(above.length).toBeLessThan(below.length);
      }
    }
  });

  /**
   * **The correction.** The old track was `0.05`-stepped and ended at the top
   * score rounded DOWN to the step — so priorities of `.62`, `.61` and `.20`
   * gave an end of `.60`, which keeps two quotes that are not tied and calls
   * them the top-scored ones. GPT Sol, 2026-08-31.
   */
  it("ends where the top score is, not at the bottom of its band", () => {
    const list = [q("a", 0.62), q("b", 0.61), q("c", 0.2)];
    const stops = barStops(list);
    const end = stops[stops.length - 1];
    expect(end).toBe(0.62);
    expect(visibleQuotes(list, end!).visible.map((x) => x.id)).toEqual(["a"]);
  });

  it("keeps every quote genuinely tied at the top, and only those", () => {
    const list = [q("a", 0.9, 0.42), q("b", 0.9, 0.88), q("c", 0.85, 0.9), q("d", 0.7, 0.7)];
    const stops = barStops(list);
    // a, b and c all reach 0.9.
    expect(visibleQuotes(list, stops[stops.length - 1]!).visible.map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("makes the left-hand end show everything", () => {
    const list = [q("a", 0.9), q("b", 0.2)];
    expect(visibleQuotes(list, barStops(list)[0]!).hiddenCount).toBe(0);
  });

  it("has one position when nothing can be filtered", () => {
    expect(barStops([q("a", 0, 0), q("b", 0, 0)])).toEqual([0]);
    // No scores at all: `[0]` so the input still has a track to render, though
    // `canPrioritise` is false and the slider is never drawn.
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
  it("brings an off-grid link onto a position that exists", () => {
    expect(snapToStop([0.2, 0.62], 0.63)).toBe(0.62);
    expect(snapToStop([0.2, 0.62], 0.05)).toBe(0.2);
  });

  it("does not fall all the way back for a value just above the top", () => {
    // "The largest stop at or below" would answer 0.2 here, which is a bigger
    // lie than rounding up by a hundredth.
    expect(snapToStop([0.2, 0.9], 0.92)).toBe(0.9);
  });

  it("answers the only stop when there is only one", () => {
    expect(snapToStop([0], 0.7)).toBe(0);
  });
});

describe("effectiveRank", () => {
  it("falls back to document only when no position of the bar would filter", () => {
    expect(effectiveRank([q("a"), q("b")], "prioritised")).toBe("document");
    expect(effectiveRank([q("a", 0.9), q("b", 0.1)], "prioritised")).toBe("prioritised");
  });

  /**
   * **The rule the slider reversed**, and the one most likely to be got wrong by
   * somebody tidying this up. A list whose *current* bar hides nothing does NOT
   * fall back: cancelling would take the slider away with it and strand a
   * reader mid-drag, and a list nothing is hidden from is not silent — the bar
   * is on screen with its number and the foot line says how many are hidden,
   * including when the answer is none.
   */
  it("does not fall back merely because the bar hides nothing", () => {
    const list = [q("a", 0.9), q("b", 0.8)];
    expect(visibleQuotes(list, 0.8).hiddenCount).toBe(0);
    expect(effectiveRank(list, "prioritised")).toBe("prioritised");
  });

  it("leaves every other rank alone", () => {
    for (const rank of ["document", "importance", "striking"] as const) {
      expect(effectiveRank([q("a")], rank)).toBe(rank);
    }
  });
});

describe("barNote", () => {
  /* The foot line, verbatim. It is the reader's one route back from a bar they
     have raised too far, so the wording is asserted rather than matched
     loosely — and "clears" is deliberately not in it, because an unscored quote
     survives without clearing anything. */
  it("says how many are hidden, in every state", () => {
    const list = [q("a", 0.9), q("b", 0.2)];
    expect(noteFor(list, 0.5)).toBe(
      "1 quote is hidden by this threshold. Drag the slider left to show it.",
    );
    expect(noteFor(list, 0.2)).toBe("Nothing is hidden by this threshold.");
    expect(noteFor(list, 1)).toBe(
      "All 2 quotes are hidden by this threshold. Drag the slider left to show them.",
    );
    expect(noteFor([q("a", 0.9), q("b", 0.2), q("c", 0.1)], 0.5)).toBe(
      "2 quotes are hidden by this threshold. Drag the slider left to show them.",
    );
  });

  /**
   * **Dragging cannot reach the all-hidden state here**, unlike next door: the
   * top stop is a real quote's score, so that quote always survives. The
   * sentence exists anyway, because `?bar=` is a number in a URL — and the
   * browser pass must not expect an empty list at the top of this mode.
   */
  it("cannot be reached by dragging, because the top stop is a real score", () => {
    const list = [q("a", 0.9), q("b", 0.2), q("c")];
    for (const stop of barStops(list)) {
      expect(visibleQuotes(list, stop).visible.length).toBeGreaterThan(0);
    }
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

  it("is the one visible list, so the panel and its count cannot disagree", () => {
    const flat = rankQuotes(list, "prioritised", 0.5).map((x) => x.id);
    expect(flat).toEqual(visibleQuotes(list, 0.5).visible.map((x) => x.id));
  });
});

describe("the prioritised rank, which filters rather than groups", () => {
  /* Rewritten 2026-09-03. These used to pin the two-group version — "worth
     keeping" over the survivors and "the rest" under them. What they protect
     now is the same two properties in the new shape: the order of what is shown
     is the article's own, and an unscored quote is never treated as a low one.
     docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md. */
  it("returns the whole list for every rank but prioritised", () => {
    const list = [q("a", 0.9), q("b", 0.1)];
    expect(rankQuotes(list, "document")).toHaveLength(2);
    expect(rankQuotes(list, "importance")).toHaveLength(2);
  });

  it("returns the whole list when the bar has hidden nothing", () => {
    const list = [q("a", 0.9), q("b", 0.8)];
    expect(rankQuotes(list, "prioritised", 0.1).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("hides what is below the bar, keeping the order the article says them", () => {
    const list = [q("a", 0.2), q("b", 0.9), q("c", 0.1), q("d", 0.95)];
    // `b` before `d` because the piece says it first, not because it scored
    // lower — the model chooses nothing about the sequence.
    expect(rankQuotes(list, "prioritised", 0.5).map((x) => x.id)).toEqual(["b", "d"]);
  });

  it("shows an unscored quote without scoring it", () => {
    expect(rankQuotes([q("a", 0.9), q("b")], "prioritised", 0.5).map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
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
       0.70 under a maximum, so the glossary's 0.30 would show nearly everything
       here and the bar would be hiding nothing worth hiding. */
    expect(QUOTE_BAR_DEFAULT).toBeGreaterThan(0.5);
    expect(priorityOf(q("a", 0.7, 0.7))).toBe(0.7);
  });

  it("is a starting position the slider can always express", () => {
    /* It is snapped to a real stop before anything reads it, so it never has to
       be on any grid — which is the whole reason the track stopped being a grid.
       What it must still be is inside the scale. */
    expect(QUOTE_BAR_DEFAULT).toBeLessThanOrEqual(1);
    expect(snapToStop(barStops([q("a", 0.9), q("b", 0.4)]), QUOTE_BAR_DEFAULT)).toBe(0.9);
  });
});
