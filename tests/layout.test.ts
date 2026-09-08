/**
 * Column fitting — the arithmetic behind "§ fit the columns, don't just scroll
 * them" in granularity-zoom.md.
 *
 * The worked examples in that doc ARE these test cases, deliberately: the doc
 * quotes concrete pixel widths, and a doc quoting numbers the code no longer
 * produces is worse than one that quotes none. If you change a constant in
 * layout.ts, these fail and the doc needs editing too.
 */
import { describe, expect, it } from "vitest";
import {
  type BarContents,
  barHasContent,
  DEFAULT_ROOT_PX,
  fitView,
  offerableGists,
  proseAloneMaxPx,
  SPINE_W,
  type FitInput,
} from "../src/web/layout.js";

/** A normal three-deep tree: gists at 0/1/2, one leaf node per block at 3. */
const article = { gistDepths: [0, 1, 2], leafDepth: 3 };
const fit = (o: Partial<FitInput> & { windowWidth: number }) =>
  fitView({ ...article, showText: true, chosen: null, ...o });

/**
 * The one rule about *which* columns exist to be chosen from, tested where it
 * lives rather than where each caller applies it.
 *
 * Both callers matter and they want different things: `fitView` below, and the
 * pill row in App.tsx, which offers exactly this list. A pill for a column the
 * fit will never open is a control that does nothing — which is what `Arg` had
 * become by the time it was deleted.
 */
describe("offerableGists", () => {
  it("drops depth 0 and keeps the rest, in order", () => {
    expect(offerableGists([0, 1, 2])).toEqual([1, 2]);
    expect(offerableGists([0])).toEqual([]);
    expect(offerableGists([1, 2, 3])).toEqual([1, 2, 3]);
    expect(offerableGists([])).toEqual([]);
  });
});

describe("the widths granularity-zoom.md promises", () => {
  it("1600px: L1 and L2 at 240 and 1108 of prose — L0 stays closed", () => {
    const f = fit({ windowWidth: 1600 });
    expect(f.columns).toEqual([1, 2]);
    expect(f.widths).toEqual([240, 240, 1108]);
    expect(f.overflowing).toBe(false);
    // Fills the window exactly: 12 of spine + 1588 of table.
    expect(f.minWidth).toBe(1600);
  });

  it("760px: one gist column and prose, fitting exactly — the column is L1", () => {
    const f = fit({ windowWidth: 760 });
    expect(f.columns).toEqual([1]);
    expect(f.tableW).toBe(748);
    expect(f.overflowing).toBe(false);
  });

  it("732px is the crossover, and it is derived rather than chosen", () => {
    // GIST_MIN (176) + PROSE_MIN (544) + the spine (12). One pixel above it the
    // last gist column still fits; at it and below there is no room for one, so
    // auto-fit gives up rather than overflowing. No breakpoint was picked: this
    // number falls out of the two constants that were already in the file — and
    // it moved from 744 when the rail was halved on 2026-08-28, which is the
    // whole reason tests/spine-width.test.ts exists: styles.css performs this
    // same sum by hand, in a `@media` query that cannot read either constant.
    expect(fit({ windowWidth: 732 }).columns).toEqual([1]); // fits exactly, and it's L1
    expect(fit({ windowWidth: 731 }).columns).toEqual([]);
  });

  it("700px: no gist column, and the prose fills the window exactly", () => {
    // It used to be a 720px table in a 688px window — sideways scrolling to
    // read a line. See layout.ts § gistsThatFit.
    const f = fit({ windowWidth: 700 });
    expect(f.columns).toEqual([]);
    expect(f.tableW).toBe(688);
    expect(f.overflowing).toBe(false);
    expect(f.minWidth).toBe(700);
  });
});

