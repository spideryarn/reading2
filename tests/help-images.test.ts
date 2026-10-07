/**
 * **Help's pictures: every file has an entry, every entry a file and a page,
 * and each is the size it says.** src/web/help/help-images.ts;
 * docs/plans/261007l-help-screenshots-and-gifs.md.
 *
 * The renderer (help-markdown.tsx) refuses a picture not in the manifest, and
 * tests/help-page.test.tsx draws every page, so a page naming a picture that
 * is not there is already red. This file checks the joins that nothing draws:
 *
 * - **a file with no entry, and an entry with no file.** Vite's `*.png` module
 *   type-checks whether or not the file exists (tests/landing-assets.test.ts
 *   tells that story), and an unlisted file is a picture nobody will retake;
 * - **the size**, against the file's own header: the `<img>` reserves half of
 *   `w` × `h`, and a wrong pair is a stretched picture, not just a jump;
 * - **the path in the page resolves from where the page's file is**, so the
 *   Markdown shows its pictures on GitHub too — the renderer only reads the
 *   name, so this is the only check that `../` is right;
 * - **every entry is used by a page.** A picture no page shows is one that
 *   goes stale without anybody noticing.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

import { HELP_IMAGES } from "../src/web/help/help-images.js";
import { imageSize } from "./helpers/image-size.js";

const PAGES = path.resolve(import.meta.dirname, "..", "src", "web", "help", "pages");
const IMAGES = path.join(PAGES, "images");

/** Help is read on phones; past these a picture wants a tighter crop or fewer frames. */
const MAX_BYTES = { png: 350_000, gif: 1_500_000 } as const;
/** Below this a "picture" is a placeholder (landing-assets.test.ts found four once). */
const MIN_BYTES = 2_000;
/** Help's column is 672 CSS px (HelpPage.tsx, `max-w-2xl`), drawn from 2× pixels. */
const MAX_WIDTH = 672 * 2;

interface Use {
  page: string;
  url: string;
}

function imagesIn(node: Nodes, out: string[]): string[] {
  if (node.type === "image") out.push(node.url);
  if ("children" in node) for (const child of node.children) imagesIn(child, out);
  return out;
}

/** Every picture line in every page, with the page's path under pages/. */
const uses: Use[] = globSync("**/*.md", { cwd: PAGES }).flatMap((page) =>
  imagesIn(fromMarkdown(readFileSync(path.join(PAGES, page), "utf8")), []).map((url) => ({ page, url })),
);

const onDisk = globSync("*", { cwd: IMAGES }).sort();
const entries = Object.entries(HELP_IMAGES);

describe("Help's pictures", () => {
  it("are there at all, and some page shows one", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(uses.length).toBeGreaterThan(0);
  });

  it("have an entry for every file in the folder, and a file for every entry", () => {
    const stills = entries.flatMap(([, i]) => (i.still === undefined ? [] : [i.still.file]));
    expect(onDisk).toEqual([...Object.keys(HELP_IMAGES), ...stills].sort());
  });

  it.each(entries)("%s is a GIF with a still the same size, or a PNG without one", (name, image) => {
    if (!name.endsWith(".gif")) {
      expect(name).toMatch(/\.png$/);
      expect(image.still).toBeUndefined();
      return;
    }
    if (image.still === undefined) throw new Error(`${name} has no still for reduced motion`);
    expect(image.still.file).toMatch(/\.png$/);
    expect(image.still.src.length).toBeGreaterThan(0);
    const still = imageSize(path.join(IMAGES, image.still.file));
    expect({ w: still.width, h: still.height }).toEqual({ w: image.w, h: image.h });
    /* More than one frame, or it is a PNG with extra steps. A frame is an
       image descriptor (0x2C) after a graphic control extension (0x21 0xF9 0x04);
       scripts/frames-to-gif.ts writes one per frame and merges repeats. */
    const bytes = readFileSync(path.join(IMAGES, name));
    let frames = 0;
    for (let i = 0; i + 8 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && bytes[i + 8] === 0x2c) frames++;
    }
    expect(frames, "frames").toBeGreaterThan(1);
  });

  it.each(entries)("%s is the size its entry says, at 2×, and not too heavy", (name, image) => {
    const { width, height, bytes } = imageSize(path.join(IMAGES, name));
    expect({ w: image.w, h: image.h }).toEqual({ w: width, h: height });
    /* A crop, but a real one: nothing in Help is smaller than the bottom bar,
       which is 19 CSS px tall and the thinnest picture there is. */
    expect(width).toBeGreaterThanOrEqual(240);
    expect(height).toBeGreaterThanOrEqual(32);
    /* Drawn at half: an odd pixel count would draw at a half pixel. */
    expect(width % 2, "width is even").toBe(0);
    expect(height % 2, "height is even").toBe(0);
    expect(width).toBeLessThanOrEqual(MAX_WIDTH);
    expect(bytes).toBeGreaterThan(MIN_BYTES);
    expect(bytes).toBeLessThanOrEqual(name.endsWith(".gif") ? MAX_BYTES.gif : MAX_BYTES.png);
    expect(image.src.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s says how to take it again", (_name, image) => {
    expect(image.shows.length).toBeGreaterThan(20);
    expect(image.article.length).toBeGreaterThan(0);
    expect(image.window).toMatch(/^\d+×\d+ at 2×/);
    expect(image.taken).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("are named in each page by a path that resolves from that page's own file", () => {
    for (const { page, url } of uses) {
      const resolved = path.resolve(PAGES, path.dirname(page), url);
      expect(path.dirname(resolved), `${page}: ${url}`).toBe(IMAGES);
      expect(Object.hasOwn(HELP_IMAGES, path.basename(resolved)), `${page}: ${url}`).toBe(true);
    }
  });

  it("are each shown by at least one page", () => {
    const shown = new Set(uses.map((u) => path.basename(u.url)));
    for (const name of Object.keys(HELP_IMAGES)) expect(shown.has(name), name).toBe(true);
  });
});
