/**
 * A click on one of the article's own internal links — src/web/internal-links.ts.
 *
 * The DOM is built with jsdom rather than driven in a browser, because what is
 * being checked is the *decision* — which block, or none — and not the scroll
 * that follows it. See docs/project/testing.md.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { internalTarget } from "../src/web/internal-links.js";

/** The shape TableView renders: one row per block, prose injected into a cell. */
function table(rows: string): Document {
  const dom = new JSDOM(`<table><tbody>${rows}</tbody></table>`);
  return dom.window.document;
}

const row = (id: string, prose: string) =>
  `<tr data-block="${id}"><td><div class="prose">${prose}</div></td></tr>`;

const clicked = (doc: Document, selector: string) =>
  internalTarget(doc.querySelector(selector)!, doc);

describe("internalTarget", () => {
  it("resolves a link to a block onto that block", () => {
    const doc = table(
      row("spya-aaa111", `<p id="spya-aaa111">See <a href="#spya-bbb222">below</a>.</p>`) +
        row("spya-bbb222", `<h2 id="spya-bbb222">Below</h2>`),
    );
    expect(clicked(doc, "a")).toBe("spya-bbb222");
  });

  it("resolves a click on something inside the link, not just the link", () => {
    // The reader clicks the <em>, and `e.target` is the <em>. Delegation means
    // every handler here sees the deepest node under the pointer.
    const doc = table(
      row("spya-aaa111", `<p><a href="#spya-bbb222">see <em>below</em></a></p>`) +
        row("spya-bbb222", `<h2 id="spya-bbb222">Below</h2>`),
    );
    expect(clicked(doc, "em")).toBe("spya-bbb222");
  });

  it("resolves an id smaller than a block onto the row that contains it", () => {
    // Only block elements are restamped, so an id on a span survives stage 3
    // and is still the thing the link names. The row is the finest thing this
    // view can put under the reader's eye.
    const doc = table(
      row("spya-aaa111", `<p><a href="#fn1">the note</a></p>`) +
        row("spya-bbb222", `<p>Text <span id="fn1">and a footnote</span>.</p>`),
    );
    expect(clicked(doc, "a")).toBe("spya-bbb222");
  });

  it("refuses a link that leaves the article", () => {
    const doc = table(row("spya-aaa111", `<p><a href="https://x.test/p#spya-bbb222">out</a></p>`));
    expect(clicked(doc, "a")).toBeNull();
  });

  it("refuses a fragment nothing in the document answers to", () => {
    // A dead link is left to the browser, which does nothing with it. Inventing
    // a destination would be worse than the dead link.
    const doc = table(row("spya-aaa111", `<p><a href="#footer">footer</a></p>`));
    expect(clicked(doc, "a")).toBeNull();
  });

  it("refuses a bare #, which means the top of the page and not a block", () => {
    const doc = table(row("spya-aaa111", `<p><a href="#">top</a></p>`));
    expect(clicked(doc, "a")).toBeNull();
  });

  it("refuses a click that is not on a link at all", () => {
    const doc = table(row("spya-aaa111", `<p>Just words.</p>`));
    expect(clicked(doc, "p")).toBeNull();
  });

  it("decodes a percent-encoded fragment before looking for it", () => {
    const doc = table(
      row("spya-aaa111", `<p><a href="#caf%C3%A9">there</a></p>`) +
        row("spya-bbb222", `<p><span id="café">Café</span></p>`),
    );
    expect(clicked(doc, "a")).toBe("spya-bbb222");
  });

  it("survives a malformed fragment rather than throwing", () => {
    // `decodeURIComponent("%")` throws. A stray percent in an href is not a
    // reason for a click to take the reading view down.
    const doc = table(row("spya-aaa111", `<p><a href="#100%">there</a></p>`));
    expect(clicked(doc, "a")).toBeNull();
  });

  it("lets an id beat a named anchor that claims the same word", () => {
    // The HTML spec resolves a fragment against every id in the document first
    // and only then against named anchors, so the earlier <a name> loses. One
    // selector matching either would take whichever came first instead.
    const doc = table(
      row("spya-aaa111", `<p><a href="#x">go</a></p>`) +
        row("spya-bbb222", `<p><a name="x"></a>Named first.</p>`) +
        row("spya-ccc333", `<h2 id="x">The id</h2>`),
    );
    expect(clicked(doc, 'a[href="#x"]')).toBe("spya-ccc333");
  });

  it("survives a fragment that is not a legal selector", () => {
    // The fragment comes out of somebody else's HTML and lands in a selector.
    // `querySelector` throws on one it cannot parse, and a strange link is not
    // a reason for a click to take the reading view down.
    const doc = table(row("spya-aaa111", `<p><a href="#a]b[c">there</a></p>`));
    expect(() => clicked(doc, "a")).not.toThrow();
    expect(clicked(doc, "a")).toBeNull();
  });

  it("names a block id that is not in this article as no block at all", () => {
    // `?at=` pointing at a block that does not exist is a URL that restores to
    // nothing, so the fragment has to be checked against the rows rather than
    // trusted for looking like one of ours.
    const doc = table(row("spya-aaa111", `<p><a href="#spya-zzz999">elsewhere</a></p>`));
    expect(clicked(doc, "a")).toBeNull();
  });
});
