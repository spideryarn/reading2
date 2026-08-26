/**
 * What the reader asked us to check on the web, kept **beside** the glossary
 * rather than inside it.
 *
 * `data/<slug>/glossary-lookups.json`, keyed by entry id. One file, one job.
 *
 * ## Why not just put it on the entry
 *
 * That was the plan, and review took it apart before it shipped. `glossary.json`
 * is a **pipeline artefact** written by one stage with a bare `writeFile`
 * (src/glossary.ts) — no temp-and-rename, no serialisation, because until now
 * it had exactly one writer and that writer replaced the whole file. Adding a
 * second writer to it inherits three failures, and the third is the one that
 * matters:
 *
 * 1. **Two lookups close together lose the first**, with no error anywhere,
 *    because both writes succeed. That is the failure `serialised` in
 *    src/comments.ts exists for, described in its own docstring.
 * 2. **A lookup landing during a `glossary` job is overwritten wholesale.** The
 *    job reads the file, spends thirty to ninety seconds in a model call, then
 *    writes what it read. No in-process lock can fix that — the stale read is
 *    held across the call — and the only real fix is not sharing the file.
 * 3. **A crash mid-write leaves truncated JSON, and `readGlossary` swallows the
 *    parse error into `null`.** `loadGlossary` then 404s, and the panel says
 *    *"Nobody has found the terms for this one yet"* and offers a model call.
 *    The reader's entire glossary, silently gone, with nothing anywhere saying
 *    so.
 *
 * There is also a line this crosses that is already drawn: a `Comment` lives
 * beside the article because it is **reader state**, not pipeline output
 * (src/types.ts). A lookup is reader state — somebody pressed a button — and
 * putting it inside a stage's artefact was that distinction being lost rather
 * than argued away.
 *
 * ## What it buys beyond safety
 *
 * A lookup **survives regeneration**. Ids are preserved across passes on
 * purpose — `merge` keeps the incumbent's, because `?term=` links address by id
 * — so a lookup keyed by id is still attached to its term after "Find more
 * terms". Inside `glossary.json` it would have been discarded by the next run,
 * silently and differently depending on which path the reader took.
 *
 * The seam back is `loadGlossary` in src/api.ts, which attaches these to their
 * entries at read time. The wire shape the panel sees is unchanged: `entry.lookup`.
 *
 * See docs/project/glossary.md § Checking a term on the web.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import type { GlossaryLookup } from "./types.js";
import { assertSlug } from "./slug.js";

const ROOT = process.cwd();

function fileFor(slug: string): string {
  assertSlug(slug);
  return path.join(ROOT, "data", slug, "glossary-lookups.json");
}

/**
 * Read-modify-write serialised per process — the same chain, and the same
 * reason, as src/comments.ts. Checking two terms in quick succession is the
 * ordinary way to use this, and each is a slow request ending in a whole-file
 * write. Without the chain the second read starts before the first write lands
 * and the first answer vanishes, with no error, because both writes succeeded.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

export type LookupsByTerm = Record<string, GlossaryLookup>;

/**
 * Every stored lookup for an article, or an empty object.
 *
 * **A missing file is the ordinary case**, not a fault: most articles have had
 * no term checked. An unreadable one is logged and then treated the same way,
 * because the alternative is a panel that shows no glossary at all because a
 * side file it does not need went bad.
 */
export async function loadLookups(slug: string): Promise<LookupsByTerm> {
  return (await read(slug)).lookups;
}

/**
 * The same read, but saying **why** it came back empty.
 *
 * Reading and writing want different answers to that question. A reader can
 * treat an unreadable side file as "no lookups" and show the glossary anyway. A
 * *writer* must not: merging one new answer into `{}` and renaming that over a
 * file that was merely unparseable would turn a recoverable file into a
 * permanent loss of everything in it. Found in review — the read degraded
 * correctly and the write then quietly finished the job.
 */
async function read(slug: string): Promise<{ lookups: LookupsByTerm; unreadable: boolean }> {
  /* Before the try, deliberately. A bad slug is a refusal, not an unreadable
     file — and inside the try it would be caught, logged as a read failure and
     turned into "the stored lookups could not be read", which is both wrong and
     the kind of wrong that sends somebody looking at the disk. */
  assertSlug(slug);
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8's parse error quotes the first
       characters of what it was handed, and those characters are a model's
       prose about the article. src/parse-json.ts. */
    const parsed = parseJsonFrom<{ lookups?: LookupsByTerm }>(
      await readFile(fileFor(slug), "utf8"),
      "glossary-lookups.json",
    );
    return { lookups: parsed.lookups ?? {}, unreadable: false };
  } catch (err) {
    // Missing is the ordinary case and not unreadable: most articles have had
    // no term checked, and writing the first one must not be refused.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { lookups: {}, unreadable: false };
    }
    log("store").error({ ...errorFields(err), slug }, "could not read the glossary lookups");
    return { lookups: {}, unreadable: true };
  }
}

/**
 * Store one lookup, keeping every other.
 *
 * Written to a neighbour and renamed over the top, because a plain write
 * truncates first: a crash between the truncate and the last byte leaves a file
 * that parses as nothing, and every reader of it would then believe no term had
 * ever been checked. The temp file is in the same directory on purpose —
 * `rename` is only atomic within a filesystem, and /tmp is routinely a
 * different one. Both points are src/comments.ts's, and they are its points
 * because it learned them first.
 */
export function saveLookup(
  slug: string,
  termId: string,
  lookup: GlossaryLookup,
): Promise<LookupsByTerm> {
  return serialised(async () => {
    const { lookups: current, unreadable } = await read(slug);
    /* Fail closed. The alternative is writing `{ [termId]: lookup }` over a file
       that was only unparseable, which discards every other answer the reader
       has paid for — and does it at the moment they are least likely to notice,
       because the lookup they just asked for appears exactly as expected. */
    if (unreadable) {
      throw new Error(
        "The stored lookups for this article could not be read, so this answer was not saved. " +
          "Move or delete data/" + slug + "/glossary-lookups.json and try again.",
      );
    }
    const next: LookupsByTerm = { ...current, [termId]: lookup };
    const file = fileFor(slug);
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ lookups: next }, null, 2), "utf8");
      await rename(temp, file);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
    return next;
  });
}
