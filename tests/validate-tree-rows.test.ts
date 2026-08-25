/**
 * The row-quality half of the validator: which leaves may carry a navigable
 * label, and how long labels may be. Structural invariants (partitioning,
 * ranges, coverage) are pinned in validate-tree.test.ts; this file is separate
 * so the two can be edited without colliding.
 *
 * The distinction that matters here: structural failures exit non-zero, because
 * a broken partition draws a wrong article. Editorial ones only warn, because a
 * clumsy label is a prompt problem, not a corrupt artefact — and failing the
 * build over prose would train everyone to ignore the validator.
 *
 * Like validate-tree.test.ts, src/validate-tree.ts is a CLI, so it runs as a
 * subprocess. See docs/project/testing.md.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { Block, Tree, TreeNode } from "../src/types.js";

const run = promisify(execFile);

async function validate(dir: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run("npx", ["tsx", "src/validate-tree.ts", dir]);
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** Copy the shipped fixture to a temp dir, let the caller bend the tree, validate. */
async function withTree(
  mutate: (tree: Tree, blocks: Block[]) => void,
): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "spya-rows-"));
  const blocksRaw = await readFile("example/blocks.json", "utf8");
  const blocks = (JSON.parse(blocksRaw) as { blocks: Block[] }).blocks;
  const tree = JSON.parse(await readFile("example/tree.json", "utf8")) as Tree;

  mutate(tree, blocks);

  await writeFile(path.join(dir, "blocks.json"), blocksRaw);
  await writeFile(path.join(dir, "tree.json"), JSON.stringify(tree));
  return validate(dir);
}

const leavesOf = (tree: Tree): TreeNode[] =>
  Object.values(tree.nodes).filter((n) => n.children.length === 0);

const leafFor = (tree: Tree, blockId: string): TreeNode =>
  leavesOf(tree).find((n) => n.range[0] === blockId)!;

describe("rows may only anchor to blocks worth reading", () => {
  it("rejects a navLabel on a block marked gistable:false", async () => {
    // spya-d2h6jh is the standalone "Credits" label. A sidebar row for it is
    // the phantom-row failure that `gistable` exists to prevent.
    const { code, out } = await withTree((tree) => {
      leafFor(tree, "spya-d2h6jh").navLabel = "Credits for the images used throughout this piece";
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/gistable:false/);
    expect(out).toMatch(/spya-d2h6jh/);
  });

  it("still requires the unlabelled block to have a leaf, so the partition holds", async () => {
    // Deleting the row is not the fix — every block must be tiled.
    const { code, out } = await withTree((tree) => {
      const leaf = leafFor(tree, "spya-d2h6jh");
      delete tree.nodes[leaf.id];
      const parent = tree.nodes[leaf.parent!]!;
      parent.children = parent.children.filter((id) => id !== leaf.id);
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/not covered by any leaf|children end at index/);
  });

  it("warns, without failing, when a gistable block has no row at all", async () => {
    const { code, out } = await withTree((tree, blocks) => {
      const prose = blocks.find((b) => b.gistable && b.kind === "text")!;
      delete leafFor(tree, prose.id).navLabel;
    });
    expect(code).toBe(0);
    expect(out).toMatch(/unreachable in the ToC/);
  });
});

describe("label length is editorial, so it warns rather than fails", () => {
  it("warns about a paragraph row too short to tell itself from its siblings", async () => {
    const { code, out } = await withTree((tree, blocks) => {
      const prose = blocks.find((b) => b.gistable && b.kind === "text")!;
      leafFor(tree, prose.id).navLabel = "Consciousness";
    });
    expect(code).toBe(0);
    expect(out).toMatch(/navLabel is 1 words/);
  });

  it("exempts a heading leaf, whose label is the author's own short title", async () => {
    // "Soul Machine" is two words and exactly right; the band is for paragraphs,
    // which have no name of their own.
    const { code, out } = await withTree((tree, blocks) => {
      const heading = blocks.find((b) => b.kind === "heading")!;
      leafFor(tree, heading.id).navLabel = "Soul Machine";
    });
    expect(code).toBe(0);
    expect(out).not.toMatch(/navLabel is 2 words/);
  });
});

describe("titles", () => {
  it("warns when a title has grown into a sentence", async () => {
    const { code, out } = await withTree((tree) => {
      const internal = Object.values(tree.nodes).find((n) => n.children.length > 0)!;
      internal.title = "This title has quite obviously grown far too long to scan at a glance";
      delete internal.sourceHeading;
    });
    expect(code).toBe(0);
    expect(out).toMatch(/title is \d+ words/);
  });

  it("does not scold an authored heading for its own punctuation", async () => {
    // "What (Not) To Do?" is Seth's heading, reproduced verbatim on purpose.
    // Flagging it would be telling us off for not rewriting what we chose to keep.
    const { code, out } = await withTree((tree, blocks) => {
      const heading = blocks.find((b) => b.kind === "heading")!;
      const internal = Object.values(tree.nodes).find((n) => n.children.length > 0)!;
      internal.title = "What (Not) To Do?";
      internal.sourceHeading = heading.text;
      internal.range = [heading.id, internal.range[1]];
    });
    expect(out).not.toMatch(/ends with sentence punctuation/);
    expect(code).toBe(0);
  });

  it("rejects a sourceHeading that no heading in the range actually says", async () => {
    // Claiming the author's authority for a title they never wrote is worse
    // than an ugly title, so this one fails rather than warns.
    const { code, out } = await withTree((tree) => {
      const internal = Object.values(tree.nodes).find((n) => n.children.length > 0)!;
      internal.sourceHeading = "A Heading The Author Never Wrote";
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/does not match any heading block/);
  });
});
