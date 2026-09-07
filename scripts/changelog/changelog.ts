#!/usr/bin/env -S npx tsx
/**
 * **The deterministic half of the changelog process, so a run supplies judgment
 * rather than bookkeeping.**
 *
 *     npx tsx scripts/changelog/changelog.ts plan --deploys logs/changelog/deploys.json
 *     npx tsx scripts/changelog/changelog.ts review-prompt [--day 2026-09-06]
 *     npx tsx scripts/changelog/changelog.ts verify
 *     npx tsx scripts/changelog/changelog.ts copy-inputs
 *     npx tsx scripts/changelog/changelog.ts write
 *     npx tsx scripts/changelog/changelog.ts check
 *
 * The process is docs/project/changelog.md; § Running it is the order these go
 * in, and what a person does between them. Everything intermediate lands under
 * `--work` (default `logs/changelog`, gitignored at `/logs/`), one file per
 * stage, so any stage can be re-run against what the one before it left.
 *
 * ## Why this is committed code rather than the prose it was
 *
 * The first run (docs/plans/260906d-…) did all of this in throwaway Python, and
 * **two of that run's six recorded mistakes were in the throwaway code rather
 * than in any model's output** — the missing `--full-history` that silently
 * pruned a real change out of the code/non-code split, and the duplicate
 * subagent whose late output overwrote a finished one. Neither had a symptom.
 * A warning in a doc does not run; `git log --full-history` does.
 *
 * ## What every stage here is defending against
 *
 * Success while doing nothing — docs/reusable/silent-success.md. A trawler that
 * summarised subject lines, a review that returned an empty answer file, a
 * version whose range came back empty because the sha was not an ancestor: all
 * three look exactly like a clean run. So the assertions are the point of this
 * file, not decoration on it, and they exit non-zero rather than warning:
 *
 *  - `plan` checks ancestry per pair, cross-checks the path filter against the
 *    commits' own name lists, and refuses to run on top of a previous run's
 *    stage output — the rulings are applied by numeric index, so yesterday's
 *    answer file lands on today's items without complaint.
 *  - `verify` checks that every commit handed out came back in exactly one item,
 *    that the review ruled on every user-facing one, and that every sha on an
 *    assigned item is a commit the version it is assigned to actually contains.
 *  - `write` re-verifies every sha against the sources its own entry cites, and
 *    reads back what it is about to install before installing it.
 *
 * Nothing here writes to git, to the database, or to the network.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  LAUNCH_VERSION,
  MAX_HEADLINES,
  SECTIONS,
  parseChangelog,
  type ParseResult,
  type Section,
} from "../../src/changelog.js";
import { isMain } from "../../src/is-main.js";

/**
 * The file the whole process exists to append to. Relative to the repo root.
 *
 * It sits beside its reader rather than in `docs/`, where this process would
 * naturally have filed it, because `src/web/ChangelogPage.tsx` imports it and
 * `.vercelignore` drops `docs` from the upload — docs/postmortems/260907a-an-import-into-a-vercelignored-directory-built-everywhere-except-vercel.md.
 */
const CHANGELOG_FILE = "src/web/changelog-versions.ndjson";

/** Gitignored at `/logs/`, so a run leaves nothing for a commit to pick up. */
const DEFAULT_WORK = "logs/changelog";

/**
 * The directories a run fills, in the order the stages write them.
 *
 * `plan` refuses to start when any of them has anything in it, because the
 * documented default work directory is reused between runs and **the rulings
 * are applied by numeric index**: a stale `<day>-sol.json` left over from
 * yesterday would be folded into today's items silently and plausibly, each
 * ruling landing on whichever item now sits at that position. `--fresh` empties
 * them; `--work <dir>` leaves them alone.
 */
const STAGE_DIRS = ["batches", "items", "review", "verified", "copy-in", "copy-out"];

/**
 * Commits per trawl batch. Twelve is what the first run used across 89 agents;
 * changelog.md § Trawl says "roughly six to ten" and the extra two cost nothing
 * because most of a batch is a commit the trawler discards in one `git show`.
 */
const BATCH_SIZE = 12;

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
const CODE_PATHS = [
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
 * The app addresses the copy stage may link to, and no others — the closed list
 * in scripts/changelog/copy-prompt.md § Links. Restated here rather than parsed
 * out of that file because this is the enforcement and that is the instruction.
 * A guessed address is a 404 in the one place a reader is most likely to click.
 *
 * **The list itself was wrong, which is the failure worth remembering.** It
 * carried `/read` for "your library" from the day it was written, and the shelf
 * is at `/` — `parseRoute` sends a bare `/read` to `not-found`, because the
 * article regex needs a slug after it. Thirty-two entries shipped in
 * `versions.ndjson` pointing at a page that does not exist, and every check
 * passed, because all of them asked whether the address was *on the list*
 * rather than whether it was real. `tests/changelog-file.test.ts` now asks
 * `parseRoute` directly, which is the only question with an answer.
 */
export const OK_LINK_PATHS = new Set([
  "/",
  "/read/public",
  "/features",
  "/pricing",
  "/profile",
  "/contact",
  "/privacy",
]);

const COMMIT_LINK = /^https:\/\/github\.com\/spideryarn\/reading2\/commit\/([0-9a-f]{40})$/;
const SHA = /^[0-9a-f]{40}$/;

/**
 * Our vocabulary, which may not reach a reader — copy-prompt.md § Translating
 * our words into the reader's. A **warning**, not an error: "commit" is on the
 * list and a legitimate sentence can contain it, so this is a prompt to go and
 * look rather than a gate. The gates are the structural checks.
 */
const BANNED = [
  "the band",
  "the spine",
  "block id",
  "artefact",
  "artifact",
  "the store",
  "postgres",
  "supabase",
  "vercel",
  "openrouter",
  "sonnet",
  "opus",
  "gpt-",
  "src/",
  ".tsx",
  ".ts ",
  "drizzle",
  "ndjson",
  "subagent",
  "commit",
];

/**
 * Who wrote each stage, recorded on every line so a later reader can tell which
 * model's judgment a claim rests on. Constants rather than flags: changing the
 * model is a decision worth a diff, and a flag would let a run record the wrong
 * one by omission.
 */
const GENERATED_BY = { trawl: "claude-sonnet-5", review: "gpt-5.6-sol", copy: "claude-opus-5" };

// ---------------------------------------------------------------------------
// Small shared machinery

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A refusal, as an exception rather than an exit.
 *
 * `die` used to call `process.exit(1)`, which is the same thing to a person at a
 * terminal and untestable from a test — and the gates in this file *are* the
 * file, so a gate nobody has watched go red is not evidence
 * ([silent-success.md](../../docs/reusable/silent-success.md)). Thrown, every
 * one of them is a `toThrow` in `tests/changelog-runner.test.ts`; `main` turns
 * it back into the exit code at the edge.
 */
export class Refused extends Error {}

function die(message: string): never {
  throw new Refused(message);
}

/** git, with enough buffer for a name-only log of the whole history. */
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

/** A git question whose answer is its exit code, not its output. */
function gitOk(args: string[], cwd: string): boolean {
  return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file: string, value: unknown, indent = 1): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => path.join(dir, f));
}

/** `2026-08-26T23:04:25Z` → `20260826T230425`, the per-version file name. */
function slugOf(iso: string): string {
  return iso.replaceAll(":", "").replaceAll("-", "").replace("Z", "");
}

