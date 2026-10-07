/**
 * **The mark the controls bar is measured against** — a zero-height element
 * directly before `.controls`, so that scroll.ts § `watchBarStuck` can say
 * when the bar has reached the top of the window. Reader.tsx draws it only
 * while the bar holds the headings breadcrumb, which is the only bar that
 * reads the answer (crumbs.css § above the band).
 *
 * docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md
 */
import { useEffect, useRef } from "react";
import { watchBarStuck } from "./scroll.js";

export function BarStuckSentinel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? watchBarStuck(ref.current) : undefined), []);
  return <div ref={ref} className="bar-sentinel" aria-hidden="true" />;
}
