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
 * **Every write goes to Postgres** — `pgShelfStore` (src/store/pg-shelf.ts)
 * holds the rules above as five columns on `articles`, and imports
 * `MAX_TITLE_CHARS` from here so the cap is stated once. The file-writing half
 * of this module went with `src/store/fs.ts` on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * `loadShelf` stays for two callers, both of them fixture readers:
 * `tests/helpers/seed-reader-state.ts` and `tests/store-parity.test.ts`, which
 * read a fixture's `data/<slug>/shelf.json` into those columns.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
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
