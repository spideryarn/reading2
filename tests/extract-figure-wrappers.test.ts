/**
 * **Figures Readability deletes with their wrapper**, because a picture has no
 * text and the wrapper is judged by the link text left beside it.
 * SPIDERYARN-READING2-6A;
 * docs/plans/260930e-figures-readability-deletes-with-their-wrapper.md.
 *
 * Two fixes, one per shape, and both are here:
 *
 * - **Springer Nature**: every figure went on *"High weight and mostly links"*
 *   because of the *Full size image* button beside the picture. The button is
 *   the publisher's own control, so it is furniture (src/furniture.ts).
 * - **Substack**: a figure whose caption carries a link went on *"Low weight
 *   and a little linky"*, and the one beside it, whose caption does not,
 *   survived. That is rule C of src/protect.ts.
 *
 * The two fixtures are cut from the real pages, their figure markup verbatim
 * (tests/fixtures/figure-wrappers/).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

import { readArticle } from "../src/extract.js";
import { removePlatformFurniture } from "../src/furniture.js";
import { loadMathsRenderer } from "../src/maths-server.js";
import {
  HASH_URL,
  NEGATIVE,
  POSITIVE,
  RULES,
  VIDEOS,
  controlOptionsFor,
  keptWithdrawn,
  readabilityWouldTakeItForItsLinks,
  withProtectionDisabled,
} from "../src/protect.js";

beforeAll(loadMathsRenderer);

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/figure-wrappers");
const load = (name: string) => readFile(path.join(DIR, name), "utf8");
const dom = (html: string): Document => new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;

const NATURE_URL = "https://www.nature.com/articles/s41593-022-01026-4";
const SUBSTACK_URL = "https://magazine.sebastianraschka.com/p/gpt-6-astra-looped-transformers-and";

/** What stage 2 kept, as a document, with its audit counts. */
function extracted(html: string, url: string) {
  const r = readArticle(html, url);
  return { doc: dom(r.article?.content ?? ""), kept: r.kept, removed: r.removed };
}

describe("furniture — Springer Nature's figures, deleted for their Full size image button", () => {
  it("keeps both pictures, inside their figures, and removes the two buttons", async () => {
    const { doc, kept, removed } = extracted(await load("springer-nature.html"), NATURE_URL);
    const figures = [...doc.querySelectorAll("figure")];
    expect(figures).toHaveLength(2);
    for (const f of figures) expect(f.querySelector("img"), f.textContent?.slice(0, 60)).not.toBeNull();
    expect(doc.body.textContent).not.toContain("Full size image");
    /* The long description under each figure is the author's text and stays. */
    expect(doc.body.textContent).toContain("GPT-2 generates a contextual embedding");
    expect(removed["div.c-article-section__figure-link"]).toBe(2);
    /* The button's removal is the whole fix; rule C has nothing left to do. */
    expect(kept[RULES.figureWrapper]).toBeUndefined();
  });

  it("loses both pictures to bare Readability — the counterfactual", async () => {
    const d = new JSDOM(await load("springer-nature.html"), { url: NATURE_URL, virtualConsole: new VirtualConsole() });
    const out = dom(new Readability(d.window.document).parse()?.content ?? "");
    expect(out.querySelectorAll("figure")).toHaveLength(2);
    expect(out.querySelectorAll("figure img")).toHaveLength(0);
  });

  const withLinkDiv = (inner: string) =>
    `<!doctype html><html><body><article>` +
    `${"<p>Plenty of prose here, long enough to be the article, and then a good deal more of it besides.</p>".repeat(6)}` +
    `<figure><div class="c-article-section__figure-item"><img src="https://example.org/a.png" alt="">` +
    `<div class="c-article-section__figure-link">${inner}</div></div>` +
    `<figcaption>Fig. 1: a caption</figcaption></figure></article></body></html>`;

  it("declines a credit line whose words are not all inside its link", () => {
    const { removed } = extracted(withLinkDiv(`Photo: <a href="https://example.org/p">A. Smith</a>`), "https://example.org/x");
    expect(removed["div.c-article-section__figure-link"]).toBeUndefined();
  });

  it("declines an author's wholly linked credit without Nature's control marker", () => {
    const doc = dom(withLinkDiv(`<a href="https://example.org/photographers/a-smith">Photo: A. Smith</a>`));
    const removed = removePlatformFurniture(doc);
    expect(removed["div.c-article-section__figure-link"]).toBeUndefined();
    expect(doc.body.textContent).toContain("Photo: A. Smith");
  });

  it("declines content beside the marked control even when it has no text node", () => {
    const doc = dom(
      withLinkDiv(
        `<a href="https://example.org/p" data-track-action="view figure">Full size image</a>` +
          `<span aria-label="Photo: A. Smith"></span>`,
      ),
    );
    const removed = removePlatformFurniture(doc);
    expect(removed["div.c-article-section__figure-link"]).toBeUndefined();
    expect(doc.querySelector('[aria-label="Photo: A. Smith"]')).not.toBeNull();
  });

  it("declines one that holds a picture of its own", () => {
    const { removed } = extracted(
      withLinkDiv(`<a href="https://example.org/p"><img src="https://example.org/b.png" alt="">Full size image</a>`),
      "https://example.org/x",
    );
    expect(removed["div.c-article-section__figure-link"]).toBeUndefined();
  });
});

