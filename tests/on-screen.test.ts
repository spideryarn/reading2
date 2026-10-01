// @vitest-environment jsdom
/**
 * The pure half of the band's on-screen block links — src/web/on-screen.ts.
 * docs/plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ON_SCREEN_MIN_PX, onScreenIds, onScreenLinkCss, rowCache } from "../src/web/on-screen.js";

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const C = "spya-cccccc";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("rowCache", () => {
  function row(id: string): HTMLTableRowElement {
    const el = document.createElement("tr");
    el.dataset.block = id;
    return el;
  }

  it("keeps connected rows until stale, then reads the table again", () => {
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    const first = row(A);
    const added = row(B);
    body.append(first);
    table.append(body);
    document.body.append(table);

    const freshRows = rowCache();
    expect(freshRows(100)).toEqual([first]);
    body.append(added);
    expect(freshRows(10_100)).toEqual([first]);
    expect(freshRows(10_101)).toEqual([first, added]);
  });

  it("reads again immediately when the cached first or last row disconnects", () => {
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    const oldFirst = row(A);
    const last = row(B);
    body.append(oldFirst, last);
    table.append(body);
    document.body.append(table);

    const freshRows = rowCache();
    expect(freshRows(100)).toEqual([oldFirst, last]);
    const newFirst = row(C);
    oldFirst.replaceWith(newFirst);
    expect(freshRows(101)).toEqual([newFirst, last]);
  });
});

describe("onScreenIds", () => {
  it("counts a row with enough of it between the lines, and not a sliver at either edge", () => {
    const rows = [
      { id: A, top: -200, bottom: 60 + 2 }, // 2px below a 60px sticky top
      { id: B, top: 62, bottom: 700 },
      { id: C, top: 790, bottom: 1200 }, // 10px above an 800px bottom
    ];
    expect(onScreenIds(rows, 60, 800)).toEqual([B]);
  });

  it("counts a short row that is wholly on screen, however short", () => {
    const rows = [{ id: A, top: 100, bottom: 110 }];
    expect(ON_SCREEN_MIN_PX).toBeGreaterThan(10);
    expect(onScreenIds(rows, 0, 800)).toEqual([A]);
  });

  it("does not count a short row that is only partly on screen below the minimum", () => {
    expect(onScreenIds([{ id: A, top: 795, bottom: 810 }], 0, 800)).toEqual([]);
  });

  it("sorts and removes repeats", () => {
    const rows = [
      { id: C, top: 0, bottom: 100 },
      { id: A, top: 100, bottom: 200 },
      { id: C, top: 200, bottom: 300 },
    ];
    expect(onScreenIds(rows, 0, 800)).toEqual([A, C]);
  });
});

describe("onScreenLinkCss", () => {
  it("is one rule, scoped to the band, naming every id", () => {
    const css = onScreenLinkCss([A, B]);
    expect(css.startsWith(`.mode-band :is([data-block-link="${A}"],[data-block-link="${B}"]):not(.block-ref-missing){`)).toBe(true);
    expect(css).toContain("background-color:var(--block-link-on-screen);opacity:1");
  });

  it("has a stylesheet definition for the wash token the generated rule uses", () => {
    const proseCss = readFileSync(path.join(process.cwd(), "src/web/styles/prose.css"), "utf8");
    expect(proseCss).toMatch(/--block-link-on-screen:\s*var\(--highlight-wash\)/);
  });

  it("cannot brighten a missing, non-interactive reference", () => {
    expect(onScreenLinkCss([A])).toContain(":not(.block-ref-missing)");
  });

  it("skips an id that is not in our format rather than escaping it", () => {
    const css = onScreenLinkCss([A, 'x"]{}body{display:none']);
    expect(css).toContain(A);
    expect(css).not.toContain("body");
  });

  it("is empty for no ids", () => {
    expect(onScreenLinkCss([])).toBe("");
    expect(onScreenLinkCss(["not-ours"])).toBe("");
  });
});
