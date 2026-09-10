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

import {
  type ExplainEnding,
  explain as explainDefault,
  explainStream as explainStreamDefault,
} from "./explain.js";
import { isStale, safeUrl } from "./glossary.js";
import { log } from "./log.js";
import type { GlossaryLookupStore } from "./store/contracts.js";
import { formsOf, termPattern } from "./term-match.js";
import { ASKED_TERM_REFUSED, parseAskedTerm } from "./asked-term.js";
import {
  ASKED_TERM_ABSENT,
  ASKED_TERM_NO_PROSE,
  ASKED_TERM_PART_WORD,
  FILTER_STOPPED_IT,
  GLOSSARY_CUT_OFF,
  GLOSSARY_OUT_OF_DATE,
  GLOSSARY_TERM_NOT_QUOTED,
} from "./messages.js";
import type {
  Article,
  AskedTermAnswer,
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

/**
 * The first form that appears in `text`, **and the characters it actually
 * matched**.
 *
 * Two facts, because two callers want different ones and both are truthful
 * about something different. `form` is the glossary's own wording — *"Martin
 * Luther King Jr."*, or its alias *"MLK"* — and is what `lookUpTerm` quotes,
 * because a glossary entry has a canonical name and that name is what the
 * reader pressed. `matched` is the run of characters in this block, which is
 * what {@link makeAskAboutTerm} quotes, because a phrase a reader typed into a
 * box has no canonical form and the piece's own wording is the only honest one:
 * type *attention head* at a piece that says *attention heads* and the passage
 * is about the plural.
 *
 * They differ exactly where the matcher folds — case, a plural, a possessive —
 * which is the whole of the tolerance this feature has.
 */
function quoteMatching(
  forms: { form: string; pattern: RegExp }[],
  text: string,
): { form: string; matched: string } | undefined {
  for (const { form, pattern } of forms) {
    /* Reset before use for the reason `termSpans` states: these patterns carry
       `g` and are reused across every block of the article, so a surviving
       `lastIndex` would start the search in the middle of the next one. */
    pattern.lastIndex = 0;
    const hit = pattern.exec(text);
    if (hit) return { form, matched: hit[0] };
  }
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
): { blockId: BlockId; quote: string; matched: string } | undefined {
  const forms = patternsFor(entry);
  if (forms.length === 0) return undefined;
  for (const block of blocks) {
    if (!block.text) continue;
    const hit = quoteMatching(forms, block.text);
    if (hit) return { blockId: block.id, quote: hit.form, matched: hit.matched };
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
    /* **`assertWritable` was called here and went on 2026-09-06.** It was the
       filesystem store's extra 403 over the committed `example/` article, which
       nobody owns; that store went on 2026-09-05 and nothing has supplied the
       dependency since, so the call was a no-op — and a no-op in a permission
       path reads as a permission check. `loadGlossary` below is the check now:
       every read joins through `ownedSlug`, so a stranger's slug is a 404
       before the reader learns anything about its terms. */
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

/**
 * **Only a finished answer finishes.** Throws for the endings `explainStream`
 * accepts as a `done` that the glossary may not.
 *
 * Three of them, and the reason is the same: the glossary's only reader of a
 * `done` draws it as a finished answer — with *checked* above it and its
 * sources under it — and in `lookUpTerm`'s case saves it. So:
 *
 * - `abandoned` — the reader left, or changed the question. `explainStream`
 *   finishes with whatever had arrived, which is right for a comment and is the
 *   one thing a glossary answer must never be.
 * - `truncated` and `filtered` — the model stopped part-way, on our ceiling or
 *   the provider's filter. Accepted there because a comment has nowhere to say
 *   so; refused here, as quiz refuses them. Found by GPT Sol reviewing
 *   docs/plans/260910g-stream-glossary-answers-as-they-arrive.md: the first
 *   draft checked only the reader's signal.
 *
 * The other three stay accepted for `explainStream`'s own reasons at each
 * `case` there — an unknown finish reason is the deny-list side of a bet quiz
 * spells out, and a tool request from a call that sends only the web-search
 * tool is a provider oddity over prose that is prose.
 */
function refuseUnfinished(ending: ExplainEnding): void {
  switch (ending) {
    case "finished":
    case "unknown-finish-reason":
    case "wants-tools":
      return;
    case "abandoned":
      throw new Error("The answer was stopped before it finished, so none of it is kept.");
    case "truncated":
      throw new Error(GLOSSARY_CUT_OFF.message);
    case "filtered":
      throw new Error(FILTER_STOPPED_IT.message);
    default: {
      const never: never = ending;
      throw new Error(`unhandled explanation ending: ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------ a term the reader typed in a box -- */

/**
 * Everything the *Look up a term* box needs — **which is strictly less than a
 * lookup needs**, and the subtraction is the feature.
 *
 * No `lookups` store, because nothing is saved. No `loadGlossary`, because the
 * question is about the article and not about the list: a term the glossary has
 * never heard of is exactly the case this box exists for.
 */
export interface AskAboutTermDeps {
  /** Where the article's blocks and meta come from. Owner-filtered — see below. */
  readonly reader: { loadArticle(slug: string): Promise<Article> };

  /**
   * Overridable so a test can drive the successful path without a model.
   *
   * **The stream, not the drain**, since 2026-09-10: the box shows the answer
   * as it arrives. docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
   */
  readonly explainStream?: typeof explainStreamDefault;

  /** Overridable for the same reason. */
  readonly now?: () => string;
}

/**
 * Where the box's question was found — **every word of it the server's.**
 *
 * `quote` is the run of characters the matcher found in `blockId`, never what
 * the reader typed; `term` is what they typed, normalised, and is only ever
 * shown as their own question. The route sends this before the first word of
 * the answer, so the panel can say where it is looking while it waits.
 */
export type AskedTermFound = Omit<AskedTermAnswer, "lookup">;

/**
 * What an asked term's answer emits: any number of `delta`, then exactly one
 * `done`. A throw means no `done`, and the deltas so far are **not an answer** —
 * nothing downstream may treat them as one. `ExplainEvent`'s contract, with the
 * one difference {@link makeAskAboutTerm} explains: an abandoned stream throws
 * here rather than finishing.
 */
export type AskedTermEvent =
  | { type: "delta"; text: string }
  | { type: "done"; answer: AskedTermAnswer };

/**
 * A question that has passed every refusal, and the answer not yet started.
 *
 * **Two halves because the route needs a line between them.** Everything that
 * can refuse — ownership, a malformed term, no prose, a term the piece does not
 * use — has happened by the time this exists, so the route can still answer
 * those as ordinary JSON; only then does it open the event stream and call
 * `stream`, handing it the signal that fires when the reader leaves.
 */
export interface AskedTermQuestion {
  readonly found: AskedTermFound;
  stream(signal?: AbortSignal): AsyncGenerator<AskedTermEvent>;
}

/**
 * **Is the term in there at all, ignoring word boundaries?**
 *
 * Asked only after the real matcher has said no, and only to tell two refusals
 * apart: *the piece never says this* wants chat, and *the piece says it inside a
 * longer word* wants the reader to retype it. Neither sentence would be true of
 * the other case, which is the whole reason this scan exists —
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md.
 *
 * **The same escaping and the same whitespace rule as `termPattern`, minus the
 * lookarounds and the suffix**, so the only difference between the two answers
 * is the boundary. Building it any other way would let the two scans disagree
 * about something else and put a wrong sentence on the screen.
 *
 * It **does not** claim a typo. A substring hit is not evidence of one: a piece
 * that says *axiomatic* contains *axiom*, and nobody misspelled anything.
 */
function appearsInsideAWord(term: string, blocks: readonly Block[]): boolean {
  const body = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const loose = new RegExp(body, "iu");
  return blocks.some((b) => (b.text ? loose.test(b.text) : false));
}

/**
 * Find a term the reader typed in the article, and explain the passage it is
 * in. **Nothing is stored.**
 *
 * A reader asked for this, and asked for a little more than it does:
 *
 * > I would like to be able to type into a search box in the glossary for a
 * > particular term and for it to look for that term and add it to the
 * > glossary. And maybe it should be a tiny bit robust in the spelling or
 * > something if I type it wrong.
 * >
 * > — a reader, 2026-09-04, `[SPIDERYARN-READING2-Y]`
 *
 * **The robustness is `term-match.ts`'s and nothing is added to it.** Case,
 * plurals and possessives fold; a misspelling does not. That is a real limit
 * and it is stated to the reader in the refusal rather than papered over with a
 * guess — see `ASKED_TERM_ABSENT` in src/messages.ts for why there is no
 * *"did you mean…"* here.
 *
 * **"Add it to the glossary" is deliberately not built.** {@link AskedTermAnswer}
 * has the three reasons, one of which is that a reader-added entry would be
 * published with an already-shared article.
 *
 * ## What it will not take from the client
 *
 * A term, and nothing else. Not a block id, not an offset, not a definition,
 * not aliases, not a provenance label, not an owner — every one of those is
 * either found here from the article or does not exist.
 *
 * **Which is not the same as "the caller cannot influence the passage", and a
 * first draft of this paragraph said so.** A long enough term picks out one
 * paragraph, so a caller does choose *which* of their own article's blocks is
 * explained. What the narrow input buys is that the text sent to the model is
 * always this article's own, and this article is always theirs: there is no
 * spelling of the request that makes it a way to ask a paid model about text of
 * the caller's own composition. ⟨Sol⟩
 *
 * ## Ownership
 *
 * `reader.loadArticle` is the check, and it is the same one `lookUpTerm` above
 * relies on: under Postgres every read joins through `ownedSlug`
 * (src/store/pg.ts), so a stranger's slug is a 404 before a byte of prose is
 * read — and it is read **first**, before the term is even parsed, so a
 * non-owner cannot tell a bad term from somebody else's article. It used to be
 * preceded by `assertWritable`, the filesystem store's extra 403 over the
 * committed `example/`, which went with that store.
 *
 * ## It streams, and only a finished answer finishes
 *
 * Since 2026-09-10 the answer arrives a few words at a time
 * (docs/plans/260910g-stream-glossary-answers-as-they-arrive.md). The promise
 * settles once every refusal above has been decided; `stream` then drives
 * `explainStream`.
 *
 * **Three endings of `explainStream` are not endings here.** It *finishes*
 * with whatever had arrived when its caller's signal fires, when the answer
 * hits its token ceiling and when the provider's filter stops it — right for a
 * comment, where half an explanation has a row to live on. Here a `done`
 * carrying half an answer is the one thing this contract exists to prevent, so
 * `refuseUnfinished` above throws for all three and no `done` is ever built
 * from an answer that stopped part-way.
 */
export function makeAskAboutTerm(
  deps: AskAboutTermDeps,
): (slug: string, asked: unknown) => Promise<AskedTermQuestion> {
  const explainStream = deps.explainStream ?? explainStreamDefault;
  const now = deps.now ?? (() => new Date().toISOString());

  return async function askAboutTerm(slug, asked) {
    /* Ownership before anything else, `lookUpTerm`'s order and for its reason:
       "there is no such article" and "that one is not yours" have to be settled
       before the caller learns anything at all — including whether their term
       was well-formed. `loadArticle` is what settles both. */
    const article = await deps.reader.loadArticle(slug);

    const parsed = parseAskedTerm(asked);
    if (!parsed.ok) {
      /* **400, and no bracketed code.** Every one of these is something the box
         itself refuses before the request goes (src/web/GlossaryPanel.tsx), so a
         reader reaching one has a broken client rather than a report to file —
         which is the case docs/project/copy.md's *a refusal that is an answer
         gets no code* is actually about. The three sentences are still written
         for a person, because a person is who would see one. */
      throw Object.assign(new Error(ASKED_TERM_REFUSED[parsed.fault]), { status: 400 });
    }

    /* **No prose is not an answer about the term**, and this branch exists so
       that it cannot be reported as one. An article whose blocks are all
       figures or embeds would otherwise be told "the piece does not use those
       words" on the strength of a scan that read nothing — the reported bug's
       exact shape, a confident sentence over an empty check. */
    if (!article.blocks.some((b) => b.text)) {
      throw Object.assign(new Error(ASKED_TERM_NO_PROSE.message), { status: 409 });
    }

    /* One entry with no aliases: a phrase a reader typed has no canonical name
       and no other names, so the entry shape is the adapter and `anchorIn` is
       the same walk, in the same order, under the same rule that decides where
       the prose underlines this term. */
    const anchor = anchorIn({ name: parsed.term, aliases: [] }, article.blocks);
    if (!anchor) {
      /* **Two refusals, not one**, and the scan above is what tells them apart.
         Both refuse again unchanged; only one of them leaves the reader
         something to type differently. src/messages.ts § `ASKED_TERM_ABSENT`. */
      const message = appearsInsideAWord(parsed.term, article.blocks)
        ? ASKED_TERM_PART_WORD.message
        : ASKED_TERM_ABSENT.message;
      throw Object.assign(new Error(message), { status: 409 });
    }

    /* Named here because the narrowing above does not reach into `stream`,
       and restating the checks inside it would be two places to keep them. */
    const found: AskedTermFound = {
      term: parsed.term,
      blockId: anchor.blockId,
      quote: anchor.matched,
    };
    const chars = parsed.term.length;

    async function* stream(signal?: AbortSignal): AsyncGenerator<AskedTermEvent> {
      for await (const event of explainStream({
        meta: article.meta,
        blocks: article.blocks,
        blockId: found.blockId,
        /* **The article's words, not the reader's.** `found.quote` is
           `anchor.matched`, the run of characters actually in that block, so
           "the reader has selected this passage" stays literally true through
           the plural and the capital the matcher folded — and, as a side effect
           worth stating, the reader's own string never reaches the model at
           all. */
        quote: found.quote,
        ...(signal ? { signal } : {}),
      })) {
        if (event.type === "delta") {
          yield event;
          continue;
        }

        refuseUnfinished(event.ending);

        const lookup: GlossaryLookup = {
          answer: event.answer,
          /* `safeUrl` for `lookUpTerm`'s reason with one word changed: this is
             where a model-supplied URL stops being a value in flight and
             becomes one the panel will put in an `href`. It is not stored, and
             that changes nothing — the `href` is the hazard, not the column. */
          citations: event.citations.flatMap((c) => {
            const url = safeUrl(c.url);
            return url ? [{ url, ...(c.title ? { title: c.title } : {}) }] : [];
          }),
          searches: event.searches,
          model: event.model,
          at: now(),
        };

        /* **No term and no prose in the line**, which here means the answer,
           the quote and the words the reader typed — a search box is a reader's
           private question in a way a stored glossary entry is not. `chars` is
           what makes the eighty-character bound observable without carrying the
           string. docs/project/logging.md. */
        log("store").info(
          {
            slug,
            chars,
            searches: lookup.searches,
            citations: lookup.citations.length,
            model: lookup.model,
          },
          "explained a term a reader asked about",
        );

        yield { type: "done", answer: { ...found, lookup } };
        return;
      }
      /* Unreachable by `explainStream`'s own contract — it yields `done` or
         throws — and here so an edit that breaks that contract fails loudly
         rather than ending a stream with no terminal event. `explain`'s
         drain carries the same line for the same reason. */
      throw new Error("The explanation ended without an answer.");
    }

    return { found, stream };
  };
}
