// @vitest-environment jsdom
/**
 * **A missing label must never be drawn as a blank row.**
 *
 * `navLabel` is optional on a `TreeNode`, and until 2026-09-06 an absent one
 * meant exactly one thing — *deliberately unlabelled*, a caption or a
 * pull-quote. The `Paragraphs` column renders `navLabel ?? title`, and a leaf's
 * `title` is normally `""`, so a label that is merely **not written yet** comes
 * out as an empty cell that reads as a paragraph the article could not name.
 * `src/web/tree.ts` already names the shape of it: *"a run of forty blank leaf
 * cells"*.
 *
 * Stage 2 of docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md
 * makes that state real for a minute or two after every ingest, by taking the
 * label pass out of the blocking step. This file is stage 1's half: the whole
 * layer is withheld while the labels are `pending` or `failed`, and where the
 * reader asked for it by name they get one sentence instead
 * (src/web/nav-labels.ts).
 *
 * ## Why both halves of every case
 *
 * Each case asserts the withholding **and** that the same fixture draws the
 * labels when the status says `ready`. A component that threw, or a fixture
 * with no labels in it, withholds everything and would read as a pass — the
 * shape docs/reusable/silent-success.md is about. The `ready` half is the
 * positive control, and it is also what pins stage 1's promise that nothing
 * visible changed today.
 *
 * The outline half is `outlineProjection`, which is pure and is the one place
 * that decides both what rung 5 draws and which row is current
 * (src/web/outline.ts). `OutlinePanel` measures; the rule is here.
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Both mocks as in tests/prose-not-rebuilt.test.tsx, and for the same reasons:
   the render probe patches timers and fetch globally, and Floating UI does real
   geometry that jsdom has not got. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { TableView } from "../src/web/TableView.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { outlineProjection } from "../src/web/outline.js";
import { paragraphLabelNotice } from "../src/web/nav-labels.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, NavLabelStatus } from "../src/types.js";

const DIR = "tests/fixtures/data-root/data/noema-mythology-of-conscious-ai";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type Loaded = Awaited<ReturnType<typeof readArticleFromDir>>;

/**
 * The fixture as an `Article`, at one status.
 *
 * `assets: undefined` for the reason tests/prose-not-rebuilt.test.tsx gives:
 * the directory loader hands back the on-disk shape, and the missing manifest
 * is a real third state rather than a gap to paper over.
 */
function articleAt(loaded: Loaded, navLabelStatus: NavLabelStatus): Article {
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  return {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus,
  };
}

/**
 * `TableView` with the leaf column **open**, which is the only way a reader
 * reaches it: `?cols=` naming the leaf depth, or the `Paragraphs` pill, which is
 * the same thing written by hand (`toggle` in src/web/App.tsx).
 *
 * `chosen` rather than `showText: false`, and that is a correction rather than a
 * preference. The table's own outline mode — text column off, leaf column as the
 * view — is where a first draft of this file drew the withheld column, and it is
 * **unreachable**: nothing sets `showText` false any more and `?text=0` is
 * rewritten to `?mode=outline`, which is the band rather than this table
 * (docs/project/browser-testing.md, confirmed in a browser 2026-09-06). A test
 * written against it would have been about a layout no reader can be in.
 */
function propsFor(article: Article) {
  const geometry = buildGeometry(article.tree, article.blocks);
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const fit = fitView({
    windowWidth: 1400,
    gistDepths,
    leafDepth: geometry.leafDepth,
    showText: true,
    chosen: [...gistDepths.filter((d) => d > 0), geometry.leafDepth],
  });
  return {
    article,
    geometry,
    columns: fit.columns,
    layout: fit,
    showText: true,
    comments: [],
    openComment: null,
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    sections: [],
    layoutKey: "test",
  };
}

/**
 * `TableView` in **reading mode with the leaf column off** — the default, and
 * the state every reader is actually in.
 *
 * `fitView` does not open the leaf column unless the reader asks for it (the
 * `Paragraphs` pill, or a `?cols=` naming its depth), so this is the layout the
 * withheld column must **not** appear in: `<colgroup>` allocates one `<col>`
 * per entry in `columns` plus one for the prose, and a row that emits an extra
 * `<td>` takes the prose column's width for itself.
 */
