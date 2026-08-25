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
import { readdirSync } from "node:fs";
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
const SKIP = new Set(["node_modules", ".git", "dist", ".temp"]);

function walk(dir: string, hit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
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
      path.join(ROOT, "node_modules/.bin/tsc"),
      ["--noEmit", "--listFiles", "-p", project],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    ok = false;
    output = String((err as { stdout?: string }).stdout ?? "");
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
