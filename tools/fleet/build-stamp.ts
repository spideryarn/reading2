/**
 * **What bundle is on disk**: the fleet client's build stamp, written by
 * `vite.fleet.config.ts` beside the bundle, and read back by the server.
 *
 * One of three facts the plan keeps apart (docs/plans/260910f D3): what the
 * server started from (`revision.ts`, read once at start), what bundle is on
 * disk NOW (this file, read per request, because a rebuild replaces it under a
 * running server), and what bundle a browser tab is running (`__FLEET_BUILD__`,
 * compiled in). A mismatch between any two is shown. A stamp that is missing
 * or unreadable is `unknown`, with the reason, and is never defaulted — a
 * default would later read as "same as the server", which is the one
 * conclusion absence must not produce.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseStartRevision, readStartRevision, type RunGit } from "./revision.js";
import type { BuildStamp } from "./wire.js";

export type { BuildStamp } from "./wire.js";

/** Beside `index.html` in `tools/fleet/web/dist/`. */
export const BUILD_STAMP_FILE = "build-stamp.json";

/**
 * The stamp for a build of the checkout containing `dir`, taken now. Called
 * once per `vite build`, at config load. An unreadable checkout still builds,
 * stamped `unknown`: a build must not fail over a diagnostic.
 */
export function buildStamp(dir: string, deps: { run?: RunGit; now?: () => Date } = {}): BuildStamp {
  const now = deps.now ?? (() => new Date());
  return { ...readStartRevision(dir, { ...deps, now }), builtAt: now().toISOString() };
}

export type ReadBuildStamp = { kind: "stamp"; stamp: BuildStamp } | { kind: "unknown"; why: string };

/** The stamp in `distDir`, or why there is none. Four reasons, four sentences. */
export function readBuildStamp(distDir: string): ReadBuildStamp {
  const path = join(distDir, BUILD_STAMP_FILE);
  if (!existsSync(path)) {
    return { kind: "unknown", why: `no build stamp at ${path}: the bundle was built before stamps existed, or not by vite.fleet.config.ts` };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    return { kind: "unknown", why: `${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { kind: "unknown", why: `${path} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const revision = parseStartRevision(parsed);
  const builtAt = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["builtAt"] : undefined;
  if (revision === null || typeof builtAt !== "string") {
    return { kind: "unknown", why: `${path} is not a build stamp: it does not have the shape vite.fleet.config.ts writes` };
  }
  return { kind: "stamp", stamp: { ...revision, builtAt } };
}
