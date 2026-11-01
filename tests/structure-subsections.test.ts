/**
 * **Structure's stage 2** — which sections get sub-sections, where each one
 * starts, and what a wrong answer costs. Plan
 * docs/plans/261101d-structure-fourth-level-staged-second-call.md.
 */
import { describe, expect, it } from "vitest";
import { NeedsAnotherWindow } from "../src/another-window.js";
import { buildTree, type ModelNode } from "../src/structure.js";
import {
  addSubsections,
  levelsBelow,
  planSubsections,
  readSubsectionsAnswer,
  sectionNumber,
  subsectionsEnabled,
  subsectionsRequest,
  type SubsectionsRequest,
} from "../src/structure-subsections.js";
import { assertTreeSound } from "../src/tree-invariants.js";
import type { Block, Tree } from "../src/types.js";

const id = (n: number) => `spya-b${n.toString().padStart(5, "0")}`;
const GIST = "A gist long enough to pass the floor of words here.";

/**
 * `h3:2.4 Other` is a heading; `h3!:…` a NOT-GISTABLE heading; `S:…` a
 * supplement paragraph; anything else a paragraph. A closing part is added so
 * no fixture's own part is the root's only child (buildTree splices a unary rung).
 */
function blocks(spec: string[]): Block[] {
  return [...spec, "h2:Coda", "end"].map((s, n) => {
    const m = /^h(\d)(!?):(.*)$/.exec(s);
    const supplement = s.startsWith("S:");
    const text = m ? m[3]! : supplement ? s.slice(2) : s;
    return {
      id: id(n),
      tag: m ? `h${m[1]}` : "p",
      kind: m ? "heading" : "text",
      ...(m ? { level: Number(m[1]) } : {}),
      text,
      words: text.split(/\s+/).length,
      html: `<p>${text}</p>`,
      gistable: !(m && m[2] === "!"),
      ...(supplement ? { treatment: "supplement" } : {}),
    } as Block;
  });
}

const node = (title: string, from: number, to: number, children?: ModelNode[], sourceHeading?: string): ModelNode => ({
  title,
  gist: `${title} gist`,
  range: [id(from), id(to)],
  ...(sourceHeading ? { sourceHeading } : {}),
  ...(children ? { children } : {}),
});

function tree(body: Block[], parts: ModelNode[]): Tree {
  const n = body.length;
  return buildTree(node("Root", 0, n - 1, [...parts, node("Coda", n - 2, n - 1)]), {}, body, "t");
}

/** A part of two sections: the one under test, `[from, to]`, and a short tail section. */
function part(body: Block[], title: string, from: number, to: number, sourceHeading?: string, partFrom = from): ModelNode {
  return node("Part", partFrom, to + 2, [
    ...(partFrom < from ? [node("Lead", partFrom, from - 1)] : []),
    node(title, from, to, undefined, sourceHeading),
    node("Tail", to + 1, to + 2, undefined, body[to + 1]!.text),
  ]);
}

const starts = (t: Tree, body: Block[]) => planSubsections(t, body).plans.map((p) => p.children.map((c) => [c.lo, c.heading?.text ?? null]));

/** The report's paper, cut down: 2.4 with its six numbered sub-headings, (a)–(c) tagged h2 inside 2.4.5, and 2.5 beside it. */
const PAPER = blocks([
  "h2:2 Scientific Theories", "intro", // 0-1
  "h3:2.4 Other Theories", "p", "p", // 2-4
  "h4:2.4.1 Attention Schema", "p", // 5-6
  "h4:2.4.2 Predictive Processing", "p", // 7-8
  "h4:2.4.3 Midbrain", "p", // 9-10
  "h4:2.4.4 Associative Learning", "p", // 11-12
  "h4:2.4.5 Agency and Embodiment", "p", "h2:2.4.5(a) Agency", "p", "h2:2.4.5(b) Embodiment", "p", "h2:2.4.5(c) Both", "p", // 13-20
  "h4:2.4.6 Time and Recurrence", "p", // 21-22
  "h3:2.5 Indicators", "p", "p", // 23-25
]);
const paperTree = (sectionFrom = 2) =>
  tree(PAPER, [node("Theories", 0, 25, [
    ...(sectionFrom > 0 ? [node("Intro", 0, sectionFrom - 1)] : []),
    node("2.4 Other", sectionFrom, 22, undefined, "2.4 Other Theories"),
    node("2.5", 23, 25, undefined, "2.5 Indicators"),
  ])]);

