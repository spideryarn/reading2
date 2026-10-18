/**
 * **Front and back matter, held to the stored blocks** — src/matter.ts and the
 * labels baseline in src/matter-labels.ts (plan 261018a and its review's F1,
 * F3, F4 and F7). Every admission check has a case that fails it. No network:
 * the gateway is stood in for.
 */
import { describe, expect, it } from "vitest";

import {
  CLOSE_MAX_BLOCKS,
  HEADINGS_MAX,
  MAX_STRETCHES,
  type MatterAnswerItem,
  type MatterArticle,
  type MatterBlock,
  type MatterGateway,
  OPENING_MAX_BLOCKS,
  RECORD_MAX_CHARS,
  admitMatter,
  classifyMatter,
  combineMatter,
  holdStretches,
  labelKinds,
  matterInput,
  matterInputHash,
  matterWindows,
  parseMatterAnswer,
} from "../src/matter.js";
import { matterByLabels, type LabelsArticle } from "../src/matter-labels.js";
import type { Block } from "../src/types.js";

const wordsOf = (t: string) => t.split(/\s+/u).filter(Boolean).length;
const PROSE =
  "We argue that the question is open, and that it has been studied for decades by people who disagree about what the evidence shows and why it matters for the rest of the field.";
const prose = (i: number) => `${PROSE} Paragraph ${i}.`;
const REF = (i: number) => `Author ${i}, A. (2019). A study of things. Journal of Studies, 12, 1–10. doi:10.1000/x${i}`;

let counter = 0;
const block = (text: string, kind = "text", level?: number): MatterBlock & Block =>
  ({
    id: `spya-t${String(counter++).padStart(5, "0")}`,
    kind,
    ...(level === undefined ? {} : { level }),
    tag: kind === "heading" ? `h${level ?? 2}` : "p",
    text,
    words: wordsOf(text),
    html: `<p>${text}</p>`,
    gistable: true,
  }) as MatterBlock & Block;

/**
 * A paper: title, authors, an "Abstract" label and abstract, a body of 200
 * prose blocks under headings, then "Acknowledgements" and a "References"
 * heading with 30 entries.
 */
function paper(): LabelsArticle & { at: Record<string, number> } {
  const blocks: (MatterBlock & Block)[] = [];
  const at: Record<string, number> = {};
  const push = (name: string | null, b: MatterBlock & Block) => {
    if (name) at[name] = blocks.length;
    blocks.push(b);
  };
  push("title", block("Consciousness in Artificial Intelligence"));
  push("authors", block("Patrick Butlin, University of Oxford; Robert Long, Center for AI Safety (rgblong@gmail.com)"));
  push("abstractLabel", block("Abstract"));
  push("abstract", block(`${prose(0)} ${prose(1)}`));
  for (let s = 0; s < 10; s++) {
    push(s === 0 ? "intro" : null, block(`${s + 1} Section ${s + 1}`, "heading", 2));
    for (let k = 0; k < 20; k++) push(s === 0 && k === 0 ? "firstProse" : null, block(prose(s * 20 + k)));
  }
  push("ackHeading", block("Acknowledgements", "heading", 2));
  push("ack", block("We thank Jane Roe and the members of the lab for comments on drafts, and the reviewers for careful reading of the manuscript and many suggestions that improved it."));
  push("refsHeading", block("References", "heading", 2));
  for (let r = 0; r < 30; r++) push(r === 0 ? "ref0" : null, block(REF(r)));
  return { blocks, meta: { title: "Consciousness in Artificial Intelligence", authors: [{ name: "Patrick Butlin", affiliations: [] }] }, at };
}

const range = (a: MatterArticle, from: number, to: number, kinds: MatterAnswerItem["kinds"]): MatterAnswerItem => ({
  type: "range",
  from: a.blocks[from]!.id,
  to: a.blocks[to]!.id,
  kinds,
});
const section = (a: MatterArticle, h: number, kinds: MatterAnswerItem["kinds"]): MatterAnswerItem => ({
  type: "section",
  heading: a.blocks[h]!.id,
  kinds,
});
const reasons = (r: ReturnType<typeof admitMatter>) => r.dropped.map((d) => d.reason);

describe("matterWindows", () => {
  it("never overlaps and takes at most 40% of a short article each", () => {
    const a = { blocks: Array.from({ length: 5 }, (_, i) => block(prose(i))) };
    expect(matterWindows(a.blocks)).toEqual({ openEnd: 2, closeStart: 3 });
  });

  it("caps a long article's opening by blocks and characters, and its close by blocks", () => {
    const short = Array.from({ length: 1000 }, () => block("Short line"));
    const w = matterWindows(short);
    expect(w.openEnd).toBe(OPENING_MAX_BLOCKS);
    expect(w.closeStart).toBe(1000 - CLOSE_MAX_BLOCKS);
    const long = Array.from({ length: 1000 }, (_, i) => block(`${prose(i)} ${prose(i)}`));
    expect(matterWindows(long).openEnd).toBe(30); /* 6,000 characters at 200 each */
  });
});

describe("matterInputHash", () => {
  it("is versioned, stable, and changes with kind, level, words and text", () => {
    const a = paper();
    const h = matterInputHash(a.blocks);
    expect(h).toMatch(/^m1:[0-9a-f]{16}$/u);
    expect(matterInputHash(a.blocks.map((b) => ({ ...b })))).toBe(h);
    const changed = (f: (b: MatterBlock) => MatterBlock) => matterInputHash(a.blocks.map((b, i) => (i === 2 ? f(b) : b)));
    expect(changed((b) => ({ ...b, kind: "heading" }))).not.toBe(h);
    expect(changed((b) => ({ ...b, level: 3 }))).not.toBe(h);
    expect(changed((b) => ({ ...b, words: 9 }))).not.toBe(h);
    expect(changed((b) => ({ ...b, text: "Summary" }))).not.toBe(h);
  });
});

