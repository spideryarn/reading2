/**
 * **One temp directory per test run, removed when the run ends.**
 *
 * 243 test files `mkdtemp` under `os.tmpdir()` themselves and most never remove what they made:
 * about 50,000 directories a day reached the box's `/tmp`, which held 150 GB and kept `/` at
 * 84–89% (queue item qi-4b5598e2, plan 261009a). There is no shared helper to fix, so the fix is
 * the one thing they all share: `os.tmpdir()` reads `TMPDIR` on every call, and a worker — and any
 * child it spawns without its own `env:` — inherits it. vitest.config.ts calls this before any
 * worker exists, and every leak lands in a directory that goes when the run does.
 *
 * Not caught: a literal `/tmp/...` path, a child spawned with an `env:` that drops `TMPDIR`, and a
 * run that dies without reaching `exit` (SIGKILL, OOM, SIGHUP). Ctrl-C and SIGTERM do reach it:
 * vitest turns them into `process.exit()`. What a killed run leaves is one directory, not
 * thousands, and the box ages `/tmp` out after seven days (plan 261007j).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Short on purpose: tsx puts an IPC socket under `TMPDIR`, and a socket path is capped at 108
 *  bytes on Linux and 104 on macOS. A long root broke the private lane's migrator the first time
 *  this was measured. */
export const RUN_TEMP_PREFIX = "syv-";

/** Names the root this run made, so a second evaluation of the config — a watch-mode reload, or
 *  tests/vitest-worker-caps.test.ts calling createVitest() inside a worker — reuses it rather
 *  than nesting a new root inside the old one. */
export const RUN_TEMP_ROOT_ENV = "SPIDERYARN_RUN_TEMP_ROOT";

/** Make this run's root under the current temp dir, point `TMPDIR` at it, and remove it on exit.
 *  Inside a run that already has one, return it and change nothing: only the process that made a
 *  root removes it. */
export function makeRunTempRoot(parent: string = tmpdir()): string {
  const inherited = process.env[RUN_TEMP_ROOT_ENV];
  if (inherited !== undefined && process.env.TMPDIR === inherited) return inherited;
  const root = mkdtempSync(path.join(parent, `${RUN_TEMP_PREFIX}${process.pid}-`));
  process.env[RUN_TEMP_ROOT_ENV] = root;
  process.env.TMPDIR = root;
  // Synchronous on purpose: nothing asynchronous runs inside an `exit` listener.
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
  return root;
}
