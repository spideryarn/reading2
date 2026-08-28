// @vitest-environment jsdom
/**
 * The enlarge button that `zoomable.ts` injects into the article's own HTML.
 *
 * Three of the four things checked here fail **silently** — the page renders,
 * nothing throws, and the damage is somewhere else entirely:
 *
 * - a wrapper that the HTML parser does not put back where we serialised it
 *   splits a paragraph in two, in a view whose whole contract is that a block
 *   is one addressable thing (docs/project/block-ids.md);
 * - one character of text inside the button shifts every comment anchored in
 *   that block, because anchoring counts characters of rendered text
 *   (src/web/selection.ts);
 * - a button on a tracking pixel is a light square in the middle of a
 *   paragraph, since the same wrapper carries the figure's light sheet.
 *
 * jsdom rather than the default node environment (vitest.config.ts), for the
 * reason annotate.test.ts gives: the module under test is a DOM pass over an
 * html string, and reimplementing one here would be testing the reimplementation.
 *
 * The round-trip test is the one worth reading: it is a *property* — serialise,
 * parse, serialise again, and the two strings must be equal — rather than a
 * comparison against an expected string, because what it is defending against
 * is precisely the case where our idea of the markup and the parser's differ.
 */
import { describe, expect, it } from "vitest";
import {
  addZoomHandles,
  figureFor,
  MIN_IMG_WIDTH,
  ZOOM_BTN_CLASS,
  ZOOM_WRAP_CLASS,
  zoomTargetOf,
} from "../src/web/zoomable.js";

/** The text a reader (and `Range.toString()`) sees, which must never move. */
function renderedText(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent ?? "";
}

function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** Every shape a block can be, and the tags that make a parser reconsider. */
const SHAPES: Record<string, string> = {
  "an image inside a paragraph": '<p id="spya-aaaaaa">before <img src="x.png" width="400"> after</p>',
  "an image alone in a paragraph": '<p id="spya-bbbbbb"><img src="x.png" width="400"></p>',
  "a table as the whole block":
    '<table id="spya-cccccc"><thead><tr><th>n</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
  "a code block": '<pre id="spya-dddddd"><code>let x = 1;\nlet y = 2;</code></pre>',
  "a figure with a caption":
    '<figure id="spya-eeeeee"><img src="x.png" width="400"><figcaption>What it shows</figcaption></figure>',
  "an inline svg": '<p id="spya-ffffff"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg></p>',
  "a responsive picture":
    '<p id="spya-jjjjjj"><picture><source srcset="wide.png" media="(min-width: 40em)"><img src="x.png" width="400"></picture></p>',
  "a linked picture":
    '<p id="spya-kkkkkk"><a href="https://x.test/full.png"><img src="x.png" width="400"></a></p>',
};

