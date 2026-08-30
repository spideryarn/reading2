/**
 * Types for `pdfjs-dist/legacy/build/pdf.worker.mjs`, which ships none.
 *
 * pdfjs-dist ships `pdf.d.mts` for the display module beside it and nothing at
 * all for the worker, because in a browser the worker is loaded as a URL rather
 * than imported. Under Node there is no real worker: pdf.js runs the same code
 * on the main thread and reaches it through `import(GlobalWorkerOptions.workerSrc)`
 * — a variable, which is precisely why we have to name the file ourselves. See
 * the note above `ensurePdfWorker` in src/pdf.ts.
 *
 * `WorkerMessageHandler` is the only export (pdf.worker.mjs:71070), and the only
 * thing pdf.js looks for on `globalThis.pdfjsWorker`. We never call it — we hand
 * it back — so it is declared as the opaque thing it is to us rather than given
 * a shape that would be a guess.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
