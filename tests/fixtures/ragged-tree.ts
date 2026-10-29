/**
 * **A ragged tree**: one section divided into sub-sections, its neighbours not
 * — the shape plan 261029a's stage 1 makes the reading view cope with before
 * anything in the pipeline produces it.
 *
 * Shaped like the paper Greg was reading (arXiv 2308.08708, spya-pn7gvw): part
 * 2, "Scientific Theories of Consciousness", whose last section "2.4 Other
 * Theories and Conditions" holds the author's six sub-sections. Titles only;
 * the gists are made up and there is no prose. 2.4 opens with one paragraph of
 * its own before 2.4.1, so it has a leaf *and* sub-sections as children — the
 * mixed shape a model's tree can have, and the one the guards are for.
 *
 *   root
 *   ├─ 1 Introduction                   1.1, 1.2           (leaves at depth 3)
 *   ├─ 2 Scientific Theories of …       Aims, 2.1 … 2.3    (leaves at depth 3)
 *   │                                   2.4 ─ intro leaf   (depth 3)
 *   │                                       └ 2.4.1 … 2.4.6 (leaves at depth 4)
 *   └─ 3 Implications                   3.1, 3.2           (leaves at depth 3)
 *
 * `notes` appends the apparatus the way the pipeline does (src/supplement.ts §
 * `appendSupplement`), so a supplement sits beside a body two levels deeper.
 */
import { appendSupplement, splitBlocks } from "../../src/supplement.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../../src/types.js";

export interface RaggedArticle {
  tree: Tree;
  blocks: Block[];
  /** The first row of each node, by title — derived, so a change to the shape cannot leave a test pointing at the wrong row. */
  rowOf(title: string): number;
  /** The node with this title. */
  nodeOf(title: string): TreeNode;
}

/** [title, blocks] for a section with no sub-sections; [title, intro paras, sub-sections] for one with. */
type SectionSpec = readonly [string, number] | readonly [string, number, readonly (readonly [string, number])[]];

const SHAPE: readonly (readonly [string, readonly SectionSpec[]])[] = [
  [
    "Introduction",
    [
      ["1.1 Terminology", 3],
      ["1.2 Methods and Assumptions", 3],
    ],
  ],
  [
    "Scientific Theories of Consciousness",
    [
      ["Aims of the Survey", 2],
      ["2.1 Recurrent Processing Theory", 3],
      ["2.2 Global Workspace Theory", 3],
      ["2.3 Higher-Order Theories", 3],
      [
        "2.4 Other Theories and Conditions",
        1,
        [
          ["2.4.1 Attention Schema Theory", 2],
          ["2.4.2 Predictive Processing", 2],
          ["2.4.3 Midbrain Theory", 2],
          ["2.4.4 Unlimited Associative Learning", 2],
          ["2.4.5 Agency and Embodiment", 3],
          ["2.4.6 Time and Recurrence", 2],
        ],
      ],
    ],
  ],
  [
    "Implications",
    [
      ["3.1 Implementing Indicator Properties in AI", 3],
      ["3.2 Case Studies", 2],
    ],
  ],
];

/** A note block, as stage 3 leaves them (tests/supplement.test.ts § note). */
function note(i: number): Block {
  return {
    id: `spya-rnote${i}`,
    tag: "p",
    kind: "text",
    text: `Note ${i}.`,
    words: 2,
    html: `<p id="spya-rnote${i}">Note ${i}.</p>`,
    gistable: true,
    role: "footnote",
    treatment: "supplement",
    noteId: `rn${i}`,
  };
}

export function raggedArticle({ notes = 0 }: { notes?: number } = {}): RaggedArticle {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const bid = (n: number) => `spya-r${String(n).padStart(4, "0")}` as BlockId;
  let seq = 0;
  const nid = () => `n${String(++seq).padStart(3, "0")}` as NodeId;

  const leaf = (parent: NodeId, depth: number): NodeId => {
    const row = blocks.length;
    blocks.push({
      id: bid(row),
      tag: "p",
      kind: "text",
      text: `Paragraph ${row}.`,
      words: 2,
      html: `<p>Paragraph ${row}.</p>`,
      gistable: true,
    });
    const id = nid();
    nodes[id] = {
      id,
      depth,
      parent,
      children: [],
      range: [bid(row), bid(row)],
      title: "",
      navLabel: `paragraph ${row}`,
    };
    return id;
  };
  /** An internal node over the rows its children took. */
  const internal = (id: NodeId, parent: NodeId, depth: number, title: string, children: NodeId[]) => {
    const first = nodes[children[0]!]!.range[0];
    const last = nodes[children[children.length - 1]!]!.range[1];
    nodes[id] = {
      id,
      depth,
      parent,
      children,
      range: [first, last],
      title,
      gist: `What “${title}” argues, in one made-up sentence.`,
    };
  };

  const rootId = "n000" as NodeId;
  const partIds: NodeId[] = [];
  for (const [partTitle, sections] of SHAPE) {
    const partId = nid();
    const sectionIds: NodeId[] = [];
    for (const spec of sections) {
      const sectionId = nid();
      const kids: NodeId[] = [];
      for (let p = 0; p < spec[1]; p++) kids.push(leaf(sectionId, 3));
      if (spec.length === 3) {
        for (const [subTitle, paras] of spec[2]) {
          const subId = nid();
          const subKids = Array.from({ length: paras }, () => leaf(subId, 4));
          internal(subId, sectionId, 3, subTitle, subKids);
          kids.push(subId);
        }
      }
      internal(sectionId, partId, 2, spec[0], kids);
      sectionIds.push(sectionId);
    }
    internal(partId, rootId, 1, partTitle, sectionIds);
    partIds.push(partId);
  }
  internal(rootId, null as unknown as NodeId, 0, "Consciousness in Artificial Intelligence", partIds);
  nodes[rootId]!.parent = null;

  let tree: Tree = { version: "1", generator: "test", slug: "ragged", rootId, nodes };
  let all = blocks;
  if (notes > 0) {
    all = [...blocks, ...Array.from({ length: notes }, (_, i) => note(i + 1))];
    tree = appendSupplement(tree, splitBlocks(all).groups);
  }

  const order = new Map(all.map((b, i) => [b.id, i]));
  const nodeOf = (title: string): TreeNode => {
    const found = Object.values(tree.nodes).find((n) => n.title === title);
    if (!found) throw new Error(`ragged fixture: no node titled ${title}`);
    return found;
  };
  return {
    tree,
    blocks: all,
    nodeOf,
    rowOf: (title) => order.get(nodeOf(title).range[0])!,
  };
}