describe("rule C — a Substack figure whose caption carries a link", () => {
  it("keeps the linked-caption figure and its link, and counts only that one", async () => {
    const { doc, kept } = extracted(await load("substack.html"), SUBSTACK_URL);
    const figures = [...doc.querySelectorAll("figure")];
    expect(figures).toHaveLength(2);
    for (const f of figures) expect(f.querySelector("img"), f.textContent?.slice(0, 60)).not.toBeNull();
    expect(
      figures.find((f) => f.querySelector("figcaption a")),
      "the caption's own link is content and stays",
    ).toBeDefined();
    /* The other figure was never in danger — its caption has no link — so it
       is not counted as a rescue. */
    expect(kept[RULES.figureWrapper]).toBe(1);
  });

  it("loses exactly the linked-caption figure with the pass switched off", async () => {
    const html = await load("substack.html");
    const off = await withProtectionDisabled(() => extracted(html, SUBSTACK_URL));
    const figures = [...off.doc.querySelectorAll("figure")];
    expect(figures).toHaveLength(1);
    expect(figures[0]?.querySelector("figcaption a")).toBeNull();
  });
});

describe("rule C — what it leaves alone", () => {
  const PROSE = (n: number) =>
    `<p>PROSE-${n}. The survey team walked the whole length of the valley twice that autumn, and on the ` +
    `second pass they counted every standing stone again, because the first count had disagreed with the ` +
    `parish records by eleven, and nobody would sign the report until the two agreed.</p>`;
  const page = (inner: string) =>
    `<!doctype html><html><head><title>t</title></head><body><article>${PROSE(1)}${PROSE(2)}${inner}${PROSE(3)}${PROSE(4)}</article></body></html>`;

  it("does not count a wrapped figure that has no link text anywhere", () => {
    const { kept } = extracted(
      page(`<div class="image-container"><figure><div class="inset"><img src="https://example.org/a.png" alt=""></div><figcaption>A plain caption with no link at all in it.</figcaption></figure></div>`),
      "https://example.org/x",
    );
    expect(kept[RULES.figureWrapper]).toBeUndefined();
  });

  it("does not count a linked caption whose link is too short to cross Readability's line", () => {
    const { kept } = extracted(
      page(`<div class="image-container"><figure><img src="https://example.org/a.png" alt=""><figcaption>A long plain caption that says what the figure shows, from <a href="https://example.org/s">here</a>.</figcaption></figure></div>`),
      "https://example.org/x",
    );
    expect(kept[RULES.figureWrapper]).toBeUndefined();
  });

  it("does not count a figure with no picture in it", () => {
    const { kept } = extracted(
      page(`<div class="c"><figure><div class="i"><a href="https://example.org/t">Full size table</a></div><figcaption>Table 1</figcaption></figure></div>`),
      "https://example.org/x",
    );
    expect(kept[RULES.figureWrapper]).toBeUndefined();
  });
});

