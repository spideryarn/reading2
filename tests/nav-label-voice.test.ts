/**
 * **Whose words a leaf's navLabel is: read off the block it starts at.**
 *
 * A model writes every leaf's navLabel except a heading's — src/labels.ts §
 * `parseLabels` copies a heading block's text instead of taking the model's
 * attempt — so a heading leaf's label is the author's own title and belongs in
 * the author's face, and every other label is the model's. Inferring "AI" from
 * the mere presence of a navLabel would put the author's headings in the
 * model's face (GPT Sol, plan review of
 * docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md, P1).
 *
 * Built through the real `buildSummaryTree` / `buildOutline` and the real
 * `structureProjection`, because the fact is computed where the blocks are and
 * carried to where the rows are drawn; a fixture that set the flag by hand
 * would test only the last step.
 */
import { describe, expect, it } from "vitest";
import { childLabel } from "../src/web/Spine.js";
import { structureProjection } from "../src/web/structure.js";
import { PREAMBLE_TITLE } from "../src/heading-tree.js";
import { articleTitleVoice } from "../src/web/voice.js";
import { buildOutline, buildSummaryTree, navLabelVoice, nodeLabel, titleVoice } from "../src/web/tree.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

const b = (id: string, kind: Block["kind"], tag: string, text: string): Block => ({
  id: id as BlockId,
  tag,
  kind,
  text,
  words: text.split(" ").length,
  html: `<${tag}>${text}</${tag}>`,
  gistable: true,
});

/* Root → one part → one section → two leaves: a heading, then a paragraph. */
const blocks: Block[] = [
  b("spya-hhhhhh", "heading", "h3", "Why the sky is blue"),
  b("spya-pppppp", "text", "p", "Short wavelengths scatter more, so the sky looks blue."),
];

function node(
  id: string,
  depth: number,
  parent: string | null,
  children: string[],
  range: [string, string],
  extra: Partial<TreeNode> = {},
): TreeNode {
  return {
    id: id as NodeId,
    depth,
    parent: parent as NodeId | null,
    children: children as NodeId[],
    range: range as [BlockId, BlockId],
    title: "",
    ...extra,
  };
}

const tree: Tree = {
  version: "test",
  generator: "test",
  slug: "nav-label-voice",
  rootId: "n0" as NodeId,
  nodes: {
    n0: node("n0", 0, null, ["n1"], ["spya-hhhhhh", "spya-pppppp"], { title: "A piece" }),
    n1: node("n1", 1, "n0", ["n2"], ["spya-hhhhhh", "spya-pppppp"], { title: "Light" }),
    n2: node("n2", 2, "n1", ["n3", "n4"], ["spya-hhhhhh", "spya-pppppp"], { title: "Scattering" }),
    // The heading leaf: its navLabel is the heading, copied off the block.
    n3: node("n3", 3, "n2", [], ["spya-hhhhhh", "spya-hhhhhh"], { navLabel: "Why the sky is blue" }),
    // The paragraph leaf: its navLabel is the model's.
    n4: node("n4", 3, "n2", [], ["spya-pppppp", "spya-pppppp"], {
      navLabel: "Blue light scatters most in air",
    }),
  } as Record<NodeId, TreeNode>,
} as Tree;

describe("navLabel voice", () => {
  it("marks a leaf that starts at a heading as the author's, and a paragraph leaf as the model's (summary tree)", () => {
    const root = buildSummaryTree(tree, blocks, 3);
    const leaves = root?.children[0]?.children[0]?.children ?? [];
    expect(leaves.map((l) => l.node.id)).toEqual(["n3", "n4"]);
    expect(leaves.map((l) => navLabelVoice(l))).toEqual(["author", "ai"]);
  });

  it("does the same on the spine's outline", () => {
    const outline = buildOutline(tree, blocks, 3);
    const leaves = outline[0]?.children[0]?.children ?? [];
    expect(leaves.map((l) => l.node.id)).toEqual(["n3", "n4"]);
    expect(leaves.map(childLabel)).toEqual([
      { label: "Why the sky is blue", voice: "author" },
      { label: "Blue light scatters most in air", voice: "ai" },
    ]);
  });

  it("carries it to Structure's paragraph rows and its section card's children; a model's title is the model's", () => {
    const root = buildSummaryTree(tree, blocks, 3);
    const proj = structureProjection({
      root,
      focusRow: 0,
      rungA: 1,
      rungB: 3,
      allowParagraphs: true,
    });
    const rows = proj.columnB.rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    /* "Scattering" claims no author's heading, so the model wrote it (spya-rp8cr4). */
    expect(byId.get("n2" as NodeId)?.voice).toBe("ai");
    expect(byId.get("n3" as NodeId)?.voice).toBe("author");
    expect(byId.get("n4" as NodeId)?.voice).toBe("ai");
  });

  it("voices a section card's navLabel children by their block when they are listed", () => {
    const root = buildSummaryTree(tree, blocks, 3);
    /* Rung 2 draws no paragraphs, so the section's card lists its children. */
    const proj = structureProjection({
      root,
      focusRow: 0,
      rungA: 1,
      rungB: 2,
      allowParagraphs: true,
    });
    const section = proj.columnB.rows.find((r) => r.id === ("n2" as NodeId));
    expect(section, "the section row").toBeDefined();
    expect(section?.card?.children.map((c) => [c.id, c.voice])).toEqual([
      ["n3", "author"],
      ["n4", "ai"],
    ]);
  });
});

