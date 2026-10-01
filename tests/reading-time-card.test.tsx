// @vitest-environment jsdom
/**
 * **The reading-time line's card** — the gutter's `span.blk-read`, explained by
 * the reading view's one delegated card (src/web/BlockLinkCard.tsx) rather than
 * a native `title`.
 *
 * Greg, 2026-10-01 (spya-mn3ruw): make it a rich tooltip, and the line gets
 * *more visible* the longer you read — light on the dark page — so the words
 * may never say "darker", which is what the `title` said.
 *
 * docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "../src/types.js";
import { BlockLinkProvider } from "../src/web/BlockLinkCard.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFTER_THE_DELAY = 500;
const ID = "spya-rdtime" as BlockId;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A row as TableView draws it, with the gutter's line, and its level set inline as `gutterCss` sets it by rule. */
function paint(level: number | null): HTMLElement {
  act(() =>
    root.render(
      <BlockLinkProvider index={new Map()}>
        <table>
          <tbody>
            <tr data-block={ID} style={level === null ? undefined : ({ "--read": String(level) } as React.CSSProperties)}>
              <td>
                <div className="blk-gutter">
                  <span className="blk-read" aria-hidden="true" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </BlockLinkProvider>,
    ),
  );
  return host.querySelector<HTMLElement>("span.blk-read")!;
}

async function hover(el: HTMLElement, clientY = 10): Promise<void> {
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", clientY }));
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

const card = () => document.querySelector<HTMLElement>(".tooltip-anchor");

async function leave(el: HTMLElement): Promise<void> {
  el.dispatchEvent(
    new PointerEvent("pointerout", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: el.closest("td"),
    }),
  );
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

describe("the reading-time line", () => {
  it("opens the shared rich card on hover, saying it gets more visible and never darker", async () => {
    const line = paint(4);
    await hover(line);
    const text = card()?.textContent ?? "";
    expect(text).toMatch(/^Reading time/);
    expect(text).toMatch(/stronger|more visible/);
    expect(text).not.toMatch(/darker/i);
    expect(text).toMatch(/Only you see it/);
    expect(card()?.querySelector(".tip-soon")).not.toBeNull();
    expect(card()?.querySelector(".tip-cite")).toBeNull();
    // Decoration, announced nowhere: the open card is not hung on it as a description.
    expect(line.hasAttribute("aria-describedby")).toBe(false);
  });

  it("closes when the pointer leaves its narrow strip for the table cell", async () => {
    const line = paint(4);
    await hover(line);
    expect(card()).not.toBeNull();
    await leave(line);
    expect(card()).toBeNull();
  });

  it("moves the virtual reference when the pointer re-enters before the card closes", async () => {
    const line = paint(4);
    const rect = vi
      .spyOn(line, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(20, 100, 8, 200));
    await hover(line, 140);
    expect(card()).not.toBeNull();
    rect.mockClear();

    act(() => {
      line.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: line.closest("td"),
        }),
      );
      line.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", clientY: 260 }),
      );
    });

    /* Re-entering cancels the delayed close, but the pointer may now be at a
       different height in a long paragraph. Reading the strip's rect again is
       what creates the new virtual reference at that height. */
    expect(rect).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).not.toBeNull();
  });

  it("dismisses the open card when a finger takes over — nothing yet on touch", async () => {
    const line = paint(4);
    await hover(line);
    expect(card()).not.toBeNull();
    line.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }));
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
  });
});
