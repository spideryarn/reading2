/**
 * `buildDescription` — the sentence the corner logo's tooltip carries about the
 * copy of the app in front of the reader.
 *
 * Its own file rather than a block in `tests/build-stamp.test.ts`, because that
 * file is about `scripts/build-stamp.ts` — the *build-time* resolver, running in
 * node with a real environment — and this is the client's read of what that
 * resolver compiled in, which is two globals that only a build defines
 * (src/web/build-stamp.ts § `typeof`, not a plain read).
 *
 * **Every assertion here is about the tooltip refusing to say something**, which
 * is the whole point of the function: Greg asked for a version number, the
 * honest answer is a sha and a date, and a tooltip that fills the gap with
 * "unknown" or with seven characters of a word is worse than one that says
 * nothing at all. docs/plans/260907f-… § The version number.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDescription } from "../src/web/build-stamp.js";

const SHA = "39282f8ca7e616a212720a7469e1b680cdf874e3";
const BUILT = "2026-09-07T09:49:03Z";

/** What a real build compiles in. */
function stampIs(commit: string, time: string): void {
  vi.stubGlobal("__SPIDERYARN_BUILD_COMMIT__", commit);
  vi.stubGlobal("__SPIDERYARN_BUILD_TIME__", time);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the logo's tooltip says about this build", () => {
  it("says nothing at all when nothing built this", () => {
    /* No stubs: the state of every `npm run dev` and every test run, because
       there is no `define` outside a build. This is the common case, not the
       edge one. */
    expect(buildDescription()).toBeNull();
  });

  it("names the date and the short sha of a real build", () => {
    stampIs(SHA, BUILT);
    const said = buildDescription();
    expect(said).toContain("39282f8");
    expect(said).toContain("2026");
    /* Short, not the full forty — the tooltip is one line beside a logo. */
    expect(said).not.toContain(SHA);
  });

  /**
   * **The guard was `!== "unknown"`, and that is not what the sentence
   * promises.** `resolveBuildStamp` takes `SPIDERYARN_BUILD_COMMIT` at its word,
   * so a build carrying a label rather than a sha produced *"built 7 Sep 2026
   * from release"* — seven characters sliced off a word, in the one place on the
   * page whose whole job is to say what this copy actually is. GPT Sol's review
   * of 260907f, P2.
   */
  it("refuses anything that is not a forty-character sha", () => {
    for (const notASha of [
      "unknown",
      "release-candidate",
      "",
      " ",
      SHA.slice(0, 7),
      SHA.toUpperCase(),
      `${SHA}0`,
      "z".repeat(40),
    ]) {
      stampIs(notASha, BUILT);
      expect(buildDescription(), notASha).toBeNull();
    }
  });

  it("refuses a time it cannot read, rather than saying Invalid Date", () => {
    for (const notATime of ["", "yesterday", "2026-13-45T99:99:99Z"]) {
      stampIs(SHA, notATime);
      expect(buildDescription(), notATime).toBeNull();
    }
  });
});
