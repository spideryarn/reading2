/**
 * src/pdf-figure-resources.ts — the pure walk that decides whether anything a
 * page paints is an image, or paint pdf.js cannot see (GPT Sol F34,
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md).
 *
 * Driven with plain-object trees rather than PDFs: the pdf-lib adapter that
 * builds the tree from a real file is exercised in tests/pdf-figure-page.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  type FontEntry,
  hasInlineImage,
  inspectPageTree,
  MAX_RESOURCE_DEPTH,
  type PaintedEntry,
  type ResourceNode,
  type XObjectEntry,
} from "../src/pdf-figure-resources.js";

const NUL = String.fromCharCode(0);

function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "latin1"));
}

function node(
  id: string,
  parts: {
    xobjects?: (() => XObjectEntry)[];
    patterns?: (() => PaintedEntry)[];
    fonts?: (() => FontEntry)[];
    softMasks?: (() => PaintedEntry)[];
  } = {},
): ResourceNode {
  return {
    id,
    xobjects: () => parts.xobjects ?? [],
    patterns: () => parts.patterns ?? [],
    fonts: () => parts.fonts ?? [],
    softMasks: () => parts.softMasks ?? [],
  };
}

function page(contents: string | null, resources?: ResourceNode) {
  return { contents: () => (contents === null ? null : bytes(contents)), resources: () => resources };
}

const form = (content: string | null, resources?: ResourceNode): XObjectEntry => ({
  kind: "form",
  content: () => (content === null ? null : bytes(content)),
  resources: () => resources,
});

describe("the inline-image token", () => {
  it("finds `BI` between PDF delimiters, NUL included, and nowhere else", () => {
    expect(hasInlineImage(bytes("q BI /W 2 /H 2 ID"))).toBe(true);
    expect(hasInlineImage(bytes(`q${NUL}BI${NUL}/W 2`))).toBe(true);
    expect(hasInlineImage(bytes("q /BIG Do BIRD"))).toBe(false);
  });

  it("treats content it could not read as holding one", () => {
    expect(hasInlineImage(null)).toBe(true);
  });
});

describe("the walk", () => {
  it("finds nothing on a page of plain content", () => {
    expect(inspectPageTree(page("0 0 m 10 10 l S", node("r")))).toEqual({
      imageInResources: false,
      unmeasuredPaint: false,
    });
  });

  it("finds an image XObject, and refuses one it cannot classify", () => {
    expect(inspectPageTree(page("", node("r", { xobjects: [() => ({ kind: "image" })] }))).imageInResources).toBe(true);
    expect(
      inspectPageTree(page("", node("r", { xobjects: [() => ({ kind: "unclassified" })] }))).imageInResources,
    ).toBe(true);
  });

  it("looks inside a form's content and its resources", () => {
    expect(inspectPageTree(page("", node("r", { xobjects: [() => form("0 0 m S")] }))).imageInResources).toBe(false);
    expect(inspectPageTree(page("", node("r", { xobjects: [() => form("BI /W 1 ID")] }))).imageInResources).toBe(
      true,
    );
    const inner = node("inner", { xobjects: [() => ({ kind: "image" })] });
    expect(inspectPageTree(page("", node("r", { xobjects: [() => form("", inner)] }))).imageInResources).toBe(true);
  });

  it("marks a Type 3 font unmeasured without calling it an image", () => {
    const type3: FontEntry = { kind: "type3", glyphs: () => [() => bytes("0 0 m S")], resources: () => undefined };
    expect(inspectPageTree(page("", node("r", { fonts: [() => type3] })))).toEqual({
      imageInResources: false,
      unmeasuredPaint: true,
    });
    expect(inspectPageTree(page("", node("r", { fonts: [() => ({ kind: "other" })] })))).toEqual({
      imageInResources: false,
      unmeasuredPaint: false,
    });
    expect(inspectPageTree(page("", node("r", { fonts: [() => ({ kind: "unclassified" })] }))).imageInResources).toBe(
      true,
    );
  });

  it("reads soft masks and patterns: none is nothing, unreadable is a doubt", () => {
    const none = node("r", { softMasks: [() => ({ kind: "none" })] });
    expect(inspectPageTree(page("", none)).imageInResources).toBe(false);
    const unreadable = node("r", { patterns: [() => ({ kind: "unreadable" })] });
    expect(inspectPageTree(page("", unreadable)).imageInResources).toBe(true);
    const painted: PaintedEntry = { kind: "painted", content: () => bytes("BI /W 1 ID"), resources: () => undefined };
    expect(inspectPageTree(page("", node("r", { softMasks: [() => painted] }))).imageInResources).toBe(true);
  });

  it("gives up past the depth bound, and walks a cycle once", () => {
    const chain = (length: number): ResourceNode =>
      length === 0 ? node("leaf") : node(`n${length}`, { xobjects: [() => form("", chain(length - 1))] });
    expect(inspectPageTree(page("", chain(3))).imageInResources).toBe(false);
    expect(inspectPageTree(page("", chain(MAX_RESOURCE_DEPTH + 2))).imageInResources).toBe(true);
    const cyclic: ResourceNode = node("self", { xobjects: [() => form("", cyclic)] });
    expect(inspectPageTree(page("", cyclic)).imageInResources).toBe(false);
  });

  it("answers at the first doubt and reads nothing after it", () => {
    const tree = node("r", {
      xobjects: [
        () => ({ kind: "image" }),
        () => {
          throw new Error("read past the first doubt");
        },
      ],
    });
    expect(inspectPageTree(page("", tree)).imageInResources).toBe(true);
    expect(inspectPageTree(page(null, tree)).imageInResources).toBe(true);
  });
});
