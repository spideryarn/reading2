/**
 * Read the job records in `data/_jobs/`, the way the production loader does.
 *
 * Suites that assert on, or tidy up, what the queue left on disk used to
 * `readdir` this directory themselves. That is a race: `writeOnce` in
 * `src/store/jobs-fs.ts` writes `<id>.json.<pid>.<n>.tmp` and renames, so a bare
 * `readdir` hands back a zero-byte temp file mid-write and `JSON.parse` dies
 * with `Unexpected end of JSON input`. `loadFromDisk` in that same file filters
 * for `.json`; this is a **second implementation** of that filter, and the most
 * that can honestly be claimed is that there is now one copy of it on the test
 * side instead of one per suite. The two can still drift — nothing checks them
 * against each other — and what would notice if they did is that every suite
 * reading through here reads files the real queue wrote, so a production filter
 * that stopped matching what production writes shows up as one of them finding
 * nothing where it expected rows.
 *
 * **Only `ENOENT` is treated as nothing there**, and that is the rest of what
 * "the way production does" means: `loadFromDisk` returns on a missing
 * directory and rethrows every other `readdir` failure. A blanket `.catch(() =>
 * [])` here would turn `EACCES` or `EIO` into an empty list, so a suite asking
 * what the queue left behind would be told "no jobs" because the directory
 * could not be read at all — green for the reason the assertion exists to rule
 * out (docs/reusable/silent-success.md).
 *
 * The one `.catch` that stays is the `ENOENT` on the file: a `.json` can vanish
 * under a concurrent `forgetJob` between the `readdir` and the `readFile`, and
 * that is an ordinary race rather than a failure.
 *
 * The one caller that must *not* use this is the test in `tests/jobs.test.ts`
 * asserting the temp files get cleaned up — reading them is its whole point.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { Job } from "../../src/types.js";

const JOBS_DIR = path.resolve(import.meta.dirname, "..", "..", "data", "_jobs");

export type JobFileOnDisk = {
  /** Absolute path, ready to `rm`. */
  path: string;
  /** Partial, because a file caught vanishing parses as `{}`. */
  record: Partial<Job>;
};

const missing = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === "ENOENT";

/**
 * `dir` is a seam for tests/job-files-on-disk.test.ts, which has to hand this a
 * directory that fails in order to check that the failure comes out. Every real
 * caller takes the default.
 */
export async function jobFilesOnDisk(dir: string = JOBS_DIR): Promise<JobFileOnDisk[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (!missing(err)) throw err;
    return []; // nothing has ever been queued here
  }

  const out: JobFileOnDisk[] = [];
  for (const file of names.filter((f) => f.endsWith(".json"))) {
    const full = path.join(dir, file);
    let text: string;
    try {
      text = await readFile(full, "utf8");
    } catch (err) {
      if (!missing(err)) throw err;
      text = "{}"; // forgotten between the readdir and the read
    }
    out.push({ path: full, record: JSON.parse(text) as Partial<Job> });
  }
  return out;
}
