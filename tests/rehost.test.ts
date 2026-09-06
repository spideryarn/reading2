// @vitest-environment jsdom
/**
 * **Putting a PDF's figures into the prose** — `rehostImages` and the two
 * things that read the same markers beside it.
 *
 * jsdom rather than the default node environment (vitest.config.ts), for the
 * reason `zoomable.test.ts` gives: the module under test is a DOM pass over an
 * html string, and reimplementing one here would be testing the
 * reimplementation.
 *
 * Three of the things checked here fail **silently** if they break:
 *
 *  - an inserted `<img>` that contributed a character of rendered text would
 *    shift every comment and highlight anchored in that block, because
 *    anchoring counts characters of rendered text (src/web/annotate.ts,
 *    src/web/selection.ts). Nothing throws; the marks land a few characters to
 *    the left. It is the same property `zoomable.test.ts` pins for the ⤢, and
 *    it is pinned here the same way;
 *  - a figure whose ref is not in the manifest getting a picture anyway would
 *    be a picture under the wrong caption — *"a fabricated claim about the
 *    paper, rendered at the verbatim level with the app's authority behind
 *    it"* (Fable, 2026-09-06), and the reader has no way to detect it;
 *  - a marker with **no** entry being drawn as *we couldn't recover this* would
 *    be a claim about a picture nobody has looked for.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Assets, PdfFigureEntry } from "../src/assets.js";
import type { Article, Block, BlockId } from "../src/types.js";

/* `apiFetch` is the owner's transport and is the only thing in this module that
   touches the network. Mocked at the module boundary rather than by patching
   `globalThis.fetch`, so the test says which seam it is standing on. */
const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const { rehostImages, rehostBlockHtml } = await import("../src/web/rehost.js");
const { pdfFigureNotesIn, hasOriginalPdf, FIGURE_NOT_RECOVERED } = await import(
  "../src/web/PdfFigureNote.js"
);

const REF_ONE = "pf1-0123456789abcdef0123456789abcdef.3.1";
const REF_TWO = "pf1-fedcba9876543210fedcba9876543210.7.1";

function figureBlock(id: string, ref: string, caption: string): Block {
  return {
    id: id as BlockId,
    tag: "figure",
    kind: "text",
    text: caption,
    html: `<figure data-spya-pdf-figure="${ref}"><figcaption>${caption}</figcaption></figure>`,
  } as Block;
}

function paragraph(id: string): Block {
  return {
    id: id as BlockId,
    tag: "p",
    kind: "text",
    text: "Just prose.",
    html: "<p>Just prose.</p>",
  } as Block;
}

function stored(ref: string, sha256: string): PdfFigureEntry {
  return {
    ref,
    page: 3,
    status: "stored",
    sha256,
    ext: "png",
    contentType: "image/png",
    bytes: 1234,
    width: 800,
    height: 600,
  };
}

function failed(ref: string): PdfFigureEntry {
  return { ref, page: 7, status: "failed", reason: "no-raster", at: "2026-09-06T00:00:00.000Z" };
}

function articleWith(blocks: Block[], pdfFigures?: PdfFigureEntry[], source?: "pdf"): Article {
  const assets: Assets | undefined = pdfFigures && {
    version: "assets/2",
    sourceHash: "x",
    fetchedAt: "2026-09-06T00:00:00.000Z",
    entries: [],
    pdfFigures,
  };
  return {
    meta: { slug: "a-piece", title: "A piece", ...(source ? { source } : {}) },
    blocks,
    tree: { version: "hierarchy/4", nodes: [], roots: [] },
    assets,
  } as unknown as Article;
}