/** `2026-08-26T23:04:25Z` → `2026-08-26 23:04`, what the copy stage is shown. */
function labelOf(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// The files each stage leaves behind

/** One production deploy, as `plan` needs it. */
interface Deploy {
  id: string;
  created: number;
  sha: string | null;
}

/** One version, with the commits its range covers. `plan` writes these. */
interface SpineVersion {
  version: string;
  deployment_id: string;
  sha: string;
  previous_sha: string | null;
  /**
   * **Non-merge commits in the range.** changelog.md § Enumerate says merges
   * stay in this number; the 68 lines already in the file were written from the
   * non-merge count (their `commit_count` sums to 2,047, which is the non-merge
   * total the first run recorded), and a number that means one thing above a
   * line and another below it is worse than either meaning. Matching the file.
   */
  commit_count: number;
  ancestor_ok: string;
  commits: string[];
  code_commits: string[];
}

/** A commit the pre-filter excluded, with the evidence for excluding it. */
interface ExcludedCommit {
  sha: string;
  day: string;
  paths: string[];
  paths_omitted: number;
}

/**
 * A trawl item, a Sol ruling, a copy entry: all three are model-written JSON
 * that this file mostly passes through untouched. A loose record is the honest
 * type for them — inventing an interface would claim a guarantee no model gives
 * — so every field is read through the accessors below, which say what happens
 * when it is missing.
 */
type Loose = Record<string, unknown>;

function str(o: Loose, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}

function bool(o: Loose, key: string): boolean {
  return o[key] === true;
}

function arr(o: Loose, key: string): unknown[] {
  const v = o[key];
  return Array.isArray(v) ? v : [];
}

/** An item's commits, whether the trawler wrote `{sha, subject}` or a bare sha. */
function shasOf(item: Loose): string[] {
  const out: string[] = [];
  for (const c of arr(item, "commits")) {
    if (typeof c === "string") out.push(c);
    else if (isRecord(c) && typeof c.sha === "string") out.push(c.sha);
  }
  return out;
}

function looseArray(value: unknown, what: string): Loose[] {
  if (!Array.isArray(value)) die(`${what} is not a JSON array`);
  return value.filter(isRecord);
}

// ---------------------------------------------------------------------------
// 1. plan — the version spine, the pre-filter, the batches

/**
 * The deploy list, however it arrived.
 *
 * `mcp__vercel__list_deployments` answers `{deployments: {deployments: [...]}}`,
 * an agent saving the inner value gets a bare array, and the REST endpoint
 * answers `{deployments: [...]}`. This box has no `VERCEL_TOKEN` and the CLI is
 * logged out, so the file is always somebody's copy-paste and all three shapes
 * are real.
 */
export function deployRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    const d = raw.deployments;
    if (Array.isArray(d)) return d;
    if (isRecord(d) && Array.isArray(d.deployments)) return d.deployments;
  }
  die("--deploys is neither an array of deployments nor an object containing one");
}

/** READY production deploys, oldest first. Everything else is not a version. */
export function productionDeploys(rows: unknown[]): Deploy[] {
  const out: Deploy[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (row.state !== "READY") continue;
    if (row.target !== "production") continue;
    const id = typeof row.id === "string" ? row.id : typeof row.uid === "string" ? row.uid : null;
    const created =
      typeof row.created === "number"
        ? row.created
        : typeof row.createdAt === "number"
          ? row.createdAt
          : null;
    if (id === null || created === null) continue;
    const meta = isRecord(row.meta) ? row.meta : {};
    const sha = typeof meta.githubCommitSha === "string" ? meta.githubCommitSha : null;
    out.push({ id, created, sha });
  }
  out.sort((a, b) => a.created - b.created);
  return out;
}

