// @vitest-environment jsdom
/**
 * **The reading view lays out for the layout viewport, not the visual one.**
 *
 * On iPad Safari `window.innerWidth` is the *visual* viewport — it shrinks
 * when the page is zoomed in — while every media query and the root's
 * `clientWidth` are the *layout* viewport, which zoom does not touch. A zoom
 * survives a rotation and a later zoom change fires no window `resize`, so a
 * rotation taken zoomed in used to store a width two-thirds of the real one,
 * and Structure drew its narrow face on a landscape iPad until something else
 * resized the window. SPIDERYARN-READING2-33/-34;
 * docs/plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md.
 *
 * jsdom lays nothing out, so both widths are stubbed: `innerWidth` on the
 * window and `clientWidth` on `<html>`. What this proves is which number the
 * hook believes when the two disagree, not what an iPad reports — that is the
 * `?probe=1` trace's job.
 */
import { globSync, readFileSync } from "node:fs";
import { parse as babelParse } from "@babel/parser";
import { isReferenced, type Node } from "@babel/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWindowWidth } from "../src/web/reader/measure.js";

/**
 * **The files that may read `innerWidth` raw, and why each wants the browser's
 * own answer rather than the layout width.** Anything else in `src/web` that
 * reads it is a layout decision taken in the wrong viewport on an iPad.
 *
 * Width only: the `innerHeight` reads in the client want the *visible* height —
 * the browser chrome, the focus line, the scroll position — and are right to.
 * GPT Sol, reviewing the plan, F1.
 */
const RAW_INNER_WIDTH_ALLOWED: Record<string, { count: number; reason: string }> = {
  "src/web/reader/measure.ts": { count: 1, reason: "the one definition, `layoutViewportWidth`" },
  "src/web/ViewportProbe.tsx": {
    count: 1,
    reason: "an instrument recording what the browser says",
  },
  "src/web/feedback-diagnostics.ts": {
    count: 1,
    reason: "a report recording what the browser says",
  },
  "src/web/SmallScreenHint.tsx": {
    count: 1,
    reason: "a ratio of innerWidth to innerHeight, which zoom scales together (Sol F3)",
  },
  "src/web/OutlinePanel.tsx": {
    count: 1,
    reason:
      "paired with getBoundingClientRect, whose coordinate space under iOS zoom is itself a WebKit bug (Sol F2)",
  },
};

/** Visit syntax nodes, but not comments or string contents. */
function walk(node: unknown, parent: Node | null, visit: (node: Node, parent: Node | null) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent, visit);
    return;
  }
  if (!("type" in node) || typeof node.type !== "string") return;
  const syntaxNode = node as Node;
  visit(syntaxNode, parent);
  for (const child of Object.values(syntaxNode)) walk(child, syntaxNode, visit);
}

function namesInnerWidth(node: Node): boolean {
  return (
    (node.type === "Identifier" && node.name === "innerWidth") ||
    (node.type === "StringLiteral" && node.value === "innerWidth")
  );
}

function innerWidthReadCount(source: string): number {
  const ast = babelParse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "decorators-legacy"],
  });
  const positions = new Set<number>();
  const record = (node: Node) => {
    if (typeof node.start !== "number") throw new Error("innerWidth syntax node has no position");
    positions.add(node.start);
  };
  walk(ast, null, (node, parent) => {
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      if (namesInnerWidth(node.property)) record(node.property);
      return;
    }

    if (node.type === "ObjectPattern") {
      for (const property of node.properties) {
        if (
          property.type === "ObjectProperty" &&
          namesInnerWidth(property.key)
        ) {
          record(property.key);
        }
      }
      return;
    }

    if (
      node.type === "Identifier" &&
      node.name === "innerWidth" &&
      parent !== null &&
      isReferenced(node, parent)
    ) {
      record(node);
    }
  });
  return positions.size;
}

describe("raw innerWidth in the client", () => {
  it("is read only where the browser's own answer is wanted", () => {
    const files = globSync("src/web/**/*.{ts,tsx}").filter((f) => !f.endsWith(".d.ts"));
    // A glob that found nothing would pass this for ever.
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter(
      (file) =>
        !(file in RAW_INNER_WIDTH_ALLOWED) &&
        innerWidthReadCount(readFileSync(file, "utf8")) > 0,
    );
    expect(offenders, "use layoutViewportWidth() from src/web/reader/measure.ts").toEqual([]);
  });

  it("pins every reviewed read in an allowed file", () => {
    const changed = Object.entries(RAW_INNER_WIDTH_ALLOWED).flatMap(([file, allowed]) => {
      const actual = innerWidthReadCount(readFileSync(file, "utf8"));
      return actual === allowed.count ? [] : [`${file}: expected ${allowed.count}, found ${actual}`];
    });
    expect(changed, "review each added or removed raw read, then update its count").toEqual([]);
    expect(Object.values(RAW_INNER_WIDTH_ALLOWED).every(({ reason }) => reason.trim() !== "")).toBe(
      true,
    );
  });

  it("recognises reads without mistaking comments or string contents for code", () => {
    for (const source of [
      "window.innerWidth",
      "globalThis.innerWidth",
      "self.innerWidth",
      "const { innerWidth } = window",
      'window["innerWidth"]',
      'const marker = "/*"; window.innerWidth; const end = "*/"',
    ]) {
      expect(innerWidthReadCount(source), source).toBe(1);
    }

    expect(innerWidthReadCount("window.innerWidth; self.innerWidth")).toBe(2);

    for (const source of [
      "// window.innerWidth",
      "/* window.innerWidth */",
      'const label = "innerWidth"',
      'const url = "https://example.test/innerWidth"',
      "const label = `innerWidth`",
    ]) {
      expect(innerWidthReadCount(source), source).toBe(0);
    }
  });
});

function setWidths(inner: number, client: number): void {
  Object.defineProperty(window, "innerWidth", { value: inner, configurable: true });
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: client,
    configurable: true,
  });
}

let seen: number[] = [];
function Probe() {
  seen.push(useWindowWidth());
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  seen = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  /* Put jsdom's own answers back: `innerWidth` 1024, `clientWidth` 0. */
  setWidths(1024, 0);
});

describe("useWindowWidth under zoom", () => {
  it("lays out for the layout width when a zoomed-in rotation shrinks innerWidth", () => {
    // Portrait iPad at scale 1: the two agree.
    setWidths(820, 820);
    act(() => root.render(<Probe />));
    expect(seen.at(-1)).toBe(820);

    // Rotated to landscape while zoomed ×1.5: the visual viewport is 1180 / 1.5.
    setWidths(787, 1180);
    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
      window.dispatchEvent(new Event("resize"));
    });
    expect(seen.at(-1)).toBe(1180);
  });

  it("keeps innerWidth where it is the wider one — a desktop's classic scrollbar", () => {
    // `@media (max-width)` includes the scrollbar, and so does innerWidth.
    setWidths(1280, 1265);
    act(() => root.render(<Probe />));
    expect(seen.at(-1)).toBe(1280);
  });
});
