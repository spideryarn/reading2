/**
 * Searching every article's text at once — the home page's box, filesystem half.
 *
 * Three search things now exist and they are easy to confuse, so:
 *
 * | | scope | how | cost |
 * |---|---|---|---|
 * | `findLiteral` (src/web/search-hits.ts) | one article | substring, in the browser | free |
 * | `findPassages` (src/search.ts) | one article | a model call | seconds, and money |
 * | **here** | the whole library | a text index, on the server | free |
 *
 * This is the third. It reads the blocks of every article on the shelf and
 * matches words in them. Under Postgres the same question is one `SELECT`
 * against a `tsvector` (src/store/pg-search.ts); this is the answer for the
 * store we actually run today, and it is deleted at step 13 of
 * docs/plans/postgres-storage-implementation.md along with the rest of the
 * filesystem adapter.
 *
 * **It is a stand-in and it is allowed to be crude.** There are four articles.
 * A directory walk that folds and scans every paragraph costs a few
 * milliseconds, and the version that is worth optimising is the one that is
 * one index lookup. What it must NOT be is *differently correct* — see
 * `parseQuery` for the one place the two adapters genuinely disagree, and the
 * note in src/store/contracts.ts about what a parity test may compare.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { loadShelf } from "./shelf.js";
import type { Block, LibraryHit, Meta } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The shortest word we will search for.
 *
 * One and two-character terms match everything and rank nothing. Postgres
 * throws them away too, as stop words — differently, and that difference is
 * declared in `parseQuery` rather than pretended away.
 */
const MIN_TERM = 2;

/**
 * What the reader typed, as terms to look for.
 *
 * **This is where the two adapters differ, and the difference is deliberate
 * rather than an oversight.** Postgres gets `websearch_to_tsquery`, which knows
 * about `OR`, leading `-` for exclusion, English stemming and a stop-word list —
 * so `qualia OR "hard problem"` is a real query over there. Here, everything is
 * ANDed and nothing is stemmed: a search for `qualia` will not find `qualias`.
 *
 * Reproducing `websearch_to_tsquery` by hand is exactly the wrong amount of
 * work — it is a lot of it, and the result would be a second parser that is
 * *nearly* the same, which is worse than one that is obviously simpler. So this
 * one is obviously simpler, quoted phrases are the only syntax it honours, and
 * the docs say so.
 */
function parseQuery(query: string): { terms: string[]; phrases: string[] } {
  const phrases: string[] = [];
  // Pull out "quoted phrases" first, so their inner spaces don't become term
  // boundaries. Curly quotes too — the reader's keyboard may produce either.
  const rest = query.replace(/["“”]([^"“”]+)["“”]/g, (_all, inner: string) => {
    const p = fold(inner).trim();
    if (p) phrases.push(p);
    return " ";
  });
  const terms = fold(rest)
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TERM);
  return { terms, phrases };
}

/**
 * Case-folded, accent-folded, punctuation-flattened.
 *
 * NFKD then strip combining marks, so `Gödel` is found by typing `godel` — the
 * ordinary thing a reader does, and the thing a naive `toLowerCase` gets wrong
 * silently. Curly quotes and dashes are folded to their ASCII forms for the
 * same reason src/quote-match.ts folds them: the article has them and the
 * keyboard does not.
 *
 * **Nothing here may take an offset in the folded text and use it against the
 * original.** Folding is not length-preserving — NFKD expands `ﬁ` to `fi`, and
 * `toLowerCase` lengthens `İ` — so such an offset drifts by one character per
 * ligature earlier in the paragraph, with no error and nothing to grep for.
 * An earlier draft of this file did exactly that to cut a snippet. It does not
 * any more, because a hit now carries the whole paragraph and the client does
 * the cutting (see `LibraryHit.text`); the offsets below are used only to count
 * and to compare with each other, never to slice.
 */
function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase();
}

