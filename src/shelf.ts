/**
 * What the reader has done to an article's place on the shelf —
 * `data/<slug>/shelf.json`.
 *
 * Reader state, so it lives beside `comments.json`, `chat.json` and
 * `searches.json` rather than inside the article. Three fields, and each one is
 * here for the same reason: **the pipeline must not be able to undo it.**
 *
 * That reason is sharpest for the title. Stage 2 rewrites `meta.json` on every
 * run (docs/project/library.md#metajson-and-the-articles-identity), so storing a
 * renamed title there would work perfectly until the next `npm run extract`
 * quietly put the old one back — a bug that reports success, waits weeks, and
 * then looks like the rename never happened (docs/reusable/silent-success.md).
 * So a rename is an **override** stored out here, and `describeArticle` prefers
 * it. Clearing it restores whatever the extractor last found, which is what
 * "blank means put it back" has to mean.
 *
 * Archiving is the same argument in a different coat: `archivedAt` is a flag,
 * never a deletion. Greg, 2026-08-26, chose "archive with an Undo" over a real
 * delete, so nothing here removes anything — see
 * docs/plans/260826k-library-shelf-actions-and-search.md.
 *
 * **An archived article is still readable by direct link.** Only the shelf
 * filters. That is a decision rather than an oversight: the shelf is a shelf,
 * not an access control list, and a link that stops working is a worse surprise
 * than a card that is out of sight.
 *
 * `purpose` — "why you're reading this one" — is the newest field and the
 * argument is the same one again: it is the per-article half of
 * docs/plans/260826t-reader-profile.md, and a reader's stated reason for reading a
 * piece must survive a re-extraction exactly as their rename does. The global
 * half ("about you", true on every article) is NOT here — it lives in its own
 * store, because it is not this article's state.
 *
 * Transport-free, like src/comments.ts and src/api.ts. The routes wrap it.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { MAX_PURPOSE_CHARS, normaliseProfileText } from "./profile.js";
import type { ShelfState } from "./types.js";
import { assertSlug } from "./slug.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "shelf.json");

/**
 * The longest title we will store. Not a validation rule so much as a
 * refusal to let a paste of the whole article become a filename-sized string
 * in every shelf response forever.
 */
export const MAX_TITLE_CHARS = 300;

/** Nothing recorded yet is not an error — it is a brand-new article. */
const EMPTY: ShelfState = { opens: 0 };

/**
 * Read-modify-write serialised per process, exactly as src/comments.ts does it
 * and for exactly the same reason.
 *
 * Pressing Delete on two cards in quick succession is the *normal* way to use
 * this, and each one is a whole-file write. Without the chain the second read
 * starts before the first write lands, and one of the two archives silently
 * does not happen — with no error anywhere, because both writes succeeded.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/**
 * What the reader has done to this article's card. Never throws for an article
 * that has no file yet — that is `EMPTY`, not a fault.
 *
 * A file that exists and will not parse *does* throw. It holds a title the
 * reader typed and a flag that hides a card, and quietly returning `EMPTY`
 * would un-archive an article and un-rename it in the same breath, which is
 * the shape of data loss this whole file is arranged to avoid.
 */