describe("matterInput", () => {
  it("sends the three parts as JSON lines, text cut, headings capped", () => {
    const a = paper();
    const input = matterInput(a);
    expect(input.split("\n")[0]).toBe("OPENING");
    expect(input).toContain("\nHEADINGS\n");
    expect(input).toContain("\nCLOSE\n");
    for (const line of input.split("\n").filter((l) => l.startsWith("{"))) {
      const o = JSON.parse(line) as { text: string };
      expect(o.text.length).toBeLessThanOrEqual(RECORD_MAX_CHARS);
    }
    /* The References heading lies between the windows here, and is listed. */
    expect(input).toContain(a.blocks[a.at.refsHeading!]!.id);

    const many: MatterBlock[] = [];
    for (let i = 0; i < 400; i++) many.push(block(`Heading ${i}`, "heading", 2), block(prose(i)));
    const headings = matterInput({ blocks: many, meta: {} }).split("\nHEADINGS\n")[1]!.split("\n\nCLOSE")[0]!.split("\n");
    expect(headings.length).toBeLessThanOrEqual(HEADINGS_MAX);
  });

  it("tells the model the page is untrusted data", () => {
    expect(JSON.stringify(matterInputRequestSystem())).toContain("UNTRUSTED DATA");
  });
});

import { MATTER_SYSTEM } from "../src/matter.js";
const matterInputRequestSystem = () => MATTER_SYSTEM;

const body = (content: string, finish = "stop") => ({ choices: [{ finish_reason: finish, message: { content } }] });

describe("parseMatterAnswer", () => {
  it("accepts ranges and sections", () => {
    const items = parseMatterAnswer(
      body(JSON.stringify({ stretches: [{ type: "range", from: "a", to: "b", kinds: ["authors"] }, { type: "section", heading: "h", kinds: ["references"] }] })),
    );
    expect(items).toHaveLength(2);
  });

  it("refuses malformed or extra output whole", () => {
    const bad = [
      { stretches: [{ type: "range", from: "a", to: "b", kinds: ["appendix"] }] },
      { stretches: [{ type: "range", from: "a", to: "b", kinds: [] }] },
      { stretches: [{ type: "range", from: "a", to: "b", kinds: ["authors"], note: "x" }] },
      { stretches: [{ type: "section", from: "a", kinds: ["references"] }] },
      { stretches: [], extra: 1 },
      { stretches: Array.from({ length: MAX_STRETCHES + 1 }, () => ({ type: "section", heading: "h", kinds: ["references"] })) },
    ];
    for (const b of bad) expect(() => parseMatterAnswer(body(JSON.stringify(b)))).toThrow(/refused/u);
    expect(() => parseMatterAnswer(body("{}", "length"))).toThrow(/refused/u);
    expect(() => parseMatterAnswer(body("not json"))).toThrow(/refused/u);
  });
});

describe("labelKinds", () => {
  it("matches whole labels, numbered or not, and only those", () => {
    expect(labelKinds("References")).toEqual(["references"]);
    expect(labelKinds("7. Acknowledgments")).toEqual(["acknowledgements"]);
    expect(labelKinds("Authors’ contributions")).toEqual(["declarations"]);
    expect(labelKinds("Acknowledgements and Funding")).toEqual(["acknowledgements", "funding"]);
    expect(labelKinds("Funding:")).toEqual(["funding"]);
    expect(labelKinds("Notes")).toBeNull();
    expect(labelKinds("References to the past in modern fiction")).toBeNull();
    expect(labelKinds("Summary")).toBeNull();
  });
});

