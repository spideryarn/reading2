/**
 * **Reading a PDF must not need the native canvas binary.**
 *
 * This is the guard for the bug that took the whole API down on 2026-08-27 and
 * then, after that fix, quietly took only PDFs down until 2026-08-30 — see
 * docs/postmortems/pdfjs-dommatrix-serverless.md and the note above
 * `ensureDomMatrix` in src/pdf.ts.
 *
 * pdf.js needs a `DOMMatrix`, which Node does not have. It tries to borrow one
 * from `@napi-rs/canvas`, an optional platform-specific package, with a
 * `require` inside a try/catch. Vercel's tracer cannot read a require it never
 * evaluates, so the package is left out of the function bundle — and pdf.js
 * responds to the miss with a *warning*, then dies four hundred lines later on
 * `new DOMMatrix()` at module scope. Green build, green deploy, dead feature.
 *
 * **The postmortem said no local test could ever have caught it**, because this
 * laptop has `@napi-rs/canvas-darwin-arm64` sitting in node_modules and the
 * same bundle that dies in production imports cleanly here. That was true of
 * the tests as written, and it is not true in principle: the package can be
 * hidden from Node's resolver, which is precisely the state the deployed
 * bundle is in. That is what tests/helpers/pass0-without-canvas.ts does.
 *
 * It has to be a child process. pdf.js's module body runs once per process, and
 * what is under test is what happens during that one evaluation — by the time
 * this file has imported anything, the question has already been answered.
 *
 * Run it against src/pdf.ts before the fix and it fails with the production
 * stack, verbatim:
 *
 *     ReferenceError: DOMMatrix is not defined
 *       at .../pdfjs-dist/legacy/build/pdf.mjs:16713:22
 *       at async pass0 (.../src/pdf.ts:286:17)
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "tests/helpers/pass0-without-canvas.ts");

/**
 * The measured pdf.js baseline for `evals/pdf/easy/source.pdf`, copied from
 * evals/pdf/README.md where it was recorded *with* the native binary present.
 *
 * Matching it is the half of this test that stops a hollow pass. Handing pdf.js
 * a `DOMMatrix` that merely satisfies `new DOMMatrix()` would let the import
 * through and could still read the page wrongly; a stub with no working
 * arithmetic would too. Identical page and word counts say the polyfill is the
 * real thing rather than a shape that gets past module evaluation.
 */
const BASELINE = { pages: 8, words: 3522 };

describe("pass 0, with @napi-rs/canvas hidden from the resolver", () => {
  it("reads the PDF, and reads it the same as with the binary present", () => {
    /* tsx rather than vitest's own transform: this must be a clean process
       whose module registry nothing has touched. 60s because a cold tsx start
       plus pdf.js is slow on a loaded machine; the work itself is ~0.4s. */
    const out = execFileSync("npx", ["tsx", SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      /* stderr is inherited so that a failure shows the real stack in the test
         output rather than an exit code. pdf.js also warns about Path2D on
         stdout's sibling every run, which is expected and explained in
         src/pdf.ts. */
      stdio: ["ignore", "pipe", "inherit"],
    });

    const result = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
      pages?: number;
      words?: number;
      firstPageStartsWith?: string;
    };

    expect(result.pages).toBe(BASELINE.pages);
    expect(result.words).toBe(BASELINE.words);
    /* And that it is this document, not eight blank pages that happen to
       count right. */
    expect(result.firstPageStartsWith).toContain("Coolabah");
  }, 70_000);
});