function stampOf(created: number): string {
  return new Date(created).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** One `git log` per range, carrying each commit's day as well as its sha. */
function commitsInRange(range: string, cwd: string): { sha: string; day: string }[] {
  const out = git(["log", "--no-merges", "--date=short", "--format=%H %cd", range], cwd);
  const rows: { sha: string; day: string }[] = [];
  for (const line of out.split("\n")) {
    const [sha, day] = line.trim().split(" ");
    if (sha && day) rows.push({ sha, day });
  }
  /* git logs newest first; every consumer downstream reads chronologically. */
  rows.reverse();
  return rows;
}

/** Each commit's own file list, keyed by sha. NUL-delimited so a path with a newline cannot lie. */
function pathsInRange(range: string, cwd: string): Map<string, string[]> {
  const out = git(["log", "--no-merges", "--format=%x00%H", "--name-only", range], cwd);
  const byShas = new Map<string, string[]>();
  for (const chunk of out.split("\0")) {
    const lines = chunk.split("\n").filter((l) => l.trim() !== "");
    const sha = lines.shift();
    if (!sha) continue;
    byShas.set(sha.trim(), lines);
  }
  return byShas;
}

function touchesCode(paths: string[]): boolean {
  return paths.some((p) => CODE_PATHS.some((c) => (c.endsWith("/") ? p.startsWith(c) : p === c)));
}

/**
 * **The code/non-code split, taken twice.**
 *
 * `git log --full-history -- <paths>` is the required filter, and the
 * `--full-history` is the whole point: without it, default history
 * simplification prunes side-branch commits in this merge-heavy history and the
 * excluded set silently grows. The first run lost a real `src/store/pg-jobs.ts`
 * change that way and found it by hand.
 *
 * The second witness is each commit's own `--name-only` list, which no
 * simplification can touch. They should agree exactly. Where they do not, the
 * commit is **kept as code** — a commit trawled unnecessarily costs one paragraph
 * of a subagent's attention, and one dropped costs a change the reader never
 * hears about — and the disagreement is printed, because a filter that has
 * started lying again is the thing worth knowing.
 */
function splitCode(
  range: string,
  commits: { sha: string; day: string }[],
  paths: Map<string, string[]>,
  cwd: string,
): { code: Set<string>; disagreements: string[] } {
  const filtered = new Set(
    git(["log", "--full-history", "--no-merges", "--format=%H", range, "--", ...CODE_PATHS], cwd)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
  );

  const code = new Set<string>();
  const disagreements: string[] = [];
  for (const { sha } of commits) {
    const byName = touchesCode(paths.get(sha) ?? []);
    const byFilter = filtered.has(sha);
    if (byName !== byFilter) {
      disagreements.push(
        `${sha.slice(0, 8)}: path filter says ${byFilter}, its own file list says ${byName}`,
      );
    }
    if (byName || byFilter) code.add(sha);
  }
  return { code, disagreements };
}

/**
 * The file a command reads or appends to. `--file` exists so a run can be
 * rehearsed against a copy — the real one is a public artefact and a dry run
 * that writes it is not a dry run.
 */
function changelogPath(root: string, file: string | undefined): string {
  return file === undefined ? path.join(root, CHANGELOG_FILE) : path.resolve(file);
}

/** § `STAGE_DIRS` — either empty them, or refuse to run on top of them. */
function refuseStaleStages(root: string, work: string, fresh: boolean): void {
  const dirs = STAGE_DIRS.map((d) => path.join(work, d));
  if (fresh) {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    return;
  }
  const used = dirs.filter((d) => existsSync(d) && readdirSync(d).length > 0);
  if (used.length === 0) return;
  for (const d of used) {
    console.error(`  ✗ ${path.relative(root, d)} holds ${readdirSync(d).length} files`);
  }
  die(
    "the work directory already holds an earlier run's stage output, and the stages address each " +
      "other by index and file name rather than by run — pass --fresh to delete the directories " +
      "above, or --work <dir> to start somewhere else",
  );
}

function cmdPlan(
  root: string,
  work: string,
  deploysFile: string,
  target: string,
  fresh: boolean,
): void {
  refuseStaleStages(root, work, fresh);
  const deploys = productionDeploys(deployRows(readJson(deploysFile)));
  if (deploys.length === 0) die("no READY production deployments in --deploys");

  const withSha = deploys.filter((d): d is Deploy & { sha: string } => d.sha !== null);
  const noSha = deploys.filter((d) => d.sha === null);
  if (withSha.length === 0) die("every deployment in --deploys is missing meta.githubCommitSha");

  /* A deploy with no sha attaches no git ref — `vercel deploy` from a working
     directory, which is how the 11 earliest were made. Those are not versions of
     their own; their work is inside the earliest version that does have a sha,
     whose range reaches back to the first commit, so they cost nothing.
     **After that point the same deploy is fatal**, and was merely reported until
     2026-09-06: one production deploy is one version (changelog.md § A version
     is a deploy), and a working-directory deploy shipped something no range
     covers. Skipping it attributes its work to whichever later version happens
     to contain the commits — or to none at all. */
  const lateNoSha = noSha.filter((d) => {
    const first = withSha[0];
    return first !== undefined && d.created > first.created;
  });
  if (lateNoSha.length > 0) {
    for (const d of lateNoSha) console.error(`  ✗ ${stampOf(d.created)} ${d.id}: no githubCommitSha`);
    die(
      `${lateNoSha.length} READY production deploys after the first version have no git sha — ` +
        "each shipped something this process cannot put a range around",
    );
  }

  const shown = path.relative(root, target);
  const existingText = existsSync(target) ? readFileSync(target, "utf8") : "";
  const existing = parseChangelog(existingText);
  if (existing.problems.length > 0) {
    for (const p of existing.problems) console.error(`  ✗ ${p}`);
    die(`${shown} has ${existing.problems.length} problems — fix it before planning on it`);
  }

  /* The watermark is the last line, matched back to its deploy. Matched by
     deployment id rather than by sha, because a redeploy of the same sha is a
     real thing here (2026-08-27 shipped `903b33e6` twice) and keying on the sha
     would silently swallow the second one. */
  const last = existing.versions.at(-1);
  let pending: (Deploy & { sha: string })[];
  if (last === undefined) {
    pending = withSha;
  } else {
    const at = withSha.findIndex((d) => d.id === last.deployment_id);
    if (at < 0) {
      die(
        `the last line of ${shown} names deployment ${last.deployment_id}, ` +
          "which is not in --deploys — the list is short, or from the wrong project",
      );
    }
    pending = withSha.slice(at + 1);
  }
  const written = new Set(existing.versions.map((v) => v.deployment_id));
  const already = pending.filter((d) => written.has(d.id));
  if (already.length > 0) {
    die(`${already.length} deploys after the watermark already have a line: ${already[0]?.id}`);
  }

  /* **A version's id is its stamp to the second, and two deploys can share one.**
     `stampOf` drops the milliseconds Vercel gives us, and the format is not ours
     to change — it is the id of every line already in the file, and of every
     `copy-in` file name. So the collision is caught here, where the deployment
     ids are still to hand to name it, rather than downstream as a strict-ordering
     failure between two lines that look identical. */
  const stamps = new Map<string, string>(existing.versions.map((v) => [v.version, v.deployment_id]));
  const collisions: string[] = [];
  for (const d of pending) {
    const stamp = stampOf(d.created);
    const other = stamps.get(stamp);
    if (other !== undefined) collisions.push(`${stamp}: ${other} and ${d.id}`);
    else stamps.set(stamp, d.id);
  }
  if (collisions.length > 0) {
    for (const c of collisions) console.error(`  ✗ ${c}`);
    die(
      `${collisions.length} deploys share a version id — two production deploys landed within the ` +
        "same second, and a version is named by its stamp to the second",
    );
  }

  const spine: SpineVersion[] = [];
  const excluded: ExcludedCommit[] = [];
  const batchesByDay = new Map<string, string[]>();
  const ancestryFailures: string[] = [];
  const disagreements: string[] = [];

  let previous = last?.sha ?? null;
  for (const deploy of pending) {
    let ancestor = "n/a (first)";
    if (previous !== null) {
      /* Checked per pair rather than assumed: a rollback or a `vercel deploy`
         from a working directory breaks the range without breaking anything
         else, and the symptom is a version that quietly missed its work. */
      const ok = gitOk(["merge-base", "--is-ancestor", previous, deploy.sha], root);
      ancestor = ok ? "yes" : "NO";
      if (!ok) {
        ancestryFailures.push(
          `${stampOf(deploy.created)} ${deploy.sha.slice(0, 8)}: ` +
            `${previous.slice(0, 8)} is not its ancestor`,
        );
      }
    }
    const range = previous === null ? deploy.sha : `${previous}..${deploy.sha}`;
    const commits = commitsInRange(range, root);
    const paths = pathsInRange(range, root);
    const split = splitCode(range, commits, paths, root);
    disagreements.push(...split.disagreements);

    for (const { sha, day } of commits) {
      if (split.code.has(sha)) {
        const forDay = batchesByDay.get(day) ?? [];
        forDay.push(sha);
        batchesByDay.set(day, forDay);
      } else {
        const all = paths.get(sha) ?? [];
        excluded.push({
          sha,
          day,
          paths: all.slice(0, 50),
          paths_omitted: Math.max(0, all.length - 50),
        });
      }
    }

    spine.push({
      version: stampOf(deploy.created),
      deployment_id: deploy.id,
      sha: deploy.sha,
      previous_sha: previous,
      commit_count: commits.length,
      ancestor_ok: ancestor,
      commits: commits.map((c) => c.sha),
      code_commits: commits.filter((c) => split.code.has(c.sha)).map((c) => c.sha),
    });
    previous = deploy.sha;
  }

  ensureDir(work);
  writeJson(path.join(work, "spine.json"), spine);
  writeJson(path.join(work, "prefilter.json"), excluded);

  const batchDir = path.join(work, "batches");
  ensureDir(batchDir);
  let batchCount = 0;
  for (const day of [...batchesByDay.keys()].sort()) {
    const shas = batchesByDay.get(day) ?? [];
    for (let i = 0; i * BATCH_SIZE < shas.length; i++) {
      const chunk = shas.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      const name = `${day}-${String(i).padStart(2, "0")}.txt`;
      writeFileSync(path.join(batchDir, name), `${chunk.join("\n")}\n`);
      batchCount++;
    }
  }

  const codeTotal = spine.reduce((n, v) => n + v.code_commits.length, 0);
  const commitTotal = spine.reduce((n, v) => n + v.commit_count, 0);
  console.log(`deploys           : ${deploys.length} READY production, ${noSha.length} with no sha`);
  console.log(`already written   : ${existing.versions.length} lines in ${shown}`);
  console.log(`versions to do    : ${spine.length}`);
  console.log(`commits in range  : ${commitTotal}  code-touching ${codeTotal}  excluded ${excluded.length}`);
  console.log(`batches           : ${batchCount} of at most ${BATCH_SIZE}`);
  const empty = spine.filter((v) => v.commit_count === 0);
  if (empty.length > 0) {
    console.log(`empty ranges      : ${empty.length} (${empty.map((v) => v.version).join(" ")})`);
  }
  for (const d of disagreements) console.log(`  · path-filter disagreement ${d}`);
  if (ancestryFailures.length > 0) {
    for (const f of ancestryFailures) console.error(`  ✗ ${f}`);
    die(
      `${ancestryFailures.length} ancestry failures — the ranges above are wrong and the spine is ` +
        "written but must not be trawled until they are understood",
    );
  }
  if (spine.length === 0) {
    console.log("\nNothing new to write up.");
    return;
  }
  console.log(
    `\nNext: one Sonnet subagent per file in ${path.join(work, "batches")}, ` +
      "briefed from scripts/changelog/trawl-brief.md, writing to " +
      `${path.join(work, "items")}/<batch>.json — then \`review-prompt\`.`,
  );
}

// ---------------------------------------------------------------------------
// 2. review-prompt — one Sol prompt per day of history

/**
 * The review prompt, near-verbatim from the first run's `cl-make-review-prompt.py`.
 *
 * **A tuned prompt, not prose to improve.** Its adversarial framing, the pilot's
 * numbers, and the exact output shape are what produced 506 rulings with none
 * unruled; `verify` below parses that shape and nothing else.
 */
function reviewPrompt(a: {
  root: string;
  day: string;
  items: number;
  userFacing: number;
  invisible: number;
  commits: number;
  mergedFile: string;
  commitsFile: string;
}): string {
  return `# Review a changelog trawl against the diffs — ${a.day}

Repo: \`${a.root}\` — **Spideryarn**, an AI-assisted reading product. Read-only:
do not edit, create or delete anything, and run no version-control command that writes.

We are building a public \`/changelog\`. Read \`docs/project/changelog.md\` first — it is the process,
and you are its third stage. Cheap Sonnet subagents read the diffs of every code-touching commit
from **${a.day}** and produced candidate change items. Your job is to check them against what the
diffs actually did, before any reader-facing copy is written from them.

## The material

- **${a.items} candidate items**, in \`${a.mergedFile}\`. Each carries an \`_index\`.
- **${a.commits} commits**, listed in \`${a.commitsFile}\`.

Use \`git show\`, \`git show --stat\`, \`git log\` and the working tree freely.

**Check every claim against the diff, not against the commit message.** House style here is a
literary subject line that names the reasoning rather than the change, so a summary that merely
paraphrases the subject is exactly the failure this stage exists to catch. In the pilot run on a
different day, five of eight items needed correction and one user-facing fix had been missed
entirely.

## What to rule on

**For each of the ${a.userFacing} items with \`user_facing: true\` — verify in full:**

1. **Is the \`summary\` true of the diff?** Name precisely what is wrong if it is not.
2. **Is \`user_facing\` right?** The bar: *a reader of an article would notice a difference*. A fix to
   a race that can fire in production **is** user-facing. A refactor that provably changes no
   behaviour is not. Tests, docs, plans, evals, agent tooling and build plumbing are not.
3. **Is \`where\` right** — would a reader actually meet it there?
4. Resolve any \`uncertain\` field you can settle from the code.

**For the ${a.invisible} items with \`user_facing: false\` — spot-check rather than verify.** Read their
summaries and file lists, and flag any that look misclassified: something a reader would in fact
notice, marked invisible. You are not asked to verify each one's summary.

**Then, across the whole day:** is there user-facing work in these commits that no item mentions?

## Output

A single JSON object, and nothing else:

\`\`\`
{
  "day": "${a.day}",
  "items": [
    {
      "_index": <the item's _index>,
      "verdict": "confirmed" | "corrected" | "rejected",
      "note": "<what is wrong, or what you changed, or null>",
      "corrected_summary": "<only when corrected>",
      "corrected_user_facing": true | false,
      "corrected_where": "<or null>"
    }
  ],
  "misclassified_as_invisible": [ { "_index": <n>, "why": "<...>" } ],
  "regroup": [ "<a sentence per grouping change, with the shas>" ],
  "missing": [ { "commits": ["<sha>"], "summary": "<what was missed>", "user_facing": true } ],
  "overall": "<three sentences on how much of this day's trawl you would trust>"
}
\`\`\`

Include an \`items\` entry for **every** item with \`user_facing: true\`. For the \`user_facing: false\`
ones, include an entry only if you are changing something.

Be adversarial. A confident sentence about a change that did not happen is the failure mode that
matters most: this copy goes to paying readers.
`;
}

/** The days a trawl left output for: `items/<YYYY-MM-DD>-<NN>.json`. */
function daysWithItems(work: string): string[] {
  const days = new Set<string>();
  for (const f of listFiles(path.join(work, "items"), ".json")) {
    days.add(path.basename(f).slice(0, 10));
  }
  return [...days].sort();
}

function cmdReviewPrompt(root: string, work: string, only: string | undefined): void {
  const days = only === undefined ? daysWithItems(work) : [only];
  if (days.length === 0) die(`no trawl output in ${path.join(work, "items")}`);
  const reviewDir = path.join(work, "review");
  ensureDir(reviewDir);

  for (const day of days) {
    const files = listFiles(path.join(work, "items"), ".json").filter((f) =>
      path.basename(f).startsWith(`${day}-`),
    );
    if (files.length === 0) die(`no items for ${day}`);

    const items: Loose[] = [];
    for (const f of files) items.push(...looseArray(readJson(f), f));
    for (const [i, it] of items.entries()) it._index = i;

    const shas = items.flatMap(shasOf);
    const mergedFile = path.join(reviewDir, `${day}-items.json`);
    const commitsFile = path.join(reviewDir, `${day}-commits.txt`);
    writeJson(mergedFile, items, 2);
    writeFileSync(commitsFile, `${shas.join("\n")}\n`);

    const userFacing = items.filter((it) => bool(it, "user_facing")).length;
    writeFileSync(
      path.join(reviewDir, `${day}-prompt.md`),
      reviewPrompt({
        root,
        day,
        items: items.length,
        userFacing,
        invisible: items.length - userFacing,
        commits: shas.length,
        mergedFile,
        commitsFile,
      }),
    );
    console.log(
      `${day}: ${items.length} items (${userFacing} user-facing), ${shas.length} commits, ${files.length} batches`,
    );
  }
  console.log(
    `\nNext, per day: npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high ` +
      `--timeout-minutes 45 --prompt-file ${reviewDir}/<day>-prompt.md --output ${reviewDir}/<day>-sol.json`,
  );
}

// ---------------------------------------------------------------------------
// 3. verify — fold in the rulings, then assign items to versions

/**
 * A model asked for "a single JSON object and nothing else" sometimes wraps it
 * in a fence anyway. Stripping one is not tolerance of a bad answer — the
 * content is unchanged — and the alternative is a stage that dies on a review
 * that actually arrived.
 */
export function readSolAnswer(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return JSON.parse(body);
  }
}

