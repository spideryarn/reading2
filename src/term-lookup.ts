/**
 * Check one glossary term on the web, whichever store the article lives in.
 *
 * ## Why this is not in `src/api.ts` any more
 *
 * The *storage* half of a lookup is a single upsert, and
 * [`GlossaryLookupStore`](store/contracts.ts) already has both implementations
 * of it. But `lookUpTerm` was never only storage: it read `glossary.json`,
 * `blocks.json` and `meta.json` off the disk itself before calling `explain`,
 * so a Postgres store for the write alone would still have looked the term up
 * in a file. Writing a second `lookUpTerm` beside it would mean two copies of
 * the 404 / 403 / 409 rules, the anchor rule and the `safeUrl` filter — which
 * is precisely the divergence this migration exists to make impossible.
 *
 * So the orchestration moved here, store-independent, and takes what it needs
 * as arguments. `src/store/index.ts` builds one with whichever adapters are
 * live. See docs/plans/260826e-postgres-storage-implementation.md
 * § `lookUpTerm` has to move out of `api.ts`.
 *
 * **The file is `term-lookup.ts`, not `glossary-lookup.ts`**, which is what the
 * plan called it. `src/glossary-lookups.ts` — plural — already exists and is
 * the filesystem *storage* for these answers, and two modules one letter apart
 * doing different jobs is a mis-import nobody would see in review.
 *
 * ## What it deliberately does not do
 *
 * Touch `background`. The remembered answer and the checked one sit side by
 * side, because a reader who can no longer tell which is which has lost the
 * thing the panel spent a rewrite acquiring. See docs/project/glossary.md.
 */

import { explain as explainDefault } from "./explain.js";
import { safeUrl } from "./glossary.js";
import { log } from "./log.js";
import type { GlossaryLookupStore } from "./store/contracts.js";
import { formsOf, termAppears, termPattern } from "./term-match.js";
import type {
  Article,
  Block,
  GlossaryEntry,
  GlossaryLookup,
  GlossaryFound,
} from "./types.js";

/**
 * The form of a term the article actually uses in one block, or nothing.
 *
 * Names are canonical and aliases are what the piece says — *"Martin Luther
 * King Jr."* against a paragraph that reads "MLK" — so asking a model to
 * explain a selection has to quote the words that are there. Longest form
 * first, so a block containing both gets the more specific one, which is the
 * same preference `richness` encodes in the dedup.
 */
function quoteIn(entry: { name: string; aliases: string[] }, text: string): string | undefined {
  const forms = [...formsOf(entry)].sort((a, b) => b.length - a.length);
  for (const form of forms) {
    const pattern = termPattern([form]);
    if (pattern && termAppears(text, pattern)) return form;
  }
  return undefined;
}

/**
 * Everything a lookup needs that differs between the two stores.
 *
 * `explain` and `now` are injected for a reason that is not symmetry: without
 * them there is no way to drive the successful model path in a test, and that
 * path is exactly what this move rewrote. The existing glossary tests
 * deliberately stop short of it. Raised by GPT Sol reviewing the step-10
 * design, 2026-08-26.
 */
export interface LookUpTermDeps {
  /** Where the glossary and the article's blocks come from. */
  readonly reader: {
    loadArticle(slug: string): Promise<Article>;
    loadGlossary(slug: string): Promise<GlossaryFound>;
  };

  /** Where the answer goes. One row (or one key) per term. */
  readonly lookups: GlossaryLookupStore;

  /**
   * The 403 the filesystem needs and Postgres does not.
   *
   * The filesystem store can reach one article nobody owns — the committed
   * `example/` — so without this a lookup on it edits the repo. An unknown slug
   * is a 404 on both sides now that `articleDir` no longer falls through to the
   * fixture (src/api.ts § `candidateDirs`); Postgres has no fixture at all, so
   * it needs no counterpart to this. **A stated difference with a test on each
   * side**, rather than something for somebody to discover.
   */
  readonly assertWritable?: (slug: string) => Promise<void>;

  /** Overridable so a test can drive the successful path without a model. */
  readonly explain?: typeof explainDefault;

  /** Overridable for the same reason. */
  readonly now?: () => string;
}