describe("addZoomHandles", () => {
  for (const [name, html] of Object.entries(SHAPES)) {
    describe(name, () => {
      it("puts exactly one button on it", () => {
        const out = parse(addZoomHandles(html));
        expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
        expect(out.querySelectorAll(`.${ZOOM_WRAP_CLASS}`)).toHaveLength(1);
      });

      /* **The property, not an expected string.** React writes this back with
         `innerHTML`, so the tree the browser builds has to be the tree we
         serialised. A `<div>` wrapper would pass every other test in this file
         and fail here: `<p>…<div>` makes the parser close the paragraph, and the
         block silently becomes two. */
      it("survives being parsed and re-serialised", () => {
        const once = addZoomHandles(html);
        const twice = parse(once).innerHTML;
        expect(twice).toBe(once);
      });

      /* Comment anchoring lives in the offset space of the rendered text
         (src/web/annotate.ts, src/web/selection.ts). One label, one space, one
         zero-width anything, and every comment in the block moves. */
      it("does not change the rendered text by one character", () => {
        expect(renderedText(addZoomHandles(html))).toBe(renderedText(html));
      });

      it("leaves the figure's own attributes alone", () => {
        const out = parse(addZoomHandles(html));
        expect(out.querySelector("[id^=spya-]")).not.toBeNull();
      });
    });
  }

  it("returns the very same string when there is no figure", () => {
    const html = "<p id=\"spya-gggggg\">Just words, and <a href=\"https://x.test\">a link</a>.</p>";
    expect(addZoomHandles(html)).toBe(html);
  });

  /* The outermost wins, so the caption is enlarged with the picture it captions
     rather than separately from it. */
  it("puts one button on a figure, not one on the figure and one on its image", () => {
    const out = parse(addZoomHandles(SHAPES["a figure with a caption"] as string));
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
    expect(out.querySelector(`.${ZOOM_WRAP_CLASS}`)?.firstElementChild?.tagName.toLowerCase()).toBe(
      "figure",
    );
  });

  /* A 1x1 GIF given a wrapper gets the light sheet with it (styles.css § the
     light sheet under them), which is a pale square in the middle of a
     sentence. The floor is on the declared width because this runs on a string
     with no layout. */
  it("skips an image too small to be a figure", () => {
    const tiny = `<p id="spya-hhhhhh">x<img src="p.gif" width="1" height="1"></p>`;
    expect(addZoomHandles(tiny)).toBe(tiny);
  });

  /* `getAttribute` returns null for a missing attribute and `Number(null)` is
     0, so the obvious `width > 0` guard reads "no width declared" and "declared
     as zero" as the same thing — and a zero-width tracker then gets a wrapper,
     a light sheet and a button. GPT Sol, 2026-08-28. */
  it("skips an image declared zero wide, which is a tracker by another name", () => {
    const zero = `<p id="spya-llllll">x<img src="p.gif" width="0" height="0"></p>`;
    expect(addZoomHandles(zero)).toBe(zero);
  });

  it("keeps an image whose width is not a number", () => {
    const out = parse(addZoomHandles('<p><img src="x.png" width="50%"></p>'));
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
  });

  /* **The `<img>` must stay a child of the `<picture>`**, or the `<source>`
     candidates stop applying and every reader silently gets the fallback file.
     Nothing errors and the page looks right; it is just the wrong image. */
  it("wraps a picture whole, leaving its source and image together", () => {
    const out = parse(addZoomHandles(SHAPES["a responsive picture"] as string));
    const picture = out.querySelector("picture") as Element;
    expect(picture.parentElement?.className).toBe(ZOOM_WRAP_CLASS);
    expect(picture.querySelector(":scope > source")).not.toBeNull();
    expect(picture.querySelector(":scope > img")).not.toBeNull();
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
  });

  /* A `<button>` inside an `<a>` is invalid content model. The wrapper goes
     round the link so the button is the link's sibling, not its child. */
  it("puts the wrapper outside a bare link, so the button is not inside it", () => {
    const out = parse(addZoomHandles(SHAPES["a linked picture"] as string));
    const button = out.querySelector(`.${ZOOM_BTN_CLASS}`) as Element;
    expect(button.closest("a")).toBeNull();
    expect(out.querySelector(`.${ZOOM_WRAP_CLASS}`)?.firstElementChild?.tagName.toLowerCase()).toBe(
      "a",
    );
  });

  /* ...but only when the link is *only* the picture. A sentence-length link
     that happens to contain a small image is a link with a picture in it. */
  it("leaves a link that has words of its own alone", () => {
    const out = parse(
      addZoomHandles('<p><a href="https://x.test">read <img src="x.png" width="400"> this</a></p>'),
    );
    expect(out.querySelector(`.${ZOOM_WRAP_CLASS}`)?.firstElementChild?.tagName.toLowerCase()).toBe(
      "img",
    );
    expect(out.querySelector(`.${ZOOM_BTN_CLASS}`)?.closest("a")).not.toBeNull();
  });

  it("wraps a link holding two pictures once, not twice", () => {
    const out = parse(
      addZoomHandles(
        '<p><a href="https://x.test"><img src="a.png" width="400"><img src="b.png" width="400"></a></p>',
      ),
    );
    expect(out.querySelectorAll(`.${ZOOM_WRAP_CLASS}`)).toHaveLength(1);
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
  });

  /* **A pull quote is a `<figure>` too**, and 11 of the 11 figures in the Noema
     article are exactly that. Found by the browser pass, 2026-08-28: 16 buttons
     against 11 figures, and every one of the figures was a blockquote. A ⤢ on a
     paragraph that already fits the column, which would enlarge to the same
     words, is a control that does nothing and claims otherwise. */
  it("gives a text-only figure no button", () => {
    const quote =
      '<figure id="spya-mmmmmm"><blockquote>It augments human cognition.</blockquote><figcaption>Greg</figcaption></figure>';
    expect(addZoomHandles(quote)).toBe(quote);
  });

  it("still gives a figure holding a table one", () => {
    const out = parse(
      addZoomHandles(
        '<figure id="spya-nnnnnn"><table><tr><td>1</td></tr></table><figcaption>Counts</figcaption></figure>',
      ),
    );
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
    expect(out.querySelector(`.${ZOOM_WRAP_CLASS}`)?.firstElementChild?.tagName.toLowerCase()).toBe(
      "figure",
    );
  });

  it("keeps an image that declares no width at all", () => {
    const out = parse(addZoomHandles('<p id="spya-iiiiii"><img src="x.png"></p>'));
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
  });

  /* The floor has to sit well below the narrowest real figure in the corpus —
     Wolfram's 232px inline equation, which is the case the feature exists for. */
  it("keeps an image exactly on the floor and drops the one below it", () => {
    const at = `<p><img src="x.png" width="${MIN_IMG_WIDTH}"></p>`;
    const below = `<p><img src="x.png" width="${MIN_IMG_WIDTH - 1}"></p>`;
    expect(addZoomHandles(at)).not.toBe(at);
    expect(addZoomHandles(below)).toBe(below);
  });
});