function propsWithoutLeaf(article: Article) {
  const geometry = buildGeometry(article.tree, article.blocks);
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const fit = fitView({
    windowWidth: 1400,
    gistDepths,
    leafDepth: geometry.leafDepth,
    showText: true,
    chosen: null,
  });
  return { ...propsFor(article), columns: fit.columns, layout: fit, showText: true };
}

/** Every leaf cell's text, in document order. */
function leafCells(): string[] {
  const depth = Number(
    host.querySelector("td.gist.leaf")?.getAttribute("data-nav-depth") ?? "-1",
  );
  return Array.from(host.querySelectorAll(`td.gist.leaf[data-nav-depth="${depth}"]`)).map(
    (td) => td.textContent?.trim() ?? "",
  );
}

async function draw(article: Article): Promise<void> {
  await act(async () => {
    root.render(createElement(TableView, propsFor(article) as never));
  });
}

describe("the Paragraphs column", () => {
  it("draws a label per paragraph when the labels are ready", async () => {
    /* **The positive control, and it comes first.** Everything below asserts an
       absence, and an absence is what a broken fixture, a component that threw
       and a column that was never rendered all look like.

       **Not "no blank cells at all", and that is the whole distinction this
       feature rests on.** Measured on this fixture, 2026-09-06: 24 of its leaf
       cells are empty with the labels fully written, because a leaf whose block
       is not `isStructural` — a caption, a rule, an endnote — is
       *deliberately* unlabelled and always has been (src/hierarchy.ts). That
       kind of absence is the article's own shape and stays. What must not
       happen is the *other* kind, where every cell is empty because nothing has
       been written yet, and the reader cannot tell the two apart. */
    const loaded = await readArticleFromDir(DIR);
    await draw(articleAt(loaded, "ready"));

    const cells = leafCells();
    expect(cells.length, "no leaf column drawn — every assertion below would be vacuous")
      .toBeGreaterThan(10);
    const labelled = cells.filter((text) => text !== "");
    expect(labelled.length, "the fixture's labels did not render").toBeGreaterThan(
      cells.length / 2,
    );
    /* And the withheld column is not drawn over an article that has its labels. */
    expect(cells).not.toContain(paragraphLabelNotice("pending"));
    expect(host.querySelector(".labels-withheld")).toBeNull();
  });

  it("draws no blank cells while the labels are still arriving", async () => {
    /* The regression this file exists for. Before stage 1 this fixture rendered
       one empty `<td>` per paragraph, and nothing anywhere said why. */
    const loaded = await readArticleFromDir(DIR);
    await draw(articleAt(loaded, "pending"));

    const cells = leafCells();
    expect(cells.filter((text) => text === "")).toHaveLength(0);
    /* One cell, not one per paragraph: the column says its piece once and spans
       the table, so the sentence is not repeated down the page. */
    expect(cells).toEqual([paragraphLabelNotice("pending")]);
  });

  it("says the other sentence when a run failed", async () => {
    /* Two different absences, and the reader is owed the difference: one
       finishes on its own and the other does not. A single "not available" for
       both would have somebody waiting for labels that are not coming. */
    const loaded = await readArticleFromDir(DIR);
    await draw(articleAt(loaded, "failed"));
    expect(leafCells()).toEqual([paragraphLabelNotice("failed")]);
  });

  it("keeps every other column, because only the paragraph layer is withheld", async () => {
    /* "Withhold the layer" is not "withhold the table". A pending article is
       still readable at every other granularity, and a reading view that lost
       its sections — or its prose — would be a far larger regression than the
       one being fixed. That second half is not hypothetical: it is what the
       first version of this did, by emitting a cell the `<colgroup>` had no
       column for (see the case further down).

       **Cells, not their text.** In reading mode a gist cell under a fisheye
       panel deliberately draws nothing and the panel carries its content
       (TableView § `!(panels && …)`), so a text assertion here would be about
       the panels rather than about this feature. */
    const loaded = await readArticleFromDir(DIR);
    const geometry = buildGeometry(loaded.tree, loaded.blocks);
    await draw(articleAt(loaded, "pending"));

    for (const depth of geometry.columnDepths.filter((d) => d > 0 && d < geometry.leafDepth)) {
      expect(
        host.querySelectorAll(`td.gist[data-nav-depth="${depth}"]`).length,
        `depth ${depth} lost its column`,
      ).toBeGreaterThan(0);
    }
    /* And the prose, which is the column the bug below took the width from. */
    expect(host.querySelectorAll("tbody td.text").length).toBe(loaded.blocks.length);
  });
});