describe("numbering", () => {
  it("reads a section number, and nothing that only looks like one", () => {
    expect(sectionNumber("2.4.1 Attention")).toEqual({ path: [2, 4, 1], letter: false });
    expect(sectionNumber("2.4.5(a) Agency")).toEqual({ path: [2, 4, 5], letter: true });
    expect(sectionNumber("1. Introduction")).toEqual({ path: [1], letter: false });
    expect(sectionNumber("2020 Results")).toBeNull();
    expect(sectionNumber("3D printing")).toBeNull();
    expect(sectionNumber("Introduction")).toBeNull();
  });

  it("measures every heading from the section's own, by number when both have one", () => {
    const [own, sub, letter, sibling, foreign, runIn] = blocks(["h3:2.4 Other", "h4:2.4.1 A", "h2:2.4.5(a) B", "h3:2.5 C", "h4:3.1.1 D", "h4:Run-in"]);
    expect(levelsBelow(sub!, own!)).toBe(1);
    expect(levelsBelow(letter!, own!)).toBe(2);
    expect(levelsBelow(sibling!, own!)).toBe(0);
    expect(levelsBelow(foreign!, own!)).toBe("incompatible");
    expect(levelsBelow(runIn!, own!)).toBe(1);
  });
});

describe("planSubsections", () => {
  it("divides the paper's 2.4 at its six 2.4.k, keeps (a)–(c) inside 2.4.5, and leaves 2.5 alone", () => {
    const { plans } = planSubsections(paperTree(), PAPER);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.children.map((c) => [c.lo, c.hi, c.heading?.text ?? null])).toEqual([
      [2, 4, null],
      [5, 6, "2.4.1 Attention Schema"],
      [7, 8, "2.4.2 Predictive Processing"],
      [9, 10, "2.4.3 Midbrain"],
      [11, 12, "2.4.4 Associative Learning"],
      [13, 20, "2.4.5 Agency and Embodiment"],
      [21, 22, "2.4.6 Time and Recurrence"],
    ]);
  });

  it("allows the part's heading before the section's own, when the section starts at the part", () => {
    const { plans } = planSubsections(paperTree(0), PAPER);
    expect(plans[0]!.children[0]).toMatchObject({ lo: 0, heading: null });
    expect(plans[0]!.children).toHaveLength(7);
  });

  it("never demotes a sibling heading stage 1 swallowed", () => {
    const t = tree(PAPER, [node("Theories", 0, 25, [node("Intro", 0, 1), node("2.4 and 2.5", 2, 25, undefined, "2.4 Other Theories")])]);
    const { plans, skipped } = planSubsections(t, PAPER);
    expect(plans).toHaveLength(0);
    expect(skipped["holds-sibling-heading"]).toBe(1);
  });

  it("refuses a number that is not inside the section's own", () => {
    const body = blocks(["h3:2.4 Other", "p", "h4:2.4.1 A", "p", "h4:3.1.1 B", "p", "h3:2.5 Next", "p"]);
    const t = tree(body, [part(body, "2.4", 0, 5, "2.4 Other")]);
    expect(planSubsections(t, body).skipped["incompatible-numbering"]).toBe(1);
  });

  it("does not go round in a circle on mixed numbered and unnumbered headings", () => {
    /* Pairwise, 2.1.1 > 2.2 by number, 2.2 <h4> > Aside <h3> by tag, Aside <h3> > 2.1.1 <h2> by tag. */
    const body = blocks(["h1:2 Part", "p", "h2:2.1.1 A", "p", "h4:2.2 B", "p", "h3:Aside", "p", "h1:3 Next", "p"]);
    const t = tree(body, [part(body, "2", 0, 7, "2 Part")]);
    const { plans, skipped } = planSubsections(t, body);
    // 2.2 is one below "2", 2.1.1 two below, Aside (by tag) two below: the immediate one is 2.2 alone.
    expect(plans.map((p) => p.children.map((c) => c.lo))).toEqual([[0, 4]]);
    expect(skipped["holds-sibling-heading"]).toBe(0);
  });

  it("skips a section that starts mid-run at a paragraph: it has no heading to measure from", () => {
    const body = blocks(["h3:Methods", "p", "p", "h4:A", "p", "h4:B", "p", "h3:Next", "p"]);
    const t = tree(body, [node("Part", 0, 8, [node("Methods", 0, 1), node("Methods, later", 2, 6), node("Next", 7, 8)])]);
    expect(planSubsections(t, body).skipped["no-own-heading"]).toBe(1);
  });

  it("reads a part with no heading of its own: its first section's heading is the section's", () => {
    const body = blocks(["h3:Methods", "p", "h4:Data", "p", "h4:Model", "p", "h3:Results", "p", "p"]);
    const t = tree(body, [node("Part", 0, 8, [node("Methods", 0, 5), node("Results", 6, 8)])]);
    expect(starts(t, body)).toEqual([[[0, null], [2, "Data"], [4, "Model"]]]);
  });

  it("never takes the part's heading for its first section's, even at the sections' own tag", () => {
    /* Paul Graham's collection: "2. For startup founders" <h2>, then the essay "Before the Startup" <h2>. */
    const body = blocks(["h2:2. For founders", "p", "h2:Before the Startup", "p", "p", "h2:What We Look For", "p", "p"]);
    const t = tree(body, [node("Part", 0, 7, [node("Before", 0, 4), node("What", 5, 7)])]);
    expect(planSubsections(t, body).plans).toHaveLength(0);
  });

  it("does not let an odd sibling's level hide a section's own first-block heading", () => {
    /* arxiv-2602: stage 1 made a sibling section at an h4; 3.2's own h3 is its first block. */
    const body = blocks(["h2:3 Bench", "p", "h3:3.2 Generation", "p", "h4:Requirements", "p", "h4:Filtering", "p", "h4:Overview", "p"]);
    const t = tree(body, [node("Part", 0, 9, [node("Bench", 0, 1), node("3.2", 2, 7), node("Overview", 8, 9)])]);
    expect(starts(t, body)).toEqual([[[2, null], [4, "Requirements"], [6, "Filtering"]]]);
  });

  it("is not fooled by two headings with the same text: position decides", () => {
    const body = blocks(["h3:Methods", "p", "h4:Methods", "p", "h4:Model", "p", "h3:Results", "p"]);
    const t = tree(body, [part(body, "Methods", 0, 5)]);
    expect(starts(t, body)).toEqual([[[0, null], [2, "Methods"], [4, "Model"]]]);
  });

  it("skips a section that holds supplement blocks", () => {
    const body = blocks(["h3:Notes", "p", "h4:A", "S:note", "h4:B", "S:note", "h3:Next", "p"]);
    const t = tree(body, [part(body, "Notes", 0, 5, "Notes")]);
    expect(planSubsections(t, body).skipped["holds-supplement"]).toBe(1);
  });

  it("treats a NOT-GISTABLE body heading as a boundary", () => {
    const body = blocks(["h3:Methods", "p", "h4!:A", "p", "h4:B", "p", "h3:Next", "p"]);
    const t = tree(body, [part(body, "Methods", 0, 5, "Methods")]);
    expect(starts(t, body)).toEqual([[[0, null], [2, "A"], [4, "B"]]]);
  });

  it("makes no empty opening when only headings come before the first sub-heading", () => {
    const body = blocks(["h3:Methods", "h4:Data", "p", "h4:Model", "p", "h3:Next", "p"]);
    const t = tree(body, [part(body, "Methods", 0, 4, "Methods")]);
    expect(starts(t, body)).toEqual([[[0, "Data"], [3, "Model"]]]);
  });

  it("divides at one sub-heading when the section has prose before it, and not when it has none", () => {
    const withProse = blocks(["h3:Methods", "p", "p", "h4:Caveats", "p", "h3:Next", "p"]);
    expect(starts(tree(withProse, [part(withProse, "Methods", 0, 4, "Methods")]), withProse)).toEqual([[[0, null], [3, "Caveats"]]]);
    const without = blocks(["h3:Methods", "h4:Caveats", "p", "h3:Next", "p"]);
    const t = tree(without, [part(without, "Methods", 0, 2, "Methods")]);
    expect(planSubsections(t, without).skipped["one-child"]).toBe(1);
  });

  it("never touches a part whose children are leaves", () => {
    const body = blocks(["h2:Part", "p", "h4:A", "p", "h4:B", "p"]);
    const t = tree(body, [node("Part", 0, 5)]);
    expect(planSubsections(t, body).plans).toHaveLength(0);
  });
});

