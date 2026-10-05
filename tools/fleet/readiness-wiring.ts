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
 *  - **git**. On a box that has hit load average 391, a `rev-list` blocked on
 *    object IO inside a handler makes the whole diagnostic dashboard
 *    unresponsive at the moment somebody needs it.
 *  - **a directory scan** across every checkout.
 *  - **`tmux ls`**, to tell a run that is still going from one that was killed.
 *
 * So a refresh computes all three into a snapshot, and the route serves the
 * snapshot. The page therefore shows an answer that is *up to one refresh old*,
 * and it is told exactly how old rather than left to assume — the same contract
 * `health.ts` has, for the same reason.
 *
 * **The timer is the same thread as the requests.** Moving git and tmux onto it
 * kept them out of a handler and no further: while they were `spawnSync` and
 * `execFileSync`, a child that would not die froze every request anyway,
 * because a synchronous `timeout` signals and then goes on waiting (postmortem
 * 260910a). Both now run through the process's owned asynchronous child runner
 * (`child.ts`), and `collect()` is awaited by a latched refresh. The directory
 * scan is still synchronous file IO on that thread.
 */
import { processProbeOwner, type ProbeOwner } from "./child.js";
import { checkoutRoots, scanLogs, scriptBodiesFor, type ScanResult } from "./readiness-backfill.js";
import { snapshotDevAsync, type DevSnapshot } from "./readiness-git.js";
import { openReadinessStore, readinessDirFromEnv, type ReadinessStore } from "./readiness-store.js";
import { readinessVerdict, type Verdict } from "./readiness-verdict.js";
import type { Reading } from "./readiness.js";

/** How far back the tab looks. Greg asked for a day. */
export const WINDOW_HOURS = 24;

/** When tmux is signalled. The caller stops waiting one grace after it (`child.ts`). */
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
export async function liveSessionNames(owner: ProbeOwner = processProbeOwner()): Promise<LiveSessions> {
  const outcome = await owner.run({
    key: "readiness:tmux-list-sessions",
    cmd: "tmux",
    args: ["list-sessions", "-F", "#{session_name}"],
    timeoutMs: TMUX_TIMEOUT_MS,
    maxBytes: 1024 * 1024,
  });
  if (outcome.kind === "ok") {
    return { names: new Set(outcome.stdout.split("\n").map((s) => s.trim()).filter((s) => s !== "")) };
  }
  /* No server running is a normal state and not a fault — but it is still
     "we could not ask", because `tmux list-sessions` exits non-zero for it.
     So is a tmux that timed out, overflowed, or was REFUSED because the last
     one this process started is still unaccounted for. Every one of them is
     "we did not look", and the caller falls back rather than concluding. */
  return { why: `tmux would not list its sessions: ${outcome.why}` };
}

export type LiveSessions = { names: Set<string> } | { why: string };

/**
 * One readiness collection at a time, and only a finished one is published.
 *
 * `collect()` awaits its children, so a turn of the timer can arrive while the
 * last collection is still out. The latch is set before the first await and
 * cleared in `finally`; a call that finds it set returns without collecting. A
 * collection that fails publishes nothing — the previous snapshot stays, and
 * the page shows how old it is. The returned function never rejects, so the
 * loop can start it without awaiting it.
 */
export function latchedReadinessRefresh(deps: {
  collect(): Promise<ReadinessSnapshot>;
  publish(snapshot: ReadinessSnapshot): void;
  onError(why: string): void;
}): () => Promise<void> {
  let inFlight = false;
  return async function refresh(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      deps.publish(await deps.collect());
    } catch (err) {
      deps.onError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight = false;
    }
  };
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
  /** The other place worktrees live; null for none. Unset means the box's own, scripts/worktree-roots.ts — so a test sets it, or it scans real trees. */
  externalRoot?: string | null | undefined;
  dir?: string | undefined;
  nowMs?: (() => number) | undefined;
  /** Injected by tests, so a scan can be driven without a tmux server. */
  liveSessions?: (() => LiveSessions | Promise<LiveSessions>) | undefined;
  /** Runs tmux and git. The process's one owner unless a test supplies its own. */
  owner?: ProbeOwner | undefined;
};

export type ReadinessRetention = {
  /** Null when the store would not open. The dashboard runs on regardless. */
  store: ReadinessStore | null;
  /**
   * Recompute the snapshot. Call from the refresh loop, never from a handler,
   * and through `latchedReadinessRefresh` so two never overlap.
   */
  collect(): Promise<ReadinessSnapshot>;
  /** What to say at startup — the directory, or why there is not one. */
  lines: { log: string[]; error: string[] };
};

export function makeReadinessRetention(deps: ReadinessDeps): ReadinessRetention {
  const dir = deps.dir ?? readinessDirFromEnv();
  const opened = openReadinessStore(dir);
  const store = opened.kind === "open" ? opened.store : null;
  const nowMs = deps.nowMs ?? ((): number => Date.now());
  const owner = deps.owner ?? processProbeOwner();
  const liveSessions = deps.liveSessions ?? ((): Promise<LiveSessions> => liveSessionNames(owner));

  const log: string[] = [];
  const error: string[] = [];
  if (opened.kind === "open") log.push(`readiness records → ${opened.dir}`);
  else error.push(`readiness is not being recorded: ${opened.why}`);

  return {
    store,
    lines: { log, error },

    async collect(): Promise<ReadinessSnapshot> {
      const at = nowMs();
      const sinceMs = at - WINDOW_HOURS * 60 * 60 * 1000;

      /* The store first, because its run ids are what stop the scan
         reconstructing a weaker duplicate of every wrapper run. */
      const held = store?.read({ sinceMs, nowMs: at }) ?? null;
      const knownRunIds = new Set((held?.readings ?? []).map((r) => r.record.runId));

      const roots = deps.externalRoot === undefined ? checkoutRoots(deps.primary) : checkoutRoots(deps.primary, deps.externalRoot);
      const live = await liveSessions();
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
      const dev = await snapshotDevAsync(owner, deps.primary, new Date(at).toISOString());

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
