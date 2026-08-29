/**
 * The checkpoint store, backed by the filesystem — today's behaviour, behind
 * the interface D will write through.
 *
 * [checkpoints.ts](checkpoints.ts) has the contract and every decision. This
 * file has the layout and the three things that are easy to get wrong on a
 * filesystem and free in Postgres.
 *
 * ## The layout
 *
 *     <dir>/checkpoints/<namespace>/<key>.json
 *
 * One file per entry, which is `pdf-chunks/<key>.json` generalised. It is
 * deliberately **not** `labels-progress.json`'s shape — one file holding an
 * array of every entry — and the difference is the whole reason the `runId`
 * machinery in [../labels.ts](../labels.ts) exists: with many entries in one
 * file, a run that finishes and deletes it destroys another run's live work, so
 * the delete has to check whose file it is. One file per entry removes the
 * hazard instead of guarding it.
 *
 * The directory is passed in rather than derived from a slug. `fsLocations` in
 * [artifacts-fs.ts](artifacts-fs.ts) is where the layout lives and this could
 * have imported it — but `src/labels.ts` imports this in landing D and
 * `artifacts.ts` type-imports `LabelsFile` from `src/labels.ts`, so that import
 * would close a cycle and `npm run cycles` is a gate. The caller passes
 * `fsLocations(slug).dir`, which it already has.
 *
 * ## Whole or absent
 *
 * `writeFile` killed halfway leaves a file that exists and will not parse, and
 * that is not hypothetical here: a killed process left one, every later attempt
 * computed the same key, found the same broken file, threw the same
 * `SyntaxError` out of the whole extract step, and nothing could clear it —
 * ../../docs/postmortems/pdf-chunk-cache-corrupt-entry.md. So a write goes to a
 * temp file first, and a read that cannot parse is a **miss** rather than a
 * throw. It says so in the log, because a discarded entry is the only surviving
 * trace that a run was killed mid-write.
 *
 * ## `rename()`, and the version of this file that used `link()`
 *
 * An earlier version used `link`, which fails with `EEXIST` rather than
 * overwriting, so that the *first* write would win. GPT Sol found what that
 * cost, 2026-08-29: a half-written entry reads as a miss, so the caller
 * re-bought the work — and then could not store the answer, because the broken
 * file was in the way. Every attempt for ever paid again, and the `utimes` bump
 * on the EEXIST path refreshed the file's age, so the sweep protected it. It
 * turned the loud permanent failure in the postmortem above into a quiet
 * permanent charge.
 *
 * `rename` is atomic within a directory, so a reader sees the old whole file or
 * the new whole one and never a half of either. **That is what buys
 * whole-or-absent; `link` was never what bought it** — all `link` added was
 * refusing to replace one valid answer with another valid answer, and those are
 * interchangeable by construction. checkpoints.ts § Concurrency has the
 * argument, and `src/pdf-read.ts` has been doing exactly this all along.
 */