describe("admitMatter", () => {
  it("admits a good answer", () => {
    const a = paper();
    const r = admitMatter(a, [
      range(a, a.at.title!, a.at.authors!, ["title", "authors"]),
      range(a, a.at.abstractLabel!, a.at.abstract!, ["abstract"]),
      section(a, a.at.refsHeading!, ["references"]),
    ]);
    expect(reasons(r)).toEqual([]);
    expect(r.stretches.map((s) => s.kinds)).toEqual([["title", "authors"], ["abstract"], ["references"]]);
    expect(r.stretches[2]).toEqual({ from: a.blocks[a.at.refsHeading!]!.id, to: a.blocks.at(-1)!.id, kinds: ["references"] });
  });

  it("drops an id it never showed, and one it does not know", () => {
    const a = paper();
    const mid = 100;
    const r = admitMatter(a, [range(a, mid, mid + 1, ["dates"]), { type: "range", from: "spya-nope00", to: a.blocks[1]!.id, kinds: ["authors"] }]);
    expect(r.stretches).toEqual([]);
    expect(reasons(r)).toEqual(["an id the model was not shown", "an id the model was not shown"]);
  });

  it("orders by index, never by id: from after to is dropped", () => {
    const a = paper();
    expect(reasons(admitMatter(a, [range(a, a.at.abstract!, a.at.abstractLabel!, ["abstract"])]))).toEqual(["from comes after to"]);
  });

  it("drops a range across the opening and the close, even on a short article", () => {
    const blocks = [block("Abstract"), ...Array.from({ length: 8 }, (_, i) => block(prose(i)))];
    const a = { blocks, meta: {} };
    const r = admitMatter(a, [range(a, 0, 8, ["abstract"])]);
    expect(reasons(r)).toEqual(["a range across the opening and the close"]);
  });

  it("admits a section only under a heading whose words are a known label for its kinds", () => {
    const a = paper();
    expect(reasons(admitMatter(a, [section(a, a.at.intro!, ["references"])]))).toEqual(["a section under a heading that is not a known label"]);
    expect(reasons(admitMatter(a, [section(a, a.at.refsHeading!, ["acknowledgements"])]))).toEqual(["a section whose kinds its label does not name"]);
    expect(reasons(admitMatter(a, [section(a, a.at.ackHeading!, ["references"])]))).toEqual(["a section whose kinds its label does not name"]);
    expect(reasons(admitMatter(a, [section(a, a.at.refsHeading!, ["title"])]))).toEqual(["a section may not claim these kinds"]);
    expect(reasons(admitMatter(a, [section(a, a.at.ref0!, ["references"])]))).toEqual(["a section under a block that is not a heading"]);
    /* Past the heading cap, the middle headings are not listed, so not shown. */
    const many: MatterBlock[] = [];
    for (let i = 0; i < 400; i++) many.push(block(i === 200 ? "References" : `Heading ${i}`, "heading", 2), block(REF(i)));
    const m = { blocks: many, meta: {} };
    expect(matterInput(m)).toContain(many[400]!.id); /* a known label is listed first */
    expect(reasons(admitMatter(m, [section(m, 402, ["references"])]))).toEqual(["a heading the model was not shown"]);
  });

  it("puts back matter in the trailing part and contents near the opening", () => {
    const blocks = [block("Intro", "heading", 2), block(prose(0)), block("References", "heading", 2)];
    for (let r = 0; r < 5; r++) blocks.push(block(REF(r)));
    blocks.push(block("Contents", "heading", 2));
    for (let i = 0; i < 40; i++) blocks.push(block(prose(i)));
    const a = { blocks, meta: {} };
    expect(reasons(admitMatter(a, [section(a, 2, ["references"])]))).toEqual(["a back-matter section before the trailing part"]);
    const late = paper();
    const blocks2 = [...late.blocks.slice(0, 150), block("Table of contents", "heading", 2), block("1 Introduction"), block("2 Methods"), ...late.blocks.slice(150)];
    const b = { ...late, blocks: blocks2 };
    expect(reasons(admitMatter(b, [section(b, 150, ["contents"])]))).toEqual(["a front-matter section far from the opening"]);
  });

  it("caps a range's words whatever kinds it claims", () => {
    const blocks = Array.from({ length: 200 }, (_, i) => block(prose(i)));
    for (let r = 0; r < 60; r++) blocks.push(block(`${REF(r)} ${PROSE}`));
    const a = { blocks, meta: {} };
    const r = admitMatter(a, [range(a, 200, 259, ["references"])]);
    expect(reasons(r)).toEqual(["a range over the word cap"]);
  });

  it("caps a labelled section that is not references", () => {
    const a = paper();
    const blocks = [...a.blocks.slice(0, a.at.ackHeading! + 1), ...Array.from({ length: 50 }, () => block(`We thank everyone. ${PROSE}`)), ...a.blocks.slice(a.at.refsHeading!)];
    const b = { ...a, blocks };
    expect(reasons(admitMatter(b, [section(b, a.at.ackHeading!, ["acknowledgements"])]))).toEqual(["a labelled section over the word cap"]);
  });

  it("subtracts the masthead echo, and drops a stretch that is only the echo", () => {
    const a = paper();
    const echo = new Set([a.blocks[0]!.id]);
    const r = admitMatter(a, [range(a, 0, 1, ["title", "authors"])], echo);
    expect(r.stretches).toEqual([]);
    expect(reasons(r)).toEqual(["one short block is not worth a stub"]);
    const r2 = admitMatter(a, [range(a, 0, 0, ["title"])], echo);
    expect(reasons(r2)).toEqual(["only the masthead's echo"]);
    /* With a longer byline, the stretch survives without the echo. */
    const long = paper();
    long.blocks[1] = { ...long.blocks[1]!, text: `${long.blocks[1]!.text} ${"Megan Peters, University College London;".repeat(8)}`, words: 70 };
    const r3 = admitMatter(long, [range(long, 0, 1, ["title", "authors"])], new Set([long.blocks[0]!.id]));
    expect(r3.stretches).toEqual([{ from: long.blocks[1]!.id, to: long.blocks[1]!.id, kinds: ["title", "authors"] }]);
  });

  it("does not fold one short block", () => {
    const a = paper();
    expect(reasons(admitMatter(a, [section(a, a.at.ackHeading!, ["acknowledgements"])]))).toEqual([]);
    const lone = admitMatter(a, [range(a, a.at.title!, a.at.title!, ["title"])]);
    expect(reasons(lone)).toEqual(["one short block is not worth a stub"]);
  });

  it("refuses prose claimed as authors, read on the full text past what the model saw", () => {
    const a = paper();
    expect(reasons(admitMatter(a, [range(a, a.at.intro!, a.at.firstProse! + 1, ["authors"])]))[0]).toMatch(/heading that is not a known label|no evidence/u);
    const tail = "and we then argue at length that it is not what it seems, because the evidence was gathered in ways that do not support it. ".repeat(4);
    const head = "Patrick Butlin, Robert Long, Eric Elmoznino, Yoshua Bengio, Jonathan Birch, Axel Constant, George Deane, Stephen Fleming, Chris Frith, Xu Ji, Ryota Kanai";
    expect(head.length).toBeGreaterThan(RECORD_MAX_CHARS - 60);
    const blocks = [block(`${head} ${tail}`), block(prose(1)), ...Array.from({ length: 20 }, (_, i) => block(prose(i)))];
    const b = { blocks, meta: {} };
    expect(reasons(admitMatter(b, [range(b, 0, 1, ["authors"])]))).toEqual(["block 0 shows no evidence of authors"]);
  });

  it("refuses an abstract with no abstract label: an essay's opening", () => {
    const a = paper();
    const r = admitMatter(a, [range(a, a.at.firstProse!, a.at.firstProse! + 1, ["abstract"])]);
    expect(r.stretches).toEqual([]);
    expect(reasons(r)).toEqual(["an abstract with no abstract label"]);
  });

  it("refuses a references section whose entries do not look like references", () => {
    const a = paper();
    const blocks = [...a.blocks.slice(0, a.at.refsHeading! + 1), ...Array.from({ length: 30 }, (_, i) => block(prose(i)))];
    const b = { ...a, blocks };
    expect(reasons(admitMatter(b, [section(b, a.at.refsHeading!, ["references"])]))[0]).toMatch(/no evidence of references/u);
  });

  it("cuts a references section to its references: notes between, an appendix after, and footnotes stay showing", () => {
    const a = paper();
    const notes = [block("↑ Her tutor and her husband were not related."), block("↑ Some writers give it another name.")];
    const appendix = [block("Appendix for the paper"), block("We organise the appendix into three sections:")];
    const refs = a.blocks.slice(a.at.refsHeading! + 1);
    const blocks = [...a.blocks.slice(0, a.at.refsHeading! + 1), ...refs.slice(0, 10), ...notes, ...refs.slice(10), ...appendix];
    const b = { ...a, blocks };
    const r = admitMatter(b, [section(b, a.at.refsHeading!, ["references"])]);
    const idx = (id: string) => blocks.findIndex((x) => x.id === id);
    expect(r.stretches.map((s) => [idx(s.from), idx(s.to)])).toEqual([
      [a.at.refsHeading!, a.at.refsHeading! + 10],
      [a.at.refsHeading! + 13, blocks.length - 3],
    ]);
    const withFootnote = [...a.blocks.slice(0, a.at.refsHeading! + 1), { ...block("See Mallat (1999) for an introduction."), role: "footnote" }, ...refs];
    const c = { ...a, blocks: withFootnote };
    expect(reasons(admitMatter(c, [section(c, a.at.refsHeading!, ["references"])]))).toEqual([`block ${a.at.refsHeading! + 1} is a footnote`]);
  });

  it("lets short page furniture ride in a title, authors or dates stretch, but not a sentence", () => {
    const head = [
      block("Open access"),
      block("x"),
      block("Dylan Layfield1,2,"),
      block("Published: 15 April 2023"),
      block("Scientific Reports volume 13, Article number: 6136 (2023) Cite this article and many more words of journal furniture"),
    ];
    const rest = Array.from({ length: 30 }, (_, i) => block(prose(i)));
    const a = { blocks: [...head, ...rest], meta: {} };
    expect(reasons(admitMatter(a, [range(a, 0, 4, ["authors", "dates"])]))).toEqual([]);
    const b = { blocks: [block("Open access"), block("It is what we do."), ...head.slice(2), ...rest], meta: {} };
    expect(reasons(admitMatter(b, [range(b, 0, 4, ["authors", "dates"])]))).toEqual(["block 1 shows no evidence of authors, dates"]);
    const c = { blocks: [block("Open access"), block("Hidden Costs Of Everything Under Review"), ...head.slice(2), ...rest], meta: {} };
    expect(reasons(admitMatter(c, [range(c, 0, 4, ["dates"])]))).toEqual(["block 1 shows no evidence of dates"]);
    /* A year is a dates word only in a short line: a paragraph of history is not furniture. */
    const d = { blocks: [block("Published: 15 April 2023"), block(`In December 2016, a letter was sold. ${PROSE}`), ...rest], meta: {} };
    expect(reasons(admitMatter(d, [range(d, 0, 1, ["dates"])]))).toEqual(["block 1 shows no evidence of dates"]);
  });

  it("takes a contents list with no label when its entries are the article's own headings", () => {
    const a = paper();
    const toc = ["1 Section 1", "2 Section 2 . . . . . . 4", "3 Section 3", "4 Section 4"].map((t) => block(t));
    const blocks = [...a.blocks.slice(0, 4), ...toc, ...a.blocks.slice(4)];
    const b = { ...a, blocks };
    expect(reasons(admitMatter(b, [range(b, 4, 7, ["contents"])]))).toEqual([]);
    const fake = [block("Why this matters"), block("What we found"), block("What it means"), block("What next")];
    const c = { ...a, blocks: [...a.blocks.slice(0, 4), ...fake, ...a.blocks.slice(4)] };
    expect(reasons(admitMatter(c, [range(c, 4, 7, ["contents"])]))[0]).toMatch(/no evidence of contents/u);
  });

  it("allows a structured abstract's own headings, and pools the acknowledgements family's evidence", () => {
    const blocks = [block("Abstract", "heading", 2), block("Purpose", "heading", 3), block(prose(0)), block("Results", "heading", 3), block(prose(1))];
    for (let i = 0; i < 30; i++) blocks.push(block(prose(i)));
    const a = { blocks, meta: {} };
    expect(reasons(admitMatter(a, [range(a, 0, 4, ["abstract"])]))).toEqual([]);
    const p2 = paper();
    const withFunding = [...p2.blocks.slice(0, p2.at.ack!), block("CH and EJ were supported by the Netherlands Organization for Scientific Research under grants 840.11.001 and 841.11.007."), ...p2.blocks.slice(p2.at.ack! + 1)];
    const b = { ...p2, blocks: withFunding };
    expect(reasons(admitMatter(b, [section(b, p2.at.ackHeading!, ["acknowledgements"])]))).toEqual([]);
  });

  it("refuses a range that folds a heading of the article's own", () => {
    const a = paper();
    const r = admitMatter(a, [range(a, a.at.abstractLabel!, a.at.firstProse!, ["abstract"])]);
    expect(reasons(r)[0]).toMatch(/heading that is not a known label/u);
  });

  it("sorts into document order and drops a stretch overlapping an earlier one", () => {
    const a = paper();
    const r = admitMatter(a, [
      range(a, a.at.abstractLabel!, a.at.abstract!, ["abstract"]),
      range(a, a.at.title!, a.at.abstractLabel!, ["title", "authors"]),
    ]);
    expect(r.stretches.map((s) => s.kinds)).toEqual([["title", "authors"]]);
    expect(reasons(r)).toEqual(["overlaps an earlier stretch"]);
  });

  it("leaves at least half the non-reference words showing", () => {
    /* A short article whose two windows are all thanks: folding both would fold 80% of it. */
    const blocks = Array.from({ length: 10 }, (_, i) => (i === 4 || i === 5 ? block(prose(i)) : block(`We thank many people for their support. ${PROSE}`)));
    const a = { blocks, meta: {} };
    const r = admitMatter(a, [range(a, 0, 3, ["acknowledgements"]), range(a, 6, 9, ["acknowledgements"])]);
    expect(r.stretches).toHaveLength(1);
    expect(reasons(r)).toContain("would leave less than half the article showing");
  });
});