describe("rule C — the gate is Readability's own two link rules", () => {
  /** Readability's table, off the prototype — the oracle the copies are checked against. */
  const LIVE = (Readability.prototype as unknown as { REGEXPS: Record<string, RegExp | undefined> }).REGEXPS;

  it("copies the weight regexes and the fragment rule character for character", () => {
    expect(POSITIVE.source).toBe(LIVE.positive?.source);
    expect(NEGATIVE.source).toBe(LIVE.negative?.source);
    expect(HASH_URL.source).toBe(LIVE.hashUrl?.source);
    expect(VIDEOS.source).toBe(LIVE.videos?.source);
  });

  const div = (html: string) => dom(`<body>${html}</body>`).body.firstElementChild as Element;
  const figure = (link: string) =>
    `<figure><img src="https://example.org/a.png" alt=""><figcaption>A caption of about fifty characters, then ${link}</figcaption></figure>`;
  const LINKY = `<a href="https://example.org/x">a source link that is fairly long</a>`;

  it("takes a weightless wrapper over 0.2 and leaves one under it", () => {
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c">${figure(LINKY)}</div>`))).toBe(true);
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c">${figure(`<a href="https://example.org/x">x</a>`)}</div>`))).toBe(false);
  });

  it("holds a positive-weight wrapper to 0.5", () => {
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="content">${figure(LINKY)}</div>`))).toBe(false);
  });

  it("adds class and id weight independently", () => {
    expect(readabilityWouldTakeItForItsLinks(div(`<div id="content">${figure(LINKY)}</div>`))).toBe(false);
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="media" id="content">${figure(LINKY)}</div>`))).toBe(true);
  });

  it("counts a fragment link at 0.3 of its length", () => {
    const fragment = `<a href="#ref-1">a source link that is fairly long</a>`;
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c">${figure(fragment)}</div>`))).toBe(false);
  });

  it("does not look at a wrapper with ten commas, as Readability does not", () => {
    const commas = `<a href="https://example.org/x">a, b, c, d, e, f, g, h, i, j, k</a>`;
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c">${figure(commas)}</div>`))).toBe(false);
  });

  it("does not call a negative-weight deletion a link-rule deletion", () => {
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="media">${figure(LINKY)}</div>`))).toBe(false);
  });

  it("honours the low-weight link-rule exemption for list-dominated divs", () => {
    const list = `<ul><li>${LINKY}</li></ul>`;
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c"><figure><img src="a.png">${list}</figure></div>`))).toBe(false);
  });

  it("honours the allowed-video exemption that returns before the link rules", () => {
    const video = `<iframe src="https://www.youtube.com/embed/abc"></iframe>`;
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c">${figure(`${video}${LINKY}`)}</div>`))).toBe(false);
  });

  it("declines a video-only div that Readability converts to a paragraph before cleaning divs", () => {
    const videoFigure = `<figure><video src="movie.mp4"></video><figcaption>${LINKY}</figcaption></figure>`;
    expect(readabilityWouldTakeItForItsLinks(div(`<div class="c">${videoFigure}</div>`))).toBe(false);
  });
});

