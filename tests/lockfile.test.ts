/**
 * The lock, shown failing to be held twice.
 *
 * Three bugs are pinned here, each watched going red against the code that had
 * it (docs/reusable/silent-success.md, and the header of scripts/lockfile.ts):
 *
 * 1. check-then-act — the original `existsSync` + `openSync(f,"w")`;
 * 2. an exit hook deleting a *later* owner's lock;
 * 3. two processes both stealing the same stale lock.
 *
 * The third is the one that matters most and the one an earlier version of this
 * file could not see: every test passed against an implementation that let two
 * holders through. Where a test cannot force an interleaving, it drives the
 * pieces directly rather than pretending.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LockHeldError, readLockHolder, takeLockFile } from "../scripts/lockfile.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spideryarn-lock-test-"));
  file = path.join(dir, "test.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A lock file written by somebody else, with a pid that is certainly not ours. */
function foreignLock(pid = 999999, token = "someone-elses-token"): void {
  writeFileSync(file, `${pid}\n2026-01-01T00:00:00.000Z\n${token}\n`);
}

describe("claiming", () => {
  it("refuses a second claim while the first is held", () => {
    takeLockFile(file, { isAlive: () => true });
    expect(() => takeLockFile(file, { isAlive: () => true })).toThrow(LockHeldError);
  });

  it("names the holder rather than only refusing", () => {
    takeLockFile(file, { isAlive: () => true });
    try {
      takeLockFile(file, { isAlive: () => true });
      expect.unreachable("second claim should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LockHeldError);
      expect((err as LockHeldError).holder.pid).toBe(process.pid);
      expect((err as LockHeldError).holderAlive).toBe(true);
    }
  });

  it("creates the file and records this process", () => {
    takeLockFile(file, { isAlive: () => true });
    expect(existsSync(file)).toBe(true);
    expect(readLockHolder(file)?.pid).toBe(process.pid);
  });

  it("allows a fresh claim after release", () => {
    takeLockFile(file, { isAlive: () => true }).release();
    expect(existsSync(file)).toBe(false);
    expect(() => takeLockFile(file, { isAlive: () => true })).not.toThrow();
  });

  it("leaves no temporary files behind", () => {
    /* The claim writes a private file and links it into place. A leaked `.tmp`
       would be invisible to every other assertion here. */
    takeLockFile(file, { isAlive: () => true }).release();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("a lock is never stolen", () => {
  /**
   * The finding two rounds of review took to surface. `read it, decide it is
   * dead, unlink, create` lets two processes both take the same leftover: the
   * second unlinks the *first one's* new lock. There is no unlink-if-unchanged
   * in POSIX, so the only safe answer is not to steal.
   */
  it("refuses a leftover whose process is gone, rather than taking it", () => {
    foreignLock();
    expect(() => takeLockFile(file, { isAlive: () => false })).toThrow(LockHeldError);
  });

  it("leaves the leftover exactly where it was", () => {
    foreignLock();
    const before = readFileSync(file, "utf8");
    expect(() => takeLockFile(file, { isAlive: () => false })).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("says the holder is gone, and how to clear it", () => {
    foreignLock();
    try {
      takeLockFile(file, { isAlive: () => false });
      expect.unreachable("should have refused");
    } catch (err) {
      const e = err as LockHeldError;
      expect(e.holderAlive).toBe(false);
      expect(e.message).toContain(`rm ${file}`);
    }
  });

  it("two contenders finding the same leftover both refuse", () => {
    /* The interleaving that produced two holders. Both see the same stale file,
       and neither may end up owning it. */
    foreignLock();
    const attempt = () => {
      try {
        takeLockFile(file, { isAlive: () => false });
        return "took it";
      } catch {
        return "refused";
      }
    };
    expect([attempt(), attempt()]).toEqual(["refused", "refused"]);
    expect(readLockHolder(file)?.pid).toBe(999999);
  });

  it("still refuses when the holder is alive", () => {
    foreignLock();
    expect(() => takeLockFile(file, { isAlive: () => true })).toThrow(LockHeldError);
  });

  it("treats a garbled lock file as held, not as free", () => {
    /* Was the opposite, and blessed by a test. A half-written file can be a live
       claimant whose metadata has not landed yet, so "unparseable means dead"
       hands the lock to a second holder. */
    writeFileSync(file, "not-a-pid\n");
    expect(() => takeLockFile(file)).toThrow(LockHeldError);
  });

  it("never publishes a lock file without its contents", () => {
    /* `open(…,"wx")` makes the path visible before the write. A contender
       reading in that window sees an empty file and calls the holder dead. The
       claim links a fully-written file into place instead, so any lock another
       process can see already has a pid in it. */
    takeLockFile(file, { isAlive: () => true, token: "t" });
    const holder = readLockHolder(file);
    expect(holder?.pid).toBe(process.pid);
    expect(readFileSync(file, "utf8")).toBe(`${process.pid}\n${holder?.since}\nt\n`);
  });
});

describe("releasing something you no longer own", () => {
  it("does not delete a lock another process has since taken", () => {
    const held = takeLockFile(file, { isAlive: () => true });
    held.release();
    foreignLock();
    held.release();
    expect(existsSync(file)).toBe(true);
    expect(readLockHolder(file)?.pid).toBe(999999);
  });

  it("still deletes its own lock", () => {
    takeLockFile(file, { isAlive: () => true }).release();
    expect(existsSync(file)).toBe(false);
  });

  it("is idempotent even after somebody else owns the path", () => {
    const held = takeLockFile(file, { isAlive: () => true });
    held.release();
    foreignLock();
    expect(() => {
      held.release();
      held.release();
    }).not.toThrow();
    expect(existsSync(file)).toBe(true);
  });

  it("does not accumulate an exit listener per lock", () => {
    const before = process.listenerCount("exit");
    for (let i = 0; i < 10; i++) takeLockFile(file, { isAlive: () => true }).release();
    expect(process.listenerCount("exit")).toBe(before);
  });
});

describe("the exit hook, in a real process", () => {
  /* An in-process test cannot exit, so these run node for real. Without them the
     exit hook is the one part of this file nothing exercises.

     Generous timeouts: each spawns `npx tsx`, which is seconds rather than
     milliseconds, and this repo's tree routinely runs a dozen agents at once —
     the default 5s turned all three red while the mechanism was fine. */
  const SPAWN_TIMEOUT = 60_000;
  const child = (body: string, name: string) => {
    const script = path.join(dir, name);
    const mod = path.resolve("scripts/lockfile.ts");
    writeFileSync(script, `import { takeLockFile } from ${JSON.stringify(mod)};\n${body}\n`);
    return script;
  };

  it("releases the lock when the process exits without releasing", () => {
    const s = child(`takeLockFile(${JSON.stringify(file)});`, "plain.mts");
    execFileSync("npx", ["tsx", s], { stdio: "pipe" });
    expect(existsSync(file)).toBe(false);
  }, SPAWN_TIMEOUT);

  it("releases it when the process throws", () => {
    const s = child(`takeLockFile(${JSON.stringify(file)});\nthrow new Error("boom");`, "throwing.mts");
    expect(() => execFileSync("npx", ["tsx", s], { stdio: "pipe" })).toThrow();
    expect(existsSync(file)).toBe(false);
  }, SPAWN_TIMEOUT);

  it("does not delete a lock a later owner holds", () => {
    /* Claim, release, let somebody else claim, then exit. The stale hook must
       not take their file with it. */
    const s = child(
      `import { writeFileSync } from "node:fs";\n` +
        `takeLockFile(${JSON.stringify(file)}).release();\n` +
        `writeFileSync(${JSON.stringify(file)}, "999999\\nlater\\ntheirs\\n");`,
      "later-owner.mts",
    );
    execFileSync("npx", ["tsx", s], { stdio: "pipe" });
    expect(existsSync(file)).toBe(true);
    expect(readLockHolder(file)?.token).toBe("theirs");
  }, SPAWN_TIMEOUT);
});

describe("readLockHolder", () => {
  it("returns null when there is no file", () => {
    expect(readLockHolder(path.join(dir, "absent.lock"))).toBeNull();
  });

  it("reads back what was written", () => {
    writeFileSync(file, "4321\n2026-08-28T10:00:00.000Z\ntok-1\n");
    expect(readLockHolder(file)).toEqual({ pid: 4321, since: "2026-08-28T10:00:00.000Z", token: "tok-1" });
  });

  it("throws rather than reporting 'no lock' when the read fails for another reason", () => {
    /* A directory is EISDIR, not ENOENT. Returning null here would say "nobody
       holds this" about something we could not read — the fail-open again. */
    let code: string | undefined;
    try {
      readLockHolder(dir);
    } catch (err) {
      code = (err as NodeJS.ErrnoException).code;
    }
    expect(code).toBe("EISDIR");
  });
});

describe("errors that are not EEXIST", () => {
  it("throws ENOENT rather than reporting the lock as taken", () => {
    let err: NodeJS.ErrnoException | undefined;
    try {
      takeLockFile(path.join(dir, "no-such-dir", "test.lock"));
    } catch (e) {
      err = e as NodeJS.ErrnoException;
    }
    expect(err?.code).toBe("ENOENT");
    expect(err).not.toBeInstanceOf(LockHeldError);
  });
});

describe("the file it writes", () => {
  it("has the pid, a timestamp and a token, one per line", () => {
    takeLockFile(file, {
      isAlive: () => true,
      now: () => new Date("2026-08-28T09:00:00.000Z"),
      token: "fixed-token",
    });
    expect(readFileSync(file, "utf8")).toBe(`${process.pid}\n2026-08-28T09:00:00.000Z\nfixed-token\n`);
  });
});
