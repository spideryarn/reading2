/**
 * The half-written file the test helpers used to trip over — and the failure
 * the helper must not turn into silence.
 *
 * `src/store/jobs-fs.ts` writes `<id>.json.<pid>.<n>.tmp` and renames it into
 * place, so a reader that lists this directory without filtering can catch a
 * zero-byte temp file — which is `SyntaxError: Unexpected end of JSON input`,
 * intermittently, in whichever suite happened to be tidying up at the time.
 *
 * The other half of this file is about the opposite mistake. The helper reads a
 * directory in order for a suite to assert what the queue left there, so a
 * `readdir` that fails and returns `[]` says "no jobs" — and the assertion goes
 * green because nothing could be read at all (docs/reusable/silent-success.md).
 * An absent directory is the one failure that genuinely means nothing is there;
 * every other one has to come out.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { jobFilesOnDisk } from "./helpers/job-files.js";

const JOBS_DIR = path.resolve(import.meta.dirname, "..", "data", "_jobs");

/**
 * **Minted per run, and `data/_jobs/` is why.**
 *
 * This fixture is written and then deleted in a real directory two `npm test`
 * runs share, so a fixed name means the second process overwrites the first's
 * file and its teardown deletes it out from under the first's assertion —
 * the one-file-in-two-processes race commit ba6882a fixed in
 * `tests/export-route.test.ts`, and docs/project/testing.md § "Mint a fixture
 * id randomly, not by counting".
 *
 * The fixed half of the name is not decoration: it is what `sweepAbandoned`
 * below can recognise. Minting costs the free cleanup a fixed name got from
 * the next run overwriting it, so this file pays it back rather than leaving
 * debris in a directory a reader has real jobs in.
 */
const PREFIX = "spya-tmpfilter-";
const ID = `${PREFIX}${randomUUID().slice(0, 8)}`;
const REAL = path.join(JOBS_DIR, `${ID}.json`);
/* The writer's exact shape: the file name, then the pid and the counter. */
const TEMP = path.join(JOBS_DIR, `${ID}.json.1234.0.tmp`);

/** Old enough that no live run can still own it. A run takes minutes. */
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/**
 * Files this suite left behind when it did not get to its `afterAll`.
 *
 * The age is load-bearing. Sweeping the prefix outright would delete the
 * fixture of a peer running this same file right now, which is the bug the
 * minting above exists to prevent.
 */
async function sweepAbandoned(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(JOBS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return;
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const full = path.join(JOBS_DIR, name);
    const info = await stat(full).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
      return null;
    });
    if (!info || Date.now() - info.mtimeMs < ABANDONED_AFTER_MS) continue;
    await rm(full, { force: true });
  }
}

beforeAll(async () => {
  await mkdir(JOBS_DIR, { recursive: true });
  await sweepAbandoned();
  await writeFile(REAL, `${JSON.stringify({ id: ID, slug: `test-${ID}` }, null, 2)}\n`, "utf8");
  await writeFile(TEMP, "", "utf8"); // opened, not yet written to
});

afterAll(async () => {
  await rm(REAL, { force: true });
  await rm(TEMP, { force: true });
});

describe("reading the jobs directory", () => {
  it("ignores a temp file caught mid-write", async () => {
    const files = await jobFilesOnDisk();
    expect(files.map((f) => f.path)).not.toContain(TEMP);
    expect(files.find((f) => f.record.id === ID)?.path).toBe(REAL);
  });
});

/* ------------------------------------------- a failure is not an empty list -- */

/**
 * A directory of our own, so the failures below are provoked without touching
 * `data/_jobs/` — which every other job suite on this box is reading while this
 * one runs. Permissions are avoided for the same reason they would be flaky as
 * root: `ENOTDIR` and `EISDIR` are the same class of error and neither depends
 * on who is running the suite.
 */
let scratch = "";

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "spya-job-files-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("a jobs directory that cannot be read", () => {
  it("says so, rather than reporting no jobs", async () => {
    /* A file where the directory should be: `readdir` gives ENOTDIR. Standing
       in for the EACCES and EIO a shared box actually hands out. */
    const notADirectory = path.join(scratch, "not-a-directory");
    await writeFile(notADirectory, "", "utf8");

    await expect(jobFilesOnDisk(notADirectory)).rejects.toThrow(/ENOTDIR/);
  });

  it("is not confused with an absent one, which really is nothing there", async () => {
    /* The control for the test above: `[]` still has to mean "never queued
       here", the way `loadFromDisk` in src/store/jobs-fs.ts treats ENOENT. */
    await expect(jobFilesOnDisk(path.join(scratch, "never-existed"))).resolves.toEqual([]);
  });

  it("says so when a record cannot be read, rather than parsing it as empty", async () => {
    /* `.json` that is a directory: `readFile` gives EISDIR. Without this, an
       unreadable record becomes `{}` and a suite asserting on `record.slug`
       simply does not see it. */
    const dir = path.join(scratch, "unreadable-record");
    await mkdir(path.join(dir, "spya-eisdir.json"), { recursive: true });

    await expect(jobFilesOnDisk(dir)).rejects.toThrow(/EISDIR/);
  });
});
