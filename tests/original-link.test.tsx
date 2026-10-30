// @vitest-environment jsdom
/**
 * A web article's figures, tables and media each get a way back to the
 * publisher's page, aimed at the element where the page lets us
 * (src/web/OriginalLink.tsx, report spya-weuekx, plan 261024w).
 *
 * The first blocks below are cut from production's copy of arxiv-2308-08708
 * (Butlin et al.), shortened, so the ids are the ones arxiv.org/html/2308.08708
 * has.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RESERVED_ATTRS } from "../src/reserved.js";
import type { Article, Block, BlockId, BlockKind } from "../src/types.js";
import { OriginalLinkNote, originalLinksIn } from "../src/web/OriginalLink.js";

const URL = "https://arxiv.org/html/2308.08708";

function block(id: string, html: string, tag = "p", kind: BlockKind = "text"): Block {
  const div = document.createElement("div");
  div.innerHTML = html;
  return { id: id as BlockId, tag, kind, text: div.textContent ?? "", html } as Block;
}

function article(blocks: Block[], meta: Record<string, unknown> = { url: URL }): Article {
  return {
    meta: { slug: "a-piece", title: "A piece", ...meta },
    blocks,
    tree: { version: "toc/4", nodes: [], roots: [] },
  } as unknown as Article;
}

const FIGURE = block(
  "spya-ygqdq4",
  '<figure id="spya-ygqdq4"><img id="S2.F1.g1" src="x1.png" alt=""><figcaption><span id="S2.F1.3">Figure 1: </span>An unfolded recurrent neural network</figcaption></figure>',
  "figure",
  "media",
);
const TABLE = block(
  "spya-zp40de",
  '<figure id="spya-zp40de"><figcaption>Table 2: Indicator Property Entailments</figcaption><table id="S2.T2.2"><tbody><tr><td>RPT-1</td></tr></tbody></table></figure>',
  "figure",
  "media",
);
const PROSE = block(
  "spya-rme98g",
  "<p>These ideas inform our investigation in different ways. We adopt computational functionalism as a working hypothesis.</p>",
);
/** Box 1 as production stores it today: the frame, and none of its words. */
const EMPTY_BOX = block(
  "spya-wejt97",
  '<p id="spya-wejt97"><span><svg id="S1.SS2.p5.pic1" viewBox="0 0 650 360.88"><g><path d="M 0 5.91 L 0 354.97 Z"></path></g></svg></span>\n</p>',
);

describe("which blocks get a link", () => {
  it("a figure and a table, aimed at the ids the publisher's page has, and not a paragraph", () => {
    const links = originalLinksIn(article([FIGURE, PROSE, TABLE]));
    expect([...links.keys()]).toEqual(["spya-ygqdq4", "spya-zp40de"]);
    expect(links.get(FIGURE.id)).toEqual({ href: `${URL}#S2.F1.g1`, aim: "element", kind: "figure" });
    expect(links.get(TABLE.id)).toEqual({ href: `${URL}#S2.T2.2`, aim: "element", kind: "table" });
  });

  it("the empty frame of a box we failed to lift, which is the block most worth checking (spya-weuekx)", () => {
    expect(originalLinksIn(article([EMPTY_BOX])).get(EMPTY_BOX.id)).toEqual({
      href: `${URL}#S1.SS2.p5.pic1`,
      aim: "element",
      kind: "figure",
    });
  });

  it("not what figures.ts says is no figure: a rule, an icon in a sentence, a layout table", () => {
    const rule = block("spya-aaaaaa", "<hr>", "hr", "media");
    const inline = block("spya-bbbbbb", '<p>Press the <img src="gear.png" alt="settings"> button, then choose the second option.</p>');
    const layout = block("spya-cccccc", '<table role="presentation"><tbody><tr><td>a</td></tr></tbody></table>', "table", "other");
    expect(originalLinksIn(article([rule, inline, layout])).size).toBe(0);
  });

  it("nothing for an article with no web address: an upload or an address that is not http(s)", () => {
    expect(originalLinksIn(article([FIGURE], {})).size).toBe(0);
    expect(originalLinksIn(article([FIGURE], { url: "javascript:alert(1)" })).size).toBe(0);
  });

  it("not a fetched PDF merely because it has a web address, for its owner or a visitor", () => {
    expect(originalLinksIn(article([FIGURE], { source: "pdf", url: `${URL}.pdf` })).size).toBe(0);

    /* PublicMeta withholds `source`, but the public blocks keep the PDF marker.
       That marker is the remaining proof that this address is a PDF, not an
       HTML page whose ids and captions can be targeted. */
    const marked = block(
      "spya-pdfpdf",
      `<figure ${RESERVED_ATTRS.pdfFigure}="opaque-ref.3.1"><figcaption>Figure 1: From a PDF</figcaption></figure>`,
      "figure",
      "media",
    );
    expect(originalLinksIn(article([marked], { url: `${URL}.pdf` })).size).toBe(0);
  });
});

