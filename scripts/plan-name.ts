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
 * **Two agents can be handed the same name, and that is fine.** There is no
 * lock and no reservation — this reads the directory and answers. Two agents
 * asking at the same moment both get `a`, and upstream says the same: don't
 * worry if it happens. A lock here would be a lock across git worktrees, which
 * is a much bigger thing than the problem (a duplicate prefix costs nothing —
 * the files still sort together, and the descriptions differ).
 *
 * **Plans written before 2026-08-31 have no date prefix at all**, and are left
 * alone. So `usedLetters` matches only the prefixed form; an unprefixed
 * `admin-page.md` is invisible to it, which is what we want.
 */
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMain } from "../src/is-main.js";

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
): string {
  const used = usedLetters(filenames, date);
  let i = 0;
  while (used.has(letterAt(i))) i += 1;
  return `${date}${letterAt(i)}-${toSlug(description)}.md`;
}

/** The directories this convention covers. `--dir=research` picks one. */
export const DIRS: Record<string, string> = {
  plans: "docs/plans",
  research: "docs/research",
  postmortems: "docs/postmortems",
};

function main(): void {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length) ?? "plans";
  const dir = DIRS[dirArg];
  const description = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!dir || !description) {
    console.log(
      `usage: npx tsx scripts/plan-name.ts [--dir=${Object.keys(DIRS).join("|")}] <description of the work>`,
    );
    process.exitCode = 1;
    return;
  }
  /* Every file, not just `*.md`: an `.activity.log` sitting beside a review
     answer holds a letter too, and a letter this misses is a letter reused. */
  const existing = globSync(path.join(ROOT, dir, "*"));
  console.log(path.join(dir, nextPlanFilename(existing, datePrefix(new Date()), description)));
}

if (isMain(import.meta.url)) main();
