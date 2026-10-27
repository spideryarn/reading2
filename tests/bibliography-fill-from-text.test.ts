/**
 * A work the body cites author–year and the model did not list gets a row from
 * the text — plan 261027b, feedback spya-ez2vus: LeCun's paragraph cites Craik,
 * Bryson and Levine, and the model listed the first two.
 */
import { describe, expect, it } from "vitest";
import { type Bibliography, buildBibliography, coverageOf, emptyDrops, idsByKey, MAX_CITATIONS, noScoreDrops } from "../src/bibliography.js";
import { MAX_TEXT_ROWS } from "../src/types.js";
import type { Block } from "../src/types.js";

const LEVINE =
  "The idea that humans, animals, and intelligent systems use world models goes back a long time in psychology (Craik, 1943). The use of forward models that predict the next state of the world as a function of the current state and the action being considered has been standard procedure in optimal control since the 1950s (Bryson and Ho, 1969) and bears the name model-predictive control. The use of differentiable world models in reinforcement learning has long been neglected but is making a comeback (see for example (Levine, 2021))";

function block(id: string, text: string, over: Partial<Block> = {}): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: `<p>${text}</p>`, gistable: true, ...over } as Block;
}

function build(works: unknown[], blocks: Block[], capped = false, previous: Bibliography | null = null) {
  const drops = emptyDrops();
  const inherit = previous ? idsByKey(previous, { blocks, referenceList: null }) : null;
  const bibliography = buildBibliography(
    { capped, works },
    { power: "standard", slug: "t", blocks, sourceHash: "h.h", elapsedMs: 1, inherit, drops, scores: noScoreDrops() },
  );
  return { bibliography, rows: bibliography.citations, drops };
}

const row = (title: string, authors: string, year: string, blockId: string, quote: string) => ({
  title,
  authors,
  year,
  why: "It supports a step.",
  relevance: 0.5,
  influence: null,
  mentions: [{ block: blockId, quote }],
});

const CRAIK = row("Craik (1943)", "Craik", "1943", "spya-p00001", "Craik, 1943");
const BRYSON = row("Applied Optimal Control", "Bryson, Ho", "1969", "spya-p00001", "Bryson and Ho, 1969");

