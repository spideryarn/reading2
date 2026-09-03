/**
 * Which store is live, and the one way to refuse a write that has nowhere to go.
 *
 * ## Why this is its own file rather than part of `index.ts`
 *
 * Because of the shape of the imports, and it is worth stating before somebody
 * tidies it back. [`index.ts`](index.ts) imports [`fs.ts`](fs.ts), which imports
 * `src/chat.ts` and `src/searches.ts`. So the moment those two modules need to
 * ask *which store is live* — which is what `notMigratedError` below is for —
 * importing it from `index.ts` closes a cycle. `npm run check` gates on cycles
 * (unlike lint, which only advises), so that is a red build rather than a note.
 *
 * This file is therefore a **leaf**: it imports `src/env.ts`, which reads a file
 * and nothing else. Nothing imports it back.
 *
 * ## What lives here and what does not
 *
 * The flag, the parse, and the error. **Not** the wiring — which store object
 * answers which contract stays in `index.ts`, where it can see every adapter.
 */

import { loadEnvLocal } from "../env.js";

loadEnvLocal();

export type StoreName = "files" | "postgres";

/**
 * Which store is live. **Unset means `files`; a wrong value is an error.**
 *
 * Those are not the same rule and the difference is the whole point. Unset is
 * the ordinary state of every machine that has not opted in yet, so it has to
 * mean something. `SPIDERYARN_STOER=postgres`, or `postgress`, or `Postgres`
 * with a capital, is somebody who *has* opted in and does not know it did not
 * take — and the first version of this line handed all three of them the
 * filesystem in silence, which is the shape of failure this whole migration
 * keeps tripping over: the check you would naturally run comes back saying
 * everything is fine, because it is asking the same wrong question.
 *
 * Failing at import is deliberate. The alternative is a server that boots,
 * serves the wrong store all afternoon, and is discovered by someone wondering
 * why their comment did not survive a restart. GPT Sol raised this in review,
 * 2026-08-26.
 */
export function storeFromEnv(value: string | undefined): StoreName {
  if (value === undefined || value === "") return "files";
  if (value === "files" || value === "postgres") return value;
  throw new Error(
    `SPIDERYARN_STORE is ${JSON.stringify(value)}, which is neither "files" nor "postgres". ` +
      "Unset it for files, or spell it exactly. Refusing to guess, because guessing " +
      "would serve the store you did not ask for and say nothing about it.",
  );
}

/**
 * The flag, read once at module load rather than per call.
 *
 * A store that could change under a running request is a much worse thing to
 * debug than one that needs a restart.
 */
export const STORE: StoreName = storeFromEnv(process.env.SPIDERYARN_STORE);

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
      `${what} has no Postgres implementation yet, and SPIDERYARN_STORE=postgres. ` +
        "Refusing rather than writing a file nothing will read back. " +
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
};