describe("classifyMatter", () => {
  const answering = (content: string): MatterGateway => async () =>
    ({ json: body(content), answeredBy: null, generationId: null });

  it("makes the call and admits the answer", async () => {
    const a = paper();
    const v = await classifyMatter(a, new Set(), { gateway: answering(JSON.stringify({ stretches: [section(a, a.at.refsHeading!, ["references"])] })) });
    expect(v.status).toBe("ok");
    if (v.status === "ok") expect(v.stretches).toHaveLength(1);
  });

  it("fails soft on a failed call or a refused answer", async () => {
    const a = paper();
    const failing: MatterGateway = async () => {
      throw new Error("boom");
    };
    expect(await classifyMatter(a, new Set(), { gateway: failing })).toEqual({ status: "unavailable", reason: "the call failed" });
    const v = await classifyMatter(a, new Set(), { gateway: answering("nope") });
    expect(v).toMatchObject({ status: "unavailable" });
  });
});

describe("matterByLabels", () => {
  it("finds labelled matter by heading and by label paragraph, and nothing in prose", () => {
    const a = paper();
    const r = matterByLabels(a, new Set());
    expect(r.stretches.map((s) => s.kinds)).toEqual([["abstract"], ["acknowledgements"], ["references"]]);
    expect(r.stretches[0]).toEqual({ from: a.blocks[a.at.abstractLabel!]!.id, to: a.blocks[a.at.abstract!]!.id, kinds: ["abstract"] });
  });

  it("folds nothing in an essay with no labels", () => {
    const blocks = Array.from({ length: 50 }, (_, i) => block(prose(i)));
    expect(matterByLabels({ blocks, meta: {} }, new Set()).stretches).toEqual([]);
  });

  it("keeps a label paragraph's run to its evidence: an abstract does not take the introduction", () => {
    const blocks = [block("Abstract"), block(prose(0))];
    for (let i = 0; i < 20; i++) blocks.push(block(prose(i + 1)));
    for (let i = 0; i < 40; i++) blocks.push(block(prose(i + 100)));
    const r = matterByLabels({ blocks, meta: {} }, new Set());
    for (const s of r.stretches) {
      const end = blocks.findIndex((b) => b.id === s.to);
      const words = blocks.slice(0, end + 1).reduce((n, b) => n + b.words, 0);
      expect(words).toBeLessThanOrEqual(800 + blocks[0]!.words);
    }
  });
});