import { mkdir, readFile, readdir, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import { log } from "../log.js";
import { parseJsonFrom } from "../parse-json.js";
import {
  assertCheckpointRequest,
  type CheckpointArticleRef,
  CHECKPOINT_NAMESPACES,
  type CheckpointNamespace,
  type CheckpointStore,
  checkpointJson,
} from "./checkpoints.js";

/* `"store"` because that is what this is — src/log.ts keeps the component list
   closed on purpose, and every line here carries the namespace besides. */
const clog = log("store");

/** `<dir>/checkpoints/<namespace>` — where one namespace's entries live. */
function nsDir(dir: string, namespace: CheckpointNamespace): string {
  return path.join(dir, "checkpoints", namespace);
}

/**
 * Read one entry, or nothing.
 *
 * **Three failures collapse to the same answer, and that is correct here** —
 * unlike the artefact store, where it was a bug. Absent, unparseable and
 * unreadable all mean *buy it again*, which is the only thing the caller can
 * do about any of them; there is no fourth thing an entry could be that a
 * caller would want told apart. The artefact store has to distinguish them
 * because *absent* and *corrupt* lead to opposite decisions there (mint fresh
 * ids, or refuse) — docs/reusable/silent-success.md § the check that decides
 * "this is broken".
 */
async function readEntry<T>(
  file: string,
  about: { namespace: string; key: string },
): Promise<{ value: T } | null> {
  /* **`ENOENT` only.** A blanket `.catch(() => null)` here turned `EACCES` and
     `EIO` into "no checkpoint" — an unreadable disk reporting itself as a first
     run, and the caller paying for every chunk of a book to find out. Absence
     is one errno; everything else is a fault and goes up.
     docs/reusable/silent-success.md § a guard that goes quiet when defeated.
     GPT Sol, 2026-08-29. */
  const text = await readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (text === null) return null;
  try {
    /* `parseJsonFrom`, never bare `JSON.parse`: V8 quotes the input back in the
       message, and a checkpoint value is a transcription of the reader's own
       document. src/parse-json.ts. */
    return { value: parseJsonFrom<T>(text, `checkpoint ${about.namespace}/${about.key}`) };
  } catch {
    clog.warn(
      { ...about, bytes: text.length },
      "discarded an unreadable checkpoint entry; the work will be done again",
    );
    return null;
  }
}

/**
 * A checkpoint store over one article's directory.
 *
 * `ref.articleId` is unused here and is still required, so that a call site
 * cannot build a filesystem store today and discover it has nothing to give the
 * Postgres one tomorrow.
 */
export function createFsCheckpointStore(ref: CheckpointArticleRef, dir: string): CheckpointStore {
  return {
    async read<T>(
      slug: string,
      namespace: CheckpointNamespace,
      keys: readonly string[],
    ): Promise<Map<string, T>> {
      assertCheckpointRequest(ref, slug, namespace, keys);
      const found = new Map<string, T>();
      if (keys.length === 0) return found;
      const at = nsDir(dir, namespace);
      for (const key of keys) {
        const file = path.join(at, `${key}.json`);
        const entry = await readEntry<T>(file, { namespace, key });
        if (!entry) continue;
        found.set(key, entry.value);
        /* The filesystem's `last_used_at`. `utimes` rather than a sidecar,
           because mtime is the field `sweepFsCheckpoints` below reads and a
           second copy of the same fact could disagree with it.

           **A failure here must not fail the read** — the worst it costs is an
           entry swept early, and refusing to answer would cost a paid model
           call — but it must not be silent either. Swallowing it meant a
           filesystem that had stopped accepting timestamps would let the sweep
           delete live entries with nothing anywhere saying why. GPT Sol,
           2026-08-29: return the hit, and log it. */
        const now = new Date();
        await utimes(file, now, now).catch((err: NodeJS.ErrnoException) => {
          clog.warn(
            { namespace, key, code: err.code },
            "could not stamp a checkpoint as used; it may be swept while still in use",
          );
        });
      }
      return found;
    },

    async write(
      slug: string,
      namespace: CheckpointNamespace,
      key: string,
      value: unknown,
    ): Promise<void> {
      assertCheckpointRequest(ref, slug, namespace, [key]);
      /* **Serialised before anything is created**, so a refused value leaves no
         directory behind and the refusal is genuinely before any I/O — the same
         property the slug assertion above has. `JSON.stringify(undefined)` is
         `undefined`, and interpolating that would write the nine characters
         `undefined` into a file that then fails to parse for ever. The shared
         function is what keeps this adapter and the Postgres one refusing the
         same values. */
      const json = checkpointJson(value);
      const at = nsDir(dir, namespace);
      const file = path.join(at, `${key}.json`);
      await mkdir(at, { recursive: true });
      /* The pid keeps two processes writing the same article from fighting over
         one temp file — the same reason `writeAtomic` in artifacts-fs.ts carries
         one. `process.hrtime` as well, because one process may write the same
         key twice in a run. */
      const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
      await writeFile(tmp, `${json}\n`, "utf-8");
      try {
        /* **`rename`, which clobbers, and that is the point.** An earlier
           version used `link` so that the first write would win; `link` refuses
           with EEXIST rather than overwriting, so an entry a killed process had
           left half-written could never be replaced — every later attempt read
           it as a miss, re-bought the work, failed to store the answer, and
           bumped the file's mtime so the sweep would not remove it either.

           `rename` is atomic within a directory, so a reader sees the old whole
           file or the new whole one and never a half of either; that is what
           buys whole-or-absent, and `link` was never what bought it. See
           checkpoints.ts § Concurrency for why last-write-wins is right rather
           than merely safe. */
        await rename(tmp, file);
      } finally {
        /* A no-op after a successful rename; the guard is for the throwing
           path, where the temp file is still there. */
        await unlink(tmp).catch(() => {});
      }
    },
  };
}

/**
 * Delete every entry under `root` last used before `before`, and say how many.
 *
 * `root` is the *articles* root — `data/` — not one article's directory, so one
 * call sweeps the lot. mtime is the filesystem's `last_used_at`, kept current by
 * `read` above; see checkpoints.ts § Retention for why the sweep is on last-used
 * rather than created.
 *
 * `dryRun` is the default. A sweep that deletes on its first run is a sweep
 * whose cutoff nobody has ever seen the effect of.
 */
export async function sweepFsCheckpoints(
  root: string,
  before: Date,
  opts: { dryRun?: boolean } = {},
): Promise<{ swept: number; bytes: number }> {
  const dryRun = opts.dryRun ?? true;
  let swept = 0;
  let bytes = 0;
  const slugs = await absentOr([], () => readdir(root, { withFileTypes: true }));
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    for (const namespace of CHECKPOINT_NAMESPACES) {
      const one = await sweepOneNamespace(
        nsDir(path.join(root, slug.name), namespace),
        namespace,
        before,
        dryRun,
      );
      swept += one.swept;
      bytes += one.bytes;
    }
  }
  return { swept, bytes };
}