describe("a work cited in the text that the model did not list", () => {
  it("gets a row of its own, quoted from the article", () => {
    const { rows } = build([CRAIK, BRYSON], [block("spya-p00001", LEVINE)]);
    expect(rows.map((r) => r.title)).toEqual(["Craik (1943)", "Applied Optimal Control", "Levine (2021)"]);
    const levine = rows[2]!;
    expect(levine).toMatchObject({
      authors: "Levine",
      year: "2021",
      listedBy: "text",
      linkFrom: "search",
      mentions: [{ blockId: "spya-p00001", quote: "Levine, 2021", start: LEVINE.indexOf("Levine, 2021") }],
      citedAt: ["spya-p00001"],
      firstCited: "spya-p00001",
      citedInBody: true,
    });
    expect(levine.why).toBeUndefined();
    expect(levine.relevance).toBeUndefined();
    expect(levine.influence).toBeUndefined();
  });

  it("is not added for a work a model row already covers", () => {
    const text =
      "Models came back (Ha and Schmidhuber, 2018; LeCun et al., 2006), as LeCun et al. (2006) argued, and (Hafner et al., 2020).";
    const { rows } = build(
      [
        row("World Models", "Ha, Schmidhuber", "2018", "spya-p00001", "Ha and Schmidhuber, 2018"),
        /* A full name in the authors, and no mention on the citing words. */
        { ...row("A Tutorial on Energy-Based Learning", "Yann LeCun", "2006", "spya-p00001", "argued"), mentions: [{ block: "spya-p00001", quote: "argued" }] },
        /* Authors the model left out; the mention is the citing words. */
        { ...row("Dream to Control", "", "", "spya-p00001", "Hafner et al., 2020"), authors: undefined, year: undefined },
      ],
      [block("spya-p00001", text)],
    );
    expect(rows.map((r) => `${r.title}:${r.listedBy ?? "model"}`)).toEqual(["World Models:model", "A Tutorial on Energy-Based Learning:model", "Dream to Control:model"]);
  });

  it("takes every place the work is cited, up to three, as its mentions", () => {
    const blocks = [
      block("spya-p00001", "First (Levine, 2021)."),
      block("spya-p00002", "Second, see (Levine, 2021)."),
      block("spya-p00003", "Third: Levine (2021)."),
      block("spya-p00004", "Fourth (Levine, 2021; Craik, 1943)."),
      block("spya-p00005", "Fifth (Bryson and Ho, 1969)."),
    ];
    const { rows } = build(
      [{ ...CRAIK, mentions: [{ block: "spya-p00004", quote: "Craik, 1943" }] }, { ...BRYSON, mentions: [{ block: "spya-p00005", quote: "Bryson and Ho, 1969" }] }],
      blocks,
    );
    const levine = rows.find((r) => r.title === "Levine (2021)")!;
    expect(levine.mentions.map((m) => m.blockId)).toEqual(["spya-p00001", "spya-p00002", "spya-p00003"]);
  });

  it("reads only the body: not a note, not a reference entry, not a heading", () => {
    const { rows } = build(
      [CRAIK],
      [
        block("spya-p00001", "As shown (Craik, 1943)."),
        block("spya-h00001", "Results (Levine, 2021)", { kind: "heading", tag: "h2" }),
        block("spya-r00001", "Smith, J. (2019) A book (Jones, 2018).", { role: "reference" }),
        block("spya-n00001", "1 See (Olshausen and Field, 1996).", { role: "footnote", noteId: "n1" }),
      ],
    );
    expect(rows.map((r) => r.title)).toEqual(["Craik (1943)"]);
  });

  /* A letters-only surname for every number: Abaa, Abab, … */
  const surname = (i: number) => `Ab${String.fromCharCode(97 + Math.floor(i / 26) % 26)}${String.fromCharCode(97 + (i % 26))}`;
  const citing = (n: number) =>
    Array.from({ length: n }, (_, i) => block(`spya-q${String(i).padStart(5, "0")}`, `A claim (${surname(i)}, 2001).`));

  it("does not count against the model's cap, and leaves `capped` the model's word", () => {
    const { bibliography } = build([CRAIK, BRYSON], [block("spya-p00001", LEVINE)]);
    expect(bibliography.capped).toBe(false);
    const { rows, bibliography: big } = build([{ ...CRAIK, mentions: [{ block: "spya-q00000", quote: "A claim" }] }], citing(MAX_CITATIONS + 5));
    expect(rows.filter((r) => r.listedBy === "text")).toHaveLength(MAX_CITATIONS + 5);
    expect(big.capped).toBe(false);
  });

  it("stops at its own ceiling, and counts the rest", () => {
    const { rows, drops } = build([{ ...CRAIK, mentions: [{ block: "spya-q00000", quote: "A claim" }] }], citing(MAX_TEXT_ROWS + 7));
    const fromText = rows.filter((r) => r.listedBy === "text");
    expect(fromText).toHaveLength(MAX_TEXT_ROWS);
    expect(fromText[0]!.title).toBe("Abaa (2001)");
    expect(drops.textOverCap).toBe(7);
  });

  it("does not stand in for a model answer none of whose works could be anchored", () => {
    expect(() => build([{ ...CRAIK, mentions: [{ block: "spya-p00001", quote: "not in the block" }] }], [block("spya-p00001", LEVINE)])).toThrow(
      /none of them could be anchored/,
    );
  });

  it("is listed when a model mention spans it and another citation, but the model row is the other", () => {
    const text = "Advances came from robotics (Chua et al., 2018; Yu et al., 2020; Hafner et al., 2018, 2020).";
    const { rows } = build(
      [
        { ...row("Deep RL in a handful of trials", "Chua", "2018", "spya-p00001", "Chua et al., 2018; Yu et al., 2020"), why: "Robotics." },
        row("Learning latent dynamics", "Hafner", "2018", "spya-p00001", "Hafner et al., 2018, 2020"),
      ],
      [block("spya-p00001", text)],
    );
    expect(rows.filter((r) => r.listedBy === "text").map((r) => r.title)).toEqual(["Yu et al. (2020)", "Hafner et al. (2020)"]);
  });

  it("is listed when another row's compound footnote happens to name it", () => {
    const text = "Advances came from robotics (Chua et al., 2018; Yu et al., 2020; Hafner et al., 2018).";
    const footnote = "Chua et al. (2018), Deep reinforcement learning; Yu et al. (2020), Meta-learning.";
    const { rows } = build(
      [
        {
          ...row("Deep RL in a handful of trials", "Chua", "2018", "spya-p00001", "Chua et al., 2018"),
          mentions: undefined,
          reference: { block: "spya-n00001", quote: footnote },
        },
      ],
      [
        block("spya-p00001", text),
        block("spya-n00001", footnote, { role: "footnote", noteId: "n1" }),
      ],
    );
    expect(rows.filter((r) => r.listedBy === "text").map((r) => r.title)).toEqual([
      "Yu et al. (2020)",
      "Hafner et al. (2018)",
    ]);
  });

  it("is listed when it is only the co-author of another row's entry", () => {
    const text = "Results followed (Chua, 2020; Yu, 2020; Hafner, 2018).";
    const entry = "Chua, C. and Yu, Y. (2020). Work A.";
    const { rows } = build(
      [
        {
          ...row("Work A", "Chua", "2020", "spya-r00001", entry),
          mentions: undefined,
          reference: { block: "spya-r00001", quote: entry },
        },
      ],
      [block("spya-p00001", text), block("spya-r00001", entry, { role: "reference" })],
    );
    expect(rows.filter((r) => r.listedBy === "text").map((r) => r.title)).toEqual([
      "Yu (2020)",
      "Hafner (2018)",
    ]);
  });

  it("does not turn obvious titles, products, events or journal names into rows", () => {
    const text =
      "Prior work (Smith, 2020; Jones, 2021; Brown, 2022) set the context. " +
      "Windows (2000) followed World War (1914, 1918), while the journal reported its figures (Nature, 2020).";
    const { rows } = build([], [block("spya-p00001", text)]);
    expect(rows.map((r) => r.title)).toEqual(["Smith (2020)", "Jones (2021)", "Brown (2022)"]);
  });

  it("is not listed beside a model row whose year carries a letter the text leaves off", () => {
    const { rows } = build(
      [row("A Tutorial on Energy-Based Learning", "LeCun", "2006a", "spya-p00001", "a tutorial")],
      [block("spya-p00001", "Energy, as a tutorial (LeCun et al., 2006) put it.")],
    );
    expect(rows.map((r) => r.listedBy ?? "model")).toEqual(["model"]);
  });

  it("is counted by the coverage witness", () => {
    const blocks = [block("spya-p00001", LEVINE)];
    const { bibliography } = build([CRAIK, BRYSON], blocks);
    expect(coverageOf(blocks, bibliography)).toMatchObject({ authorYear: 3, authorYearFilled: 1 });
  });
});