/**
 * [SPIDERYARN-READING2-Z]: "The Hierarchy mode should perhaps default to
 * showing Spine, L1 and L2." Reported from an iPad, where the reader had
 * manually reached `?cols=1,2` — this pins that as the automatic default
 * rather than something a reader has to ask for, while leaving `?cols=`
 * itself exactly as honoured today.
 */
describe("the default hierarchy view (no ?cols=)", () => {
  it("wide viewport: spine + L1 + L2, never L0", () => {
    const f = fit({ windowWidth: 1600 });
    expect(f.spine).toBe("on");
    expect(f.columns).toEqual([1, 2]);
  });

  it("narrow (iPad-portrait-ish) viewport: spine + L1 only", () => {
    const f = fit({ windowWidth: 760 });
    expect(f.spine).toBe("on");
    expect(f.columns).toEqual([1]);
  });

  it("an explicit ?cols= is honoured exactly", () => {
    const wide = fit({ windowWidth: 1600, chosen: [1, 2] });
    expect(wide.columns).toEqual([1, 2]);

    const narrow = fit({ windowWidth: 760, chosen: [1, 2] });
    // Unchanged even though it overflows — the window must not overrule it.
    expect(narrow.columns).toEqual([1, 2]);
    expect(narrow.overflowing).toBe(true);

    const onlyCoarse = fit({ windowWidth: 1600, chosen: [1] });
    expect(onlyCoarse.columns).toEqual([1]);
  });

  /**
   * **An old link is not an error.** The L0 column left Hierarchy on
   * 2026-09-05 — Greg: "let's get rid of the 'Arg' button and functionality
   * altogether" — and every `?cols=0,1,2` written before that day is still in
   * somebody's tabs and somebody's notes. The `0` is dropped in silence and
   * the rest of the link works, which is the only behaviour that does not
   * punish a reader for having saved something.
   *
   * The arc artefact itself survives all of this: `src/arc.ts` still runs and
   * Outline mode still renders its sentence — see layout.ts § `offerableGists`
   * and docs/plans/260905d-declutter-the-reading-view-top-bars.md.
   */
  it("drops the 0 from an old ?cols=0,1,2 rather than breaking the link", () => {
    expect(fit({ windowWidth: 1600, chosen: [0, 1, 2] }).columns).toEqual([1, 2]);
    // Still honoured exactly in the direction that matters: it does not fit,
    // and it is not quietly cut down to what does.
    const narrow = fit({ windowWidth: 760, chosen: [0, 1, 2] });
    expect(narrow.columns).toEqual([1, 2]);
    expect(narrow.overflowing).toBe(true);
    // `?cols=0` on its own is an empty table, not a column of one cell.
    expect(fit({ windowWidth: 1600, chosen: [0] }).columns).toEqual([]);
  });
});

