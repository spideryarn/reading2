/**
 * The readiness composition, in one importable place.
 *
 * **The same reason `health-wiring.ts` exists, and it is a good one.** The first
 * version of that feature's join test built its own store, handed it to its own
 * route, ran a turn and read it back — and would have stayed green if
 * `server.ts` had mounted the route against a *different* store instance or a
 * different directory. So the composition lives here, `server.ts` holds nothing
 * but a call to it, and the test drives **the same function the server does**.
 *
 * ## Everything expensive happens on the timer, not in the request
 *
 * A readiness answer needs three things a request path must not do:
 *
 *  - **git**, which `spawnSync`s. On a box that has hit load average 391, a
 *    `rev-list` blocked on object IO inside a handler makes the whole
 *    diagnostic dashboard unresponsive at the moment somebody needs it.
 *  - **a directory scan** across every checkout.
 *  - **`tmux ls`**, to tell a run that is still going from one that was killed.
 *
 * So a refresh computes all three into a snapshot, and the route serves the
 * snapshot. The page therefore shows an answer that is *up to one refresh old*,
 * and it is told exactly how old rather than left to assume — the same contract
 * `health.ts` has, for the same reason.
 */
import { execFileSync } from "node:child_process";

import { checkoutRoots, scanLogs, scriptBodiesFor, type ScanResult } from "./readiness-backfill.js";
import { snapshotDev, type DevSnapshot } from "./readiness-git.js";
import { openReadinessStore, readinessDirFromEnv, type ReadinessStore } from "./readiness-store.js";
import { readinessVerdict, type Verdict } from "./readiness-verdict.js";
import type { Reading } from "./readiness.js";

/** How far back the tab looks. Greg asked for a day. */
export const WINDOW_HOURS = 24;

/** Nothing here may hold anything up for longer than this. */
const TMUX_TIMEOUT_MS = 3_000;

export type ReadinessSnapshot = {
  /** When this was computed, by the server's clock. */
  collectedAt: string;
  /** Everything in the window, oldest first — wrapper records and scanned logs together. */
  readings: Reading[];
  verdict: Verdict;
  dev: DevSnapshot;
  /**
   * **How the answer was assembled**, carried whether or not anything went
   * wrong. A page that only heard about a truncated scan when it broke would
   * have no way to say "and it is fine", and a chart quietly missing an hour
   * with no explanation available is a manufactured outage.
   */
  diagnostics: {
    /** Records in the store that would not parse. Non-zero forces the verdict to unknown. */
    unreadableRecords: { file: string; why: string }[];
    /** Logs that looked like checks and would not parse. */
    unreadableLogs: { file: string; why: string }[];
    unreadableRoots: { root: string; why: string }[];
    scanTruncated: boolean;
    rootsTruncated: boolean;
    logsSkippedForBudget: number;
    dedupedAgainstWrapper: number;
    checkoutsScanned: number;
    /** Null when the store opened; otherwise why nothing is being recorded at all. */
    storeRefused: string | null;
    /** Null when tmux answered; otherwise why liveness is unknown for scanned logs. */
    tmuxWhy: string | null;
  };
};

/**
 * Which tmux sessions exist, so a quiet log can be told from a killed one.
 *
 * Returns null — meaning **"we did not look"** — rather than an empty set when
 * tmux will not answer. An empty set would say *every* session is gone, which
 * would turn the whole board void in one stroke on a box where tmux happened to
 * be busy. `readingFromLog` treats null as "fall back to the quiet window".
 */
export function liveSessionNames(): { names: Set<string> } | { why: string } {
  try {
    const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
      timeout: TMUX_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return { names: new Set(out.split("\n").map((s) => s.trim()).filter((s) => s !== "")) };
  } catch (err) {
    /* No server running is a normal state and not a fault — but it is still
       "we could not ask", because `tmux list-sessions` exits non-zero for it.
       Either way the caller falls back rather than concluding. */
    return { why: `tmux would not list its sessions: ${(err as Error).message}` };
  }
}

/**
 * A tmux-job log's session name is its basename: `scripts/tmux-job.ts` names the
 * log after the session it starts, and nothing else touches either name.
 */
export function sessionNameForLog(logPath: string): string {
  const base = logPath.slice(logPath.lastIndexOf("/") + 1);
  return base.endsWith(".log") ? base.slice(0, -4) : base;
}

