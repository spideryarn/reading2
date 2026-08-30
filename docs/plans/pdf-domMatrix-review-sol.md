# NO-SHIP

## Findings

1. **High — `pdf.worker.mjs` is still absent from the Vercel trace.**

   [`pass0()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf.ts:345) calls `getDocument()`. In Node, pdf.js disables real workers and sets `workerSrc` to `./pdf.worker.mjs` ([pdf.mjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.mjs:22359)), then imports it through the non-literal expression `import(this.workerSrc)` ([pdf.mjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.mjs:22539)).

   I traced `api-dist/vercel.js` using the locally installed Vercel nft. Its relevant file list was:

   ```text
   api-dist/vercel.js
   node_modules/@napi-rs/canvas/geometry.js
   node_modules/@napi-rs/canvas/package.json
   node_modules/pdfjs-dist/legacy/build/pdf.mjs
   ```

   `pdf.worker.mjs` was missing. Vite deliberately leaves it external ([vite.api.config.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/vite.api.config.ts:153)), so nothing else ships it. pdf.js’s own distribution documentation says the display and worker modules are both required. [pdf.js distribution docs](https://github.com/mozilla/pdf.js/blob/master/docs/contents/getting_started/index.md)

   This is confirmed for the checked tracer; the exact hosted bundle was not available for inspection.

   **Do instead:** add a literal import inside `loadPdfjs()`, retain its exports as `globalThis.pdfjsWorker`, then return pdf.js. Also assert the nft file list contains both `pdf.mjs` and `pdf.worker.mjs`.

2. **Medium — the test does not reproduce the deployed filesystem.**

   [`Module._resolveFilename` is patched](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/pass0-without-canvas.ts:31), but the geometry import is ESM ([src/pdf.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf.ts:100)) and never passes through that hook. I verified that rejecting every CJS request beginning `@napi-rs/canvas` still allows the ESM geometry import.

   The test correctly reproduces pdf.js’s failed bare CJS `require`, but assumes geometry and every other locally installed pdf.js file remain available. It therefore misses:

   - `pdf.worker.mjs` being excluded;
   - geometry being excluded by the hosted tracer;
   - `index.js` and native binaries being included accidentally;
   - a missing dependency hidden by an existing `node_modules`.

   **Do instead:** keep this as a narrow unit regression, but add an nft/build-output test asserting geometry and the worker are present while `index.js`, `js-binding.js`, and native packages are absent. Ideally execute `pass0()` from that materialized trace.

3. **Low — the claimed DOMMatrix arithmetic coverage is false.**

   The test says matching 8 pages / 3,522 words proves working matrix arithmetic ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/pdf-without-canvas.test.ts:43)). I replaced DOMMatrix with an empty class, blocked the native package, and got exactly:

   ```json
   {"pages":8,"words":3522}
   ```

   Ordinary text extraction uses array transforms. A text-path route to real DOMMatrix arithmetic exists for Type3 glyph mask compilation ([pdf.worker.mjs](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs:23335)); geometry implements its `scaleSelf()` and `translateSelf()` calls. The current fixture simply does not exercise it.

   **Do instead:** correct the test comment and add a Type3-font fixture if arithmetic compatibility matters.

## Claims that held

- The literal geometry import is traced. nft includes `geometry.js` and its `package.json`, not `index.js` or the native binding. [nft tracing model](https://github.com/vercel/nft)
- No `exports` map helps today: the deep path is legal. `main` is irrelevant once the explicit file resolves; `files` only ensures `geometry.js` exists in the published package.
- No other production importer bypasses `loadPdfjs()`; the only other repo hit is a Vitest mock.
- Leaving `Path2D` absent is defensible for `numPages`, metadata, and `getTextContent()`. I found no text-extraction path reaching it.
- The focused test passes, but it does not catch the High finding.