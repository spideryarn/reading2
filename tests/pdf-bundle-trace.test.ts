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
  /* The three the API stopped importing at module scope on 2026-09-03, to keep
     them out of the cold start of a request that never uses them
     (src/jsdom-lazy.ts; the `await import` in `openPdfCuts`, src/pdf-read.ts; and
     `stripeClient()`, src/billing/stripe.ts). Each one is now reached through a
     specifier this tracer has to read for itself, and each is a production
     outage if it is missed — jsdom takes the public reading page down with it,
     because src/sanitize.ts is on that path. This is the only check that asks
     the tracer rather than reasoning about it, which is the whole point of the
     file: the trace collected the same 3,031 files before and after the change,
     and that comparison is what made it safe to make. */
  "node_modules/jsdom/lib/api.js",
  "node_modules/pdf-lib/cjs/index.js",
  "node_modules/stripe/esm/stripe.esm.node.js",
  /* PDFium, which draws a PDF figure that is vector art. The module is imported
     lazily, and the WASM is read by path — `createRequire(…).resolve(
     "@embedpdf/pdfium/pdfium.wasm")` in src/pdf-figure-render.ts — so both have
     to be seen by the tracer rather than assumed. A WASM that does not ship is
     not an outage: every drawn figure becomes `render-failed`, caption-only —
     which is exactly the silent shape this list exists to catch.
     docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md. */
  "node_modules/@embedpdf/pdfium/dist/index.js",
  "node_modules/@embedpdf/pdfium/dist/pdfium.wasm",
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
      /* `base: "/"`, and suffix matching rather than `fileList.has()`.
         `npm run deploy` runs the gates in a git worktree whose `node_modules`
         is a *symlink* back to the main tree (scripts/deploy.ts), and nft
         resolves symlinks to their realpath — which then lies outside a `base`
         of that worktree, so everything reached through it is dropped without
         a warning. Measured on 2026-08-31, one unchanged bundle traced 2472
         files against a real directory and 2 against the symlink. This test
         therefore could not pass in the gate from the day it was written, and
         `--force-gate=test` was the only way anybody deployed.

         Rooting `base` at `/` removes the question, because nothing can fall
         outside it. The only cost is that paths arrive absolute, so the names
         below are matched as path-anchored suffixes. Both arrangements now
         trace 2470 files and agree about all three. */
      const { fileList, warnings } = await nodeFileTrace([BUNDLE], { base: "/" });

      /* That failure read as "pdf.mjs is missing from the bundle" while it
         actually meant "the trace collected nothing at all", and those two want
         opposite responses. So this says which one it is before anything else
         gets the chance to mislead. */
      expect(
        fileList.size,
        "the trace collected almost nothing — that is a broken trace, not a missing file",
      ).toBeGreaterThan(100);

      /* Anchored at a path boundary, so a `.../not-node_modules/pdfjs-dist/…`
         cannot satisfy it. */
      const traced = (file: string): boolean =>
        [...fileList].some((p) => p === file || p.endsWith(`/${file}`));

      for (const file of MUST_SHIP) {
        /* Named one at a time so a failure says which file, rather than
           printing a set of several hundred and leaving you to diff it. */
        expect(traced(file), `${file} was not traced into the function`).toBe(true);
      }

      for (const file of MUST_NOT_SHIP) {
        expect(traced(file), `${file} should not be in the function`).toBe(false);
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
    /* **Ten minutes, because the trace really does take that long here.**
       120_000 until 2026-09-05, when this file was one of three red on `dev`
       and the only one whose failure was the clock rather than the code: run
       alone it still timed out, so it was not test-parallelism either.

       Measured rather than guessed. The same `nodeFileTrace` call, run outside
       vitest against the same `api-dist/vercel.js` on the box at load ~85,
       finished in **441s** and every assertion above held — all six MUST_SHIP
       files traced, both MUST_NOT absent, no `.node` binary, no unresolved
       warning. So every property this test checks passed, and the budget was
       the only thing that did not.

       **Why it is slower is not established here**, and the comment said so too
       confidently until GPT Sol pushed back, 2026-09-05: that is one timing,
       under load ~85, with no controlled run to compare against. Two candidates,
       and it may be both — the box was busy, and the trace has grown, from the
       2470 files the comments above record, to 3,031, to **4,413** on that run.
       The growth is worth someone's attention on its own; see
       docs/plans/260905a-three-reds-on-dev-after-the-deploy-sweep.md.

       This is a gate, so the cost is real: a slow `npm run check` gets slower.
       The alternative — narrowing `base` back off `/` — is the bug e1a3bff2
       fixed, and is not worth reopening to save minutes. */
    600_000,
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