describe("readSubsectionsAnswer", () => {
  const body = blocks(["h3:A", "p", "h4:A1", "p", "h3:B", "p", "h4:B1", "p"]);
  const t = tree(body, [node("Part", 0, 7, [node("A", 0, 3, undefined, "A"), node("B", 4, 7, undefined, "B")])]);
  const { plans } = planSubsections(t, body);

  it("reads by section number, costs only the section whose count is wrong, and titles a headed child from its heading", () => {
    const raw = JSON.stringify({
      sections: [
        { section: 2, subsections: [{ title: "x", gist: GIST }] },
        { section: 1, subsections: [{ title: "Opening of A", gist: GIST }, { title: "Something else", gist: GIST }] },
      ],
    });
    const got = readSubsectionsAnswer(raw, plans);
    expect(got[0]!.map((c) => c.title)).toEqual(["Opening of A", "A1"]);
    expect(got[1]).toBeNull();
  });

  it("refuses a gist out of bounds", () => {
    const raw = JSON.stringify({ sections: [{ section: 1, subsections: [{ title: "Opening", gist: "Too short." }, { title: "A1", gist: GIST }] }] });
    expect(readSubsectionsAnswer(raw, plans)[0]).toBeNull();
  });

  it("throws for an answer that is not the shape at all", () => {
    expect(() => readSubsectionsAnswer(`{"nope": 1}`, plans)).toThrow();
  });
});

