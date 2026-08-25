// @vitest-environment jsdom
/**
 * Reading a mouse selection out of the verbatim column — src/web/selection.ts.
 *
 * jsdom, for the same reason as tests/annotate.test.ts: `Range.toString()` is
 * the definition of the offset space, so the browser has to be the one measuring.
 *
 * See docs/project/comments.md § Anchoring.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MIN_SELECTION_CHARS, readSelection } from "../src/web/selection.js";

/** One row of the table, as TableView renders it. */
function mount(html: string, blockId = "spya-k3m9qt"): HTMLElement {
  document.body.innerHTML = `
    <table><tbody><tr data-block="${blockId}">
      <td class="gist"><div class="sticky">a gist</div></td>
      <td class="text"><span class="block-id">${blockId}</span><div class="prose">${html}</div></td>
    </tr></tbody></table>`;
  return document.querySelector<HTMLElement>(".prose")!;
}

/** Select `[start, end)` of an element's text, the way a drag would. */
function select(node: Node, start: number, end: number): Selection {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

beforeEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("readSelection", () => {
  it("returns the block, the quote and its offset", () => {
    const prose = mount("<p>Consciousness is not a computation.</p>");
    const text = prose.querySelector("p")!.firstChild!;
    expect(readSelection(select(text, 17, 35))).toEqual({
      blockId: "spya-k3m9qt",
      quote: "not a computation.",
      start: 17,
    });
  });

  it("ignores a collapsed selection, so clicking a mark never makes a new one", () => {
    const prose = mount("<p>Consciousness is not a computation.</p>");
    expect(readSelection(select(prose.querySelector("p")!.firstChild!, 5, 5))).toBeNull();
  });

  it("ignores a stray drag shorter than the minimum", () => {
    const prose = mount("<p>Consciousness is not a computation.</p>");
    const text = prose.querySelector("p")!.firstChild!;
    expect(MIN_SELECTION_CHARS).toBeGreaterThan(1);
    expect(readSelection(select(text, 0, MIN_SELECTION_CHARS - 1))).toBeNull();
  });

  it("ignores a selection outside the verbatim column", () => {
    mount("<p>Consciousness is not a computation.</p>");
    const gist = document.querySelector(".sticky")!.firstChild!;
    expect(readSelection(select(gist, 0, 6))).toBeNull();
  });

  it("trims surrounding whitespace out of the quote and off the offset", () => {
    const prose = mount("<p>Consciousness is not a computation.</p>");
    const text = prose.querySelector("p")!.firstChild!;
    // A drag that overshoots into the space either side — the normal case.
    expect(readSelection(select(text, 13, 35))).toEqual({
      blockId: "spya-k3m9qt",
      quote: "is not a computation.",
      start: 14,
    });
  });

  it("measures across nested elements the way the browser will", () => {
    const prose = mount("<p>say <em>this</em> right now</p>");
    const tail = prose.querySelector("em")!.nextSibling!;
    // "this now" begins at 4; the selection starts after "this " → offset 9.
    expect(readSelection(select(tail, 1, 10))).toEqual({
      blockId: "spya-k3m9qt",
      quote: "right now",
      start: 9,
    });
  });

  it("clamps a selection that runs past the end of its block", () => {
    // Dragging past the end of a paragraph is normal. A comment addresses one
    // block, so the overshoot is dropped rather than the drag being ignored.
    document.body.innerHTML = `
      <table><tbody>
        <tr data-block="spya-aaaaaa"><td class="text"><div class="prose"><p>first block here.</p></div></td></tr>
        <tr data-block="spya-bbbbbb"><td class="text"><div class="prose"><p>second block here.</p></div></td></tr>
      </tbody></table>`;
    const [one, two] = [...document.querySelectorAll(".prose p")] as [Element, Element];
    const range = document.createRange();
    range.setStart(one.firstChild!, 6);
    range.setEnd(two.firstChild!, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelection(selection)).toEqual({
      blockId: "spya-aaaaaa",
      quote: "block here.",
      start: 6,
    });
  });
});