/**
 * The review's own vocabulary, which is **not** the file's — a rejected item is
 * dropped rather than written, and the file also carries `sol-found` and
 * `unreviewed`, neither of which Sol ever says. src/changelog.ts § `VERDICTS`.
 */
const RULINGS = ["confirmed", "corrected", "rejected"];

/** A `corrected` ruling that corrects nothing is a `confirmed` in disguise. */
function hasCorrection(r: Loose): boolean {
  if (str(r, "corrected_summary") !== null) return true;
  if (typeof r.corrected_user_facing === "boolean") return true;
  return "corrected_where" in r;
}

/**
 * **Whether a review answer is one, before any of it is believed.**
 *
 * The stage's gate used to be "the answer file exists", which a file containing
 * `{}` passes — and the whole point of the stage is that a review returning
 * nothing looks exactly like a review that found nothing. Everything checked
 * here is something `applyVerdicts` would otherwise absorb in silence: an
 * `_index` off the end of the item list is a ruling that lands nowhere, a
 * repeated one is a ruling that quietly loses to the last writer, a verdict
 * outside the vocabulary is treated as neither confirmation nor rejection, and
 * a `corrected` with no correction leaves the trawler's unverified sentence in
 * place while marking it reviewed.
 *
 * `unruled` is the other half: the indexes of items the trawl called user-facing
 * that no ruling and no re-classification names. Those are the items whose
 * summaries reach the page having been read only by the cheap model that wrote
 * them.
 */
export function checkReview(
  items: Loose[],
  sol: Loose,
  day: string,
): { problems: string[]; unruled: number[] } {
  const problems: string[] = [];
  /* Read off the items rather than assumed to be `0..n-1`: `review-prompt`
     numbers them by position, but a person acting on a regroup edits that file,
     and `applyVerdicts` matches on the field either way. */
  const known = new Set(items.map((it) => (typeof it._index === "number" ? it._index : -1)));
  const index = (raw: unknown, where: string, seen: Set<number>): number | null => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || !known.has(raw)) {
      problems.push(`${where}: _index ${JSON.stringify(raw)} names no item`);
      return null;
    }
    if (seen.has(raw)) {
      problems.push(`${where}: _index ${raw} appears twice — one of the two rulings is lost`);
      return null;
    }
    seen.add(raw);
    return raw;
  };

  const ruled = new Set<number>();
  for (const [n, r] of looseArray(sol.items ?? [], `${day} sol.items`).entries()) {
    const where = `${day} ruling ${n}`;
    if (index(r._index, where, ruled) === null) continue;
    const verdict = str(r, "verdict");
    if (verdict === null || !RULINGS.includes(verdict)) {
      problems.push(
        `${where}: verdict ${JSON.stringify(r.verdict)} is not one of ${RULINGS.join("/")}`,
      );
      continue;
    }
    if (verdict === "corrected" && !hasCorrection(r)) {
      problems.push(`${where}: "corrected" carries no correction`);
    }
  }

  const flipped = new Set<number>();
  for (const [n, m] of looseArray(
    sol.misclassified_as_invisible ?? [],
    `${day} sol.misclassified_as_invisible`,
  ).entries()) {
    index(m._index, `${day} misclassified ${n}`, flipped);
  }

  const unruled: number[] = [];
  for (const it of items) {
    const i = typeof it._index === "number" ? it._index : -1;
    if (bool(it, "user_facing") && !ruled.has(i) && !flipped.has(i)) unruled.push(i);
  }
  return { problems, unruled };
}

interface VerdictTally {
  kept: number;
  dropped: number;
  corrected: number;
  confirmed: number;
  added: number;
  up: number;
  down: number;
  unreviewed: number;
}

/**
 * Fold one day's rulings into that day's items — the port of
 * `cl-apply-verdicts.py`, and the stage that pays for itself: on the first run
 * it corrected 51% of the trawl's user-facing items and moved 16 back from
 * invisible to visible.
 *
 * `user_facing` flips **both** ways. The downward flips are the cheap ones; the
 * upward flips are the expensive ones, because an item wrongly marked invisible
 * vanishes from the page with nothing left to notice.
 */
