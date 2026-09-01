/**
 * **Typecheck what is in git, not what is in your tree** — and, before you
 * commit, what git *would* hold if you committed.
 *
 *   npm run typecheck:committed                    # does HEAD compile?
 *   npm run typecheck:committed -- src/a.ts …      # would HEAD + these compile?
 *
 * ## Why this exists, given that it was already written down
 *
 * [typechecking.md](../docs/project/typechecking.md) has described this bug
 * since 2026-08-28, has a worked example of it happening twice, and prescribes
 * the remedy in as many words: *"Build the candidate, not the baseline.
 * `git worktree add --detach <tmp> HEAD`, symlink `node_modules` in, copy over
 * the files you are about to commit, and run the gate there."*
 *
 * It happened again on 2026-08-31, and `HEAD` sat broken in three places while
 * every working tree was green. So the gap was never the knowledge. **It was
 * that the remedy is four manual steps and a plain `npm run typecheck` is one**,
 * and the four-step one is the one you skip at midnight. This file is that
 * recipe with the steps taken out of the reader's hands. Nothing here is a new
 * idea; the only contribution is that it is one word long.
 *
 * ## The thing no local check can do, stated plainly
 *
 * `npm run typecheck` reads your working tree. The build reads the repository.
 * Those are different objects, and they come apart on exactly one thing: **the
 * files you did not commit.** So a green tree tells you nothing about `HEAD`,
 * and — the half people forget — a red tree tells you nothing either.
 *
 * On 2026-08-31 that produced a repository whose `src/blocks.ts` imported
 * `./reserved.js` while `src/reserved.ts` was untracked, and whose `src/types.ts`
 * did not export a `BlockContext` that the committed `src/blocks.ts` asked for.
 * A dozen sessions all typechecked clean. Vercel builds from the repository.
 *
 * ## Why it re-runs the repo's own typecheck rather than calling tsc
 *
 * `scripts/typecheck.ts` knows two things a bare `tsc` does not — that a project
 * resolving zero files is a failure rather than a pass, and that every `.ts` in
 * the tree must be covered by some project. Both were learned the hard way
 * (see its header). Calling `tsc` here would be a second, weaker definition of
 * "does this repo typecheck", and the second definition is the one that drifts.
 * So the extracted tree runs *its own copy* of that script, which is also the
 * copy that was committed — so this checks the checker too.
 *
 * ## What it deliberately does not do
 *
 * It does not run the tests. Tests need fixtures, a database and minutes;
 * `HEAD` failing to *compile* is the cheap half and the half that was actually
 * broken. If you want the rest, the extracted directory is left in place on
 * failure and its path is printed, so you can go and run whatever you like in
 * it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The files the caller wants checked *as if committed*, on top of HEAD. */
const candidate = process.argv.slice(2).filter((a) => !a.startsWith("-"));

/**
 * Lay `HEAD` out in a directory of its own.
 *
 * `git archive` rather than `git worktree add`, which is what typechecking.md
 * suggests — because a worktree is a mutation of this repository's state and
 * this repository has a rule against git commands that can disturb anybody's
 * work (AGENTS.md). `git archive` writes a tar to a temp file and touches
 * nothing. Same bytes, no shared state, and nothing to clean up if this process
 * is killed halfway.
 */
function extractHead(into: string): void {
  const tar = path.join(into, "..", "head.tar");
  execFileSync("git", ["archive", "--format=tar", "-o", tar, "HEAD"], { cwd: ROOT });
  execFileSync("tar", ["-xf", tar, "-C", into]);
  rmSync(tar, { force: true });
}

/**
 * Say *why* a module is missing, which the compiler cannot.
 *
 * `Cannot find module './reserved.js'` is true and unhelpful: it does not say
 * whether the file was deleted, misspelled, or — the case that actually happens
 * — written, imported, and never `git add`ed. That last one has a specific
 * remedy and the reader should not have to work out which of the three they are
 * looking at. So every unresolved import is checked against the working tree:
 * if the file is sitting right there untracked, say so and name it.
 */
function explainMissing(errors: string): string[] {
  const notes: string[] = [];
  const untracked = new Set(
    execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean),
  );

  for (const line of errors.split("\n")) {
    // "src/blocks.ts(30,67): error TS2307: Cannot find module './reserved.js'"
    const hit = /^(\S+?)\(\d+,\d+\): error TS2307: Cannot find module '([^']+)'/.exec(line.trim());
    if (!hit) continue;
    const [, importer, spec] = hit;
    if (!importer || !spec || !spec.startsWith(".")) continue;
    const guess = path.normalize(path.join(path.dirname(importer), spec.replace(/\.js$/, "")));
    for (const ext of [".ts", ".tsx"]) {
      if (untracked.has(guess + ext)) {
        notes.push(
          `  ${guess + ext} exists in your working tree but is NOT in git,\n` +
            `    and the committed ${importer} imports it. Commit it, or do not commit ${importer}.`,
        );
      }
    }
  }
  return notes;
}

const work = mkdtempSync(path.join(tmpdir(), "spya-head-"));
const tree = path.join(work, "tree");
mkdirSync(tree);

let failed = false;
try {
  extractHead(tree);

  /* Symlinked, not installed. `npm ci` here would be minutes and a network, to
     produce the same directory that is already on this disk. The extracted tree
     is only ever read from. */
  symlinkSync(path.join(ROOT, "node_modules"), path.join(tree, "node_modules"), "dir");

  /* The candidate: HEAD, plus the files you are about to commit, which is the
     only one of the three possible answers you can act on before pushing —
     typechecking.md § build the candidate. */
  for (const rel of candidate) {
    const from = path.join(ROOT, rel);
    if (!existsSync(from)) {
      console.error(`Not a file in this tree: ${rel}`);
      process.exit(2);
    }
    const to = path.join(tree, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    execFileSync("cp", [from, to]);
  }

  const what = candidate.length ? `HEAD + ${candidate.length} file(s)` : "HEAD";
  console.log(`Typechecking ${what} in a clean extract…`);

  const run = spawnSync("npx", ["tsx", "scripts/typecheck.ts"], {
    cwd: tree,
    encoding: "utf8",
    /* Its own copy, from the archive — so a broken `scripts/typecheck.ts` is
       caught by this too rather than being the thing doing the catching. */
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  failed = run.status !== 0;

  if (!failed) {
    console.log(`✓ ${what} typechecks.`);
  } else {
    console.error(out.trimEnd());
    const notes = explainMissing(out);
    if (notes.length) {
      console.error("\nWhat this almost certainly is:\n");
      for (const note of new Set(notes)) console.error(note);
      console.error(
        "\nA working tree is not the repository. Your local typecheck cannot see this,\n" +
          "and neither can anybody else's — but the build reads the repository.\n" +
          "docs/project/typechecking.md § three ways to report it clean while it is red.",
      );
    }
    console.error(`\nThe extracted tree is at ${tree} if you want to poke at it.`);
  }
} finally {
  // Kept on failure so the reader can go and look; a pass has nothing to see.
  if (!failed) rmSync(work, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
