/**
 * **A VOID that was not void.** The readiness loop recorded two `check` runs
 * VOID — "it exited 0, but its own summary is not in the output" — although
 * `npm run check`'s own last lines are exactly that summary
 * (`scripts/check.ts`'s `All gates green.` / `A gate failed.`, which
 * `tools/fleet/readiness-parse.ts`'s `parseCheckTable` reads for
 * `footerRequired`). Both void logs' tails stopped mid-advisory, right where
 * the summary should have started.
 *
 * The cause is a well-known Node gotcha and not a logic bug in the parser:
 * `scripts/check.ts` (and `scripts/typecheck.ts`, read by the same
 * `footerRequired` gate) printed their footer with `console.log` and then
 * called `process.exit(code)` on the very next line. `readiness-run.ts`
 * spawns `npm run <script>` with `stdio: ["ignore", "pipe", "pipe"]` — and on
 * a pipe, `process.exit()` can terminate the process before Node has handed
 * everything still queued in its own write buffer to the kernel. Whatever
 * didn't make it out before the process died is gone, silently — the exit
 * code is still 0, and the reader just never sees the tail of the output.
 * Reproduced directly below, deterministically. The fix is `process.exitCode = code` and
 * falling off the end of the script instead: Node then drains stdout before
 * actually exiting.
 */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");

/** Generated inside the child, not passed on argv — 200 KiB exceeds the
 * ordinary Linux and macOS pipe capacities. The exact capacity is not asserted. */
const BIG = 200 * 1024;
const WRITE_BIG = `process.stdout.write('A'.repeat(${BIG}));`;

/** The child with a live reader on its stdout — `readiness-run.ts`'s shape. */
function run(tail: string): { stdout: string; status: number | null } {
  const result = spawnSync(process.execPath, ["-e", `${WRITE_BIG} ${tail}`], {
    encoding: "utf8",
    timeout: 10_000,
    killSignal: "SIGKILL",
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout, status: result.status };
}

/**
 * The child with a reader that does not read until the child has exited.
 *
 * With a live reader the loss is a race, not a certainty: the reader can drain
 * the pipe while Node is writing, so all 200 KiB and the footer sometimes
 * get out before `process.exit()`. Measured
 * on the box on 2026-10-11, the footer survived in about a quarter of runs —
 * which is how this test, when it used `run()`, failed deploy gates on a
 * loaded box. The real VOIDs were the same race going the other way.
 *
 * Stalling the reader takes the race out: nothing drains the pipe while the
 * child lives, so the child can hand the kernel at most one pipe buffer and
 * whatever Node had queued behind it — the footer included — is lost every
 * time on Linux and macOS with their ordinary pipe capacities. `sh` waits on
 * the exit-status file, so load cannot reorder the reader and child exit.
 * A separate timeout kills the entire pipeline on failure: a child that drains
 * before exiting would otherwise wait forever for a reader that waits for it.
 */
async function runWithStalledReader(tail: string): Promise<{ stdout: string; status: number }> {
  const dir = mkdtempSync(path.join(tmpdir(), "check-exit-"));
  try {
    const status = path.join(dir, "status");
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        '{ "$NODE" -e "$JS"; printf "%s\\n" "$?" > "$STATUS.tmp" && /bin/mv "$STATUS.tmp" "$STATUS"; } | { until [ -e "$STATUS" ]; do /bin/sleep 0.01; done; /bin/cat; }',
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE: process.execPath, JS: `${WRITE_BIG} ${tail}`, STATUS: status },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // detached gives the shell and its pipeline their own Unix process group.
      // Killing only the shell would leave the polling reader/blocked writer alive.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }, 10_000);
    try {
      const [code] = await once(child, "close");
      expect(timedOut, "stalled-reader pipeline must finish within 10 seconds").toBe(false);
      expect(code, stderr).toBe(0);
      const exitStatus = readFileSync(status, "utf8");
      expect(exitStatus).toMatch(/^\d+\n$/);
      return { stdout, status: Number(exitStatus.trim()) };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("process.exit() can drop a check script's own footer from a pipe", () => {
  it("loses output queued after a big write when the child calls process.exit()", async () => {
    const { stdout, status } = await runWithStalledReader("console.log('FOOTER'); process.exit(0);");
    // The exit code still says "fine" — that is exactly how this read VOID.
    expect(status).toBe(0);
    // Some output did arrive, so the stalled reader is a reader, not a dead pipe…
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toMatch(/^A+$/);
    // …but not all of it, and not the footer.
    expect(stdout.length).toBeLessThan(BIG);
    expect(stdout.includes("FOOTER")).toBe(false);
  });

  it("keeps the same output when the child sets exitCode and exits naturally", () => {
    const { stdout, status } = run("console.log('FOOTER'); process.exitCode = 0;");
    expect(status).toBe(0);
    expect(stdout.length).toBe(BIG + "FOOTER\n".length);
    expect(stdout.includes("FOOTER")).toBe(true);
  });
});

/**
 * `footerRequired()` (tools/fleet/readiness-parse.ts) trusts `check` and
 * `typecheck` runs only because their last act is printing a footer line —
 * so their actual last statement must not be the one Node's docs warn
 * truncates a pipe. Guards against either script growing a trailing
 * `process.exit(...)` back in, which is exactly how this broke: nothing
 * about the footer text changed, only the exit call after it.
 */
describe("a check script's last statement must not be process.exit()", () => {
  for (const file of ["scripts/check.ts", "scripts/typecheck.ts"]) {
    it(file, () => {
      const lines = readFileSync(path.join(REPO, file), "utf8")
        .trimEnd()
        .split("\n")
        .filter((l) => l.trim() !== "");
      const last = lines[lines.length - 1] ?? "";
      expect(last).toMatch(/^process\.exitCode = .+;$/);
      expect(last).not.toMatch(/process\.exit\(/);
    });
  }
});