export function applyVerdicts(items: Loose[], sol: Loose, day: string, tally: VerdictTally): Loose[] {
  const rulings = new Map<number, Loose>();
  for (const r of looseArray(sol.items ?? [], "sol.items")) {
    const idx = r._index;
    if (typeof idx === "number") rulings.set(idx, r);
  }
  const flipUp = new Map<number, string | null>();
  for (const m of looseArray(sol.misclassified_as_invisible ?? [], "sol.misclassified_as_invisible")) {
    const idx = m._index;
    if (typeof idx === "number") flipUp.set(idx, str(m, "why"));
  }

  const out: Loose[] = [];
  for (const it of items) {
    const idx = typeof it._index === "number" ? it._index : -1;
    const r = rulings.get(idx);
    let verdict = "unreviewed";
    let note: string | null = null;

    if (r) {
      verdict = str(r, "verdict") ?? "unreviewed";
      note = str(r, "note");
      if (verdict === "rejected") {
        tally.dropped++;
        continue;
      }
      if (verdict === "corrected") {
        const summary = str(r, "corrected_summary");
        if (summary) it.summary = summary;
        if ("corrected_where" in r) it.where = r.corrected_where;
        tally.corrected++;
      } else if (verdict === "confirmed") {
        tally.confirmed++;
      }
      const cuf = r.corrected_user_facing;
      if (typeof cuf === "boolean" && cuf !== bool(it, "user_facing")) {
        if (cuf) tally.up++;
        else tally.down++;
        it.user_facing = cuf;
      }
    } else if (!flipUp.has(idx) && bool(it, "user_facing")) {
      tally.unreviewed++;
    }

    if (flipUp.has(idx) && !bool(it, "user_facing")) {
      it.user_facing = true;
      note = `${note ? `${note} | ` : ""}raised from invisible: ${flipUp.get(idx)}`;
      verdict = "corrected";
      tally.up++;
    }

    it.provenance_verdict = verdict;
    it.provenance_note = note;
    out.push(it);
    tally.kept++;
  }

  for (const m of looseArray(sol.missing ?? [], "sol.missing")) {
    const raw = m.commits;
    const shas = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
    out.push({
      id: null,
      summary: str(m, "summary"),
      rationale: null,
      category: str(m, "category") ?? "fix",
      user_facing: m.user_facing === undefined ? true : m.user_facing === true,
      where: str(m, "where"),
      files: arr(m, "files"),
      commits: shas.map((s) => ({ sha: s, subject: null })),
      evidence: str(m, "evidence") ?? str(m, "summary"),
      confidence: "high",
      uncertain: null,
      _batch: `${day}-solfound`,
      _index: null,
      provenance_verdict: "sol-found",
      provenance_note: "found by the review; no trawler reported it",
    });
    tally.added++;
    tally.kept++;
  }
  return out;
}

/** A version per spine row, with the items whose LAST commit lands in it. */
interface AssignedVersion extends Omit<SpineVersion, "commits" | "code_commits" | "ancestor_ok"> {
  version_index: number;
  items: Loose[];
}

/**
 * **An item belongs to the version containing its LAST commit** — the deploy
 * that first shipped all of it. An item whose commits straddle two deploys
 * would otherwise be duplicated or cut in half, and both lie about when a
 * reader could first use the thing. changelog.md § Enumerate.
 *
 * **And every sha on an assigned item is a real commit that the version it is
 * assigned to actually contains.** This is where the writer's later guarantee
 * comes from, and it did not exist until 2026-09-06: the mapping below drops
 * shas it cannot place and assigns the item on the strength of any one it can,
 * so an item citing `[a deployed sha, a forty-character typo]` was assigned on
 * the first and carried the second into `copy-in` — after which `write` accepted
 * it, because its check is only "present in this version's input" and the typo
 * was in the input. A real but not-yet-deployed sha rode in the same way and
 * dated a change earlier than it shipped. Reachability is the one question that
 * answers both, and `git rev-list` per version answers it for every sha at once.
 */
function assignToVersions(
  spine: SpineVersion[],
  verifiedDir: string,
  root: string,
): { assigned: AssignedVersion[]; unassigned: Loose[] } {
  const shaVersion = new Map<string, number>();
  for (const [i, v] of spine.entries()) {
    for (const sha of v.commits) {
      const first = shaVersion.get(sha);
      /* Two versions claiming one commit would count somebody's work twice, and
         nothing downstream would notice. */
      if (first !== undefined) die(`${sha.slice(0, 8)} is in two versions (${first}, ${i})`);
      shaVersion.set(sha, i);
    }
  }

  const byVersion = new Map<number, Loose[]>();
  const unassigned: Loose[] = [];
  for (const f of listFiles(verifiedDir, ".json")) {
    for (const it of looseArray(readJson(f), f)) {
      const shas = shasOf(it);
      it._batch = path.basename(f).replace(/\.json$/, "");
      it._shas = shas;
      const idxs = shas.map((s) => shaVersion.get(s)).filter((n): n is number => n !== undefined);
      if (idxs.length === 0) {
        /* Committed but not deployed: it belongs to no version yet, and the
           watermark picks it up on the run after it ships. Not dropped. */
        unassigned.push(it);
        continue;
      }
      const at = Math.max(...idxs);
      byVersion.set(at, [...(byVersion.get(at) ?? []), it]);
    }
  }

  /* One `rev-list` per version that has something assigned to it, cached, so
     the per-sha question is a Set lookup rather than a process. */
  const ancestors = new Map<number, Set<string>>();
  const reachableFrom = (i: number, sha: string): Set<string> => {
    let seen = ancestors.get(i);
    if (seen === undefined) {
      seen = new Set(
        git(["rev-list", sha], root)
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== ""),
      );
      ancestors.set(i, seen);
    }
    return seen;
  };
  const impossible: string[] = [];
  for (const [i, list] of byVersion) {
    const v = spine[i];
    if (v === undefined) continue;
    const reachable = reachableFrom(i, v.sha);
    for (const it of list) {
      for (const sha of shasOf(it)) {
        if (reachable.has(sha)) continue;
        const real = gitOk(["cat-file", "-e", `${sha}^{commit}`], root);
        impossible.push(
          `${v.version} ${String(it._batch)}: ${sha.slice(0, 10)} is ` +
            (real
              ? `a commit, but not one ${v.sha.slice(0, 8)} contains — undeployed, or a side branch`
              : "not a commit in this repo"),
        );
      }
    }
  }
  if (impossible.length > 0) {
    for (const p of impossible.slice(0, 30)) console.error(`  ✗ ${p}`);
    die(
      `${impossible.length} shas on assigned items are not in the version they were assigned to — ` +
        "the copy stage would have been handed them as facts about that deploy",
    );
  }

  const assigned = spine.map((v, i) => ({
    version_index: i,
    version: v.version,
    deployment_id: v.deployment_id,
    sha: v.sha,
    previous_sha: v.previous_sha,
    commit_count: v.commit_count,
    items: byVersion.get(i) ?? [],
  }));
  return { assigned, unassigned };
}

