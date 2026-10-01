/**
 * **The band's block links to the paragraphs on screen, lit** — one style
 * element, for every mode at once.
 *
 * > In Summary and Tweet-threads mode (and a bunch of others), we include
 * > block-links. In such modes, highlight any block-links whose blocks are
 * > currently visible on the screen. Ideally do this with reusable machinery.
 * >
 * > — Greg, 2026-10-01 (SPIDERYARN-READING2-8K)
 *
 * The rule is `onScreenLinkCss` (on-screen.ts), keyed on the `data-block-link`
 * every block link carries, so no panel changes and no link re-renders: the
 * same shape as `ReadingTimeStyle`. The sampler is `useColumnContext`'s: one
 * rAF on scroll and resize, every rect read before the one state write, a
 * `ResizeObserver` on the table for a reflow under a still page, and
 * `layoutKey` for a mode switch that rewraps the prose.
 *
 * `enabled` is Reader's "a band and the prose are both painted" — off with no
 * band, and off when the band lies over the prose or has stepped aside, where
 * there would be nothing to light and every frame of a scroll would still pay
 * for the rect reads. docs/plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md.
 */
import { memo, useEffect, useState } from "react";
import { onScreenIds, onScreenLinkCss, rowCache, rowsOnScreen } from "./on-screen.js";
import { dockOffset, stickyOffset } from "./scroll.js";

interface Props {
  enabled: boolean;
  /** Re-measure when the layout changes — Reader's key, as the other samplers use it. */
  layoutKey: string;
}

function OnScreenLinksStyleInner({ enabled, layoutKey }: Props) {
  /* The sorted ids, joined: an unchanged screenful is an equal string and no render. */
  const [key, setKey] = useState("");

  // `layoutKey` is a re-run trigger, not a value the effect reads — useColumnContext.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useEffect(() => {
    if (!enabled) {
      setKey("");
      return;
    }
    const rows = rowCache();
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = stickyOffset();
      const bottom = window.innerHeight - dockOffset();
      setKey(onScreenIds(rowsOnScreen(rows(Date.now()), top, bottom), top, bottom).join(" "));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const table = document.querySelector<HTMLElement>("table.zoom");
    const ro = table && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (table && ro) ro.observe(table);
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, layoutKey]);

  const css = key === "" ? "" : onScreenLinkCss(key.split(" "));
  return css ? <style data-on-screen-links="">{css}</style> : null;
}

export const OnScreenLinksStyle = memo(OnScreenLinksStyleInner);
