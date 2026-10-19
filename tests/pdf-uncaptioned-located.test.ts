/**
 * An uncaptioned PDF figure, asked about by the prose either side of it — the
 * pure parts: the neighbours read from the blocks, the question, the order
 * check, the run check, and freshness. The joined-up route, on a real PDF, is in
 * tests/collect-pdf-figures.test.ts.
 * docs/plans/261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md.
 */
import { describe, expect, it } from "vitest";

import { assetsInputHash, pdfFigureNeighboursIn } from "../src/collect-assets.js";
import {
  disorderedRuns,
  type FigureNeighbours,
  judgeNeighbourOrder,
  type LocateSubject,
  locatePrompt,
} from "../src/pdf-figure-locate.js";
import { anchorBox, type PageTextItem } from "../src/pdf-figure-region.js";
import type { Block } from "../src/types.js";

const ref = (page: number, ordinal = 1) => `pdffig1-${"0123456789abcdef".repeat(2)}.${page}.${ordinal}`;

function prose(text: string, id = `spya-${Math.random().toString(36).slice(2, 8)}`): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(" ").length, html: `<p>${text}</p>`, gistable: true };
}

function figure(marker: string, caption = ""): Block {
  return {
    id: `spya-f${marker.slice(-4).replace(/\./g, "0")}`,
    tag: "figure",
    kind: "media",
    text: caption,
    words: 0,
    html: `<figure data-spya-pdf-figure="${marker}">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`,
    gistable: false,
  };
}

describe("pdfFigureNeighboursIn", () => {
  it("gives an uncaptioned figure the end of the text before it and the start of the text after", () => {
    const long = `${"x".repeat(400)} Those of Leonidas are shown below, alongside Gorgo's:`;
    const blocks = [prose(long), figure(ref(32)), prose("The temporal structure of the universe is very similar.")];
    const got = pdfFigureNeighboursIn(blocks).get(ref(32));
    expect(got?.before.endsWith("alongside Gorgo's:")).toBe(true);
    expect(got?.before.length).toBe(300);
    expect(got?.beforeStart.startsWith("xxx")).toBe(true);
    expect(got?.after).toBe("The temporal structure of the universe is very similar.");
    expect(got?.run).toEqual({ index: 1, of: 1, key: ref(32) });
  });

  it("names nothing for a captioned figure", () => {
    const blocks = [prose("Before."), figure(ref(5), "Figure 1. A caption."), prose("After.")];
    expect(pdfFigureNeighboursIn(blocks).size).toBe(0);
  });

  it("gives adjacent uncaptioned figures the same neighbours and their places in the run", () => {
    const first = ref(67, 2);
    const blocks = [prose("The set of real events now is shown in gray:"), figure(first), figure(ref(68)), prose("But the second diagram is better.")];
    const got = pdfFigureNeighboursIn(blocks);
    expect(got.get(first)).toMatchObject({ after: "But the second diagram is better.", run: { index: 1, of: 2, key: first } });
    expect(got.get(ref(68))).toMatchObject({ before: "The set of real events now is shown in gray:", run: { index: 2, of: 2, key: first } });
  });

  it("joins a run across empty media and gives a document-edge figure its one available neighbour", () => {
    const first = ref(1);
    const empty = { ...figure(ref(99)), html: "<figure></figure>" };
    const blocks = [figure(first), empty, figure(ref(2)), prose("The first available words are after the run.")];
    const got = pdfFigureNeighboursIn(blocks);
    expect(got.get(first)).toMatchObject({ before: "", after: "The first available words are after the run.", run: { index: 1, of: 2, key: first } });
    expect(got.get(ref(2))?.run).toEqual({ index: 2, of: 2, key: first });

    const last = ref(3);
    expect(pdfFigureNeighboursIn([prose("The last available words are before it."), empty, figure(last)]).get(last)).toMatchObject({
      before: "The last available words are before it.",
      after: "",
    });
  });

  it("uses a captioned figure's caption as a landmark", () => {
    const blocks = [figure(ref(4), "Figure 2. The earlier one."), figure(ref(5)), prose("After it.")];
    expect(pdfFigureNeighboursIn(blocks).get(ref(5))?.before).toBe("Figure 2. The earlier one.");
  });

  it("gives nothing to a figure with no text on either side", () => {
    expect(pdfFigureNeighboursIn([figure(ref(1))]).size).toBe(0);
  });
});

