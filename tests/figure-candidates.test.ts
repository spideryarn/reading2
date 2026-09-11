// @vitest-environment jsdom
/**
 * **A bigger picture than the publisher's `src`** — which `srcset` candidate the
 * assets step prefers, and the join between the manifest it writes and the
 * reading view that looks it up.
 *
 * jsdom, for the reason tests/assets.test.ts gives: the one thing that has to be
 * right is that the pipeline reads a URL the way the browser will, and a
 * `srcset` carries `&amp;` exactly as a `src` does.
 *
 * The join at the bottom is the test the plan asks for by name
 * (docs/plans/260911a-figures-with-enough-resolution-to-read.md): the manifest
 * is built by `collectAssets` and read by `rehostImages`, both for real, so a
 * manifest keyed on the *candidate* rather than the `src` — the easy mistake —
 * shows up as a publisher URL left in the page rather than as nothing at all.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AssetEntry,
  imageCandidatesIn,
  imageSourcesIn,
  PREFERRED_IMAGE_WIDTH,
  preferredCandidateOf,
  widthCandidatesOf,
} from "../src/assets.js";
import type { Article, Block, BlockId } from "../src/types.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const publicFetch = vi.fn();
vi.mock("../src/web/public-api.js", () => ({
  publicFetch: (...args: unknown[]) => publicFetch(...args),
}));

const { rehostImages, beginArticleLoad } = await import("../src/web/rehost.js");
const { collectAssets } = await import("../src/collect-assets.js");
const { FetchFailure } = await import("../src/fetch.js");

/** Parse like the client does — `innerHTML` on a detached node. */
function host(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

/** The first `<img>` in `html`, as the DOM hands it back. */
function imgIn(html: string): Element {
  const found = host(html).querySelector("img");
  if (!found) throw new Error("no img in fixture");
  return found;
}

const SRC = "https://cdn.test/fig-300.png";

function preferred(srcset: string, src = SRC): string | null {
  return preferredCandidateOf(imgIn(`<img src="${src}" srcset="${srcset}">`), src);
}

describe("which srcset candidate is preferred", () => {
  it("takes the smallest candidate at least the preferred width wide", () => {
    expect(PREFERRED_IMAGE_WIDTH).toBe(1280);
    expect(
      preferred(
        "https://cdn.test/a-600.png 600w, https://cdn.test/a-1920.png 1920w, https://cdn.test/a-1440.png 1440w",
      ),
    ).toBe("https://cdn.test/a-1440.png");
    /* Exactly the width counts as wide enough. */
    expect(preferred("https://cdn.test/a-1280.png 1280w, https://cdn.test/a-2000.png 2000w")).toBe(
      "https://cdn.test/a-1280.png",
    );
  });

  it("takes the widest there is when nothing reaches the preferred width", () => {
    expect(preferred("https://cdn.test/a-300.png 300w, https://cdn.test/a-840.png 840w")).toBe(
      "https://cdn.test/a-840.png",
    );
  });

  it("offers nothing when the choice is the src itself", () => {
    expect(preferred(`${SRC} 1600w, https://cdn.test/a-600.png 600w`)).toBeNull();
  });

  it("offers nothing without a srcset", () => {
    expect(preferredCandidateOf(imgIn(`<img src="${SRC}">`), SRC)).toBeNull();
  });

  it("reads a candidate's URL the way the browser will, not the way the file spells it", () => {
    /* The `&amp;` trap, one attribute over: a candidate built from the stored
       string would fetch a URL with a literal `&amp;` in its query string. */
    expect(
      preferred("https://cdn.test/a.png?w=1600&amp;s=3a2bee 1600w, https://cdn.test/b.png 600w"),
    ).toBe("https://cdn.test/a.png?w=1600&s=3a2bee");
  });

  /**
   * **Density descriptors: the highest density above 1× and at most 2×.** The
   * Overseer's call on 260911a's open question, 2026-09-11 — Wikipedia marks
   * every figure `src` plus `1.5x, 2x`, and it is where most of the corpus's
   * diagrams come from.
   */
  it("takes the 2x candidate from a density list", () => {
    expect(preferred("https://cdn.test/a-375.png 1.5x, https://cdn.test/a-500.png 2x")).toBe(
      "https://cdn.test/a-500.png",
    );
    /* Order does not matter, and `2.0x` is the same density. */
    expect(preferred("https://cdn.test/a-500.png 2.0x, https://cdn.test/a-375.png 1.5x")).toBe(
      "https://cdn.test/a-500.png",
    );
    /* The highest there is at or under 2x, when there is no 2x. */
    expect(preferred("https://cdn.test/a-375.png 1.5x")).toBe("https://cdn.test/a-375.png");
    /* A 3x beside a 2x is passed over; the cap is 2x. */
    expect(
      preferred("https://cdn.test/a-500.png 2x, https://cdn.test/a-750.png 3x, https://cdn.test/a-375.png 1.5x"),
    ).toBe("https://cdn.test/a-500.png");
  });

  it("reads a real Wikipedia thumbnail's 2x the way the browser will", () => {
    const thumb =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Tenets_of_open_science.svg";
    const src = `${thumb}/250px-Tenets_of_open_science.svg.png?utm_source=en.wikipedia.org&utm_campaign=parser`;
    const html =
      `<img src="${src.replace(/&/g, "&amp;")}" width="250" height="180"` +
      ` srcset="${thumb}/375px-Tenets_of_open_science.svg.png?utm_source=en.wikipedia.org&amp;utm_campaign=parser 1.5x,` +
      ` ${thumb}/500px-Tenets_of_open_science.svg.png?utm_source=en.wikipedia.org&amp;utm_campaign=parser 2x">`;
    expect(preferredCandidateOf(imgIn(html), src)).toBe(
      `${thumb}/500px-Tenets_of_open_science.svg.png?utm_source=en.wikipedia.org&utm_campaign=parser`,
    );
  });

  it("offers nothing from a density list with nothing above 1x and at most 2x", () => {
    const refused: [string, string][] = [
      ["only a 3x", "https://cdn.test/a-750.png 3x"],
      ["only a 1x", "https://cdn.test/a-250.png 1x"],
      ["a zero density", "https://cdn.test/a.png 0x"],
      ["a density below 1x", "https://cdn.test/a.png 0.5x"],
      ["a malformed density", "https://cdn.test/a.png 2.x"],
      ["a signed density", "https://cdn.test/a.png +2x"],
      ["an exponent", "https://cdn.test/a.png 2e0x"],
      ["an absurd density", "https://cdn.test/a.png 100x"],
      ["two candidates claiming one density", "https://cdn.test/a.png 2x, https://cdn.test/b.png 2.0x"],
      ["a protocol-relative 2x, as some Wikipedia markup has", "//upload.wikimedia.org/a/500px-a.png 2x"],
    ];
    for (const [why, srcset] of refused) expect(preferred(srcset), why).toBeNull();
  });

  it("falls back on every form it does not act on", () => {
    const refused: [string, string][] = [
      ["width mixed with density", "https://cdn.test/a.png 600w, https://cdn.test/b.png 2x"],
      ["density mixed with width", "https://cdn.test/a.png 2x, https://cdn.test/b.png 1600w"],
      ["a candidate with no descriptor", "https://cdn.test/a.png, https://cdn.test/b.png 1600w"],
      ["a height descriptor", "https://cdn.test/a.png 1600w 900h"],
      ["a zero width", "https://cdn.test/a.png 0w"],
      ["a leading zero", "https://cdn.test/a.png 01600w"],
      ["an absurd width", "https://cdn.test/a.png 1000000w"],
      ["a parenthesis", "https://cdn.test/a.png (1600w)"],
      ["two candidates claiming one width", "https://cdn.test/a.png 1600w, https://cdn.test/b.png 1600w"],
      ["a leading comma", ", https://cdn.test/a.png 1600w"],
      ["an empty candidate", "https://cdn.test/a.png 600w,, https://cdn.test/b.png 1600w"],
      ["a trailing comma", "https://cdn.test/a.png 1600w,"],
      ["non-ASCII descriptor whitespace", "https://cdn.test/a.png \u00a01600w"],
      ["a relative candidate", "/a-1600.png 1600w, https://cdn.test/b.png 600w"],
      ["a protocol-relative candidate", "//cdn.test/a-1600.png 1600w"],
      ["a data: candidate", "data:image/png;base64,iVBORw0KGgo= 1600w"],
      ["a non-http scheme", "ftp://cdn.test/a.png 1600w"],
      ["an empty srcset", "   "],
    ];
    for (const [why, srcset] of refused) expect(preferred(srcset), why).toBeNull();
  });

  it("does not split a data: URL on its own comma", () => {
    /* Parsed as one candidate — and then refused as not rehostable, rather than
       read as a URL ending `base64` followed by a bogus second candidate. */
    expect(widthCandidatesOf("data:image/png;base64,AAAA 1600w")).toEqual([
      { url: "data:image/png;base64,AAAA", width: 1600 },
    ]);
  });

  it("refuses a list past its bounds rather than reading as much as it can", () => {
    const many = Array.from({ length: 33 }, (_, i) => `https://cdn.test/a-${i + 1}.png ${i + 1}w`);
    expect(widthCandidatesOf(many.slice(0, 32).join(", "))).toHaveLength(32);
    expect(widthCandidatesOf(many.join(", "))).toBeNull();
    const long = `https://cdn.test/${"x".repeat(9000)}.png 1600w`;
    expect(widthCandidatesOf(long)).toBeNull();
  });

  it("reads the img's own srcset and never a sibling <source>", () => {
    const html =
      `<picture><source srcset="https://cdn.test/a-1600.avif 1600w" type="image/avif">` +
      `<img src="${SRC}" srcset="https://cdn.test/a-600.png 600w, https://cdn.test/a-1920.png 1920w"></picture>`;
    expect(preferredCandidateOf(imgIn(html), SRC)).toBe("https://cdn.test/a-1920.png");
  });
});

describe("imageCandidatesIn", () => {
  it("names the same images, in the same order, as the browser's walk", () => {
    const root = host(
      `<p><img src="https://cdn.test/one.png?a=1&amp;b=2" srcset="https://cdn.test/one-1600.png 1600w"></p>` +
        `<img src="data:image/png;base64,AAAA">` +
        `<img src="https://cdn.test/two.png">` +
        `<img src="https://cdn.test/one.png?a=1&amp;b=2" srcset="https://cdn.test/other-1600.png 1600w">` +
        `<iframe src="https://video.test/x"></iframe>`,
    );
    const candidates = imageCandidatesIn(root);
    expect(candidates.map((c) => c.src)).toEqual(imageSourcesIn(root));
    /* One picture used twice is one entry, and the first occurrence decides. */
    expect(candidates).toEqual([
      { src: "https://cdn.test/one.png?a=1&b=2", preferred: "https://cdn.test/one-1600.png" },
      { src: "https://cdn.test/two.png", preferred: null },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * The join: a manifest the pipeline wrote, read by the reading view
 * ------------------------------------------------------------------ */

/**
 * The monkeys figure from SPIDERYARN-READING2-2B, as it sits in
 * `revision_blocks.html` bar the candidates trimmed to two apiece — the same
 * fixture tests/rehost.test.ts keeps, with the `&amp;`-bearing query string a
 * real CDN would add, so the join has something to get wrong.
 */
const ASTERISK = "https://asteriskmag.com/media/pages/issues/15/after-work-we-ll-have-each-other";
const STEM = `${ASTERISK}/8b873bdfd6-1784554053/collier02_david_teniers`;
const MONKEYS_SRC = `${STEM}-300x.png`;
const MONKEYS_BIG = `${STEM}-1920x-sharpen50.png?v=2&s=9f`;
const MONKEYS_FIGURE =
  `<figure id="spya-zvpebu"><picture>` +
  `<source srcset="${STEM}-600x-q64-sharpen50.avif 600w, ${STEM}-1920x-q64-sharpen50.avif 1920w"` +
  ` sizes="(min-width: 768px) 750px, 100vw" type="image/avif">` +
  `<img src="${MONKEYS_SRC}" alt="illustration"` +
  ` srcset="${STEM}-600x-sharpen50.png 600w, ${STEM}-1920x-sharpen50.png?v=2&amp;s=9f 1920w"` +
  ` sizes="(min-width: 768px) 750px, 100vw"></picture>` +
  `<figcaption>David Teniers the Younger, Smoking and drinking monkeys.</figcaption></figure>`;

const SMALL = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 0, 0]);
const BIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 19, 2, 0, 1, 9]);
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function figureBlock(): Block {
  return { id: "spya-zvpebu" as BlockId, tag: "figure", kind: "media", text: "Monkeys.", html: MONKEYS_FIGURE } as Block;
}

/** A bucket in a Map, create-only like the real one. */
function bucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    head: async (key: string) => {
      const there = objects.get(key);
      return there ? { bytes: there.byteLength, contentType: null } : null;
    },
    get: async (key: string) => objects.get(key) ?? null,
    putIfAbsent: async (key: string, bytes: Uint8Array) => {
      if (objects.has(key)) return "already-there" as const;
      objects.set(key, bytes);
      return "stored" as const;
    },
    remove: async (key: string) => void objects.delete(key),
  };
}

async function manifestFor(blocks: Block[]) {
  const asked: string[] = [];
  const run = await collectAssets({
    blocks,
    blobs: bucket(),
    fetchImpl: async (url) => {
      asked.push(url);
      if (url === MONKEYS_BIG) return { bytes: BIG, contentType: "image/png", finalUrl: url };
      if (url === MONKEYS_SRC) return { bytes: SMALL, contentType: "image/png", finalUrl: url };
      throw new FetchFailure("not-found", url, "nothing scripted", { status: 404 });
    },
  });
  return { assets: run.assets, asked };
}

function articleOf(blocks: Block[], entries: AssetEntry[]): Article {
  return {
    meta: { slug: "a-piece", title: "A piece" },
    blocks,
    tree: { version: "hierarchy/4", nodes: [], roots: [] },
    assets: { version: "assets/2", sourceHash: "x", fetchedAt: "2026-09-11T00:00:00.000Z", entries },
  } as unknown as Article;
}

function okBlob() {
  return { ok: true, status: 200, blob: async () => new Blob([BIG]) };
}

beforeEach(() => {
  apiFetch.mockReset();
  publicFetch.mockReset();
});

describe("the manifest the step writes is the one the reading view can find", () => {
  it("keys the bigger picture on the src, and records where it came from", async () => {
    const blocks = [figureBlock()];
    const before = JSON.stringify(blocks);
    const { assets, asked } = await manifestFor(blocks);

    expect(asked, "the candidate, decoded, and never the thumbnail").toEqual([MONKEYS_BIG]);
    expect(assets.entries).toEqual([
      {
        url: MONKEYS_SRC,
        status: "stored",
        sha256: sha(BIG),
        ext: "png",
        contentType: "image/png",
        bytes: BIG.byteLength,
        from: MONKEYS_BIG,
      },
    ]);
    /* The step reads the blocks and writes nothing into them: the stored html,
       and therefore every block id minted from it, is exactly as it was. */
    expect(JSON.stringify(blocks)).toBe(before);
  });

  for (const footing of ["owned", "public"] as const) {
    it(`serves our copy of the bigger picture to ${footing === "owned" ? "an owner" : "a visitor"}, with no publisher URL on either draw`, async () => {
      const blocks = [figureBlock()];
      const { assets } = await manifestFor(blocks);
      const transport = footing === "owned" ? apiFetch : publicFetch;
      transport.mockResolvedValue(okBlob());

      const rehosted = await rehostImages(articleOf(blocks, assets.entries), "a-piece", footing, beginArticleLoad());
      const first = rehosted.article.blocks[0]?.html ?? "";
      const final = ((await rehosted.images) ?? rehosted.article).blocks[0]?.html ?? "";

      /* While our copy is on its way the reader's browser must not be pointed
         at the publisher — the thumbnail, the candidate, or the AVIF. */
      expect(first).not.toContain("asteriskmag.com");
      expect(final).not.toContain("asteriskmag.com");
      expect(final).toMatch(/src="blob:/);
      /* And the object asked for is the bigger picture's, found by the src. */
      expect(transport).toHaveBeenCalledTimes(1);
      expect(String(transport.mock.calls[0]?.[0])).toContain(sha(BIG));
      expect(rehosted.article.blocks[0]?.id).toBe("spya-zvpebu");
    });
  }

  it("falls back to the src we fetched, not the candidate, when our copy will not load", async () => {
    const blocks = [figureBlock()];
    const { assets } = await manifestFor(blocks);
    /* A missing object — the bucket has lost it, or the route answers 404. */
    apiFetch.mockResolvedValue({ ok: false, status: 404, blob: async () => new Blob([]) });

    const rehosted = await rehostImages(articleOf(blocks, assets.entries), "a-piece", "owned", beginArticleLoad());
    const final = ((await rehosted.images) ?? rehosted.article).blocks[0]?.html ?? "";
    expect(final).toContain(`src="${MONKEYS_SRC}"`);
    /* The candidate is as unchecked, on the reader's side, as the rest of the
       srcset — `unverified` keeps only the src. */
    expect(final).not.toContain("1920x");
    expect(final).not.toContain("srcset");
  });
});
