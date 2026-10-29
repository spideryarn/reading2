// @vitest-environment jsdom
/**
 * **A drawn band says so on `<html>`, and only inside a reader** —
 * src/web/band-root-flags.ts, plan 261029k § 1.2.
 *
 * `data-band-covers` stands in for `:root:has(:where(.reader.band-covers) .mode-band)`
 * and `data-band-fitted` for `:root:has(:where(.reader) .mode-band:is(.outln, .struct))`.
 * Held by `ModeSurface`, which draws every band but the fallback's (that one is
 * in tests/the-band-fallback-must-not-use-modesurface.test.tsx), so the flag is
 * true exactly while the element exists. `BandCoversContext` carries the
 * reader's `band-covers`; with no reader round the band it is `null`, as on
 * `/design`, and the selectors would not have matched there either.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BandCoversContext } from "../src/web/band-root-flags.js";
import { ModeSurface } from "../src/web/ModeSurface.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const has = (flag: string) => document.documentElement.hasAttribute(`data-${flag}`);
const band = (feature: string | undefined): ReactNode =>
  // biome-ignore lint/correctness/noChildrenProp: `children` is a required prop of ModeSurface, which createElement's variadic form does not type-check against (tests/the-band-fallback-must-not-use-modesurface.test.tsx says the same)
  createElement(ModeSurface, { label: "A band", feature, children: "the band" });
const inReader = (covers: boolean | null, child: ReactNode) =>
  act(() =>
    root.render(covers === null ? child : createElement(BandCoversContext.Provider, { value: covers }, child)),
  );

describe("ModeSurface's flags", () => {
  it("holds band-covers while drawn in a covering reader, and lets go when the band goes", () => {
    inReader(true, band("gloss"));
    expect(host.querySelector(".mode-band")).not.toBeNull();
    expect(has("band-covers")).toBe(true);
    expect(has("band-fitted")).toBe(false);
    inReader(true, null);
    expect(has("band-covers")).toBe(false);
  });

  it("does not hold band-covers beside the prose", () => {
    inReader(false, band("gloss"));
    expect(has("band-covers")).toBe(false);
  });

  it("drops band-covers when the reader stops covering, with the band still drawn", () => {
    inReader(true, band("srch"));
    expect(has("band-covers")).toBe(true);
    inReader(false, band("srch"));
    expect(has("band-covers")).toBe(false);
  });

  it.each(["struct", "outln", "outln outln-expanded"])("holds band-fitted for %s, covering or not", (feature) => {
    inReader(false, band(feature));
    expect(has("band-fitted")).toBe(true);
    inReader(true, band(feature));
    expect(has("band-fitted")).toBe(true);
    expect(has("band-covers")).toBe(true);
    inReader(true, band("gloss"));
    expect(has("band-fitted")).toBe(false);
  });

  it("holds neither outside a reader (/design)", () => {
    inReader(null, band("struct"));
    expect(host.querySelector(".mode-band.struct")).not.toBeNull();
    expect(has("band-covers")).toBe(false);
    expect(has("band-fitted")).toBe(false);
  });

  it("does not take the class `structure` or `outline-x` for a fitted band", () => {
    inReader(false, band("structure outline-x"));
    expect(has("band-fitted")).toBe(false);
  });
});
