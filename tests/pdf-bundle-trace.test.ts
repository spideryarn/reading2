/**
 * **What Vercel will actually put in the function, asked of Vercel's own tracer.**
 *
 * Two production outages came from the same place: a specifier `@vercel/nft`
 * could not read, so a file pdf.js needs at runtime was left out of the bundle
 * while pdf.js itself was put in. First `@napi-rs/canvas`, `require`d inside a
 * try/catch (2026-08-27, every route down). Then `pdf.worker.mjs`, imported
 * through a *variable* — which was still broken after the first fix and was
 * found by review rather than by anything running, because the first bug threw
 * at module scope before pdf.js ever got as far as wanting a worker.
 * docs/postmortems/260827a-pdfjs-dommatrix-serverless.md.
 *
 * Every other test in this repo runs where `node_modules` is complete, so every
 * other test is blind to this by construction. The build is green, the deploy
 * says Ready, and the file is missing. This runs the real tracer over the real
 * built artefact and asks what it collected — the one check here that is not
 * another opinion about what the tracer probably does.
 *
 * **It is a build-output test, so it needs a current build.** If `api-dist/`
 * is missing it says so and skips, rather than passing while checking nothing.
 * `npm run build && npx vite build --config vite.api.config.ts` is what makes it
 * run; `npm run deploy` does both.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { nodeFileTrace } from "@vercel/nft";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUNDLE = path.join(ROOT, "api-dist/vercel.js");

/**
 * Files pdf.js reaches for at runtime through a specifier the tracer cannot
 * read, and which therefore have to be pulled in by a literal import of ours.
 * Each one is a production outage if it is absent. See `loadPdfjs()` in
 * src/pdf.ts for the two literal imports that put them here.
 */
const MUST_SHIP = [
  "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "node_modules/@napi-rs/canvas/geometry.js",
];

/**
 * The 26 MB of native binding we are deliberately *not* shipping. `DOMMatrix`
 * comes from `geometry.js`, which is plain JavaScript; only `index.js` needs
 * these. If one appears, some import started naming the package rather than the
 * one file inside it, and the function grew a platform-specific binary.
 */
const MUST_NOT_SHIP = [
  "node_modules/@napi-rs/canvas/index.js",
  "node_modules/@napi-rs/canvas/js-binding.js",
];

describe("what @vercel/nft collects for the API function", () => {
  const built = existsSync(BUNDLE);

  it.skipIf(!built)(
    "ships every file pdf.js loads through an untraceable specifier",
    async () => {
      const { fileList, warnings } = await nodeFileTrace([BUNDLE], { base: ROOT });

      for (const file of MUST_SHIP) {
        /* Named one at a time so a failure says which file, rather than
           printing a set of several hundred and leaving you to diff it. */
        expect(fileList.has(file), `${file} was not traced into the function`).toBe(true);
      }

      for (const file of MUST_NOT_SHIP) {
        expect(fileList.has(file), `${file} should not be in the function`).toBe(false);
      }

      /* No platform-specific binary, by extension rather than by name — the
         napi packages are one per platform and listing them would rot. */
      const native = [...fileList].filter((f) => f.endsWith(".node"));
      expect(native, "a native binary reached the function bundle").toEqual([]);

      /* A warning that nft could not *resolve* something is the signal that
         went unread for seven hours in the first outage, so fail on one.
         "Failed to parse X as script" is not that: nft tries script then
         module, and says so about every .mjs it goes on to trace perfectly
         well — both pdf.js files draw one and both are asserted present above.
         Matching on the message rather than the filename is what separates
         them. */
      const unresolved = [...warnings]
        .map(String)
        .filter((w) => !w.includes("Failed to parse"))
        .filter((w) => /pdf\.worker|@napi-rs\/canvas|pdfjs-dist/.test(w));
      expect(unresolved, "nft could not resolve something pdf.js needs").toEqual([]);
    },
    120_000,
  );

  it("has a build to inspect", () => {
    /* Separate, and deliberately not skipped: if api-dist/ is missing, the test
       above quietly checks nothing, and a silent skip is how a guard stops
       being a guard. This one fails loudly instead of pretending. */
    expect(
      built,
      "api-dist/vercel.js is missing — run `npx vite build --config vite.api.config.ts` " +
        "(after `npm run build`). Without it the trace assertions above are skipped.",
    ).toBe(true);
  });
});
