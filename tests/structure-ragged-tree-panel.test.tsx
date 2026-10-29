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
import { StructurePanel, unitFits } from "../src/web/StructurePanel.js";
import type { StructureRow } from "../src/web/structure.js";
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

    const paragraphs = rows.filter((li) => li.classList.contains("paragraph"));
    if (expanded) {
      expect(paragraphs).toEqual([]);
    } else {
      /* jsdom has no height, so the visible list stays on its rung-3 floor.
         Inspect the real rung-5 measuring markup: it shares `rowClass` and
         `RowBody` with the visible list specifically so this is not a mock. */
      const candidate = host.querySelector<HTMLElement>('.outln-measure [data-rung="5"]');
      const candidateParagraphs = [...(candidate?.querySelectorAll<HTMLElement>(".paragraph") ?? [])];
      expect(candidateParagraphs).toHaveLength(MIDBRAIN.children.length);
      expect(candidateParagraphs.every((li) => li.classList.contains("lvl-4"))).toBe(true);
    }
  });
});

/* ------------------------------------------------- the two columns, 1b --
   Plan 261029a § Stage 1b: column B opens the current section's sub-sections
   inside the section's own `<li>`. */

/* Kept verbatim with structure-mode.css § the deepest marked row, as
   tests/structure-panel-draws-both-columns.test.tsx keeps it. */
const DEEPEST_CURRENT =
  ".struct-inner .struct-row[aria-current]:not(.struct-ancestor), " +
  ":is(.struct-grid, .struct-measure):not(:has(> .struct-inner .struct-row[aria-current])) " +
  "> .struct-side:not(.struct-inner) .struct-row[aria-current]";

function renderColumns(onJump: (id: string) => void = () => {}) {
  act(() => {
    reactRoot.render(
      <StructurePanel root={root} figures={[]} focusRow={focusRow} allowParagraphs onJump={onJump} />,
    );
  });
  return host.querySelector<HTMLElement>(".struct-grid > .struct-side.struct-inner")!;
}

describe("the two columns, standing in 2.4.3", () => {
  it("draws 2.4's sub-sections inside its own row, with 2.4 on the path and 2.4.3 the deepest row", () => {
    const sideB = renderColumns();
    /* One row per section in column B's own list: the unit is one `<li>`. */
    const top = [...sideB.querySelectorAll(":scope > .struct-col > li")];
    expect(top).toHaveLength(5);
    const unit = top.find((li) => li.textContent?.includes("Other Theories and Conditions"))!;
    const section = unit.querySelector(":scope > button")!;
    expect(section.classList.contains("struct-ancestor")).toBe(true);
    expect(section.getAttribute("aria-current")).toBe("true");
    expect(section.querySelector(".struct-gist")).toBeNull();

    const subs = [...unit.querySelectorAll(":scope > ol.struct-subs > li > button")];
    expect(subs.map((b) => b.querySelector(".struct-text")?.textContent)).toEqual([
      "Attention Schema Theory",
      "Predictive Processing",
      "Midbrain Theory",
      "Unlimited Associative Learning",
      "Agency and Embodiment",
      "Time and Recurrence",
    ]);
    expect(subs.every((b) => b.classList.contains("struct-subsection"))).toBe(true);
    const current = subs.filter((b) => b.getAttribute("aria-current") === "true");
    expect(current.map((b) => b.querySelector(".struct-text")?.textContent)).toEqual(["Midbrain Theory"]);
    expect(current[0]!.querySelector(".struct-gist")?.textContent).toBe(MIDBRAIN.gist);
  });

  it("has exactly one deepest row, 2.4.3, in the visible grid and in its open measuring copy", () => {
    renderColumns();
    const text = (rows: Element[]) => rows.map((r) => r.querySelector(".struct-text")?.textContent);
    const all = [...host.querySelectorAll(DEEPEST_CURRENT)];
    const inClosed = (r: Element) => r.closest('[data-struct-measure="b-closed"]') !== null;
    for (const measuring of [false, true]) {
      const rows = all.filter((r) => (r.closest(".struct-measure") !== null) === measuring && !inClosed(r));
      expect(text(rows)).toEqual(["Midbrain Theory"]);
    }
    /* The closed candidate is today's column B: 2.4 itself is its deepest row. */
    expect(text(all.filter(inClosed))).toEqual(["Other Theories and Conditions"]);
  });

  it("measures the closed candidate and its count beside the open one, never shown", () => {
    renderColumns();
    const closed = host.querySelector('.struct-measure [data-struct-measure="b-closed"]')!;
    expect(closed.querySelector(".struct-subs")).toBeNull();
    expect(host.querySelector(".struct-measure [data-struct-measure-total]")?.textContent).toBe("6 sub-sections");
    /* Open in jsdom (nothing measured), so no count in the visible column. */
    expect(host.querySelector(".struct-grid > .struct-side .struct-total")).toBeNull();
  });

  it("goes to a sub-section's own first block when it is pressed", () => {
    const onJump = vi.fn();
    const sideB = renderColumns(onJump);
    const target = [...sideB.querySelectorAll<HTMLButtonElement>(".struct-subs button")].find((b) =>
      b.textContent?.includes("Unlimited Associative Learning"),
    )!;
    act(() => target.click());
    expect(onJump).toHaveBeenCalledWith(ragged.nodeOf("2.4.4 Unlimited Associative Learning").range[0]);
  });
});

describe("unitFits: whether the opened section can be drawn", () => {
  const rows = (n: number, unitAt: number) =>
    Array.from({ length: n }, (_, i) => ({ subs: i === unitAt ? [] : undefined }) as unknown as StructureRow);
  it("fits when the whole column does", () => {
    expect(unitFits([20, 200, 20], rows(3, 1), 240, 0, 10)).toBe(true);
  });
  it("fits a windowed column when the unit and both counters do", () => {
    expect(unitFits([20, 200, 20, 20], rows(4, 1), 230, 2, 10)).toBe(true);
  });
  it("does not fit when the unit alone leaves no room for the counters", () => {
    expect(unitFits([20, 200, 20, 20], rows(4, 1), 210, 2, 10)).toBe(false);
  });
  it("draws it open while nothing is measured", () => {
    expect(unitFits([], rows(3, 1), 0, 0, 0)).toBe(true);
  });
});
