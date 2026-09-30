// @vitest-environment jsdom
/**
 * **A cross-reference is drawn where the server said, once, and as one link** —
 * `xrefMarks` and the `xref` branch of `annotateHtml` (src/web/annotate.ts),
 * and the resolver every handler goes through (src/web/xref.ts).
 *
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md
 * § 2, and Sol's F2, F4 and F6 on it:
 *
 *  - the mark carries `data-xref="<nonce>-<i>"`, and only a mark whose nonce is
 *    this page's resolves — to `links[i].to`, never to anything in the DOM;
 *  - a phrase split by an `<em>` is several `<mark>` pieces and **one** Tab stop;
 *  - a phrase found twice is skipped (the server's own unique rule);
 *  - a phrase crossing an author's `<a href>` is dropped, so their link keeps
 *    its click.
 *
 * jsdom, for citation-marks.test.ts's reason: the spans live in the browser's
 * text-node offset space.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { annotateHtml, xrefMarks } from "../src/web/annotate.js";
import { XREF_NONCE, xrefIndex, xrefTarget } from "../src/web/xref.js";
import type { Block, BlockId, Crossref } from "../src/types.js";

const block = (id: string, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-p7w2dn" as BlockId;
const THREE = "spya-h4v8zr" as BlockId;
const FOUR = "spya-m5n6p7" as BlockId;

const NONCE = "abc123def456";

const BLOCKS: Block[] = [
  block(ONE, "<p>We found that sleep loss reduced recall by 38% in older adults.</p>"),
  block(TWO, "<p>As the <em>second experiment</em> showed, the effect held.</p>"),
  block(THREE, "<p>The effect held. Later, the effect held again.</p>"),
  block(FOUR, `<p>See <a href="https://example.com">the original study</a> for details.</p>`),
];

const LINKS: Crossref[] = [
  { from: ONE, phrase: "reduced recall by 38%", to: FOUR },
  { from: TWO, phrase: "the second experiment showed", to: ONE },
  { from: THREE, phrase: "the effect held", to: ONE },
  { from: FOUR, phrase: "the original study for", to: TWO },
];

function drawn(b: Block, nonce = NONCE): HTMLElement {
  const marks = xrefMarks(BLOCKS, LINKS, nonce).get(b.id) ?? [];
  const host = document.createElement("div");
  host.innerHTML = annotateHtml(b.html, marks);
  return host;
}

describe("xrefMarks", () => {
  it("marks the phrase with the nonce-bearing id, one focus stop, and the phrase as its name", () => {
    const host = drawn(BLOCKS[0]!);
    const marks = host.querySelectorAll("mark.xref");
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;
    expect(mark.textContent).toBe("reduced recall by 38%");
    expect(mark.getAttribute("data-xref")).toBe(`${NONCE}-0`);
    expect(mark.getAttribute("tabindex")).toBe("0");
    expect(mark.getAttribute("role")).toBe("link");
    expect(mark.getAttribute("aria-label")).toBe("reduced recall by 38%");
    /* Never the target on the mark: the DOM is not where `to` comes from. */
    expect(mark.hasAttribute("data-block-link")).toBe(false);
    expect(mark.outerHTML).not.toContain(FOUR);
  });

  it("a phrase split by an <em> is several pieces and exactly one Tab stop", () => {
    const host = drawn(BLOCKS[1]!);
    const pieces = [...host.querySelectorAll("mark.xref")];
    expect(pieces.length, "the <em> should split the phrase").toBeGreaterThan(1);
    expect(pieces.map((p) => p.textContent).join("")).toBe("the second experiment showed");
    expect(pieces.every((p) => p.getAttribute("data-xref") === `${NONCE}-1`)).toBe(true);
    const stops = pieces.filter((p) => p.hasAttribute("tabindex"));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(pieces[0]);
    expect(pieces.filter((p) => p.getAttribute("role") === "link")).toHaveLength(1);
    expect(stops[0]!.getAttribute("aria-label")).toBe("the second experiment showed");
  });

  it("a phrase that occurs twice is skipped rather than guessed", () => {
    expect(drawn(BLOCKS[2]!).querySelectorAll("mark.xref")).toHaveLength(0);
  });

  it("a phrase crossing an author's link is dropped, and the link is left alone", () => {
    const host = drawn(BLOCKS[3]!);
    expect(host.querySelectorAll("mark.xref")).toHaveLength(0);
    expect(host.querySelector("a")?.textContent).toBe("the original study");
  });
});

describe("xrefTarget", () => {
  it("resolves our mark to `to` from the artefact, from any piece", () => {
    const host = drawn(BLOCKS[1]!, XREF_NONCE);
    for (const piece of host.querySelectorAll("mark.xref")) {
      expect(xrefTarget(piece, LINKS)).toBe(ONE);
    }
  });

  it("a forged mark in the article's own html resolves to nothing", () => {
    const forged = document.createElement("div");
    forged.innerHTML = `<p><mark class="xref" data-xref="x-0" data-block-link="${FOUR}">look</mark></p>`;
    expect(xrefTarget(forged.querySelector("mark"), LINKS)).toBeNull();
    /* Even the right shape with a guessed nonce. */
    forged.innerHTML = `<p><mark class="xref" data-xref="${NONCE}-0">look</mark></p>`;
    expect(xrefTarget(forged.querySelector("mark"), LINKS)).toBeNull();
  });

  it("is strict about shape and range", () => {
    const el = document.createElement("mark");
    for (const bad of [`${XREF_NONCE}-`, `${XREF_NONCE}-01`, `${XREF_NONCE}-1x`, `${XREF_NONCE}x-1`]) {
      el.setAttribute("data-xref", bad);
      expect(xrefIndex(el), bad).toBeNull();
    }
    el.className = "xref";
    el.setAttribute("data-xref", `${XREF_NONCE}-99`);
    expect(xrefTarget(el, LINKS)).toBeNull();
    el.setAttribute("data-xref", `${XREF_NONCE}-0`);
    expect(xrefTarget(el, null)).toBeNull();
    expect(xrefTarget(el, LINKS)).toBe(FOUR);
  });
});

describe("xref keyboard focus", () => {
  it("reserves the fixed dock's room when the browser scrolls a focused mark into view", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve("src/web/styles/annotations.css"), "utf8");
    document.head.append(style);
    const mark = document.createElement("mark");
    mark.className = "xref";
    document.body.append(mark);
    expect(getComputedStyle(mark).scrollMarginBlockEnd).toBe(
      "calc(var(--dock-space) + var(--hint-h) + 0.75rem)",
    );
    mark.remove();
    style.remove();
  });
});