describe("which levels get given up", () => {
  it("never auto-opens L0, and drops L2 before L1 when it has to squeeze further", () => {
    // The spine already carries the coarse levels (granularity-zoom.md § the
    // arc), so automatic fit's candidate pool excludes L0 outright — not just
    // "first to go on a narrow window", as it used to be. What's left, [1, 2],
    // is the whole ceiling: whatever survives is always its own front end, so
    // a single surviving column is L1, never L2.
    const candidates = article.gistDepths.filter((d) => d !== 0);
    for (const w of [1600, 1200, 900, 800, 760]) {
      const cols = fit({ windowWidth: w }).columns;
      expect(cols).toEqual(candidates.slice(0, cols.length));
      expect(cols).not.toContain(0);
    }
  });

  it("gives up the last gist column too, rather than overflowing a phone", () => {
    // The reverse of what this file asserted until 2026-08-27. A 390px window
    // used to get a 720px table whose every line of prose was cut mid-word.
    const f = fit({ windowWidth: 390 });
    expect(f.columns).toEqual([]);
    expect(f.widths).toEqual([378]); // the window, less the spine
    expect(f.overflowing).toBe(false);
    expect(f.minWidth).toBe(390);
  });

  it("a phone-width outline is the leaf column at full width", () => {
    // showText: false, so the leaf column is the detail column. It takes the
    // whole window less the rail, which since 2026-09-05 is on here too — see
    // "hiding the spine" below. Nothing to scroll sideways to either way.
    const f = fit({ windowWidth: 390, showText: false });
    expect(f.columns).toEqual([3]);
    expect(f.widths).toEqual([378]);
    expect(f.overflowing).toBe(false);
  });

  it("still honours a manual choice that cannot fit", () => {
    // The promise the window must not break: `?cols=` is obeyed exactly, and
    // the narrow-window floor above is written as min(detailMin, avail) so that
    // it cannot quietly cancel one.
    const f = fit({ windowWidth: 390, chosen: [2] });
    expect(f.columns).toEqual([2]);
    expect(f.overflowing).toBe(true);
    /* **What is promised exactly is the choice of columns, not their widths.**
       GPT Sol read the promise the stronger way, 2026-08-27, and asked whether
       the prose should still hold its 544px floor here — which would make this
       a 720px table rather than 542px. It should not, and the reason is what
       the reader does next: they are going to scroll sideways to the prose
       either way, and at 378px it then fills the screen, while at 544px it is
       still cut off the right-hand edge when they get there. So the widths
       follow the window, always; only the set of columns is theirs. */
    expect(f.widths).toEqual([176, 378]);
    const wide = fit({ windowWidth: 900, chosen: [1, 2] });
    expect(wide.columns).toEqual([1, 2]);
    expect(wide.overflowing).toBe(true);
  });

  it("shrinks before it drops", () => {
    // 1035px still shows both L1 and L2, squeezed; nothing has been given up
    // yet. The candidate pool is now [1, 2] rather than [0, 1, 2] — L0 is
    // never a candidate — so the ideal-width boundary moved from 1264 (three
    // columns at GIST_IDEAL) to 1024 (two): at avail 1023, `floor((1023 - 544)
    // / 2)` is 239, one below GIST_IDEAL, and at avail 1024 (windowWidth 1036)
    // it lands on 240 exactly and "squeezed" goes false. Same trap the
    // original three-column version of this test was written to dodge (GPT
    // Sol, 2026-08-28): pick the width one pixel inside the boundary, not a
    // round number that might land past it.
    const f = fit({ windowWidth: 1035 });
    expect(f.columns).toEqual([1, 2]);
    expect(f.widths[0]).toBeLessThan(240);
  });
});

describe("a wider window never shows less of the article", () => {
  // The regression this pins: the spine's labels used to appear at a fixed
  // 1100px, and the rail widening from 1.5rem to 13rem ate 184px — so 1099px
  // gave three gist columns and 1100px gave one. Widening the window removed
  // two levels of context, which is indefensible whatever the labels are worth.
  //
  // The labelled rail was deleted on 2026-08-26 (Greg: the spine is always the
  // collapsed one), so the rail is a constant 12px and nothing here can go
  // non-monotonic any more. The sweep stays: it is cheap, and it is the check
  // that would catch the next width that gets spent conditionally.
  it("column count is monotonic in window width", () => {
    let prev = 0;
    const regressions: number[] = [];
    for (let w = 320; w <= 2600; w++) {
      const n = fit({ windowWidth: w }).columns.length;
      if (n < prev) regressions.push(w);
      prev = n;
    }
    expect(regressions).toEqual([]);
  });

  it("specifically, across the old 1100px cliff", () => {
    expect(fit({ windowWidth: 1099 }).columns).toEqual(fit({ windowWidth: 1100 }).columns);
  });

  it("the rail is the same width at every window size", () => {
    for (const w of [700, 1099, 1100, 1279, 1280, 1600, 2400]) {
      const f = fit({ windowWidth: w });
      expect(f.spine).toBe("on");
      expect(f.minWidth - f.tableW).toBe(SPINE_W);
    }
  });
});