describe("combineMatter", () => {
  const ids = (a: MatterArticle, s: { from: string; to: string }) => [a.blocks.findIndex((b) => b.id === s.from), a.blocks.findIndex((b) => b.id === s.to)];

  it("cuts at every boundary either method drew: overlapping stretches with different kinds stay apart, the classifier's kinds where it covers", () => {
    const a = paper();
    const model = admitMatter(a, [range(a, a.at.title!, a.at.abstractLabel!, ["title", "authors"])]);
    const labels = admitMatter(a, [range(a, a.at.abstractLabel!, a.at.abstract!, ["abstract"]), section(a, a.at.refsHeading!, ["references"])]);
    expect(model.stretches).toHaveLength(1);
    const u = combineMatter(a, model, labels, new Set());
    expect(u.dropped).toEqual([]);
    expect(u.stretches.map((s) => s.kinds)).toEqual([["title", "authors"], ["abstract"], ["references"]]);
    expect(ids(a, u.stretches[0]!)).toEqual([a.at.title!, a.at.abstractLabel!]);
    expect(ids(a, u.stretches[1]!)).toEqual([a.at.abstract!, a.at.abstract!]);
  });

  it("keeps stretches that touch apart when their kinds differ, and keeps a section's shape so a reference list is not held to the range cap", () => {
    const a = paper();
    const model = admitMatter(a, [range(a, a.at.title!, a.at.authors!, ["title", "authors"]), range(a, a.at.ackHeading!, a.at.ack!, ["acknowledgements"])]);
    const labels = admitMatter(a, [range(a, a.at.abstractLabel!, a.at.abstract!, ["abstract"]), section(a, a.at.refsHeading!, ["references"])]);
    expect(model.stretches).toHaveLength(2);
    const u = combineMatter(a, model, labels, new Set());
    expect(u.dropped).toEqual([]);
    const at = (i: number) => a.blocks[i]!.id;
    expect(u.stretches).toEqual([
      { from: at(a.at.title!), to: at(a.at.authors!), kinds: ["title", "authors"] },
      { from: at(a.at.abstractLabel!), to: at(a.at.abstract!), kinds: ["abstract"] },
      { from: at(a.at.ackHeading!), to: at(a.at.ack!), kinds: ["acknowledgements"] },
      { from: at(a.at.refsHeading!), to: a.blocks.at(-1)!.id, kinds: ["references"] },
    ]);
  });

  /** Short blocks, each passing alone as the candidate says (trusted), then a long body. */
  const furniture = () => {
    const blocks = ["Title of it", "By A. Author", "Posted 3 May", "Updated 4 May", "Filed under things"].map((t) => block(t));
    for (let i = 0; i < 60; i++) blocks.push(block(prose(i)));
    return { blocks, meta: {} };
  };
  const held = (a: MatterArticle, ...cs: [number, number, MatterAnswerItem["kinds"]][]) =>
    holdStretches(a, cs.map(([start, end, kinds], item) => ({ item, start, end, kinds: [...kinds], headedBy: null, shape: "range" as const, trusted: true })), new Set());
  const spans = (a: MatterArticle, r: { stretches: { from: string; to: string; kinds: readonly string[] }[] }) =>
    r.stretches.map((s) => [...ids(a, s), s.kinds.join(",")]);

  it("re-joins segments whose kinds are equal: one stub for one kind of matter, however the methods split it", () => {
    const a = furniture();
    const model = held(a, [0, 2, ["dates"]]);
    const labels = held(a, [1, 4, ["dates"]]);
    expect(spans(a, combineMatter(a, model, labels, new Set()))).toEqual([[0, 3, "dates"]]);
  });

  it("joins a tiny segment the cut leaves to the neighbour it shares most kinds with, rather than dropping it", () => {
    const a = furniture();
    /* The labels rule's [1, 4) leaves block 2 alone between the classifier's two. */
    const model = held(a, [0, 2, ["title"]], [3, 5, ["authors", "dates"]]);
    const labels = held(a, [1, 4, ["authors"]]);
    const u = combineMatter(a, model, labels, new Set());
    expect(u.dropped).toEqual([]);
    expect(spans(a, u)).toEqual([[0, 1, "title"], [2, 4, "authors,dates"]]);
  });

  it("never joins the abstract to a neighbour that is not, and does not drop the tiny segment that leaves alone", () => {
    const a = furniture();
    const model = held(a, [1, 4, ["abstract"]]);
    const labels = held(a, [0, 2, ["title", "authors"]]);
    const u = combineMatter(a, model, labels, new Set());
    expect(u.dropped).toEqual([]);
    expect(spans(a, u)).toEqual([[0, 0, "title,authors"], [1, 3, "abstract"]]);
  });

  it("leaves apart stretches that neither overlap nor touch", () => {
    const a = paper();
    const model = admitMatter(a, [range(a, a.at.title!, a.at.authors!, ["title", "authors"])]);
    const labels = admitMatter(a, [section(a, a.at.refsHeading!, ["references"])]);
    expect(combineMatter(a, model, labels, new Set()).stretches.map((s) => s.kinds)).toEqual([["title", "authors"], ["references"]]);
  });

  it("holds a merged range to the range cap: two that pass alone can fail together", () => {
    const thanks = (i: number) => `We thank colleague number ${i} for support and comments over many years of work on this.`;
    const blocks = [block("Acknowledgements")];
    for (let i = 0; i < 200; i++) blocks.push(block(thanks(i)));
    for (let i = 0; i < 400; i++) blocks.push(block(prose(i)));
    const a = { blocks, meta: {} };
    const words = (x: number, y: number) => blocks.slice(x, y).reduce((n, b) => n + b.words, 0);
    /* Two ranges of about 1,000 words each, overlapping by two blocks. */
    let mid = 1;
    while (words(0, mid) < 1_000) mid++;
    let end = mid - 2;
    while (words(mid - 2, end) < 1_000) end++;
    const cand = (start: number, stop: number) => ({ item: 0, start, end: stop, kinds: ["acknowledgements" as const], headedBy: null, shape: "range" as const });
    const model = holdStretches(a, [cand(0, mid)], new Set());
    const labels = holdStretches(a, [cand(mid - 2, end)], new Set());
    expect(model.dropped).toEqual([]);
    expect(model.stretches).toHaveLength(1);
    expect(labels.stretches).toHaveLength(1);
    const u = combineMatter(a, model, labels, new Set());
    expect(u.stretches).toEqual([]);
    expect(u.dropped.map((d) => d.reason)).toEqual(["a range over the word cap"]);
  });
});

