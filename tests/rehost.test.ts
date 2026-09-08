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

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetEntry, Assets, PdfFigureEntry } from "../src/assets.js";
import type { Article, Block, BlockId } from "../src/types.js";

/* The two transports, and they are the only things in this module that touch
   the network: `apiFetch` for an owner, `publicFetch` for a visitor. Mocked at
   the module boundary rather than by patching `globalThis.fetch`, so the test
   says which seam it is standing on — and so that *which* of the two was used
   is itself an assertion, which is the whole of the footing argument. */
const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const publicFetch = vi.fn();
vi.mock("../src/web/public-api.js", () => ({
  publicFetch: (...args: unknown[]) => publicFetch(...args),
}));

const { rehostImages, rehostBlockHtml, beginArticleLoad, IMAGE_WAIT_MS, FIGURE_WAIT_MS } =
  await import("../src/web/rehost.js");
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

/** A response with real bytes behind it, which is what `blob()` needs. */
function okPng(): { ok: true; status: 200; blob: () => Promise<Blob> } {
  return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) };
}

/**
 * **The article the reader is shown immediately** — the PDF figures in it, every
 * image we hold a copy of blanked, and nothing waited on beyond the figures.
 *
 * The two helpers are named after the two draws rather than being one with a
 * flag, because *which draw a fact is true on* is the whole of stage E's design
 * and a boolean argument would let a test assert it on the wrong one without
 * saying so.
 */
async function firstDraw(article: Article, slug: string, footing: "owned" | "public") {
  return (await rehostImages(article, slug, footing, beginArticleLoad())).article;
}

/** **What the reader ends up looking at**, once the images have arrived or not. */
async function finalDraw(article: Article, slug: string, footing: "owned" | "public") {
  const rehosted = await rehostImages(article, slug, footing, beginArticleLoad());
  return (await rehosted.images) ?? rehosted.article;
}

/**
 * **The object-URL ledger, watched rather than inferred.**
 *
 * Both halves of GPT Sol's D-2 are invisible to an assertion about html: a blob
 * that is never revoked and a blob minted for an article nobody is looking at
 * both leave the *current* page perfectly correct. So these two are spied on for
 * every test in the file, and the leak tests read them directly.
 *
 * `spyOn` keeps jsdom's own implementation underneath, so `blob:` URLs are still
 * real and the `src="blob:…"` assertions elsewhere go on meaning something.
 */
let created: ReturnType<typeof vi.spyOn>;
let revoked: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  apiFetch.mockReset();
  publicFetch.mockReset();
  created = vi.spyOn(URL, "createObjectURL");
  revoked = vi.spyOn(URL, "revokeObjectURL");
});

afterEach(() => {
  created.mockRestore();
  revoked.mockRestore();
});

describe("rehostBlockHtml", () => {
  const src = { src: "blob:abc", width: 800, height: 600 };

  it("puts an image in the figure the marker is on", () => {
    const html = figureBlock("spya-aaaaaa", REF_ONE, "Figure 1. A graph.").html;
    const out = rehostBlockHtml(html, { figure: (ref) => (ref === REF_ONE ? src : null), image: () => null });
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
    const out = rehostBlockHtml(html, { figure: () => src, image: () => null });
    expect(renderedText(out)).toBe(renderedText(html));
    expect(renderedText(out)).toBe("Figure 1. A graph.");
  });

  it("returns the very same string when there is nothing to do", () => {
    const html = "<p>Just prose.</p>";
    expect(rehostBlockHtml(html, { figure: () => src, image: () => null })).toBe(html);
    const figure = figureBlock("spya-aaaaaa", REF_ONE, "Figure 1.").html;
    expect(rehostBlockHtml(figure, { figure: () => null, image: () => null })).toBe(figure);
  });

  /**
   * A figure that already holds a picture is left alone. Nothing produces one
   * today — stage 2 writes a caption and nothing else — but this runs on stored
   * html of unknown age, and stapling a second image under one caption is the
   * failure Fable called worse than no figure at all.
   */
  it("does not add a second image to a figure that has one", () => {
    const html = `<figure data-spya-pdf-figure="${REF_ONE}"><img src="https://elsewhere/x.png"><figcaption>Figure 1.</figcaption></figure>`;
    expect(rehostBlockHtml(html, { figure: () => src, image: () => null })).toBe(html);
  });
});

