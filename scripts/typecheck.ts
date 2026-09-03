/**
 * Run every TypeScript project, and check that each one actually checked
 * something.
 *
 *   npm run typecheck
 *
 * The second half is the point. `tsc -p src/web/tsconfig.json` exited 0 for
 * weeks while resolving zero files, because the config it extended carried an
 * `exclude` that happened to name the very directory it included (commit
 * fde38bb). Nothing was wrong with the code and nothing was being checked, and
 * the passing exit code got quoted as evidence that the client was fine.
 *
 * So this script asserts two things a plain `tsc &&  tsc` cannot:
 *
 *   1. every project resolves at least one local file — an empty project is a
 *      failure, not a pass;
 *   2. every .ts/.tsx file in the repo is resolved by at least one project —
 *      which is how `tests/` came to be typechecked by nothing at all, since
 *      vitest strips types without looking at them.
 *
 * Projects are discovered rather than listed, so adding one is enough to get it
 * run. See docs/project/typechecking.md, and docs/reusable/silent-success.md
 * for the family of bug this belongs to.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Kept deliberately short. Every directory listed here is one the coverage
 * check below cannot see into, so "there is no TypeScript in there" has to be
 * true by construction rather than by assumption: these hold dependencies, git
 * internals, build output and CLI scratch, none of which is ours. `data/`,
 * `example/` and `output/` are artefact stores and are walked anyway — they are
 * small, and a source file appearing in one is exactly the surprise worth
 * hearing about.
 *
 * `.temp` is where the Supabase CLI puts a running stack's scratch state, and
 * `supabase start` drops a Deno edge-runtime `index.ts` in there. It is not our
 * source, it is git-ignored, and it exists only while the local stack is up —
 * so without this the typecheck passes or fails depending on whether somebody
 * happens to have a database running.
 */
/** Directory names never walked into, matched by basename at any depth. */
const SKIP = new Set(["node_modules", ".git", "dist", ".temp"]);

/**
 * Directories skipped by their **exact path**, not by name.
 *
 * `claude --worktree <name>` checks out a whole second copy of this repository
 * at `.claude/worktrees/<name>/`, tsconfigs and all. This walk starts at the
 * repository root and recurses, so without this the primary typechecks every
 * peer's half-finished tree and reports their errors as its own — slower and
 * noisier with every worktree, and no hint as to why. Verified by breaking it:
 * a probe tsconfig there produced `✗ .claude/worktrees/probe/tsconfig.json:
 * resolved 0 files.` Inert until the first worktree exists.
 *
 * **By path rather than by basename**, which was the first version and was a
 * hole: `.claude/` also holds tracked hooks and settings, so skipping every
 * directory called `.claude` would mean a TypeScript hook added there later was
 * checked by nothing, silently — and this script's own last line claims every
 * source file is covered by some project. GPT Sol, finding 7 in
 * docs/plans/260828r-worktrees-step2-review-sol.md.
 * docs/project/worktrees.md.
 */
const SKIP_PATHS = new Set([path.join(ROOT, ".claude", "worktrees")]);

function walk(dir: string, hit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (SKIP_PATHS.has(full)) continue;
    if (entry.isDirectory()) walk(full, hit);
    else hit(full);
  }
}

const projects: string[] = [];
const sources: string[] = [];
walk(ROOT, (file) => {
  const name = path.basename(file);
  // tsconfig.base.json holds compiler options only and resolves no files by
  // design — it is not a project and must not be run as one.
  if (name === "tsconfig.json") projects.push(file);
  else if (/\.tsx?$/.test(name)) sources.push(file);
});
projects.sort();
sources.sort();

if (projects.length === 0) {
  console.error("No tsconfig.json found. Something is very wrong.");
  process.exit(1);
}

/**
 * **The compiler itself, checked before anything is asked of it.**
 *
 * Every failure below is phrased as a fact about a project's file list, so a
 * compiler that never ran gets described as a project that includes nothing.
 * That is what happened on 2026-09-03 in a linked worktree whose `node_modules`
 * had never been populated: `execFileSync` threw ENOENT, the catch read
 * `err.stdout` and found nothing there, and all three projects were reported as
 * `resolved 0 files. Usually an "include"/"exclude" inherited through
 * "extends"` — which sends the reader into tsconfig.base.json, where nothing is
 * wrong, for as long as it takes them to doubt the message.
 *
 * The verdict was never wrong; only the cause was. But a check that fails for
 * the wrong stated reason costs about as much as one that does not fail, which
 * is why this is worth a guard of its own rather than a better sentence in the
 * one below.
 *
 * `npm ci` is what puts the binary here; `npm run worktree:setup` is what runs
 * it in a linked worktree (docs/project/worktrees.md).
 */
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc");
if (!existsSync(TSC)) {
  console.error(
    `✗ ${path.relative(ROOT, TSC)} is not here, so no project can be checked.\n` +
      `  This is a missing install, not a missing "include": run npm ci, or\n` +
      `  npm run worktree:setup if this is a linked worktree.`,
  );
  process.exit(1);
}

const covered = new Set<string>();
let failed = false;

for (const project of projects) {
  const rel = path.relative(ROOT, project);
  let output: string;
  let ok = true;
  try {
    // --listFiles gives the resolved file list and the errors in one pass, so
    // the count below is the list tsc really used, not one we recomputed from
    // include/exclude and could get wrong in the same way tsc did.
    output = execFileSync(
      TSC,
      ["--noEmit", "--listFiles", "-p", project],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    ok = false;
    /* A compile failure and a failure to *run* the compiler arrive through the
       same catch, and only the first one carries stdout. Without this the
       second falls through to the empty-project branch below and is reported as
       an include/exclude problem — the guard on TSC above catches the common
       cause of that, and this catches the rest (an unexecutable binary, a
       killed process, ENOMEM). */
    const stdout = (err as { stdout?: string }).stdout;
    if (stdout === undefined) {
      console.error(
        `✗ ${rel}: tsc did not run, so this project was not checked.\n` +
          `  ${(err as Error).message}`,
      );
      failed = true;
      continue;
    }
    output = String(stdout);
  }

  const errors = output.split("\n").filter((line) => /error TS\d+:/.test(line));
  const local = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(ROOT) && !line.includes("node_modules"));
  for (const file of local) covered.add(file);

  if (local.length === 0) {
    console.error(
      `✗ ${rel}: resolved 0 files.\n` +
        `  An empty project cannot fail, so a passing exit code here means nothing.\n` +
        `  Usually an "include"/"exclude" inherited through "extends" — see the\n` +
        `  comment at the top of tsconfig.base.json.`,
    );
    failed = true;
    continue;
  }

  if (ok && errors.length === 0) {
    console.log(`✓ ${rel}  (${local.length} files)`);
  } else {
    console.error(`✗ ${rel}  (${local.length} files, ${errors.length} errors)`);
    for (const line of errors) console.error(`  ${line}`);
    failed = true;
  }
}

const unchecked = sources.filter((file) => !covered.has(file));
if (unchecked.length > 0) {
  console.error(
    `✗ ${unchecked.length} file(s) are checked by no project at all:\n` +
      unchecked.map((f) => `  ${path.relative(ROOT, f)}`).join("\n") +
      `\n  Add them to an existing project's "include", or give them one.`,
  );
  failed = true;
} else {
  console.log(`✓ all ${sources.length} source files are covered by some project`);
}

process.exit(failed ? 1 : 0);