export async function loadShelf(slug: string): Promise<ShelfState> {
  assertSlug(slug);
  try {
    const parsed = parseJsonFrom<Partial<ShelfState>>(
      await readFile(fileFor(slug), "utf8"),
      `shelf.json for ${slug}`,
    );
    return {
      ...(parsed.archivedAt ? { archivedAt: parsed.archivedAt } : {}),
      ...(parsed.title ? { title: parsed.title } : {}),
      opens: typeof parsed.opens === "number" && parsed.opens >= 0 ? parsed.opens : 0,
      ...(parsed.lastOpenedAt ? { lastOpenedAt: parsed.lastOpenedAt } : {}),
      ...(parsed.purpose ? { purpose: parsed.purpose } : {}),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    log("store").error({ slug, ...errorFields(err) }, "shelf file unreadable");
    throw err;
  }
}

/**
 * Write via a temp file and a rename, so a reader never sees a half-written
 * one. Same recipe as src/comments.ts — `rename` is atomic within a filesystem,
 * `writeFile` over the live path is not.
 */
async function save(slug: string, state: ShelfState): Promise<void> {
  const file = fileFor(slug);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/**
 * Read, change, write — the only way this file is ever modified.
 *
 * `async`, so that a bad slug comes back as a **rejected promise** rather than
 * a synchronous throw. Every caller here returns a promise, and a function that
 * usually rejects and occasionally throws is one that a `.catch()` silently
 * fails to catch — which in a route handler is a 500 with no logged reason.
 */
async function edit(slug: string, change: (state: ShelfState) => ShelfState): Promise<ShelfState> {
  assertSlug(slug);
  return serialised(async () => {
    const next = change(await loadShelf(slug));
    await save(slug, next);
    return next;
  });
}

/**
 * Change archived and/or the title, in **one** read-modify-write.
 *
 * One function rather than two, because two writes are two chances for a
 * concurrent reader to see half of an act — and because a caller that had to
 * make two calls could have the second one fail after the first succeeded. See
 * `ShelfStore.patch` in src/store/contracts.ts for the review that produced
 * this shape.
 *
 * An absent key means "leave it alone". `title: null` is not absent: it clears
 * the override. Same for `purpose: null` — see docs/plans/260826t-reader-profile.md.
 */
export async function patchShelf(
  slug: string,
  change: { archived?: boolean; title?: string | null; purpose?: string | null },
  now = new Date(),
): Promise<ShelfState> {
  /* Validated before `edit` is entered, so a rejected change never opens the
     file. Whitespace-only counts as clearing: the input is emptied by selecting
     all and typing nothing, and a title of `"   "` is an invisible article. */
  const title = change.title === undefined ? undefined : (change.title?.trim() ?? "");
  if (title !== undefined && title.length > MAX_TITLE_CHARS) {
    throw Object.assign(new Error(`Title must be ${MAX_TITLE_CHARS} characters or fewer`), {
      status: 400,
    });
  }

  /* `normaliseProfileText`, not a bare `trim()`: this box is the per-article
     half of the reader profile, and its normalisation has to match the
     global box's — trim, collapse `\r\n`, whitespace-only counts as clearing —
     or a paste from Windows would silently mark the same purpose "changed"
     the next time `hashProfile` looked at it. **Refused, not truncated**, for
     the reason src/profile.ts gives about the global box: a silently
     shortened purpose is one the reader believes they gave and did not. */
  const purpose = change.purpose === undefined ? undefined : normaliseProfileText(change.purpose);
  if (purpose && purpose.length > MAX_PURPOSE_CHARS) {
    throw Object.assign(new Error(`Purpose must be ${MAX_PURPOSE_CHARS} characters or fewer`), {
      status: 400,
    });
  }

  return edit(slug, (state) => {
    let next = state;

    if (title !== undefined) {
      if (title) next = { ...next, title };
      else {
        const { title: _dropped, ...rest } = next;
        next = rest;
      }
    }

    if (purpose !== undefined) {
      if (purpose) next = { ...next, purpose };
      else {
        const { purpose: _droppedPurpose, ...rest } = next;
        next = rest;
      }
    }

    if (change.archived === true) {
      // Archiving something already archived keeps the original date. Undo is
      // one click away and a second Delete should not quietly reset the clock.
      if (!next.archivedAt) next = { ...next, archivedAt: now.toISOString() };
    } else if (change.archived === false) {
      const { archivedAt: _dropped, ...rest } = next;
      next = rest;
    }

    return next;
  });
}

/**
 * Take it off the shelf, or put it back.
 *
 * `archivedAt` is a timestamp rather than a boolean because "when did I get rid
 * of this" is the question an archive list is actually asked, and a boolean
 * cannot be widened into a date later without a migration.
 */
export function setArchived(slug: string, archived: boolean, now = new Date()): Promise<ShelfState> {
  return patchShelf(slug, { archived }, now);
}

/** The reader's own title, or `null` to go back to the extractor's. */
export function setTitle(slug: string, title: string | null): Promise<ShelfState> {
  return patchShelf(slug, { title });
}

/**
 * One more open.
 *
 * A counter and a timestamp, deliberately not an event log. So the tooltip can
 * say "opened 6 times, last on Tuesday" and can never say "three times this
 * week" — if that second question ever matters, the answer is a table of
 * events, not another column here.
 */
export async function recordOpen(slug: string, now = new Date()): Promise<ShelfState> {
  return edit(slug, (state) => ({
    ...state,
    opens: state.opens + 1,
    lastOpenedAt: now.toISOString(),
  }));
}