describe("the reader's choice beats the window", () => {
  it("an explicit set is honoured even when it doesn't fit", () => {
    const f = fit({ windowWidth: 700, chosen: [1, 2] });
    expect(f.columns).toEqual([1, 2]);
    expect(f.overflowing).toBe(true);
  });

  it("an explicit empty set means no gist columns, not 'automatic'", () => {
    const f = fit({ windowWidth: 1600, chosen: [] });
    expect(f.columns).toEqual([]);
    expect(f.widths).toHaveLength(1);
  });

  it("ignores a depth this article hasn't got", () => {
    expect(fit({ windowWidth: 1600, chosen: [1, 9] }).columns).toEqual([1]);
  });
});

describe("the leaf column", () => {
  it("is always present in outline mode, where it is the deepest rung", () => {
    const f = fit({ windowWidth: 1600, showText: false });
    // L0 stays closed here too — automatic fit is the same negotiation in
    // outline mode, and this file stays free of mode names on purpose.
    expect(f.columns).toEqual([1, 2, 3]);
    // The rail is there as well, since 2026-09-05 — see "hiding the spine".
    expect(f.spine).toBe("on");
  });

  it("rides beside the prose when explicitly asked for", () => {
    // Greg wants the one-line-per-paragraph outline AND the full text at once.
    const f = fit({ windowWidth: 1600, chosen: [1, 2, 3] });
    expect(f.columns).toEqual([1, 2, 3]);
    expect(f.widths).toHaveLength(4);
  });

  it("is never chosen by auto-fit", () => {
    for (const w of [700, 1000, 1600, 2400]) {
      expect(fit({ windowWidth: w }).columns).not.toContain(3);
    }
  });
});

describe("the table always has room for its own width", () => {
  it("minWidth covers the rail plus the table at every width", () => {
    for (let w = 320; w <= 2600; w += 7) {
      const f = fit({ windowWidth: w });
      expect(f.minWidth).toBe(f.tableW + (f.spine === "on" ? SPINE_W : 0));
      expect(f.widths.reduce((a, b) => a + b, 0)).toBe(f.tableW);
    }
  });
});

/**
 * The reader's own hand on the rail — `?spine=`, added 2026-08-26 for the pill
 * in the controls bar. The pill went on 2026-09-05 and the parameter stayed:
 * three states still, but the point moved. Absent used to differ from *on*;
 * now it differs from *off*.
 */
describe("hiding the spine", () => {
  it("is on by default, in outline mode as well as reading mode", () => {
    expect(fit({ windowWidth: 1600 }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showText: false }).spine).toBe("on");
  });

  it("goes away when asked, and gives its width to the table", () => {
    const on = fit({ windowWidth: 1600 });
    const off = fit({ windowWidth: 1600, showSpine: false });
    expect(off.spine).toBe("off");
    expect(off.tableW).toBe(on.tableW + SPINE_W);
    expect(off.minWidth).toBe(1600);
  });

  it("stays when asked, even in outline mode where nothing would show it", () => {
    const f = fit({ windowWidth: 1600, showText: false, showSpine: true });
    expect(f.spine).toBe("on");
    // Still the whole outline minus L0, same as automatic everywhere else —
    // the rail is bought out of the detail column.
    expect(f.columns).toEqual([1, 2, 3]);
    expect(f.minWidth).toBe(1600);
  });

  // There is one rail rather than a labelled one and a collapsed one, so on is
  // on at every width — the window has nothing left to say about the spine.
  it("is the same rail at every width", () => {
    expect(fit({ windowWidth: 900, showText: false, showSpine: true }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showText: false, showSpine: true }).spine).toBe("on");
  });

  // Absent and `true` now agree, and the parameter still has three states
  // because `false` is the one that has to be distinguishable from both:
  // App.tsx puts `null` back when Search or Ideas opens with the rail hidden,
  // and that only works if "nobody has touched this" is still a thing to say.
  it("absent means on; only an explicit false takes the rail away", () => {
    expect(fit({ windowWidth: 1600, showText: false, showSpine: null }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showText: false, showSpine: true }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showText: false, showSpine: false }).spine).toBe("off");
  });

  it("keeps the fit monotonic in window width", () => {
    for (const showSpine of [true, false] as const) {
      let prev = 0;
      for (let w = 320; w <= 2600; w++) {
        const n = fit({ windowWidth: w, showSpine }).columns.length;
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
    }
  });
});

