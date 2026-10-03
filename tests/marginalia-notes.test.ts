/**
 * Marginalia's pure half — which note goes beside which block, how notes
 * are kept from overlapping, and what the head says.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 */
import { describe, expect, it } from "vitest";
import { blockIndex } from "../src/section-path.js";
import type { Arc, Block, CitedWork, FaqQuestion, Idea, Tree, TreeNode } from "../src/types.js";
import {
  type MarginClaim,
  type MarginComment,
  marginaliaNotes,
  arcAt,
  headPath,
  layoutNotes,
  type MarginEntry,
} from "../src/web/marginalia/notes.js";

const entryId = (e: MarginEntry) => (e.as === "question" ? e.asked.id : e.comment.id);

const ids = ["spya-aaaaa1", "spya-aaaaa2", "spya-aaaaa3", "spya-aaaaa4", "spya-aaaaa5", "spya-aaaaa6"];
/* The first block is a heading, as a part's first block usually is. */
const blocks = ids.map((id, i) => ({
  id,
  text: id,
  html: `<p>${id}</p>`,
  kind: i === 0 ? "heading" : "text",
  gistable: i !== 0,
  words: i === 0 ? 2 : 40,
})) as unknown as Block[];
const index = blockIndex(blocks);

function node(over: Partial<TreeNode> & Pick<TreeNode, "id" | "depth" | "range" | "title">): TreeNode {
  return { parent: null, children: [], ...over };
}

/* Root over all six; part A over 1–3 with section A1 over 2–3; part B over 4–6. */
const tree: Tree = {
  version: "t",
  generator: "t",
  slug: "s",
  rootId: "root",
  nodes: {
    root: node({
      id: "root",
      depth: 0,
      range: ["spya-aaaaa1", "spya-aaaaa6"],
      title: "Article",
      question: "What is the whole thing for?",
      children: ["a", "b"],
    }),
    a: node({
      id: "a",
      depth: 1,
      parent: "root",
      range: ["spya-aaaaa1", "spya-aaaaa3"],
      title: "Part A",
      question: "Why does A matter?",
      children: ["a1", "a0"],
    }),
    a0: node({ id: "a0", depth: 2, parent: "a", range: ["spya-aaaaa1", "spya-aaaaa1"], title: "Opening" }),
    a1: node({
      id: "a1",
      depth: 2,
      parent: "a",
      range: ["spya-aaaaa2", "spya-aaaaa3"],
      title: "Section A1",
      question: "A depth-2 question the structure call should never have kept",
      children: ["a1p"],
    }),
    /* A paragraph leaf, as real trees have: `sectionNodesOf` leaves the leaf
       out of the path, so a section is only named when it has one. */
    a1p: node({ id: "a1p", depth: 3, parent: "a1", range: ["spya-aaaaa2", "spya-aaaaa3"], title: "Para" }),
    b: node({ id: "b", depth: 1, parent: "root", range: ["spya-aaaaa4", "spya-aaaaa6"], title: "Part B" }),
  },
} as unknown as Tree;
/* `sectionNodesOf` walks children in order, so keep them in document order. */
(tree.nodes.a as TreeNode).children = ["a0", "a1"];

function idea(over: Partial<Idea> & Pick<Idea, "id" | "name">): Idea {
  return { provenance: "assumed", statement: `${over.name}, stated.`, occurrences: [], ...over } as Idea;
}

