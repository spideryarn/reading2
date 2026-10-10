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
 * Reproduced directly below. The fix is `process.exitCode = code` and
 * falling off the end of the script instead: Node then drains stdout before
 * actually exiting.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");

/** Generated inside the child, not passed on argv — 200 KiB comfortably past
 * a Linux pipe's default kernel buffer (64 KiB), and argv has no such room. */
const WRITE_BIG = "process.stdout.write('A'.repeat(200 * 1024));";

function run(tail: string): { stdout: string; status: number | null } {
  const result = spawnSync(process.execPath, ["-e", `${WRITE_BIG} ${tail}`], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout, status: result.status };
}

describe("process.exit() can drop a check script's own footer from a pipe", () => {
  it("loses output queued after a big write when the child calls process.exit()", () => {
    const { stdout, status } = run("console.log('FOOTER'); process.exit(0);");
    // The exit code still says "fine" — that is exactly how this read VOID.
    expect(status).toBe(0);
    expect(stdout.includes("FOOTER")).toBe(false);
  });

  it("keeps the same output when the child sets exitCode and exits naturally", () => {
    const { stdout, status } = run("console.log('FOOTER'); process.exitCode = 0;");
    expect(status).toBe(0);
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