/** The rendered text of a block, exactly as `annotate.ts` computes an offset space. */
function renderedText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("rehostBlockHtml", () => {
  const src = { src: "blob:abc", width: 800, height: 600 };

  it("puts an image in the figure the marker is on", () => {
    const html = figureBlock("spya-aaaaaa", REF_ONE, "Figure 1. A graph.").html;
    const out = rehostBlockHtml(html, (ref) => (ref === REF_ONE ? src : null));
    const div = document.createElement("div");
    div.innerHTML = out;
    const img = div.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("blob:abc");
    /* Sol I-4, all five of them. `alt=""` because the visible `<figcaption>`
       carries the caption and alt text would be the same sentence announced
       twice; the dimensions so the row does not jump. */
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("width")).toBe("800");
    expect(img?.getAttribute("height")).toBe("600");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    /* Before the caption, which is what a `<figure>` means and what the
       lightbox copies wholesale. */
    expect(div.querySelector("figure")?.firstElementChild?.tagName.toLowerCase()).toBe("img");
  });

  /**
   * **The property everything else in the reading view depends on.**
   *
   * If this ever stops being true, nothing throws: every comment and highlight
   * in a figure block simply lands a few characters to the left.
   * `zoomable.test.ts` pins the same fact for the enlarge button.
   */
  it("does not change the rendered text by one character", () => {
    const html = figureBlock("spya-aaaaaa", REF_ONE, "Figure 1. A graph.").html;
    const out = rehostBlockHtml(html, () => src);
    expect(renderedText(out)).toBe(renderedText(html));
    expect(renderedText(out)).toBe("Figure 1. A graph.");
  });

  it("returns the very same string when there is nothing to do", () => {
    const html = "<p>Just prose.</p>";
    expect(rehostBlockHtml(html, () => src)).toBe(html);
    const figure = figureBlock("spya-aaaaaa", REF_ONE, "Figure 1.").html;
    expect(rehostBlockHtml(figure, () => null)).toBe(figure);
  });

  /**
   * A figure that already holds a picture is left alone. Nothing produces one
   * today — stage 2 writes a caption and nothing else — but this runs on stored
   * html of unknown age, and stapling a second image under one caption is the
   * failure Fable called worse than no figure at all.
   */
  it("does not add a second image to a figure that has one", () => {
    const html = `<figure data-spya-pdf-figure="${REF_ONE}"><img src="https://elsewhere/x.png"><figcaption>Figure 1.</figcaption></figure>`;
    expect(rehostBlockHtml(html, () => src)).toBe(html);
  });
});