describe("the article on its own stops at the measure", () => {
  /* Plain — the default mode — empties the table by handing `fitView` an empty
     `chosen`, so the reading column is the only column there is. It used to
     take the whole window and put a 738px measure in the left of it; on a
     1600px screen that is 850px of empty page down one side. Greg, 2026-09-03:
     "In Plain mode, can you centre the text on the page?" — layout.ts §
     `proseAloneMaxPx`, and styles.css § plain, centred for the auto margins that
     divide what this leaves over. */
  const alone = (windowWidth: number) => fit({ windowWidth, chosen: [] });

  it("caps the lone reading column at proseAloneMaxPx", () => {
    const f = alone(1600);
    expect(f.columns).toEqual([]);
    // 49rem + the gutter's 24px, at the 16px default. It was 48px and the
    // gutter two columns wide until 2026-09-05, when the bookmark moved into
    // the line and the second column went — layout.ts § proseAloneMaxPx.
    expect(f.widths).toEqual([808]);
    /* Through the function rather than `PROSE_ALONE_MAX_REM * root`, because the
       cap stopped being one rem number on 2026-09-04: the gutter's slot is
       `max(1.5rem, 24px)`, so below a 16px root it stops shrinking and the cell's
       left padding grows *in rem terms*. The constant is the rem part; the gutter
       is added as its own term. GPT Sol's stage 1 review. */
    expect(f.tableW).toBe(proseAloneMaxPx(DEFAULT_ROOT_PX));
    expect(f.alone).toBe(true);
    // And there is room to centre it in: the table no longer fills the window.
    expect(f.minWidth).toBeLessThan(1600);
    expect(f.overflowing).toBe(false);
  });

  it("scales the cap with the root font size, because the measure does", () => {
    /* The regression this pins, and it is `SPINE_W`'s lesson from the other
       side: a px constant standing in for a rem-relative length is only right at
       16px. A reader whose browser default is 20px has 65ch, `--reading-size`
       and both of the cell's pads 25% wider — so a fixed 800 would have clipped
       their measure to about 51ch, which is the one thing this cap must never
       do. Found by GPT Sol reviewing the built code, 2026-09-03. */
    expect(fit({ windowWidth: 1600, chosen: [], rootFontPx: 20 }).tableW).toBe(1010);
    // 624 until 2026-09-04, and 624 was the bug: at a 12px root the gutter's
    // px floor makes the left pad 2.7rem, not 2.2, and a rem constant could not
    // follow it. GPT Sol's stage 1 review. 636 until 2026-09-05, when the
    // gutter halved: one slot at every root, so this term is 24px here and 30
    // at a 20px root rather than 48 and 60.
    expect(fit({ windowWidth: 1600, chosen: [], rootFontPx: 12 }).tableW).toBe(612);
    // And it is still a cap, not a width: a window narrower than it wins.
    expect(fit({ windowWidth: 700, chosen: [], rootFontPx: 20 }).tableW).toBe(688);
  });

  it("leaves every narrower window exactly as it was", () => {
    // 820 = `proseAloneMaxPx(16)` plus the spine, so the cap stops
    // biting one pixel below it. Under that the column is still the whole
    // window, which is what every phone gets and what the § gistsThatFit
    // examples above assert.
    expect(alone(820).tableW).toBe(808);
    expect(alone(819).tableW).toBe(807);
    expect(alone(390).tableW).toBe(378);
  });

  it("is not the same question as `only-prose`, which a band also answers yes to", () => {
    // TableView drops the table head whenever the prose is the table's one
    // column, and that includes every mode with a band open. `alone` is the
    // narrower claim — nothing else on the page — because the band has already
    // taken the room the centring would use. Fit.alone says why they are two.
    const band = (windowWidth: number) =>
      fitView({ ...article, showText: true, chosen: null, windowWidth, modeBand: true });
    expect(band(1600).alone).toBe(false);
    expect(band(390).alone).toBe(false);
  });

  it("says no whenever there is a gist column beside the prose", () => {
    expect(fit({ windowWidth: 1600 }).alone).toBe(false);
    expect(fit({ windowWidth: 760 }).alone).toBe(false);
  });

  it("leaves outline mode alone — its one column is nav labels, not prose", () => {
    // `--reading-measure` is a claim about lines of an article. A column of
    // one-line labels capped at 800px would just be a narrower list.
    const f = fit({ windowWidth: 1600, showText: false, chosen: [] });
    expect(f.columns).toEqual([3]);
    expect(f.widths).toEqual([1588]); // the window, less the rail
    expect(f.alone).toBe(false);
  });
});

