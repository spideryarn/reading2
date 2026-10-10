/**
 * **Where a saved eval result is, when its name may be the old one.**
 *
 * Eval scripts can outlive a stored-name rename. New runs use the current
 * name; saved runs are history and keep theirs. The commands that read a
 * saved run back (the Explore judge, its critic pairs, the plain-words arms)
 * must still find them. One rule, here, rather than a copy in each script.
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md,
 * GPT Sol's plan review, PR-7.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const FORMER_NAMES = new Map([
  ["learn", "remember"],
  ["bibliography", "citations"],
]);

/**
 * The name a result called `name` had before a rename, or `null` when no
 * rename touched it. Only a leading current name that is the whole word
 * moves: `learn-explore.x.json` and `learn.json`, never `learning.json`.
 */
export function formerName(name: string): string | null {
  for (const [current, former] of FORMER_NAMES) {
    if (!name.startsWith(current)) continue;
    const rest = name.slice(current.length);
    if (rest === "" || /^[-.]/.test(rest)) return `${former}${rest}`;
  }
  return null;
}

/**
 * The file to read for `file`: itself if it exists, else the same file under
 * its former name if that exists, else itself again — so a run that was never
 * made fails on the name a reader would look for today.
 */
export function storedResult(file: string): string {
  if (existsSync(file)) return file;
  const former = formerName(path.basename(file));
  if (former === null) return file;
  const old = path.join(path.dirname(file), former);
  return existsSync(old) ? old : file;
}