describe("rule C — the DOM Readability actually judges", () => {
  const prose =
    `<p>` +
    "Author prose remains here for candidate selection and makes this article comfortably long enough. ".repeat(12) +
    `</p>`;

  it("ignores hidden unlinked text that Readability removes before measuring density", () => {
    const hidden =
      "This hidden explanation is deliberately long and unlinked, so counting it would put the source below the line. ".repeat(4);
    const html =
      `<html><body><article>${prose}<div class="wrap"><figure><img src="https://example.org/a.png">` +
      `<figcaption><span hidden>${hidden}</span><a href="https://example.org/source">` +
      `A visible linked source description long enough not to hit the short-content check</a></figcaption>` +
      `</figure></div></article></body></html>`;
    const { doc, kept } = extracted(html, "https://example.org/x");
    expect(doc.querySelector('img[src="https://example.org/a.png"]')).not.toBeNull();
    expect(kept[RULES.figureWrapper]).toBe(1);
  });

  it("ignores a footer that Readability cleans before conditional divs", () => {
    const footer =
      "This footer is deliberately long and unlinked, so counting it would put the source below the line. ".repeat(4);
    const html =
      `<html><body><article>${prose}<div class="wrap"><figure><img src="https://example.org/a.png">` +
      `<figcaption><footer>${footer}<iframe src="https://www.youtube.com/embed/inside-removed-footer"></iframe></footer>` +
      `<a href="https://example.org/source">` +
      `A visible linked source description long enough not to hit the short-content check</a></figcaption>` +
      `</figure></div></article></body></html>`;
    const { doc, kept } = extracted(html, "https://example.org/x");
    expect(doc.querySelector('img[src="https://example.org/a.png"]')).not.toBeNull();
    expect(kept[RULES.figureWrapper]).toBe(1);
  });

  it("walks past a safe inner wrapper and unwraps the risky outer one", () => {
    const linked = `<a href="https://example.org/source">a linked source whose length puts density between the two thresholds</a>`;
    const html =
      `<html><body><article>${prose}<div class="outer"><div class="content"><figure>` +
      `<img src="https://example.org/a.png"><figcaption>A short caption followed by ${linked}</figcaption>` +
      `</figure></div></div></article></body></html>`;
    const { doc, kept } = extracted(html, "https://example.org/x");
    expect(doc.querySelector('img[src="https://example.org/a.png"]')).not.toBeNull();
    expect(kept[RULES.figureWrapper]).toBe(1);
  });
});

describe("rule C — under the same fallback as rules A and B", () => {
  it("is switched off by the control arm when it fired, and renamed when withdrawn", () => {
    const kept = { [RULES.figureWrapper]: 3 };
    expect(controlOptionsFor(kept)).toEqual({ withoutFigureWrappers: true });
    expect(keptWithdrawn(kept)).toEqual({ [RULES.figureWrapperRolledBack]: 3 });
  });

  /**
   * **GPT Sol's page**, found in the plan review and rebuilt against the built
   * gate on 2026-09-30 (the first version had 141 commas, which the gate
   * declines): four sibling `<article>` sections of the author's prose, and a
   * figure whose two linked caption paragraphs sit inside its picture's neutral
   * `div`. Unwrapped, the figure wins candidate selection and all four
   * sections go — so the control has to ship, and does, and the picture is the
   * price.
   */
  it("gives the picture up rather than the author's four sections", () => {
    const sentence =
      "The valley survey recorded every standing stone twice, then compared observations with the parish archive before publishing the final account. ";
    const caption =
      "This linked figure caption describes measurements; instruments; sampling conditions; and all observed results in extensive detail. ";
    const html =
      `<html><head><title>T</title></head><body>` +
      [0, 1, 2, 3].map((n) => `<article><p>AUTHOR-${n} ${sentence}</p></article>`).join("") +
      `<figure><div class="figure-box"><img src="x.png">` +
      `<p><a href="/source">${caption}</a></p><p><a href="/source">${caption}source material</a></p></div></figure>` +
      `</body></html>`;
    const r = readArticle(html, "https://example.org/x");
    const text = dom(r.article?.content ?? "").body.textContent ?? "";
    for (const n of [0, 1, 2, 3]) expect(text, `section ${n}`).toContain(`AUTHOR-${n}`);
    expect(dom(r.article?.content ?? "").querySelector("img")).toBeNull();
    expect(r.kept).toEqual({ [RULES.figureWrapperRolledBack]: 1 });
  });
});
