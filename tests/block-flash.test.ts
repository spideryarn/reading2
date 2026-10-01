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

const { FLASH_MS, dropPendingFlash, flashBlock, flashElement, flushPendingFlash, resetFlash } =
  await import(
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

describe("flashElement — a Metadata section, plan 261001s", () => {
  it("washes the element for the block flash's length, restartably", () => {
    document.body.innerHTML = '<section id="a"></section><section id="b"></section>';
    const a = document.getElementById("a") as HTMLElement;
    const b = document.getElementById("b") as HTMLElement;
    flashElement(a);
    expect(a.classList.contains("element-flash")).toBe(true);
    vi.advanceTimersByTime(FLASH_MS - 100);
    flashElement(a);
    vi.advanceTimersByTime(200);
    expect(a.classList.contains("element-flash"), "still on the second clock").toBe(true);
    flashElement(b);
    expect(a.classList.contains("element-flash"), "the older one ends").toBe(false);
    vi.advanceTimersByTime(FLASH_MS);
    expect(b.classList.contains("element-flash")).toBe(false);
  });

  it("holds a still wash under reduced motion", () => {
    reduceMotion(true);
    document.body.innerHTML = '<section id="a"></section>';
    const a = document.getElementById("a") as HTMLElement;
    flashElement(a);
    expect(a.classList.contains("element-flash-still")).toBe(true);
    expect(a.classList.contains("element-flash")).toBe(false);
  });
});

describe("the flash stylesheet", () => {
  const css = readFileSync("src/web/styles/prose.css", "utf8");

  it("turns the element flash class into a visible, pointer-transparent overlay", () => {
    const overlay = css.match(
      /\.element-flash::after,\s*\.element-flash-still::after\s*\{([^}]*)\}/,
    )?.[1];
    expect(overlay).toContain('content: ""');
    expect(overlay).toContain("background: var(--spideryarn-orange)");
    expect(overlay).toContain("pointer-events: none");
    expect(css).toMatch(/\.element-flash::after\s*\{\s*animation: element-flash/);
    expect(css).toMatch(/\.element-flash-still::after\s*\{\s*opacity: 0\.22/);
  });

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

/**
 * **A passage, not the block** — the optional target Trajectory passes
 * (plan 260928a § 7b; Greg, 2026-09-28: "I was hoping it would flash the
 * specific Quote"). The quote is drawn as `mark.hit` fragments whose
 * `data-hit` lists the Found keys covering them (annotate.ts), possibly split
 * across an `<em>`, possibly shared with another key.
 */
describe("flashBlock with a passage", () => {
  const KEY = "q-1:spya-aaaaaa:0";
  function withQuote({ covers = false } = {}): void {
    layOut({ covers });
    const td = prose("spya-aaaaaa");
    if (td)
      td.innerHTML = `<div class="prose"><p>Before <mark class="hit" data-hit="${KEY}">the quote </mark><em><mark class="hit" data-hit="other ${KEY}">itself</mark></em> and <mark class="hit" data-hit="other">another</mark>.</p></div>`;
  }
  const washed = () =>
    [...document.querySelectorAll<HTMLElement>(".passage-flash, .passage-flash-still")].map(
      (m) => m.textContent,
    );

  it("washes every fragment of the passage, and not the cell", () => {
    withQuote();
    flashBlock("spya-aaaaaa", { passage: KEY });
    expect(washed()).toEqual(["the quote ", "itself"]);
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
    vi.advanceTimersByTime(FLASH_MS);
    expect(washed()).toEqual([]);
  });

  it("restarts a passage flash on the newer clock", () => {
    withQuote();
    flashBlock("spya-aaaaaa", { passage: KEY });
    vi.advanceTimersByTime(FLASH_MS - 100);
    flashBlock("spya-aaaaaa", { passage: KEY });
    vi.advanceTimersByTime(200);
    expect(washed(), "still on the second clock").toEqual(["the quote ", "itself"]);
    vi.advanceTimersByTime(FLASH_MS);
    expect(washed()).toEqual([]);
  });

  it("falls back to the block when the passage is not drawn", () => {
    layOut();
    flashBlock("spya-aaaaaa", { passage: KEY });
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(true);
  });

  it("is still under reduced motion", () => {
    reduceMotion(true);
    withQuote();
    flashBlock("spya-aaaaaa", { passage: KEY });
    expect(document.querySelectorAll(".passage-flash-still")).toHaveLength(2);
    expect(document.querySelector(".passage-flash")).toBeNull();
  });

  it("is held behind a band with its passage, and a newer flash replaces it", () => {
    withQuote({ covers: true });
    flashBlock("spya-aaaaaa", { passage: KEY });
    expect(washed()).toEqual([]);
    document.querySelector(".mode-band")?.remove();
    flushPendingFlash();
    expect(washed()).toEqual(["the quote ", "itself"]);
    flashBlock("spya-bbbbbb");
    expect(washed(), "a newer flash takes the older one off").toEqual([]);
    expect(prose("spya-bbbbbb")?.classList.contains("block-flash")).toBe(true);
  });

  it("has a wash in the stylesheet that beats the rung quote's own background", () => {
    /* jsdom will not resolve `var()` inside a colour, so both colours are made
       literal — the wash and the rung quote's tint — or the competing rule
       would simply be dropped and the cascade would never be asked.

       And jsdom lets a LATER, LESS specific `background: none` shorthand beat an
       earlier, more specific `background-color` longhand, which no browser
       does (probed 2026-09-28: the same two rules gave `rgba(0, 0, 0, 0)` with
       the shorthand, `rgb(1, 2, 3)` with `background-color: transparent`). So
       `mark.hit`'s reset is spelled as the longhand it amounts to here. */
    const annotations = readFileSync("src/web/styles/annotations.css", "utf8");
    const ring = "rgb(var(--quote-stroke-rgb) / 0.18)";
    expect(annotations, "the rung quote's tint this test competes against").toContain(ring);
    const css = `${readFileSync("src/web/styles/prose.css", "utf8")}\n${annotations}`
      .replaceAll("var(--highlight-wash)", "rgb(1, 2, 3)")
      .replaceAll(ring, "rgb(9, 9, 9)")
      .replaceAll("background: none;", "background-color: transparent;");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `<table><tbody><tr><td class="text">
      <mark id="m" class="hit passage-flash-still" data-hit="q" data-quote="2" data-hit-open="">x</mark>
      <mark id="c" class="hit" data-hit="q" data-quote="2" data-hit-open="">x</mark>
      <mark id="n" class="hit passage-flash" data-hit="q" data-quote="2">y</mark></td></tr></tbody></table>`;
    const style$ = (id: string) => getComputedStyle(document.querySelector(id) as Element);
    expect(style$("#c").backgroundColor, "control: the ring's tint applies unwashed").toBe("rgb(9, 9, 9)");
    expect(style$("#m").backgroundColor).toBe("rgb(1, 2, 3)");
    /* jsdom does not expand the `animation` shorthand, so the moving rule is
       read from the source, beside its block twin. */
    expect(style$("#n").backgroundColor, "the moving wash is the animation's, not a rule's").toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(css).toMatch(/td\.text mark\.hit\.passage-flash\s*\{\s*animation:\s*passage-flash var\(--flash-ms\)/);
    expect(css).toMatch(/@keyframes passage-flash\s*\{[^}]*background-color: rgb\(1, 2, 3\)/);
    style.remove();
  });
});

/**
 * **A cited work's words** — Citations' *first cited* jump (SPIDERYARN-READING2-6J,
 * plan 260930i). The marks carry `data-cite`, not `data-hit`, and one phrase
 * can cite two works; `citePassageKey` is the one spelling `passageMarks` reads.
 */
describe("flashBlock with a cited work", () => {
  it("washes that work's marks only, and not the paragraph", async () => {
    const { citePassageKey } = await import("../src/web/rows.js");
    layOut();
    const td = prose("spya-aaaaaa");
    if (td)
      td.innerHTML = `<div class="prose"><p>Lab tasks <mark class="cite" data-cite="spya-waaaaa">[1,2]</mark>, eye movements <mark class="cite" data-cite="spya-wbbbbb spya-waaaaa">[3–5]</mark> and <mark class="cite" data-cite="spya-wccccc">[6]</mark>.</p></div>`;
    flashBlock("spya-aaaaaa", { passage: citePassageKey("spya-wccccc") });
    const washed = () => [...document.querySelectorAll(".passage-flash")].map((m) => m.textContent);
    expect(washed()).toEqual(["[6]"]);
    expect(prose("spya-aaaaaa")?.classList.contains("block-flash")).toBe(false);
    vi.advanceTimersByTime(FLASH_MS);
    flashBlock("spya-aaaaaa", { passage: citePassageKey("spya-waaaaa") });
    expect(washed()).toEqual(["[1,2]", "[3–5]"]);
  });

  /* SPIDERYARN-READING2-7X: "a little bit too subtle and quick, so I often
     don't quite spot the flash". Longer and stronger on a cited work's words
     only — a few words are a small patch; a paragraph and Trajectory's every
     step keep the old wash (Sol, plan 261001m review). */
  it("holds a cited work's flash for longer than a paragraph's", async () => {
    const { citePassageKey } = await import("../src/web/rows.js");
    const { CITE_FLASH_MS } = await import("../src/web/flash.js");
    expect(CITE_FLASH_MS).toBeGreaterThanOrEqual(2 * FLASH_MS);
    layOut();
    const td = prose("spya-aaaaaa");
    if (td) td.innerHTML = `<p>Lab tasks <mark class="cite" data-cite="spya-waaaaa">[1]</mark>.</p>`;
    flashBlock("spya-aaaaaa", { passage: citePassageKey("spya-waaaaa") });
    const mark = () => document.querySelector("mark.cite");
    vi.advanceTimersByTime(CITE_FLASH_MS - 1);
    expect(mark()?.classList.contains("passage-flash")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(mark()?.classList.contains("passage-flash")).toBe(false);
  });

  it("holds the stronger still wash for the cited-work length under reduced motion", async () => {
    const { citePassageKey } = await import("../src/web/rows.js");
    const { CITE_FLASH_MS } = await import("../src/web/flash.js");
    reduceMotion(true);
    layOut();
    const td = prose("spya-aaaaaa");
    if (td) td.innerHTML = `<p>Lab tasks <mark class="cite" data-cite="spya-waaaaa">[1]</mark>.</p>`;
    flashBlock("spya-aaaaaa", { passage: citePassageKey("spya-waaaaa") });
    const mark = () => document.querySelector("mark.cite");
    expect(mark()?.classList.contains("passage-flash-still")).toBe(true);
    vi.advanceTimersByTime(FLASH_MS);
    expect(mark()?.classList.contains("passage-flash-still"), "not shortened to the ordinary flash").toBe(true);
    vi.advanceTimersByTime(CITE_FLASH_MS - FLASH_MS);
    expect(mark()?.classList.contains("passage-flash-still")).toBe(false);
  });

  it("keeps each animation's length in one token the timers match", async () => {
    const { CITE_FLASH_MS } = await import("../src/web/flash.js");
    const tokens = readFileSync("src/web/styles/tokens.css", "utf8");
    const prose = readFileSync("src/web/styles/prose.css", "utf8");
    expect(tokens).toMatch(new RegExp(`--flash-ms:\\s*${FLASH_MS}ms;`));
    expect(tokens).toMatch(new RegExp(`--cite-flash-ms:\\s*${CITE_FLASH_MS}ms;`));
    expect(tokens).toMatch(/--flash-wash-strong:/);
    /* No literal length left anywhere a flash animates. */
    expect(prose).not.toMatch(/flash[\w-]* \d+(\.\d+)?m?s/);
    expect(prose).toMatch(/td\.text mark\.cite\.passage-flash\s*\{\s*animation:\s*cite-flash var\(--cite-flash-ms\)/);
    expect(prose).toMatch(/@keyframes cite-flash\s*\{[^}]*var\(--flash-wash-strong\)/);
    expect(prose).toMatch(/td\.text mark\.cite\.passage-flash-still\s*\{\s*background-color:\s*var\(--flash-wash-strong\)/);
  });

  it("has a wash for a cite mark in the stylesheet", () => {
    const proseCss = readFileSync("src/web/styles/prose.css", "utf8");
    const css = `${proseCss}\n${readFileSync("src/web/styles/annotations.css", "utf8")}`
      .replaceAll("var(--flash-wash-strong)", "rgb(1, 2, 3)")
      /* jsdom's shorthand cascade bug is documented by the passage test above. */
      .replaceAll("background: none;", "background-color: transparent;");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `<table><tbody><tr><td class="text">
      <mark id="cite-still" class="cite passage-flash-still">x</mark>
      <mark id="cite-moving" class="cite passage-flash">y</mark>
    </td></tr></tbody></table>`;
    expect(getComputedStyle(document.querySelector("#cite-still") as Element).backgroundColor).toBe(
      "rgb(1, 2, 3)",
    );
    /* jsdom does not reliably expand this animation shorthand in the combined
       production sheets; the source assertion below owns the moving half. */
    expect(css).toMatch(/td\.text mark\.cite\.passage-flash-still\s*\{\s*background-color:/);
    style.remove();
  });
});