describe("a reader who has not opened the column", () => {
  /**
   * **Found in a browser, 2026-09-06, and it made the article's prose
   * invisible.**
   *
   * The withheld cell was drawn whenever the status was not `ready`, with no
   * test that the leaf column was one of the table's columns at all — and it is
   * not, in the default reading view. `<colgroup>` allocates one `<col>` per
   * entry in `columns` plus one for the prose, so the extra `<td>` took the
   * prose column's width and `td.text` came out 0px wide, off the right edge of
   * the window. Nothing errored; the page simply had no article on it.
   *
   * jsdom lays nothing out, so the width is not what is asserted — the **cell
   * count** is, which is the thing that was actually wrong and the thing a
   * browser then turns into a lost column.
   */
  it("draws no withheld column at all when the leaf column is not on screen", async () => {
    const loaded = await readArticleFromDir(DIR);
    const leafDepth = buildGeometry(loaded.tree, loaded.blocks).leafDepth;
    for (const status of ["ready", "pending", "failed"] as const) {
      const props = propsWithoutLeaf(articleAt(loaded, status));
      /* The premise, asserted: if the fit had opened the leaf column this case
         would be about a different layout and would prove nothing. */
      expect(props.columns, "the fit opened the leaf column").not.toContain(leafDepth);
      await act(async () => {
        root.render(createElement(TableView, props as never));
      });
      expect(host.querySelector(".labels-withheld"), status).toBeNull();

      /* And the count, which is what the browser sees as a lost column: at most
         one `<td>` per allocated `<col>`, on every row. */
      const cols = host.querySelectorAll("colgroup col").length;
      for (const tr of Array.from(host.querySelectorAll("tbody tr")).slice(0, 3)) {
        expect(
          tr.querySelectorAll("td").length,
          `${status}: row wider than the colgroup`,
        ).toBeLessThanOrEqual(cols);
      }
    }
  });
});

describe("outline mode's paragraph rung", () => {
  /** Rung 5's rows — level 3 is a paragraph (src/web/outline.ts § `OutlineRow.level`). */
  async function paragraphRows(status: NavLabelStatus): Promise<string[]> {
    const loaded = await readArticleFromDir(DIR);
    const geometry = buildGeometry(loaded.tree, loaded.blocks);
    /* Full depth, which is what App.tsx passes for outline mode — the default
       of 2 stops above the paragraphs and there would be no rung 5 to withhold. */
    const root5 = buildSummaryTree(loaded.tree, loaded.blocks, geometry.leafDepth);
    const projection = outlineProjection({
      root: root5,
      supplementOf: geometry.supplementOf,
      arcByRow: null,
      focusRow: 0,
      rung: 5,
      /* What `OutlinePanel` computes as `allowParagraphs` — the window says yes,
         and the article's status is the other half. */
      allowParagraphs: status === "ready",
    });
    return projection.rows.filter((row) => row.level === 3).map((row) => row.text);
  }

  it("draws paragraph rows when the labels are ready", async () => {
    /* The positive control again: this fixture's current section has to be one
       whose paragraphs rung 5 would actually draw, or the case below asserts
       nothing at all. */
    expect(await paragraphRows("ready")).not.toHaveLength(0);
  });

  it("draws none at all while they are pending", async () => {
    /* Not "draws the ones that exist". A partly-drawn rung is what outline.ts
       calls a lie about the structure: a section of eight paragraphs coming out
       as two, with the shortfall reading as the article's own shape. */
    expect(await paragraphRows("pending")).toHaveLength(0);
  });

  it("draws none after a failure either", async () => {
    expect(await paragraphRows("failed")).toHaveLength(0);
  });
});
