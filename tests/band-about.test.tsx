// @vitest-environment jsdom
/**
 * **The band's (i): `ModeSurface`'s `about` slot, and `AboutMade`'s one line
 * on how a mode's contents were made.**
 *
 * Greg, 2026-10-01 (spya-ucu35y): *"Move this into a tooltip for a (i) icon in
 * the top-right"* — and every mode the same way.
 * docs/plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md. Which
 * modes have one is swept in tests/every-mode-draws-its-surface.test.tsx; this
 * is the two pieces themselves.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutMade } from "../src/web/BandAbout.js";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { ModeSurface } from "../src/web/ModeSurface.js";
import { exactly } from "../src/web/relative-time.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const draw = (el: ReactElement) => act(() => root.render(el));

describe("ModeSurface's about", () => {
  it("puts one (i) first in the band, as a direct child, and marks the band", () => {
    draw(
      <ModeSurface label="Tweets" feature="tweets" head="12 posts" about="What this is.">
        <ol>body</ol>
      </ModeSurface>,
    );
    const band = host.querySelector("aside")!;
    expect(band.className).toBe("mode-band tweets has-about");
    expect(band.firstElementChild?.matches("button.band-about")).toBe(true);
    expect(band.querySelectorAll(".band-about")).toHaveLength(1);
    expect(band.firstElementChild?.getAttribute("aria-label")).toBe("About this mode");
  });

  it("opens a card carrying what it was given", async () => {
    draw(<ModeSurface label="Tweets" about="What this is.">body</ModeSurface>);
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    expect(document.querySelector(".band-about-card")?.textContent).toContain("What this is.");
  });

  it("opens with the mode's own words from the catalog, then what the mode adds", async () => {
    draw(
      <ModeSurface label="Tweets" mode="summary" about={<p>12 posts.</p>}>
        body
      </ModeSurface>,
    );
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    const card = document.querySelector(".band-about-card")?.textContent ?? "";
    expect(card).toContain(`${MODE_CATALOG.summary.description}.`);
    expect(card).toContain(MODE_CATALOG.summary.how);
    expect(card.indexOf(MODE_CATALOG.summary.how)).toBeLessThan(card.indexOf("12 posts."));
  });

  /* Plan 261002e: the one card in the corner with something to press, and so
     the one that lets the pointer in. */
  it("ends a mode's card with a link to that mode's page of Help, and lets the pointer in", async () => {
    draw(
      <ModeSurface label="Tweets" mode="summary" about={<p>12 posts.</p>}>
        body
      </ModeSurface>,
    );
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    const card = document.querySelector(".band-about-card")!;
    const link = card.querySelector("a")!;
    expect(link.textContent).toBe("More in Help →");
    expect(link.getAttribute("href")).toBe("/help/mode-summary");
    expect(card.textContent?.endsWith("More in Help →")).toBe(true);
    expect(document.querySelector(".tooltip-anchor")?.classList.contains("interactive")).toBe(true);
  });

  it("has no link, and stays a card the pointer cannot enter, for a band with no mode", async () => {
    draw(<ModeSurface label="Tweets" about="What this is.">body</ModeSurface>);
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    expect(document.querySelector(".band-about-card a")).toBeNull();
    expect(document.querySelector(".tooltip-anchor")?.classList.contains("interactive")).toBe(false);
  });

  it("toggles closed on a mouse click while its interactive card is hover-open", async () => {
    vi.useFakeTimers();
    draw(<ModeSurface label="Tweets" mode="summary">body</ModeSurface>);
    const button = host.querySelector(".band-about") as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".band-about-card a")).not.toBeNull();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      button.focus();
      button.click();
    });
    for (const _ of [0, 1, 2]) await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".band-about-card")).toBeNull();
  });

  /* qi-9rk34gjz, plan 261004g. Pointing schedules a hover-open; the two presses
     toggle through the button's own click, which Floating UI never hears of,
     so the timer outlived them and reopened a card the reader had just shut. */
  it.each([
    ["with a Help link", <ModeSurface key="a" label="Tweets" mode="summary">body</ModeSurface>],
    ["without one", <ModeSurface key="b" label="Tweets" about={<p>About.</p>}>body</ModeSurface>],
  ])("stays shut after a quick double press, %s", async (_name, el) => {
    vi.useFakeTimers();
    draw(el);
    const button = host.querySelector(".band-about") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      button.dispatchEvent(new MouseEvent("mouseenter"));
    });
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    for (const _ of [0, 1, 2]) await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-expanded"), "the pending hover timer reopened it").toBe("false");
    /* The dismissal lasts only until the pointer comes back. */
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseleave"));
      button.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
      button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      button.dispatchEvent(new MouseEvent("mouseenter"));
    });
    for (const _ of [0, 1, 2]) await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-expanded"), "a fresh hover opens it again").toBe("true");
  });

  it("keeps a touch-open card available for the following tap on its Help link", async () => {
    vi.useFakeTimers();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Chrome");
    vi.stubGlobal("scrollTo", vi.fn());
    const navigate = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    draw(<ModeSurface label="Tweets" mode="summary">body</ModeSurface>);
    const button = host.querySelector(".band-about") as HTMLButtonElement;
    // jsdom has no pointer modality or :focus-visible implementation. A touch
    // focuses a button without making it focus-visible in the browser.
    const matches = button.matches.bind(button);
    vi.spyOn(button, "matches").mockImplementation((selector) => selector === ":focus-visible" ? false : matches(selector));
    const touch = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      return event;
    };
    await act(async () => {
      button.dispatchEvent(touch("pointerenter"));
      button.dispatchEvent(touch("pointerdown"));
      button.dispatchEvent(new MouseEvent("mouseenter"));
      button.focus();
      button.click();
    });
    await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const link = document.querySelector(".band-about-card a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: link }));
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: link }));
      link.dispatchEvent(touch("pointerdown"));
      link.focus();
    });
    for (const _ of [0, 1, 2]) await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(link.isConnected).toBe(true);
    await act(async () => link.click());
    expect(navigate).toHaveBeenCalledWith(null, "", "/help/mode-summary");
  });

  it("lets a real mouse take over when it enters a touch-open interactive card directly", async () => {
    vi.useFakeTimers();
    draw(<ModeSurface label="Tweets" mode="summary">body</ModeSurface>);
    const button = host.querySelector(".band-about") as HTMLButtonElement;
    const touchDown = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(touchDown, "pointerType", { value: "touch" });
    await act(async () => {
      button.dispatchEvent(touchDown);
      button.click();
    });
    await act(async () => vi.advanceTimersByTime(500));
    const card = document.querySelector(".tooltip-anchor") as HTMLElement;
    expect(card).not.toBeNull();

    /* On a hybrid device the cursor can approach the portalled card without
       crossing its trigger. That real mouse entry ends the tap's exemption. */
    const mouseOver = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(mouseOver, "pointerType", { value: "mouse" });
    card.dispatchEvent(mouseOver);
    card.dispatchEvent(new MouseEvent("mouseenter"));
    card.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: document.body }));
    card.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    for (const _ of [0, 1, 2]) await act(async () => vi.advanceTimersByTime(500));
    expect(document.querySelector(".band-about-card")).toBeNull();
  });

  it("has an (i) from the mode alone, when there is nothing to add yet", () => {
    draw(<ModeSurface label="Tweets" mode="summary" about={null}>body</ModeSurface>);
    expect(host.querySelector("aside > .band-about")).not.toBeNull();
  });

  it("draws nothing extra, and no class, without one", () => {
    draw(<ModeSurface label="Tweets">body</ModeSurface>);
    const band = host.querySelector("aside")!;
    expect(band.className).toBe("mode-band");
    expect(band.querySelector(".band-about")).toBeNull();
  });

  it("treats a null about as absent", () => {
    draw(<ModeSurface label="Tweets" about={null}>body</ModeSurface>);
    expect(host.querySelector(".band-about")).toBeNull();
    expect(host.querySelector("aside")!.className).toBe("mode-band");
  });
});

