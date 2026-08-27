/**
 * **The landing page's screenshots exist, and are the shape it says they are.**
 *
 * Two failures, both of which are [silent-success](../docs/reusable/silent-success.md)
 * with a picture on it — the check you would naturally run comes back happy:
 *
 *  - **A missing file.** `vite/client` declares `*.jpg` as a wildcard module, so
 *    `import zoomShot from "./assets/zoom.jpg"` type-checks whether or not that
 *    file has ever existed. `npm run typecheck` is green, `npm test` is green,
 *    and the first thing anybody sees on the front door is a broken-image icon.
 *    Only `vite build` catches it, and nothing in the ordinary loop runs that.
 *    This is not hypothetical: while the page was being written, four 68-byte
 *    1×1 placeholders appeared in `assets/` and everything stayed green.
 *  - **The wrong shape.** Every `<img>` on that page carries `width`/`height`,
 *    and on a `width: 100%` image those attributes do exactly one thing: they
 *    reserve the right *aspect ratio* so the page does not jump as a large
 *    screenshot lands. Attributes that disagree with the file are worse than no
 *    attributes at all — the space is reserved, and then it is wrong. Nothing
 *    about that looks like a bug from the outside; it reads as jank.
 *
 * The second is the one that matters as more shots arrive. Capturing them is a
 * manual browser job, so the window is whatever size it happened to be that
 * day; this is what makes "same size as the others" a rule rather than a hope.
 *
 * So the test reads LandingPage.tsx itself rather than a list kept beside it. A
 * list would have to be updated by whoever adds the next screenshot, and the
 * whole point is that they will not.
 *
 * See src/web/LandingPage.tsx and docs/project/auth.md § The signed-out page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE = path.join(ROOT, "src", "web", "LandingPage.tsx");
const TAILWIND = path.join(ROOT, "src", "web", "tailwind.css");

const source = readFileSync(PAGE, "utf8");

/** Every `./assets/…` image the page imports, in the order it imports them. */
function importedShots(): string[] {
  return [...source.matchAll(/from "\.\/assets\/([\w.-]+\.(?:jpe?g|png))"/g)].map(
    (m) => m[1] as string,
  );
}

/**
 * The aspect ratio the page claims for its screenshots.
 *
 * Read out of the source rather than hard-coded here, because a constant copied
 * into a test is a constant that agrees with itself and with nothing else.
 */
function declaredRatio(): number {
  const w = /const SHOT_W = (\d+);/.exec(source);
  const h = /const SHOT_H = (\d+);/.exec(source);
  if (!w || !h) throw new Error("LandingPage.tsx no longer declares SHOT_W / SHOT_H");
  return Number(w[1]) / Number(h[1]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * An image's real width and height, from the file's own header.
 *
 * **JPEG as well as PNG, because the captures are JPEGs.** The browser tool
 * that takes these screenshots produces JPEG, and re-encoding one as a PNG
 * quadruples the bytes without recovering anything the JPEG already threw away.
 * A test that only understood PNG would therefore have quietly pushed the page
 * towards the larger file for the test's own convenience.
 *
 * PNG: eight bytes of signature, a chunk header, then width and height as
 * big-endian 32-bit integers at offsets 16 and 20.
 *
 * JPEG: a chain of marker segments. Walk it, and take the height and width out
 * of the first start-of-frame marker (0xC0–0xCF, excluding 0xC4, 0xC8 and 0xCC,
 * which are Huffman tables and arithmetic-coding conditioning rather than
 * frames). Anything else, skip by its own declared length.
 *
 * The signature is checked first in both cases: an HTML error page saved under
 * an image name would otherwise yield two plausible-looking numbers read out of
 * whatever bytes happened to sit at those offsets.
 */
function imageSize(file: string): { width: number; height: number; bytes: number } {
  const buf = readFileSync(file);
  const bytes = buf.length;

  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let at = 2;
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) throw new Error(`${file} is a malformed JPEG`);
      const marker = buf[at + 1] as number;
      const length = buf.readUInt16BE(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7), bytes };
      }
      at += 2 + length;
    }
    throw new Error(`${file} is a JPEG with no start-of-frame marker`);
  }

  throw new Error(`${file} is neither a PNG nor a JPEG`);
}

describe("the landing page's screenshots", () => {
  const shots = importedShots();

  /* The page has to show at least one, or the figure component and this whole
     file are dead weight nobody notices. It is not pinned to a list of four:
     three of the four planned captures were lost to an occluded browser window
     and are expected to arrive later. */
  it("imports at least one", () => {
    expect(shots.length).toBeGreaterThan(0);
  });

  it.each(shots)("%s exists, and is a real image with something in it", (name) => {
    const file = path.join(ROOT, "src", "web", "assets", name);
    const { width, height, bytes } = imageSize(file);
    expect(width).toBeGreaterThan(600);
    expect(height).toBeGreaterThan(400);
    /* A screenshot of a whole reading view is tens of kilobytes at the very
       least. A tiny file is a placeholder or a failed capture, and both of
       those load without complaint. */
    expect(bytes).toBeGreaterThan(20_000);
  });

  it.each(shots)("%s is the shape the page reserves space for", (name) => {
    const { width, height } = imageSize(path.join(ROOT, "src", "web", "assets", name));
    /* Precision 1 is ±0.05 on the ratio itself — a few percent. Enough slack
       for a capture that came back a handful of pixels off, nowhere near
       enough for a shot taken at a different window size. */
    expect(width / height).toBeCloseTo(declaredRatio(), 1);
  });
});

/**
 * **The rule that stops those `width`/`height` attributes warping the picture.**
 *
 * Found 2026-08-27: Greg said the landing page's screenshot looked "warped
 * somehow", and it was — stretched vertically by about 1.95x.
 *
 * `width` and `height` on an `<img>` are not only a note about aspect ratio.
 * The HTML spec maps them to CSS `width` and `height` *presentational hints*.
 * The page sizes its shots with `tw:w-full`, which overrides the width and
 * leaves the height at the attribute's 815px — so a 1245x815 capture was drawn
 * 640 CSS px wide and still 815 tall. Tailwind's preflight would have prevented
 * it with `img { height: auto }`; this app hand-writes its preflight (see the
 * foot of tailwind.css) and that rule was not in it.
 *
 * So the tests above and this one are two halves of one guarantee, and neither
 * is much use alone: they say the *file* is the shape the page claims, and this
 * says nothing in the page's own CSS will then draw it at a different one.
 *
 * A source check rather than a rendered one, which is honest about its limits:
 * it cannot prove the cascade resolves the way we think. What it does prevent
 * is somebody tidying tailwind.css, deleting a rule that looks like it belongs
 * to nothing, and shipping a warped front door with every test green.
 */
describe("the global image reset", () => {
  const css = readFileSync(TAILWIND, "utf8");

  it("gives every img `height: auto`, so a width utility cannot stretch it", () => {
    const block = /@layer base \{[^}]*\bimg\b[^{]*\{([^}]*)\}/.exec(css);
    expect(block, "tailwind.css no longer resets `img` in @layer base").not.toBeNull();
    expect(block?.[1]).toMatch(/height:\s*auto/);
  });
});