describe("rehostImages", () => {
  it("leaves an article with no figures exactly as it was", async () => {
    const article = articleWith([paragraph("spya-bbbbbb")]);
    expect(await firstDraw(article, "a-piece", "owned")).toBe(article);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  /**
   * **A visitor's picture comes off the public route, without a token.**
   *
   * The assertion that matters is *which fetcher* — `publicFetch` is a bare
   * `fetch` with `credentials: "omit"` and no `Authorization` (public-api.ts),
   * and swapping it for `apiFetch` would work perfectly for everybody who
   * happens to be signed in and fail for the strangers the feature is for.
   */
  it("fetches a visitor's picture off the public route, with no token", async () => {
    const sha = "a".repeat(64);
    publicFetch.mockResolvedValue(okPng());
    const article = articleWith(
      [figureBlock("spya-cccccc", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, sha)],
    );
    const out = await firstDraw(article, "a-piece", "public");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledWith(
      `/api/public/asset/a-piece/${sha}.png`,
      expect.any(AbortSignal),
    );
    expect(out.blocks[0]?.html).toMatch(/src="blob:/);
  });

  /**
   * **And an owner's arrives the same way.** A plain `<img src="/api/asset/…">`
   * would 401 — an `<img>` sends no headers — and the reader would see a broken
   * image with nothing in the console. rehost.ts § Why every picture arrives as
   * a `blob:`.
   */
  it("fetches an owner's picture with the token and hands the img a blob URL", async () => {
    const sha = "b".repeat(64);
    apiFetch.mockResolvedValue(okPng());
    const article = articleWith(
      [figureBlock("spya-dddddd", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, sha)],
    );
    const out = await firstDraw(article, "a-piece", "owned");
    expect(apiFetch).toHaveBeenCalledWith(`/api/asset/a-piece/${sha}.png`, {
      signal: expect.any(AbortSignal),
    });
    expect(out.blocks[0]?.html).toMatch(/src="blob:/);
  });

  /**
   * **The bug this pair of tests was written for.** GPT Sol, D-1, 2026-09-06.
   *
   * The visitor's branch used to write `/api/public/asset/…` straight into the
   * `src` without ever looking at a response, so a 404 — the owner un-shared the
   * piece a moment ago — left an `<img>` with a manifest's `width` and `height`
   * over a request that failed. A large blank rectangle, which is precisely what
   * rehost.ts's header promises does *not* happen. The owner's branch was fine,
   * and that asymmetry is why nobody saw it: an owner cannot reproduce it.
   *
   * The old public test could not have caught this, because it asserted only
   * that a URL had been inserted — which is exactly what the broken behaviour
   * does.
   */
  it("leaves a visitor's figure caption-only when the public route refuses it", async () => {
    publicFetch.mockResolvedValue({ ok: false, status: 404 });
    const article = articleWith(
      [figureBlock("spya-rrrrrr", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, "9".repeat(64))],
    );
    const out = await firstDraw(article, "a-piece", "public");
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(out.blocks[0]?.html).not.toContain("<img");
    /* The very same block object, which is the strongest form of "left exactly
       as it was" this module can be held to. */
    expect(out.blocks[0]).toBe(article.blocks[0]);
  });

  /** The other way it fails: the request never gets an answer at all. */
  it("leaves a visitor's figure caption-only when the request itself fails", async () => {
    publicFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const article = articleWith(
      [figureBlock("spya-ssssss", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, "8".repeat(64))],
    );
    const out = await firstDraw(article, "a-piece", "public");
    expect(out.blocks[0]?.html).not.toContain("<img");
    expect(created).not.toHaveBeenCalled();
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
    const out = await firstDraw(article, "a-piece", "public");
    expect(out.blocks[0]?.html).not.toContain("<img");
    expect(out.blocks[0]?.html).toBe(article.blocks[0]?.html);
  });

  it("draws nothing for a figure the manifest records as failed", async () => {
    const article = articleWith([figureBlock("spya-ffffff", REF_TWO, "Figure 2.")], [failed(REF_TWO)]);
    const out = await firstDraw(article, "a-piece", "public");
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
    const out = await firstDraw(article, "a-piece", "owned");
    expect(out.blocks[0]?.html).not.toContain("<img");
    expect(out.blocks[1]?.html).toMatch(/src="blob:/);
  });

  /**
   * **A figure that never answers must not cost the reader the article.**
   *
   * The figures are awaited before the first draw, deliberately — there is
   * nothing to put in their place, so drawing sooner buys the reader nothing.
   * The price of that decision is that `rehostImages` is on the critical path of
   * *the prose appearing at all*, and until 2026-09-07 the await was unbounded:
   * one `/api/asset/…` that never resolved — a stalled connection, a response
   * whose `blob()` never completes — meant `resolveAccess` never returned and
   * the reader sat on the loading state for the rest of the session. Not a
   * blank picture: a blank page. GPT Sol found it reviewing the built code.
   *
   * `FIGURE_WAIT_MS` is the bound. Past it the figure is caption-only, which is
   * a state this module already has and already documents — *the manifest says
   * the picture is there and this is a transport failure the reader can do
   * nothing about*. So the fix adds a ceiling and no new reader-facing state.
   *
   * **Fake timers, and the assertion is on both sides of the clock**: before it
   * fires there is no article, after it there is. Written red first — without
   * the bound the `await` below never settles and the test times out rather than
   * failing on an assertion, which is the honest shape of the bug.
   */
  it("gives up on a figure that never answers, and still draws the prose", async () => {
    vi.useFakeTimers();
    try {
      const hung = "a1".repeat(32);
      const quick = "b2".repeat(32);
      const signals: (AbortSignal | undefined)[] = [];
      apiFetch.mockImplementation(async (path: string, init?: { signal?: AbortSignal }) => {
        signals.push(init?.signal);
        if (path.includes(quick)) return okPng();
        return new Promise(() => {});
      });

      const article = articleWith(
        [
          figureBlock("spya-hung01", REF_ONE, "Figure 1."),
          figureBlock("spya-hung02", REF_TWO, "Figure 2."),
        ],
        [stored(REF_ONE, hung), stored(REF_TWO, quick)],
      );

      let drawn: Article | undefined;
      const running = rehostImages(article, "a-piece", "owned", beginArticleLoad()).then((r) => {
        drawn = r.article;
      });

      /* **Nothing yet**, with the clock frozen — the figures really are awaited,
         which is the decision this bound exists to make survivable rather than
         to reverse. */
      await Promise.resolve();
      expect(drawn, "the prose must not be drawn before the figures are settled").toBeUndefined();

      await vi.advanceTimersByTimeAsync(FIGURE_WAIT_MS);
      await running;

      /* The one that answered is ours; the one that hung is caption-only. */
      expect(drawn?.blocks[1]?.html).toMatch(/src="blob:/);
      expect(drawn?.blocks[0]?.html).not.toContain("<img");

      /* **The abort itself**, so the dead request is not left downloading a
         picture nothing will ever look at — `imageSources` is held to the same
         thing, and for the same reason. */
      expect(signals.some((s) => s?.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Blocks whose html did not change come back as the very same object. */
  it("hands React back the same block object for an untouched block", async () => {
    publicFetch.mockResolvedValue(okPng());
    const article = articleWith(
      [paragraph("spya-iiiiii"), figureBlock("spya-jjjjjj", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, "f".repeat(64))],
    );
    const out = await firstDraw(article, "a-piece", "public");
    expect(out.blocks[0]).toBe(article.blocks[0]);
    expect(out.blocks[1]).not.toBe(article.blocks[1]);
  });
});

/* ------------------------------------------------------------------ *
 * The article's own images — stage E
 * ------------------------------------------------------------------ */

/**
 * **A real corpus URL, with the query string that makes the encoding trap
 * live.** Five of the corpus's thirteen images carry an imgix signature like
 * this one, and it is the `&` between the two parameters that the stored html
 * spells `&amp;` and the DOM hands back bare.
 */
const IMG_URL = "https://noemamag.imgix.net/fig.png?w=1200&s=3a2bee";

/** The same URL as it actually sits in `blocks.json`. */
const IMG_URL_STORED = "https://noemamag.imgix.net/fig.png?w=1200&amp;s=3a2bee";

/** A URL nothing in these manifests names. */
const OTHER_URL = "https://content.wolfram.com/uploads/plot.png";

/**
 * **The corpus's first real `<picture>`**, and the one the reader complained
 * about — block `spya-zvpebu` of `after-work-we-ll-have-each-other`, verbatim
 * from `revision_blocks.html` bar the srcset candidates trimmed to two apiece.
 *
 * Kept whole, `<figure>` and `<figcaption>` and all, because the shape is the
 * point: the AVIF `<source>` comes first and therefore wins, and the working
 * PNG sits underneath it where nothing will ever reach it.
 */
const ASTERISK = "https://asteriskmag.com/media/pages/issues/15/after-work-we-ll-have-each-other";
const MONKEYS_STEM = `${ASTERISK}/8b873bdfd6-1784554053/collier02_david_teniers`;
const MONKEYS_SRC = `${MONKEYS_STEM}-300x.png`;
const MONKEYS_FIGURE =
  `<figure id="spya-zvpebu">\n  <picture>\n` +
  `        <source srcset="${MONKEYS_STEM}-600x-q64-sharpen50.avif 600w, ${MONKEYS_STEM}-1920x-q64-sharpen50.avif 1920w"` +
  ` sizes="(min-width: 768px) 750px, 100vw" type="image/avif">\n` +
  `    <img src="${MONKEYS_SRC}" alt="illustration"` +
  ` srcset="${MONKEYS_STEM}-600x-sharpen50.png 600w, ${MONKEYS_STEM}-1920x-sharpen50.png 1920w"` +
  ` sizes="(min-width: 768px) 750px, 100vw">\n      </picture>\n\n` +
  `    <figcaption>\n    David Teniers the Younger (–1690), S<em>moking and drinking monkeys, </em>c. 1660, oil on panel.      </figcaption>\n  </figure>`;

function imageBlock(id: string, html: string, text = "Some prose."): Block {
  return { id: id as BlockId, tag: "p", kind: "text", text, html } as Block;
}

function storedImage(url: string, sha256: string): AssetEntry {
  return { url, status: "stored", sha256, ext: "png", contentType: "image/png", bytes: 4242 };
}

function failedImage(url: string): AssetEntry {
  return {
    url,
    status: "failed",
    reason: "unsupported-format",
    at: "2026-09-06T00:00:00.000Z",
  };
}

/** The twin of `articleWith` for the other half of the manifest. */
function articleWithImages(blocks: Block[], entries: AssetEntry[]): Article {
  return {
    meta: { slug: "a-piece", title: "A piece" },
    blocks,
    tree: { version: "hierarchy/4", nodes: [], roots: [] },
    assets: {
      version: "assets/2",
      sourceHash: "x",
      fetchedAt: "2026-09-06T00:00:00.000Z",
      entries,
    } satisfies Assets,
  } as unknown as Article;
}

describe("the article's own images", () => {
  const SHA = "7".repeat(64);

  /**
   * **The failure that looks exactly like success.** A browser handed a
   * rewritten `src` and an untouched `srcset` prefers the `srcset` — so the
   * page hot-links the publisher on every read while looking completely fixed,
   * and nothing anywhere throws. 260829b § trap 1, and src/assets.ts § 2.
   *
   * Asserted as the **absence of the publisher**, on that trap's own
   * instruction, rather than the presence of ours: a `src` we rewrote proves
   * nothing about the four other places a URL can hide.
   */
  it("drops the srcset and the sizes with the src it replaces", async () => {
    apiFetch.mockResolvedValue(okPng());
    const article = articleWithImages(
      [
        imageBlock(
          "spya-img001",
          `<p><img src="${IMG_URL_STORED}" srcset="${IMG_URL_STORED} 1200w, https://noemamag.imgix.net/fig-600.png 600w" sizes="(max-width: 600px) 100vw, 600px" alt="A graph">Some prose.</p>`,
        ),
      ],
      [storedImage(IMG_URL, SHA)],
    );
    const html = (await finalDraw(article, "a-piece", "owned")).blocks[0]?.html ?? "";
    expect(html).toMatch(/src="blob:/);
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("sizes");
    expect(html, "the publisher must not survive anywhere in this block").not.toMatch(
      /\bnoemamag\b/,
    );
  });

  /**
   * **And it is gone on the *first* draw too**, which is the half that has to be
   * true for the feature to mean anything: the reader sees the prose before the
   * pictures arrive, so a publisher URL left in the markup for that first draw
   * is a request the browser has already made. 260829b § Two readers, two paths:
   * *"Do not render the publisher URL while a stored asset is resolving."*
   */
  it("takes the publisher's URL away before the prose is drawn", async () => {
    /* A fetch that never answers — the whole point is that the first draw does
       not wait for it. */
    apiFetch.mockImplementation(() => new Promise(() => {}));
    const article = articleWithImages(
      [
        imageBlock(
          "spya-img011",
          `<p><img src="${IMG_URL_STORED}" srcset="${IMG_URL_STORED} 1200w" width="1200" height="800" alt="A graph">Some prose.</p>`,
        ),
      ],
      [storedImage(IMG_URL, SHA)],
    );
    const html = (await firstDraw(article, "a-piece", "owned")).blocks[0]?.html ?? "";
    expect(html, "the prose must not wait for a picture that never comes").toContain("Some prose.");
    expect(html).not.toMatch(/\bnoemamag\b/);
    expect(html).not.toContain("srcset");
    /* No `src` at all rather than an empty one, which would fetch the reading
       view itself — and the publisher's own dimensions kept, so the browser can
       still reserve the box. */
    expect(html).not.toMatch(/\bsrc=/);
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="800"');
  });

  /**
   * **The other half of the same trap**, and the one that makes a whole feature
   * silently do nothing: `blocks.json` stores `&amp;` and `getAttribute("src")`
   * returns `&`. Look the stored string up in a manifest keyed on the decoded
   * one and every entry misses. src/assets.ts § 1.
   */
  it("finds an entry whose URL is written with an entity in the stored html", async () => {
    apiFetch.mockResolvedValue(okPng());
    const article = articleWithImages(
      [imageBlock("spya-img002", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`)],
      [storedImage(IMG_URL, SHA)],
    );
    const out = await finalDraw(article, "a-piece", "owned");
    expect(apiFetch).toHaveBeenCalledWith(`/api/asset/a-piece/${SHA}.png`, {
      signal: expect.any(AbortSignal),
    });
    expect(out.blocks[0]?.html).toMatch(/src="blob:/);
  });

  /**
   * **`failed` means hot-link exactly as before**, and it must not become a
   * blank. That is the difference between an article's own image and a PDF
   * figure: a web image has a publisher's URL to fall back to, and blanking one
   * we cannot replace would take a working picture off the page.
   *
   * Checked on **both** draws, because the first is where the blanking happens
   * and a `failed` entry reaching that branch would be invisible in the second.
   */
  it("leaves a failed entry hot-linked, untouched", async () => {
    const article = articleWithImages(
      [imageBlock("spya-img003", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`)],
      [failedImage(IMG_URL)],
    );
    expect((await firstDraw(article, "a-piece", "owned")).blocks[0]).toBe(article.blocks[0]);
    expect((await finalDraw(article, "a-piece", "owned")).blocks[0]).toBe(article.blocks[0]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  /** And a URL with no entry at all — the step never looked — the same. */
  it("leaves an image the manifest never mentions hot-linked, untouched", async () => {
    const article = articleWithImages(
      [imageBlock("spya-img004", `<p><img src="${OTHER_URL}" alt="">Some prose.</p>`)],
      [storedImage(IMG_URL, SHA)],
    );
    expect((await firstDraw(article, "a-piece", "owned")).blocks[0]).toBe(article.blocks[0]);
    expect((await finalDraw(article, "a-piece", "owned")).blocks[0]).toBe(article.blocks[0]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  /**
   * **A `<picture>`'s `<source>` beats the `<img>` outright**, so rewriting the
   * `src` and leaving the siblings is the same silent hot-link one element
   * further out.
   *
   * This fixture is synthetic because the corpus had no `<picture>` in it when
   * the guard was written (260829b § What the corpus cannot tell us). **It has
   * one now**, and the test below is it — a real article whose real publisher
   * really breaks, in a way that is worse than hot-linking. Two fixtures rather
   * than one replacing the other: this one carries two `<source>` types and the
   * real one carries the failure.
   */
  it("removes the sibling <source> of a picture it rewrites", async () => {
    apiFetch.mockResolvedValue(okPng());
    const article = articleWithImages(
      [
        imageBlock(
          "spya-img005",
          `<p><picture><source srcset="https://noemamag.imgix.net/fig.avif" type="image/avif"><source srcset="https://noemamag.imgix.net/fig.webp" type="image/webp"><img src="${IMG_URL_STORED}" alt=""></picture>Some prose.</p>`,
        ),
      ],
      [storedImage(IMG_URL, SHA)],
    );
    /* **Both draws.** Removing `<source>` only where our copy is inserted would
       leave the first paint — the one the reader actually gets first — quietly
       hot-linking, and an assertion on the final draw alone cannot see it. */
    const blank = (await firstDraw(article, "a-piece", "owned")).blocks[0]?.html ?? "";
    expect(blank).not.toContain("<source");
    expect(blank).not.toMatch(/\bnoemamag\b/);

    const html = (await finalDraw(article, "a-piece", "owned")).blocks[0]?.html ?? "";
    expect(html).not.toContain("<source");
    expect(html).toMatch(/src="blob:/);
    expect(html).not.toMatch(/\bnoemamag\b/);
  });

  /**
   * **The real one, and the reason the guard above is not paranoia.**
   *
   * Markup copied out of `after-work-we-ll-have-each-other`, an Asterisk
   * Magazine essay ingested on 2026-09-07 — 97 blocks, three `<figure>`s, each a
   * `<picture>` whose first child is an AVIF `<source>`. It is the corpus's
   * first `<picture>`, and it arrived carrying the failure the guard was
   * invented for:
   *
   * `asteriskmag.com` serves those `.avif` variants as `content-type:
   * text/plain` with `x-content-type-options: nosniff`. The bytes are a valid
   * AVIF (`ftypavif`); the label is wrong and `nosniff` makes the label binding,
   * so Chrome refuses them. And **`<picture>` has no way back** — the `<source>`
   * won on `type` before any byte moved, so the perfectly good PNG in the `<img>`
   * beneath it is never reached. The reader gets a blank box, we get no error,
   * and Sentry gets nothing at all: SPIDERYARN-READING2-2B,
   * docs/plans/260908a-the-monkeys-illustration-did-not-load.md.
   *
   * So the assertion that matters is `not.toContain("<source")` on the **first**
   * draw. Serving our own copy is not what fixes this article — deleting the
   * publisher's mislabelled `<source>` is, and a version that only did it where
   * the blob lands would leave the reader looking at the same blank box until
   * the bytes arrived.
   */
  it("removes a real publisher's mislabelled <source> on the first draw", async () => {
    apiFetch.mockResolvedValue(okPng());
    const article = articleWithImages(
      [imageBlock("spya-zvpebu", MONKEYS_FIGURE, "David Teniers the Younger (–1690)")],
      [storedImage(MONKEYS_SRC, SHA)],
    );

    const blank = (await firstDraw(article, "a-piece", "owned")).blocks[0]?.html ?? "";
    expect(blank, "the mislabelled AVIF must be gone before the reader sees anything").not.toContain(
      "<source",
    );
    expect(blank).not.toContain(".avif");
    /* The `<img>`'s own `srcset` is PNG and would have worked — it goes anyway,
       because a `srcset` left beside a rewritten `src` is the hot-link this
       whole file's first test is about. */
    expect(blank).not.toContain("srcset");

    const html = (await finalDraw(article, "a-piece", "owned")).blocks[0]?.html ?? "";
    expect(html).not.toContain("<source");
    expect(html).toMatch(/src="blob:/);
    /* Through `renderedText`, because the publisher's own markup splits the
       title as `S<em>moking and drinking monkeys, </em>` and the raw html
       therefore does not contain the phrase a reader can see. */
    expect(
      renderedText(html),
      "the caption is the reader's only handle on the picture",
    ).toContain("Smoking and drinking monkeys");
  });

  /**
   * The property the whole reading view rests on, pinned for this half too, and
   * **on both draws** — the first one removes a `<source>` and an attribute, the
   * second adds one back, and either could shift an offset if it ever grew a
   * text node.
   */
  it("does not change the rendered text by one character", async () => {
    apiFetch.mockResolvedValue(okPng());
    const before = `<p><picture><source srcset="https://noemamag.imgix.net/fig.webp"><img src="${IMG_URL_STORED}" alt="A graph"></picture>Some prose.</p>`;
    const article = articleWithImages(
      [imageBlock("spya-img006", before)],
      [storedImage(IMG_URL, SHA)],
    );
    for (const drawn of [
      await firstDraw(article, "a-piece", "owned"),
      await finalDraw(article, "a-piece", "owned"),
    ]) {
      expect(renderedText(drawn.blocks[0]?.html ?? "")).toBe(renderedText(before));
      expect(renderedText(drawn.blocks[0]?.html ?? "")).toBe("Some prose.");
    }
  });

  /**
   * **The publisher comes back when our own copy will not load**, and it comes
   * back because the second draw is rebuilt from the original html rather than
   * from the blanked one — so *leave it alone* is the whole implementation.
   *
   * 260829b § trap 8 is the correction that a *pipeline* failure and a
   * *delivery* failure are not the same thing. This is the delivery one, and it
   * is the case that decides whether a stage-E bug costs a reader privacy or
   * costs them the picture.
   */
  it("puts the publisher's URL back when our own copy will not load", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500 });
    const article = articleWithImages(
      [imageBlock("spya-img007", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`)],
      [storedImage(IMG_URL, SHA)],
    );
    /* Blank while we try… */
    expect((await firstDraw(article, "a-piece", "owned")).blocks[0]?.html).not.toMatch(/\bsrc=/);
    /* …and the publisher's own URL once we have failed. The very same block
       object, which is the strongest form of "exactly as it was". */
    const out = await finalDraw(article, "a-piece", "owned");
    expect(out.blocks[0]).toBe(article.blocks[0]);
    expect(out.blocks[0]?.html).toContain(IMG_URL_STORED);
    expect(created, "a failed fetch must mint nothing").not.toHaveBeenCalled();
  });

  /**
   * **…but the publisher's `<picture>` must not come all the way back**, and
   * this is the case the sentence above got wrong.
   *
   * *Leave it alone* is the right answer for a bare `<img>`: the publisher's URL
   * is what the reader had before any of this existed. It is the wrong answer
   * for a `<picture>`, because putting the markup back verbatim puts the
   * `<source>` back with it — and a `<source>` is chosen before a byte moves and
   * never reconsidered, so an image whose delivery failed goes back to a picture
   * that may not be able to work at all. That is not a hypothetical: it is
   * SPIDERYARN-READING2-2B, where the publisher's AVIF is refused
   * (`net::ERR_BLOCKED_BY_ORB`) and the working PNG underneath it is unreachable.
   *
   * So a delivery failure keeps the publisher's `src` and **nothing else that
   * can load** — not the `<source>`, and not the `<img>`'s own `srcset` either.
   *
   * **The `srcset` is the same bug one level down**, which is the part this test
   * was written the wrong way round first time. The step that fetched and
   * sniffed this image read `img[src]`; the responsive candidates went unlooked
   * at, exactly like the `<source>`. And they are not a fallback: a `srcset`
   * with `w` descriptors takes `src` out of the candidate list altogether, so a
   * candidate that will not load has nothing beneath it. Measured in Chrome on
   * this fixture's own attributes — `600w, 1920w` unreachable gives
   * `naturalWidth: 0` with `currentSrc` on the broken candidate; with the
   * `srcset` gone the `src` draws.
   *
   * `imageSources` absorbing one image's failure is the ordinary path here, not
   * an exotic one: a 500 from our own asset route, or the `IMAGE_WAIT_MS`
   * deadline on a slow connection, reaches exactly this branch. GPT Sol found
   * the branch reviewing the plan and the `srcset` reviewing the code,
   * 2026-09-08.
   */
  it("leaves the verified src as the only candidate when delivery fails", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500 });
    const article = articleWithImages(
      [imageBlock("spya-zvpebu", MONKEYS_FIGURE, "David Teniers the Younger (–1690)")],
      [storedImage(MONKEYS_SRC, SHA)],
    );

    const out = await finalDraw(article, "a-piece", "owned");
    const html = out.blocks[0]?.html ?? "";
    expect(html, "the source we could not check must not come back").not.toContain("<source");
    expect(html).not.toContain(".avif");
    /* The publisher is still serving this image — that is the whole point of the
       fallback — so the one URL we did fetch and sniff stays. */
    expect(html).toContain(MONKEYS_SRC);
    /* …and it is reachable, which it is not while anything else is offered. */
    expect(html, "an unchecked srcset outranks the src rather than backing it up").not.toContain(
      "srcset",
    );
    expect(html, "sizes is meaningless once its srcset is gone").not.toContain("sizes=");
    expect(created, "a failed fetch must mint nothing").not.toHaveBeenCalled();
  });

  /**
   * **The `wanted.images` guard, in the case where getting it wrong would be
   * invisible** — an article with one image we hold and one we do not, where the
   * one we do not is a `<picture>`.
   *
   * `unverified` is only for an image we *meant* to serve: we fetched its `src`,
   * so we know that URL is a real image and can safely make it the only
   * candidate. An image the pipeline never looked at gets none of that — we have
   * no idea whether its `src` works, and stripping the `<source>` a publisher
   * offered could take away the only variant that does.
   *
   * Every other failure test here contains no stored image at all, so
   * `rehostImages` returns before the callback and the guard is never asked.
   * This one asks it. GPT Sol, reviewing the code, 2026-09-08.
   */
  it("leaves a picture we hold no copy of completely alone", async () => {
    apiFetch.mockResolvedValue(okPng());
    const untouched = `<p><picture><source srcset="${OTHER_URL}.webp" type="image/webp"><img src="${OTHER_URL}" srcset="${OTHER_URL} 900w" alt=""></picture>More prose.</p>`;
    const article = articleWithImages(
      [
        imageBlock("spya-img009", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`),
        imageBlock("spya-img010", untouched, "More prose."),
      ],
      /* Only the first is ours. The second is not in the manifest at all. */
      [storedImage(IMG_URL, SHA)],
    );

    for (const drawn of [
      await firstDraw(article, "a-piece", "owned"),
      await finalDraw(article, "a-piece", "owned"),
    ]) {
      expect(
        drawn.blocks[1]?.html,
        "an image we never fetched keeps every candidate the publisher gave it",
      ).toBe(untouched);
      expect(drawn.blocks[1], "and is the very same block object").toBe(article.blocks[1]);
    }
  });

  /** A visitor's copies come off the public route, with no token. */
  it("fetches a visitor's image off the public route", async () => {
    publicFetch.mockResolvedValue(okPng());
    const article = articleWithImages(
      [imageBlock("spya-img008", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`)],
      [storedImage(IMG_URL, SHA)],
    );
    const out = await finalDraw(article, "a-piece", "public");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledWith(
      `/api/public/asset/a-piece/${SHA}.png`,
      expect.any(AbortSignal),
    );
    expect(out.blocks[0]?.html).toMatch(/src="blob:/);
  });

  /** One picture used twice in one article is one object and one request. */
  it("asks for one object once however many times the article uses it", async () => {
    apiFetch.mockResolvedValue(okPng());
    const article = articleWithImages(
      [
        imageBlock("spya-img009", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`),
        imageBlock("spya-img010", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`),
      ],
      [storedImage(IMG_URL, SHA)],
    );
    const out = await finalDraw(article, "a-piece", "owned");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(out.blocks[0]?.html).toMatch(/src="blob:/);
    expect(out.blocks[1]?.html).toMatch(/src="blob:/);
  });

  /**
   * **The regression this stage was most at risk of, asserted directly.**
   *
   * `rehostImages` is awaited before the article renders. With eight PDF figures
   * that was fine; with the 102 images and 7.04 MB of the worst article in the
   * corpus (measured 2026-09-06) it would have turned *the prose appears* into
   * *the prose appears once every image has downloaded*.
   *
   * So the first draw must resolve while the fetches are still outstanding, and
   * this is what says so: not one of the three responses ever arrives, and the
   * article still comes back with its prose in it.
   *
   * **Fake timers, and never advanced, which is the whole of why this cannot
   * pass for the wrong reason.** Written first without them, and putting the
   * `await` back turned it from a 20 ms pass into a 15 second pass — because
   * `IMAGE_WAIT_MS` rescued it, which is exactly the bound that must not be what
   * gets the reader their prose. With the clock frozen, the bound can never
   * fire, so an implementation that awaits the images hangs here instead.
   */
  it("draws the prose without waiting for a single image", async () => {
    vi.useFakeTimers();
    try {
      let started = 0;
      apiFetch.mockImplementation(() => {
        started += 1;
        return new Promise(() => {});
      });
      const article = articleWithImages(
        [
          imageBlock("spya-img012", `<p><img src="${IMG_URL_STORED}" alt="">One.</p>`, "One."),
          imageBlock("spya-img013", `<p><img src="${OTHER_URL}2" alt="">Two.</p>`, "Two."),
          imageBlock("spya-img014", `<p><img src="${OTHER_URL}3" alt="">Three.</p>`, "Three."),
        ],
        [
          storedImage(IMG_URL, SHA),
          storedImage(`${OTHER_URL}2`, "2".repeat(64)),
          storedImage(`${OTHER_URL}3`, "3".repeat(64)),
        ],
      );
      const drawn = await firstDraw(article, "a-piece", "owned");
      expect(started, "all three go out together, not one after another").toBe(3);
      expect(drawn.blocks.map((b) => renderedText(b.html))).toEqual(["One.", "Two.", "Three."]);
      for (const block of drawn.blocks) expect(block.html).not.toMatch(/\bsrc=/);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **`IMAGE_WAIT_MS` is not a first-paint budget** — the prose has already been
   * drawn by the time it starts to matter. It is the point at which we stop
   * believing a fetch of ours will land, and it exists because there is a single
   * second draw: without it one hung connection would leave *every* image on the
   * article blank for the rest of the read.
   *
   * Fake timers rather than a real wait, obviously; the assertion is that the
   * second draw arrives at all and that the picture that did not is back at the
   * publisher's.
   */
  it("gives up on a hung fetch, keeps the one that landed, and mints nothing late", async () => {
    vi.useFakeTimers();
    try {
      const quickSha = "4".repeat(64);
      let arrive = (): void => {};
      const held = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const signals: (AbortSignal | undefined)[] = [];
      apiFetch.mockImplementation(async (path: string, init?: { signal?: AbortSignal }) => {
        signals.push(init?.signal);
        if (path.includes(quickSha)) return okPng();
        await held;
        return okPng();
      });

      const article = articleWithImages(
        [
          imageBlock("spya-img015", `<p><img src="${IMG_URL_STORED}" alt="">Hung.</p>`, "Hung."),
          imageBlock("spya-img016", `<p><img src="${OTHER_URL}" alt="">Quick.</p>`, "Quick."),
        ],
        [storedImage(IMG_URL, SHA), storedImage(OTHER_URL, quickSha)],
      );
      const rehosted = await rehostImages(article, "a-piece", "owned", beginArticleLoad());
      expect(rehosted.article.blocks[0]?.html).not.toMatch(/\bsrc=/);

      await vi.advanceTimersByTimeAsync(IMAGE_WAIT_MS);
      const out = await rehosted.images;

      /* The one that hung is back at the publisher's; the one that landed is
         ours. **One slow picture must not cost the others** — the deadline is a
         bound on the wait, not a reason to throw away what arrived. */
      expect(out?.blocks[0]?.html).toContain(IMG_URL_STORED);
      expect(out?.blocks[1]?.html).toMatch(/src="blob:/);

      /* **The abort itself, asserted.** Without it the outstanding request goes
         on downloading a picture whose publisher URL is already back on the
         page — and deleting `stop.abort()` left this test green until this
         line. */
      expect(signals.some((s) => s?.aborted)).toBe(true);

      /* And the late arrival mints nothing, which an abort alone does not
         guarantee: a response already in hand is not cancelled with its
         request. */
      const mintedByNow = created.mock.calls.length;
      arrive();
      await Promise.resolve();
      expect(created.mock.calls.length).toBe(mintedByNow);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * **What happens to the blobs**, which nothing in this file used to observe at
 * all — not their creation and not their release. GPT Sol, D-2, 2026-09-06, and
 * then again the same day when stage E showed the mechanism itself was wrong.
 *
 * Every failure below leaves the article on screen looking correct, or looking
 * broken for a reason nobody would attribute to this file. What they cost is
 * memory, or somebody else's pictures.
 */
describe("what a load owns", () => {
  const sha = "1".repeat(64);

  /** The blob URL sitting in a block's html, so a test can watch it die. */
  function blobUrlIn(html: string | undefined): string | undefined {
    return /src="(blob:[^"]+)"/.exec(html ?? "")?.[1];
  }

  /**
   * **Releasing a load hands its blobs back**, whatever the article was.
   *
   * The mechanism this replaced swept at the *start of the next* `rehostImages`,
   * so leaving a PDF for anything that never reached one — the shelf, an
   * unshared article, a payload that hung — freed nothing at all for the rest of
   * the session. That is four common navigations, and none of them is a code
   * path anybody would think to look at.
   */
  it("revokes what it minted when it is released, with no next load involved", async () => {
    apiFetch.mockResolvedValue(okPng());
    const load = beginArticleLoad();
    const withFigures = articleWith(
      [figureBlock("spya-tttttt", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, sha)],
    );
    const first = (await rehostImages(withFigures, "a-piece", "owned", load)).article;
    const url = blobUrlIn(first.blocks[0]?.html);
    expect(url, "the load has to have minted one, or this proves nothing").toBeDefined();

    revoked.mockClear();
    load.release();
    expect(revoked).toHaveBeenCalledWith(url);

    /* Idempotent: an effect's cleanup and a later abort must not double-revoke. */
    revoked.mockClear();
    load.release();
    expect(revoked).not.toHaveBeenCalled();
  });

  /**
   * **The bug stage E was one navigation away from shipping.** GPT Sol,
   * 2026-09-06.
   *
   * Ownership used to be claimed *inside* `rehostImages`, which runs only after
   * the article payload has been awaited — so whose turn it was got decided by
   * which request happened to finish last. A slow article A returning after the
   * reader had already moved to B would sweep B's object URLs and abort B's
   * fetches. A's own `live` flag stops A being *rendered*; it does nothing for
   * the article that is on the screen, whose pictures simply go.
   *
   * This is the ordering no test in the file could reach before, because every
   * one of them called `rehostImages` in completion order.
   */
  it("a stale load does not revoke the blobs of the load that overtook it", async () => {
    /* Two loads claimed in the order the reader started them, which is the whole
       point: the claim is synchronous and the payload is not. */
    const stale = beginArticleLoad();
    const current = beginArticleLoad();

    apiFetch.mockResolvedValue(okPng());
    const bs = articleWith(
      [figureBlock("spya-bbbb01", REF_ONE, "Figure 1.")],
      [stored(REF_ONE, sha)],
    );
    const drawn = (await rehostImages(bs, "the-one-on-screen", "owned", current)).article;
    const live = blobUrlIn(drawn.blocks[0]?.html);
    expect(live).toBeDefined();

    /* A's payload finally arrives, long after the reader left it. */
    revoked.mockClear();
    await rehostImages(
      articleWith([figureBlock("spya-bbbb02", REF_TWO, "Figure 2.")], [stored(REF_TWO, sha)]),
      "the-one-they-left",
      "owned",
      stale,
    );
    expect(revoked, "the article on screen must keep its pictures").not.toHaveBeenCalledWith(live);
    expect(current.signal.aborted, "and its fetches must not be cancelled").toBe(false);
  });

  /**
   * **A released load must stop, and must not mint.**
   *
   * Two assertions, because the abort alone is not enough: a response whose
   * bytes had already arrived is not cancelled by aborting its request, so the
   * signal has to be re-read after `blob()` too — and `mint` refuses as well, so
   * that the leak does not rest on a caller remembering to ask.
   */
  it("aborts a released load, and mints nothing once it has been", async () => {
    let arrive = (): void => {};
    const held = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const signals: (AbortSignal | undefined)[] = [];
    apiFetch.mockImplementation(async (_path: string, init?: { signal?: AbortSignal }) => {
      signals.push(init?.signal);
      await held;
      return okPng();
    });

    const load = beginArticleLoad();
    const pending = rehostImages(
      articleWith([figureBlock("spya-vvvvvv", REF_ONE, "Figure 1.")], [stored(REF_ONE, sha)]),
      "a-piece",
      "owned",
      load,
    );
    expect(signals, "the fetch has to have gone out before we release").toHaveLength(1);

    load.release(); // the reader leaves — for the shelf, say, not another article
    expect(signals[0]?.aborted).toBe(true);

    /* And now the bytes turn up anyway, which is the case an abort cannot
       prevent — the response was already in hand. */
    arrive();
    await pending;
    expect(created).not.toHaveBeenCalled();
  });

  /**
   * **Released before its payload even arrived**, which is the ordinary shape of
   * a reader who clicks twice. Not one request may go out — for a picture of
   * ours or, far worse, for the publisher's.
   */
  it("fetches nothing at all for a load released before the article came back", async () => {
    const load = beginArticleLoad();
    load.release();
    const out = await rehostImages(
      articleWithImages(
        [imageBlock("spya-bbbb03", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`)],
        [storedImage(IMG_URL, "5".repeat(64))],
      ),
      "a-piece",
      "owned",
      load,
    );
    expect(apiFetch).not.toHaveBeenCalled();
    expect(out.article, "and the article comes back untouched").toBe(
      out.article,
    );
    expect(await out.images).toBeNull();
  });

  /**
   * **The awaited half is where an already-fired abort hides.** A mixed article
   * awaits its figures first, so a load released during that await reaches the
   * image half with a signal that has *already* aborted — and
   * `addEventListener` does not replay an abort that has already happened. Miss
   * the up-front check and every image fetch goes out for an article nobody is
   * looking at. GPT Sol, 2026-09-06.
   */
  it("starts no image fetch when the load was released while the figures were coming", async () => {
    const load = beginArticleLoad();
    const asked: string[] = [];
    apiFetch.mockImplementation(async (path: string) => {
      asked.push(path);
      /* Released *during* the figure fetch, which is the whole fixture. */
      if (asked.length === 1) load.release();
      return okPng();
    });

    const figureSha = "6".repeat(64);
    const imageSha = "7".repeat(64);
    const article = {
      meta: { slug: "a-piece", title: "A piece" },
      blocks: [
        figureBlock("spya-bbbb04", REF_ONE, "Figure 1."),
        imageBlock("spya-bbbb05", `<p><img src="${IMG_URL_STORED}" alt="">Some prose.</p>`),
      ],
      tree: { version: "hierarchy/4", nodes: [], roots: [] },
      assets: {
        version: "assets/2",
        sourceHash: "x",
        fetchedAt: "2026-09-06T00:00:00.000Z",
        entries: [storedImage(IMG_URL, imageSha)],
        pdfFigures: [stored(REF_ONE, figureSha)],
      },
    } as unknown as Article;

    const out = await rehostImages(article, "a-piece", "owned", load);
    await out.images;
    expect(asked, "only the figure was ever asked for").toEqual([
      `/api/asset/a-piece/${figureSha}.png`,
    ]);
    expect(created).not.toHaveBeenCalled();
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

    const withImage = rehostBlockHtml(bare, { figure: () => ({ src: "blob:x", width: 800, height: 600 }), image: () => null });
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

/**
 * **The wiring in `useArticleAccess`, checked by reading the source** — the
 * second-best thing, and worth having because the best thing does not exist
 * here yet.
 *
 * `rehostImages` hands back two articles and it is the *hook* that draws the
 * second. Delete that one `setAnswer` and every test above this line stays
 * green while **every stored image on every article is blank for ever**: the
 * first draw took the publisher's `src` away and nothing ever puts ours in.
 * That is the exact shape of failure this repo keeps naming
 * (docs/reusable/silent-success.md), and it is invisible to a test of the
 * module in isolation.
 *
 * A mounted-`App` test driving fetch → state → render would catch it properly
 * and is owed — it needs a React testing library the project has not chosen
 * (tests/sanitize-client.test.ts § the ingress is wired up says the same thing
 * about the same function, and this scan is copied from it). Until then: a
 * source read, which catches the deletion and the rename and admits it catches
 * nothing else. GPT Sol, 2026-09-06.
 */
describe("the second draw is wired to the hook", () => {
  /* `useArticleAccess` left `App.tsx` for a file of its own on 2026-09-06
     (260906c § Stage 1a), between this guard being written and dev being merged
     into that branch. Named here, once, so that a subject which moves again
     fails on the read. */
  const ACCESS = readFileSync("src/web/article/access.ts", "utf8");

  /**
   * The body of the hook's effect, with **both anchors checked before the
   * slice**.
   *
   * `indexOf` returning -1 makes `slice(-1, -1)` the empty string, and an
   * assertion against the empty string is an assertion against nothing. It
   * happens to fail loudly here rather than pass — every assertion below looks
   * for something — but that is a property of what these two tests happen to
   * ask, not of the scan, and the next assertion added need not share it.
   * docs/reusable/silent-success.md.
   */
  function effect(): string {
    const start = ACCESS.indexOf("function useArticleAccess");
    const end = ACCESS.indexOf("async function resolveAccess");
    expect(start, "useArticleAccess must exist in src/web/article/access.ts").toBeGreaterThan(-1);
    expect(end, "resolveAccess must follow it there").toBeGreaterThan(start);
    return ACCESS.slice(start, end);
  }

  it("sets the answer a second time when the images arrive", () => {
    expect(effect(), "the scan itself must not silently find nothing").toContain("resolveAccess(");
    /* **The promise has to be consumed and its value has to reach state**, and
       the two are asserted as one pattern rather than two `toContain`s: written
       apart, `withImages` present anywhere and `setAnswer` present anywhere both
       stayed true when the whole `.then` was replaced by `void withImages;`, and
       this test passed while every image on every article went blank. It pins
       the shape as written, deliberately — a different shape is welcome and has
       to come back here and say so. */
    expect(effect()).toMatch(/withImages\s*\.then\([\s\S]{0,400}setAnswer\(/);
  });

  /**
   * **And the load is claimed synchronously, before the payload is awaited.**
   * Claiming it inside `rehostImages` is what let a slow article revoke the
   * blobs of the one that overtook it — rehost.ts § `ArticleLoad`. A source read
   * for the same reason as above: the ordering is between a React effect and a
   * network round trip, and nothing here can mount one.
   */
  it("claims and releases the load in the effect, not inside rehostImages", () => {
    expect(effect()).toContain("beginArticleLoad()");
    /* The claim comes before the call it is for. */
    expect(effect().indexOf("beginArticleLoad()")).toBeLessThan(
      effect().indexOf("resolveAccess("),
    );
    /* And the cleanup hands it back — `live = false` alone frees nothing. */
    expect(effect()).toMatch(/return \(\) => \{[\s\S]{0,600}load\.release\(\)/);
  });
});
