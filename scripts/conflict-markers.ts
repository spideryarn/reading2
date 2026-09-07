/**
 * **No tracked file carries an unresolved merge conflict.**
 *
 *     npm run check:conflicts
 *
 * A gate in `npm run check` (scripts/check.ts), green on this tree, so a
 * failure means something is newly wrong today.
 *
 * ## Why this repository in particular
 *
 * On 2026-09-02 a merge stopped half-way and left conflict markers inside
 * [`drizzle/meta/_journal.json`](../drizzle/meta/_journal.json). Every migration
 * command reads that file, so all of them went blind at once, and what the
 * reader saw was `SyntaxError: Expected ',' or '}' after property value in JSON
 * at position 8151` — a byte offset, nothing about a merge, nothing to act on.
 * The hour after that went on sha256ing every `.sql` file across the main tree
 * and seven worktrees to clear a ledger that had been correct the whole time.
 * docs/postmortems/260903b-the-ledger-took-the-blame-for-a-half-finished-merge.md.
 *
 * `readJournal` in scripts/migration-ledger.ts has refused a marked-up journal
 * since that day. **This is the other half of the same postmortem** — its
 * recommendation 3, *"the widest fix, and the one not yet done"* — because the
 * journal is only the file where the damage was loudest, not the only one it can
 * happen to. AGENTS.md has a dozen agents integrating with `git merge` in trees
 * they share, so a stray marker in a machine-read file is a standing structural
 * risk rather than an accident.
 *
 * ## The false-positive story, which is the whole of the design
 *
 * A marker is seven identical characters, and this repository legitimately
 * quotes merge conflicts in its own documentation — `git-resolve-merge-conflicts.md`,
 * `database.md`, and a review prompt that pastes a whole diff. A check that
 * cries wolf gets switched off, and every other session on this box runs
 * `npm run check`, so a false positive here breaks other people's gates.
 *
 * Three rules, and each one is paying for a measured case:
 *
 * 1. **Column zero, and followed by a space or the end of the line** — which is
 *    exactly what git writes: `<<<<<<< label`, `||||||| label`, `=======`,
 *    `>>>>>>> label`. Every legitimate quotation in this tree is either inline
 *    inside backticks or prefixed with `+` inside a quoted diff. Measured on
 *    2026-09-07: a few dozen files match a run of seven marker characters
 *    *anywhere* on a line, and **none** matches one at column zero. The exact
 *    counts are in the plan doc with their date; the run prints today's.
 * 2. **`<`, `>` and `|` always fail; `=` only in a file that already carries one
 *    of those.** A line of `=` at column zero is a valid Markdown setext
 *    heading underline and a common divider, and Markdown is most of this
 *    repository. The other three have no such use.
 * 3. **Seven *or more*.** Seven is git's default and the only size anything
 *    here uses; the `,` catches a repository that raised it, and diff3's
 *    `|||||||` is included. This is the same expression `readJournal` uses in
 *    scripts/migration-ledger.ts, deliberately.
 *
 * ## Three blind spots, stated rather than hidden
 *
 * - **A lowered `conflict-marker-size`.** It is configurable *downwards*, and a
 *   four-character marker passes. That is the identical limit `readJournal`
 *   has, named in docs/project/database.md § A watermark is not a ledger as
 *   *"a good first line rather than a fence"*, and this matches it on purpose:
 *   lowering the floor on a gate every agent runs would start reporting `====`
 *   dividers and `<<<<` in prose. Nothing in this repo sets the option.
 * - **A lone `=======`** — a file where somebody deleted the `<<<<<<<` and left
 *   the separator. The price of rule 2, and not the incident's shape: the
 *   journal contained `<<<<<<< HEAD`. A lone `|||||||` is **not** in this blind
 *   spot; `readJournal`'s own suite tests exactly that half-finished
 *   resolution, and GPT Sol caught an earlier draft that had let it through.
 * - **A marker quoted at column zero inside a fenced code block** is reported,
 *   and once one has, a legitimate setext underline in the same file is
 *   reported alongside it. Deliberate: telling a fence from a conflict needs a
 *   Markdown parser, and this gate is not going to grow one. Indent the
 *   quotation, prefix it as a diff line, or build it with `repeat()`.
 *
 * **Binary is detected here rather than delegated**, and over the whole file
 * rather than a prefix. `git grep -I` does not skip
 * `evals/pdf/much-harder/source.pdf` — it reads it as text and reports 69 lines
 * beginning `<<`, because it has no NUL in its first 8 KB, and neither does
 * `evals/pdf/titles/copernicus-ball-lightning-title/source.pdf`. Git's
 * first-bytes heuristic would therefore scan both as text; the whole buffer is
 * already in memory, so scanning all of it costs nothing and classifies them
 * correctly. It is still a heuristic, not identification.
 *
 * **If you need to quote a marker at column zero**, indent it, prefix it as a
 * diff line, or build it with `repeat()`. That is what this file and its test do:
 * neither contains a literal run of seven, which is why they do not fail
 * themselves. `260903b`'s own receipts record the first journal-guard fixture
 * tripping `git diff --check` inside the very test that guards against markers.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMain } from "../src/is-main.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One marker line: where it is, and what it says. */