describe("marginaliaNotes", () => {
  it("puts each part's question beside its first paragraph, not its heading", () => {
    const notes = marginaliaNotes(tree, blocks, null);
    expect(notes.has("spya-aaaaa1")).toBe(false);
    expect(notes.get("spya-aaaaa2")).toEqual([
      { kind: "question", depth: 1, text: "Why does A matter?" },
    ]);
    /* Part B has no question: nothing beside it. */
    expect(notes.has("spya-aaaaa4")).toBe(false);
  });

  it("passes over a one-line 'heading' or date stored as text, to the first real paragraph", () => {
    /* A bolded one-word line or "January 2006" is `kind: "text"` and
       gistable; only its length gives it away. */
    const shortSecond = blocks.map((b, i) => (i === 1 ? { ...b, words: 2 } : b));
    const notes = marginaliaNotes(tree, shortSecond, null);
    expect(notes.has("spya-aaaaa2")).toBe(false);
    expect(notes.get("spya-aaaaa3")).toEqual([
      { kind: "question", depth: 1, text: "Why does A matter?" },
    ]);
  });

  it("falls back to the part's first block when nothing in it is a paragraph", () => {
    const allShort = blocks.map((b) => ({ ...b, words: 3 }));
    expect([...marginaliaNotes(tree, allShort, null).keys()]).toEqual(["spya-aaaaa1"]);
  });

  it("draws neither the article's own question nor any below the parts", () => {
    const all = [...marginaliaNotes(tree, blocks, null).values()].flat();
    expect(all).toEqual([{ kind: "question", depth: 1, text: "Why does A matter?" }]);
  });

  it("stamps each idea once, at its first occurrence in the article", () => {
    const later = idea({
      id: "i1",
      name: "Later idea",
      occurrences: [
        { blockId: "spya-aaaaa5", quote: "q", reasoning: "r" },
        { blockId: "spya-aaaaa3", quote: "q", reasoning: "r" },
        { blockId: "spya-aaaaa3", quote: "q2", reasoning: "r" },
      ],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const notes = marginaliaNotes(null, blocks, [later]);
    expect([...notes.keys()]).toEqual(["spya-aaaaa3"]);
    expect(notes.get("spya-aaaaa3")).toEqual([
      {
        kind: "idea",
        ideaId: "i1",
        name: "Later idea",
        statement: "Later idea, stated.",
        provenance: "assumed",
      },
    ]);
  });

  it("skips a block this article no longer has, rather than placing a note nowhere", () => {
    const gone = idea({
      id: "i2",
      name: "Gone",
      occurrences: [{ blockId: "spya-zzzzzz", quote: "q", reasoning: "r" }],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const moved: Tree = {
      ...tree,
      nodes: { ...tree.nodes, a: { ...(tree.nodes.a as TreeNode), range: ["spya-zzzzzz", "spya-aaaaa3"] } },
    };
    const notes = marginaliaNotes(moved, blocks, [gone]);
    expect([...notes.values()].flat()).toEqual([]);
  });

  it("orders questions before ideas on one block", () => {
    const here = idea({
      id: "i3",
      name: "Here",
      occurrences: [{ blockId: "spya-aaaaa2", quote: "q", reasoning: "r" }],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const kinds = (marginaliaNotes(tree, blocks, [here]).get("spya-aaaaa2") ?? []).map((n) => n.kind);
    expect(kinds).toEqual(["question", "idea"]);
  });
});

describe("layoutNotes", () => {
  it("leaves notes that do not collide exactly where they want to be", () => {
    expect(layoutNotes([0, 100, 300], [40, 40, 40], 8)).toEqual([0, 100, 300]);
  });

  it("pushes a note down below the one above it, and keeps the order", () => {
    expect(layoutNotes([0, 20, 30], [50, 50, 10], 8)).toEqual([0, 58, 116]);
  });

  it("lets a later note return to its own place once the crowd has passed", () => {
    expect(layoutNotes([0, 10, 500], [100, 100, 20], 8)).toEqual([0, 108, 500]);
  });

  it("is idempotent: laying out the answer again changes nothing", () => {
    const desired = [0, 20, 30, 35, 400];
    const heights = [50, 50, 10, 30, 10];
    const once = layoutNotes(desired, heights, 8);
    expect(layoutNotes(desired, heights, 8)).toEqual(once);
  });
});

describe("the head", () => {
  it("names the part and the section the block sits in", () => {
    expect(headPath(tree, index, "spya-aaaaa3")).toEqual([
      { title: "Part A", voice: "ai" },
      { title: "Section A1", voice: "ai" },
    ]);
    expect(headPath(tree, index, "spya-aaaaa5")).toEqual([{ title: "Part B", voice: "ai" }]);
    expect(headPath(tree, index, null)).toEqual([]);
  });

  it("says whose words each title is: the author's heading kept, or the model's", () => {
    const voiced = {
      ...tree,
      nodes: {
        ...tree.nodes,
        a: { ...tree.nodes.a, sourceHeading: "Part A" },
        a1: { ...tree.nodes.a1, sourceHeading: "2.1 Something else" },
      },
    } as unknown as Tree;
    expect(headPath(voiced, index, "spya-aaaaa3").map((s) => s.voice)).toEqual(["author", "ai"]);
  });

  it("gives the arc's sentence for the part holding the block", () => {
    const arc = {
      version: "t",
      generator: "t",
      slug: "s",
      entries: [
        { range: ["spya-aaaaa1", "spya-aaaaa3"], text: "Setting it up." },
        { range: ["spya-aaaaa4", "spya-aaaaa6"], text: "Turning it round." },
      ],
    } as Arc;
    expect(arcAt(arc, index, "spya-aaaaa2")).toBe("Setting it up.");
    expect(arcAt(arc, index, "spya-aaaaa6")).toBe("Turning it round.");
    expect(arcAt(arc, index, "spya-zzzzzz")).toBe(null);
    expect(arcAt(null, index, "spya-aaaaa2")).toBe(null);
  });
});

/* ------------------------------------------------------------------------
   Report 82: FAQ, Debate, Citations and comments, beside their blocks, one
   shut line per kind per block. Nothing here generates; these are the items
   other modes have already stored.
   docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md. */

/* Blocks whose text a quote can be checked against. */
const quoted = ids.map((id, i) => ({
  id,
  text: `Paragraph ${i} says something particular about topic ${i}.`,
  html: "",
  kind: "text",
  gistable: true,
  words: 40,
})) as unknown as Block[];
const say = (i: number) => `something particular about topic ${i}`;

function faqQ(id: string, passages: { blockId: string; quote: string }[]): FaqQuestion {
  return { id, question: `Question ${id}?`, passages: passages.map((p) => ({ ...p, start: 0 })) } as FaqQuestion;
}
function claim(url: string, blockId: string, claimQuote: string): MarginClaim {
  return { url, blockId, claimQuote, relation: "disputes", sourceQuote: "s", applies: "a" } as unknown as MarginClaim;
}
function work(id: string, citedAt: string[]): CitedWork {
  return { id, title: `Work ${id}`, why: "w", citedAt, firstCited: citedAt[0], mentions: [] } as unknown as CitedWork;
}

describe("marginaliaNotes, other modes' items (report 82)", () => {
  it("puts an FAQ question beside its earliest answering passage by block position, not passages[0]", () => {
    const q = faqQ("f1", [
      { blockId: "spya-aaaaa5", quote: say(4) },
      { blockId: "spya-aaaaa3", quote: say(2) },
    ]);
    const notes = marginaliaNotes(null, quoted, null, { faq: [q] });
    expect([...notes.keys()]).toEqual(["spya-aaaaa3"]);
    expect(notes.get("spya-aaaaa3")).toEqual([
      { kind: "faq", items: [{ question: q, quote: say(2), morePassages: 1 }] },
    ]);
  });

  it("passes over an FAQ passage whose block is gone, or whose words are no longer in it", () => {
    const q = faqQ("f2", [
      { blockId: "spya-zzzzzz", quote: say(0) },
      { blockId: "spya-aaaaa2", quote: "words this block never said" },
      { blockId: "spya-aaaaa4", quote: say(3) },
    ]);
    expect([...marginaliaNotes(null, quoted, null, { faq: [q] }).keys()]).toEqual(["spya-aaaaa4"]);
    const none = faqQ("f3", [{ blockId: "spya-aaaaa2", quote: "nothing like it" }]);
    expect(marginaliaNotes(null, quoted, null, { faq: [none] }).size).toBe(0);
  });

  it("counts only other FAQ passages whose quoted words still survive", () => {
    const q = faqQ("f4", [
      { blockId: "spya-aaaaa2", quote: say(1) },
      { blockId: "spya-aaaaa4", quote: say(3) },
      { blockId: "spya-aaaaa5", quote: "words this block never said" },
      { blockId: "spya-zzzzzz", quote: say(5) },
    ]);
    const notes = marginaliaNotes(null, quoted, null, { faq: [q] }).get("spya-aaaaa2") ?? [];
    expect(notes[0]?.kind === "faq" && notes[0].items[0]?.morePassages).toBe(1);
  });

  it("groups several of one kind in one block into one note", () => {
    const notes = marginaliaNotes(null, quoted, null, {
      citations: [work("c1", ["spya-aaaaa2"]), work("c2", ["spya-aaaaa2", "spya-aaaaa5"])],
    });
    const here = notes.get("spya-aaaaa2") ?? [];
    expect(here).toHaveLength(1);
    expect(here[0]?.kind).toBe("citation");
    expect(here[0]?.kind === "citation" && here[0].items.map((w) => w.id)).toEqual(["c1", "c2"]);
    expect(notes.has("spya-aaaaa5")).toBe(false);
  });

  it("places a citation at its earliest surviving citing block", () => {
    const notes = marginaliaNotes(null, quoted, null, {
      citations: [work("c3", ["spya-zzzzzz", "spya-aaaaa6", "spya-aaaaa4"])],
    });
    expect([...notes.keys()]).toEqual(["spya-aaaaa4"]);
  });

  it("places a Debate claim row only where its claim's words still are", () => {
    const notes = marginaliaNotes(null, quoted, null, {
      claims: [claim("https://a.example", "spya-aaaaa3", say(2)), claim("https://b.example", "spya-aaaaa4", "not said")],
    });
    expect([...notes.keys()]).toEqual(["spya-aaaaa3"]);
  });

  it("leaves referee notes and bare bookmarks out of the reader's comments", () => {
    const comments = [
      { id: "m1", blockId: "spya-aaaaa2", createdAt: "t", body: "mine", status: "none" },
      { id: "m2", blockId: "spya-aaaaa2", createdAt: "t", status: "none" },
      { id: "m3", blockId: "spya-aaaaa2", createdAt: "t", body: "a referee note", status: "none", criterionId: "k" },
    ] as unknown as MarginComment[];
    const here = marginaliaNotes(null, quoted, null, { comments }).get("spya-aaaaa2") ?? [];
    expect(here[0]?.kind === "comment" && here[0].items.map(entryId)).toEqual(["m1"]);
  });

  /* Plan 261003e, review S9: a wordless highlight has nothing to say in the
     margin, as a bare bookmark has not — but a coloured comment with words, or
     a coloured one that asked the AI, still does. */
  it("leaves a wordless highlight out, and keeps coloured comments that say something", () => {
    const comments = [
      { id: "h1", blockId: "spya-aaaaa2", createdAt: "t", status: "none", colour: "yellow" },
      { id: "h2", blockId: "spya-aaaaa2", createdAt: "t", body: "why", status: "none", colour: "green" },
      { id: "h3", blockId: "spya-aaaaa2", createdAt: "t", status: "none", colour: "pink", threadId: "t7" },
    ] as unknown as MarginComment[];
    const here = marginaliaNotes(null, quoted, null, { comments }).get("spya-aaaaa2") ?? [];
    expect(here[0]?.kind === "comment" && here[0].items.map((e) => [e.as, entryId(e)])).toEqual([
      ["comment", "h2"],
      ["comment-ai", "h3"],
    ]);
  });

  /* *Save & ask* with an empty box is allowed (AnnotateDialog): no words, no
     answer, but a conversation. It is not a bare bookmark. GPT Sol, plan 261002j. */
  it("keeps a wordless comment that asked the AI", () => {
    const comments = [
      { id: "m4", blockId: "spya-aaaaa2", createdAt: "t", status: "none", threadId: "t4" },
    ] as unknown as MarginComment[];
    const here = marginaliaNotes(null, quoted, null, { comments }).get("spya-aaaaa2") ?? [];
    expect(here[0]?.kind === "comment" && here[0].items.map((e) => [e.as, entryId(e)])).toEqual([
      ["comment-ai", "m4"],
    ]);
  });

  /* SPIDERYARN-READING2-9H: each says which of three it is, and the questions
     the reader asked from a passage sit with the comments on it. Plan 261002j. */
  it("marks each comment's kind, and puts the questions asked here in the same line", () => {
    const comments = [
      { id: "m1", blockId: "spya-aaaaa2", createdAt: "t", body: "mine", status: "none" },
      { id: "m2", blockId: "spya-aaaaa2", createdAt: "t", body: "and ask", status: "none", threadId: "t9" },
    ] as unknown as MarginComment[];
    const asked = [
      { id: "t1", blockId: "spya-aaaaa2", createdAt: "t" },
      { id: "t2", blockId: "spya-aaaaa4", createdAt: "t", quote: "q", start: 0 },
      { id: "t3", blockId: "spya-zzzzzz", createdAt: "t" },
    ];
    const notes = marginaliaNotes(null, quoted, null, { comments, asked });
    const here = notes.get("spya-aaaaa2") ?? [];
    expect(here).toHaveLength(1);
    expect(here[0]?.kind === "comment" && here[0].items.map((e) => [e.as, entryId(e)])).toEqual([
      ["comment", "m1"],
      ["comment-ai", "m2"],
      ["question", "t1"],
    ]);
    const there = notes.get("spya-aaaaa4") ?? [];
    expect(there[0]?.kind === "comment" && there[0].items.map((e) => [e.as, entryId(e)])).toEqual([
      ["question", "t2"],
    ]);
    /* A question about a block this version no longer has is not drawn. */
    expect([...notes.keys()].sort()).toEqual(["spya-aaaaa2", "spya-aaaaa4"]);
  });

  it("orders the kinds on one block: question, idea, FAQ, Debate, citations, the reader's own", () => {
    const tree2 = {
      ...tree,
      nodes: { ...tree.nodes, a: { ...(tree.nodes.a as TreeNode), range: ["spya-aaaaa2", "spya-aaaaa3"] } },
    } as Tree;
    const here = idea({
      id: "i9",
      name: "Here",
      occurrences: [{ blockId: "spya-aaaaa2", quote: "q", reasoning: "r" }],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const kinds = (
      marginaliaNotes(tree2, quoted, [here], {
        comments: [{ id: "m", blockId: "spya-aaaaa2", createdAt: "t", body: "x", status: "none" }] as unknown as MarginComment[],
        citations: [work("c", ["spya-aaaaa2"])],
        claims: [claim("https://c.example", "spya-aaaaa2", say(1))],
        faq: [faqQ("f", [{ blockId: "spya-aaaaa2", quote: say(1) }])],
      }).get("spya-aaaaa2") ?? []
    ).map((n) => n.kind);
    expect(kinds).toEqual(["question", "idea", "faq", "debate", "citation", "comment"]);
  });
});
