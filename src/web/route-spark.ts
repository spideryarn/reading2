/**
 * **The route as a sparkline** — the geometry of the small line in
 * Trajectory's head that replaced "Stop k of N". Greg, SPIDERYARN-READING2-5C:
 * *"a kind of sparkline that shows how we are going to move through the
 * position of the document … if there were little sort of dots along the way,
 * that would give us a clear indication of how many steps and how far through
 * the steps we are."*
 *
 * One dot per stop of the pass, left to right in walking order, each at its
 * height in the article — top the start, bottom the end, the axis each row's
 * position mark uses. A stop with no position (its quote has gone) gets no dot
 * and breaks the line rather than being drawn at an invented height (Sol, plan
 * 260929f F7). Pure; the panel draws it.
 */

export interface SparkBox {
  width: number;
  height: number;
  /** Room kept at every edge, so a dot on the edge is whole. */
  pad: number;
}

export interface SparkDot {
  index: number;
  x: number;
  y: number;
}

/** How wide the line is for `n` stops: six pixels a stop, within bounds that leave the depth buttons room on the row. */
export function sparkWidth(n: number): number {
  return Math.max(40, Math.min(72, n * 6));
}

/**
 * The dots, and the line's runs between them — one polyline per run of stops
 * that all have positions. `positions` are 0–1, or `null`.
 */
export function sparkline(
  positions: readonly (number | null)[],
  box: SparkBox,
): { dots: SparkDot[]; runs: string[] } {
  const n = positions.length;
  const inner = box.width - 2 * box.pad;
  const xOf = (i: number) => (n <= 1 ? box.width / 2 : box.pad + (i * inner) / (n - 1));
  const yOf = (at: number) => box.pad + Math.min(1, Math.max(0, at)) * (box.height - 2 * box.pad);
  const dots: SparkDot[] = [];
  const runs: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length > 1) runs.push(run.join(" "));
    run = [];
  };
  for (const [index, at] of positions.entries()) {
    if (at === null) {
      close();
      continue;
    }
    const dot = { index, x: round(xOf(index)), y: round(yOf(at)) };
    dots.push(dot);
    run.push(`${dot.x},${dot.y}`);
  }
  close();
  return { dots, runs };
}

const round = (v: number) => Math.round(v * 10) / 10;
