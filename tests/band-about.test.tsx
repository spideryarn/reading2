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
      <ModeSurface label="Tweets" mode="tweets" about={<p>12 posts.</p>}>
        body
      </ModeSurface>,
    );
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    const card = document.querySelector(".band-about-card")?.textContent ?? "";
    expect(card).toContain(`${MODE_CATALOG.tweets.description}.`);
    expect(card).toContain(MODE_CATALOG.tweets.how);
    expect(card.indexOf(MODE_CATALOG.tweets.how)).toBeLessThan(card.indexOf("12 posts."));
  });

  /* Plan 261002e: the one card in the corner with something to press, and so
     the one that lets the pointer in. */
  it("ends a mode's card with a link to that mode's section of Help, and lets the pointer in", async () => {
    draw(
      <ModeSurface label="Tweets" mode="tweets" about={<p>12 posts.</p>}>
        body
      </ModeSurface>,
    );
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    const card = document.querySelector(".band-about-card")!;
    const link = card.querySelector("a")!;
    expect(link.textContent).toBe("More in Help →");
    expect(link.getAttribute("href")).toBe("/help#mode-tweets");
    expect(card.textContent?.endsWith("More in Help →")).toBe(true);
    expect(document.querySelector(".tooltip-anchor")?.classList.contains("interactive")).toBe(true);
  });

  it("has no link, and stays a card the pointer cannot enter, for a band with no mode", async () => {
    draw(<ModeSurface label="Tweets" about="What this is.">body</ModeSurface>);
    await act(async () => (host.querySelector(".band-about") as HTMLButtonElement).click());
    expect(document.querySelector(".band-about-card a")).toBeNull();
    expect(document.querySelector(".tooltip-anchor")?.classList.contains("interactive")).toBe(false);
  });

  it("has an (i) from the mode alone, when there is nothing to add yet", () => {
    draw(<ModeSurface label="Tweets" mode="tweets" about={null}>body</ModeSurface>);
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
