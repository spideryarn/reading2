// @vitest-environment jsdom
/**
 * **Structure's Hover view: a mouse resting on a row goes there, quietly.**
 *
 * The rules the dwell exists for (src/web/useHoverGlance.ts): only after the
 * mouse has rested, only on a *move* (a row sliding under a still mouse must not
 * set one off), never on a row the reader is already in, never for a finger,
 * and no row card in this view. Fisheye, with no `onGlance`, is unchanged.
 *
 * What jsdom cannot say: whether the prose and column B actually follow, and
 * whether it feels right — the browser spike in
 * docs/plans/261024k-structure-hover-submode.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subModeRows } from "../src/web/CommandBar.js";
import { StructurePanel } from "../src/web/StructurePanel.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import { GLANCE_DWELL_MS } from "../src/web/useHoverGlance.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

/** Three parts of two sections each; the reader stands in part two. */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-h${String(n).padStart(4, "0")}` as BlockId;
  const block = () => {
    const n = blocks.length;
    blocks.push({ id: id(n), tag: "p", kind: "text", text: `block ${n}`, words: 40, html: `<p>block ${n}</p>`, gistable: true });
    return n;
  };
  const parts: NodeId[] = [];
  for (const [key, title] of [["n-p1", "PART ONE"], ["n-p2", "PART TWO"], ["n-p3", "PART THREE"]] as const) {
    const first = blocks.length;
    const kids: NodeId[] = [];
    for (const s of ["ALPHA", "BETA"]) {
      const s0 = block();
      const s1 = block();
      const sid = `${key}-${s}` as NodeId;
      nodes[sid] = { id: sid, depth: 2, parent: key as NodeId, children: [], range: [id(s0), id(s1)], title: `${title} ${s}`, gist: `${s} gist.` };
      kids.push(sid);
    }
    nodes[key as NodeId] = { id: key as NodeId, depth: 1, parent: "n-r" as NodeId, children: kids, range: [id(first), id(blocks.length - 1)], title, gist: `${title} gist.` };
    parts.push(key as NodeId);
  }
  nodes["n-r" as NodeId] = { id: "n-r" as NodeId, depth: 0, parent: null, children: parts, range: [id(0), id(blocks.length - 1)], title: "Root", gist: "Root gist." };
  return { tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes }, blocks };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const summaryRoot = buildSummaryTree(tree, blocks, geometry.leafDepth);
const IN_PART_TWO = blocks.findIndex((x) => x.id === tree.nodes["n-p2" as NodeId]?.range[0]);
const PART_ONE_START = tree.nodes["n-p1" as NodeId]!.range[0];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(
  onGlance: ((id: BlockId) => void) | undefined,
  onJump: (id: BlockId) => void = () => {},
  focusRow = IN_PART_TWO,
) {
  act(() => {
    reactRoot.render(
      <StructurePanel root={summaryRoot} figures={[]} focusRow={focusRow} allowParagraphs={false} onJump={onJump} onGlance={onGlance} />,
    );
  });
}

/** The visible column A's rows — not the measuring copies, which come first. */
function columnA(): HTMLElement[] {
  const side = host.querySelector(".struct-grid > .struct-side");
  return [...(side?.querySelectorAll<HTMLElement>(".struct-row") ?? [])];
}
function rowNamed(text: string): HTMLElement {
  const row = columnA().find((r) => r.textContent?.includes(text));
  if (!row) throw new Error(`no visible row "${text}"`);
  return row;
}

/** A pointer event React will read: jsdom has no PointerEvent, so a MouseEvent wearing a pointerType. */
let x = 0;
function pointer(
  el: HTMLElement,
  type: "pointermove" | "pointerout" | "pointerdown",
  pointerType = "mouse",
  related: Element | null = null,
  /** Where the mouse is; a fresh place each call unless given, as a real move would be. */
  clientX = ++x,
) {
  const e = new MouseEvent(type, { bubbles: true, relatedTarget: related, clientX, clientY: 10 });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  act(() => {
    el.dispatchEvent(e);
  });
}
function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

it("a mouse resting on a part goes there once, after the dwell, quietly", () => {
  const glance = vi.fn();
  const jump = vi.fn();
  render(glance, jump);
  const one = rowNamed("PART ONE");
  pointer(one, "pointermove");
  wait(GLANCE_DWELL_MS - 10);
  expect(glance).not.toHaveBeenCalled();
  pointer(one, "pointermove");
  wait(20);
  expect(glance).toHaveBeenCalledTimes(1);
  expect(glance).toHaveBeenCalledWith(PART_ONE_START);
  /* Wandering inside the same row does not go again. */
  pointer(one, "pointermove");
  wait(GLANCE_DWELL_MS * 3);
  expect(glance).toHaveBeenCalledTimes(1);
  /* The quiet path, never the history-pushing one. */
  expect(jump).not.toHaveBeenCalled();
});

it("leaving before the dwell ends goes nowhere", () => {
  const glance = vi.fn();
  render(glance);
  const one = rowNamed("PART ONE");
  pointer(one, "pointermove");
  wait(GLANCE_DWELL_MS / 2);
  pointer(one, "pointerout", "mouse", host);
  wait(GLANCE_DWELL_MS * 3);
  expect(glance).not.toHaveBeenCalled();
});

it("crossing a row on the way to another goes only to the one the mouse rests on", () => {
  const glance = vi.fn();
  render(glance);
  pointer(rowNamed("PART ONE"), "pointermove");
  wait(GLANCE_DWELL_MS / 2);
  pointer(rowNamed("PART ONE"), "pointerout", "mouse", rowNamed("PART THREE"));
  pointer(rowNamed("PART THREE"), "pointermove");
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).toHaveBeenCalledTimes(1);
  expect(glance).toHaveBeenCalledWith(tree.nodes["n-p3" as NodeId]!.range[0]);
});

it("the part the reader is in, and a finger, go nowhere", () => {
  const glance = vi.fn();
  render(glance);
  pointer(rowNamed("PART TWO"), "pointermove");
  wait(GLANCE_DWELL_MS * 2);
  pointer(rowNamed("PART ONE"), "pointermove", "touch");
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).not.toHaveBeenCalled();
});

it("a row sliding under a still mouse is not a move, so it goes nowhere", () => {
  const glance = vi.fn();
  render(glance);
  act(() => {
    rowNamed("PART ONE").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).not.toHaveBeenCalled();
});

it("a press inside the dwell is the click's alone: the glance is cancelled", () => {
  const glance = vi.fn();
  render(glance);
  const one = rowNamed("PART ONE");
  pointer(one, "pointermove");
  wait(GLANCE_DWELL_MS / 2);
  pointer(one, "pointerdown");
  wait(GLANCE_DWELL_MS * 3);
  expect(glance).not.toHaveBeenCalled();
});

it("a click fences off a same-coordinate move, so its jump is not followed by a glance", () => {
  const glance = vi.fn();
  render(glance);
  const one = rowNamed("PART ONE");
  pointer(one, "pointermove", "mouse", null, 500);
  wait(GLANCE_DWELL_MS / 2);
  pointer(one, "pointerdown", "mouse", null, 500);
  /* A relayout during the click's glide can make the browser report a move
     without the physical mouse having moved. It must not arm a quiet scroll
     behind the history-pushing click. */
  pointer(one, "pointermove", "mouse", null, 500);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).not.toHaveBeenCalled();

  pointer(one, "pointermove", "mouse", null, 501);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).toHaveBeenCalledTimes(1);
});

it("leaving Hover cancels its pending dwell", () => {
  const glance = vi.fn();
  render(glance);
  pointer(rowNamed("PART ONE"), "pointermove");
  wait(GLANCE_DWELL_MS / 2);

  /* StructurePanel stays mounted when Hover changes to Fisheye; only this
     prop disappears, so the hook itself must retire the old view's timer. */
  render(undefined);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).not.toHaveBeenCalled();
});

it("a row that becomes current during the dwell does not use its stale here guard", () => {
  const glance = vi.fn();
  render(glance);
  pointer(rowNamed("PART ONE"), "pointermove");
  wait(GLANCE_DWELL_MS / 2);

  /* The focus sampler can move for reasons outside this row's handlers. Its
     rerender recreates the row, but the armed callback captured the old one. */
  render(glance, () => {}, 0);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).not.toHaveBeenCalled();
});

it("a press elsewhere cancels a pending dwell on a hybrid pointer device", () => {
  const glance = vi.fn();
  render(glance);
  pointer(rowNamed("PART ONE"), "pointermove");
  wait(GLANCE_DWELL_MS / 2);
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).not.toHaveBeenCalled();
});

it("after a glance, a move to the same coordinates arms nothing; a real move does", () => {
  const glance = vi.fn();
  render(glance);
  pointer(rowNamed("PART ONE"), "pointermove", "mouse", null, 500);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).toHaveBeenCalledTimes(1);
  /* The rows re-laid out and another one is now under the still mouse: the
     browser may report a move at the same place. It must not count. */
  pointer(rowNamed("PART THREE"), "pointermove", "mouse", null, 500);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).toHaveBeenCalledTimes(1);
  pointer(rowNamed("PART THREE"), "pointermove", "mouse", null, 501);
  wait(GLANCE_DWELL_MS * 2);
  expect(glance).toHaveBeenCalledTimes(2);
});

it("the command bar offers Hover only behind the switch, or when a link has it open", () => {
  const hover = (rows: ReturnType<typeof subModeRows>) =>
    rows.filter((r) => r.kind === "submode" && r.sub.mode === "structure" && r.sub.view === "hover").length;
  expect(hover(subModeRows(["structure"], false, { diagram: "sketch", learn: undefined }))).toBe(0);
  expect(hover(subModeRows(["structure"], true, { diagram: "sketch", learn: undefined }))).toBe(1);
  expect(
    hover(subModeRows(["structure"], false, { diagram: "sketch", learn: undefined, structure: "hover" })),
  ).toBe(1);
});

it("no row card in Hover; Fisheye keeps them and never glances", () => {
  render(vi.fn());
  act(() => {
    rowNamed("PART ONE").dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1_000);
  });
  expect(document.querySelector(".tip-struct")).toBeNull();

  render(undefined);
  pointer(rowNamed("PART ONE"), "pointermove");
  act(() => {
    rowNamed("PART ONE").dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1_000);
  });
  expect(document.querySelector(".tip-struct")).not.toBeNull();
});
