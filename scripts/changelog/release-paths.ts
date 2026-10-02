/**
 * **Which commits can change what a reader sees** — one definition, asked by
 * three callers that must agree: `changelog.ts plan` (what to trawl), `promote`
 * (whether a deploy shipped anything its notes do not cover) and the deploy
 * gate in `scripts/deploy.ts` (whether the candidate's notes cover it).
 *
 * If the gate and the planner disagreed, the gate would demand notes the planner
 * then declares there is nothing to write, or pass a commit the planner would
 * have trawled. docs/plans/261001q.
 *
 * Pure apart from `releaseCommits` and `notesAt`, which ask git.
 */
import { execFileSync, spawnSync } from "node:child_process";

import { parseChangelog, parsePending, type PendingRelease } from "../../src/changelog.js";
import { changelogGap } from "../deploy-checks.js";

/**
 * The append-only history: one line per production deploy — docs/project/changelog.md
 * § The file.
 *
 * It sits beside its reader rather than in `docs/`, where this process would
 * naturally have filed it, because `src/web/ChangelogPage.tsx` imports it and
 * `.vercelignore` drops `docs` from the upload — docs/postmortems/260907a-an-import-into-a-vercelignored-directory-built-everywhere-except-vercel.md.
 * The pending file sits beside it for the same reason.
 */
export const CHANGELOG_FILE = "src/web/changelog-versions.ndjson";

/**
 * The notes for the deploy about to happen — one release, or `null`. Replaced
 * whole by each `prepare`, never appended to. docs/project/changelog.md § The
 * pending release.
 */
export const PENDING_FILE = "src/web/changelog-pending.json";

/**
 * **A commit touching none of these cannot change what a reader sees**, so it
 * is classified without a model call, with its path list as the evidence —
 * changelog.md § Enumerate. The list is deliberately generous: `styles/` and
 * `public/` are in, because a stylesheet and a favicon are both things a reader
 * meets. Taken from the table in
 * docs/plans/260906d-retrospective-changelog-for-every-version-since-the-beginning.md
 * § What we are working with, which is the version the 995/1,071 split was
 * measured against.
 */
export const CODE_PATHS = [
  "src/",
  "drizzle/",
  "styles/",
  "public/",
  "api/",
  "index.html",
  "vercel.json",
  "vite.config.ts",
  "vite.api.config.ts",
  "package.json",
  "components.json",
];

/**
 * **The changelog's own two files are under `src/` and are not a change.** Until
 * 2026-10-01 they counted as code, which cost a trawl paragraph per run; once
 * notes are written before the deploy it would cost far more — every notes
 * commit would itself need notes, for ever (GPT Sol on 261001q, finding 4).
 */
export const NOT_RELEASE_PATHS = [CHANGELOG_FILE, PENDING_FILE];

/** The same exclusion as a git pathspec, for `git log -- <paths>`. */
export const RELEASE_PATHSPEC = [...CODE_PATHS, ...NOT_RELEASE_PATHS.map((p) => `:(exclude)${p}`)];

export function isReleasePath(p: string): boolean {
  if (NOT_RELEASE_PATHS.includes(p)) return false;
  return CODE_PATHS.some((c) => (c.endsWith("/") ? p.startsWith(c) : p === c));
}

export function touchesRelease(paths: string[]): boolean {
  return paths.some(isReleasePath);
}

/**
 * The non-merge commits in `range` that touch a release path, oldest first.
 *
 * From each commit's own `--name-only` list, which history simplification cannot
 * prune (changelog.md § Enumerate says why that matters). Merges are left out
 * as they are everywhere in this process; a merge that carries code of its own
 * is the known gap, named in 261001q § Out of scope.
 */
export function releaseCommits(range: string, cwd: string): string[] {
  const out = execFileSync("git", ["log", "--no-merges", "--format=%x00%H", "--name-only", range], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const found: string[] = [];
  for (const chunk of out.split("\0")) {
    const lines = chunk.split("\n").filter((l) => l.trim() !== "");
    const sha = lines.shift()?.trim();
    if (sha && touchesRelease(lines)) found.push(sha);
  }
  return found.reverse();
}

/** `git show <sha>:<file>`, or `fallback` when the commit has no such file. */
function fileAt(sha: string, file: string, cwd: string, fallback: string): string {
  const r = spawnSync("git", ["show", `${sha}:${file}`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : fallback;
}

export interface NotesAt {
  /** `changelogGap`'s answer: null when the commit's notes cover it. */
  gap: string | null;
  pending: PendingRelease | null;
  described: string;
  /**
   * Release commits the candidate ships after `described` that its notes let
   * through — they roll to the next release's notes (`changelogGap`). Empty
   * whenever `gap` is set.
   */
  late: string[];
  /** Every deployment the commit's history records — what the serving-deploy check asks. */
  recordedDeploymentIds: string[];
}

/**
 * **Do the release notes inside `sha` cover everything `sha` would ship?** The
 * deploy gate, and `release-notes.ts prepare` checking its own work, ask this
 * one function, so the two cannot drift. Read from the commit, not the disk:
 * the commit is what gets built.
 */
export function notesAt(sha: string, cwd: string): NotesAt {
  const history = parseChangelog(fileAt(sha, CHANGELOG_FILE, cwd, ""));
  const parsed = parsePending(fileAt(sha, PENDING_FILE, cwd, "null\n"), history.versions);
  const last = history.versions.at(-1);
  /* An empty file parses cleanly because `parseChangelog` also serves the
     retrospective writer, where starting from nothing is legitimate. It is
     never legitimate in a deploy candidate: falling back to the candidate sha
     would make both the ancestry and uncovered-range checks vacuously pass. */
  const historyProblems = last === undefined ? ["the candidate's changelog history has no releases"] : [];
  const described = parsed.pending?.sha ?? last?.sha ?? sha;
  const inCandidate =
    spawnSync("git", ["merge-base", "--is-ancestor", described, sha], { cwd, stdio: "ignore" }).status === 0;
  const uncovered = inCandidate && described !== sha ? releaseCommits(`${described}..${sha}`, cwd) : [];
  const gap = changelogGap({
    problems: [...history.problems, ...parsed.problems, ...historyProblems],
    described,
    describedInCandidate: inCandidate,
    pendingPresent: parsed.pending !== null,
    uncovered,
  });
  return {
    gap,
    pending: parsed.pending,
    described,
    late: gap === null ? uncovered : [],
    recordedDeploymentIds: history.versions.map((v) => v.deployment_id),
  };
}
