/** Freshness for rendered images, where exact bytes are the wrong question.
 * Skia antialiases vector paths and text a level or two differently on
 * Greg's Mac and on the Linux box, so a byte-equal check written on one is
 * red on the other (docs/postmortems/261024f). We compare decoded,
 * premultiplied pixels instead: on 2026-10-24 cross-machine drift was at most
 * 2 levels per channel, and the smallest real source edit measured (blue +8)
 * moved 9. Do not raise the tolerance to make a changed image pass. */
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const RASTER_TOLERANCE = 3;

async function rgba(bytes: Buffer): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  try {
    const image = await loadImage(bytes);
    const ctx = createCanvas(image.width, image.height).getContext("2d");
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
  } catch {
    return null;
  }
}

/** True when both decode to the same size and no premultiplied channel moves
 * by more than `tolerance`. Colour under zero alpha has no visual meaning. */
export async function rastersEquivalent(a: Buffer, b: Buffer, tolerance = RASTER_TOLERANCE): Promise<boolean> {
  if (a.equals(b)) return await rgba(a) !== null;
  const [left, right] = await Promise.all([rgba(a), rgba(b)]);
  if (!left || !right || left.width !== right.width || left.height !== right.height) return false;
  for (let i = 0; i < left.data.length; i += 4) {
    const alphaA = left.data[i + 3] ?? 0;
    const alphaB = right.data[i + 3] ?? 0;
    if (Math.abs(alphaA - alphaB) > tolerance) return false;
    for (let c = 0; c < 3; c++) {
      const premultipliedA = (left.data[i + c] ?? 0) * alphaA / 255;
      const premultipliedB = (right.data[i + c] ?? 0) * alphaB / 255;
      if (Math.abs(premultipliedA - premultipliedB) > tolerance) return false;
    }
  }
  return true;
}
