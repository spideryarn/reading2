/**
 * **Every preview page imports the entry stylesheet, and only that.**
 *
 * A `preview-*.tsx` is a throwaway page whose whole purpose is to mount a real
 * component outside the auth gate so a browser agent can look at it. It is
 * therefore the one kind of page where getting the stylesheet wrong is not a
 * cosmetic problem: the screenshot *is* the deliverable, and a preview that
 * styles itself differently from production is a picture of a page that does
 * not exist.
 *
 * There are two ways to get it wrong and this app has had both, at once, for
 * months:
 *
 *  - **Import nothing.** `preview-composer.tsx` had no stylesheet at all on
 *    2026-08-31, mounted the real composer, and rendered it as browser
 *    defaults: `display: block` instead of a flex row. Every measurement taken
 *    off it was internally consistent and wrong, and it was built to answer a
 *    question about whether a row fits.
 *  - **Import both.** The fix recorded for the above was `import "./styles.css"`
 *    followed by `import "./tailwind.css"`, which is what
 *    [`tailwind.css`](../src/web/tailwind.css)'s own header and `main.tsx`'s
 *    comment both warn against in as many words: `tailwind.css` pulls
 *    `styles.css` in inside `@layer app`, so importing the two side by side
 *    leaves the second copy **unlayered**, where it outranks every Tailwind
 *    utility. Eight of the ten preview pages did this on 2026-09-04. Measured
 *    on `preview-sharing.tsx`: with the pair, its chips came out in a different
 *    face at a different size and a row wrapped where production does not.
 *
 * So the rule is exactly `main.tsx`'s: **`./tailwind.css`, alone.** This test is
 * cheap, it is a source scan, and it is the only thing standing between the
 * next preview page and one of the two mistakes every existing one had made.
 *
 * docs/project/browser-testing.md § A preview page that never imported the
 * stylesheet.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = new URL("../src/web/", import.meta.url).pathname;

/** The one stylesheet a client entry point is allowed to import. */
const ENTRY = "./tailwind.css";
/** The one it must never import directly — see the header. */
const LAYERED = "./styles.css";

async function previewPages(): Promise<string[]> {
  const names = await readdir(WEB);
  const pages = names.filter((n) => n.startsWith("preview-") && n.endsWith(".tsx"));
  /* An empty sweep would pass this whole file vacuously, which is the shape of
     silent success it exists to catch — so the sweep itself is asserted. */
  expect(pages.length, "no preview-*.tsx found; has the naming changed?").toBeGreaterThan(0);
  return pages;
}

describe("the preview pages", () => {
  it("import the entry stylesheet, so they are styled at all", async () => {
    const naked: string[] = [];
    for (const name of await previewPages()) {
      const src = await readFile(join(WEB, name), "utf8");
      if (!src.includes(`import "${ENTRY}"`)) naked.push(name);
    }
    expect(
      naked,
      `these mount real components with no stylesheet, so they render as browser ` +
        `defaults and every measurement taken off them is a fact about \`display: block\``,
    ).toEqual([]);
  });

  it("do not import styles.css directly, which would invert the cascade", async () => {
    const doubled: string[] = [];
    for (const name of await previewPages()) {
      const src = await readFile(join(WEB, name), "utf8");
      /* The import statement, not the word: several of these files now carry a
         comment explaining why they do not import it, and a substring check
         would match the explanation. That is not hypothetical — it is exactly
         how tests/linky-is-scoped.test.ts passed against the bug it was written
         for, on 2026-09-04. */
      if (new RegExp(`^import "${LAYERED.replace(".", "\\.")}";`, "m").test(src)) {
        doubled.push(name);
      }
    }
    expect(
      doubled,
      `these import styles.css beside tailwind.css, which leaves it unlayered and ` +
        `outranking every Tailwind utility — so the preview does not match production`,
    ).toEqual([]);
  });
});
