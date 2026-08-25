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

const ROOT = process.cwd();

/** Refused rather than sanitised, exactly as src/comments.ts refuses it. */
function assertSlug(slug: string): void {
  if (!/^[\w.-]+$/.test(slug) || slug === "." || slug === "..") {
    throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`);
  }
}

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
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8's parse error quotes the first
       characters of what it was handed, and those characters are a model's
       prose about the article. src/parse-json.ts. */
    const parsed = parseJsonFrom<{ lookups?: LookupsByTerm }>(
      await readFile(fileFor(slug), "utf8"),
      "glossary-lookups.json",
    );
    return parsed.lookups ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    log("store").error({ ...errorFields(err), slug }, "could not read the glossary lookups");
    return {};
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
    const current = await loadLookups(slug);
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
