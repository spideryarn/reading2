/**
 * The tombstone for `SPIDERYARN_STORE`, and the one way to refuse a write that
 * has nowhere to go.
 *
 * ## There is one store, and this file is what is left of the choice
 *
 * The filesystem store stopped being selectable on 2026-09-05 —
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F. Nothing chooses a store any more; `src/store/index.ts` wires Postgres and
 * only Postgres. What survives here is a **validator**, deliberately, and for
 * the length of one deployment: `SPIDERYARN_STORE` is still set in Vercel's
 * Preview and Production environments, and there is no Vercel credential on the
 * box this was written on, so Greg has to take it out himself. Ignoring a
 * `files` in the meantime would do the opposite of what the operator asked,
 * silently — the exact failure this migration exists to leave behind.
 *
 * So unset and `postgres` pass without a word, and anything else throws a
 * sentence with a date in it. **Stage I deletes this**, once the variable is
 * gone from Vercel: a permanent validated no-op would preserve the false
 * impression that store selection still means something.
 *
 * ## Why this is its own file rather than part of `index.ts`
 *
 * Because of the shape of the imports, and it is worth stating before somebody
 * tidies it back. [`index.ts`](index.ts) imports [`fs.ts`](fs.ts), which imports
 * `src/chat.ts` and `src/searches.ts`. So the moment those two modules need
 * anything from here — which is what `notMigratedError` below is for — importing
 * it from `index.ts` closes a cycle. `npm run check` gates on cycles (unlike
 * lint, which only advises), so that is a red build rather than a note.
 *
 * This file is therefore a **leaf**: it imports `src/env.ts`, which reads a file
 * and nothing else. Nothing imports it back.
 */

import { inheritedEnv, loadEnvLocal } from "../env.js";

/**
 * The day the filesystem store stopped being selectable, quoted in the refusal.
 *
 * A date rather than a version number, because whoever reads that sentence is
 * holding a deployment whose environment still names a store that is not there,
 * and what they need is *when* it stopped being a choice.
 */
const REMOVED_ON = "2026-09-05";

/** Unset, empty and `postgres` are the three values that mean "nothing to do". */
function acceptable(value: string | undefined): boolean {
  return value === undefined || value === "" || value === "postgres";
}

/**
 * **Where a value came from**, because that is what the operator has to change.
 *
 * *"`SPIDERYARN_STORE` is `files`"* is not actionable on its own when the value
 * could be in a shell export, a `.env.local` line or a Vercel environment
 * variable. Naming the source turns the message into an instruction.
 */
export interface StoreFlagSeen {
  /**
   * What the process was started with, from `src/env.ts`'s pre-`.env.local`
   * snapshot — a shell export, or a Vercel environment variable, which arrive
   * the same way.
   */
  readonly inherited: string | undefined;
  /** What actually applies after `.env.local` has been laid over it. */
  readonly applied: string | undefined;
}

/**
 * **Accept unset and `postgres` in silence; throw on `files` or anything else —
 * and check both the environment and the file, not just the winner.**
 *
 * `files` is the value this really exists for, and it gets the same sentence as
 * a typo does, because they are the same situation: somebody asked for a store
 * that is not there, and the honest answer is to say so rather than to serve
 * something else and report success.
 *
 * ## Why two values and not one
 *
 * Because `.env.local` is applied **over** the shell (`src/env.ts` § the
 * precedence rule, which is right and stays), so an operator who exported
 * `SPIDERYARN_STORE=files` on a machine whose `.env.local` says `postgres` was
 * silently overruled — measured 2026-09-05: requested `files`, validated
 * `postgres`, no throw, and `src/env.ts`'s own "overrode" warning is suppressed
 * under `NODE_ENV=test`. Reading only the applied value makes this function
 * agree with exactly the failure it was written to refuse: an instruction
 * ignored without a word.
 *
 * **The inherited value is checked first**, so the message names where the
 * person actually put it — a shell export, or a Vercel environment variable,
 * which reach a process the same way — rather than the file that happened to
 * win.
 *
 * In production there is no `.env.local` at all — `loadEnvLocal` returns at its
 * `readFileSync` — so the two values are the same string and this costs nothing.
 *
 * ## Throwing at import is deliberate
 *
 * The same argument that put the old parse here in 2026-08-26: the alternative
 * is a server that boots, ignores the instruction all afternoon, and is found
 * out by somebody wondering why the flag did nothing.
 */
