/**
 * What the reader asked us to check on the web, kept **beside** the glossary
 * rather than inside it — the type, and one fixture reader.
 *
 * **Every write goes to Postgres** (`pgLookupStore`, src/store/pg-lookups.ts);
 * the file-writing half of this module went with `src/store/fs.ts` on
 * 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * the stage-G section).
 * `loadLookups` stays for one caller — `tests/helpers/seed-reader-state.ts`,
 * which reads a fixture's `data/<slug>/glossary-lookups.json` into rows.
 *
 * The argument below is why a lookup was never stored **inside**
 * `glossary.json`, and it still decides the shape of the Postgres table: a
 * lookup is reader state keyed by entry id, not pipeline output.
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
 * The seam back is `loadGlossary` in src/store/pg.ts, which attaches these to
 * their entries at read time. The wire shape the panel sees is unchanged:
 * `entry.lookup`.
 *
 * See docs/project/glossary.md § Checking a term on the web.
 */
import { readFile } from "node:fs/promises";
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

export type LookupsByTerm = Record<string, GlossaryLookup>;

/**
 * Every stored lookup for an article, or an empty object.
 *
 * **A missing file is the ordinary case**, not a fault: most articles have had
 * no term checked. An unreadable one is logged and then treated the same way,
 * because the alternative is a panel that shows no glossary at all because a
 * side file it does not need went bad.
 *
 * The read/write split this used to carry — a private `read` that also said
 * *why* it came back empty, so a writer could refuse rather than overwrite an
 * unparseable file — went with the writer. Postgres holds that rule now: a
 * lookup is one row, and one row cannot take the rest of them with it.
 */
export async function loadLookups(slug: string): Promise<LookupsByTerm> {
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
    return parsed.lookups ?? {};
  } catch (err) {
    // Missing is the ordinary case: most articles have had no term checked.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    log("store").error({ ...errorFields(err), slug }, "could not read the glossary lookups");
    return {};
  }
}
