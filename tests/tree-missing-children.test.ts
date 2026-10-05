// @vitest-environment jsdom
/**
 * **A stored tree with a node that has no `children` list still draws.**
 *
 * `TreeNode.children` is `NodeId[]`, and that is a claim about what this app
 * writes, not a check on what it is handed: the tree is stored JSON. A root
 * with no list threw in `buildChains` and took the reading view down
 * (qi-gwnd4skg), and guarding that one walk only moved the crash: Marginalia,
 * the breadcrumb and Skim's where-card each read the list too (GPT Sol's P-5
 * on docs/plans/261005h-three-robustness-bugs-…).
 *
 * So the fix is at the door, and so are these tests. The tree here is not
 * handed to the walkers directly: it crosses the transport as JSON and comes
 * out of src/web/article/access.ts § `resolveAccess`, the one place an
 * article reaches component state, on both the owner's path and a visitor's.
 * What the walkers are then given is whatever the door let through.
 *
 * The page itself, painted from such a tree, is
 * tests/tree-missing-children-page.test.tsx. The harness is
 * tests/maths-access.test.ts's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, Tree, TreeNode } from "../src/types.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readJson: async (res: Response) => res.json(),
}));
const loadPublicArticle = vi.fn();
vi.mock("../src/web/public-api.js", () => ({
  loadPublicArticle: (...args: unknown[]) => loadPublicArticle(...args),
  publicFetch: vi.fn(),
}));
vi.mock("../src/web/rehost.js", () => ({
  beginArticleLoad: () => {
    throw new Error("the test hands resolveAccess its own load");
  },
  rehostImages: async (article: Article) => ({ article, images: Promise.resolve(null) }),
}));

const { resolveAccess } = await import("../src/web/article/access.js");
const { buildGeometry, buildOutline, buildSummaryTree, withChildLists } = await import("../src/web/tree.js");
const { marginaliaNotes } = await import("../src/web/marginalia/notes.js");
const { isCrumbSection } = await import("../src/web/crumbs.js");
const { whereForBlock } = await import("../src/web/where.js");

const SLUG = "a-short-tree";

const paragraph = (id: string, text: string): Block =>
  ({ id, tag: "p", kind: "text", text, words: text.split(" ").length, html: `<p>${text}</p>`, gistable: true }) as Block;

const BLOCKS: Block[] = [
  paragraph("spya-aaaaaa", "The first paragraph of the first part."),
  paragraph("spya-bbbbbb", "The second paragraph of the first part."),
  paragraph("spya-cccccc", "The only paragraph of the second part."),
];

const node = (
  id: string,
  depth: number,
  parent: string | null,
  children: string[],
  range: [string, string],
  more: Partial<TreeNode> = {},
): TreeNode => ({ id, depth, parent, children, range, title: `Title of ${id}`, ...more }) as TreeNode;

/** Two parts; the first has a section with two paragraphs under it. */
const whole = (): Tree => ({
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: node("n0", 0, null, ["n1", "n5"], ["spya-aaaaaa", "spya-cccccc"]),
    n1: node("n1", 1, "n0", ["n2"], ["spya-aaaaaa", "spya-bbbbbb"], { question: "What does part one ask?" }),
    n2: node("n2", 2, "n1", ["n3", "n4"], ["spya-aaaaaa", "spya-bbbbbb"]),
    n3: node("n3", 3, "n2", [], ["spya-aaaaaa", "spya-aaaaaa"]),
    n4: node("n4", 3, "n2", [], ["spya-bbbbbb", "spya-bbbbbb"]),
    n5: node("n5", 1, "n0", [], ["spya-cccccc", "spya-cccccc"]),
  },
});

/** The same tree with one node's `children` key gone, as stored JSON could have it. */
function without(id: string): Tree {
  const tree = whole();
  delete (tree.nodes[id] as Partial<TreeNode>).children;
  return tree;
}

const CASES = [
  { name: "the root has no children list", tree: () => without("n0") },
  { name: "an inner node has no children list", tree: () => without("n1") },
] as const;

const FOOTINGS = ["owned", "public"] as const;

/** The article as the client gets it: JSON over the wire, then through the door. */
async function throughTheDoor(tree: Tree, footing: (typeof FOOTINGS)[number]): Promise<Article> {
  const payload = { meta: { slug: SLUG, title: "A short tree" }, blocks: BLOCKS, tree, comments: [], searches: [] };
  const wire = JSON.stringify(payload);
  apiFetch.mockResolvedValue(new Response(wire, { status: 200 }));
  loadPublicArticle.mockResolvedValue({ kind: "ok", body: JSON.parse(wire) });
  const load = { signal: new AbortController().signal, mint: () => "", release: () => {} };
  const { access } = await resolveAccess(SLUG, footing === "owned" ? "reader-1" : null, load);
  if (access.kind !== "owned" && access.kind !== "public") throw new Error(`no article: ${access.kind}`);
  expect(access.kind).toBe(footing);
  return access.article;
}

const rowOf = new Map(BLOCKS.map((b, i) => [b.id as string, i]));

beforeEach(() => {
  apiFetch.mockReset();
  loadPublicArticle.mockReset();
});