describe("the checks, widened where the union eval's misses showed a general gap", () => {
  const idx = (a: MatterArticle, id: string) => a.blocks.findIndex((b) => b.id === id);
  const spans = (a: MatterArticle, r: { stretches: { from: string; to: string }[] }) => r.stretches.map((s) => [idx(a, s.from), idx(a, s.to)]);

  it("takes a reproduction-permission line as dates furniture (arXiv 1706.03762's first block)", () => {
    const a = paper();
    const blocks = [
      block("Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works."),
      ...a.blocks,
    ];
    const b = { ...a, blocks };
    expect(reasons(admitMatter(b, [range(b, 0, 2, ["title", "authors", "dates"])]))).toEqual([]);
  });

  it("takes Springer Nature's publisher's note as a declaration", () => {
    const a = paper();
    const tail = [
      block("Publisher's note", "heading", 3),
      block("Springer Nature remains neutral with regard to jurisdictional claims in published maps and institutional affiliations."),
    ];
    const b = { ...a, blocks: [...a.blocks, ...tail] };
    const n = b.blocks.length;
    expect(reasons(admitMatter(b, [range(b, n - 2, n - 1, ["declarations"])]))).toEqual([]);
  });

  it("does not let a label explain what is under it: a paper's own Contributions section stays showing", () => {
    /* Tried and withdrawn (261018a): a known label explaining every short line under it folded
       plos-spya-g0zc27's own "Contributions" section and arXiv 2308.08708's executive summary. */
    const a = paper();
    const at = a.at.abstract! + 1;
    const own = [block("Contributions", "heading", 2), block("We summarized the main contributions in this work. As follows"), block(prose(1))];
    const b = { ...a, blocks: [...a.blocks.slice(0, at), ...own, ...a.blocks.slice(at)] };
    expect(reasons(admitMatter(b, [range(b, at, at + 2, ["declarations"])]))).toEqual([`block ${at + 2} shows no evidence of declarations`]);
  });

  it("keeps a reference list's own sub-headings inside its section, when what is under them is references", () => {
    const a = paper();
    const at = a.at.refsHeading!;
    const refs = a.blocks.slice(at + 1);
    const blocks = [...a.blocks.slice(0, at + 1), ...refs.slice(0, 15), block("General and cited sources", "heading", 3), ...refs.slice(15)];
    const b = { ...a, blocks };
    const r = admitMatter(b, [section(b, at, ["references"])]);
    expect(reasons(r)).toEqual([]);
    expect(spans(b, r)).toEqual([[at, blocks.length - 1]]);
    /* An appendix under the references heading is not references: its heading and prose stay showing. */
    const appendix = [block("Appendix A. Proofs", "heading", 3), block(prose(1))];
    const c = { ...a, blocks: [...a.blocks.slice(0, at + 1), ...refs.slice(0, 15), ...appendix, ...refs.slice(15)] };
    const folded = spans(c, admitMatter(c, [section(c, at, ["references"])]));
    for (const i of [at + 16, at + 17]) expect(folded.some(([x, y]) => x! <= i && i <= y!)).toBe(false);
    /* With one reference-looking line under it, the appendix heading is still not part of the list. */
    const d = { ...a, blocks: [...a.blocks.slice(0, at + 1), ...refs.slice(0, 15), block("Appendix A. Proofs", "heading", 3), block(`In 2019 we showed this. ${PROSE}`), ...refs.slice(15)] };
    expect(reasons(admitMatter(d, [section(d, at, ["references"])]))).toEqual([`block ${at + 16} is a heading that is not a known label`]);
  });

  it("keeps what a references cut leaves over when the stretch claimed other kinds too", () => {
    const a = paper();
    const blocks = [...a.blocks, block("The authors declare no competing interests of any kind."), block("All data and code are available from the authors on request.")];
    const b = { ...a, blocks };
    const n = blocks.length;
    const r = admitMatter(b, [range(b, a.at.ref0!, n - 1, ["references", "declarations"])]);
    expect(reasons(r)).toEqual([]);
    expect(spans(b, r)).toEqual([[a.at.ref0!, n - 3], [n - 2, n - 1]]);
    /* Claimed as references alone, the leftovers stay showing, as before. */
    expect(spans(b, admitMatter(b, [range(b, a.at.ref0!, n - 1, ["references"])]))).toEqual([[a.at.ref0!, n - 3]]);
  });
});