function cmdVerify(
  root: string,
  work: string,
  allowUnreviewed: boolean,
  reassign: boolean,
): void {
  const spine = JSON.parse(readFileSync(path.join(work, "spine.json"), "utf8")) as SpineVersion[];
  const reviewDir = path.join(work, "review");

  const days = listFiles(reviewDir, "-items.json").map((f) => path.basename(f).slice(0, 10));
  if (days.length === 0) die(`no merged items in ${reviewDir} — run review-prompt first`);
  const unreviewedDays = days.filter((d) => !existsSync(path.join(reviewDir, `${d}-sol.json`)));
  if (unreviewedDays.length > 0 && !allowUnreviewed) {
    die(
      `no review answer for ${unreviewedDays.join(", ")} — a review that returned nothing looks ` +
        "exactly like one that found nothing. Run it, or pass --allow-unreviewed to proceed without it.",
    );
  }

  const tally: VerdictTally = {
    kept: 0,
    dropped: 0,
    corrected: 0,
    confirmed: 0,
    added: 0,
    up: 0,
    down: 0,
    unreviewed: 0,
  };
  const verifiedDir = path.join(work, "verified");
  ensureDir(verifiedDir);

  /* Read and checked before anything is folded in, so a malformed answer stops
     the stage rather than leaving half the days applied behind it. */
  const inputs = days.map((day) => {
    const items = looseArray(readJson(path.join(reviewDir, `${day}-items.json`)), `${day}-items`);
    const solFile = path.join(reviewDir, `${day}-sol.json`);
    const sol = existsSync(solFile)
      ? readSolAnswer(readFileSync(solFile, "utf8"))
      : ({} as Record<string, unknown>);
    if (!isRecord(sol)) die(`${solFile} is not a JSON object`);
    return { day, items, sol, reviewed: existsSync(solFile) };
  });

  const schema: string[] = [];
  const unruled: string[] = [];
  for (const d of inputs) {
    const checked = checkReview(d.items, d.sol, d.day);
    if (d.reviewed) schema.push(...checked.problems);
    unruled.push(...checked.unruled.map((i) => `${d.day} item ${i}`));
  }
  if (schema.length > 0) {
    for (const p of schema.slice(0, 30)) console.error(`  ✗ ${p}`);
    die(`${schema.length} problems in the review answers — nothing folded in`);
  }

  const rawShas = new Map<string, number>();
  const regroups: string[] = [];
  for (const { day, items, sol } of inputs) {
    /* The coverage assertion is taken on the TRAWL's output, before rulings are
       applied: a rejected item is meant to take its commits with it, so asking
       the verified set to cover every batch would fail on a review doing its job. */
    for (const it of items) {
      for (const sha of shasOf(it)) rawShas.set(sha, (rawShas.get(sha) ?? 0) + 1);
    }
    for (const r of arr(sol, "regroup")) {
      if (typeof r === "string") regroups.push(`${day}: ${r}`);
    }
    const applied = applyVerdicts(items, sol, day, tally);
    /* Under `--reassign` the verified files are left exactly as they are: the
       point of that flag is that somebody has just edited one by hand. */
    if (!reassign) writeJson(path.join(verifiedDir, `${day}.json`), applied);
  }

  /* **The review stage is not optional** — changelog.md § Review, where the
     numbers are. An item nobody ruled on reaches the page carrying whatever the
     cheap trawler wrote, and the first run corrected 51% of those. Counted twice
     and gated on both, because the two counts come from different code and a
     silent disagreement between them is itself worth stopping on. */
  if (unruled.length > 0 || tally.unreviewed > 0) {
    for (const u of unruled.slice(0, 30)) console.error(`  ✗ no ruling for ${u}`);
    if (!allowUnreviewed) {
      die(
        `${unruled.length} user-facing items have no ruling (the fold-in counted ` +
          `${tally.unreviewed}) — review them, or pass --allow-unreviewed`,
      );
    }
  }

  const batchShas = new Set<string>();
  for (const f of listFiles(path.join(work, "batches"), ".txt")) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const sha = line.trim().split(" ")[0];
      if (sha) batchShas.add(sha);
    }
  }
  const missed = [...batchShas].filter((s) => !rawShas.has(s));
  const invented = [...rawShas.keys()].filter((s) => !batchShas.has(s));
  const twice = [...rawShas.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  const unreal = invented.filter((s) => !gitOk(["cat-file", "-e", `${s}^{commit}`], root));

  const { assigned, unassigned } = assignToVersions(spine, verifiedDir, root);
  writeJson(path.join(work, "assigned.json"), assigned);
  writeJson(path.join(work, "unassigned.json"), unassigned);

  console.log(Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`commits in batches  : ${batchShas.size}`);
  console.log(`commits in items    : ${rawShas.size}`);
  console.log(`commits MISSED      : ${missed.length}  ${missed.slice(0, 20).map((s) => s.slice(0, 8)).join(" ")}`);
  console.log(`commits TWICE       : ${twice.length}  ${twice.slice(0, 20).map((s) => s.slice(0, 8)).join(" ")}`);
  console.log(`commits INVENTED    : ${invented.length}  ${invented.slice(0, 20).map((s) => s.slice(0, 8)).join(" ")}`);
  console.log(`items not yet deployed: ${unassigned.length}`);
  const visible = assigned.filter((v) => v.items.some((i) => bool(i, "user_facing")));
  console.log(`versions with a user-facing item: ${visible.length}/${assigned.length}`);

  /* **Missed is the fatal one**: a commit handed out that came back in no item
     is what a trawler that read nothing produces, and it has no other symptom.
     A sha that is not a commit at all is the other — the model wrote it out.
     Duplicates and out-of-batch citations are reported and not fatal, because
     both happen for benign reasons and a gate whose red is usually noise is a
     gate people stop reading: the first run's 995 commits contained exactly one
     duplicate, a trawler splitting one commit across two of its own items. */
  if (missed.length > 0 || unreal.length > 0) {
    if (unreal.length > 0) console.error(`  ✗ ${unreal.length} shas are not commits in this repo`);
    die(
      "the trawl did not cover its batches — a trawler that read nothing looks exactly like this. " +
        "Re-run the batches above before going on.",
    );
  }
  if (twice.length > 0) {
    console.log(
      `  · ${twice.length} commits are in more than one item — read them, a change described twice ` +
        "reaches the page twice",
    );
  }
  if (invented.length > 0) {
    console.log(
      `  · ${invented.length} real commits outside the batches were cited (a review's own finding ` +
        "is the usual reason) — read them before trusting the items that carry them",
    );
  }
  /* **A regroup is the review's fourth question and the only answer nothing
     acts on.** Merging or splitting items cannot be applied mechanically — Sol
     names shas and says which item they belong with, and deciding that is the
     judgment the whole stage exists for — so it is printed here loudly rather
     than left in the answer file for somebody to notice. Edit the file under
     `verified/`, then re-run with `--reassign` to rebuild `assigned.json`
     without undoing the edit. On 2026-09-06 the one regroup folded six PDF
     groundwork commits into the entry that shipped the feature; unapplied, the
     entry would have cited two commits out of eight. */
  if (regroups.length > 0) {
    console.log(`\nREGROUPS the review asked for: ${regroups.length} — nothing applies these for you`);
    for (const r of regroups) console.log(`  · ${r}`);
    console.log("  Edit logs/changelog/verified/<day>.json, then re-run: verify --reassign");
  }

  console.log("\nNext: copy-inputs.");
}

// ---------------------------------------------------------------------------
// 4. copy-inputs — one file per version that has something to say

function cmdCopyInputs(work: string): void {
  const versions = JSON.parse(
    readFileSync(path.join(work, "assigned.json"), "utf8"),
  ) as AssignedVersion[];
  const inDir = path.join(work, "copy-in");
  ensureDir(inDir);
  ensureDir(path.join(work, "copy-out"));

  const todo: { slug: string; label: string; changes: number }[] = [];
  const quiet: string[] = [];
  for (const v of versions) {
    const userFacing = v.items.filter((i) => bool(i, "user_facing"));
    if (userFacing.length === 0) {
      quiet.push(v.version);
      continue;
    }
    const slug = slugOf(v.version);
    const changes = userFacing.map((i) => ({
      summary: i.summary,
      rationale: i.rationale ?? null,
      category: str(i, "category") ?? "fix",
      user_facing: true,
      /* Five to eight files is enough for the copy model to picture the change;
         the whole list is in the verified item for anybody checking. */
      files: arr(i, "files").slice(0, 8),
      where: i.where ?? null,
      commits: shasOf(i).map((sha) => ({ sha, subject: null, body: null })),
      evidence: str(i, "evidence") ?? "",
    }));
    writeJson(path.join(inDir, `${slug}.json`), {
      version: { deployedAt: v.version, label: labelOf(v.version) },
      changes,
    });
    todo.push({ slug, label: labelOf(v.version), changes: changes.length });
  }
  writeJson(path.join(work, "quiet-versions.json"), quiet);
  /* The manifest is what `write` uses to notice a copy output for a version
     this run never asked for — the duplicate-agent trap, changelog.md § The traps. */
  writeJson(path.join(work, "copy-manifest.json"), {
    assembled_at: nowStamp(),
    slugs: todo.map((t) => t.slug),
  });

  console.log(`copy calls to make: ${todo.length}   quiet versions: ${quiet.length}`);
  for (const t of todo) console.log(`  ${t.slug}  ${t.label}  ${String(t.changes).padStart(3)} changes`);
  console.log(
    `\nNext: one Opus subagent per file above, briefed from scripts/changelog/copy-brief.md, ` +
      `reading ${inDir}/<slug>.json and writing ${path.join(work, "copy-out")}/<slug>.json. ` +
      "Launch each ONCE.",
  );
}

// ---------------------------------------------------------------------------
// 5. write — validate the copy, then append

const SECTION_RANK = new Map<string, number>(SECTIONS.map((s, i) => [s, i]));

interface WriteReport {
  lines: Record<string, unknown>[];
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
}

/** What one version's copy output is judged against, and where the verdicts go. */
interface CopyContext {
  label: string;
  /** This version's copy input, in the index order `sources` addresses. */
  changes: Loose[];
  /** Every sha the copy stage was given for this version, and no others. */
  inputShas: Set<string>;
  cited: Set<number>;
  errors: string[];
  warnings: string[];
}

/**
 * One entry from the copy stage, checked against the input it was written from.
 *
 * The check worth naming: **every sha must be 40 hex characters, present in that
 * version's own copy input, AND belong to one of the items this entry says it
 * drew on.** The copy stage is a model writing shas out by hand, and on the
 * first run one agent reported catching a mistyped sha in its own output — so
 * the stage can produce one. `parseChangelog` can tell you a sha is the wrong
 * shape; only here is the input still to hand.
 *
 * The third of those was added on 2026-09-06 and is the one that catches a
 * plausible mistake rather than a typo: an entry about change 3 that also lists
 * change 7's commits reads perfectly, links to real commits, and attributes work
 * to the wrong change. Its sources are the only statement of what it is allowed
 * to know.
 */