describe("AboutMade", () => {
  it("says who wrote it, when (exactly and how long ago), and how long it took", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T17:03:00Z"));
    draw(
      createElement(AboutMade, {
        generator: "claude-sonnet-5",
        version: "tweets/5",
        generatedAt: "2026-10-01T14:03:00Z",
        elapsedMs: 20_000,
      }),
    );
    const text = host.textContent ?? "";
    expect(text).toContain("Written by claude-sonnet-5");
    expect(text).toContain("tweets/5");
    expect(text).toContain(exactly("2026-10-01T14:03:00Z"));
    expect(text).toMatch(/3 hours ago/);
    expect(text).toContain("20.0s");
  });

  it("gives the exact date alone past a month, where 'ago' stops helping", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T17:03:00Z"));
    draw(createElement(AboutMade, { generator: "m", generatedAt: "2026-07-01T14:03:00Z" }));
    const text = host.textContent ?? "";
    expect(text).toContain("2026");
    expect(text).not.toMatch(/ago/);
  });

  it("draws nothing at all for a visitor's artefact, which carries none of it", () => {
    draw(createElement(AboutMade, {}));
    expect(host.innerHTML).toBe("");
  });

  it("says nothing about a duration it does not know", () => {
    draw(createElement(AboutMade, { generator: "m", elapsedMs: Number.NaN }));
    expect(host.textContent).not.toMatch(/unknown/);
  });

  it("keeps a known duration when an old artefact has no author or date", () => {
    draw(createElement(AboutMade, { elapsedMs: 20_000 }));
    expect(host.textContent).toBe("Written in 20.0s.");
  });
});
