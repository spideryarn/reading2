/**
 * **The picture on a link preview, and the three places that have to agree
 * about it**: the file in `public/`, `OG_CARD` in src/public/page-head.ts (what
 * a shared article's head says), and the default head in `index.html`, which is
 * written by hand because that file is not built from TypeScript.
 *
 * A card whose image is missing, too heavy or misdescribed still has a working
 * link, so nothing else would say.
 * docs/plans/261005f-link-previews-and-seo-for-shared-links.md.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { MANAGED_HEAD_END, MANAGED_HEAD_START, OG_CARD } from "../src/public/page-head.js";
import { APP_NAME, TAGLINE } from "../src/title-text.js";
import { PUBLIC_ORIGIN } from "../src/urls.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHELL = readFileSync(path.join(ROOT, "index.html"), "utf8");
const shell = new JSDOM(SHELL).window.document;
const content = (selector: string): string | null =>
  shell.querySelector(selector)?.getAttribute("content") ?? null;

describe("public/og-card.png", () => {
  const bytes = readFileSync(path.join(ROOT, "public", OG_CARD.path.slice(1)));

  it("is a PNG of the size the head says it is", () => {
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    /* IHDR is the first chunk: width and height are the two big-endian words
       at 16 and 20. */
    expect(bytes.readUInt32BE(16)).toBe(OG_CARD.width);
    expect(bytes.readUInt32BE(20)).toBe(OG_CARD.height);
    expect([OG_CARD.width, OG_CARD.height]).toEqual([1200, 630]);
  });

  /* WhatsApp documents 600KB and is reported to drop the thumbnail silently
     above about 300KB (docs/research/261005b). */
  it("is light enough for WhatsApp to draw", () => {
    expect(bytes.length).toBeLessThan(300_000);
  });

  it("is published at an absolute address on our own origin", () => {
    expect(OG_CARD.url).toBe(`${PUBLIC_ORIGIN}${OG_CARD.path}`);
    /* Written out: `/public/og-card.png` would agree with itself everywhere
       and be answered by the SPA shell. Files in `public/` are served from the
       root. */
    expect(OG_CARD.url).toBe("https://www.spideryarn.com/og-card.png");
    expect(existsSync(path.join(ROOT, "public", "og-card.png"))).toBe(true);
    expect(OG_CARD.url.startsWith("https://")).toBe(true);
  });
});

describe("the default head, for every page that is not a shared article", () => {
  it("names the same picture as a shared article's head, with the same size", () => {
    expect(content('meta[property="og:image"]')).toBe(OG_CARD.url);
    expect(content('meta[name="twitter:image"]')).toBe(OG_CARD.url);
    expect(content('meta[property="og:image:width"]')).toBe(String(OG_CARD.width));
    expect(content('meta[property="og:image:height"]')).toBe(String(OG_CARD.height));
    expect(content('meta[name="twitter:card"]')).toBe("summary_large_image");
  });

  it("says what the homepage's tab says", () => {
    const title = `${APP_NAME} · ${TAGLINE}`;
    expect(content('meta[property="og:title"]')).toBe(title);
    expect(content('meta[name="twitter:title"]')).toBe(title);
    expect(content('meta[property="og:site_name"]')).toBe(APP_NAME);
    expect(content('meta[property="og:type"]')).toBe("website");
    expect(content('meta[property="og:description"]')).toBe(content('meta[name="description"]'));
    expect(content('meta[name="twitter:description"]')).toBe(content('meta[name="description"]'));
  });

  /* One static head is served at every path, so an address in it would be
     wrong for most of them — and `og:url` is how `articleWaitTitle` and
     scripts/check-public-shell.ts tell a composed head from this one. */
  it("carries no og:url and no canonical", () => {
    expect(shell.querySelector('meta[property="og:url"]')).toBeNull();
    expect(shell.querySelector('link[rel="canonical"]')).toBeNull();
  });

  /* Anything outside the sentinels survives onto a shared article's page, where
     it would be a second, wrong card beside the article's own. */
  it("keeps every card tag inside the managed region", () => {
    const start = SHELL.indexOf(MANAGED_HEAD_START);
    const end = SHELL.indexOf(MANAGED_HEAD_END);
    const outside = SHELL.slice(0, start) + SHELL.slice(end);
    expect(outside).not.toMatch(/<meta\s+(property|name)="(og|twitter):/);
  });

  it("still tells crawlers to stay away", () => {
    expect(content('meta[name="robots"]')).toBe("noindex, nofollow");
  });
});
