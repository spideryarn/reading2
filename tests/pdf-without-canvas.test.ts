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
 * **This proves the text path, and it does not prove the matrix arithmetic** —
 * a claim an earlier version of this comment made and GPT Sol falsified by
 * doing it: install `class {}` as `globalThis.DOMMatrix`, block the package,
 * and pass 0 still returns exactly `{"pages":8,"words":3522}`. Reproduced here
 * before believing it.
 *
 * The reason is that ordinary text extraction moves glyphs with plain array
 * transforms and never constructs a matrix. The one text-path route that does
 * real `DOMMatrix` arithmetic is Type 3 glyph mask compilation
 * (pdf.worker.mjs:23335, `new DOMMatrix().scaleSelf(...).translateSelf(...)`),
 * and this fixture has no Type 3 fonts, so nothing here reaches it.
 *
 * So the numbers are kept for what they honestly are — evidence the document
 * still reads identically, which is the regression that matters — and the
 * arithmetic is asserted directly in its own test below instead of being
 * inferred from a page count that cannot see it. A Type 3 fixture would close
 * the last of it; docs/plans/pdf-ingestion.md is where that belongs.
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

  it("hands pdf.js a DOMMatrix that can actually do the arithmetic", async () => {
    /* Direct, because the run above cannot see this: it passes with `class {}`.
       These are the exact operations pdf.js performs on the text path, when it
       compiles a Type 3 glyph mask — pdf.worker.mjs:23335 does
       `new DOMMatrix().scaleSelf(1 / width, -1 / height).translateSelf(0, -height)`
       and then reads a, b, c, d, e, f straight off the result. */
    const { DOMMatrix } = await import("@napi-rs/canvas/geometry.js");
    const m = new DOMMatrix() as unknown as {
      a: number;
      d: number;
      e: number;
      f: number;
      scaleSelf(x: number, y: number): typeof m;
      translateSelf(x: number, y: number): typeof m;
    };
    const out = m.scaleSelf(1 / 4, -1 / 8).translateSelf(0, -8);

    expect(out.a).toBe(0.25);
    expect(out.d).toBe(-0.125);
    /* The translate happens in the already-scaled space, so f is -8 × -1/8 = 1.
       An identity-only stub returns 0 here, and a stub with no methods at all
       throws — either way this test is the one that notices. */
    expect(out.f).toBe(1);
    expect(out.e).toBe(0);
  });
});