describe("locatePrompt", () => {
  const pages = [{ page: 31 }, { page: 32 }, { page: 33 }];

  it("asks by caption exactly as the 260924e test run measured", () => {
    expect(locatePrompt({ kind: "caption", caption: "Figure 1. A graph." }, pages)).toBe(
      "These are 3 consecutive pages of a PDF: image 1 is page 31, image 2 is page 32, image 3 is page 33.\n" +
        'A figure in this document has this caption or title: "Figure 1. A graph.".\n' +
        "The caption may be printed beside the figure, or it may be a title drawn inside the picture itself.\n" +
        "Find the one figure it belongs to, on these pages. Give its page, and box_2d as [ymin, xmin, ymax, xmax] " +
        "normalised 0-1000 on that page's image, around the figure's picture only: include any title or labels drawn " +
        "inside the picture, exclude the prose around it and any separately printed caption. " +
        'If no figure on these pages has this caption or title, answer {"page": null, "box_2d": null}.',
    );
  });

  it("asks an uncaptioned figure by the prose either side, and its place in a run", () => {
    const subject: LocateSubject = {
      kind: "neighbours",
      before: "like this one for Gorgo:",
      beforeStart: "To see how this order works",
      after: "There is a cone-shaped past",
      run: { index: 2, of: 3, key: "run-a" },
    };
    const prompt = locatePrompt(subject, pages);
    expect(prompt).toContain("has no caption");
    expect(prompt).toContain('after the passage ending: "like this one for Gorgo:"');
    expect(prompt).toContain('before the passage starting: "There is a cone-shaped past"');
    expect(prompt).toContain("3 figures stand in a row");
    expect(prompt).toContain("number 2 of them");
    expect(prompt).not.toContain("To see how this order works");
  });

  it("leaves out a side it does not have", () => {
    const prompt = locatePrompt({ kind: "neighbours", before: "", beforeStart: "", after: "Next.", run: { index: 1, of: 1, key: "run-a" } }, pages);
    expect(prompt).not.toContain("after the passage ending");
    expect(prompt).not.toContain("in a row");
  });
});

describe("judgeNeighbourOrder", () => {
  /* y is up: a picture from 500 to 700 on the page. */
  const picture = { x0: 50, y0: 500, x1: 300, y1: 700 };
  const line = (y: number) => ({ x0: 50, y0: y, x1: 300, y1: y + 10 });

  it("accepts a picture below the text before it and above the text after it", () => {
    expect(judgeNeighbourOrder({ picture, before: line(720), after: line(470) })).toBe("consistent");
  });

  it("refuses a picture above the text that must come before it", () => {
    expect(judgeNeighbourOrder({ picture, before: line(400), after: null })).toBe("out-of-order");
  });

  it("refuses a picture below the text that must come after it", () => {
    expect(judgeNeighbourOrder({ picture, before: null, after: line(760) })).toBe("out-of-order");
  });

  it("takes no view from text set beside the picture", () => {
    /* Rovelli p18: a photograph on the right, the paragraph after it wrapped
       round it on the left — the right photograph, refused until this. */
    const photo = { x0: 400, y0: 147, x1: 540, y1: 312 };
    const beside = { x0: 72, y0: 164, x1: 381, y1: 196 };
    expect(judgeNeighbourOrder({ picture: photo, before: null, after: beside })).toBe("consistent");
    expect(judgeNeighbourOrder({ picture: photo, before: null, after: { ...beside, x1: 450 } })).toBe("out-of-order");
  });

  it("has no veto without anchors on the page", () => {
    expect(judgeNeighbourOrder({ picture, before: null, after: null })).toBe("consistent");
  });
});