/** How many times `needle` appears in `hay`. Non-overlapping. */
function occurrences(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * One article's blocks, its title, and nothing else. Read once per search.
 *
 * Archived articles are left out here rather than filtered from the results,
 * because "it is not on the shelf" should mean the index does not know about
 * it — a hit that opens an article you deleted is the sort of thing that reads
 * as a ghost.
 */
async function readArticle(
  dir: string,
  slug: string,
): Promise<{ slug: string; title: string; blocks: Block[] } | null> {
  try {
    const shelf = await loadShelf(slug);
    if (shelf.archivedAt) return null;
    const raw = await readFile(path.join(dir, "blocks.json"), "utf8");
    const { blocks } = parseJsonFrom<{ blocks: Block[] }>(raw, `blocks.json for ${slug}`);
    if (!blocks?.length) return null;
    /* The same fallback chain the shelf uses (`describeDir` in src/api.ts):
       meta.json, then the article's own first heading, then the slug. It used
       to stop at the slug, so an article with no meta.json was listed as
       "noema-mythology-of-conscious-ai" in the search results and by its real
       title on the card — one article under two names, in two places on the
       same page. Caught by a cross-family review, 2026-08-26. */
    let title: string | undefined;
    try {
      const meta = parseJsonFrom<Meta>(
        await readFile(path.join(dir, "meta.json"), "utf8"),
        `meta.json for ${slug}`,
      );
      title = meta.title;
    } catch {
      // A missing meta.json is ordinary — the shelf falls back the same way.
    }
    title ??= blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ?? slug;
    // The reader's own title wins, exactly as it does on the card. Otherwise a
    // renamed article would be listed under two different names in two places.
    return { slug, title: shelf.title ?? title, blocks };
  } catch {
    /* A directory that is not an article, or an artefact that will not parse.
       Silent per directory on purpose: this runs over the whole library on
       every keystroke-after-a-pause, so a line here would be a line per broken
       directory per search. `listArticles` already warns about unreadable
       artefacts once, from the walk that is meant to notice them. */
    return null;
  }
}

/**
 * Every passage in the library that matches, best first.
 *
 * Ranking, and why it is this and not something cleverer: a block scores by how
 * many of the query's terms it contains (all of them is the only way to match
 * at all, so this is really about how *often*), damped by length so a long
 * paragraph does not win merely by being long. It is `ts_rank_cd`'s intuition
 * with none of its arithmetic, and it exists to put the obviously-best two or
 * three at the top of a list of ten. It is not a relevance model and nothing
 * should show it as a number.
 */
export async function searchLibrary(
  query: string,
  limit: number,
): Promise<{ hits: LibraryHit[]; capped: boolean }> {
  const { terms, phrases } = parseQuery(query);
  const needles = [...phrases, ...terms];
  if (needles.length === 0) return { hits: [], capped: false };

  let dirs: { dir: string; slug: string }[] = [];
  try {
    const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
    dirs = entries
      // `_`-prefixed directories are not articles — `data/_jobs/` is the queue's
      // records. Same rule as `listArticles`, and for the same reason.
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => ({ dir: path.join(ROOT, "data", e.name), slug: e.name }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // The committed fixture is searchable too, for the same reason it is always
  // on the shelf: a fresh clone with no data/ should still find something.
  dirs.push({ dir: path.join(ROOT, "example"), slug: "example" });

  const articles = (await Promise.all(dirs.map((d) => readArticle(d.dir, d.slug)))).filter(
    (a): a is NonNullable<typeof a> => a !== null,
  );

  const hits: LibraryHit[] = [];
  for (const article of articles) {
    for (const block of article.blocks) {
      // Headings and media carry no prose worth a snippet, and a hit on a
      // one-word heading is noise at the top of the list.
      if (!block.gistable) continue;
      const folded = fold(block.text);

      /* Every term must appear — this is an AND, and `parseQuery` says why it
         is not the disjunction Postgres would give you. `score` is how OFTEN
         they appear, which is the only signal a substring scan has. */
      let score = 0;
      let missing = false;
      for (const needle of needles) {
        const count = occurrences(folded, needle);
        if (count === 0) {
          missing = true;
          break;
        }
        score += count;
      }
      if (missing) continue;

      /* Damped by length, in the same spirit as ts_rank_cd's normalisation:
         `score / log(words)` so a 400-word paragraph with three matches does
         not outrank a 20-word one with two. `+ 2` keeps the log away from zero
         and from one — a two-word block would otherwise divide by ~0.69 and
         score absurdly high. */
      const rank = score / Math.log(block.words + 2);

      hits.push({
        slug: article.slug,
        title: article.title,
        blockId: block.id,
        /* The whole paragraph, not a window around the match — see `LibraryHit.text`
           for why the cutting happens in the client. The fold map is still what
           `first` would have to be translated through if it ever came back here,
           and it is kept because the ranking above depends on the same offsets. */
        text: block.text,
        rank,
      });
    }
  }

  hits.sort((a, b) => b.rank - a.rank);
  const capped = hits.length > limit;
  const kept = hits.slice(0, limit);

  log("store").debug(
    { terms: terms.length, phrases: phrases.length, articles: articles.length, hits: hits.length, capped },
    "library search",
  );

  return { hits: kept, capped };
}