export function refuseTheStoreFlag(seen: StoreFlagSeen): void {
  const sources: readonly (readonly [string, string | undefined])[] = [
    ["the environment this process was started with", seen.inherited],
    [".env.local", seen.applied],
  ];
  for (const [where, value] of sources) {
    if (acceptable(value)) continue;
    throw new Error(
      `SPIDERYARN_STORE is ${JSON.stringify(value)} in ${where}: ` +
        `the filesystem store was removed on ${REMOVED_ON}; there is one store; unset this. ` +
        "See docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.",
    );
  }
}

/**
 * Checked once, at module load, which is the only moment it can do any good.
 *
 * **The order of these three lines does not matter and the pairing does.**
 * `inheritedEnv` answers from a snapshot `src/env.ts` took when *it* was loaded
 * — which the `import` at the top of this file already caused — so it gives the
 * same answer before and after `loadEnvLocal()`. What matters is that both
 * values reach the refusal: the one the shell exported, and the one that
 * survived the file.
 *
 * **This module has to be imported for effect somewhere a server reaches**, and
 * `src/store/index.ts` does it on its first line. **It was imported by nothing
 * at all on 2026-09-05**, for the length of one commit, when the last `STORE`
 * comparison went and took the only `import` with it — and a module nothing
 * loads refuses nothing. `tests/store-flag-refused-at-boot.test.ts` is what goes
 * red now; the two behaviour tests here stayed green throughout, which is the
 * whole reason it exists.
 *
 * **Written out rather than through a constant**, both reads, because
 * `tests/one-store-only.test.ts` greps the tree for exactly these shapes and a
 * `process.env[FLAG]` is invisible to it — a variable key is invisible to any
 * grep. The one place allowed to read this must be the one place easiest to
 * find.
 */
const inherited = inheritedEnv("SPIDERYARN_STORE");
loadEnvLocal();
refuseTheStoreFlag({ inherited, applied: process.env.SPIDERYARN_STORE });

/**
 * The failure for a write with no Postgres implementation yet.
 *
 * **Loud on purpose, and the shape of the loudness matters.** A write that
 * lands in the store nobody is reading is the worst available outcome: it
 * reports success and loses the data. A 501 says the feature is not built here,
 * which is true, and is what `docs/project/deployment.md` already tells anybody
 * reading it about chat and meaning-search.
 *
 * Reader-facing behaviour has to be identical whichever door the call came
 * through — `notMigrated` in `src/store/index.ts`, and the two guards in
 * `src/chat.ts` and `src/searches.ts` — so the error is built here once rather
 * than written out twice.
 *
 * **This is scaffolding, and it is meant to be deleted.** The end state is step
 * 10 of docs/plans/260826e-postgres-storage-implementation.md: `pgChatStore` and
 * `pgSearchStore` are built and reviewed, and wiring them through `index.ts`
 * and `src/routes.ts` removes the need for any of this. Refusing now is the
 * honest interim, because the alternative is not "it works" — it is a write
 * that succeeds into a file every Postgres read ignores.
 */
export function notMigratedError(what: string): Error {
  return Object.assign(
    new Error(
      `${what} has no Postgres implementation yet, and Postgres is the store. ` +
        "Refusing rather than writing somewhere nothing will read back. " +
        "See docs/plans/260826e-postgres-storage-implementation.md.",
    ),
    { status: 501 },
  );
}

/** The same failure as a method body, for a store built out of them. */
export function notMigrated(what: string): () => never {
  return () => {
    throw notMigratedError(what);
  };
}

/* ------------------------------------------- seams with only one side, declared -- */

/**
 * **`SEAM_ASYMMETRIES` lived here until 2026-09-05, and is not coming back.**
 *
 * It recorded the seams that deliberately had one implementation, so that
 * `tests/store-seams-have-two-implementations.test.ts` could demand two
 * everywhere else. Every entry excused a missing *filesystem* side, which was
 * ordinary — there is no user list, no visibility column and no feedback table
 * on a filesystem.
 *
 * Stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * deleted the filesystem store, and eleven seams lost their second side in one
 * commit. Adding eleven entries would have made this a second list of the seams,
 * which the guard's own header says it exists to make impossible. So the guard
 * now asserts the thing that is still true and still load-bearing — **every seam
 * has a Postgres implementation** — and this map went with the store it
 * described. That is strictly stronger: the direction this type called "a
 * production outage with a date on it" can no longer be declared away.
 */
