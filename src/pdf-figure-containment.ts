/**
 * **Is everything PDFium drew inside what the locator measured?** — the check
 * that sits between the render and the raster being accepted (GPT Sol F35,
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md § F33's fix, checked
 * narrowly).
 *
 * pdf.js is what the locator measures a page with, and pdf.js can skip paint —
 * forgiving by design, and, at an operator-list chunk boundary, even when asked
 * to be strict — while PDFium, which draws the picture, does not. Two pdf.js
 * reads cannot see what pdf.js itself skipped, however they are compared; the
 * picture can. So after the render every non-white pixel must fall inside the
 * boxes the locator measured — each painted path's box grown by its stroke's
 * reach, each label's text box grown for ascenders and descenders — plus a
 * margin for anti-aliasing. One pixel outside refuses the figure.
 *
 * **A mask, not a search.** The allowed area is filled into a boolean bitmap
 * at the render's own resolution, box by box, and the pixels are then read
 * once: the cost is the bitmap plus the boxes' area, never pixels × boxes.
 *
 * What it cannot see, named in the plan: paint pdf.js skipped that lands
 * entirely inside a box it did measure.
 */

import type { PageBox } from "./pdf-figure-region.js";

/**
 * One area the picture may paint: a measured box, and how far past it paint
 * may legitimately reach, in points — a stroke's reach for a path, room for
 * ascenders and descenders for a line of text.
 */
export interface ContainmentBox {
  readonly box: PageBox;
  readonly allowance: number;
}

/**
 * The anti-aliasing margin, in pixels of the render. PDFium's anti-aliasing
 * lights at most the one pixel a geometric edge passes through, partially; the
 * render is placed at a page offset rounded to a whole pixel, which can move a
 * box by up to half a pixel against the mask's own arithmetic; and the mask's
 * edges are rounded outwards. Two pixels covers the first two with room, and at
 * the render's 3× scale it is two-thirds of a point — far less than any drawing
 * this route admits, so a foreign mark cannot hide in it.
 */
export const ANTIALIAS_MARGIN_PX = 2;

/** Where page points land in the render: `px = x·scale − offsetX`, `py = (pageHeight − y)·scale − offsetY`. */
export interface PixelFrame {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pageHeight: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The allowed area as one byte per pixel, `1` where paint may be. Each box is
 * grown by its allowance (points) when `withAllowance`, and by `marginPx`, and
 * rounded outwards to whole pixels.
 */
export function containmentMask(
  boxes: readonly ContainmentBox[],
  frame: PixelFrame,
  marginPx: number,
  withAllowance = true,
): Uint8Array {
  const mask = new Uint8Array(frame.width * frame.height);
  for (const { box, allowance } of boxes) {
    const grow = withAllowance ? allowance : 0;
    const left = clamp(Math.floor((box.x0 - grow) * frame.scale - frame.offsetX - marginPx), frame.width);
    const right = clamp(Math.ceil((box.x1 + grow) * frame.scale - frame.offsetX + marginPx), frame.width);
    const top = clamp(Math.floor((frame.pageHeight - box.y1 - grow) * frame.scale - frame.offsetY - marginPx), frame.height);
    const bottom = clamp(Math.ceil((frame.pageHeight - box.y0 + grow) * frame.scale - frame.offsetY + marginPx), frame.height);
    for (let y = top; y < bottom; y++) mask.fill(1, y * frame.width + left, y * frame.width + right);
  }
  return mask;
}

function clamp(value: number, limit: number): number {
  return Math.max(0, Math.min(limit, value));
}

/** What the render's non-white pixels did. */
export interface Containment {
  nonWhite: number;
  /** Outside every box, allowance and margin included. Anything here refuses the figure. */
  outside: number;
  /** Inside the padded area but outside the measured boxes themselves — how much the padding is doing. */
  inPadding: number;
}

/**
 * Read an RGB render against the measured boxes, once. A pixel is non-white
 * unless all three channels are exactly 255 — the blankness rule
 * src/pdf-figures.ts keeps, and for the same reason.
 */
export function measureContainment(rgb: Uint8Array, frame: PixelFrame, boxes: readonly ContainmentBox[]): Containment {
  const padded = containmentMask(boxes, frame, ANTIALIAS_MARGIN_PX);
  const bare = containmentMask(boxes, frame, 0, false);
  const result: Containment = { nonWhite: 0, outside: 0, inPadding: 0 };
  for (let pixel = 0, at = 0; pixel < padded.length; pixel++, at += 3) {
    if (rgb[at] === 255 && rgb[at + 1] === 255 && rgb[at + 2] === 255) continue;
    result.nonWhite += 1;
    if (!padded[pixel]) result.outside += 1;
    else if (!bare[pixel]) result.inPadding += 1;
  }
  return result;
}
