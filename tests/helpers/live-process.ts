/**
 * The worktree suites' "somebody else is in this tree" fixture: a live `sleep`
 * (or an explicitly supplied command) with its cwd in `cwd`, that is **not
 * this process's descendant**.
 *
 * Not a plain child, for two reasons that each cost a red test. The cwd scan
 * excludes the asker's own descendants (tsx's esbuild service inherits the cwd,
 * and a removal run from inside its tree refused over it), and in these tests
 * the asker is this very process — so a child would be excluded and a test of
 * "a process is running inside it" would pass by excluding the process it
 * arranged. So `sh` backgrounds the `sleep` and exits, and the `sleep` is
 * reparented away from us.
 *
 * Waits for the cwd to be readable as `cwd` — through `/proc` on Linux, through
 * `lsof` on the Mac — rather than racing the child's setup. Returns the start
 * time a lock would carry: `/proc` field 22 on Linux, and `0` on the Mac, whose
 * lock check is pid-only (scripts/worktree-inuse.ts § macOS).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readlinkSync, realpathSync } from "node:fs";

import { parseStat } from "../../scripts/worktree-inuse.js";

/** This process's lock start time: `/proc` field 22 on Linux, unused (`0`) on the Mac. */
export function myLockStart(): number {
  if (process.platform === "darwin") return 0;
  const mine = parseStat(readFileSync(`/proc/${process.pid}/stat`, "utf8"));
  if (mine === null) throw new Error("could not read this process's start time");
  return mine.start;
}

export function orphanProcessIn(cwd: string, command: readonly string[] = ["sleep", "120"]): { pid: number; start: number } {
  const r = spawnSync("sh", ["-c", '"$@" >/dev/null 2>&1 </dev/null & echo $!', "worktree-fixture", ...command], { cwd, encoding: "utf8" });
  const pid = Number.parseInt(`${r.stdout ?? ""}`.trim(), 10);
  if (r.status !== 0 || !Number.isFinite(pid)) throw new Error(`could not start peer fixture: ${r.stderr}`);

  const want = realpathSync(cwd);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      if (process.platform === "darwin") {
        const lsof = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-F", "n"], { encoding: "utf8" });
        const at = `${lsof.stdout ?? ""}`.split("\n").find((l) => l.startsWith("n"))?.slice(1);
        if (at === want) return { pid, start: 0 };
      } else {
        const stat = parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
        if (stat !== null && stat.ppid !== process.pid && readlinkSync(`/proc/${pid}/cwd`) === want) {
          return { pid, start: stat.start };
        }
      }
    } catch {
      /* Still starting, or exited; the deadline turns either into a hard fail. */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error("peer fixture never became a live process in the requested cwd");
}
