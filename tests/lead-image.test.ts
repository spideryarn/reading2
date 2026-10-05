/**
 * **The article's own first picture on its card**, when we hold a copy.
 *
 * Greg, 2026-10-05: *"hmmm, not sure. go with the lead image for now"*. The
 * first slice refused it as somebody else's picture under our name, so what is
 * held here is the narrow form: only a copy we host and already show in the
 * article, at our own address, never the publisher's; and one switch.
 * docs/plans/261005f-link-previews-and-seo-for-shared-links.md § The lead picture.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { leadImageOf } from "../src/asset-delivery.js";
import type { AssetEntry, Assets } from "../src/assets.js";
import { LEAD_IMAGE_ON_CARDS, OG_CARD, composeShell, leadImageUrl } from "../src/public/page-head.js";
import type { PublicHead } from "../src/store/public-reader.js";
import { PUBLIC_ORIGIN } from "../src/urls.js";

const SHELL = readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf8");

function head(over: Partial<PublicHead> = {}): PublicHead {
  return {
    slug: "the-hard-problem",
    title: "The hard problem is a distraction",
    gist: "Consciousness research keeps circling one question that may not be the useful one.",
    canonical: "https://aeon.co/essays/the-hard-problem-is-a-distraction",
    authors: [],
    image: null,
    ...over,
  };
}

const doc = (markup: string): Document => new JSDOM(markup).window.document;
const metaContent = (d: Document, selector: string): string | null =>
  d.querySelector(selector)?.getAttribute("content") ?? null;

describe("the lead picture on a shared article's card", () => {
  const SHA = "a".repeat(64);
  const image = { sha256: SHA, ext: "jpeg" as const };
  const OURS = `https://www.spideryarn.com/api/public/asset/the-hard-problem/${SHA}.jpeg`;

  it("is switched on, in one place", () => {
    expect(LEAD_IMAGE_ON_CARDS).toBe(true);
  });

  it("is on the card at our own address, for Open Graph and for X", () => {
    const d = doc(composeShell(SHELL, head({ image })));
    expect(metaContent(d, 'meta[property="og:image"]')).toBe(OURS);
    expect(metaContent(d, 'meta[name="twitter:image"]')).toBe(OURS);
    expect(metaContent(d, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(d.querySelectorAll('meta[property="og:image"]')).toHaveLength(1);
    expect(d.querySelectorAll('meta[name="twitter:image"]')).toHaveLength(1);
  });

  /* The manifest records no dimensions, and the brand image's would be a lie
     about this one. */
  it("claims no size for a picture we never measured, and is described by the article's title", () => {
    const d = doc(composeShell(SHELL, head({ image })));
    expect(d.querySelector('meta[property="og:image:width"]')).toBeNull();
    expect(d.querySelector('meta[property="og:image:height"]')).toBeNull();
    expect(metaContent(d, 'meta[property="og:image:alt"]')).toBe("The hard problem is a distraction");
  });

  it("falls back to our own picture, whole, when there is none", () => {
    const d = doc(composeShell(SHELL, head({ image: null })));
    expect(metaContent(d, 'meta[property="og:image"]')).toBe(OG_CARD.url);
    expect(metaContent(d, 'meta[name="twitter:image"]')).toBe(OG_CARD.url);
    expect(metaContent(d, 'meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent(d, 'meta[property="og:image:alt"]')).toBe("Spideryarn");
  });

  it("is turned off by the one switch, whatever the article holds", () => {
    expect(leadImageUrl(head({ image }), false)).toBeNull();
    expect(leadImageUrl(head({ image }), true)).toBe(OURS);
    expect(leadImageUrl(head({ image: null }), true)).toBeNull();
  });

  /* The address is built from a manifest entry, and a manifest is a `jsonb`
     column: nothing but a 64-digit hash and one of our own extensions may
     reach a published URL. */
  it("refuses a hash or an extension that is not shaped like ours", () => {
    for (const bad of [
      { sha256: "abc", ext: "jpeg" as const },
      { sha256: `${"a".repeat(63)}"`, ext: "jpeg" as const },
      { sha256: `${"a".repeat(55)}/../../x`, ext: "jpeg" as const },
      { sha256: SHA.toUpperCase(), ext: "jpeg" as const },
      { sha256: SHA, ext: "svg" as never },
      { sha256: SHA, ext: "gif" as const },
      { sha256: [SHA] as unknown as string, ext: "jpeg" as const },
      { sha256: { toString: null } as unknown as string, ext: "jpeg" as const },
    ]) {
      expect(leadImageUrl(head({ image: bad }), true), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is always an address on our own origin, under the public asset route", () => {
    const d = doc(composeShell(SHELL, head({ image, slug: "a slug/with?odd#chars" })));
    const url = metaContent(d, 'meta[property="og:image"]') ?? "";
    expect(url.startsWith(`${PUBLIC_ORIGIN}/api/public/asset/`)).toBe(true);
    expect(new URL(url).pathname.split("/")).toHaveLength(6);
  });
});

describe("leadImageOf, which picks it out of the manifest", () => {
  type Stored = Extract<AssetEntry, { status: "stored" }>;
  const stored = (over: Partial<Stored> = {}): AssetEntry => ({
    url: "https://cdn.example/lead.jpg",
    status: "stored",
    sha256: "b".repeat(64),
    ext: "jpeg",
    contentType: "image/jpeg",
    bytes: 120_000,
    ...over,
  });
  const manifest = (entries: AssetEntry[], pdfFigures?: unknown[]): Assets =>
    ({
      version: "assets/2",
      sourceHash: "x",
      fetchedAt: "2026-10-05T00:00:00Z",
      entries,
      ...(pdfFigures ? { pdfFigures } : {}),
    }) as Assets;

  it("is the first stored picture, in the article's own order", () => {
    const first = stored({ sha256: "1".repeat(64) });
    const second = stored({ sha256: "2".repeat(64) });
    expect(leadImageOf(manifest([first, second]))).toEqual({ sha256: "1".repeat(64), ext: "jpeg" });
  });

  it("is nothing for an article the step never ran on, or that has no pictures", () => {
    expect(leadImageOf(undefined)).toBeNull();
    expect(leadImageOf(null)).toBeNull();
    expect(leadImageOf(manifest([]))).toBeNull();
  });

  it("passes over a picture we failed to store, and holds nothing of its address", () => {
    const failed: AssetEntry = {
      url: "https://cdn.example/a.jpg",
      status: "failed",
      reason: "blocked",
      at: "2026-10-05T00:00:00Z",
    };
    expect(leadImageOf(manifest([failed]))).toBeNull();
    const picked = leadImageOf(manifest([failed, stored()]));
    expect(picked).toEqual({ sha256: "b".repeat(64), ext: "jpeg" });
    /* Two fields and no `url`: the publisher's address cannot reach a head. */
    expect(Object.keys(picked ?? {}).sort()).toEqual(["ext", "sha256"]);
  });

  /* Bytes stand in for dimensions, which the manifest does not record: an
     icon, an avatar and a tracking pixel are small, and a platform refuses a
     picture that is very large. */
  it("passes over an icon, an animation and a picture too heavy for a card", () => {
    expect(leadImageOf(manifest([stored({ bytes: 19_999 })]))).toBeNull();
    expect(leadImageOf(manifest([stored({ bytes: 20_000 })]))).not.toBeNull();
    expect(leadImageOf(manifest([stored({ bytes: 5_000_000 })]))).not.toBeNull();
    expect(leadImageOf(manifest([stored({ bytes: 5_000_001 })]))).toBeNull();
    expect(leadImageOf(manifest([stored({ ext: "gif", contentType: "image/gif" })]))).toBeNull();
    expect(leadImageOf(manifest([stored({ ext: "png", contentType: "image/png" })]))).toEqual({
      sha256: "b".repeat(64),
      ext: "png",
    });
  });

  it("goes on to the next picture when the first is an icon", () => {
    const icon = stored({ sha256: "1".repeat(64), bytes: 900 });
    const photo = stored({ sha256: "2".repeat(64), bytes: 240_000 });
    expect(leadImageOf(manifest([icon, photo]))?.sha256).toBe("2".repeat(64));
  });

  it("does not use a figure cut out of a PDF, which is a chart and not a lead picture", () => {
    const figure = { status: "stored", sha256: "c".repeat(64), ext: "png", contentType: "image/png", bytes: 90_000 };
    expect(leadImageOf(manifest([], [figure]))).toBeNull();
  });

  it("survives a manifest that is not shaped like one", () => {
    expect(leadImageOf({} as Assets)).toBeNull();
    expect(leadImageOf({ entries: "no" } as unknown as Assets)).toBeNull();
  });

  it("skips malformed hashes without hiding the next valid picture", () => {
    for (const sha256 of [undefined, null, "bad", ["b".repeat(64)], { toString: null }]) {
      const bad = stored({ sha256: sha256 as unknown as string });
      expect(leadImageOf(manifest([bad])), JSON.stringify(sha256)).toBeNull();
      expect(leadImageOf(manifest([bad, stored()])), JSON.stringify(sha256)).toEqual({
        sha256: "b".repeat(64), ext: "jpeg",
      });
    }
  });

  it("refuses non-finite byte counts", () => {
    for (const bytes of [NaN, Infinity, -Infinity]) {
      expect(leadImageOf(manifest([stored({ bytes })]))).toBeNull();
    }
  });
});
