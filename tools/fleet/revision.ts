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
 * **A stamp is a checkout observation at start, not a code identity.** It
 * names the commit the checkout's HEAD was at, and the tree's dirtiness, at
 * the instant of the read — not the bytes the process runs. ESM dependencies
 * can be loaded before the stamp is read, and later ones load after it, so
 * readers render a clean stamp only as *recorded start HEAD … matches / is N
 * behind / is not an ancestor of this checkout's HEAD*, and a dirty one as
 * *code revision unknown* (GPT Sol's F1 on docs/plans/260910f).
 *
 * `tsx` compiles lazily: a module first imported after start is read from the
 * tree **as it is then**, not as it was when the stamp was taken.
 *
 * `known` records a HEAD sha and a git status observation made during
 * startup. `dirty: false` means that status reported no tracked changes;
 * `dirty: true` means it reported at least one tracked change somewhere in the
 * checkout. Neither proves which bytes the process or bundle loaded; `unknown`
 * is never rendered as a match. Three counter-examples, each reproduced in the
 * stage 1 review: an untracked file that committed code imports, and a
 * tracked file edited under an `assume-unchanged` index flag, both run while
 * the stamp says clean, and an unrelated tracked edit says dirty while the
 * code that runs matches the commit exactly.
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
import { fileURLToPath } from "node:url";

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
 * A finite instant in the exact form `Date.prototype.toISOString` writes —
 * the form every stamp is written in. The same rule as `isIsoTimestamp` in
 * `tools/overseer/store.ts`, copied rather than imported because
 * `tools/fleet/` may not import `tools/overseer/`. A string that is not an
 * instant would reach a later clock calculation as NaN.
 */
export function isIsoInstant(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const parsed = new Date(u);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === u;
}

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
  if (!isIsoInstant(readAt)) return null;
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

  // ONE invocation for both facts. Two (`rev-parse`, then `status`) let a
  // commit land between them and pair commit A's sha with commit B's
  // cleanness; `--branch` puts HEAD's oid in the same output as the status.
  const status = git(["status", "--porcelain=v2", "--branch", "--untracked-files=no"]);
  // A status we could not take is UNKNOWN, not clean: "clean" is an
  // observation, and nothing here made one.
  if (!status.ok) return { kind: "unknown", why: status.why, readAt };
  return parsePorcelainV2(status.out, dir, readAt);
}

/**
 * The start revision of the checkout a module sits in: `moduleUrl` is the
 * caller's `import.meta.url`, `up` the relative path from it to the checkout
 * root ("../.." from `tools/overseer/daemon.ts`).
 *
 * **Why this and not `readStartRevision(fileURLToPath(new URL(up, import.meta.url)))`
 * at the call site.** That expression throws when the module was not loaded from
 * a file — jsdom gives it an `http:` URL — and it sat on the first line of
 * `runOverseer`, so a stamp, which is a diagnostic, stopped a daemon starting
 * (tests/fleet-work-evidence-e2e.test.tsx, red on dev from 1c6e1e4e). A module
 * with no file has no checkout to read: that is `unknown`, with the reason.
 */
export function readModuleStartRevision(
  moduleUrl: string,
  up: string,
  deps: { run?: RunGit; now?: () => Date } = {},
): StartRevision {
  let dir: string;
  try {
    dir = fileURLToPath(new URL(up, moduleUrl));
  } catch (cause) {
    const readAt = (deps.now ?? (() => new Date()))().toISOString();
    const scheme = URL.canParse(moduleUrl) ? new URL(moduleUrl).protocol : "an unparseable URL";
    const why = cause instanceof Error ? cause.message : String(cause);
    return { kind: "unknown", why: `this module was loaded from ${scheme}, not a file, so there is no checkout to read (${why})`, readAt };
  }
  return readStartRevision(dir, deps);
}

/**
 * `git status --porcelain=v2 --branch` → a stamp. Header lines begin `# `; the
 * one that matters is `# branch.oid <sha>`, which says `(initial)` before the
 * first commit. Every other non-empty line is a change to a tracked file.
 */
function parsePorcelainV2(out: string, dir: string, readAt: string): StartRevision {
  const lines = out.split("\n").filter((line) => line !== "");
  const oidLine = lines.find((line) => line.startsWith("# branch.oid "));
  if (oidLine === undefined) {
    return { kind: "unknown", why: `git status in ${dir} printed no "# branch.oid" line: ${out.slice(0, 60)}`, readAt };
  }
  const oid = oidLine.slice("# branch.oid ".length).trim();
  if (oid === "(initial)") return { kind: "unknown", why: `the repository at ${dir} has no commit yet`, readAt };
  if (!SHA.test(oid)) {
    return { kind: "unknown", why: `git status in ${dir} gave a branch.oid that is not a sha: ${oid.slice(0, 60)}`, readAt };
  }
  return { kind: "known", sha: oid, dirty: lines.some((line) => !line.startsWith("# ")), readAt };
}
