/**
 * The dev-server port range, and the guard that stops a setup script wiping the
 * primary's `node_modules`.
 *
 * **This file used to be twice this size**, and the history is the useful part.
 * It tested a port allocator: a reservation per worktree, in the shared git
 * directory, on an exclusive file create. Three rounds of correction happened to
 * it in one day, and only the last one mattered:
 *
 *  - GPT Sol killed a *hash* allocator at plan stage — at ten worktrees in a
 *    30-wide range it collides ~99.96% of the time.
 *  - GPT Sol then found the reservation was a `takeLockFile`, which releases on
 *    `process.on("exit")`, so the one-shot setup that claimed a port would drop
 *    it on the way out. Untestable in this file by construction: every lease
 *    lived in one vitest process, the one case where a lock behaves.
 *  - Greg then asked whether the whole thing should be dynamic, and it should.
 *    `bind()` is already an atomic allocator and the kernel is a better arbiter
 *    than any file we can write. The reservation, its tests, and an export added
 *    to `scripts/lockfile.ts` for it were all deleted.
 *
 * The lesson worth carrying: **two of three review rounds improved a mechanism
 * that should not have existed.** A passing suite endorses the mechanism it is
 * given.
 *
 * See scripts/worktree-port.ts and docs/project/worktrees.md.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  allowListedPorts,
  describePorts,
  DEV_PORT_RANGE,
  devPorts,
  inLinkedWorktree,
  parseDevPortEnv,
  portInRange,
  PRIMARY_PORT,
} from "../scripts/worktree-port.js";

describe("the range", () => {
  it("starts at 5273, the port every doc and the allow-list name", () => {
    // Not cosmetic: supabase/config.toml names 5273 by number and GoTrue bakes
    // it in at start, so moving it breaks Google sign-in.
    expect(devPorts()[0]).toBe(5273);
    expect(PRIMARY_PORT).toBe(5273);
  });

  it("has room for the thirty worktrees Greg asked about, plus the primary", () => {
    expect(devPorts()).toHaveLength(31);
    expect(DEV_PORT_RANGE.count).toBe(31);
  });

  it("rejects everything outside it, including near misses and non-integers", () => {
    const last = DEV_PORT_RANGE.first + DEV_PORT_RANGE.count - 1;
    expect(portInRange(DEV_PORT_RANGE.first)).toBe(true);
    expect(portInRange(last)).toBe(true);
    expect(portInRange(DEV_PORT_RANGE.first - 1)).toBe(false);
    expect(portInRange(last + 1)).toBe(false);
    expect(portInRange(5273.5)).toBe(false);
    expect(portInRange(Number.NaN)).toBe(false);
  });
});

describe("parseDevPortEnv", () => {
  it("treats absent and empty as 'the primary', which is what they mean", () => {
    expect(parseDevPortEnv(undefined)).toBeUndefined();
    expect(parseDevPortEnv("")).toBeUndefined();
    expect(parseDevPortEnv("   ")).toBeUndefined();
  });

  it("throws on a set-but-unparseable value rather than falling back to 5273", () => {
    // The fallback was the bug: `Number(x) || 5273` on a typo turned a worktree
    // into a second server on the primary's port. GPT Sol, finding 3.
    expect(() => parseDevPortEnv("oops")).toThrow(/is not a port number/);
    expect(() => parseDevPortEnv("5274x")).toThrow(/is not a port number/);
    expect(() => parseDevPortEnv("-1")).toThrow(/is not a port number/);
    expect(() => parseDevPortEnv("5274.5")).toThrow(/is not a port number/);
  });

  it("throws on a well-formed port outside the allow-list, naming the consequence", () => {
    expect(() => parseDevPortEnv("6000")).toThrow(/outside 5273/);
    expect(() => parseDevPortEnv("6000")).toThrow(/drops the return path/);
    expect(() => parseDevPortEnv("0")).toThrow(/outside 5273/);
  });

  it("accepts a port inside the range, including the primary's", () => {
    expect(parseDevPortEnv("5274")).toBe(5274);
    expect(parseDevPortEnv(" 5280 ")).toBe(5280);
    expect(parseDevPortEnv(String(PRIMARY_PORT))).toBe(PRIMARY_PORT);
  });
});

describe("inLinkedWorktree", () => {
  /* The guard `scripts/worktree-setup.ts` refuses on, and the direction that
     matters is not symmetric: that script runs `npm ci`, so calling the primary
     a worktree wipes and reinstalls `node_modules` while a dozen agents work in
     it. Calling a worktree the primary merely refuses to set it up.

     The git spellings below are real, taken from a worktree built with
     `git worktree add` on 2026-09-01 — and the whole function was run against
     that worktree and the primary before this file was written: `false` for the
     primary, `true` for the worktree. */
  const primary = {
    dir: "/home/greg/code/spideryarn2/.git",
    common: "/home/greg/code/spideryarn2/.git",
  };
  const worktree = {
    dir: "/home/greg/code/spideryarn2/.git/worktrees/wt-spike",
    common: "/home/greg/code/spideryarn2/.git",
  };

  it("says false for the primary, where the two agree", () => {
    expect(inLinkedWorktree("/anywhere", () => primary)).toBe(false);
  });

  it("says true for a linked worktree, where its own git dir is nested", () => {
    expect(inLinkedWorktree("/anywhere", () => worktree)).toBe(true);
  });

  it("is not fooled by a trailing slash or a non-normalised path", () => {
    // Both come out of `git rev-parse` on some platforms, and a string compare
    // would call the primary a worktree — the dangerous direction.
    expect(
      inLinkedWorktree("/anywhere", () => ({
        dir: "/home/greg/code/spideryarn2/.git/",
        common: "/home/greg/code/spideryarn2/.git",
      })),
    ).toBe(false);
    expect(
      inLinkedWorktree("/anywhere", () => ({
        dir: "/home/greg/code/spideryarn2/./.git",
        common: "/home/greg/code/spideryarn2/.git",
      })),
    ).toBe(false);
  });

  it("agrees with a second, independent way of telling, in whichever checkout this is", () => {
    /* The one case that uses the real git. It deliberately does **not** assert
       `false`: this suite is meant to run inside a worktree, so a hardcoded
       answer would go red exactly where the feature is working.

       So compare against a different mechanism instead — in a linked worktree
       `.git` is a *file* holding `gitdir: …`, and in the primary it is a
       directory. Two unrelated signals agreeing is evidence; one signal
       compared with itself is not. */
    const dotGit = statSync(path.join(process.cwd(), ".git"));
    expect(inLinkedWorktree(process.cwd())).toBe(dotGit.isFile());
  });
});

