/**
 * **Which revision is this process running?** Answered once, at start, and
 * never again.
 *
 * Both Overseer services — the fleet dashboard (`server.ts`) and the Overseer
 * daemon (`tools/overseer/daemon.ts`) — call {@link readStartRevision} as the
 * first thing they do and keep the result. Fleet-owned because `tools/fleet/`
 * may not import `tools/overseer/`, and the daemon may import from here.
 *
 * ## Read ONCE, at process start
 *
 * The primary checkout on the box moves under a running service several times
 * an hour. So a value read later — lazily on a first request, or re-read on
 * every request — is **the checkout's current HEAD, not the running code**, and
 * reporting it as the running revision is the one inference the plan refuses
 * (docs/plans/260910f § What exists). A process that did not record its
 * revision at start has an unknown revision, and says so.
 *
 * ## The honest limit
 *
 * `tsx` compiles lazily: a module first imported after start is read from the
 * tree **as it is then**, not as it was when the stamp was taken. So `known`
 * names what the tree was at start, which is what the process loaded at start
 * and nothing more. And `dirty: true` means the sha does not name the running
 * code at all — the tree held edits no commit has.
 *
 * ## `dirty` counts TRACKED changes only
 *
 * The primary checkout always has untracked files from other agents, so
 * counting them would make `dirty` true on every start of every service there,
 * and a flag that is always true says nothing. Untracked files mostly cannot
 * reach committed code: to import one, a tracked file has to change, and that
 * shows up here.
 *
 * **Mostly, not always.** A commit can import a file its author forgot to
 * add. The checkout that still holds that file untracked runs fine, and it
 * stamps clean here. That gap is the reason `readiness-git.ts`'s `stampTree`
 * counts untracked files: its stamp *votes* on whether a commit is green. This
 * one only *names* what a process started from, for a person reading a
 * diagnostics page, so it gives up that rare case to avoid a flag that is
 * always on.
 *
 * Nothing at module scope does anything; there is no cache. Each call is a
 * fresh read, and each caller keeps its own value.
 */
import { spawnSync } from "node:child_process";

import { GIT_TIMEOUT_MS, gitEnv } from "./readiness-git.js";
import type { StartRevision } from "./wire.js";

export type { StartRevision } from "./wire.js";

/** One git invocation. Injected in tests; the default is bounded and never prompts. */
export type RunGit = (argv: string[]) => { status: number; stdout: string; stderr: string };

/**
 * `spawnSync` with the same timeout and environment as the readiness stamp:
 * inherited `GIT_DIR`-style redirects removed, so `git -C <dir>` really answers
 * about `<dir>`, and replace refs off, so the sha is the real one.
 */
const defaultRun: RunGit = (argv) => {
  const [command, ...args] = argv;
  if (command === undefined) return { status: -1, stdout: "", stderr: "empty command" };
  const out = spawnSync(command, args, {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: gitEnv(),
  });
  if (out.error) return { status: -1, stdout: "", stderr: out.error.message };
  return { status: out.status ?? -1, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
};

const SHA = /^[0-9a-f]{40}$/;

/**
 * A `StartRevision` read back from disk — a daemon note, a build stamp — or
 * null when it is not one. Null rather than a guess: each reader decides what a
 * malformed stamp means for the record it sits in, and neither may default it
 * to `known`.
 */
export function parseStartRevision(u: unknown): StartRevision | null {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return null;
  const record = u as Record<string, unknown>;
  const readAt = record["readAt"];
  if (typeof readAt !== "string") return null;
  switch (record["kind"]) {
    case "known": {
      const sha = record["sha"];
      const dirty = record["dirty"];
      if (typeof sha !== "string" || !SHA.test(sha) || typeof dirty !== "boolean") return null;
      return { kind: "known", sha, dirty, readAt };
    }
    case "unknown": {
      const why = record["why"];
      return typeof why === "string" ? { kind: "unknown", why, readAt } : null;
    }
    default:
      return null;
  }
}

/**
 * The revision of the checkout containing `dir`, as it stands at this moment.
 * Call it once at process start and keep the value; see the header for why a
 * later call names the wrong thing.
 *
 * Never throws: any git failure is `unknown` with the reason, because a service
 * must not refuse to start over a diagnostic.
 */
export function readStartRevision(dir: string, deps: { run?: RunGit; now?: () => Date } = {}): StartRevision {
  const run = deps.run ?? defaultRun;
  const readAt = (deps.now ?? (() => new Date()))().toISOString();
  const git = (args: string[]): { ok: true; out: string } | { ok: false; why: string } => {
    let result: ReturnType<RunGit>;
    try {
      result = run(["git", "-C", dir, ...args]);
    } catch (cause) {
      return { ok: false, why: `git ${args[0]} could not run: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    if (result.status !== 0) {
      const stderr = result.stderr.trim().split("\n")[0] ?? "";
      return { ok: false, why: `git ${args[0]} in ${dir} exited ${result.status}${stderr === "" ? "" : `: ${stderr}`}` };
    }
    return { ok: true, out: result.stdout.trim() };
  };

  const sha = git(["rev-parse", "HEAD"]);
  if (!sha.ok) return { kind: "unknown", why: sha.why, readAt };
  if (!SHA.test(sha.out)) {
    return { kind: "unknown", why: `git rev-parse HEAD in ${dir} printed something that is not a sha: ${sha.out.slice(0, 60)}`, readAt };
  }
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  // A status we could not take is UNKNOWN, not clean: "clean" is a claim that
  // the sha names the running code, and nothing here has checked that.
  if (!status.ok) return { kind: "unknown", why: status.why, readAt };
  return { kind: "known", sha: sha.out, dirty: status.out !== "", readAt };
}