export interface MarkerLine {
  readonly line: number;
  readonly text: string;
}

/**
 * A run of seven or more of one marker character at column zero, ending the
 * line or followed by a space.
 *
 * Written with quantifiers rather than literal runs so this file does not match
 * itself — see the header.
 */
const OPENING = /^(?:<{7,}|>{7,}|\|{7,})(?: .*)?$/;
const SEPARATOR = /^={7,}$/;

/**
 * The conflict markers in one file's text, or an empty list.
 *
 * A pure function over the text, so the whole-tree assertion has something to
 * be driven with: a scanner whose only input is the repository can only ever be
 * watched passing, and a regex typo looks exactly like a clean tree
 * (docs/reusable/silent-success.md).
 *
 * Splits on `/\r?\n/` rather than matching `$`, because a CRLF file would
 * otherwise leave `\r` on the end of a bare separator and never match — the
 * same reason `readJournal` reads real lines.
 */
export function conflictMarkers(text: string): MarkerLine[] {
  const lines = text.split(/\r?\n/);
  const opening: MarkerLine[] = [];
  const separators: MarkerLine[] = [];
  for (const [i, raw] of lines.entries()) {
    const at = { line: i + 1, text: raw };
    if (OPENING.test(raw)) opening.push(at);
    else if (SEPARATOR.test(raw)) separators.push(at);
  }
  /* A lone `=======` is a Markdown setext underline far more often than it is
     half a conflict, so it counts only once the file has said it is one. */
  if (opening.length === 0) return [];
  return [...opening, ...separators].sort((a, b) => a.line - b.line);
}

/**
 * A NUL byte anywhere means "do not treat as text".
 *
 * Git's own heuristic looks only at the first 8 KB, and **two tracked PDFs pass
 * it** — they carry no NUL that early, so `git grep -I` scans them as text. The
 * whole file is already read by the time this is asked, so widening the window
 * costs nothing and gets those two right. Still a heuristic: a genuinely
 * NUL-free binary would be scanned, and a text file with a stray NUL skipped.
 */
export function looksBinary(bytes: Buffer): boolean {
  return bytes.includes(0);
}

/** Every tracked path, as git lists them. */
export function trackedFiles(root = ROOT): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((p) => p !== "");
}

export interface Finding {
  readonly file: string;
  readonly markers: MarkerLine[];
}

/** Every tracked file that carries an unresolved conflict. */
export function scanRepository(root = ROOT): Finding[] {
  const findings: Finding[] = [];
  for (const file of trackedFiles(root)) {
    const full = path.join(root, file);

    /**
     * **`lstat`, so a symlink is skipped rather than followed.**
     *
     * Two reasons. `CLAUDE.md` is a symlink to `AGENTS.md` and both are
     * tracked, so following it would report the same finding twice under two
     * names. And a tracked path can be a submodule directory or a link to
     * nothing, neither of which is a file with lines in it.
     *
     * Anything that is not a regular file is skipped **knowingly**; anything
     * that is one and cannot be read is a failure this check has to report
     * rather than swallow, because "every tracked file" is the claim it makes.
     */
    let kind: ReturnType<typeof lstatSync>;
    try {
      kind = lstatSync(full);
    } catch (err) {
      /* Listed by git and not on disk — a deleted-but-staged path. */
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (!kind.isFile()) continue;

    const bytes = readFileSync(full);
    if (looksBinary(bytes)) continue;
    const markers = conflictMarkers(bytes.toString("utf8"));
    if (markers.length > 0) findings.push({ file, markers });
  }
  return findings;
}

function main(): void {
  const scanned = trackedFiles().length;
  const findings = scanRepository();
  if (findings.length === 0) {
    /* The count is the point of the line: "none" over nothing scanned is what a
       moved root or a changed flag looks like, and it reads identically to a
       clean tree (docs/reusable/silent-success.md). */
    console.log(`conflict markers: none in ${scanned} tracked files`);
    return;
  }
  console.error("Unresolved merge conflict markers in tracked files:\n");
  for (const { file, markers } of findings) {
    for (const m of markers) console.error(`  ${file}:${m.line}: ${m.text.slice(0, 60)}`);
  }
  console.error(
    "\nFinish the merge in each file above, then commit.\n" +
      "If the file is under drizzle/, resolving the markers is NOT resolving the fork:\n" +
      "each side wrote a new snapshot and git merged them without a word. Run `npm run db:chain`,\n" +
      "and read docs/project/database.md § Repairing a fork before renumbering anything.\n" +
      "To quote a marker in a doc on purpose, indent it or build it with repeat().",
  );
  process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
