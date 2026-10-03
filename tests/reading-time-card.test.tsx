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
import type { ReadingTimeFor } from "../src/web/useReadingTime.js";

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

/** Several rows, each with its line, and the recorder's `timeFor` handed to the card. */
function paintRows(ids: BlockId[], timeFor: ReadingTimeFor): HTMLElement[] {
  act(() =>
    root.render(
      <BlockLinkProvider index={new Map()} readingTimeFor={timeFor}>
        <table>
          <tbody>
            {ids.map((id) => (
              <tr key={id} data-block={id}>
                <td>
                  <div className="blk-gutter">
                    <span className="blk-read" aria-hidden="true" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </BlockLinkProvider>,
    ),
  );
  return [...host.querySelectorAll<HTMLElement>("span.blk-read")];
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

  it("says how long you have spent beside this passage, and keeps counting while open (261002e)", async () => {
    let spent = 80;
    const timeFor: ReadingTimeFor = (id) => (id === ID ? { seconds: spent, expected: 26 } : null);
    const line = paintRows([ID], timeFor)[0]!;
    await hover(line);
    expect(card()?.textContent).toContain("You have spent 1 min 20 s here. It takes about 26 s to read.");
    spent = 81;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(card()?.textContent).toContain("You have spent 1 min 21 s here.");
  });

  it("shows the new passage's time at once when the pointer moves straight to the next line", async () => {
    const OTHER = "spya-rdtim2" as BlockId;
    const times: Record<string, number> = { [ID]: 80, [OTHER]: 5 };
    const timeFor: ReadingTimeFor = (id) => ({ seconds: times[id] ?? 0, expected: 26 });
    const [first, second] = paintRows([ID, OTHER], timeFor);
    await hover(first!);
    expect(card()?.textContent).toContain("1 min 20 s here");
    times[ID] = 999; // a stale card would keep drawing the first row
    await hover(second!);
    expect(card()?.textContent).toContain("You have spent 5 s here.");
  });

  it("explains the line without a time when there is no recorder", async () => {
    const line = paint(4);
    await hover(line);
    expect(card()?.textContent).not.toMatch(/You have spent/);
  });

  it("drops the time when an open card outlives the recorder run", async () => {
    let running = true;
    const timeFor: ReadingTimeFor = () => (running ? { seconds: 80, expected: 26 } : null);
    const line = paintRows([ID], timeFor)[0]!;
    await hover(line);
    expect(card()?.textContent).toContain("You have spent 1 min 20 s here.");

    running = false;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(card()?.textContent).not.toMatch(/You have spent/);
    expect(card()?.textContent).toContain("This line grows stronger");
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

/**
 * **A tap opens the card** (Greg, spya-vskqfn; plan 261003c). On a touch screen
 * nothing hovers, so before this the line could not explain itself on an iPad.
 * A finger's tap fires the hover events too — `pointerover` at the press, and
 * `pointerout` at the lift, *before* the click (docs/project/touch.md § a lift
 * fires the hover events) — so the test replays that whole order, and the
 * click says `mouse`, as iOS 18.2 and later reports it.
 */
describe("a tap on the reading-time line", () => {
  function finger(el: Element, clientY = 10): void {
    const opts = { bubbles: true, pointerType: "touch", clientY, pointerId: 7 };
    el.dispatchEvent(new PointerEvent("pointerover", opts));
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new PointerEvent("pointerout", { ...opts, relatedTarget: null }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientY });
    Object.defineProperty(click, "pointerType", { value: "mouse" });
    el.dispatchEvent(click);
  }

  it("opens the card, and the lift's pointerout does not take it away", async () => {
    const line = paint(2);
    await act(async () => finger(line));
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()?.textContent).toContain("Reading time");
  });

  it("closes when a finger taps somewhere else", async () => {
    const line = paint(2);
    await act(async () => finger(line));
    await act(async () => finger(document.body));
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
  });

  /* A mouse can click inside the 240ms hover delay; the delayed hover open
     must not then overwrite the click's card and its close-on-scroll. GPT Sol,
     plan review of 261003c. */
  it("a click inside the hover delay still closes on a scroll", async () => {
    const line = paint(2);
    line.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", clientY: 10 }));
    await act(async () => {
      line.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientY: 10 }));
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
  });

  it("closes on a scroll, since no finger is resting on it", async () => {
    const line = paint(2);
    await act(async () => finger(line));
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
  });
});