describe("allowListedPorts", () => {
  /* The ports GoTrue will actually accept, read from supabase/config.toml —
     deliberately not `DEV_PORT_RANGE`, which is the range we *intend* to
     allow-list. On 2026-09-01 those were 1 port and 31 ports, and trusting the
     constant left the startup warning silent on 5274, where sign-in genuinely
     does not work. Found by running a worktree's dev server, not by reading. */
  it("pulls the ports out of the array, without the paths or the duplicates", () => {
    const toml = `
additional_redirect_urls = [
  "http://localhost:5273",
  "http://localhost:5273/**",
  "http://127.0.0.1:5273",
  "http://127.0.0.1:5273/**",
]
`;
    expect(allowListedPorts(toml)).toEqual([5273]);
  });

  it("returns them sorted when the list covers a range", () => {
    const toml = `additional_redirect_urls = ["http://localhost:5275", "http://localhost:5273/**", "http://127.0.0.1:5274"]`;
    expect(allowListedPorts(toml)).toEqual([5273, 5274, 5275]);
  });

  it("says nothing rather than guessing when the key is absent or empty", () => {
    // The caller treats an empty answer as "do not cry wolf", so this must not
    // invent a default.
    expect(allowListedPorts("site_url = \"http://localhost:5273\"")).toEqual([]);
    expect(allowListedPorts("additional_redirect_urls = []")).toEqual([]);
  });

  it("ignores a URL with no port, which would otherwise read as port 0", () => {
    const toml = `additional_redirect_urls = ["https://spideryarn.example", "http://localhost:5273"]`;
    expect(allowListedPorts(toml)).toEqual([5273]);
  });

  it("agrees with the real config file, whatever it currently says", () => {
    /* Asserts the *relationship*, not a number, so extending the allow-list does
       not turn this red. What it pins is the thing that was wrong: the warning's
       source of truth must be this file, and if the file ever covers the whole
       intended range then the range and the list agree — which is the state we
       are aiming at, not the state we are in. */
    const live = allowListedPorts(readFileSync("supabase/config.toml", "utf8"));
    expect(live.length).toBeGreaterThan(0);
    expect(live).toContain(PRIMARY_PORT);
    for (const port of live) expect(portInRange(port)).toBe(true);
  });
});

describe("describePorts", () => {
  it("collapses a contiguous run, because 31 ports listed out is unreadable", () => {
    // The warning printed all 31 as a comma list before this existed.
    expect(describePorts(devPorts())).toBe("5273–5303");
  });

  it("lists them when they are not contiguous, because then the gap is the point", () => {
    expect(describePorts([5273, 5290, 5299])).toBe("5273, 5290, 5299");
    expect(describePorts([5273, 5274])).toBe("5273, 5274");
  });

  it("says none rather than printing an empty string", () => {
    expect(describePorts([])).toBe("none");
  });
});