/**
 * **Whose words a section title is** (spya-rp8cr4). Greg: "if the headlines are
 * AI-generated, they should be in AI-generated-font. Ideally, it would use
 * author-font if the headlines were preserved from the author". The tree says
 * which with `sourceHeading`, by the comparison the pipeline itself uses.
 */
describe("titleVoice", () => {
  const n = (extra: Partial<TreeNode>) => node("t", 1, "n0", [], ["spya-hhhhhh", "spya-hhhhhh"], extra);

  it("is the author's when the title is the heading the node kept", () => {
    expect(titleVoice(n({ title: "Why the sky is blue", sourceHeading: "Why the sky is blue" }))).toBe("author");
    /* The pipeline's own `sameHeading`: curly quotes and spacing are not a rewrite. */
    expect(titleVoice(n({ title: "What\u2019s  left", sourceHeading: "What's left" }))).toBe("author");
  });

  it("is the model's when it rewrote the author's heading, or there was none", () => {
    expect(titleVoice(n({ title: "How light scatters", sourceHeading: "Introduction" }))).toBe("ai");
    expect(titleVoice(n({ title: "How light scatters" }))).toBe("ai");
  });

  it("is ours for the apparatus and the heading tree's preamble", () => {
    expect(titleVoice(n({ title: "Notes", treatment: "supplement" }))).toBe("ui");
    expect(titleVoice(n({ title: PREAMBLE_TITLE }))).toBe("ui");
  });

  /* An author can call a section anything, including our preamble's words, so
     the kept heading is asked first (GPT Sol, plan review of 261002f, P2). */
  it("is the author's even when their heading happens to read like ours", () => {
    expect(titleVoice(n({ title: PREAMBLE_TITLE, sourceHeading: PREAMBLE_TITLE }))).toBe("author");
  });

  it("nodeLabel gives the title with its voice, else the navLabel with its own", () => {
    const kept = n({ title: "Why the sky is blue", sourceHeading: "Why the sky is blue" });
    expect(nodeLabel({ node: kept })).toEqual({ text: "Why the sky is blue", voice: "author" });
    /* The shown title may have the article's number taken off; the voice is the stored node's. */
    const numbered = n({ title: "3.2 Methods", sourceHeading: "3.2 Methods" });
    expect(nodeLabel({ node: numbered }, "Methods")).toEqual({ text: "Methods", voice: "author" });
    const leaf = n({ title: "", navLabel: "Blue light scatters most" });
    expect(nodeLabel({ node: leaf })).toEqual({ text: "Blue light scatters most", voice: "ai" });
    expect(nodeLabel({ node: leaf, startsAtHeading: true })?.voice).toBe("author");
    expect(nodeLabel({ node: n({ title: " " }) })).toBeNull();
  });
});

/**
 * **An article's title: the author's, the reader's rename, or unknown.** Only a
 * page that knows whether there is a rename may say whose it is; a guess of
 * "author" would put the reader's own words in the author's face (voice.ts §
 * `articleTitleVoice`).
 */
describe("articleTitleVoice", () => {
  it("is the reader's after a rename, the author's without one, and ours when nobody knows", () => {
    expect(articleTitleVoice(true)).toBe("reader");
    expect(articleTitleVoice(false)).toBe("author");
    expect(articleTitleVoice(undefined)).toBe("ui");
  });
});
