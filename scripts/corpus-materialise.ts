/**
 * Put the tracked fixture corpus where the tests look for it.
 *
 * The tests read `data/` and `output/`, both gitignored, so a fresh checkout has
 * neither and the suite is not hermetic —
 * `docs/plans/260901b-committed-fixture-corpus.md` has the whole story and the
 * deferred half. Until that half lands, somebody has to copy the committed
 * corpus into place, and there are two somebodies: the deploy gate's throwaway
 * worktree, and `scripts/worktree-setup.ts`.
 *
 * **This was extracted from `scripts/deploy.ts` rather than written fresh**, and
 * that mattered, because the version there had already been taught two things a
 * new one would have got wrong:
 *
 *  - **Both halves or neither.** Copying only `data/` made the `test` gate
 *    structurally incapable of passing — 13 failures and 202 cascade-skips at
 *    every commit, so `--force-gate=test` became the only way anyone deployed,
 *    and "an override that is required every time is not an override".
 *  - **Retry once.** A peer's test run deleting a fixture directory mid-copy
 *    killed a whole deploy on 2026-08-28 with an error that read as an
 *    uncatchable `directory_iterator` abort. Several agents share this tree, so
 *    the source can move under the copy.
 *
 * Measured on 2026-09-01, in a real worktree: without this, 95 of 477 test files
 * fail, most of them unable to collect at all. With it, 14.
 */

import { cpSync, existsSync } from "node:fs";
import path from "node:path";

/** The two directories that are one artefact store split in two. */
export const CORPUS_HALVES = ["data", "output"] as const;

/** Where the committed corpus lives, relative to a checkout's root. */
export const CORPUS_ROOT = "tests/fixtures/data-root";

export interface MaterialiseResult {
  /** Halves copied, as `"data/"`, `"output/"`. */
  copied: string[];
  /** Halves the corpus does not contain. Both missing is the alarming case. */
  missing: string[];
}

/**
 * Copy the corpus into `root`, returning what actually happened.
 *
 * **Reports what it did, not what it meant to.** The line in `deploy.ts` used to
 * name both directories unconditionally, so a run where the corpus was absent
 * and nothing was copied printed the same sentence as one where it worked. The
 * caller decides how loud a wholly-absent corpus is: the deploy gate has a
 * separate `fixtures` gate that diagnoses it, so it only prints; a worktree
 * setup should refuse.
 */
export function materialiseCorpus(
  root: string,
  opts: { note?: (msg: string) => void } = {},
): MaterialiseResult {
  const note = opts.note ?? (() => {});
  const copied: string[] = [];
  const missing: string[] = [];

  for (const half of CORPUS_HALVES) {
    const from = path.join(root, CORPUS_ROOT, half);
    if (!existsSync(from)) {
      missing.push(`${half}/`);
      continue;
    }
    const to = path.join(root, half);
    try {
      cpSync(from, to, { recursive: true });
    } catch (err) {
      note(`${half}/ moved under the copy (${(err as Error).message.slice(0, 60)}…) — retrying once`);
      cpSync(from, to, { recursive: true, force: true });
    }
    copied.push(`${half}/`);
  }

  return { copied, missing };
}

/** One line saying what happened, for whichever caller is printing. */
export function describeMaterialise(result: MaterialiseResult): string {
  if (result.copied.length === 0) {
    return `nothing copied — ${CORPUS_ROOT}/ has neither half; tests will run against an empty store`;
  }
  const tail = result.missing.length ? ` (${CORPUS_ROOT}/ has no ${result.missing.join(" or ")})` : "";
  return `${result.copied.join(" + ")} copied from ${CORPUS_ROOT}/${tail}`;
}
