// @vitest-environment jsdom
/**
 * **`<Tooltip interactive>`: a card the pointer and the keyboard can get into.**
 *
 * By default, Tooltip cards take no pointer events and close after the pointer
 * leaves their trigger — right for the spine, whose cards would otherwise
 * sit on the band being pointed at and hold themselves open, and a failure of
 * WCAG 2.1 § 1.4.13 for a card that holds a link. Greg chose per-use, 2026-10-02
 * (docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md).
 *
 * jsdom has no layout, so `safePolygon`'s triangle is not exercised here — every
 * rectangle is zero. What it can see is the part that decides whether the card
 * survives the trip at all: leaving the trigger and arriving in the card. The
 * geometry is the browser pass's job (the plan's screenshots).
 *
 * The first test is the default, and it is the one that matters most: the
 * spine has to keep exactly what it had.
 */
import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipGroup } from "../src/web/Tooltip.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Past both `DELAY.open` and `DELAY.close` in Tooltip.tsx, with room to spare. */
const PAST_THE_DELAY = 500;

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

function draw(interactive: boolean) {
  act(() =>
    root.render(
      <>
        <Tooltip
          interactive={interactive ? { label: "About this mode" } : undefined}
          placement="bottom"
          content={
            <>
              What this is.{" "}
              <a href="/help#spine" className="card-link">
                More in Help →
              </a>
            </>
          }
        >
          <button type="button" className="trigger">
            i
          </button>
        </Tooltip>
        <button type="button" className="elsewhere">
          next
        </button>
      </>,
    ),
  );
}

const trigger = () => host.querySelector(".trigger") as HTMLButtonElement;
const anchor = () => document.querySelector(".tooltip-anchor");
const tick = () =>
  act(async () => {
    vi.advanceTimersByTime(PAST_THE_DELAY);
  });

async function hover() {
  trigger().dispatchEvent(new MouseEvent("mouseenter"));
  await tick();
  expect(anchor()).not.toBeNull();
}

/**
 * The pointer leaves the trigger and its next move lands inside the card.
 *
 * **No `mouseenter` on the card**, deliberately. `useHover` listens for one on
 * the floating element and cancels the close when it comes, so dispatching it
 * here would keep *every* card open, the spine's included. In a browser a
 * `pointer-events: none` card never receives one, and jsdom loads no
 * stylesheet, so it cannot tell — the event would be a claim about the CSS
 * that the CSS does not make. The `mousemove` is what a browser delivers to
 * the document either way, and what `safePolygon` reads.
 */
async function travelIntoTheCard() {
  const card = document.querySelector(".tooltip") as HTMLElement;
  /* Both leave events: React's synthetic `onMouseLeave`, which is what closes
     a card, is synthesised from a *bubbling* `mouseout` — tooltips.md § Three
     things about testing a card in jsdom. */
  trigger().dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: card, clientX: 5, clientY: 5 }));
  trigger().dispatchEvent(
    new MouseEvent("mouseout", { bubbles: true, relatedTarget: card, clientX: 5, clientY: 5 }),
  );
  card.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 6 }));
  await settle();
}

/** Closing is timers in series with a render between them: one wait per step. */
async function settle() {
  for (const _ of [0, 1, 2]) await tick();
}

describe("a card without `interactive` (the spine's, and almost every other)", () => {
  it("takes no pointer events and closes when the pointer goes towards it", async () => {
    draw(false);
    await hover();
    expect(anchor()?.classList.contains("interactive")).toBe(false);
    await travelIntoTheCard();
    expect(anchor()).toBeNull();
  });
});

