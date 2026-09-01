/**
 * The port allocator, each property shown failing before it was trusted.
 *
 * This file exists because the thing it replaces looked fine. The plan proposed
 * hashing a worktree name into the range; GPT Sol pointed out that at ten
 * worktrees in a 30-wide range that collides ~99.96% of the time, and that the
 * failure is not a crash — the first server answers for the port and an agent
 * screenshots a peer's work and reports success.
 *
 * **Then Sol reviewed this file's first version and two of its stated properties
 * turned out to be false**, which is worth recording because both were the kind
 * a passing suite endorses:
 *
 *  - "the port is held" — it was a `takeLockFile`, released by `process.on("exit")`,
 *    so the one-shot `worktree:setup` that claims it would drop it on the way out.
 *    Untestable here by construction: every lease in this file lives inside one
 *    vitest process, which is precisely the case that works.
 *  - "a port outside the range is refused" — only `want` was validated, so the
 *    exported `ports` option walked straight past the guard.
 *
 * See scripts/worktree-port.ts and docs/project/worktrees.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  allocatable,
  allocatablePorts,
  DEV_PORT_RANGE,
  devPorts,
  parseDevPortEnv,
  portInRange,
  PRIMARY_PORT,
  readReservation,
  reservationDir,
  reservedPorts,
  reservePort,
} from "../scripts/worktree-port.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spya-ports-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the range", () => {
  it("starts at 5273, so the primary keeps the port every doc names", () => {
    // Not cosmetic: supabase/config.toml's allow-list names 5273 by number and
    // GoTrue bakes it in at start, so moving it breaks Google sign-in.
    expect(devPorts()[0]).toBe(5273);
    expect(PRIMARY_PORT).toBe(5273);
  });

  it("has room for the thirty worktrees Greg asked about, plus the primary", () => {
    expect(allocatablePorts()).toHaveLength(30);
    expect(devPorts()).toHaveLength(31);
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

  it("never offers the primary's port to a worktree", () => {
    expect(allocatablePorts()).not.toContain(PRIMARY_PORT);
    expect(allocatable(PRIMARY_PORT)).toBe(false);
    expect(portInRange(PRIMARY_PORT)).toBe(true);
  });
});

describe("parseDevPortEnv", () => {
  it("treats absent and empty as 'the primary', which is what they mean", () => {
    expect(parseDevPortEnv(undefined)).toBeUndefined();
    expect(parseDevPortEnv("")).toBeUndefined();
    expect(parseDevPortEnv("   ")).toBeUndefined();
  });

  it("throws on a set-but-unparseable value rather than falling back to 5273", () => {
    // The fallback was the bug: a worktree with a malformed port variable
    // silently became a second server on the primary's port.
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

describe("reservePort", () => {
  it("takes the first allocatable port, which is not the primary's", () => {
    const r = reservePort({ dir });
    expect(r.port).toBe(5274);
    r.release();
  });

  it("steps past a port somebody else holds instead of fighting for it", () => {
    const first = reservePort({ dir });
    const second = reservePort({ dir });
    expect([first.port, second.port]).toEqual([5274, 5275]);
    first.release();
    second.release();
  });

  it("records who holds a port, so a full range can name them", () => {
    const r = reservePort({ dir, holder: "/wt/alpha", now: () => new Date("2026-09-01T10:00:00Z") });
    const read = readReservation(path.join(dir, `${r.port}.reserved`));
    expect(read).toEqual({ port: 5274, holder: "/wt/alpha", since: "2026-09-01T10:00:00.000Z" });
  });

  it("reuses a released port rather than drifting up the range", () => {
    const a = reservePort({ dir });
    a.release();
    const b = reservePort({ dir });
    expect(b.port).toBe(5274);
    b.release();
  });

  it("refuses the primary's port by name, not as a generic range error", () => {
    expect(() => reservePort({ dir, want: PRIMARY_PORT })).toThrow(
      /belongs to the primary checkout/,
    );
  });

  it("refuses a requested port outside the range, naming the real consequence", () => {
    // One past the end, computed rather than written, so widening the range
    // cannot quietly turn this case into an in-range one — which is exactly how
    // the first draft of this test fooled itself.
    const justPast = DEV_PORT_RANGE.first + DEV_PORT_RANGE.count;
    expect(() => reservePort({ dir, want: justPast })).toThrow(/outside the worktree range/);
    expect(() => reservePort({ dir, want: justPast })).toThrow(/drops the return path/);
    expect(() => reservePort({ dir, want: 3000 })).toThrow(/outside the worktree range/);
  });

  it("validates injected candidates too, not only `want`", () => {
    // Sol's finding 5: `ports` is an exported option, so a guard that only
    // covered `want` made the stated invariant false.
    expect(() => reservePort({ dir, ports: [9999] })).toThrow(/outside the worktree range/);
    expect(() => reservePort({ dir, ports: [5274, 9999] })).toThrow(/outside the worktree range/);
    expect(() => reservePort({ dir, ports: [PRIMARY_PORT] })).toThrow(/primary checkout/);
  });

  it("writes nothing when it refuses", () => {
    expect(() => reservePort({ dir, want: 99999 })).toThrow();
    expect(() => reservePort({ dir, ports: [9999] })).toThrow();
    expect(reservedPorts(dir)).toEqual([]);
  });

  it("honours a requested in-range port", () => {
    const r = reservePort({ dir, want: 5280 });
    expect(r.port).toBe(5280);
    r.release();
  });

  it("says who holds the requested port rather than handing over another", () => {
    const mine = reservePort({ dir, want: 5281, holder: "/wt/alpha" });
    expect(() => reservePort({ dir, want: 5281 })).toThrow(/already reserved by \/wt\/alpha/);
    mine.release();
  });

  it("refuses when every allocatable port is taken, and says how to look", () => {
    const held = allocatablePorts().map((port) => reservePort({ dir, want: port }));
    expect(() => reservePort({ dir })).toThrow(/all 30 worktree ports are reserved/);
    expect(() => reservePort({ dir })).toThrow(/read one before deleting it/);
    for (const r of held) r.release();
  });
});

describe("reservedPorts", () => {
  it("reports an absent directory as nothing reserved, and nothing else", () => {
    expect(reservedPorts(path.join(dir, "never-created"))).toEqual([]);
  });

  it("lists what is held, in order", () => {
    const a = reservePort({ dir, want: 5290 });
    const b = reservePort({ dir, want: 5275 });
    expect(reservedPorts(dir)).toEqual([5275, 5290]);
    a.release();
    b.release();
    expect(reservedPorts(dir)).toEqual([]);
  });

  it("ignores a stray file whose name merely looks numeric", () => {
    // Sol's finding 6: stripping `.lock` off `5273` left `5273`, so a stray file
    // read as a reservation and a port nobody held looked taken.
    writeFileSync(path.join(dir, "5299"), "");
    writeFileSync(path.join(dir, "5298.reserved.tmp"), "");
    writeFileSync(path.join(dir, "notes.txt"), "");
    mkdirSync(path.join(dir, "5297.reserved"));
    expect(reservedPorts(dir)).toEqual([]);
  });
});

describe("release", () => {
  it("removes the reservation, and is safe to call twice", () => {
    const r = reservePort({ dir });
    expect(readdirSync(dir)).toEqual(["5274.reserved"]);
    r.release();
    expect(readdirSync(dir)).toEqual([]);
    expect(() => r.release()).not.toThrow();
  });
});

describe("reservationDir", () => {
  it("sits inside the shared git directory, which is what every worktree sees", () => {
    // Worktrees have separate working directories and one repository. Putting
    // these anywhere else makes them invisible to the peers they exist to
    // coordinate with — and this location cannot be committed by accident.
    expect(reservationDir("/repo/.git")).toBe("/repo/.git/spideryarn-worktree-ports");
  });
});

describe("the reservation file itself", () => {
  it("is written whole, so a reader never sees an empty one", () => {
    // `publishExclusive` links a fully-written temp into place rather than
    // creating the path and then filling it — see scripts/lockfile.ts.
    const r = reservePort({ dir, holder: "/wt/alpha" });
    const body = readFileSync(path.join(dir, `${r.port}.reserved`), "utf8");
    expect(body.split("\n")[0]).toBe("/wt/alpha");
    r.release();
  });
});

describe("outliving the process that made it, for real", () => {
  /* **The one property an in-process test cannot check, and the one that was
     wrong.** `worktree:setup` reserves a port and exits, so the reservation has
     to survive that. A `takeLockFile` does not, and no test in this file could
     have shown it: every reservation here lives inside one vitest process, which
     is exactly the case where a lock looks fine.

     An earlier version of this file "covered" it by making a second in-process
     call and asserting it got the next port — which passes with a lock too, so
     it proved nothing. That is docs/reusable/silent-success.md in miniature: the
     check shared its assumption with the code.

     Generous timeout: spawning `npx tsx` is seconds, and this tree routinely
     runs a dozen agents at once. */
  const SPAWN_TIMEOUT = 60_000;

  const child = (body: string, name: string) => {
    const script = path.join(dir, name);
    const mod = path.resolve("scripts/worktree-port.ts");
    writeFileSync(script, `import { reservePort } from ${JSON.stringify(mod)};\n${body}\n`);
    return script;
  };

  it("keeps the reservation after the claiming process has gone", () => {
    const s = child(
      `const r = reservePort({ dir: ${JSON.stringify(dir)}, holder: "/wt/from-a-child" });\n` +
        `console.log(r.port);`,
      "claim-and-exit.mts",
    );
    const out = execFileSync("npx", ["tsx", s], { encoding: "utf8" }).trim();
    expect(out).toBe("5274");

    // The process is gone. The reservation must not be.
    expect(reservedPorts(dir)).toEqual([5274]);
    expect(readReservation(path.join(dir, "5274.reserved"))?.holder).toBe("/wt/from-a-child");
  }, SPAWN_TIMEOUT);

  it("gives a second run a different port, because the first still holds one", () => {
    const s = (name: string, holder: string) =>
      child(
        `const r = reservePort({ dir: ${JSON.stringify(dir)}, holder: ${JSON.stringify(holder)} });\n` +
          `console.log(r.port);`,
        name,
      );
    const first = execFileSync("npx", ["tsx", s("setup-a.mts", "/wt/a")], { encoding: "utf8" }).trim();
    const second = execFileSync("npx", ["tsx", s("setup-b.mts", "/wt/b")], { encoding: "utf8" }).trim();
    expect([first, second]).toEqual(["5274", "5275"]);
    expect(reservedPorts(dir)).toEqual([5274, 5275]);
  }, SPAWN_TIMEOUT);
});