/**
 * Check one glossary term on the web, and keep what comes back.
 *
 * **This is `explain` with a different selection, and that is the point.** Our
 * review of the version this feature was borrowed from argued that a glossary
 * should be *the same mechanism as comments with a different prompt* rather
 * than a second system, and docs/project/glossary.md § What is still open had
 * carried that as an open question since the feature landed. It is answered
 * here by using the mechanism rather than by describing it: the same call, the
 * same web-search tool, the same `Citation` shape, the same cached article
 * prefix — so a lookup on an article somebody has already asked a question
 * about is a cache hit rather than a fresh read of the whole piece.
 *
 * **The quote is the form the article actually uses, not the entry's name.**
 * That distinction was missing and it made the request untrue. `findOccurrences`
 * matches on the name *or any alias*, so `entry.blocks[0]` is a block one of
 * them appears in — and on the one real glossary we have, three entries of five
 * are matched by an alias: the block behind *John F. Kennedy* says only "JFK".
 * Telling the model the reader selected "John F. Kennedy" inside a block that
 * does not contain those words is a false premise handed to a model that is
 * then asked to reason from it. `quoteIn` picks the form that is there.
 *
 * With that fixed, "the reader has selected this passage" is literally true,
 * and the prompt's own instruction to supply *"the term of art, the named
 * person, the debate being alluded to"* is the question a glossary reader is
 * asking.
 *
 * An entry with **no** occurrences is refused rather than anchored to an
 * arbitrary paragraph. The panel already says of those that the exact words do
 * not appear in the article; inventing a position for them would be a second,
 * quieter place for the same failure — and the model would be told a passage
 * was selected in a paragraph that has nothing to do with the term.
 */
export function makeLookUpTerm(
  deps: LookUpTermDeps,
): (slug: string, termId: string, signal?: AbortSignal) => Promise<{ entry: GlossaryEntry }> {
  const explain = deps.explain ?? explainDefault;
  const now = deps.now ?? (() => new Date().toISOString());

  return async function lookUpTerm(slug, termId, signal) {
    /* First, and before the glossary is read: it is the check that answers
       "there is no such article" and "that one is not yours", and both of those
       have to be true before the reader is told anything about its terms. Order
       preserved from the version that lived in src/api.ts. */
    await deps.assertWritable?.(slug);

    const { glossary } = await deps.reader.loadGlossary(slug);
    const entry = glossary.entries.find((e) => e.id === termId);
    if (!entry) {
      throw Object.assign(new Error(`No glossary term "${termId}" in "${slug}".`), { status: 404 });
    }

    /* The whole article, for its blocks and its meta. Both stores answer this
       one question, which is why it is asked here rather than each side
       reading its own files — and it is the same call `explain` is about to be
       given the blocks from, so there is no second reading of the article to
       disagree with the first. */
    const article = await deps.reader.loadArticle(slug);

    const anchor = entry.blocks[0];
    const block: Block | undefined = anchor
      ? article.blocks.find((b) => b.id === anchor)
      : undefined;
    const quote = block ? quoteIn(entry, block.text) : undefined;
    if (!anchor || !block || !quote) {
      /* Refused rather than anchored somewhere arbitrary. Three ways to get
         here and they are all the same fact — this term is not in this text:
         the model named words the article does not use, or the glossary is
         stale and its block ids no longer exist, or the block exists but no
         form of the term is in it. `409`, not `500`: nothing is broken, the
         question just cannot be asked in the form this call needs. */
      throw Object.assign(
        new Error(
          `"${entry.name}" does not appear in this article, so there is no passage to check it in. ` +
            `Find the terms again if the article has changed.`,
        ),
        { status: 409 },
      );
    }

    const result = await explain({
      meta: article.meta,
      blocks: article.blocks,
      blockId: anchor,
      quote,
      ...(signal ? { signal } : {}),
    });

    const lookup: GlossaryLookup = {
      answer: result.answer,
      /* Filtered here rather than trusted, even though `explain` built these
         from the provider's own annotations. This is where a model-supplied URL
         stops being a value in flight and becomes a value in storage that the
         panel will put in an `href` — src/glossary.ts § `safeUrl`, and the same
         call `converse` makes at its own storage boundary. */
      citations: result.citations.flatMap((c) => {
        const url = safeUrl(c.url);
        return url ? [{ url, ...(c.title ? { title: c.title } : {}) }] : [];
      }),
      searches: result.searches,
      model: result.model,
      at: now(),
    };

    /* Keyed by **id** because ids are identity and names are display: a later
       pass may merge or rename this term, and `merge` keeps the incumbent's id
       precisely so a `?term=` link survives. The lookup survives with it. */
    await deps.lookups.save(slug, termId, lookup);
    const updated: GlossaryEntry = { ...entry, lookup };

    /* No prose in the log line, and that includes the answer and the term. What
       is here is what tells you the feature is working or quietly is not:
       `searches: 0` on every call means the model has stopped choosing to look,
       which is invisible from the outside because "I already knew that" is a
       legitimate answer. src/log.ts, docs/project/logging.md. */
    log("store").info(
      {
        slug,
        termId,
        searches: lookup.searches,
        citations: lookup.citations.length,
        model: lookup.model,
      },
      "looked up a glossary term",
    );

    return { entry: updated };
  };
}