describe("a card with `interactive`", () => {
  it("takes pointer events and stays open while the pointer travels into it", async () => {
    draw(true);
    await hover();
    expect(anchor()?.classList.contains("interactive")).toBe(true);
    await travelIntoTheCard();
    expect(anchor()).not.toBeNull();
  });

  /**
   * **Tab, as far as jsdom can press it.** jsdom moves no focus on a Tab key,
   * so this focuses what a browser's Tab would land on next: the focus guard
   * Floating UI puts straight after the trigger (`data-type="outside"`), whose
   * job is to hand focus into the portalled card; then, from the link, the
   * guard at the card's end (`data-type="inside"`), whose job is to hand it on
   * to whatever followed the trigger and close the card. Without
   * `interactive` there are no guards at all, and Tab from the trigger goes
   * straight to `.elsewhere` — the card's link is unreachable.
   */
  it("is reached by Tab from the trigger, and Tab past its link moves on and closes it", async () => {
    draw(true);
    await act(async () => trigger().focus());
    await settle();
    expect(anchor()).not.toBeNull();

    const guardAfterTrigger = host.querySelector('.trigger ~ [data-type="outside"]') as HTMLElement;
    expect(guardAfterTrigger.getAttribute("data-type")).toBe("outside");
    await act(async () => guardAfterTrigger.focus());
    await settle();
    const link = document.querySelector(".card-link") as HTMLAnchorElement;
    expect(document.activeElement).toBe(link);
    expect(anchor()).not.toBeNull();

    const guards = document.querySelectorAll<HTMLElement>('[data-type="inside"]');
    const endGuard = guards[guards.length - 1] as HTMLElement;
    await act(async () => endGuard.focus());
    await settle();
    expect(document.activeElement).toBe(host.querySelector(".elsewhere"));
    expect(anchor()).toBeNull();
  });

  it("puts nothing in the tab order when it is not interactive", async () => {
    draw(false);
    await act(async () => trigger().focus());
    await settle();
    expect(anchor()).not.toBeNull();
    expect(document.querySelector("[data-floating-ui-focus-guard]")).toBeNull();
  });

  it("does not take focus when it opens on hover", async () => {
    draw(true);
    const before = document.activeElement;
    await hover();
    // Focus management queues its focus after the opening render. Wait for
    // that work too, otherwise initialFocus={0} incorrectly passes this test.
    await settle();
    expect(document.activeElement).toBe(before);
  });

  it("keeps the card open when focus moves within it or back to its trigger", async () => {
    draw(true);
    await act(async () => trigger().focus());
    await settle();
    const link = document.querySelector(".card-link") as HTMLAnchorElement;
    await act(async () => link.focus());
    await act(async () => (anchor() as HTMLElement).focus());
    await settle();
    expect(anchor()).not.toBeNull();
    await act(async () => trigger().focus());
    await settle();
    expect(document.activeElement).toBe(trigger());
    expect(anchor()).not.toBeNull();
  });

  it("closes on Escape with focus on its link", async () => {
    draw(true);
    await act(async () => trigger().focus());
    await settle();
    const link = document.querySelector(".card-link") as HTMLAnchorElement;
    await act(async () => link.focus());
    await act(async () => {
      link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(anchor()).toBeNull();
    /* Not dropped on <body>: the link it was on has gone, so it goes back to
       the control that opened the card. GPT Sol, plan review F1. */
    expect(document.activeElement).toBe(trigger());
  });

  it("returns Escape focus to a replacement trigger before its ref state rerenders", async () => {
    function Replacement({ swapped }: { swapped: boolean }) {
      useLayoutEffect(() => {
        if (swapped) {
          document.querySelector(".card-link")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
      }, [swapped]);
      return (
        <Tooltip interactive={{ label: "About" }} content={<a href="/help" className="card-link">Help</a>}>
          <button type="button" key={String(swapped)} className="trigger">i</button>
        </Tooltip>
      );
    }
    await act(async () => root.render(<Replacement swapped={false} />));
    await act(async () => trigger().focus());
    await settle();
    await act(async () => (document.querySelector(".card-link") as HTMLElement).focus());
    const oldTrigger = trigger();
    await act(async () => root.render(<Replacement swapped />));
    await settle();
    expect(trigger()).not.toBe(oldTrigger);
    expect(anchor()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  /* The corridor protects the pointer's trip; it says nothing about where the
     keyboard is. A reader who tabbed into the card and then nudged the mouse
     off the trigger must not have the link they are on taken away. Sol F2. */
  it("stays open when the pointer wanders off while focus is inside it", async () => {
    draw(true);
    await hover();
    const link = document.querySelector(".card-link") as HTMLAnchorElement;
    await act(async () => link.focus());
    trigger().dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: document.body, clientX: 500, clientY: 500 }));
    trigger().dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body, clientX: 500, clientY: 500 }),
    );
    document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 600, clientY: 600 }));
    await settle();
    expect(anchor()).not.toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("closes when focus moves directly out of its link after the pointer leaves", async () => {
    draw(true);
    await hover();
    const link = document.querySelector(".card-link") as HTMLAnchorElement;
    await act(async () => link.focus());
    trigger().dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: document.body, clientX: 500, clientY: 500 }));
    trigger().dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body, clientX: 500, clientY: 500 }),
    );
    document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 600, clientY: 600 }));
    await settle();
    expect(anchor()).not.toBeNull();
    const elsewhere = host.querySelector(".elsewhere") as HTMLButtonElement;
    await act(async () => elsewhere.focus());
    await settle();
    expect(document.activeElement).toBe(elsewhere);
    expect(anchor()).toBeNull();
  });

  it("closes on an outside press after protecting focus from pointer leave", async () => {
    draw(true);
    await hover();
    const link = document.querySelector(".card-link") as HTMLAnchorElement;
    await act(async () => link.focus());
    trigger().dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: document.body, clientX: 500, clientY: 500 }));
    document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 600, clientY: 600 }));
    await settle();
    expect(anchor()).not.toBeNull();
    const elsewhere = host.querySelector(".elsewhere") as HTMLButtonElement;
    await act(async () => {
      elsewhere.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      elsewhere.focus();
      elsewhere.click();
    });
    await settle();
    expect(document.activeElement).toBe(elsewhere);
    expect(anchor()).toBeNull();
  });

  /* A card with a link in it is a small non-modal dialog, not a tooltip: ARIA's
     tooltip may not hold anything focusable. Named, because a dialog with no
     name is announced as just "dialog". Sol F3. */
  it("is a named dialog, and the trigger says it opens one", async () => {
    draw(true);
    await hover();
    expect(anchor()?.getAttribute("role")).toBe("dialog");
    expect(anchor()?.getAttribute("aria-label")).toBe("About this mode");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger().getAttribute("aria-controls")).toBe(anchor()?.id);
  });
});

/* The spine's shape — controlled, inside a group — rather than the plain one
   above: what has to come through untouched. Sol F6. */
describe("a controlled, grouped card without `interactive`", () => {
  function Band() {
    const [open, setOpen] = useState(false);
    return (
      <TooltipGroup delay={{ open: 240, close: 90 }}>
        <Tooltip content="Part one" open={open} onOpenChange={setOpen}>
          <button type="button" className="trigger" aria-label="Part one" aria-describedby="standing-note">
            band
          </button>
        </Tooltip>
        <p id="standing-note">A standing description.</p>
      </TooltipGroup>
    );
  }

  it("is a tooltip describing its trigger, takes no pointer, and adds no focus guards", async () => {
    act(() => root.render(<Band />));
    await hover();
    expect(anchor()?.getAttribute("role")).toBe("tooltip");
    expect(anchor()?.classList.contains("interactive")).toBe(false);
    expect(trigger().getAttribute("aria-describedby")).toBe(`${anchor()?.id} standing-note`);
    expect(trigger().hasAttribute("aria-haspopup")).toBe(false);
    expect(document.querySelector("[data-floating-ui-focus-guard]")).toBeNull();
    await travelIntoTheCard();
    expect(anchor()).toBeNull();
  });
});
