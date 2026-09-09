/**
 * The deploys composition, in one importable place.
 *
 * **The same lesson `health-wiring.ts` exists for.** A test that builds its own
 * record path and its own probe, hands them to its own `deploysRoute` and reads
 * the answer back proves the route works — and stays green if `server.ts` mounts
 * it against a *different* path, which is the whole failure. So the composition
 * lives here, `server.ts` holds nothing but a call to it, and
 * `tests/fleet-deploys-route.test.ts` drives **the same function the server
 * does**.
 *
 * What that still cannot prove is that `server.ts` calls `route.handle` in its
 * request path — that line is in a file no test can import, because importing it
 * binds port 8787. A source check covers it, the same guard
 * `tests/fleet-health-wiring.test.ts` uses.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gitProbe } from "./git-probe.js";
import { deploysRoute, readRecordFrom, type DeploysPayload } from "./routes-deploys.js";

/**
 * The repository this dashboard is running out of.
 *
 * `tools/fleet/` → up two. Derived from this module's own location rather than
 * from `process.cwd()`, which is whatever directory somebody happened to start
 * the server from and has been the wrong answer before.
 */
export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Where the deploy record lives.
 *
 * Under `src/web/` because it is imported by the public `/changelog` page
 * through Vite's `?raw` — docs/project/changelog.md § The page. This tool only
 * ever reads it.
 */
export const RECORD_PATH = path.join(REPO_ROOT, "src", "web", "changelog-versions.ndjson");

export type DeploysWiring = {
  route: {
    handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean;
  };
  /** What to say at startup: which record, and which checkout it is reading git from. */
  lines: { log: string[] };
};

export function makeDeploys(options: { repoRoot?: string; recordPath?: string } = {}): DeploysWiring {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const recordPath = options.recordPath ?? RECORD_PATH;

  return {
    route: deploysRoute({
      readRecord: readRecordFrom(recordPath),
      git: gitProbe({ repoRoot }),
      nowMs: () => Date.now(),
    }),
    /* Named at startup rather than only on a request, because "the dashboard is
       reading a record that is not the one you are editing" is a thing you want
       to find in the log rather than by disbelieving a number on a phone. */
    lines: { log: [`deploys record → ${recordPath}`] },
  };
}

export type { DeploysPayload };
