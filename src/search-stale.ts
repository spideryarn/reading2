/**
 * Is this saved search still an answer about the article as it is now?
 *
 * One three-line function in a module of its own, for the reason
 * tests/client-imports.test.ts states: **both halves of the app have to ask
 * this, and neither may reach the other's code to do it.** The panel decides
 * whether to put a warning on a row; the server decides it too, wherever a run
 * is read outside the browser. A second implementation of a rule this small is
 * how the panel and the prose end up disagreeing — the same argument
 * src/quote-match.ts and src/term-match.ts already carry, arriving at the same
 * answer.
 *
 * `src/searches.ts` re-exports this, so server-side callers can keep importing
 * from the module they already use. `src/source-hash.ts` is what *computes* a
 * fingerprint and cannot be shared: it needs `node:crypto`, so the comparison
 * lives here and the hashing stays there.
 *
 * See docs/project/search.md § A saved search says which article it answered.
 */
import type { SearchRun } from "./types.js";

/**
 * `current` is the article's fingerprint right now — `hashBlocks`,
 * src/source-hash.ts — or `undefined` when nobody could work one out.
 *
 * **Unknown counts as stale, from either side.** A run saved before runs
 * recorded what they were answered against has no hash of its own, and an
 * article whose blocks cannot be read offers nothing to compare against. In
 * neither case do we know the answer, and "cannot tell" has to fall on the side
 * that says so out loud. Being wrong this way costs the reader a sentence they
 * can ignore and a search they may choose to run again; being wrong the other
 * way is the bug this exists to fix, and it is silent.
 *
 * That is the same call src/api.ts makes for a glossary whose blocks it cannot
 * read — *"Unknown counts as stale: the honest answer, and the safe way round
 * to be wrong."*
 */
export function isStale(run: Pick<SearchRun, "sourceHash">, current: string | undefined): boolean {
  if (current === undefined || run.sourceHash === undefined) return true;
  return run.sourceHash !== current;
}
