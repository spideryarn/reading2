// @vitest-environment jsdom
/**
 * **The page-wide `data-tip` card** (src/web/TipCard.tsx), which every native
 * `title` in the app became on 2026-10-17 — Greg (spya-q04h98): *"replace with
 * rich tooltips … how can we ensure this going forwards?"*
 * docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md.
 *
 * The cases are the ones a `title` got for free and a delegated card has to
 * earn — the words on hover and on keyboard focus, as a description — and the
 * ones GPT Sol's plan review named: an existing description kept, an SVG shape
 * as the anchor, no second card on a trigger another card owns, and one Escape
 * closing one surface.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TipCard, tipParagraphs } from "../src/web/TipCard.js";
import { Tooltip } from "../src/web/Tooltip.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFTER_THE_DELAY = 500;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const card = () => document.querySelector<HTMLElement>(".tooltip-anchor");

function hover(el: Element, pointerType = "mouse"): void {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

function paint(ui: React.ReactNode): void {
  act(() =>
    root.render(
      <>
        {ui}
        <TipCard />
      </>,
    ),
  );
}

describe("tipParagraphs", () => {
  it("splits on blank lines, trims, and says nothing for nothing", () => {
    expect(tipParagraphs("What it found\n\nMark only this search")).toEqual(["What it found", "Mark only this search"]);
    expect(tipParagraphs("  one  ")).toEqual(["one"]);
    expect(tipParagraphs("  ")).toBeNull();
    expect(tipParagraphs(null)).toBeNull();
  });
});

describe("TipCard", () => {
  it("opens on a mouse's hover after the delay, in paragraphs, and not before", () => {
    paint(<button data-tip={"the criterion\n\nMark only this search"}>run</button>);
    const button = host.querySelector("button")!;
    act(() => {
      button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    });
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    const spans = [...card()!.querySelectorAll(".tooltip > span > span")].map((s) => s.textContent);
    expect(spans).toEqual(["the criterion", "Mark only this search"]);
  });

  it("does not open for a finger, whose tap presses the control", () => {
    paint(<button data-tip="Delete this search">x</button>);
    hover(host.querySelector("button")!, "touch");
    expect(card()).toBeNull();
  });

  it("opens on keyboard focus", () => {
    paint(<button data-tip="Delete this search">x</button>);
    act(() => host.querySelector("button")!.focus());
    expect(card()?.textContent).toContain("Delete this search");
  });

  it("describes its trigger while open, keeping a description it already had, and restores it", () => {
    paint(
      <>
        <span id="own">own words</span>
        <button data-tip="Delete this search" aria-describedby="own">
          x
        </button>
        <span data-tip="elsewhere">y</span>
      </>,
    );
    const button = host.querySelector("button")!;
    hover(button);
    const id = card()!.id;
    expect(button.getAttribute("aria-describedby")).toBe(`own ${id}`);
    hover(host.querySelector("span[data-tip]")!);
    expect(button.getAttribute("aria-describedby")).toBe("own");
  });

  it("adds no description where the trigger says data-tip-describes=off", () => {
    paint(
      <button data-tip="Copy a link" data-tip-describes="off" aria-label="Copy a link">
        x
      </button>,
    );
    const button = host.querySelector("button")!;
    hover(button);
    expect(card()).not.toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("re-reads its words when the trigger's change while it is open", async () => {
    function Copy({ copied }: { copied: boolean }) {
      return <button data-tip={copied ? "Copied" : "Copy a link"}>x</button>;
    }
    paint(<Copy copied={false} />);
    hover(host.querySelector("button")!);
    expect(card()!.textContent).toContain("Copy a link");
    await act(async () => {
      root.render(
        <>
          <Copy copied />
          <TipCard />
        </>,
      );
    });
    expect(card()!.textContent).toContain("Copied");
  });

  it("closes when its trigger is removed without a pointerout", async () => {
    paint(<button data-tip="Delete this search">x</button>);
    hover(host.querySelector("button")!);
    expect(card()).not.toBeNull();
    await act(async () => {
      root.render(<TipCard />);
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
  });

  it("anchors on an SVG shape, a bar of a chart", () => {
    paint(
      <svg>
        <rect data-tip="Chat · 2026-10-17 · $0.12" width={10} height={10} />
      </svg>,
    );
    hover(host.querySelector("rect")!);
    expect(card()?.textContent).toContain("$0.12");
  });

  it("gives no second card to a Tooltip's own trigger", () => {
    paint(
      <Tooltip content="the Tooltip's card">
        <button data-tip="a stray data-tip">x</button>
      </Tooltip>,
    );
    hover(host.querySelector("button")!);
    expect([...document.querySelectorAll(".tooltip-anchor")].some((c) => c.textContent?.includes("a stray data-tip"))).toBe(false);
  });

  it("gives no second card to a data-tip inside a Tooltip's trigger", () => {
    paint(
      <Tooltip content="the Tooltip's card">
        <button>
          <span data-tip="a stray data-tip">x</span>
        </button>
      </Tooltip>,
    );
    hover(host.querySelector("span[data-tip]")!);
    expect([...document.querySelectorAll(".tooltip-anchor")].some((c) => c.textContent?.includes("a stray data-tip"))).toBe(false);
  });

  it("draws the data-tip of a disabled Tooltip's trigger, which has no card of its own", () => {
    paint(
      <Tooltip content="the Tooltip's card" enabled={false}>
        <button data-tip="the fallback">x</button>
      </Tooltip>,
    );
    const button = host.querySelector("button")!;
    hover(button);
    expect(card()?.textContent).toContain("the fallback");
  });

  it("gives no card to a data-tip inside a block link, whose card is BlockLinkCard's", () => {
    paint(
      <span data-tip="the outer words">
        <a href="#b" data-block-link="spya-aaaaaa">
          link
        </a>
      </span>,
    );
    hover(host.querySelector("a")!);
    expect(card()).toBeNull();
    hover(host.querySelector("span[data-tip]")!);
    expect(card()?.textContent).toContain("the outer words");
  });

  it("takes an Escape for itself while it shows — one press, one surface", () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    document.addEventListener("keydown", heard, { capture: true });
    paint(<button data-tip="Delete this search">x</button>);
    hover(host.querySelector("button")!);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    /* And the next press is somebody else's: both listeners hear it. */
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener("keydown", heard);
    document.removeEventListener("keydown", heard, { capture: true });
  });

  it("lets an Escape go on while its card is only waiting out the delay, and cancels it", () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    paint(<button data-tip="Delete this search">x</button>);
    act(() => {
      host.querySelector("button")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    });
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    window.removeEventListener("keydown", heard);
  });

  it("yields an Escape to an open native dialog, and closes", () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    paint(
      <dialog open>
        <button data-tip="inside a dialog">x</button>
      </dialog>,
    );
    hover(host.querySelector("button")!);
    expect(card()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", heard);
  });

  it("leaves an Escape that an input method is using alone", () => {
    paint(<button data-tip="Delete this search">x</button>);
    hover(host.querySelector("button")!);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
    });
    expect(card()).not.toBeNull();
  });
});
