/**
 * Runs pass 0 in a process where `@napi-rs/canvas` cannot be resolved — which
 * is the state the Vercel function bundle is actually in.
 *
 * Spawned by tests/pdf-without-canvas.test.ts. It has to be a separate process
 * because pdf.js's module body runs exactly once, and what this checks is what
 * happens *during* that one evaluation. By the time a test file has imported
 * anything, it is too late.
 *
 * Prints one line of JSON to stdout, or exits non-zero with the real error.
 */

import { createRequire } from "node:module";
import path from "node:path";

/**
 * Hide the canvas package from CommonJS resolution, the way the bundle does.
 *
 * pdf.js reaches for it with `createRequire(import.meta.url)` and a plain
 * `require("@napi-rs/canvas")` inside a try/catch, so patching the CJS
 * resolver is what a missing package looks like from where pdf.js is standing.
 *
 * **`geometry.js` is deliberately still reachable**, and that asymmetry is the
 * whole point rather than a convenience. Vercel's tracer bundles the files it
 * can statically read an import for. After the fix, `src/pdf.ts` names
 * `@napi-rs/canvas/geometry.js` in a literal specifier, so that one file is
 * traced and shipped; nothing names `index.js`, which needs the 26 MB native
 * binding, so it is not. Allowing the deep path and refusing the bare one is
 * therefore not a weakened test — it is the post-fix production filesystem.
 */
const require = createRequire(import.meta.url);
const Module = require("node:module") as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
  if (request.startsWith("@napi-rs/canvas") && !request.endsWith("geometry.js")) {
    throw Object.assign(new Error(`Cannot find module '${request}'`), { code: "MODULE_NOT_FOUND" });
  }
  return realResolve.call(this, request, ...rest);
};

async function main(): Promise<void> {
  /* Node has no DOMMatrix of its own, on any version we run. If that ever
     changes this script stops testing anything, so say so rather than pass. */
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix !== "undefined") {
    throw new Error(
      "globalThis.DOMMatrix already exists before pdf.js loads — this process " +
        "cannot reproduce the serverless case, and a pass here means nothing.",
    );
  }

  /* Imported here, after the resolver is patched, for the same reason this is
     a separate process at all. */
  const { pass0 } = await import("../../src/pdf.js");
  const fixture = path.resolve(import.meta.dirname, "../../evals/pdf/easy/source.pdf");
  const result = await pass0(fixture, {});

  process.stdout.write(
    `${JSON.stringify({
      pages: result.pages.length,
      words: result.pages.reduce((n, p) => n + p.words, 0),
      firstPageStartsWith: result.pages[0]?.text.slice(0, 40) ?? "",
    })}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
