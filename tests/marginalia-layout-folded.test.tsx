// @vitest-environment jsdom
/**
 * **A margin note on a hidden row takes no room in the margin** —
 * `useMarginLayout`, src/web/marginalia/MarginaliaColumn.tsx.
 *
 * GPT Sol, plan review of
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md,
 * F4, and it was true of an ordinary fold before the front matter existed. A
 * note lives inside its row's cell, so folding the row hides the note; but the
 * layout still measured it, at no height, level with the next visible row, and
 * the collision rule starts the next note one gap below every note above it
 * (notes.ts § `layoutNotes`). Each hidden note pushed the first visible one
 * down by 8px. Relations writes an item on every paperwork paragraph
 * (src/paperwork.ts), so a shut front matter would have done it on arrival.
 *
 * jsdom lays nothing out, so the browser is faked from the one thing the fold
 * store gives it: a row whose cells the store's stylesheet hides has no
 * height, sits at the top of the next row that has one, and its note measures
 * nothing. A shut stretch's stub row (plan 261018a) keeps its height, and its
 * note, hidden with the block's content, measures nothing.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { FOLD_STYLE_ATTR, clearFoldArticle, setFoldArticle, toggleFold, toggleStretch } from "../src/web/fold.js";
import { NOTE_GAP_PX, useMarginLayout } from "../src/web/marginalia/MarginaliaColumn.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (s: string) => `spya-${s}` as BlockId;
const blocks = [
  { id: id("a"), kind: "heading", tag: "h2", level: 2 },
  { id: id("b"), kind: "text", tag: "p" },
  { id: id("c"), kind: "text", tag: "p" },
  { id: id("d"), kind: "heading", tag: "h2", level: 2 },
] as Block[];

const ROW = 100;
/** Each note's height when its row shows. A test may make one tall. */
let noteHeight: Record<string, number> = {};

const hiddenIds = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";
/** The row is gone: its cells are hidden. */
const isHidden = (blockId: string | undefined) =>
  blockId !== undefined && hiddenIds().includes(`"${blockId}"]>td{display:none}`);
/** Its content is gone, the note with it: the row is hidden, or it is a shut stub. */
const isNoteHidden = (blockId: string | undefined) => blockId !== undefined && hiddenIds().includes(`"${blockId}"`);

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Harness() {
  useMarginLayout(true, 1);
  return null;
}

let table: HTMLTableElement;
let host: HTMLDivElement;
let root: Root;

const note = (s: string) => table.querySelector<HTMLElement>(`tr[data-block="spya-${s}"] [data-marg-note]`)!;
const frame = () => act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

beforeEach(() => {
  noteHeight = {};
  vi.stubGlobal("ResizeObserver", NoResize);
  table = document.createElement("table");
  table.className = "zoom";
  table.innerHTML = `<tbody>${blocks
    .map((b) => `<tr data-block="${b.id}"><td><div data-marg-note></div></td></tr>`)
    .join("")}</tbody>`;
  document.body.append(table);
  const rows = [...table.querySelectorAll<HTMLElement>("tr")];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    /* A row's top is the height of the visible rows above it. */
    const top = rows.slice(0, rows.indexOf(this)).filter((r) => !isHidden(r.dataset.block)).length * ROW;
    return { top, bottom: top, height: 0 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    const blockId = this.closest("tr")?.dataset.block;
    return isNoteHidden(blockId) ? 0 : (noteHeight[blockId ?? ""] ?? 40);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  table.remove();
  clearFoldArticle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the margin layout and a folded section", () => {
  it("is the fixture it thinks it is: with nothing folded, no note moves", () => {
    setFoldArticle("slug", blocks);
    act(() => root.render(createElement(Harness)));
    for (const s of ["a", "b", "c", "d"]) expect(note(s).style.translate).toBe("");
  });

  it("does not push the first visible note down for the notes hidden above it", () => {
    setFoldArticle("slug", blocks);
    toggleFold(id("a")); // b and c fold away; d is now level with them
    act(() => root.render(createElement(Harness)));
    expect(note("d").style.translate).toBe("");
  });

  it("still keeps two visible notes apart (the control)", () => {
    noteHeight = { [id("a")]: ROW + 20 }; // a's note runs 20px past d's row once b and c are folded
    setFoldArticle("slug", blocks);
    toggleFold(id("a"));
    act(() => root.render(createElement(Harness)));
    expect(note("d").style.translate).toBe(`0 ${20 + NOTE_GAP_PX}px`);
  });

  it("lays the notes out again when a section folds, without waiting for a resize", async () => {
    noteHeight = { [id("b")]: 3 * ROW }; // b's note is in the way of c's and d's while it shows
    setFoldArticle("slug", blocks);
    act(() => root.render(createElement(Harness)));
    expect(note("d").style.translate).not.toBe("");
    toggleFold(id("a"));
    await frame();
    expect(note("d").style.translate).toBe("");
  });

  it("clears the shift a note was given before its row was hidden", async () => {
    noteHeight = { [id("b")]: 3 * ROW };
    setFoldArticle("slug", blocks);
    act(() => root.render(createElement(Harness)));
    expect(note("c").style.translate).not.toBe("");
    toggleFold(id("a"));
    await frame();
    expect(note("c").style.translate).toBe("");
  });
});

describe("the margin layout and a shut stretch", () => {
  /* a is the title, b (the stub) and c the byline, d the abstract's heading. */
  const front = [[id("b"), id("c")]];

  it("leaves the first visible note level with its row on arrival", () => {
    setFoldArticle("slug", blocks, new Set(), front);
    act(() => root.render(createElement(Harness)));
    expect(note("d").style.translate).toBe("");
  });

  /* The stub's row is on screen and its note is not (fold.ts § `stubCss`).
     Counted, the hidden note would sit at the stub's row and start d's one
     gap further down: 8px for a note nobody can see (plan review of 261018a,
     F5). a's note runs 5px past d's row, so d moves by exactly that and a gap. */
  it("leaves out the note on a shut stub's row, though the row itself is on screen", () => {
    noteHeight = { [id("a")]: 2 * ROW + 5 };
    setFoldArticle("slug", blocks, new Set(), front);
    act(() => root.render(createElement(Harness)));
    expect(note("d").style.translate).toBe(`0 ${5 + NOTE_GAP_PX}px`);
  });

  it("lays out again when the stretch is opened", async () => {
    noteHeight = { [id("b")]: 3 * ROW };
    setFoldArticle("slug", blocks, new Set(), front);
    act(() => root.render(createElement(Harness)));
    toggleStretch(id("b"));
    await frame();
    expect(note("c").style.translate).toBe(`0 ${2 * ROW + NOTE_GAP_PX}px`);
  });
});
