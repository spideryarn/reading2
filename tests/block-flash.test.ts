// @vitest-environment jsdom
/**
 * **The flash on arrival** — src/web/flash.ts.
 *
 * The prose cell of the block a reader jumped to washes warm for about a second,
 * so "which one is it" is answered on the page. Four rules worth pinning, each
 * of which fails silently: a second click restarts the wash rather than being
 * swallowed by the first; reduced motion gets a still wash rather than a fade;
 * a band lying over the prose on a narrow window holds the flash until the
 * prose is exposed again (Sol F2); and with no prose column there is nothing to
 * flash and nothing is held.
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FLASH_MS, dropPendingFlash, flashBlock, flushPendingFlash } = await import(
  "../src/web/flash.js"
);

const realMatchMedia = window.matchMedia;

function reduceMotion(on: boolean): void {
  window.matchMedia = ((q: string) =>
    ({ matches: on && q.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
}

/** A reading view with two paragraphs, their prose cells optional. */
function layOut({ text = true, covers = false, away = false } = {}): void {
  const cell = (id: string) =>
    `<tr data-block="${id}"><td class="gist"></td>${text ? `<td class="text">${id}</td>` : ""}</tr>`;
  document.body.innerHTML = `
    <div class="reader${covers ? " band-covers" : ""}${away ? " band-away" : ""}">
      ${covers ? '<aside class="mode-band"></aside>' : ""}
      <table><tbody>${cell("spya-aaaaaa")}${cell("spya-bbbbbb")}</tbody></table>
    </div>`;
}

const prose = (id: string) =>
  document.querySelector<HTMLElement>(`tr[data-block="${id}"] td.text`);
const gist = (id: string) => document.querySelector<HTMLElement>(`tr[data-block="${id}"] td.gist`);

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
  reduceMotion(false);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  dropPendingFlash();
  window.matchMedia = realMatchMedia;
});

describe("flashBlock", () => {
  it("washes the prose cell, not the gist, and takes it off after about a second", () => {
    layOut();
    flashBlock("spya-aaaaaa");
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
    expect(gist("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
    expect(prose("spya-bbbbbb")?.classList.contains("block-flash")).toBe(false);
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
  });

  it("restarts on a second flash rather than ending on the first one's clock", () => {
    layOut();
    flashBlock("spya-aaaaaa");
    vi.advanceTimersByTime(FLASH_MS - 100);
    flashBlock("spya-aaaaaa");
    vi.advanceTimersByTime(200);
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash"), "still on the second clock").toBe(
      true,
    );
    vi.advanceTimersByTime(FLASH_MS);
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
  });

  it("moves to the newer block when a second jump lands elsewhere", () => {
    layOut();
    flashBlock("spya-aaaaaa");
    flashBlock("spya-bbbbbb");
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
    expect(prose("spya-bbbbbb")?.classList.contains("block-flash")).toBe(true);
  });

  it("holds a still wash under reduced motion, for the same time", () => {
    reduceMotion(true);
    layOut();
    flashBlock("spya-aaaaaa");
    const cell = prose("spya-aaaaaa");
    expect(cell?.classList.contains("block-flash-still")).toBe(true);
    expect(cell?.classList.contains("block-flash"), "no animated class").toBe(false);
    vi.advanceTimersByTime(FLASH_MS);
    expect(cell?.classList.contains("block-flash-still")).toBe(false);
  });

  it("does nothing, and holds nothing, with no prose column", () => {
    layOut({ text: false });
    flashBlock("spya-aaaaaa");
    expect(document.querySelector(".block-flash, .block-flash-still")).toBeNull();
    // Turning the prose on later must not replay a flash nobody asked to keep.
    layOut();
    flushPendingFlash();
    expect(document.querySelector(".block-flash, .block-flash-still")).toBeNull();
  });

  it("does nothing for a block the page does not have", () => {
    layOut();
    flashBlock("spya-zzzzzz");
    expect(document.querySelector(".block-flash, .block-flash-still")).toBeNull();
  });
});

describe("a band lying over the prose", () => {
  it("holds the flash until the prose is exposed, then fires it", () => {
    layOut({ covers: true });
    flashBlock("spya-aaaaaa");
    expect(document.querySelector(".block-flash"), "nobody could see it").toBeNull();
    // The reader closes the band: Reader re-renders without `band-covers` and flushes.
    document.querySelector(".reader")?.classList.remove("band-covers");
    document.querySelector(".mode-band")?.remove();
    flushPendingFlash();
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
  });

  it("keeps holding while the band still covers", () => {
    layOut({ covers: true });
    flashBlock("spya-aaaaaa");
    flushPendingFlash();
    expect(document.querySelector(".block-flash")).toBeNull();
    document.querySelector(".reader")?.classList.add("band-away");
    flushPendingFlash();
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
  });

  it("flashes at once when the band has stepped aside", () => {
    layOut({ covers: true, away: true });
    flashBlock("spya-aaaaaa");
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
  });

  it("flashes at once under band-covers with no band open", () => {
    // `band-covers` is also on `.reader` with no band at all (Plain on a phone).
    layOut();
    document.querySelector(".reader")?.classList.add("band-covers");
    flashBlock("spya-aaaaaa");
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
  });

  it("lets a newer jump replace the one being held", () => {
    layOut({ covers: true });
    flashBlock("spya-aaaaaa");
    flashBlock("spya-bbbbbb");
    document.querySelector(".mode-band")?.remove();
    flushPendingFlash();
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
    expect(prose("spya-bbbbbb")?.classList.contains("block-flash")).toBe(true);
  });

  it("flushes once: a second flush does not replay it", () => {
    layOut({ covers: true });
    flashBlock("spya-aaaaaa");
    document.querySelector(".mode-band")?.remove();
    flushPendingFlash();
    vi.advanceTimersByTime(FLASH_MS);
    flushPendingFlash();
    expect(document.querySelector(".block-flash")).toBeNull();
  });
});
