/**
 * **Stage 2 loads temml itself, the way the built function can trace.**
 *
 * `canonicaliseMaths` converts a formula only if `texWouldDraw` says the reading
 * view would draw it. Its synchronous fallback, `createRequire(…)("temml")`,
 * works in any test because `node_modules` is there, and is **not** in the
 * built API function (measured 2026-09-24). A `runExtract` that forgot
 * `loadMathsRenderer()` would pass every other test and, in production, convert
 * nothing. This takes the fallback away, as production does.
 * docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md § Stage 3b.
 */
import { describe, expect, it, vi } from "vitest";

const temmlImports = vi.hoisted(() => vi.fn());

vi.mock("temml", async (importOriginal) => {
  temmlImports();
  return importOriginal<typeof import("temml")>();
});

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  const createRequire = (from: string | URL) => {
    const real = actual.createRequire(from);
    if (!String(from).includes("maths-server")) return real;
    return Object.assign((id: string) => {
      if (id === "temml") throw new Error("temml.cjs is not in the built function");
      return real(id);
    }, real);
  };
  return { ...actual, createRequire, default: { ...actual, createRequire } };
});

const { runExtract } = await import("../src/extract.js");

const para = (n: number) =>
  `<p>Paragraph ${n} is ordinary prose about a subject, long enough that Readability counts it as ` +
  `the article's own text rather than as furniture around it, and it says so at some length.</p>`;

describe("runExtract, with temml reachable only through its own loader", () => {
  it("loads temml only once a raw page might hold maths, then converts the formula", async () => {
    await runExtract({
      html:
        `<html><head><title>A page without a formula</title></head><body><article>` +
        `${para(1)}${para(2)}${para(3)}</article></body></html>`,
      url: "https://example.invalid/prose",
      slug: "prose",
    });
    expect(temmlImports).not.toHaveBeenCalled();

    const result = await runExtract({
      html:
        `<html><head><title>A page with a formula</title></head><body><article>${para(1)}` +
        `<p>The state <math alttext="h_{t}"><semantics><mi>h</mi>` +
        `<annotation encoding="application/x-tex">h_{t}</annotation></semantics></math> is kept.</p>` +
        `${para(2)}${para(3)}</article></body></html>`,
      url: "https://example.invalid/formula",
      slug: "formula",
    });
    expect(temmlImports).toHaveBeenCalledTimes(1);
    expect(result.extractedHtml).toContain(String.raw`\(h_{t}\)`);
  }, 30_000);
});
