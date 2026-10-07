/**
 * Types for `gifenc`, which ships none: only the parts scripts/frames-to-gif.ts
 * calls. https://github.com/mattdesl/gifenc — the README is the reference.
 */
declare module "gifenc" {
  export type Palette = number[][];

  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;

  export interface FrameOptions {
    palette?: Palette;
    /** Milliseconds this frame shows for. */
    delay?: number;
    /** On the first frame: 0 loops for ever, -1 plays once. */
    repeat?: number;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(): Encoder;

  /* CommonJS: under Node's ESM loader the whole of `exports` is the default. */
  const gifenc: {
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
    GIFEncoder: typeof GIFEncoder;
  };
  export default gifenc;
}