describe("where it lands", () => {
  it("on the caption's opening words when nothing inside has an id of the page's", () => {
    const figure = block(
      "spya-dddddd",
      '<figure id="spya-dddddd"><img src="a.png" alt=""><figcaption>Fig. 3: Ice-age cycles, re-drawn &amp; 100% “extended” #2</figcaption></figure>',
      "figure",
      "media",
    );
    const link = originalLinksIn(article([figure])).get(figure.id);
    expect(link?.aim).toBe("element");
    expect(link?.href).toBe(`${URL}#:~:text=Fig.%203%3A%20Ice%2Dage%20cycles%2C%20re%2Ddrawn%20%26`);
    const more = block("spya-eeeeee", '<figure><img src="a.png" alt=""><figcaption>A &amp; B: 100% “é” #2</figcaption></figure>', "figure", "media");
    expect(originalLinksIn(article([more])).get(more.id)?.href).toBe(
      `${URL}#:~:text=A%20%26%20B%3A%20100%25%20%E2%80%9C%C3%A9%E2%80%9D%20%232`,
    );
  });

  it("on the page itself when there is neither, and the address's own fragment is dropped", () => {
    const table = block("spya-ffffff", "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>", "table", "other");
    expect(originalLinksIn(article([table], { url: `${URL}#S1` })).get(table.id)).toEqual({
      href: URL,
      aim: "page",
      kind: "table",
    });
  });

  it("percent-encodes an id, so a page's id cannot be anything but a fragment", () => {
    const odd = block("spya-gggggg", '<figure><img id="a b#c?d" src="a.png" alt=""></figure>', "figure", "media");
    expect(originalLinksIn(article([odd])).get(odd.id)?.href).toBe(`${URL}#a%20b%23c%3Fd`);
  });

  it("only at the page for a block from a later page of a multi-page article, whose ids page 1 does not have", () => {
    const later = block("spya-hhhhhh", '<figure><img id="p2-fig4" src="a.png" alt=""><figcaption>Figure 4: later</figcaption></figure>', "figure", "media");
    expect(originalLinksIn(article([later])).get(later.id)).toEqual({ href: URL, aim: "page", kind: "figure" });
  });
});

describe("the control", () => {
  it("is a quiet link to a new tab, named for what it opens", () => {
    const html = renderToStaticMarkup(<OriginalLinkNote link={{ href: `${URL}#S2.F1.g1`, aim: "element", kind: "figure" }} />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const a = host.querySelector("a");
    expect(a?.getAttribute("href")).toBe(`${URL}#S2.F1.g1`);
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toContain("noopener");
    expect(a?.textContent).toBe("Open this figure in the original");
  });

  it("promises only the page when it cannot aim, and nothing at all for no link", () => {
    expect(renderToStaticMarkup(<OriginalLinkNote link={{ href: URL, aim: "page", kind: "table" }} />)).toContain("Open the original page");
    expect(renderToStaticMarkup(<OriginalLinkNote link={undefined} />)).toBe("");
  });
});