describe("zoomTargetOf", () => {
  it("finds the figure a press belongs to", () => {
    const out = parse(addZoomHandles(SHAPES["a table as the whole block"] as string));
    const button = out.querySelector(`.${ZOOM_BTN_CLASS}`);
    expect(button).not.toBeNull();
    expect(zoomTargetOf(button as Element)?.tagName.toLowerCase()).toBe("table");
  });
});

describe("figureFor", () => {
  /* A block whose root element IS the table carries the block's own id. Two
     copies in one document give `getElementById` two answers, and the spine,
     `?at=`, every internal link and every jump resolve through exactly that. */
  it("strips every id, so the copy cannot shadow the original", () => {
    const out = parse(addZoomHandles(SHAPES["a table as the whole block"] as string));
    const table = out.querySelector("table") as Element;
    expect(table.id).toBe("spya-cccccc"); // the original still has it
    const copy = parse(figureFor(table).html);
    expect(copy.querySelectorAll("[id]")).toHaveLength(0);
  });

  it("strips the enlarge buttons, so the copy does not offer to enlarge itself", () => {
    const out = parse(addZoomHandles(SHAPES["a figure with a caption"] as string));
    const figure = out.querySelector("figure") as Element;
    const copy = parse(figureFor(figure).html);
    expect(copy.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(0);
    expect(copy.querySelector("figcaption")?.textContent).toBe("What it shows");
  });

  it("reports the kind, which is what the panel sizes itself by", () => {
    const out = parse(addZoomHandles(SHAPES["an image alone in a paragraph"] as string));
    expect(figureFor(out.querySelector("img") as Element).kind).toBe("img");
  });

  it("does not touch the element it copies", () => {
    const out = parse(addZoomHandles(SHAPES["a code block"] as string));
    const pre = out.querySelector("pre") as Element;
    figureFor(pre);
    expect(pre.id).toBe("spya-dddddd");
    expect(pre.textContent).toBe("let x = 1;\nlet y = 2;");
  });
});
