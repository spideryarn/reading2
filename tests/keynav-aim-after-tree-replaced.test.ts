// @vitest-environment jsdom
/**
 * **↑ / ↓ step at the new tree's depth once the tree is replaced** —
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
 * § Review record, GPT Sol's F9.
 *
 * `useArrowNav` keeps the aimed depth in a ref initialised once from
 * `fallbackDepth` (src/web/keynav.ts). With a pointer on the page the aim is
 * hit-tested afresh at every press, so it is always resolved against the plan
 * in force. With none — a keyboard-only reader, or a finger — the ref is all
 * there is, and it went on naming the depth of the tree the page opened with.
 *
 * That was invisible while a tree lasted the life of the page. An article
 * opened before its structure is built gets a stand-in whose leaves are at one
 * depth and then, live, a real tree that can be deeper: ↓ then went on
 * stepping a section at a time where it should step a paragraph.
 *
 * A DOM test for keynav-handled.test.ts's reason: the listener is on `window`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";

const jumps: string[] = [];
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return { ...real, scrollToBlock: (id: string) => void jumps.push(id) };
});

const { useArrowNav } = await import("../src/web/keynav.js");
type NavPlan = import("../src/web/keynav.js").NavPlan;

const blocks: Block[] = Array.from({ length: 6 }, (_, i) => ({
  id: `spya-a${i}` as BlockId,
  tag: "p",
  kind: "text",
  text: `paragraph ${i}`,
  words: 20,
  html: "<p></p>",
  gistable: true,
}));

/** The stand-in: its leaves are at depth 1, three rows apart. */
const STAND_IN: NavPlan = { starts: [[0], [0, 3]] };
/** The real tree: one level deeper, a row per paragraph. */
const REAL: NavPlan = { starts: [[0], [0, 3], [0, 1, 2, 3, 4, 5]] };

let container: HTMLDivElement;
let root: Root;

function Harness({ plan, leafDepth }: { plan: NavPlan; leafDepth: number }) {
  useArrowNav(plan, blocks, leafDepth, true);
  return null;
}

async function show(plan: NavPlan, leafDepth: number) {
  await act(async () => {
    root.render(createElement(Harness, { plan, leafDepth }));
  });
}

function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

beforeEach(() => {
  jumps.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("a keyboard-only reader, across a tree replacement", () => {
  it("steps at the stand-in's leaf depth before, as the control", async () => {
    await show(STAND_IN, 1);
    press("ArrowDown");
    expect(jumps).toEqual(["spya-a3"]);
  });

  it("steps at the real tree's leaf depth after", async () => {
    await show(STAND_IN, 1);
    await show(REAL, 2);
    press("ArrowDown");
    expect(jumps, "↓ kept the stand-in's stride").toEqual(["spya-a1"]);
  });

  it("does so after a press too, which is the other thing that writes the aim", async () => {
    await show(STAND_IN, 1);
    press("ArrowDown");
    jumps.length = 0;
    await show(REAL, 2);
    press("ArrowDown");
    /* From the top again: jsdom's page never moves, and the replacement
       dropped the chain. What is asserted is the stride. */
    expect(jumps).toEqual(["spya-a1"]);
  });
});