describe("matterByLabels, inline labels", () => {
  it("takes a run of paragraphs that open with an office label and a colon", () => {
    const a = paper();
    const office = [
      block("Funding: This work was supported by the National Centre for the Replacement of Animals in Research under grant NC/1234."),
      block("Competing interests: The authors have declared that no competing interests exist."),
    ];
    const at = a.at.abstract! + 1;
    const blocks = [...a.blocks.slice(0, at), ...office, ...a.blocks.slice(at)] as (MatterBlock & Block)[];
    const b = { ...a, blocks };
    const r = matterByLabels(b, new Set());
    const s = r.stretches.find((x) => x.kinds.includes("funding"));
    expect(s).toEqual({ from: office[0]!.id, to: office[1]!.id, kinds: ["funding", "declarations"] });
  });

  it("does not take a sentence that merely starts with a label word", () => {
    const a = paper();
    const at = a.at.abstract! + 1;
    const blocks = [...a.blocks.slice(0, at), block(`Funding for science: ${PROSE}`), block(`Contributions to the field: ${PROSE}`), ...a.blocks.slice(at)] as (MatterBlock & Block)[];
    const r = matterByLabels({ ...a, blocks }, new Set());
    expect(r.stretches.some((x) => x.kinds.includes("funding") || x.kinds.includes("declarations"))).toBe(false);
  });
});

/**
 * Trimmed copies of the two contents misses in the held-out eval
 * (2026-10-18): a contents run that went on past its entries into a picture
 * and its caption (simulators-spya-q2xbny), and a report's Table of Contents
 * with a List of Tables and a List of Figures under it that neither method
 * found (nist-ai-100-1-spya-a36pz9).
 */
