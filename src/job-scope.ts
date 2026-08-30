/**
 * Which job the work happening right now belongs to.
 *
 * A deliberate sibling of src/owner.ts, not an extra field on its box. Read
 * that file first: it explains why request-scoped state here is an
 * `AsyncListenerStorage`-shaped problem rather than an extra argument on forty
 * functions, and everything it says applies again.
 *
 * ## Why a second scope rather than a `jobId` on `OwnerScope`
 *
 * Three reasons, in order of how much they cost.
 *
 * **The lifetimes are different.** An owner is known for the whole of a request
 * and for the whole of a queued job; a job id is known only inside one job's
 * step. `runInRequest` opens an owner box before the gate has filled it, and
 * there is no job at that point and never will be for most requests. A field
 * that is `null` for nearly every scope is not a field, it is a second scope
 * wearing the first one's clothes.
 *
 * **`runAsOwner` would have to grow a parameter**, and its callers are in
 * src/jobs.ts, tests/helpers/load-article.ts and two baseline suites. An
 * optional one is the shape src/owner.ts's own header warns about: the kind a
 * caller forgets, silently.
 *
 * **They nest the other way round.** A job runs *inside* an owner — the pump
 * enters `runAsOwner` and then advances a job — so the job scope is the inner
 * one and can be opened and closed without touching the outer.
 *
 * ## What reads it
 *
 * `dataRoot()` in src/store/data-root.ts, and nothing else yet. On a deployed
 * instance the filesystem store writes into `/tmp/spideryarn/<owner>/<job>/`,
 * and the job half of that is the part that stops one job's half-built
 * artefacts being mistaken for another's — see that file for the collision.
 *
 * **`run()`, never `enterWith`**, for exactly the reason src/owner.ts gives:
 * `enterWith` mutates the calling context, and with HTTP keep-alive two
 * requests can share one.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<string>();

/**
 * Run one job's work with its id in scope.
 *
 * Wrap the *step execution*, not the enqueue: the id has to be readable at the
 * moment a stage writes an artefact, and on Vercel that is inside whichever
 * `POST /api/jobs/:id/advance` the browser happened to send.
 */
export function runInJob<T>(jobId: string, fn: () => T): T {
  return scope.run(jobId, fn);
}

/** The job being advanced, or `null` outside one — the CLI, a test, a request. */
export function currentJobId(): string | null {
  return scope.getStore() ?? null;
}