/** One article's entries in one namespace. Split out to keep the nesting readable. */
async function sweepOneNamespace(
  at: string,
  namespace: CheckpointNamespace,
  before: Date,
  dryRun: boolean,
): Promise<{ swept: number; bytes: number }> {
  let swept = 0;
  let bytes = 0;
  /* An article with no checkpoints of this kind has no directory, which is the
     ordinary case and not a fault. */
  const files = await absentOr([], () => readdir(at));
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(at, name);
    /* Vanished between the listing and here — another process swept it, or the
       article was deleted. Not a fault; anything else is. */
    const info = await absentOr(null, () => stat(file));
    if (!info || info.mtime >= before) continue;
    /* Counted only once it is gone. A sweep that reports deleting what it could
       not delete is a sweep whose number means nothing, and the number is the
       only thing anybody reads. */
    if (!dryRun && !(await removed(file, namespace))) continue;
    swept += 1;
    bytes += info.size;
  }
  return { swept, bytes };
}

/** Delete one entry, saying whether it went. A refusal is logged, not thrown. */
async function removed(file: string, namespace: CheckpointNamespace): Promise<boolean> {
  try {
    await rm(file);
    return true;
  } catch (err) {
    clog.warn(
      { namespace, code: (err as NodeJS.ErrnoException).code },
      "could not delete a checkpoint the sweep selected; leaving it",
    );
    return false;
  }
}

/**
 * Run a filesystem call, treating **only** `ENOENT` as "there is nothing here".
 *
 * The blanket `.catch(() => [])` this replaces made an unreadable root — a
 * permissions change, a disconnected volume — report `{ swept: 0 }` and a
 * success line, which is exactly what a healthy tree with nothing old in it
 * reports. A sweep that cannot see anything must not be indistinguishable from
 * a sweep with nothing to do. GPT Sol, 2026-08-29;
 * docs/reusable/silent-success.md § a guard that goes quiet when defeated.
 */
async function absentOr<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}