describe("rehostImages", () => {
  it("leaves an article with no figures exactly as it was", async () => {
    const article = articleWith([paragraph("spya-bbbbbb")]);
    expect(await rehostImages(article, "a-piece", "owned")).toBe(article);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  /**
   * **A visitor's picture is a plain URL** — they have no token to attach and
   * could not use the authenticated route at all, so nothing is fetched here
   * and the browser fetches the `src` whenever it likes.
   */
  it("points a visitor at the public route, and fetches nothing itself", async () => {
    const article = articleWith(
      [figureBlock("spya-cccccc", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, "a".repeat(64))],
    );
    const out = await rehostImages(article, "a-piece", "public");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(out.blocks[0]?.html).toContain(
      `src="/api/public/asset/a-piece/${"a".repeat(64)}.png"`,
    );
  });

  /**
   * **And an owner's arrives as a `blob:`.** A plain `<img src="/api/asset/…">`
   * would 401 — an `<img>` sends no headers — and the reader would see a broken
   * image with nothing in the console. rehost.ts § Why an owner's picture
   * arrives as a `blob:`.
   */
  it("fetches an owner's picture with the token and hands the img a blob URL", async () => {
    const sha = "b".repeat(64);
    apiFetch.mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2])]) });
    const article = articleWith(
      [figureBlock("spya-dddddd", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, sha)],
    );
    const out = await rehostImages(article, "a-piece", "owned");
    expect(apiFetch).toHaveBeenCalledWith(`/api/asset/a-piece/${sha}.png`);
    expect(out.blocks[0]?.html).toMatch(/src="blob:/);
  });

  /**
   * **A figure whose ref is not in the manifest gets nothing.** The ref folds in
   * the raw PDF's sha256, so a manifest carried into a revision whose PDF has
   * changed matches nothing — and the whole point of that design is that the
   * lookup fails *closed*, leaving the caption alone rather than putting last
   * week's picture under it.
   */
  it("draws nothing for a marker the manifest does not name", async () => {
    const article = articleWith(
      [figureBlock("spya-eeeeee", REF_TWO, "Figure 2.")],
      [stored(REF_ONE, "c".repeat(64))],
    );
    const out = await rehostImages(article, "a-piece", "public");
    expect(out.blocks[0]?.html).not.toContain("<img");
    expect(out.blocks[0]?.html).toBe(article.blocks[0]?.html);
  });

  it("draws nothing for a figure the manifest records as failed", async () => {
    const article = articleWith([figureBlock("spya-ffffff", REF_TWO, "Figure 2.")], [failed(REF_TWO)]);
    const out = await rehostImages(article, "a-piece", "public");
    expect(out.blocks[0]?.html).not.toContain("<img");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  /**
   * **One figure that will not load must not take the others off the page.**
   * `Promise.allSettled`, not `all`.
   */
  it("keeps the figures that loaded when one of them fails", async () => {
    const one = "d".repeat(64);
    const two = "e".repeat(64);
    apiFetch.mockImplementation(async (path: string) =>
      path.includes(one)
        ? { ok: false, status: 500 }
        : { ok: true, blob: async () => new Blob([new Uint8Array([3])]) },
    );
    const article = articleWith(
      [
        figureBlock("spya-gggggg", REF_ONE, "Figure 1."),
        figureBlock("spya-hhhhhh", REF_TWO, "Figure 2."),
      ],
      [stored(REF_ONE, one), stored(REF_TWO, two)],
    );
    const out = await rehostImages(article, "a-piece", "owned");
    expect(out.blocks[0]?.html).not.toContain("<img");
    expect(out.blocks[1]?.html).toMatch(/src="blob:/);
  });

  /** Blocks whose html did not change come back as the very same object. */
  it("hands React back the same block object for an untouched block", async () => {
    const article = articleWith(
      [paragraph("spya-iiiiii"), figureBlock("spya-jjjjjj", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, "f".repeat(64))],
    );
    const out = await rehostImages(article, "a-piece", "public");
    expect(out.blocks[0]).toBe(article.blocks[0]);
    expect(out.blocks[1]).not.toBe(article.blocks[1]);
  });
});

/**
 * **The ⤢ has to arrive on its own**, and it is not obvious that it does.
 *
 * `addZoomHandles` runs at render, after this pass, and it gives a `<figure>` a
 * button only when the figure holds something on `FIGURE_CONTENT` — because a
 * pull quote is a `<figure>` too and a control that enlarges a paragraph to the
 * same paragraph is a control that does nothing (zoomable.ts § `FIGURE_CONTENT`).
 * A caption-only PDF figure is on the wrong side of that test today and lands on
 * the right side the moment a picture goes in, which is the behaviour worth
 * pinning rather than assuming.
 *
 * The wrapper is also what carries `--figure-sheet` — the light mat under every
 * figure, added after transparent PNGs rendered dark-on-dark (styles.css § the
 * figure sheet). These figures carry real alpha, so no wrapper would mean the
 * same failure again, and the wrapper is a fact this test can check even though
 * the paint is not.
 */
describe("a rehosted figure and the enlarge button", () => {
  it("earns its ⤢ once there is a picture in it, and not before", async () => {
    const { addZoomHandles, ZOOM_WRAP_CLASS, ZOOM_BTN_CLASS } = await import(
      "../src/web/zoomable.js"
    );
    const bare = figureBlock("spya-qqqqqq", REF_ONE, "Figure 1. A graph.").html;
    /* Today's article: a caption and nothing else. No button, deliberately. */
    const before = document.createElement("div");
    before.innerHTML = addZoomHandles(bare);
    expect(before.querySelector(`.${ZOOM_BTN_CLASS}`)).toBeNull();

    const withImage = rehostBlockHtml(bare, () => ({ src: "blob:x", width: 800, height: 600 }));
    const after = document.createElement("div");
    after.innerHTML = addZoomHandles(withImage);
    expect(after.querySelector(`.${ZOOM_BTN_CLASS}`)).not.toBeNull();
    /* And the image is *inside* the wrapper, which is what puts the light sheet
       under it — the rule is a descendant selector, so a grandchild counts. */
    const wrap = after.querySelector(`.${ZOOM_WRAP_CLASS}`);
    expect(wrap?.querySelector("img")).not.toBeNull();
    expect(wrap?.getAttribute("data-zoom-kind")).toBe("figure");
  });
});

/**
 * **The public path is spelled twice, so the two spellings are checked against
 * each other.**
 *
 * `publicAssetPath` builds it and `PUBLIC_ROUTE_NAMES` matches it, and they are
 * in different files because `src/asset-delivery.ts` has to stay a leaf —
 * `tests/client-imports.test.ts` refuses a shared browser module importing
 * `src/public/route-names.ts`. That leaves exactly the failure
 * route-names.ts's own header warns about: a route the dispatcher serves and
 * nothing asks for, or a `src` nothing answers. Neither would throw; the reader
 * would simply see no picture.
 *
 * So the builder's output is run through the dispatcher's own pattern. This is
 * the assertion delegation would *not* have bought, because a `path()` and a
 * `pattern` can disagree while sitting in one file.
 */
describe("the public path", () => {
  it("is matched by the pattern the public dispatcher actually uses", async () => {
    const { publicAssetPath } = await import("../src/asset-delivery.js");
    const { PUBLIC_ROUTE_NAMES } = await import("../src/public/route-names.js");
    const route = PUBLIC_ROUTE_NAMES.find((r) => r.kind === "asset");
    expect(route, "the public asset route has left the inventory").toBeDefined();

    const sha = "a".repeat(64);
    const built = publicAssetPath("a-piece", sha, "png");
    const matched = route?.pattern.exec(built);
    expect(matched, built).not.toBeNull();
    expect([matched?.[1], matched?.[2], matched?.[3]]).toEqual(["a-piece", sha, "png"]);
  });

  /** And the owner's, against the route table in src/routes.ts. */
  it("has an owned twin the authenticated table matches", async () => {
    const { assetPath } = await import("../src/asset-delivery.js");
    const sha = "b".repeat(64);
    const pattern = /^\/api\/asset\/([\w.%-]+)\/([0-9a-f]{64})\.(png|jpeg|gif)$/;
    const matched = pattern.exec(assetPath("a-piece", sha, "png"));
    expect(matched).not.toBeNull();
    expect([matched?.[1], matched?.[2], matched?.[3]]).toEqual(["a-piece", sha, "png"]);
  });
});

describe("what the reader is told about a figure", () => {
  it("finds every marker, with the page off the marker itself", () => {
    const article = articleWith(
      [figureBlock("spya-kkkkkk", REF_ONE, "Figure 1."), paragraph("spya-llllll")],
      [stored(REF_ONE, "a".repeat(64))],
    );
    const notes = pdfFigureNotesIn(article);
    expect([...notes.keys()]).toEqual(["spya-kkkkkk"]);
    expect(notes.get("spya-kkkkkk" as BlockId)).toEqual([
      { ref: REF_ONE, page: 3, outcome: "stored" },
    ]);
  });

  it("calls a marker the manifest recorded as failed a failure", () => {
    const article = articleWith([figureBlock("spya-mmmmmm", REF_TWO, "Figure 2.")], [failed(REF_TWO)]);
    expect(pdfFigureNotesIn(article).get("spya-mmmmmm" as BlockId)?.[0]?.outcome).toBe("failed");
  });

  /**
   * **The third state, and the one worth naming.** A marker with no entry at
   * all means the assets step has never run on this article — every PDF
   * ingested before it existed — and that reader must see exactly what they see
   * today. Saying *we couldn't recover this* about a picture nobody has looked
   * for is a claim we have not earned.
   */
  it("calls a marker with no entry unknown, not failed", () => {
    const withoutManifest = articleWith([figureBlock("spya-nnnnnn", REF_ONE, "Figure 1.")]);
    expect(pdfFigureNotesIn(withoutManifest).get("spya-nnnnnn" as BlockId)?.[0]?.outcome).toBe(
      "unknown",
    );
    const otherRef = articleWith(
      [figureBlock("spya-oooooo", REF_TWO, "Figure 2.")],
      [stored(REF_ONE, "a".repeat(64))],
    );
    expect(pdfFigureNotesIn(otherRef).get("spya-oooooo" as BlockId)?.[0]?.outcome).toBe("unknown");
  });

  /** A value the one parser cannot explain is a value nothing carries. */
  it("ignores a marker that is not one", () => {
    const article = articleWith(
      [
        {
          id: "spya-pppppp" as BlockId,
          tag: "figure",
          kind: "text",
          text: "Figure 1.",
          html: '<figure data-spya-pdf-figure="not-a-ref"><figcaption>Figure 1.</figcaption></figure>',
        } as Block,
      ],
      [stored(REF_ONE, "a".repeat(64))],
    );
    expect(pdfFigureNotesIn(article).size).toBe(0);
  });

  /**
   * **"If available" is one field**, and it is the ownership gate as well as
   * the is-it-a-PDF gate: the public payload withholds the whole PDF provenance
   * block, so `meta.source` is `undefined` for a visitor — which is right,
   * because `/api/source/:slug` is owner-only.
   */
  it("offers the original only for an article that came from a PDF", () => {
    expect(hasOriginalPdf(articleWith([], [], "pdf"))).toBe(true);
    expect(hasOriginalPdf(articleWith([], []))).toBe(false);
  });

  /**
   * The sentence carries **no bracketed code** and names **no cause**. Matched
   * on the exported constant rather than retyped, so rewriting the copy is not
   * a red test — docs/project/copy.md § Tests match on the code, not the prose,
   * applied to a family that deliberately has no code.
   */
  it("says what happened without a code and without guessing why", () => {
    expect(FIGURE_NOT_RECOVERED).not.toMatch(/\[/);
    expect(FIGURE_NOT_RECOVERED).not.toMatch(/vector|bitmap|decode|megapixel/i);
    expect(FIGURE_NOT_RECOVERED.length).toBeLessThan(90);
  });
});
