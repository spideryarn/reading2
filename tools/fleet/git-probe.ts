/**
 * **The read-only questions this box can answer about production without a
 * Vercel token**, taken as one snapshot, asynchronously, with an arm for every
 * way of not knowing.
 *
 * ## Why git at all
 *
 * The deploy record (`src/web/changelog-versions.ndjson`) is written by a job
 * Greg runs by hand, so it lags. Git is the one always-current source on this
 * box: `main` is advanced only by `scripts/deploy.ts`, so `origin/main` is where
 * production was last *pushed to*, and the distance from the newest recorded
 * deploy to that tip is how far behind the record has fallen.
 *
 * **`origin/main` is not "what is serving".** `deploy.ts` pushes and only then
 * waits for Vercel, so a build that failed or timed out leaves `main` advanced
 * with nothing serving from it (deploy.ts § Push). Nothing here may say those
 * commits shipped — GPT Sol's P1, 2026-09-09, and `routes-deploys.ts` § The
 * claim in the header carries the wording that survived it.
 *
 * ## ASYNCHRONOUS, AND THAT IS NOT A STYLE CHOICE
 *
 * This was three `spawnSync` calls until GPT Sol pointed out what that means
 * here: **the dashboard is one Node process and the Overseer has no independent
 * source of fleet state** (overseer-direction.md). A slow disk or a loaded box
 * would let one Deploys request block every session, every action, every
 * heartbeat and every health request for the sum of three command timeouts —
 * up to fifteen seconds of frozen control plane, caused by somebody opening a
 * tab. So: `execFile`, bounded output, a timeout each, and a snapshot cached
 * behind a single flight so concurrent readers cost one probe rather than
 * three each.
 *
 * ## THIS NEVER FETCHES
 *
 * Not because fetching would disturb other agents — it would not; a fetch
 * writes refs and touches no working tree — but because it is network work on
 * every request, repeated for every reader, and it would let a caller mutate
 * this repository's refs by loading a page. So `origin/main` here is **this
 * checkout's cached view**, and `lastFetchAtMs` says when this checkout last
 * fetched anything at all. Read that field's doc before drawing it: it is a
 * weaker fact than it looks.
 *
 * ## Every failure is an arm, never a throw and never a zero
 *
 * Each of these questions has a plausible, reassuring wrong answer to collapse
 * into — a missing ref could be `0` commits behind, an ancestry check that
 * failed to run could be "not an ancestor". Both draw a confident false number.
 *
 * ## Spawning
 *
 * Fixed argv arrays, no shell, a timeout each, bounded output. The only
 * interpolated value is a sha re-checked here against `/^[0-9a-f]{40}$/` at the
 * point of use — it comes from a file rather than from a caller, but a
 * validation next to the spawn is the one that survives somebody later passing
 * it something else.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { AncestryReading, CountReading, GitSnapshot, MainRef } from "./wire.js";

/**
 * The readings are declared in `wire.ts` and re-exported here, so a caller that
 * wants "what the probe answers" imports it from the probe. One declaration,
 * two doors — the twin types wire.ts's header is about were two declarations.
 */
export type { AncestryReading, CountReading, GitSnapshot, MainRef };

const run = promisify(execFile);

/** Long enough for a cold cache on a loaded box, short enough not to hang a poll. */
export const GIT_TIMEOUT_MS = 5_000;

/**
 * How long a snapshot stands.
 *
 * These values move when somebody deploys or fetches, which is minutes apart at
 * best, and the panel is opened and re-opened by hand. Recomputing per request
 * buys nothing and spends the box's time in the one process the Overseer cannot
 * do without.
 */
export const SNAPSHOT_TTL_MS = 15_000;

const SHA = /^[0-9a-f]{40}$/;

/** Bounded, so a pathological repository cannot buffer a response into memory. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** One question, and what it takes to ask it. */
export type GitProbe = {
  /**
   * Everything, as one snapshot.
   *
   * **One method rather than three**, because the three answers must describe
   * the same tip. `origin/main` is mutable between processes — a dozen agents
   * fetch all night — so three independent calls can resolve the ref to A,
   * check ancestry against B and count to C, and the response is then not a
   * reading of anything. GPT Sol's P2 finding 6. The ref is resolved once and
   * the literal sha is used for the rest.
   */
  snapshot(recordedSha: string | null): Promise<GitSnapshot>;
};

