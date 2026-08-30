/**
 * Types for `@napi-rs/canvas/geometry.js`, which ships none for that path.
 *
 * The package ships `index.d.ts` for its main entry, but the main entry is the
 * one we must not import: it `require`s the 26 MB native binding. `geometry.js`
 * is plain JavaScript beside it — a vendored copy of geometry-polyfill — and
 * nothing describes it. See the long note in src/pdf.ts above `ensureDomMatrix`
 * for why we reach for that file by name rather than the package.
 *
 * `tsconfig.json` sets `"lib": ["ES2022"]` with no DOM, so there is no ambient
 * `DOMMatrix` to point at and the shape is written out here. It is deliberately
 * only the parts that matter: what pdf.js constructs, and the four fields it
 * assigns to (`pdf.mjs` sets `.a` and `.d` on its module-scope `SCALE_MATRIX`).
 *
 * CommonJS with `module.exports = { DOMPoint, DOMMatrix, DOMRect }`, which
 * Node's lexer can read, so a dynamic `import()` gets both the named exports
 * and a `default`. Both spellings are declared because both can turn up, and
 * src/pdf.ts checks for each in turn.
 */
declare module "@napi-rs/canvas/geometry.js" {
  /** The 2-D affine matrix, as the Geometry Interfaces spec defines it. */
  interface DOMMatrixLike {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    readonly is2D: boolean;
    multiply(other: DOMMatrixLike): DOMMatrixLike;
    translate(tx?: number, ty?: number, tz?: number): DOMMatrixLike;
    scale(sx?: number, sy?: number): DOMMatrixLike;
    invertSelf(): DOMMatrixLike;
  }

  type DOMMatrixConstructor = new (init?: string | number[]) => DOMMatrixLike;

  export const DOMMatrix: DOMMatrixConstructor;
  const _default: { DOMMatrix: DOMMatrixConstructor };
  export default _default;
}