describe("addSubsections", () => {
  const body = PAPER;
  const t = paperTree();
  const answer = (r: SubsectionsRequest) =>
    JSON.stringify({ sections: r.plans.map((p, i) => ({ section: i + 1, subsections: p.children.map((c) => ({ title: c.heading?.text ?? "Scope", gist: GIST })) })) });

  it("adds depth-3 sub-sections under the section, keeps everything stage 1 made, and passes the invariants", async () => {
    const { root, stats } = await addSubsections({ tree: t, body, slug: "t", execute: async (r) => answer(r) });
    expect(stats).toMatchObject({ eligible: 1, made: 1, added: 7, calls: 1, failedSections: 0 });
    const deeper = buildTree(root!, {}, body, "t");
    assertTreeSound(body, deeper);
    const subs = Object.values(deeper.nodes).filter((n) => n.depth === 3 && n.children.length > 0);
    expect(subs).toHaveLength(7);
    expect(subs.every((n) => deeper.nodes[n.parent!]!.title === "2.4 Other")).toBe(true);
    expect(subs.every((n) => n.children.every((c) => deeper.nodes[c]!.children.length === 0))).toBe(true);
    expect(subs.slice(1).map((n) => n.sourceHeading)).toEqual(subs.slice(1).map((n) => n.title));
    const fields = (n: Tree["nodes"][string]) => [n.range.join(), n.depth, n.title, n.gist, n.question, n.sourceHeading];
    const before = Object.values(t.nodes).filter((n) => n.children.length > 0).map(fields);
    const after = new Map(Object.values(deeper.nodes).filter((n) => n.children.length > 0 && n.depth < 3).map((n) => [n.range.join(), fields(n)]));
    for (const b of before) expect(after.get(b[0] as string)).toEqual(b);
    const leaves = (x: Tree) => Object.values(x.nodes).filter((n) => n.children.length === 0).map((n) => n.range.join()).sort();
    expect(leaves(deeper)).toEqual(leaves(t));
  });

  it("draws a failed call once more, then leaves its sections as they were", async () => {
    let calls = 0;
    const { root, stats } = await addSubsections({ tree: t, body, slug: "t", execute: async () => { calls++; throw new Error("boom"); } });
    expect(root).toBeNull();
    expect(calls).toBe(2);
    expect(stats).toMatchObject({ failedCalls: 1, failedSections: 1, made: 0 });
  });

  it("hands the job back when the deadline is close and the queue has another window", async () => {
    await expect(
      addSubsections({ tree: t, body, slug: "t", deadlineAt: Date.now() + 5_000, window: { number: 1, anotherAvailable: true }, execute: async (r) => answer(r) }),
    ).rejects.toBeInstanceOf(NeedsAnotherWindow);
  });

  it("on the last window, keeps stage 1's tree and says it ran out of time", async () => {
    const { root, stats } = await addSubsections({ tree: t, body, slug: "t", deadlineAt: Date.now() + 5_000, window: { number: 3, anotherAvailable: false }, execute: async (r) => answer(r) });
    expect(root).toBeNull();
    expect(stats.outOfTime).toBe(true);
  });

  it("states each section's fixed count in the prompt and asks for no block id", () => {
    const { plans } = planSubsections(t, body);
    const r = subsectionsRequest(plans, body);
    const user = r.params.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("");
    expect(user).toContain("Sub-sections (7)");
    expect(JSON.stringify(r.params)).not.toContain('"start"');
  });
});

describe("the switch", () => {
  it("is on unless SPIDERYARN_SUBSECTIONS says 0 or false", () => {
    const was = process.env.SPIDERYARN_SUBSECTIONS;
    try {
      delete process.env.SPIDERYARN_SUBSECTIONS;
      expect(subsectionsEnabled()).toBe(true);
      process.env.SPIDERYARN_SUBSECTIONS = "0";
      expect(subsectionsEnabled()).toBe(false);
      process.env.SPIDERYARN_SUBSECTIONS = "false";
      expect(subsectionsEnabled()).toBe(false);
    } finally {
      if (was === undefined) delete process.env.SPIDERYARN_SUBSECTIONS;
      else process.env.SPIDERYARN_SUBSECTIONS = was;
    }
  });
});