describe("anchorBox", () => {
  const run = (str: string, y: number, x = 50): PageTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width: 200, height: 10 });

  it("finds a passage's opening across runs, mid-line included", () => {
    const items = [run("and so on. Here is a diagram for", 600), run("those who, like me, have difficulties", 588)];
    expect(anchorBox("Here is a diagram for those who, like me, have difficulties with genealogy", items)).toMatchObject({
      y0: 588,
      y1: 610,
    });
  });

  it("finds nothing for a passage printed twice, or too short to trust", () => {
    const twice = [run("It is, rather, a structure made up entirely", 600), run("It is, rather, a structure made up entirely", 300)];
    expect(anchorBox("It is, rather, a structure made up entirely of light cones", twice)).toBeNull();
    expect(anchorBox("Like this:", [run("Like this:", 600)])).toBeNull();
  });
});

describe("disorderedRuns", () => {
  const member = (index: number, page: number, top: number, key = "run-a"): { subject: LocateSubject; page: number; box: { x0: number; y0: number; x1: number; y1: number } } => ({
    subject: { kind: "neighbours", before: "B", beforeStart: "B", after: "A", run: { index, of: 2, key } },
    page,
    box: { x0: 0, y0: top - 100, x1: 100, y1: top },
  });

  it("keeps a run whose pictures come down the page in order", () => {
    expect(disorderedRuns([member(1, 36, 700), member(2, 36, 400)]).size).toBe(0);
    expect(disorderedRuns([member(1, 36, 300), member(2, 37, 700)]).size).toBe(0);
  });

  it("spoils a run whose pictures are swapped", () => {
    expect(disorderedRuns([member(1, 36, 400), member(2, 36, 700)]).size).toBe(1);
    expect(disorderedRuns([member(1, 37, 700), member(2, 36, 300)]).size).toBe(1);
  });

  it("spoils a run when any member was not placed", () => {
    expect(disorderedRuns([member(1, 36, 700)]).size).toBe(1);
    expect(disorderedRuns([member(2, 36, 400)]).size).toBe(1);
  });

  it("does not merge separate runs whose prose happens to be identical", () => {
    expect(
      disorderedRuns([
        member(1, 10, 700, "run-a"),
        member(2, 10, 400, "run-a"),
        member(1, 20, 700, "run-b"),
        member(2, 20, 400, "run-b"),
      ]).size,
    ).toBe(0);
  });

  it("ignores figures on their own", () => {
    const alone: FigureNeighbours = { before: "B", beforeStart: "B", after: "A", run: { index: 1, of: 1, key: "run-a" } };
    expect(disorderedRuns([{ subject: { kind: "neighbours", ...alone }, page: 1, box: null }]).size).toBe(0);
  });
});

describe("assetsInputHash and an uncaptioned figure's neighbours", () => {
  it("changes when the prose beside an uncaptioned figure changes, beyond what its ref folds in", () => {
    const tail = " and a great deal more besides that the ref's eighty characters never reach.";
    const a = [prose(`Here is a diagram${tail}`), figure(ref(12)), prose("After.")];
    const b = [prose(`Here is a picture${tail}`), figure(ref(12)), prose("After.")];
    expect(assetsInputHash(a)).not.toBe(assetsInputHash(b));
  });

  it("does not change for an article whose figures all have captions", () => {
    const a = [prose("One thing."), figure(ref(12), "Figure 1."), prose("After.")];
    const b = [prose("Another thing entirely."), figure(ref(12), "Figure 1."), prose("After.")];
    expect(assetsInputHash(a)).toBe(assetsInputHash(b));
  });
});
