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
 * **A seam that deliberately has an implementation on only one side, said out
 * loud so a test can tell it from a seam nobody has got to yet.**
 *
 * That distinction is the whole point of this record, and it is the thing that
 * was missing when Claims shipped: `RefereeClaimsStore` had a filesystem
 * implementation and a `notMigrated` refusal, which was a recorded decision — and
 * a recorded decision written in a docstring is indistinguishable, to every check
 * in this repo, from a store somebody forgot. Under `SPIDERYARN_STORE=postgres`
 * every claims operation answered 501 for four hours in production while every
 * test passed.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md.
 *
 * `tests/store-seams-have-two-implementations.test.ts` derives the seams from
 * `contracts.ts` and the implementations from the source, so **this record is
 * never a second list of the seams** — only of the exceptions, exactly as
 * `ARTICLE_TABLE_COVERAGE` in [export.ts](export.ts) is only a list of what the
 * rollback does about each table. An entry that stops being true fails that test
 * too: build the missing side and the entry has to go.
 *
 * ## The two directions are not the same thing, and the type says so
 *
 * **`missing: "files"` is ordinary.** There is no user list, no visibility
 * column and no feedback table on a filesystem, so those seams have a Postgres
 * implementation and a filesystem *refusal*. Nothing is broken anywhere; the
 * store that cannot answer is the one that does not deploy.
 *
 * **`missing: "postgres"` is a production outage with a date on it**, because
 * `postgres` is what deploys. So it carries `productionGap` as well as `why`:
 * one sentence naming what a reader cannot do on the deployed app. Writing that
 * sentence is meant to be uncomfortable — it is the sentence nobody would have
 * written and shipped about *"Pull the paper's claims"*, and having to write it
 * is the check.
 *
 * Keyed by the interface name in [contracts.ts](contracts.ts).
 */
export type SeamAsymmetry =
  | {
      /** No filesystem implementation, and there should not be one. */
      readonly missing: "files";
      /** Why a filesystem adapter cannot or should not exist. In words. */
      readonly why: string;
    }
  | {
      /** No Postgres implementation **yet** — this is a gap, not a design. */
      readonly missing: "postgres";
      /** Why it has not been built, and who owns building it. In words. */
      readonly why: string;
      /**
       * **What a reader cannot do on the deployed app**, in one plain sentence.
       *
       * Required, because `postgres` is the store production runs: this side
       * missing means a 501 for everybody who is not a developer on a laptop.
       */
      readonly productionGap: string;
    };

export const SEAM_ASYMMETRIES: Readonly<Record<string, SeamAsymmetry>> = {
  AdminStore: {
    missing: "files",
    why:
      "There is no user list on a filesystem — data/ is one directory per slug and " +
      "nothing in it records that a person exists. The files side is a loud refusal " +
      "with its own sentence, in src/store/index.ts. docs/project/admin.md.",
  },
  VisibilityStore: {
    missing: "files",
    why:
      "The filesystem store has no visibility column, so there is nowhere to record " +
      "that a document is shared. A files adapter could only report success and share " +
      "nothing. docs/plans/260827ai-public-read-only-access.md.",
  },
  FeedbackStore: {
    missing: "files",
    why:
      "There is no feedback table on a filesystem, and a files adapter would be twenty " +
      "lines written against a module docs/plans/260831b-finish-the-database-move.md " +
      "deletes. A Feedback button that accepts a report and drops it is worse than none.",
  },
  LinkPreviewStore: {
    missing: "files",
    why:
      "The whole seam is a row shared by every reader and a claim two servers can " +
      "contend for, and `data/` is one directory per slug with no way to express " +
      "either. A files adapter would be a per-machine cache with no single-flight, " +
      "which is not this feature with a different backing store — it is the thing " +
      "this feature exists instead of. src/db/schema.ts § `linkPreviews`.",
  },
  FetchAllowanceStore: {
    missing: "files",
    why:
      "A rate limit that is not atomic across instances is not a rate limit, and a " +
      "filesystem has no way to make one — which is the whole of GPT Sol's finding " +
      "P1-5, 2026-09-05. The Postgres side counts rows under an owner-scoped " +
      "advisory lock; a files side could only count its own process's.",
  },
  LinkSummaryStore: {
    missing: "files",
    why:
      "`LinkPreviewStore`'s reason with money on it. The seam is a claim two servers " +
      "can contend for, and here losing that contention costs a model call rather than " +
      "a metadata fetch — a files adapter with no single-flight would be a feature that " +
      "pays twice and calls it a cache. It also compares four fingerprints on every " +
      "read, which is a WHERE clause rather than a file format.",
  },
  /* **The two below are a different kind of entry from the five above**, and
     the difference is worth reading before adding a fourth like them.

     The first five say *a filesystem adapter cannot sensibly exist*. These two
     say *it existed, worked, and was deleted* — stage G of
     docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
     2026-09-05. There is one store now, so "two implementations" is no longer
     the property this guard should be asserting, and every remaining seam will
     arrive here in turn as the later groups delete `fs.ts` and its siblings.
     **When that happens the answer is to retire the guard, not to finish the
     list** — a record of exceptions that has grown to cover every case is a
     second list of the seams, which its own header says it must never become. */
  CostStore: {
    missing: "files",
    why:
      "There was a JSONL ledger at data/_ai-calls.jsonl until 2026-09-05, and it was a " +
      "genuine second implementation — it is what let `npm run cost` work on a laptop " +
      "with no database. It went with the rest of the filesystem store. Spend is metered " +
      "in the `ai_calls` table and nowhere else. **Unqualified on purpose**: this is a string " +
      "literal rather than a comment, and tests/public-imports.test.ts scans this file for the " +
      "schema-qualified spelling after stripping comments but not strings, so writing it out in " +
      "full here fails that guard. docs/project/ai-gateway.md.",
  },
  RealtimeSessionStore: {
    missing: "files",
    why:
      "The live-conversation journal had a JSON file beside the table until 2026-09-05 " +
      "and the two were held in step by tests/store-realtime-sessions.test.ts. It went " +
      "with the rest of the filesystem store; a session is a billing parent and belongs " +
      "in the database that carries the usage rows pointing at it. " +
      "docs/project/live-conversation.md.",
  },
};