describe("a contents stretch is a label and its entries", () => {
  const sectionBody = (from: number) => Array.from({ length: 12 }, (_, k) => block(prose(from + k)));

  /** simulators-spya-q2xbny, blocks 0–32 trimmed, then the sections its entries name. */
  function simulators(): LabelsArticle & { at: Record<string, number> } {
    const blocks: (MatterBlock & Block)[] = [];
    const at: Record<string, number> = {};
    const push = (name: string | null, b: MatterBlock & Block) => {
      if (name) at[name] = blocks.length;
      blocks.push(b);
    };
    push(null, block("Link post"));
    push("label", block("Contents"));
    /* "Meta" names no heading: the extraction kept it as a line of the Summary. */
    for (const t of ["Summary", "Meta", "The limit of sequence modeling", "Tool /​ genie GPT", "Next steps", "Appendix: Quasi-simulators"]) push(null, block(t));
    at.lastEntry = blocks.length - 1;
    push("thanks", block("Thanks to Chris Scammell, Adam Shimi, Lee Sharkey, Evan Hubinger, Nicholas Dupuis, Leo Gao, Johannes Treutlein, and Jonathan Low for feedback on drafts."));
    push(null, block("This work was carried out while at Conjecture."));
    push("media", block("", "media"));
    push("caption", block("“Moebius illustration of a simulacrum living in an AI-generated story discovering it is in a simulation” by DALL-E 2"));
    for (const [k, h] of ["Summary", "The limit of sequence modeling", "Tool /​ genie GPT", "Next steps", "Appendix: Quasi-simulators"].entries()) {
      push(null, block(h, "heading", 2));
      for (const b of sectionBody(k * 20)) push(null, b);
    }
    return { blocks, meta: { title: "Simulators", byline: "janus" }, at };
  }

  /** nist-ai-100-1-spya-a36pz9, blocks 0–46 trimmed, then the sections its entries name. */
  function nist(): LabelsArticle & { at: Record<string, number> } {
    const blocks: (MatterBlock & Block)[] = [];
    const at: Record<string, number> = {};
    const push = (name: string | null, b: MatterBlock & Block) => {
      if (name) at[name] = blocks.length;
      blocks.push(b);
    };
    push(null, block("Certain commercial entities, equipment, or materials may be identified in this document in order to describe an experimental procedure or concept adequately."));
    push("toc", block("Table of Contents", "heading", 1));
    for (const t of ["Executive Summary 1", "Part 1: Foundational Information 4", "1 Framing Risk 4", "1.1 Understanding and Addressing Risks, Impacts, and Harms 4", "2 Audience 9", "Appendix A: Descriptions of AI Actor Tasks from Figures 2 and 3 35"]) {
      push(null, block(t));
    }
    push("tables", block("List of Tables", "heading", 2));
    for (const t of ["Table 1 Categories and subcategories for the GOVERN function. 22", "Table 2 Categories and subcategories for the MAP function. 26"]) push(null, block(t));
    push("figures", block("List of Figures", "heading", 2));
    push(null, block("Fig. 1 Examples of potential harms related to AI systems. Trustworthy AI systems and their responsible use can mitigate negative risks and contribute to benefits for people, organizations, and ecosystems. 5", "caption"));
    push("lastEntry", block("Fig. 2 Lifecycle and Key Dimensions of an AI System. Modified from OECD (2022) OECD Framework for the Classification of AI systems — OECD Digital Economy Papers. The two inner circles show AI systems’ key dimensions and the outer circle shows AI lifecycle stages. Ideally, risk management efforts start with the Plan and Design function in the application context and are performed throughout the AI", "caption"));
    push("exec", block("Executive Summary", "heading", 1));
    for (const b of sectionBody(0)) push(null, b);
    for (const [k, h] of ["Part 1: Foundational Information", "1. Framing Risk", "1.1 Understanding and Addressing Risks, Impacts, and Harms", "2. Audience"].entries()) {
      push(null, block(h, "heading", k < 2 ? 1 : 2));
      for (const b of sectionBody(k * 20 + 100)) push(null, b);
    }
    return { blocks, meta: { title: "Artificial Intelligence Risk Management Framework (AI RMF 1.0)" }, at };
  }

  const spans = (a: MatterArticle, r: { stretches: { from: string; to: string; kinds: string[] }[] }) =>
    r.stretches.filter((s) => s.kinds.includes("contents")).map((s) => [a.blocks.findIndex((b) => b.id === s.from), a.blocks.findIndex((b) => b.id === s.to)]);

  it("ends a labelled contents run at its last entry: not the thanks, the picture or its caption after it", () => {
    const a = simulators();
    const want = [[a.at.label!, a.at.lastEntry!]];
    expect(spans(a, matterByLabels(a, new Set()))).toEqual(want);
    /* The model's range over all of it is cut to the entries, not taken whole. */
    const model = admitMatter(a, [range(a, a.at.label!, a.at.caption!, ["contents"])]);
    expect(spans(a, model)).toEqual(want);
    expect(spans(a, combineMatter(a, model, matterByLabels(a, new Set()), new Set()))).toEqual(want);
  });

  it("does not take a short line that names no heading and carries no number", () => {
    const a = simulators();
    const blocks = [...a.blocks];
    blocks.splice(a.at.lastEntry! + 1, 0, block("Read the whole thing slowly"));
    const b = { ...a, blocks };
    expect(spans(b, matterByLabels(b, new Set()))).toEqual([[a.at.label!, a.at.lastEntry!]]);
  });

  it("takes a Table of Contents with its List of Tables and List of Figures, by either method", () => {
    const a = nist();
    const want = [[a.at.toc!, a.at.lastEntry!]];
    expect(spans(a, matterByLabels(a, new Set()))).toEqual(want);
    expect(spans(a, admitMatter(a, [range(a, a.at.toc!, a.at.lastEntry!, ["contents"])]))).toEqual(want);
  });

  it("lets a long caption be an entry only under a list-of-figures label", () => {
    const a = nist();
    /* Without the two list labels, Fig. 1 and Fig. 2 are long captions, not entries, and the run ends at Table 2. */
    const blocks = a.blocks.filter((_, i) => i !== a.at.tables && i !== a.at.figures);
    const b = { ...a, blocks };
    const fig2 = a.at.lastEntry! - 2;
    expect(spans(b, admitMatter(b, [range(b, a.at.toc!, fig2, ["contents"])]))).toEqual([[a.at.toc!, fig2 - 2]]);
  });

  it("knows List of Tables and List of Figures as contents labels, and not a list of abbreviations", () => {
    expect(labelKinds("List of Tables")).toEqual(["contents"]);
    expect(labelKinds("List of Figures")).toEqual(["contents"]);
    expect(labelKinds("List of Abbreviations")).toBeNull();
  });
});
