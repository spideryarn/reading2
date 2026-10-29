// @vitest-environment jsdom
/**
 * **The list face draws a ragged tree's sub-sections as sections** — the panel
 * half of tests/structure-ragged-tree.test.ts, plan 261029a § Stage 1, items 4
 * and 5.
 *
 * What a projection says and what reaches the DOM are two claims: a row the
 * projection marks as a section can still be given the paragraph's class by
 * the renderer, or lose its `aria-current`. jsdom does no layout, so nothing
 * here is about fit (tests/outline-panel.test.tsx is); it is about which
 * classes and marks the visible rows carry.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlinePanel } from "../src/web/OutlinePanel.js";
import { structureFrontier } from "../src/web/position.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import { raggedArticle } from "./fixtures/ragged-tree.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ragged = raggedArticle();
const geometry = buildGeometry(ragged.tree, ragged.blocks);
const root = buildSummaryTree(ragged.tree, ragged.blocks, geometry.leafDepth);
const MIDBRAIN = ragged.nodeOf("2.4.3 Midbrain Theory");
/* Structure's focus row: the frontier entry for 2.4.3, which is its first row. */
const focusRow = structureFrontier(geometry, ragged.blocks).find((s) => s.nodeId === MIDBRAIN.id)!.row;

let host: HTMLDivElement;
let reactRoot: Root;

function render(expanded: boolean) {
  act(() => {
    reactRoot.render(
      <OutlinePanel
        root={root}
        figures={[]}
        supplementOf={geometry.supplementOf}
        arcByRow={null}
        focusRow={focusRow}
        proseBeside
        paragraphLabels
        expanded={expanded}
        onJump={() => {}}
      />,
    );
  });
  /* The visible rows only: the measuring copies are plain `li`s, never tree items. */
  return [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

const sub = (rows: HTMLElement[]) => rows.filter((li) => li.classList.contains("lvl-3"));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe.each([
  ["the fisheye", false],
  ["Expanded", true],
])("%s, standing in 2.4.3", (_name, expanded) => {
  it("draws the six sub-sections at level 3, none of them a paragraph, and marks 2.4.3 as where you are", () => {
    const rows = render(expanded);
    const subs = sub(rows);
    expect(subs).toHaveLength(6);
    for (const li of subs) {
      expect(li.classList.contains("paragraph")).toBe(false);
      expect(li.getAttribute("aria-level")).toBe("3");
    }
    const current = rows.filter((li) => li.getAttribute("aria-current") === "location");
    expect(current.map((li) => li.textContent)).toEqual([expect.stringContaining("Midbrain Theory")]);
    expect(current[0]!.classList.contains("lvl-3")).toBe(true);
    /* Its gist reaches the screen, which a sub-section drawn as a paragraph never had. */
    expect(current[0]!.querySelector(".outln-gist")?.textContent).toBe(MIDBRAIN.gist);
  });
});