function checkEntry(e: Loose, c: CopyContext): void {
  /* Sources first: they decide which commits this entry may carry. */
  const sources = arr(e, "sources");
  if (sources.length === 0) {
    /* An entry that cites nothing drew on nothing, which is what an invention
       looks like — changelog.md § Copy, "the copy stage may not introduce a fact". */
    c.errors.push(`${c.label}: entry ${JSON.stringify(e.title)} has empty sources`);
  }
  const drawn: Loose[] = [];
  for (const s of sources) {
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s >= c.changes.length) {
      c.errors.push(
        `${c.label}: source index ${String(s)} out of range (0..${c.changes.length - 1})`,
      );
      continue;
    }
    c.cited.add(s);
    const change = c.changes[s];
    if (change !== undefined) drawn.push(change);
  }
  const fromSources = new Set(drawn.flatMap((ch) => shasOf(ch)));

  for (const sha of arr(e, "commits")) {
    if (typeof sha !== "string" || !SHA.test(sha)) {
      c.errors.push(`${c.label}: malformed sha ${JSON.stringify(sha)}`);
    } else if (!c.inputShas.has(sha)) {
      c.errors.push(`${c.label}: sha ${sha.slice(0, 10)} not in this version's input`);
    } else if (!fromSources.has(sha)) {
      c.errors.push(
        `${c.label}: entry ${JSON.stringify(e.title)} carries sha ${sha.slice(0, 10)}, ` +
          `which belongs to no item in its sources [${sources.join(", ")}]`,
      );
    }
  }

  const text = `${str(e, "body") ?? ""} ${str(e, "title") ?? ""}`.toLowerCase();
  for (const b of BANNED) {
    if (text.includes(b)) {
      c.warnings.push(`${c.label}: ${JSON.stringify(b)} in copy: ${JSON.stringify(e.title)}`);
    }
  }

  for (const l of arr(e, "links")) {
    if (!isRecord(l)) {
      c.errors.push(`${c.label}: a link is not an object`);
      continue;
    }
    const url = typeof l.url === "string" ? l.url : "";
    const m = url.match(COMMIT_LINK);
    if (m) {
      if (!arr(e, "commits").includes(m[1])) {
        c.errors.push(`${c.label}: commit link sha not in entry commits`);
      }
    } else if (!OK_LINK_PATHS.has(url)) {
      c.errors.push(`${c.label}: link to ${JSON.stringify(url)} not on the allowed list`);
    }
  }
}

/**
 * One version's entries, in the shape a line carries them.
 *
 * `null` means **write no line at all for this version** — the copy stage owed
 * one and did not deliver, so anything written here would silently claim the
 * version was quiet. The error is recorded and `write` refuses on it.
 */
function entriesFor(
  v: AssignedVersion,
  userFacing: Loose[],
  a: { inDir: string; outDir: string },
  errors: string[],
  warnings: string[],
  stats: Record<string, number>,
): Record<string, unknown>[] | null {
  const label = labelOf(v.version);
  const slug = slugOf(v.version);
  const outFile = path.join(a.outDir, `${slug}.json`);
  if (!existsSync(outFile)) {
    errors.push(`${label}: MISSING copy output`);
    return null;
  }
  let copy: unknown;
  try {
    copy = readJson(outFile);
  } catch (err) {
    errors.push(`${label}: copy output does not parse: ${(err as Error).message.slice(0, 60)}`);
    return null;
  }
  const input = readJson(path.join(a.inDir, `${slug}.json`));
  if (!isRecord(copy) || !isRecord(input)) {
    errors.push(`${label}: copy input or output is not an object`);
    return null;
  }

  const changes = looseArray(input.changes ?? [], `${slug} input changes`);
  const raw = looseArray(copy.entries ?? [], `${slug} entries`);
  const c: CopyContext = {
    label,
    changes,
    inputShas: new Set(changes.flatMap((ch) => shasOf(ch))),
    cited: new Set<number>(),
    errors,
    warnings,
  };

  const usable: Loose[] = [];
  for (const e of raw) {
    const section = str(e, "section");
    if (section === null || !SECTION_RANK.has(section)) {
      errors.push(`${label}: bad section ${JSON.stringify(e.section)}`);
      continue;
    }
    checkEntry(e, c);
    usable.push(e);
  }

  /* Sorted rather than rejected: the order is the page's, and a stable sort by
     section keeps the copy model's own ordering within each heading. */
  const sorted = [...usable].sort(
    (x, y) =>
      (SECTION_RANK.get(str(x, "section") ?? "") ?? 9) -
      (SECTION_RANK.get(str(y, "section") ?? "") ?? 9),
  );
  if (usable.some((e, i) => e !== sorted[i])) {
    warnings.push(`${label}: entries not in section order — reordered on write`);
  }
  const headlines = usable.filter((e) => str(e, "section") === "headline").length;
  if (headlines > MAX_HEADLINES && v.version !== LAUNCH_VERSION) {
    errors.push(`${label}: ${headlines} headlines (max ${MAX_HEADLINES})`);
  }
  /* **Nothing out of something is an error, not a warning.** Verified,
     reviewed, user-facing changes went in; if none of them came back, the line
     this builds says `invisible: true` and the release ships as one that had
     nothing in it. That reads exactly like the common quiet deploy, and there is
     nothing left anywhere to notice. A copy stage with an opinion that a change
     is not worth mentioning says so by dropping it, which is the warning below —
     the first run dropped 15 inputs out of 504 deliberately — but dropping every
     one of them is not an opinion. */
  if (changes.length > 0 && usable.length === 0) {
    errors.push(`${label}: the copy stage returned no usable entry for ${changes.length} changes`);
  }
  const uncited = changes.length - c.cited.size;
  if (uncited > 0) {
    stats.uncited = (stats.uncited ?? 0) + uncited;
    warnings.push(`${label}: ${uncited} of ${changes.length} input changes cited by no entry`);
  }

  return sorted.map((e) => ({
    id: null,
    section: str(e, "section") as Section,
    title: str(e, "title") ?? "",
    body: str(e, "body") ?? "",
    where: null,
    links: arr(e, "links"),
    commits: arr(e, "commits"),
    provenance: {
      sources: arr(e, "sources"),
      /* Which of the review's rulings this entry rests on — how "only a third
         of entries rest purely on claims the trawl got right first time" stays
         a countable fact. src/changelog/types.ts § ChangelogProvenance. */
      verdicts: [
        ...new Set(
          arr(e, "sources")
            .filter((s): s is number => typeof s === "number" && s >= 0 && s < userFacing.length)
            .map((s) => str(userFacing[s] ?? {}, "provenance_verdict") ?? "unreviewed"),
        ),
      ].sort(),
    },
  }));
}

/**
 * Turn one run's copy output into the lines to append, refusing anything a
 * green run would otherwise hide.
 */
export function buildLines(a: {
  versions: AssignedVersion[];
  inDir: string;
  outDir: string;
  generatedAt: string;
}): WriteReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats: Record<string, number> = {
    versions: 0,
    visible: 0,
    quiet: 0,
    entries: 0,
    headline: 0,
    enhancement: 0,
    fix: 0,
    commits: 0,
    uncited: 0,
  };
  const lines: Record<string, unknown>[] = [];

  for (const v of a.versions) {
    stats.versions = (stats.versions ?? 0) + 1;
    const userFacing = v.items.filter((i) => bool(i, "user_facing"));
    let entries: Record<string, unknown>[] = [];
    if (userFacing.length > 0) {
      const built = entriesFor(v, userFacing, a, errors, warnings, stats);
      if (built === null) continue;
      entries = built;
    }

    const invisible = entries.length === 0;
    stats[invisible ? "quiet" : "visible"] = (stats[invisible ? "quiet" : "visible"] ?? 0) + 1;
    stats.entries = (stats.entries ?? 0) + entries.length;
    for (const e of entries) {
      const section = typeof e.section === "string" ? e.section : "fix";
      stats[section] = (stats[section] ?? 0) + 1;
      stats.commits = (stats.commits ?? 0) + (Array.isArray(e.commits) ? e.commits.length : 0);
    }

    lines.push({
      version: v.version,
      deployment_id: v.deployment_id,
      sha: v.sha,
      previous_sha: v.previous_sha,
      commit_count: v.commit_count,
      invisible,
      generated_at: a.generatedAt,
      generated_by: GENERATED_BY,
      entries,
    });
  }

  return { lines, errors, warnings, stats };
}

/** Every copy output's mtime, so a file that moved under us is visible. */
function copyOutMtimes(outDir: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of listFiles(outDir, ".json")) m.set(f, statSync(f).mtimeMs);
  return m;
}

