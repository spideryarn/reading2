/**
 * **The landing page's screenshots exist, and are the shape it says they are.**
 *
 * Two failures, both of which are [silent-success](../docs/reusable/silent-success.md)
 * with a picture on it — the check you would naturally run comes back happy:
 *
 *  - **A missing file.** `vite/client` declares `*.png` as a wildcard module, so
 *    `import zoomShot from "./assets/zoom.png"` type-checks whether or not that
 *    file has ever existed. `npm run typecheck` is green, `npm test` is green,
 *    and the first thing anybody sees on the front door is a broken-image icon.
 *    Only `vite build` catches it, and nothing in the ordinary loop runs that.
 *    This is not hypothetical: while the page was being written, four 68-byte
 *    1x1 placeholders appeared in `assets/` and everything stayed green.
 *  - **The wrong shape.** Every `<img>` on that page carries `width`/`height`,
 *    and on a `width: 100%` image those attributes do exactly one thing: they
 *    reserve the right *aspect ratio* so the page does not jump as a large
 *    screenshot lands. Attributes that disagree with the file are worse than no
 *    attributes at all — the space is reserved, and then it is wrong. Nothing
 *    about that looks like a bug from the outside; it reads as jank.
 *
 * **Per shot, not per page.** This file used to read one `SHOT_W`/`SHOT_H` pair
 * out of the page and hold every image to that one ratio, which was right while
 * every capture came from the same browser window on the same afternoon. Greg
 * replaced them on 2026-08-27 with four real screenshots — a wide hero, a
 * landscape card and two portraits — and a rule saying they must all be the same
 * shape would have had exactly one way out: crop good pictures to please a test.
 * So the page declares each shot's size next to the file it belongs to, in
 * `SHOTS`, and this reads that record. The guarantee is unchanged and is now
 * per-file: *the numbers the browser is told match the bytes it will receive.*
 *
 * The joins are what make that hold, so both are checked: every `./assets/…`
 * import must have a `SHOTS` entry (add a picture, forget its numbers, and the
 * page silently reserves nothing), and every entry must name a file that is
 * really there and really that size.
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

import { imageSize } from "./helpers/image-size.js";

const ROOT = path.resolve(import.meta.dirname, "..");
/* Since 2026-09-03 the record lives in shots.ts, shared by the landing page
   and the features page, and this reads that one file. Same guarantee. */
const PAGE = path.join(ROOT, "src", "web", "shots.ts");
const TAILWIND = path.join(ROOT, "src", "web", "tailwind.css");

const source = readFileSync(PAGE, "utf8");

/** Every `./assets/…` image the page imports, in the order it imports them. */
function importedShots(): string[] {
  return [...source.matchAll(/from "\.\/assets\/([\w.-]+\.(?:jpe?g|png))"/g)].map(
    (m) => m[1] as string,
  );
}

/**
 * Every entry in the page's `SHOTS` record: which file, and how big it says it is.
 *
 * Read out of the source rather than hard-coded here, because a constant copied
 * into a test is a constant that agrees with itself and with nothing else. The
 * three fields are matched in the order the page writes them, which is the one
 * thing this regex asks of whoever edits that record.
 */
function declaredShots(): { file: string; w: number; h: number }[] {
  const found = [
    ...source.matchAll(/file:\s*"([\w.-]+\.(?:jpe?g|png))",\s*w:\s*(\d+),\s*h:\s*(\d+)/g),
  ].map((m) => ({ file: m[1] as string, w: Number(m[2]), h: Number(m[3]) }));
  if (found.length === 0) throw new Error("shots.ts no longer declares any SHOTS");
  return found;
}

describe("the landing page's screenshots", () => {
  const shots = declaredShots();

  /* The page has to show at least one, or the figure component and this whole
     file are dead weight nobody notices. Not pinned to a count: shots get added
     and dropped as the page is rewritten, and a number here would only ever be
     updated by deleting it. */
  it("declares at least one", () => {
    expect(shots.length).toBeGreaterThan(0);
  });

  /* The two halves of the record have to agree, in both directions. An import
     with no entry is a picture drawn with no reserved space; an entry with no
     import is a file Vite never hashes, so nothing on the page points at it. */
  it("declares exactly the files it imports", () => {
    expect(new Set(shots.map((s) => s.file))).toEqual(new Set(importedShots()));
  });

  it.each(shots.map((s) => s.file))("%s exists, and is a real image with something in it", (name) => {
    const file = path.join(ROOT, "src", "web", "assets", name);
    const { width, height, bytes } = imageSize(file);
    expect(width).toBeGreaterThan(600);
    expect(height).toBeGreaterThan(400);
    /* A screenshot of a reading view is tens of kilobytes at the very least. A
       tiny file is a placeholder or a failed capture, and both of those load
       without complaint. */
    expect(bytes).toBeGreaterThan(20_000);
  });

  it.each(shots)("$file is exactly the size the page reserves space for", ({ file, w, h }) => {
    const real = imageSize(path.join(ROOT, "src", "web", "assets", file));
    /* Exact, not close. These numbers are read straight off the file by
       whoever adds it, so there is no capture jitter to forgive — and the
       failure they guard against (a shot swapped for one of another shape) is
       a few percent of ratio, which any tolerance worth the name would let
       through. */
    expect({ w: real.width, h: real.height }).toEqual({ w, h });
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
