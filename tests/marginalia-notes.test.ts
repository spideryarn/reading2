/**
 * Marginalia's pure half — which note goes beside which block, how notes
 * are kept from overlapping, and what the head says.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 */
import { describe, expect, it } from "vitest";
import { blockIndex } from "../src/section-path.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Arc, Block, CitedWork, FaqQuestion, Idea, TimelineEvent, Tree, TreeNode } from "../src/types.js";
import {
  type MarginClaim,
  type MarginComment,
  DRAWN_RELATIONS,
  marginaliaNotes,
  arcAt,
  headBlock,
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

/**
 * **The block the head speaks for** (qi-2ymfq3ek, plan 261004l § D): above the
 * first part the head borrows the first part's first block, and nowhere else.
 * The ids are deliberately out of string order against document order: block 1
 * sorts *after* the first part's first block as a string, so a comparison of
 * ids rather than of index positions answers wrongly here
 * (docs/project/block-ids.md § the warning on range checks).
 */
describe("the block the head speaks for", () => {
  const order = ["spya-zzzzz1", "spya-mmmmm2", "spya-aaaaa3", "spya-kkkkk4", "spya-bbbbb5", "spya-ccccc6"];
  const at = new Map(order.map((id, i) => [id, i]));
  /* Block 1 above every part; part A over 2–3; block 4 in a gap; part B over 5; block 6 after the last. */
  const gapped = {
    version: "t",
    generator: "t",
    slug: "s",
    rootId: "root",
    nodes: {
      root: node({ id: "root", depth: 0, range: ["spya-zzzzz1", "spya-ccccc6"], title: "Article", children: ["a", "b"] }),
      a: node({ id: "a", depth: 1, parent: "root", range: ["spya-mmmmm2", "spya-aaaaa3"], title: "Part A" }),
      b: node({ id: "b", depth: 1, parent: "root", range: ["spya-bbbbb5", "spya-bbbbb5"], title: "Part B" }),
    },
  } as unknown as Tree;
  const nodes = gapped.nodes as Record<string, TreeNode>;

  it("a block above the first part answers with the first part's first block", () => {
    expect(headBlock(gapped, at, "spya-zzzzz1")).toBe("spya-mmmmm2");
    expect(headPath(gapped, at, headBlock(gapped, at, "spya-zzzzz1"))).toEqual([{ title: "Part A", voice: "ai" }]);
  });

  it("no block at all answers with the first part's first block", () => {
    expect(headBlock(gapped, at, null)).toBe("spya-mmmmm2");
  });

  it("a block inside a part answers with itself, the first part's own first block included", () => {
    expect(headBlock(gapped, at, "spya-mmmmm2")).toBe("spya-mmmmm2");
    expect(headBlock(gapped, at, "spya-aaaaa3")).toBe("spya-aaaaa3");
    expect(headBlock(gapped, at, "spya-bbbbb5")).toBe("spya-bbbbb5");
  });

  it("a block in a later gap, or after the last part, does not borrow a part", () => {
    expect(headBlock(gapped, at, "spya-kkkkk4")).toBe("spya-kkkkk4");
    expect(headBlock(gapped, at, "spya-ccccc6")).toBe("spya-ccccc6");
    expect(headPath(gapped, at, headBlock(gapped, at, "spya-kkkkk4"))).toEqual([]);
  });

  it("a block id the index does not know is not the top", () => {
    expect(headBlock(gapped, at, "spya-000000")).toBe("spya-000000");
  });

  it("a missing tree, an empty one, and one with no root answer with what they were given", () => {
    const empty = { ...gapped, nodes: { root: { ...nodes.root, children: [] } } } as unknown as Tree;
    const rootless = { ...gapped, nodes: {} } as unknown as Tree;
    for (const t of [null, undefined, empty, rootless]) {
      expect(headBlock(t, at, "spya-zzzzz1")).toBe("spya-zzzzz1");
      expect(headBlock(t, at, null)).toBe(null);
    }
  });

  it("a first part whose first block is not in the article answers with what it was given", () => {
    const stale = {
      ...gapped,
      nodes: { ...nodes, a: { ...nodes.a, range: ["spya-gone00", "spya-aaaaa3"] } },
    } as unknown as Tree;
    expect(headBlock(stale, at, "spya-zzzzz1")).toBe("spya-zzzzz1");
    expect(headBlock(stale, at, null)).toBe(null);
  });

  it("does not borrow the argument for a block covered by an earlier supplement", () => {
    const noteId = order[0]!;
    const bodyId = order[1]!;
    const articleBlocks: Block[] = [
      { ...blocks[1]!, id: noteId, treatment: "supplement", role: "footnote", gistable: false },
      { ...blocks[1]!, id: bodyId },
    ];
    const articleIndex = blockIndex(articleBlocks);
    const withOpeningNotes = {
      ...gapped,
      nodes: {
        root: node({ id: "root", depth: 0, children: ["notes", "part"], range: [noteId, bodyId], title: "Article", gist: "The argument." }),
        notes: node({ id: "notes", depth: 1, parent: "root", children: ["note"], range: [noteId, noteId], title: "Notes", treatment: "supplement" }),
        note: node({ id: "note", depth: 2, parent: "notes", range: [noteId, noteId], title: "" }),
        part: node({ id: "part", depth: 1, parent: "root", children: ["paragraph"], range: [bodyId, bodyId], title: "Part A", gist: "The argument." }),
        paragraph: node({ id: "paragraph", depth: 2, parent: "part", range: [bodyId, bodyId], title: "", navLabel: "The argument" }),
      },
    } satisfies Tree;
    // This ordering is permitted by the tree contract, even though today's producer appends Notes.
    expect(checkTree(articleBlocks, withOpeningNotes).problems).toEqual([]);
    expect(headBlock(withOpeningNotes, articleIndex, noteId)).toBe(noteId);
    expect(headPath(withOpeningNotes, articleIndex, headBlock(withOpeningNotes, articleIndex, noteId))).toEqual([
      { title: "Notes", voice: "ui" },
    ]);
    expect(headBlock(withOpeningNotes, articleIndex, null)).toBe(bodyId);
  });

  it("a root missing its child list answers with what it was given", () => {
    const missingChildren = {
      ...gapped,
      nodes: { root: { ...nodes.root, children: undefined } },
    } as unknown as Tree;
    expect(headBlock(missingChildren, at, order[0]!)).toBe(order[0]);
    expect(headBlock(missingChildren, at, null)).toBeNull();
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

  /* *Ask AI* with an empty box is allowed (AnnotateDialog): no words, no
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
    expect(kinds).toEqual(["question", "idea", "faq", "reception", "citation", "comment"]);
  });
});

/* Timeline events in the margin — plan 261003f stage 1. Only events the piece
   dates (`dated`, its own `words`, or since plan 261005h a date with no year),
   beside the passage that dates them, whose quoted words are still in their
   block. */
function event(
  id: string,
  dating: TimelineEvent["dating"],
  occurrences: { blockId: string; quote: string }[],
): TimelineEvent {
  return {
    id,
    label: `Event ${id}`,
    dating,
    order: 1,
    modality: "happened",
    occurrences: occurrences.map((o) => ({ ...o, start: 0 })),
  } as TimelineEvent;
}
/* Dated from words the named block of `quoted` holds. */
const datedAt = (blockId: string, phrase: string) =>
  ({
    kind: "dated",
    when: { earliest: "2026-05-12", latest: "2026-05-12", phrase, at: { blockId, start: 0, end: phrase.length } },
  }) as unknown as TimelineEvent["dating"];

describe("marginaliaNotes, Timeline events (plan 261003f)", () => {
  it("puts a dated event beside the passage its date was read from, not an earlier undated mention", () => {
    const e = event("e1", datedAt("spya-aaaaa5", "topic 4"), [
      { blockId: "spya-aaaaa3", quote: say(2) },
      { blockId: "spya-aaaaa5", quote: say(4) },
    ]);
    const notes = marginaliaNotes(null, quoted, null, { timeline: [e] });
    expect([...notes.keys()]).toEqual(["spya-aaaaa5"]);
    expect(notes.get("spya-aaaaa5")).toEqual([{ kind: "timeline", items: [{ event: e, quote: say(4) }] }]);
  });

  it("draws nothing for a date whose words are no longer in their block", () => {
    const e = event("e5", datedAt("spya-aaaaa5", "12 May"), [{ blockId: "spya-aaaaa5", quote: say(4) }]);
    expect(marginaliaNotes(null, quoted, null, { timeline: [e] }).size).toBe(0);
    const gone = event("e7", datedAt("spya-zzzzzz", "topic 4"), [{ blockId: "spya-aaaaa5", quote: say(4) }]);
    expect(marginaliaNotes(null, quoted, null, { timeline: [gone] }).size).toBe(0);
  });

  it("draws nothing when the date remains but the event's quoted words no longer do", () => {
    const e = event("e8", datedAt("spya-aaaaa5", "topic 4"), [
      { blockId: "spya-aaaaa5", quote: "Acme launched on topic 4" },
    ]);
    expect(marginaliaNotes(null, quoted, null, { timeline: [e] }).size).toBe(0);
  });

  it("puts the article's own phrase beside the earliest mention whose block says it; untimed and rejected stay in the band", () => {
    const words = event("e2", { kind: "words", phrase: "topic 3" }, [
      { blockId: "spya-aaaaa2", quote: say(1) },
      { blockId: "spya-aaaaa4", quote: say(3) },
    ]);
    const untimed = event("e3", { kind: "untimed" }, [{ blockId: "spya-aaaaa4", quote: say(3) }]);
    const rejected = event(
      "e4",
      { kind: "rejected", reason: "noYearFrame", phrase: null } as TimelineEvent["dating"],
      [{ blockId: "spya-aaaaa4", quote: say(3) }],
    );
    const notes = marginaliaNotes(null, quoted, null, { timeline: [words, untimed, rejected] });
    expect([...notes.keys()]).toEqual(["spya-aaaaa4"]);
    const here = notes.get("spya-aaaaa4") ?? [];
    expect(here[0]?.kind === "timeline" && here[0].items.map((i) => i.event.id)).toEqual(["e2"]);
  });

  /* Plan 261005h D: the panel shows a date with no year in the article's own
     words (`datingWords`), so the margin places it like a `words` event. */
  const yearless = (phrase: string | null, reason = "noYearFrame") =>
    ({ kind: "rejected", reason, phrase }) as TimelineEvent["dating"];

  it("puts a date with no year beside the earliest mention whose block says its phrase", () => {
    const e = event("e9", yearless("topic 3"), [
      { blockId: "spya-aaaaa2", quote: say(1) },
      { blockId: "spya-aaaaa4", quote: say(3) },
    ]);
    const notes = marginaliaNotes(null, quoted, null, { timeline: [e] });
    expect([...notes.keys()]).toEqual(["spya-aaaaa4"]);
    expect(notes.get("spya-aaaaa4")).toEqual([{ kind: "timeline", items: [{ event: e, quote: say(3) }] }]);
  });

  it.each(["unparseablePhrase", "phraseNotInOccurrence"])("draws nothing for a date rejected as %s", (reason) => {
    const e = event("e10", yearless("topic 3", reason), [{ blockId: "spya-aaaaa4", quote: say(3) }]);
    expect(marginaliaNotes(null, quoted, null, { timeline: [e] }).size).toBe(0);
  });

  it("draws nothing for a date with no year whose phrase is in no block, or whose quote has gone", () => {
    const lost = event("e11", yearless("On July 7"), [{ blockId: "spya-aaaaa4", quote: say(3) }]);
    expect(marginaliaNotes(null, quoted, null, { timeline: [lost] }).size).toBe(0);
    const unquoted = event("e12", yearless("topic 3"), [{ blockId: "spya-aaaaa4", quote: "Acme launched on topic 3" }]);
    expect(marginaliaNotes(null, quoted, null, { timeline: [unquoted] }).size).toBe(0);
  });

  /* GPT Sol, F4 on plan 261005h: the server only keeps a phrase it found
     INSIDE an occurrence's quote (`locatePhrase`, src/timeline.ts), for `words`
     and for a rejected date alike. An earlier block that says the phrase about
     something else, and quotes the event without it, is not where it is dated. */
  describe("the phrase must be inside the mention's own quote", () => {
    it.each([
      ["words", { kind: "words", phrase: "Later on" } as TimelineEvent["dating"],
        "Acme discussed the late Ron and its launch.", "Later on, Acme launched."],
      ["yearless", yearless("In June"),
        "Acme discussed its launch in Injune.", "In June, Acme launched."],
    ])("does not remove word boundaries to place a %s phrase in an earlier quote", (_, dating, earlier, later) => {
      const blocks = [earlier, later].map((text, i) => ({
        id: i === 0 ? "spya-aaaaa2" : "spya-aaaaa3", text, html: "", kind: "text", gistable: true, words: 40,
      })) as unknown as Block[];
      const e = event("word-boundaries", dating, blocks.map((b) => ({ blockId: b.id, quote: b.text })));
      expect([...marginaliaNotes(null, blocks, null, { timeline: [e] }).keys()]).toEqual(["spya-aaaaa3"]);
    });

    it("keeps original slice offsets while matching repeated whitespace and folded quotation marks", () => {
      const text = "İstanbul: Acme said “On  May\n1, we launch”.";
      const blocks = [{ id: "spya-aaaaa2", text, html: "", kind: "text", gistable: true, words: 40 }] as unknown as Block[];
      const e = event("normalised", yearless("On May 1"), [
        { blockId: "spya-aaaaa2", quote: 'Acme said "On May 1, we launch"' },
      ]);
      expect([...marginaliaNotes(null, blocks, null, { timeline: [e] }).keys()]).toEqual(["spya-aaaaa2"]);
    });

    const two = [
      { id: "spya-aaaaa2", text: "On July 7, another company launched. Acme discussed its launch." },
      { id: "spya-aaaaa3", text: "On July 7, Acme launched." },
    ].map((b) => ({ ...b, html: "", kind: "text", gistable: true, words: 40 })) as unknown as Block[];
    const mentions = [
      { blockId: "spya-aaaaa2", quote: "Acme discussed its launch" },
      { blockId: "spya-aaaaa3", quote: "On July 7, Acme launched" },
    ];

    it.each([
      ["a date with no year", yearless("On July 7")],
      ["the article's own words", { kind: "words", phrase: "On July 7" } as TimelineEvent["dating"]],
    ])("%s goes beside the mention that says it, not an earlier block that says it of something else", (_, dating) => {
      const e = event("e13", dating, mentions);
      const notes = marginaliaNotes(null, two, null, { timeline: [e] });
      expect([...notes.keys()]).toEqual(["spya-aaaaa3"]);
      expect(notes.get("spya-aaaaa3")).toEqual([
        { kind: "timeline", items: [{ event: e, quote: "On July 7, Acme launched" }] },
      ]);
    });

    it("draws nothing when no mention's quote holds the phrase, or the phrase is null", () => {
      const outside = event("e14", yearless("On July 7"), [mentions[0]!]);
      expect(marginaliaNotes(null, two, null, { timeline: [outside] }).size).toBe(0);
      const none = event("e15", yearless(null), mentions);
      expect(marginaliaNotes(null, two, null, { timeline: [none] }).size).toBe(0);
    });
  });

  it("puts the Timeline line after FAQ and before Debate on one block", () => {
    const kinds = (
      marginaliaNotes(null, quoted, null, {
        claims: [claim("https://c.example", "spya-aaaaa2", say(1))],
        timeline: [event("e6", datedAt("spya-aaaaa2", "topic 1"), [{ blockId: "spya-aaaaa2", quote: say(1) }])],
        faq: [faqQ("f", [{ blockId: "spya-aaaaa2", quote: say(1) }])],
      }).get("spya-aaaaa2") ?? []
    ).map((n) => n.kind);
    expect(kinds).toEqual(["faq", "timeline", "reception"]);
  });
});

/* Relation words — plan 261003f stage 2. Only the turns are drawn, first in
   the block's note. */
describe("marginaliaNotes, relation words (plan 261003f)", () => {
  it("draws only the turns: so, but and vs; the other seven are stored and not drawn", () => {
    const notes = marginaliaNotes(null, quoted, null, {
      relations: {
        "spya-aaaaa2": "therefore",
        "spya-aaaaa3": "but",
        "spya-aaaaa4": "contrast",
        "spya-aaaaa5": "and-also",
        "spya-aaaaa6": "because",
      },
    });
    expect([...notes.entries()]).toEqual([
      ["spya-aaaaa2", [{ kind: "relation", relation: "therefore" }]],
      ["spya-aaaaa3", [{ kind: "relation", relation: "but" }]],
      ["spya-aaaaa4", [{ kind: "relation", relation: "contrast" }]],
    ]);
    expect(Object.keys(DRAWN_RELATIONS).sort()).toEqual(["but", "contrast", "therefore"]);
  });

  it("skips a paragraph this article no longer has", () => {
    expect(marginaliaNotes(null, quoted, null, { relations: { "spya-zzzzzz": "but" } }).size).toBe(0);
  });

  it("puts the word first, above the part's question and everything else", () => {
    const tree2 = {
      ...tree,
      nodes: { ...tree.nodes, a: { ...(tree.nodes.a as TreeNode), range: ["spya-aaaaa2", "spya-aaaaa3"] } },
    } as Tree;
    const kinds = (
      marginaliaNotes(tree2, quoted, null, {
        faq: [faqQ("f", [{ blockId: "spya-aaaaa2", quote: say(1) }])],
        relations: { "spya-aaaaa2": "but" },
      }).get("spya-aaaaa2") ?? []
    ).map((n) => n.kind);
    expect(kinds).toEqual(["relation", "question", "faq"]);
  });
});