/**
 * **The controls bar's content, which decides whether it is drawn at all.**
 *
 * The failure this guards is asymmetric, and that is why it is a table rather
 * than three assertions. Say yes too often and the reader gets the 44px of
 * nothing they reported (`SPIDERYARN-READING2-2E`); say no too often and a
 * control disappears — a visitor loses the one line telling them whose document
 * this is, or a failed comment write is swallowed. Only the first of those is
 * visible on screen.
 *
 * docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md
 */
describe("barHasContent", () => {
  const owner: BarContents = {
    owner: true,
    inMode: true,
    offerableGists: 2,
    showText: true,
  };

  it("is empty for an owner in a mode — the case the reader reported", () => {
    // Structure, Outline, Chat, Search, Plain: `inMode` is every mode but
    // Hierarchy, and none of them draws a granularity pill.
    expect(barHasContent(owner)).toBe(false);
  });

  it("is never empty for a visitor, in any mode", () => {
    // The read-only chip. `offerableGists` and `showText` describe the
    // *article*, and neither reaches the bar in a mode, so this has to hold
    // with both of them off as well.
    expect(barHasContent({ ...owner, owner: false })).toBe(true);
    expect(
      barHasContent({ ...owner, owner: false, offerableGists: 0, showText: false }),
    ).toBe(true);
  });

  it("has the granularity pills in Hierarchy", () => {
    expect(barHasContent({ ...owner, inMode: false })).toBe(true);
  });

  it("still has the paragraph pill in Hierarchy on a flat article", () => {
    // No gist depths to offer, but `?text=1` still draws the `Paragraphs` pill
    // or the sentence standing in for it — nav-labels.ts § `paragraphPill`.
    expect(barHasContent({ ...owner, inMode: false, offerableGists: 0 })).toBe(true);
  });

  it("is empty in Hierarchy when the article offers neither", () => {
    // Reachable: a flat article opened with `?text=0`. Nothing would be drawn
    // in it, so the strip should go here too — the bug is "an empty bar", not
    // "an empty bar in a mode".
    expect(
      barHasContent({ ...owner, inMode: false, offerableGists: 0, showText: false }),
    ).toBe(false);
  });

  it("stays empty when a comment write has failed — that mark is on the Dock now", () => {
    // The one transient thing that could put this bar back. It moved to the
    // Comments button on the day this predicate was written, precisely so that
    // a refused delete cannot summon 44px of chrome and push the article down
    // (Dock.tsx § the Comments button). There is no input here to pass, and
    // that absence is the assertion: `BarContents` has no `commentError` field,
    // so this line would not compile if one came back without a decision.
    expect(barHasContent(owner)).toBe(false);
  });
});
