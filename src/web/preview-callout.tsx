/**
 * A throwaway page for looking at how a callout is set, beside the two
 * treatments it has to be distinguishable from.
 *
 * It mounts the **real** `TableView` with the real stylesheet, inside a
 * `.reader`, and does it outside the auth gate — every article in the local
 * database is private and a browser agent has no session
 * (docs/project/browser-testing.md).
 *
 * **The blocks are real**, twenty of them lifted out of
 * `data/openai-huggingface/blocks.json` (the article this feature was built
 * for) into preview-callout-fixture.json: body prose, single callouts, a run of
 * four consecutive callouts, two real `<blockquote>` quotations for contrast,
 * and one synthetic caption block, which that article has none of. Invented
 * text would have answered a different question — the whole judgement here is
 * whether a reader can tell a callout from a quotation while reading past both.
 *
 * Delete this file, preview-callout.html and the fixture when the check is
 * done; nothing links to any of them. See docs/plans/260831ae-callouts-the-box-the-author-drew.md.
 */
import { createRoot } from "react-dom/client";
import { TableView } from "./TableView.js";
import { buildGeometry } from "./tree.js";
import { buildSections } from "./position.js";
import type { Article, Block, BlockId, Tree, TreeNode } from "../types.js";
import FIXTURE from "./preview-callout-fixture.json";
import "./tailwind.css";

const BLOCKS = FIXTURE as Block[];
const first = BLOCKS[0]?.id as BlockId;
const last = BLOCKS[BLOCKS.length - 1]?.id as BlockId;

/** A minimal two-deep tree: root → one part → a leaf per block. */
function buildTree(): Tree {
  const nodes: Record<string, TreeNode> = {};
  const leafIds: string[] = [];
  for (const [i, b] of BLOCKS.entries()) {
    const leaf = `n-l-${i}`;
    nodes[leaf] = {
      id: leaf,
      depth: 2,
      parent: "n-p",
      children: [],
      range: [b.id, b.id],
      title: "",
      navLabel: `block ${i}`,
    };
    leafIds.push(leaf);
  }
  nodes["n-p"] = {
    id: "n-p",
    depth: 1,
    parent: "n-r",
    children: leafIds,
    range: [first, last],
    title: "The only part",
    gist: "One part, because the question here is about how a block is set.",
  };
  nodes["n-r"] = {
    id: "n-r",
    depth: 0,
    parent: null,
    children: ["n-p"],
    range: [first, last],
    title: "Callout preview",
    gist: "A fixture article for looking at callouts, quotations and captions together.",
  };
  return { version: "1", generator: "preview", slug: "preview", rootId: "n-r", nodes };
}

const tree = buildTree();
const geometry = buildGeometry(tree, BLOCKS);
const sections = buildSections(geometry, BLOCKS);

const ARTICLE: Article = {
  meta: { slug: "preview", title: "Callout preview" },
  blocks: BLOCKS,
  tree,
  assets: undefined,
  navLabelStatus: "ready",
};

/** The prose column on its own, at one width, with no gist columns beside it. */
function Frame({ width, label }: { width: number; label: string }) {
  return (
    <div style={{ width, flex: "none", borderRight: "1px solid #333" }}>
      <p style={{ font: "12px system-ui", color: "#888", margin: "0 0 4px", paddingLeft: 8 }}>
        {label} — {width}px
      </p>
      <div className="reader" style={{ width, ["--mode-w" as string]: "0px" }}>
        <TableView
          article={ARTICLE}
          /* A preview page, not the reader: no view state to carry. */
          /* A preview page, not the reader: the address is the design page itself
             and there is no view state to carry. */
          linkBase="/design"
          geometry={geometry}
          columns={[]}
          layout={{ widths: [width - 12], tableW: width, overflowing: false }}
          showText
          onJump={() => {}}
          comments={[]}
          openComment={null}
          onSelect={() => {}}
          onOpenComment={() => {}}
          chats={[]}
          chatCounts={new Map()}
          openChat={null}
          onOpenChat={() => {}}
          onChatAbout={() => {}}
          sections={sections}
          layoutKey={`${width}`}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
    <Frame width={860} label="laptop" />
    <Frame width={390} label="phone" />
  </div>,
);
