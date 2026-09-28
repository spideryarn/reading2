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
import { readFileSync } from "node:fs";

const { FLASH_MS, dropPendingFlash, flashBlock, flushPendingFlash, resetFlash } = await import(
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

  it("clears the live wash and its timer when the reading view leaves", () => {
    layOut();
    flashBlock("spya-aaaaaa");
    expect(vi.getTimerCount()).toBe(1);
    resetFlash();
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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

describe("the flash stylesheet", () => {
  const css = readFileSync("src/web/styles/prose.css", "utf8");

  it("composes the still wash with a literal search-hit rail", () => {
    const body = css.match(
      /td\.text\.has-hit:not\(\[data-hues\]\)\.block-flash-still\s*\{([^}]*)\}/,
    )?.[1];
    expect(body).toContain("inset 3px");
    expect(body).toContain("100vmax");
  });

  it("composes the animated wash with a literal search-hit rail", () => {
    const keyframes = css.match(/@keyframes block-flash-with-hit\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(keyframes).toContain("inset 3px");
    expect(keyframes).toContain("100vmax");
  });

  it("keeps the still wash over a semantic search rail", () => {
    const body = css.match(
      /td\.text\.has-hit\[data-hues\]\.block-flash-still\s*\{([^}]*)\}/,
    )?.[1];
    expect(body).toContain("100vmax");
  });

  it("wins the real cascade against the later search-hit rules", () => {
    /* The source checks above prove the intended declarations exist; this is
       the independent half. Load both sheets in their production order and
       ask the CSS engine which declarations actually win. */
    const style = document.createElement("style");
    style.textContent = `${css}\n${readFileSync("src/web/styles/annotations.css", "utf8")}`;
    document.head.append(style);
    document.body.innerHTML = `
      <table><tbody><tr>
        <td id="literal-still" class="text has-hit block-flash-still"></td>
        <td id="semantic-still" class="text has-hit block-flash-still" data-hues="1"></td>
        <td id="literal-moving" class="text has-hit block-flash"></td>
      </tr></tbody></table>`;

    const literalStill = getComputedStyle(document.querySelector("#literal-still") as Element);
    const semanticStill = getComputedStyle(document.querySelector("#semantic-still") as Element);
    const literalMoving = getComputedStyle(document.querySelector("#literal-moving") as Element);
    expect(literalStill.boxShadow).toContain("inset 3px");
    expect(literalStill.boxShadow).toContain("100vmax");
    expect(semanticStill.boxShadow).toContain("100vmax");
    expect(literalMoving.animationName).toBe("block-flash-with-hit");
    style.remove();
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