/**
 * **Put the appended file in place, or leave the old one exactly as it was.**
 *
 * Never leave a broken file behind, and never leave a half-written one. The file
 * is the product and the append is cheap to redo, so the new content goes to a
 * sibling, is read back *from there*, and only then replaces the target —
 * `renameSync` within one directory is atomic, so a process killed at any point
 * leaves either the old file or the new one, whole. Writing in place and
 * restoring afterwards, which is what this did until 2026-09-06, has a window in
 * which the file is truncated and no code of ours is left running to fix it.
 *
 * Re-reading the target is the other half. `before` was read at the top of
 * `write`, and everything between here and there — a second run, a person with
 * the file open — would otherwise be overwritten with no trace that it existed.
 *
 * Returns the parse of what was installed, so the caller can report it without
 * reading the file a third time.
 */
export function installAppend(
  target: string,
  before: string,
  lines: Record<string, unknown>[],
): ParseResult {
  const appended = lines.map((l) => JSON.stringify(l)).join("\n");
  const after = before === "" ? `${appended}\n` : `${before.replace(/\n*$/, "\n")}${appended}\n`;
  mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.appending-${process.pid}`;
  writeFileSync(staged, after);
  try {
    /* Asked first, because "somebody else wrote this file" explains every
       other complaint that would follow from it. */
    if ((existsSync(target) ? readFileSync(target, "utf8") : "") !== before) {
      die(`${target} changed while this command ran — re-run against the file as it now is`);
    }
    const check = parseChangelog(readFileSync(staged, "utf8"));
    if (check.problems.length > 0) {
      for (const p of check.problems) console.error(`  ✗ ${p}`);
      die(`what this run would append does not parse — ${target} is untouched`);
    }
    renameSync(staged, target);
    return check;
  } finally {
    rmSync(staged, { force: true });
  }
}

function cmdWrite(root: string, work: string, force: boolean, target: string): void {
  const versions = JSON.parse(
    readFileSync(path.join(work, "assigned.json"), "utf8"),
  ) as AssignedVersion[];
  const inDir = path.join(work, "copy-in");
  const outDir = path.join(work, "copy-out");

  /* **Appending to a file you cannot read is how a good line lands under a
     broken one.** So the existing file is parsed first, and a single problem in
     it stops the run — the run's own output is fine, and re-doing it is cheaper
     than working out afterwards which lines came from where. */
  const shown = path.relative(root, target);
  const before = existsSync(target) ? readFileSync(target, "utf8") : "";
  const existing = parseChangelog(before);
  if (existing.problems.length > 0 && !force) {
    for (const p of existing.problems) console.error(`  ✗ ${p}`);
    die(`${shown} already has ${existing.problems.length} problems — nothing appended`);
  }

  /* The duplicate-agent trap, changelog.md § The traps: on the first run two
     versions were re-copied by agents launched twice, after the file had been
     written from the earlier answers. Two things are checkable — an output for
     a version this run never asked for, and an output that moves while this
     command is reading it. Both are recorded before the read and re-checked
     after it. */
  const startedAt = Date.now();
  const beforeMtimes = copyOutMtimes(outDir);
  const manifestFile = path.join(work, "copy-manifest.json");
  const freshness: string[] = [];
  if (existsSync(manifestFile)) {
    const manifest = readJson(manifestFile);
    const slugs = new Set(
      isRecord(manifest) ? arr(manifest, "slugs").filter((s): s is string => typeof s === "string") : [],
    );
    for (const f of beforeMtimes.keys()) {
      const slug = path.basename(f, ".json");
      if (!slugs.has(slug)) freshness.push(`${slug}: a copy output this run never asked for`);
    }
  }

  const report = buildLines({ versions, inDir, outDir, generatedAt: nowStamp() });

  for (const [f, mtime] of copyOutMtimes(outDir)) {
    const was = beforeMtimes.get(f);
    if (was === undefined) freshness.push(`${path.basename(f)}: appeared while this command ran`);
    else if (was !== mtime || mtime > startedAt) {
      freshness.push(`${path.basename(f)}: rewritten while this command ran`);
    }
  }

  const s = report.stats;
  console.log(
    `versions=${s.versions} visible=${s.visible} quiet=${s.quiet} entries=${s.entries} ` +
      `(headline=${s.headline} enhancement=${s.enhancement} fix=${s.fix}) commit-links=${s.commits} ` +
      `verified-changes-dropped=${s.uncited}`,
  );
  console.log(`ERRORS: ${report.errors.length}`);
  for (const e of report.errors.slice(0, 30)) console.log(`  ✗ ${e}`);
  console.log(`WARNINGS: ${report.warnings.length}`);
  for (const w of report.warnings.slice(0, 25)) console.log(`  · ${w}`);
  for (const f of freshness) console.error(`  ✗ ${f}`);

  if (freshness.length > 0 && !force) {
    die("a copy output is not the one this run assembled — check for a second agent, then re-run");
  }
  if (report.errors.length > 0 && !force) {
    die("NOT WRITING — fix the errors first");
  }
  if (report.lines.length === 0) {
    console.log("\nNothing to append.");
    return;
  }

  const first = report.lines[0];
  const last = existing.versions.at(-1);
  if (first && last && first.previous_sha !== last.sha) {
    die(
      `the first new line's previous_sha is ${String(first.previous_sha).slice(0, 8)} but the file ` +
        `ends at ${last.sha.slice(0, 8)} — re-run plan against the current file`,
    );
  }

  const check = installAppend(target, before, report.lines);

  console.log(
    `\nappended ${report.lines.length} lines to ${shown} ` +
      `(${check.versions.length} versions, ${check.versions.reduce((n, v) => n + v.entries.length, 0)} entries)`,
  );
  console.log("Read the new lines before committing them: they are public claims, written by a model.");
}

// ---------------------------------------------------------------------------
// 6. check — is the committed file sound?

function cmdCheck(root: string, target: string): void {
  if (!existsSync(target)) die(`${target} does not exist`);
  const result = parseChangelog(readFileSync(target, "utf8"));
  const entries = result.versions.reduce((n, v) => n + v.entries.length, 0);
  const visible = result.versions.filter((v) => !v.invisible).length;
  console.log(`${path.relative(root, target)}: ${result.versions.length} versions, ${visible} with entries, ${entries} entries`);
  if (result.problems.length === 0) {
    console.log("no problems");
    return;
  }
  for (const p of result.problems) console.error(`  ✗ ${p}`);
  die(`${result.problems.length} problems`);
}

// ---------------------------------------------------------------------------

const USAGE = `changelog.ts — the deterministic stages of docs/project/changelog.md

  plan --deploys <file.json>   the version spine, the pre-filter and the trawl batches.
                               Refuses to start on top of an earlier run's stage
                               directories; --fresh deletes them first
  review-prompt [--day <d>]    one GPT Sol review prompt per day of history
  verify [--reassign]          fold in the rulings, assign items to versions.
                               Fails on a user-facing item nobody ruled on,
                               unless --allow-unreviewed
                               --reassign rebuilds assigned.json from the files
                               under verified/ without rewriting them, which is
                               what to run after acting on a review's regroup
  copy-inputs                  one copy-stage input per version with something to say
  write                        validate the copy and append to ${CHANGELOG_FILE}
  check [--file <path>]        parse the committed file and say what is wrong with it

  --file <path>                read/append somewhere other than ${CHANGELOG_FILE},
                               which is how a run is rehearsed against a copy

  --work <dir>                 where the intermediates live (default ${DEFAULT_WORK})
  --allow-unreviewed           verify without the review stage. For a rehearsal.
  --fresh                      empty the work directory's stage directories first
  --force                      write despite errors. For a person who has read them.
`;

export function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      work: { type: "string" },
      deploys: { type: "string" },
      day: { type: "string" },
      file: { type: "string" },
      force: { type: "boolean" },
      fresh: { type: "boolean" },
      "allow-unreviewed": { type: "boolean" },
      reassign: { type: "boolean" },
    },
  });

  const root = repoRoot();
  const work = path.resolve(root, values.work ?? DEFAULT_WORK);
  const command = positionals[0];

  switch (command) {
    case "plan":
      if (values.deploys === undefined) die("plan needs --deploys <file.json>");
      cmdPlan(
        root,
        work,
        path.resolve(values.deploys),
        changelogPath(root, values.file),
        values.fresh === true,
      );
      break;
    case "review-prompt":
      cmdReviewPrompt(root, work, values.day);
      break;
    case "verify":
      cmdVerify(root, work, values["allow-unreviewed"] === true, values.reassign === true);
      break;
    case "copy-inputs":
      cmdCopyInputs(work);
      break;
    case "write":
      cmdWrite(root, work, values.force === true, changelogPath(root, values.file));
      break;
    case "check":
      cmdCheck(root, changelogPath(root, values.file));
      break;
    default:
      console.log(USAGE);
      process.exit(command === undefined ? 0 : 1);
  }
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
