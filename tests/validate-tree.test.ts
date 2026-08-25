/**
 * A tree that breaks the invariants doesn't crash the client — it silently
 * draws a wrong article (docs/project/granularity-zoom.md#the-tree). So the
 * validator is the safety net, and these tests check the net has a hole in it
 * exactly where it should: the shipped fixture passes, and each way of breaking
 * a tree fails.
 *
 * src/validate-tree.ts is a CLI (top-level await, process.exit), so it is
 * exercised as a subprocess rather than imported.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { Tree } from "../src/types.js";

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

/** Copy example/ into a temp dir, with `mutate` applied to the tree. */
async function brokenFixture(mutate: (tree: Tree) => void): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-tree-"));
  const tree: Tree = JSON.parse(await readFile("example/tree.json", "utf8"));
  mutate(tree);
  await writeFile(path.join(dir, "tree.json"), JSON.stringify(tree));
  await writeFile(path.join(dir, "blocks.json"), await readFile("example/blocks.json", "utf8"));
  return dir;
}

describe("validate-tree", () => {
  it("passes the shipped example fixture", async () => {
    const { code, out } = await validate("example");
    expect(out).toContain("invariants hold");
    expect(code).toBe(0);
  }, 30_000);

  it("fails a tree whose children leave a gap in their parent", async () => {
    const dir = await brokenFixture((tree) => {
      const parent = Object.values(tree.nodes).find((n) => n.children.length > 1)!;
      parent.children = parent.children.slice(1); // drop the first child
    });
    const { code, out } = await validate(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/gap|not covered by any leaf/);
  }, 30_000);

  it("fails a tree with an internal node that has no gist", async () => {
    const dir = await brokenFixture((tree) => {
      const internal = Object.values(tree.nodes).find((n) => n.children.length > 0 && n.gist)!;
      delete internal.gist;
    });
    const { code, out } = await validate(dir);
    expect(code).toBe(1);
    expect(out).toContain("no gist");
  }, 30_000);

  it("fails a leaf that carries a gist, since a leaf renders verbatim text", async () => {
    const dir = await brokenFixture((tree) => {
      const leaf = Object.values(tree.nodes).find((n) => n.children.length === 0)!;
      leaf.gist = "A summary standing where the real paragraph should be.";
    });
    const { code, out } = await validate(dir);
    expect(code).toBe(1);
    expect(out).toContain("leaf carries a gist");
  }, 30_000);

  it("fails a range pointing at a block id that isn't in blocks.json", async () => {
    const dir = await brokenFixture((tree) => {
      tree.nodes[tree.rootId]!.range[1] = "spya-zzzzzz";
    });
    const { code, out } = await validate(dir);
    expect(code).toBe(1);
    expect(out).toContain("not in blocks.json");
  }, 30_000);
});