describe("a work that moves between code's row and the model's keeps its id", () => {
  const blocks = [block("spya-p00001", LEVINE)];
  const LEVINE_MODEL = row("Reinforcement learning as trajectory optimization", "Sergey Levine", "2021", "spya-p00001", "Levine, 2021");
  const id = (b: Bibliography, title: string) => b.citations.find((c) => c.title === title)?.id;

  it("from code's row to the model's, and back", () => {
    const first = build([CRAIK, BRYSON], blocks).bibliography;
    const codeId = id(first, "Levine (2021)");
    expect(codeId).toBeDefined();
    const second = build([CRAIK, BRYSON, LEVINE_MODEL], blocks, false, first).bibliography;
    expect(second.citations.filter((c) => c.listedBy === "text")).toEqual([]);
    expect(id(second, LEVINE_MODEL.title)).toBe(codeId);
    const third = build([CRAIK, BRYSON], blocks, false, second).bibliography;
    expect(id(third, "Levine (2021)")).toBe(codeId);
  });

  it("not when the surname and year name two works on one side", () => {
    const text = "Models (Ha and Schmidhuber, 2018a; Ha and Schmidhuber, 2018b).";
    const two = [block("spya-p00001", text)];
    const first = build([], two).bibliography;
    expect(first.citations.map((c) => c.title)).toEqual(["Ha and Schmidhuber (2018a)", "Ha and Schmidhuber (2018b)"]);
    const second = build([row("World Models", "Ha, Schmidhuber", "2018", "spya-p00001", "Models")], two, false, first).bibliography;
    expect(first.citations.map((c) => c.id)).not.toContain(id(second, "World Models"));
  });

  it("does not move a suffixed year's id to a different suffixed work", () => {
    const firstBlocks = [block("spya-p00001", "Earlier work (Smith et al., 2020a).")];
    const first = build([], firstBlocks).bibliography;
    const oldA = id(first, "Smith et al. (2020a)");
    const secondBlocks = [block("spya-p00001", "Earlier works (Smith, 2020a; Smith, 2020b).")];
    const second = build(
      [row("Work B", "Smith", "2020b", "spya-p00001", "Smith, 2020b")],
      secondBlocks,
      false,
      first,
    ).bibliography;
    expect(id(second, "Work B")).not.toBe(oldA);
  });

  it("uses the verified citation before an author-year-shaped model title", () => {
    const blocks = [block("spya-p00001", "Prior work (Smith, 2020; Jones, 2021; Brown, 2022).")];
    const first = build(
      [{ ...row("Roberts (1999)", "", "", "spya-p00001", "Smith, 2020"), authors: undefined, year: undefined }],
      blocks,
    ).bibliography;
    const old = id(first, "Roberts (1999)");
    const second = build([], blocks, false, first).bibliography;
    expect(id(second, "Smith (2020)")).toBe(old);
  });
});

describe("a lone name before a year, in an article that does not cite author–year", () => {
  it("is a title, not a citation: no row", () => {
    const { rows } = build(
      [],
      [
        block("spya-p00001", "Rimbaud later wrote Voyelles (1871), which was perhaps more famous."),
        block("spya-p00002", "Anna Ferrara's The Woman Who Tried to Be Normal (2018) is a novel."),
      ],
    );
    expect(rows).toEqual([]);
  });

  it("is a citation in an article that cites author–year elsewhere", () => {
    const { rows } = build(
      [],
      [block("spya-p00001", "As Levine (2021) reviews, models came back (Craik, 1943; Bryson and Ho, 1969; Hafner et al., 2018).")],
    );
    expect(rows.map((r) => r.title)).toContain("Levine (2021)");
  });
});