for (const footing of FOOTINGS) {
  for (const { name, tree } of CASES) {
    describe(`${name} (${footing})`, () => {
      it("the JSON really did arrive without the key", async () => {
        /* The premise, checked: a fixture that had quietly kept its list would
           make every case below pass against the broken code. */
        const sent = JSON.parse(JSON.stringify(tree())) as Tree;
        expect(Object.values(sent.nodes).filter((n) => !("children" in n))).toHaveLength(1);
      });

      it("the door hands on a tree in which every node has a list", async () => {
        const article = await throughTheDoor(tree(), footing);
        for (const n of Object.values(article.tree.nodes)) expect(Array.isArray(n.children), n.id).toBe(true);
      });

      it("buildGeometry builds, one chain per block", async () => {
        const article = await throughTheDoor(tree(), footing);
        const geometry = buildGeometry(article.tree, article.blocks);
        expect(geometry.cells[0]?.reduce((rows, c) => rows + c.rowSpan, 0)).toBe(BLOCKS.length);
      });

      it("buildOutline builds", async () => {
        const article = await throughTheDoor(tree(), footing);
        expect(Array.isArray(buildOutline(article.tree, article.blocks, 3))).toBe(true);
      });

      it("buildSummaryTree builds, at full depth", async () => {
        const article = await throughTheDoor(tree(), footing);
        expect(buildSummaryTree(article.tree, article.blocks, 9)?.node.id).toBe("n0");
      });

      it("marginaliaNotes builds", async () => {
        const article = await throughTheDoor(tree(), footing);
        expect(marginaliaNotes(article.tree, article.blocks, null)).toBeInstanceOf(Map);
      });

      it("isCrumbSection answers for every node the breadcrumb could be asked about", async () => {
        const article = await throughTheDoor(tree(), footing);
        /* Cut at depth 1, as Reader cuts at the section depth: the parts are
           built and their own lists are not walked, so it is `isCrumbSection`
           and not the projection that first reads a part's list. */
        const root = buildSummaryTree(article.tree, article.blocks, 1);
        for (const part of root?.children ?? []) expect(typeof isCrumbSection(part)).toBe("boolean");
        for (const n of Object.values(article.tree.nodes)) {
          expect(typeof isCrumbSection({ node: n } as Parameters<typeof isCrumbSection>[0])).toBe("boolean");
        }
      });

      it("whereForBlock answers for every block", async () => {
        const article = await throughTheDoor(tree(), footing);
        for (const b of BLOCKS) expect(Array.isArray(whereForBlock(article.tree, rowOf, b.id))).toBe(true);
      });
    });
  }
}

describe("a node with no list is a leaf, and nothing else is lost", () => {
  it("a root with no list draws as the root alone, and an inner node as a leaf", async () => {
    const rootless = await throughTheDoor(without("n0"), "owned");
    /* The columns are counted from the nodes' depths, so they are all still
       there; what is short is the chain, which never leaves the root. */
    const cells = buildGeometry(rootless.tree, rootless.blocks).cells.flat();
    expect(cells.length).toBeGreaterThan(0);
    expect(new Set(cells.map((c) => c.node.id))).toEqual(new Set(["n0"]));
    expect(buildOutline(rootless.tree, rootless.blocks, 3)).toEqual([]);

    const inner = await throughTheDoor(without("n1"), "owned");
    const outline = buildOutline(inner.tree, inner.blocks, 3);
    expect(outline.map((e) => e.node.id), "both parts are still drawn").toEqual(["n1", "n5"]);
    expect(outline[0]?.children, "and the one with no list has nothing under it").toEqual([]);
    expect(marginaliaNotes(inner.tree, inner.blocks, null).get("spya-aaaaaa")?.[0]).toMatchObject({
      kind: "question",
      text: "What does part one ask?",
    });
  });
});

describe("the control: a well-formed tree is not touched", () => {
  it("withChildLists hands back the identical object", () => {
    const tree = whole();
    expect(withChildLists(tree)).toBe(tree);
  });

  it("and a mended tree keeps every node it did not have to mend", () => {
    const tree = without("n1");
    const mended = withChildLists(tree);
    expect(mended).not.toBe(tree);
    expect(mended.nodes.n1?.children).toEqual([]);
    expect(mended.nodes.n2, "an untouched node is the same object").toBe(tree.nodes.n2);
    expect("children" in tree.nodes.n1!, "the argument is not rewritten").toBe(false);
  });

  it("through the door, a well-formed tree still draws everything it has", async () => {
    /* So the cases above cannot pass because the door emptied every tree. */
    const article = await throughTheDoor(whole(), "owned");
    expect(article.tree).toEqual(whole());
    expect(buildGeometry(article.tree, article.blocks).columnDepths).toEqual([0, 1, 2, 3]);
    expect(whereForBlock(article.tree, rowOf, "spya-aaaaaa").length).toBeGreaterThan(0);
  });
});

describe("buildChains keeps a guard of its own", () => {
  /* It is the reported crash, and scripts and tests hand it a tree that never
     went near the door. */
  it.each(CASES)("buildGeometry on a raw tree: $name", ({ tree }) => {
    const raw = tree();
    expect(() => buildGeometry(raw, BLOCKS)).not.toThrow();
  });
});
