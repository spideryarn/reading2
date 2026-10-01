/**
 * Reader-view import for the shared Sketch wait. The progress card needs the
 * same words, so their one source now lives in the client-safe `job-state`
 * leaf rather than under `src/web`.
 */
export { SKETCH_WAIT } from "../job-state.js";