type Ran = { ok: true; stdout: string } | { ok: false; why: string; status: number | null };

/**
 * One git call.
 *
 * The ways it goes wrong need different sentences: git missing, a timeout, a
 * non-zero exit (which for `merge-base --is-ancestor` is an ANSWER rather than
 * a fault), and a throw.
 */
async function git(repoRoot: string, args: string[], timeoutMs: number): Promise<Ran> {
  try {
    const { stdout } = await run("git", args, {
      cwd: repoRoot,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      /* No shell, so nothing here is parsed by one. `env` is inherited: git
         needs PATH, and this is a read-only call in a checkout this process
         already lives in. */
      windowsHide: true,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; stderr?: string };
    if (e.killed === true || e.code === "ETIMEDOUT") {
      return { ok: false, why: `git ${args[0]} took longer than ${timeoutMs}ms`, status: null };
    }
    if (e.code === "ENOENT") return { ok: false, why: "git is not installed on this box", status: null };
    const status = typeof e.code === "number" ? e.code : null;
    /* First line only, and bounded: this reaches a page, and a page must not be
       handed an unbounded string a subprocess chose. React escapes it; the cap
       is about size rather than markup. */
    const stderr = (e.stderr ?? "").trim().split("\n")[0]?.slice(0, 300) ?? "";
    return {
      ok: false,
      why: stderr === "" ? `git ${args[0]} exited ${String(e.code)}` : stderr,
      status,
    };
  }
}

/**
 * When this checkout last fetched **anything**, from `FETCH_HEAD`'s mtime.
 *
 * **A weaker fact than it looks, and it must be labelled as what it is.**
 * Measured on this box, 2026-09-09, after GPT Sol's P1 finding 2:
 *
 *  - A **no-op** fetch does advance `FETCH_HEAD`'s mtime (01:16:00 → 01:16:02),
 *    while the loose `refs/remotes/origin/main` file's mtime does not move. So
 *    the ref file answers *when did origin/main last change*, which is not the
 *    question, and `FETCH_HEAD` answers *when did we last ask*, which is.
 *  - But `FETCH_HEAD` names **whatever was last fetched**. After
 *    `git fetch origin sidebranch` it names `sidebranch`, so this does not prove
 *    `origin/main` itself was refreshed then.
 *  - And the loose ref may not exist at all: `origin/main` can be packed into
 *    `packed-refs`, which has one unrelated mtime for many refs. A stat that
 *    silently misses would report "never fetched" on a healthy repository.
 *
 * So this is *the last time this checkout was in contact with the remote*, it
 * is drawn with those words, and it bounds the staleness rather than measuring
 * it. Anything stronger needs `git ls-remote`, which is network work this route
 * has decided not to do.
 */
async function lastFetchAtMs(repoRoot: string, timeoutMs: number): Promise<number | null> {
  const dirs: string[] = [];
  /* This worktree's gitdir and the shared common dir: a fetch run in any
     worktree writes its own FETCH_HEAD, and the refs it wrote are shared. */
  for (const flag of ["--git-dir", "--git-common-dir"]) {
    const read = await git(repoRoot, ["rev-parse", flag], timeoutMs);
    if (read.ok && read.stdout !== "") dirs.push(path.resolve(repoRoot, read.stdout));
  }
  let newest: number | null = null;
  for (const dir of dirs) {
    try {
      const at = (await stat(path.join(dir, "FETCH_HEAD"))).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch {
      /* No FETCH_HEAD here. Not an error — a worktree that has never fetched is
         normal, and the other dir may still have one. */
    }
  }
  return newest;
}

/**
 * The real probe, against a checkout on disk.
 *
 * `ref` is a parameter so a test can drive it against a throwaway repository
 * with no remote, and so `origin/main` is spelled once rather than in three
 * argv arrays.
 */
export function gitProbe(options: {
  repoRoot: string;
  /** Default `origin/main`, which is production. Never `main`, a local branch. */
  ref?: string;
  timeoutMs?: number;
  ttlMs?: number;
  nowMs?: () => number;
}): GitProbe {
  const repoRoot = options.repoRoot;
  const ref = options.ref ?? "origin/main";
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
  const now = options.nowMs ?? ((): number => Date.now());

  /* Single flight and a short TTL. Two readers arriving together share one
     probe; a reader arriving inside the window pays nothing. Keyed by the
     recorded sha because that is the only input. */
  let cached: { key: string; atMs: number; snapshot: GitSnapshot } | null = null;
  let inFlight: { key: string; promise: Promise<GitSnapshot> } | null = null;

  async function take(recordedSha: string | null): Promise<GitSnapshot> {
    const main = await readRef();
    if (main.kind !== "ref") {
      /* No tip, so nothing to compare against — and saying so once is better
         than three arms each blaming git separately. */
      const why = `${ref} could not be read`;
      return { main, ancestry: { kind: "unknown", why }, commitsSince: { kind: "unknown", why } };
    }
    if (recordedSha === null) {
      const why = "the record names no deploy to measure from";
      return { main, ancestry: { kind: "unknown", why }, commitsSince: { kind: "unknown", why } };
    }
    if (!SHA.test(recordedSha)) {
      const why = "the record's newest sha is not 40 hex characters";
      return { main, ancestry: { kind: "unknown", why }, commitsSince: { kind: "unknown", why } };
    }

    /* **Against the resolved sha, not against `ref`.** That is the whole point
       of taking a snapshot: the three answers describe one tip even if somebody
       fetches underneath us. */
    const [ancestry, commitsSince] = await Promise.all([
      readAncestry(recordedSha, main.sha),
      readCount(recordedSha, main.sha),
    ]);
    return { main, ancestry, commitsSince };
  }

  async function readRef(): Promise<MainRef> {
    /* One call for both fields: `%H %cI` off the tip. Two calls could disagree
       with each other if somebody fetched between them, which is a sha and a
       date from different commits. */
    const read = await git(repoRoot, ["log", "-1", "--format=%H %cI", ref], timeoutMs);
    if (!read.ok) return { kind: "unavailable", why: `${ref}: ${read.why}` };
    const [sha, committedAt] = read.stdout.split(" ");
    if (sha === undefined || !SHA.test(sha) || committedAt === undefined) {
      return { kind: "unavailable", why: `${ref}: git answered something unreadable` };
    }
    return { kind: "ref", sha, committedAt, lastFetchAtMs: await lastFetchAtMs(repoRoot, timeoutMs) };
  }

  async function readAncestry(sha: string, tip: string): Promise<AncestryReading> {
    const read = await git(repoRoot, ["merge-base", "--is-ancestor", sha, tip], timeoutMs);
    if (read.ok) return { kind: "ancestor" };
    /* **EXIT 1 IS THE ANSWER "no", NOT A FAILURE.** Everything else — 128 for an
       unknown sha, a timeout, a missing git — is a failure, and collapsing the
       two draws "this deploy is not on main", which reads as a rollback nobody
       performed. */
    if (read.status === 1) return { kind: "not-ancestor" };
    return { kind: "unknown", why: read.why };
  }

  async function readCount(sha: string, tip: string): Promise<CountReading> {
    /* `--no-merges` to match the record's own `commit_count`, which drops merge
       commits — every one here is a `Merge remote-tracking branch 'origin/dev'`
       carrying no change of its own. A count taken the other way would sit
       beside the record's numbers looking comparable and not be.
       docs/project/changelog.md § Enumerate. */
    const read = await git(repoRoot, ["rev-list", "--count", "--no-merges", `${sha}..${tip}`], timeoutMs);
    if (!read.ok) return { kind: "unknown", why: read.why };
    const commits = Number(read.stdout);
    if (!Number.isInteger(commits) || commits < 0) {
      return { kind: "unknown", why: `git answered ${JSON.stringify(read.stdout.slice(0, 40))}` };
    }
    return { kind: "count", commits };
  }

  return {
    async snapshot(recordedSha): Promise<GitSnapshot> {
      const key = recordedSha ?? "none";
      const at = now();
      if (cached !== null && cached.key === key && at - cached.atMs < ttlMs) return cached.snapshot;
      if (inFlight !== null && inFlight.key === key) return inFlight.promise;

      const promise = take(recordedSha)
        .then((snapshot) => {
          cached = { key, atMs: now(), snapshot };
          return snapshot;
        })
        .finally(() => {
          if (inFlight?.promise === promise) inFlight = null;
        });
      inFlight = { key, promise };
      return promise;
    },
  };
}
