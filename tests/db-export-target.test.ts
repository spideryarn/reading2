/**
 * **`db:export` must export the database you named, and say which one it was.**
 *
 * This is the rollback tool: the command somebody types after losing something,
 * pointed at the remote from a laptop that has a `.env.local`. Until 2026-09-03
 * it called `loadEnvLocal()` and nothing else, so `.env.local`'s `DATABASE_URL`
 * beat the one on the command line — src/env.ts § `resolveTargetUrl` is the
 * whole story — and `DATABASE_URL=<remote> npm run db:export` wrote out **the
 * laptop's local database**, printing `✓ <slug>` per article throughout. A
 * directory that looks like a backup of production and is a backup of a
 * developer machine. docs/reusable/silent-success.md, and
 * docs/project/database.md § `DATABASE_URL=… npm run db:migrate`, which had
 * named `db:export` as sharing the trap since 2026-09-01 without it being fixed.
 *
 * ## Why the port is the assertion, rather than the `Target:` line alone
 *
 * A script that printed the resolved URL and then *connected* to a different one
 * would satisfy a test that only reads `Target:` — and that failure is available
 * here for real, because `db:export` does not build its own pool: it goes
 * through `getDb()` and `postgresBlobStore()`, both of which read
 * `process.env.DATABASE_URL` for themselves. So the check that matters is that a
 * consumer *downstream of the resolution* saw the same database. The bucket
 * check in src/store/blobs.ts is that consumer, it names the port it read, and
 * it fires before anything opens a socket.
 *
 * ## Why a child process, and how the two candidates are set up
 *
 * The precedence rule lives in `src/env.ts`'s module-level snapshot of the
 * environment, so it can only be exercised by a real process start — and it has
 * to fire through the thing a person types, not through a function this file
 * imports.
 *
 * - **`SHELL_URL` is in the spawn environment**, so it is in the snapshot
 *   `src/env.ts` takes at module load. That is `DATABASE_URL=… npm run db:export`.
 * - **`ENV_LOCAL_URL` is assigned by the child after importing `src/env.ts`**,
 *   which is how a value that differs from the snapshot behaves: it wins over
 *   the real `.env.local`, and so stands in for it. Assigning it here rather
 *   than depending on this machine's actual `.env.local` is what makes the test
 *   say the same thing on a fresh clone.
 *
 * `shellWins: true` must therefore resolve to `SHELL_URL`, exactly as
 * `db-migrate` and `db-check` do.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Two loopback databases that are neither this repo's stack nor each other, and
 * a password sentinel in both.
 *
 * Loopback and *not* port 54362 on purpose: `projectMismatch` refuses that pair
 * by name and prints the port it read, which is the observable this test needs,
 * and it refuses before a connection is attempted — so no database is contacted
 * and neither port has to be listening.
 */
const PASSWORD = "hunter2-must-not-be-printed";
const SHELL_PORT = "59911";
const ENV_LOCAL_PORT = "59922";
const SHELL_URL = `postgresql://postgres:${PASSWORD}@127.0.0.1:${SHELL_PORT}/postgres`;
const ENV_LOCAL_URL = `postgresql://postgres:${PASSWORD}@127.0.0.1:${ENV_LOCAL_PORT}/postgres`;
/** This project's local Storage, per `supabase/config.toml`. Never reached. */
const LOCAL_API = "http://127.0.0.1:54361";

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** What landed in `--out`. Nothing should: it refuses before writing. */
  written: string[];
}

function runExport(): Run {
  const out = mkdtempSync(path.join(tmpdir(), "db-export-target-"));

  const body = `(async () => {
    /* The snapshot is taken here, holding the spawn environment's SHELL_URL. */
    await import(${JSON.stringify(path.join(ROOT, "src/env.ts"))});
    /* Assigned AFTER it, so these differ from the snapshot and \`.env.local\`
       leaves them alone — this line is standing in for \`.env.local\`. */
    Object.assign(process.env, ${JSON.stringify({
      DATABASE_URL: ENV_LOCAL_URL,
      SUPABASE_URL: LOCAL_API,
      SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
    })});
    process.argv = [process.argv[0], "db-export", "--out", ${JSON.stringify(out)}];
    await import(${JSON.stringify(path.join(ROOT, "scripts/db-export.ts"))});
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: SHELL_URL };

  const child = spawnSync(TSX, ["-e", body], { env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return {
    status: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    written: readdirSync(out),
  };
}

/**
 * A `tsx` start compiling the script and its imports, on a box several agents
 * share. tests/store-export-fails-closed.test.ts measured 11-19s apiece under
 * load and explains why a generous number is the right one.
 *
 * **240s rather than that file's 60s, and the number is measured rather than
 * guessed.** At load average 132 with 122 concurrent vitest processes — an
 * ordinary afternoon here — the same spawn took **2m10s wall for 6.9s of user
 * CPU**, so all but seven seconds of it was waiting for a core. 60s failed. A
 * timeout that fires on a busy box is not a test, it is a coin toss that
 * everybody learns to re-run, and this file guards a rollback script reading
 * the wrong database — the last guard anybody should teach themselves to
 * ignore. docs/postmortems/260902b-four-bugs-behind-one-word-flaky.md.
 */
const SPAWNS_A_PROCESS = 240_000;

describe("db:export resolves the database it was pointed at", () => {
  it("takes the shell's DATABASE_URL over .env.local, announces it, and hands it downstream", () => {
    const r = runExport();
    const said = `${r.stdout}\n${r.stderr}`;

    /* The line CLAUDE.md tells every agent to read instead of the success line,
       and the same one db-migrate and db-check print. */
    expect(r.stdout, said).toContain("Target:");
    expect(r.stdout, said).toContain(`127.0.0.1:${SHELL_PORT}`);
    expect(r.stdout, said).not.toContain(ENV_LOCAL_PORT);

    /* And the resolution reached the code that actually opens things: the
       bucket check reads `process.env.DATABASE_URL` for itself, so the port it
       names is the port this run would have exported. */
    expect(r.stderr, said).toContain(`DATABASE_URL is on port ${SHELL_PORT}`);
    expect(r.stderr, said).not.toContain(ENV_LOCAL_PORT);

    /* Refused, before writing anything and before opening a socket. */
    expect(r.status, said).not.toBe(0);
    expect(r.written).toEqual([]);
    expect(said).not.toMatch(/ENOTFOUND|ECONNREFUSED|getaddrinfo/);

    /* The `Target:` line is only worth having if it can be pasted into a bug
       report, so it goes through `withoutPassword` like its siblings'. */
    expect(said).not.toContain(PASSWORD);
  }, SPAWNS_A_PROCESS);
});
