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
import { isStale, safeUrl } from "./glossary.js";
import { log } from "./log.js";
import type { GlossaryLookupStore } from "./store/contracts.js";
import { formsOf, termAppears, termPattern } from "./term-match.js";
import { GLOSSARY_OUT_OF_DATE, GLOSSARY_TERM_NOT_QUOTED } from "./messages.js";
import type {
  Article,
  Block,
  BlockId,
  GlossaryEntry,
  GlossaryLookup,
  GlossaryFound,
} from "./types.js";

/**
 * Every form of the term with its own pattern, **longest first**.
 *
 * Names are canonical and aliases are what the piece says — *"Martin Luther
 * King Jr."* against a paragraph that reads "MLK" — so asking a model to
 * explain a selection has to quote the words that are there. Longest first, so
 * a block containing both gets the more specific one, which is the same
 * preference `richness` encodes in the dedup.
 *
 * Built once rather than once per block: `anchorIn` below walks every block of
 * the article, and a fresh `RegExp` per form per block on a 360-block piece is
 * a thousand compilations to answer one question.
 */
function patternsFor(entry: { name: string; aliases: string[] }): { form: string; pattern: RegExp }[] {
  return [...formsOf(entry)]
    .sort((a, b) => b.length - a.length)
    .flatMap((form) => {
      const pattern = termPattern([form]);
      return pattern ? [{ form, pattern }] : [];
    });
}

function quoteMatching(forms: { form: string; pattern: RegExp }[], text: string): string | undefined {
  for (const { form, pattern } of forms) if (termAppears(text, pattern)) return form;
  return undefined;
}

/**
 * **The first block of the article as it is now that uses the term**, and the
 * words to quote from it.
 *
 * **It does not read `entry.blocks`, and that is the point.** It was
 * `entry.blocks[0]` and nothing else until 2026-09-04, which made a lookup as
 * fragile as the single paragraph the glossary stage happened to see first — a
 * term used in five places was refused the moment the first of them changed,
 * while the other four sat underlined in the prose beside the panel. Walking
 * the *recorded* occurrences instead was the first fix and it was still wrong:
 * a glossary is **carried** into every new revision
 * (`glossary: "carry"`, src/store/pg-revisions.ts), so `entry.blocks` describes
 * whichever extraction the list was written against and can be empty about an
 * article that now quotes the term on every page. GPT Sol's first finding.
 *
 * So the article answers the question about the article. `findOccurrences`
 * (src/glossary.ts) walks the blocks in document order under the same matching
 * rule, so on a list that *does* fit its article this returns exactly
 * `entry.blocks[0]` — the term's first use, which is where selecting the term
 * has already put the reader.
 *
 * `undefined` means the piece does not use the term anywhere. Whether that is a
 * fact about the term or about the glossary is a question this cannot answer —
 * see the caller, which reads `stale` to tell them apart.
 */
function anchorIn(
  entry: { name: string; aliases: string[] },
  blocks: readonly Block[],
): { blockId: BlockId; quote: string } | undefined {
  const forms = patternsFor(entry);
  if (forms.length === 0) return undefined;
  for (const block of blocks) {
    if (!block.text) continue;
    const quote = quoteMatching(forms, block.text);
    if (quote) return { blockId: block.id, quote };
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
 * then asked to reason from it. `anchorIn` picks the form that is there.
 *
 * With that fixed, "the reader has selected this passage" is literally true,
 * and the prompt's own instruction to supply *"the term of art, the named
 * person, the debate being alluded to"* is the question a glossary reader is
 * asking.
 *
 * A term the article does not use **anywhere** is refused rather than anchored
 * to an arbitrary paragraph. Inventing a position for one would be a second,
 * quieter place for the same failure — the model would be told a passage was
 * selected in a paragraph that has nothing to do with the term.
 *
 * **That refusal is two facts, and saying them with one sentence was a reported
 * bug.** *The article never quotes this term* is permanent and ordinary; *this
 * glossary was written for an older version of the article* is repairable by
 * one button. They shared a sentence that named the term and said it did not
 * appear, and a reader read that as the app denying the entry they were looking
 * at. `stale` is what separates them. src/messages.ts § glossary, and
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md.
 *
 * **The anchor comes from the article, not from `entry.blocks`.** `anchorIn`
 * above, and its docstring says why the stored occurrences cannot be trusted to
 * describe the article they are read beside.
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

    const anchor = anchorIn(entry, article.blocks);
    if (!anchor) {
      /* **Two refusals, not one, and that split is the whole of this fix.**
         They were one sentence until 2026-09-04 — one that named the term and
         said it *"does not appear in this article"* — and a reader met it under
         a row headed with that term and reported the app as denying the entry
         existed. src/messages.ts § glossary has their words, and
         docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md
         the account.

         **Staleness is what tells them apart, and nothing else can.** The
         article does not quote this term: either the list was written against
         this article and the model named something the piece alludes to rather
         than spells out — permanent, ordinary, 5 of 141 entries in the local
         corpus — or the list was written against a different version of the
         article and says nothing reliable about this one. Those want opposite
         things from the reader, and the second is repairable.

         **Computed here rather than taken from `loadGlossary`, and that closes
         a race rather than duplicating a field.** `stale` off the response is a
         fact about the revision *that read* saw; `loadArticle` is a second read
         through `articles.current_revision_id`, and a publish landing between
         the two hands this function a glossary from one revision and blocks
         from another. `isStale` over the two objects actually in hand compares
         the pair the refusal is about, so the answer is true of whatever it was
         given. GPT Sol's second finding, twice.

         `409`, not `500`: nothing is broken, the question just cannot be asked
         in the form this call needs. */
      const stale = isStale(glossary, article.blocks, article.tree, article.meta);
      throw Object.assign(
        new Error(stale ? GLOSSARY_OUT_OF_DATE.message : GLOSSARY_TERM_NOT_QUOTED.message),
        { status: 409 },
      );
    }

    const result = await explain({
      meta: article.meta,
      blocks: article.blocks,
      blockId: anchor.blockId,
      quote: anchor.quote,
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
