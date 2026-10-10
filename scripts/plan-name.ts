/**
 * **What should this new planning doc be called?**
 *
 *   npx tsx scripts/plan-name.ts "Remote Claude box"
 *   docs/plans/260831a-remote-claude-box.md
 *
 * Planning docs are named `yyMMdd<letter>-kebab-description.md` so they sort by
 * the day they were started (docs/reusable/write-planning-doc.md). The letter is
 * the part you cannot work out by yourself: it depends on what else was started
 * today, and `docs/plans/` has hundreds of files in it.
 *
 * **Two agents are never handed the same letter.** Every git worktree of the
 * repo shares `git rev-parse --git-common-dir`, so the letters taken are the
 * union of three things: the files in this checkout, the files on the local
 * `origin/dev` (no fetch; stale is fine), and a reservation file in the common
 * dir (`spideryarn-plan-names`, one `<dir> <yyMMdd><letter>` line per name ever
 * issued), read and appended under a lock. Before this, agents in separate
 * worktrees all saw the same files and all got the same letter. If the lock
 * cannot be had (a leftover from a killed run), it falls back to the old
 * behaviour with a warning rather than refusing to name anything.
 *
 * **Plans written before 2026-08-31 have no date prefix at all**, and are left
 * alone. So `usedLetters` matches only the prefixed form; an unprefixed
 * `admin-page.md` is invisible to it, which is what we want.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMain } from "../src/is-main.js";
import { LockHeldError, takeLockFile } from "./lockfile.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLANS_DIR = "docs/plans";

/**
 * `yyMMdd` for a date, in local time.
 *
 * Local rather than UTC because the prefix is "the day Greg started this", and
 * a plan begun at 11pm in London belongs to that evening, not to tomorrow.
 */
export function datePrefix(when: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(when.getFullYear() % 100)}${p(when.getMonth() + 1)}${p(when.getDate())}`;
}

/**
 * Lower-case kebab, per AGENTS.md — including acronyms. Upstream keeps `ToC`
 * capitalised; this repo does not, and one rule with no exceptions is worth
 * more here than the readability of one word.
 */
export function toSlug(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`No usable words in description: ${JSON.stringify(description)}`);
  return slug;
}

/**
 * `0 → a`, `25 → z`, `26 → aa`, `27 → ab`, … — spreadsheet columns.
 *
 * Past `z` matters: this repo has 687 plans, and a day that starts 27 of them
 * is not impossible. The alternative is an error at the 27th, which would land
 * on whoever is busiest.
 */
export function letterAt(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** The letters already taken on `date`, from a list of plan filenames. */
export function usedLetters(filenames: string[], date: string): Set<string> {
  const used = new Set<string>();
  for (const name of filenames) {
    const letter = path.basename(name).match(/^(\d{6})([a-z]+)-/);
    if (letter && letter[1] === date) used.add(letter[2]!);
  }
  return used;
}

/** The filename to use, given what is already there. */
export function nextPlanFilename(
  filenames: string[],
  date: string,
  description: string,
  ext = ".md",
): string {
  const used = usedLetters(filenames, date);
  let i = 0;
  while (used.has(letterAt(i))) i += 1;
  return `${date}${letterAt(i)}-${toSlug(description)}${ext}`;
}

/**
 * The directories this convention covers, and what a file in each is called.
 * `--dir=research` picks one.
 *
 * The convention is the **prefix**, not the file type: `docs/tutorials/` holds
 * self-contained HTML (docs/reusable/write-tutorial.md), and it sorts by day
 * for the same reason the others do.
 */
export const DIRS: Record<string, { dir: string; ext: string }> = {
  plans: { dir: "docs/plans", ext: ".md" },
  research: { dir: "docs/research", ext: ".md" },
  investigations: { dir: "docs/investigations", ext: ".md" },
  postmortems: { dir: "docs/postmortems", ext: ".md" },
  tutorials: { dir: "docs/tutorials", ext: ".html" },
};


/** Names already reserved for `dirKey` on `date`, from the reservation file's text, as fake filenames. */
export function reservedLetters(text: string, dirKey: string, date: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\S+) (\d{6})([a-z]+)$/);
    if (m && m[1] === dirKey && m[2] === date) out.push(`${date}${m[3]}-reserved`);
  }
  return out;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Pick the filename and record its letter, under a lock beside `reservationFile`.
 * `others` are filenames from outside this checkout (origin/dev).
 */
export function claimPlanFilename(opts: {
  dirKey: string;
  existing: string[];
  others?: string[];
  reservationFile: string;
  date: string;
  description: string;
  ext: string;
}): string {
  const { dirKey, date, reservationFile } = opts;
  const lockFile = `${reservationFile}.lock`;
  let lock: ReturnType<typeof takeLockFile> | null = null;
  for (let i = 0; i < 100 && !lock; i++) {
    try {
      lock = takeLockFile(lockFile);
    } catch (err) {
      if (!(err instanceof LockHeldError) || !err.holderAlive) {
        console.error(`plan-name: could not lock ${lockFile}; not reserving. ${(err as Error).message}`);
        break;
      }
      sleep(50);
    }
  }
  try {
    const reserved = existsSync(reservationFile) ? readFileSync(reservationFile, "utf8") : "";
    const filename = nextPlanFilename(
      [...opts.existing, ...(opts.others ?? []), ...reservedLetters(reserved, dirKey, date)],
      date,
      opts.description,
      opts.ext,
    );
    if (lock) {
      const letter = filename.slice(date.length).split("-")[0]!;
      appendFileSync(reservationFile, `${dirKey} ${date}${letter}\n`);
    }
    return filename;
  } finally {
    lock?.release();
  }
}

/** Filenames in `dir` on the local origin/dev; empty if there is no such ref. */
function originDevFiles(dir: string): string[] {
  try {
    return execFileSync("git", ["ls-tree", "--name-only", "origin/dev", `${dir}/`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitCommonDir(): string | null {
  try {
    return path.resolve(
      ROOT,
      execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).trim(),
    );
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length) ?? "plans";
  const target = DIRS[dirArg];
  const description = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!target || !description) {
    console.log(
      `usage: npx tsx scripts/plan-name.ts [--dir=${Object.keys(DIRS).join("|")}] <description of the work>`,
    );
    process.exitCode = 1;
    return;
  }
  /* Every file, not just `*.md`: an `.activity.log` sitting beside a review
     answer holds a letter too, and a letter this misses is a letter reused. */
  const existing = globSync(path.join(ROOT, target.dir, "*"));
  const others = originDevFiles(target.dir);
  const common = gitCommonDir();
  const date = datePrefix(new Date());
  const filename = common
    ? claimPlanFilename({
        dirKey: dirArg,
        existing,
        others,
        reservationFile: path.join(common, "spideryarn-plan-names"),
        date,
        description,
        ext: target.ext,
      })
    : nextPlanFilename([...existing, ...others], date, description, target.ext);
  console.log(path.join(target.dir, filename));
}

if (isMain(import.meta.url)) main();
