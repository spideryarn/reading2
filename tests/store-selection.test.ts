/**
 * **There is one store, and this is the tombstone that says so out loud.**
 *
 * `SPIDERYARN_STORE` chose between a directory under `data/` and Postgres until
 * 2026-09-05, when the filesystem store and the choice both went
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F). What is left in [`src/store/live.ts`](../src/store/live.ts) is a
 * validator with three jobs, and this file is one case per job:
 *
 * 1. **Unset passes in silence** — the ordinary state of every machine, and of
 *    a fresh clone.
 * 2. **`postgres` passes in silence** — because Vercel's Preview and Production
 *    environments still carry it, there is no Vercel credential on the box this
 *    was written on, and a hinge that threw on *any* value would have broken the
 *    next deploy until Greg took it out by hand.
 * 3. **`files` throws, and so does anything else** — **in either source**.
 *    Silently ignoring `SPIDERYARN_STORE=files` would do the opposite of what
 *    the operator asked, which is the failure this whole migration exists to
 *    leave behind ([silent-success.md](../docs/reusable/silent-success.md)). A
 *    typo is the same situation and gets the same sentence: somebody asked for a
 *    store that is not there.
 *
 * **The date is asserted rather than the wording**, because the date is the part
 * a person reading the refusal needs — they are holding a deployment whose
 * environment names a store that is gone, and *when* is what tells them this is
 * a configuration to remove rather than a bug to report.
 *
 * ## What this file cannot see, and which file does
 *
 * **It calls the function.** That is the right way to check *what the rule is*
 * and exactly the wrong way to check *whether the rule runs* — and on 2026-09-05
 * the rule did not run: removing the last `STORE` comparison removed the last
 * `import` of the module, so the tombstone left the program while every case
 * here stayed green. [`store-flag-refused-at-boot.test.ts`](store-flag-refused-at-boot.test.ts)
 * is the one that imports `src/store/index.ts` in a child process and requires
 * the child to die. Neither file replaces the other.
 *
 * Stage I deletes the function and both files, once the variable is gone from
 * Vercel. A permanent validated no-op would preserve the false impression that
 * store selection still means something.
 *
 * No database needed.
 */

import { describe, expect, it } from "vitest";

import { applyEnvFile } from "../src/env.js";
import { refuseTheStoreFlag } from "../src/store/live.js";

/** What a machine with nothing set looks like. */
const nothing = { inherited: undefined, applied: undefined };

/** Both sources agreeing, which is every deployment (there is no `.env.local`). */
const both = (value: string | undefined) => ({ inherited: value, applied: value });

describe("the SPIDERYARN_STORE tombstone", () => {
  it("says nothing when the variable is unset", () => {
    /* Both spellings of absent. An empty string is what a shell gives you for
       `SPIDERYARN_STORE=`, which is somebody clearing it rather than a typo. */
    expect(() => refuseTheStoreFlag(nothing)).not.toThrow();
    expect(() => refuseTheStoreFlag(both(""))).not.toThrow();
  });

  it("tolerates the one value that is still set in production", () => {
    expect(() => refuseTheStoreFlag(both("postgres"))).not.toThrow();
  });

  it("refuses `files` rather than quietly serving Postgres instead", () => {
    expect(() => refuseTheStoreFlag(both("files"))).toThrow(/there is one store; unset this/);
  });

  it("refuses every near miss, for the same reason and in the same words", () => {
    /* Every one of these is somebody who believes they have configured a store.
       `postgres ` is the copy-paste out of a wiki, and it is not `postgres`. */
    for (const wrong of ["postgress", "Postgres", "POSTGRES", "pg", "postgres ", "file", "files "]) {
      expect(() => refuseTheStoreFlag(both(wrong)), wrong).toThrow(
        /the filesystem store was removed/,
      );
    }
  });

  it("carries the date the store went, and the value it was handed", () => {
    /* Quoted, because the difference between `postgres` and `postgres ` is
       invisible in an unquoted error — and dated, because "when" is what turns
       this from a bug report into a variable somebody deletes. */
    expect(() => refuseTheStoreFlag(both("postgres "))).toThrow(/"postgres "/);
    expect(() => refuseTheStoreFlag(both("files"))).toThrow(/removed on 2026-09-05/);
  });
});

/**
 * **The half a single value cannot express**, and it is a real hole rather than
 * a hypothetical: measured on 2026-09-05, an inherited `files` with a
 * `.env.local` saying `postgres` validated as `postgres` and threw nothing.
 *
 * `.env.local` is applied **over** the shell (src/env.ts § the precedence rule,
 * which is right and stays), and its "overrode" warning is suppressed under
 * `NODE_ENV=test`. So an operator who typed `SPIDERYARN_STORE=files` was served
 * the other store without a word — the exact shape the tombstone exists to
 * refuse, arriving through the door beside it.
 */
describe("a shell that says one thing and a file that says another", () => {
  it("refuses what the shell asked for, even when the file overrules it", () => {
    expect(() =>
      refuseTheStoreFlag({ inherited: "files", applied: "postgres" }),
    ).toThrow(/the filesystem store was removed/);
  });

  it("names the environment, because that is where the operator has to change it", () => {
    /* "the environment this process was started with" covers a shell export and
       a Vercel environment variable, which reach a process identically — and
       Vercel is where the value actually is today. */
    expect(() => refuseTheStoreFlag({ inherited: "files", applied: "postgres" })).toThrow(
      /in the environment this process was started with/,
    );
  });

  it("names `.env.local` when that is the one carrying it", () => {
    expect(() => refuseTheStoreFlag({ inherited: undefined, applied: "files" })).toThrow(
      /in \.env\.local/,
    );
  });

  /**
   * **The precedence itself, composed from the real function rather than
   * restated.**
   *
   * `applyEnvFile` is the seam `tests/env.test.ts` drives and is what decides
   * which value wins. Feeding its answer to the refusal is how this file checks
   * the two together without a `.env.local` of its own — and there deliberately
   * is not one: this repo's `.env.local` is a real developer's file and a test
   * that edits it is a test that can leave a machine broken.
   *
   * **What it does not reach** is `live.ts`'s own module-load line — that is
   * `store-flag-refused-at-boot.test.ts`'s job, and the case below pins the
   * shape here so the two cannot drift apart silently.
   */
  it("is the answer `applyEnvFile` actually produces, not a hand-made pair", () => {
    const shell = { SPIDERYARN_STORE: "files" };
    const env: Record<string, string | undefined> = { ...shell };
    applyEnvFile("SPIDERYARN_STORE=postgres\n", env, shell);

    /* The override really happened — otherwise the refusal below would be about
       a pair this test invented. */
    expect(env.SPIDERYARN_STORE).toBe("postgres");
    expect(() =>
      refuseTheStoreFlag({ inherited: shell.SPIDERYARN_STORE, applied: env.SPIDERYARN_STORE }),
    ).toThrow(/the filesystem store was removed/);
  });
});