export type ReadinessDeps = {
  /** The primary checkout, whose worktrees are scanned alongside it. */
  primary: string;
  dir?: string | undefined;
  nowMs?: (() => number) | undefined;
  /** Injected by tests, so a scan can be driven without a tmux server. */
  liveSessions?: (() => { names: Set<string> } | { why: string }) | undefined;
};

export type ReadinessRetention = {
  /** Null when the store would not open. The dashboard runs on regardless. */
  store: ReadinessStore | null;
  /** Recompute the snapshot. Call from the refresh loop, never from a handler. */
  collect(): ReadinessSnapshot;
  /** What to say at startup — the directory, or why there is not one. */
  lines: { log: string[]; error: string[] };
};

export function makeReadinessRetention(deps: ReadinessDeps): ReadinessRetention {
  const dir = deps.dir ?? readinessDirFromEnv();
  const opened = openReadinessStore(dir);
  const store = opened.kind === "open" ? opened.store : null;
  const nowMs = deps.nowMs ?? ((): number => Date.now());
  const liveSessions = deps.liveSessions ?? liveSessionNames;

  const log: string[] = [];
  const error: string[] = [];
  if (opened.kind === "open") log.push(`readiness records → ${opened.dir}`);
  else error.push(`readiness is not being recorded: ${opened.why}`);

  return {
    store,
    lines: { log, error },

    collect(): ReadinessSnapshot {
      const at = nowMs();
      const sinceMs = at - WINDOW_HOURS * 60 * 60 * 1000;

      /* The store first, because its run ids are what stop the scan
         reconstructing a weaker duplicate of every wrapper run. */
      const held = store?.read({ sinceMs, nowMs: at }) ?? null;
      const knownRunIds = new Set((held?.readings ?? []).map((r) => r.record.runId));

      const roots = checkoutRoots(deps.primary);
      const live = liveSessions();
      const bodies = new Map<string, Readonly<Record<string, string>>>();

      const scan: ScanResult = scanLogs({
        roots: roots.roots,
        sinceMs,
        nowMs: at,
        knownRunIds,
        /* Read once per checkout and remembered: a scan touches a dozen roots
           and would otherwise parse the same `package.json` two hundred times. */
        scriptBodiesFor: (root) => {
          const cached = bodies.get(root);
          if (cached !== undefined) return cached;
          const read = scriptBodiesFor(root);
          bodies.set(root, read);
          return read;
        },
        isSessionLive:
          "names" in live ? (logPath) => live.names.has(sessionNameForLog(logPath)) : () => undefined,
      });

      const readings = [...(held?.readings ?? []), ...scan.readings].sort((a, b) => a.atMs - b.atMs);
      const dev = snapshotDev(deps.primary, new Date(at).toISOString());

      return {
        collectedAt: new Date(at).toISOString(),
        readings,
        verdict: readinessVerdict({
          readings,
          devSha: dev.kind === "known" ? dev.devSha : null,
          caveat: dev.kind === "known" ? dev.caveat : "",
          /**
           * **A store that would not open counts as unreadable**, not as empty.
           * Otherwise the one state where nothing is being recorded at all
           * renders identically to a quiet day.
           *
           * **`scan.unreadable` is deliberately NOT added.** A tmux log that
           * would not parse is history we could not read, and history can never
           * vote — so it cannot shadow a pass the way an unreadable *record*
           * can. Counting it here would make the verdict permanently `unknown`
           * for as long as one odd log sat in a directory a dozen agents write
           * to, which is a tab that has stopped answering rather than one being
           * careful. It is reported in `diagnostics` instead, where a gap in the
           * graph belongs.
           */
          unreadable: (held?.unreadable.length ?? 0) + (store === null ? 1 : 0),
        }),
        dev,
        diagnostics: {
          unreadableRecords: held?.unreadable ?? [],
          unreadableLogs: scan.unreadable,
          unreadableRoots: [
            ...scan.unreadableRoots,
            ...(roots.why === null ? [] : [{ root: deps.primary, why: roots.why }]),
          ],
          scanTruncated: scan.discoveryTruncated,
          rootsTruncated: roots.truncated,
          logsSkippedForBudget: scan.skippedForBudget,
          dedupedAgainstWrapper: scan.dedupedAgainstWrapper,
          checkoutsScanned: roots.roots.length,
          storeRefused: opened.kind === "refused" ? opened.why : null,
          tmuxWhy: "why" in live ? live.why : null,
        },
      };
    },
  };
}
