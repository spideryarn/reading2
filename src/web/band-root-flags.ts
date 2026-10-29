/**
 * **What a drawn mode band says on `<html>`**: `band-covers` while a
 * `.mode-band` stands inside a `.reader.band-covers`, and `band-fitted` while
 * the band is Outline's or Structure's (root-flags.ts).
 *
 * They were `:root:has(:where(.reader.band-covers) .mode-band)` and
 * `:root:has(:where(.reader) .mode-band:is(.outln, .struct))` in shell.css and
 * narrow-window.css until 2026-10-29 (plan 261029k § 1.2). Said by the
 * elements' own renderers — `ModeSurface` and `FeatureBoundary`'s hand-written
 * fallback, the only two places a band is drawn in the reader — so the flag is
 * true exactly while such an element exists, whichever arm of `Reader`'s
 * switch drew it or declined to.
 *
 * `.band-covers` is `Reader`'s, from `fit.modeW === 0`, and reaches the band
 * through `BandCoversContext`. **Outside a `Reader` the context is `null` and
 * neither flag is held**, which is what the selectors said: `/design` draws a
 * real band with no `.reader` round it.
 */
import { createContext, useContext } from "react";
import { useRootFlag } from "./root-flags.js";

/** `true` where `Reader` writes `band-covers` on `.reader`; `false` inside a reader without it; `null` outside one. */
export const BandCoversContext = createContext<boolean | null>(null);

/** `feature` is the band's hook classes as `ModeSurface` takes them: `"struct"`, `"outln outln-expanded"`. */
export function useBandRootFlags(feature: string | undefined): void {
  const covers = useContext(BandCoversContext);
  const classes = feature?.split(/\s+/) ?? [];
  useRootFlag("band-covers", covers === true);
  useRootFlag("band-fitted", covers !== null && (classes.includes("outln") || classes.includes("struct")));
}

/** The same, for a band drawn without `ModeSurface` (`FeatureBoundary`'s fallback). Renders nothing. */
export function BandRootFlags({ feature }: { feature?: string | undefined }): null {
  useBandRootFlags(feature);
  return null;
}
