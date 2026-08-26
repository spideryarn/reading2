/**
 * Which store is live, and what an unrecognised name does.
 *
 * Unset means files; a *wrong* value is an error. Those are deliberately not
 * the same rule. Unset is the ordinary state of a machine that has not opted
 * in, so it has to mean something — but `SPIDERYARN_STOER=postgres`, or
 * `postgress`, or a capitalised `Postgres`, is somebody who believes they HAVE
 * opted in, and the first version of this handed all three of them the
 * filesystem without a word.
 *
 * That is the failure this migration keeps meeting: the check you would
 * naturally run to confirm it worked asks the same wrong question as the code,
 * and answers yes. See docs/reusable/silent-success.md.
 *
 * No database needed.
 */

import { describe, expect, it } from "vitest";

import { storeFromEnv } from "../src/store/index.js";

describe("storeFromEnv", () => {
  it("defaults to files when nothing is set", () => {
    // Both spellings of absent. An empty string is what a shell gives you for
    // `SPIDERYARN_STORE=` , which is somebody clearing it rather than a typo.
    expect(storeFromEnv(undefined)).toBe("files");
    expect(storeFromEnv("")).toBe("files");
  });

  it("takes the two names it knows", () => {
    expect(storeFromEnv("files")).toBe("files");
    expect(storeFromEnv("postgres")).toBe("postgres");
  });

  it("refuses a near miss rather than quietly serving files", () => {
    // Every one of these is somebody who thinks they are on Postgres.
    for (const wrong of ["postgress", "Postgres", "POSTGRES", "pg", "postgres ", "file"]) {
      expect(() => storeFromEnv(wrong), wrong).toThrow(/neither "files" nor "postgres"/);
    }
  });

  it("says what it found, so the typo is visible in the message", () => {
    // Quoted, because the difference between `postgres` and `postgres ` is
    // invisible in an unquoted error and is exactly the kind of thing that
    // gets set by a copy-paste out of a wiki.
    expect(() => storeFromEnv("postgres ")).toThrow(/"postgres "/);
  });
});
