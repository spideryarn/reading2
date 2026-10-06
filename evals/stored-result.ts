/**
 * **Where a saved eval result is, when its name may be the old one.**
 *
 * Learn's eval scripts wrote `evals/results/remember-*` until 2026-10-06, when
 * the mode's identifiers became `learn`. New runs write `learn-*`. The saved
 * runs are history and keep their names, and the commands that read a saved
 * run back (the Explore judge, its critic pairs, the plain-words arms) must
 * still find them. One rule, here, rather than a copy in each script.
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md,
 * GPT Sol's plan review, PR-7.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const CURRENT = "learn";
const FORMER = "remember";

/**
 * The name a result called `name` had before the rename, or `null` when the
 * rename did not touch it. Only a leading `learn` that is the whole word
 * moves: `learn-explore.x.json` and `learn.json`, never `learning.json`.
 */
export function formerName(name: string): string | null {
  if (!name.startsWith(CURRENT)) return null;
  const rest = name.slice(CURRENT.length);
  return rest === "" || /^[-.]/.test(rest) ? `${FORMER}${rest}` : null;
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
