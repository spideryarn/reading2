/**
 * **The allowlist, as code.** Every key a stranger receives is written out in
 * this file, once.
 *
 * The alternative — take today's response and delete the fields that look
 * private — was the first draft of docs/plans/260827ai-public-read-only-access.md, and
 * GPT Sol refused it on 2026-08-27:
 *
 * > A recursive key denylist is insufficient: it misses innocently named fields
 * > such as `title`, `guidance`, `comments`, `generatedAt`, `lookup`, and future
 * > aliases such as `owner`, `createdBy`, or snake-case keys.
 *
 * A denylist has to be right about a set that grows; an allowlist has to be
 * right about a set that only changes when somebody edits this file. So the
 * functions below **construct** their results rather than filtering them, and
 * `tests/public-dto.test.ts` asserts their key sets recursively, including
 * inside `blocks` and inside every tree node.
 *
 * ## Why the reader also narrows its `select`
 *
 * Belt and braces, and the braces are the stronger half:
 * [public-reader.ts](../store/public-reader.ts) never fetches `note`,
 * `fetched_at` or the PDF provenance at all. A projection here is one careless
 * `...spread` away from being widened; a column that was never selected has to
 * be put back on purpose, in SQL, where a reviewer sees it.
 *
 * **`final_url` is the exception, and it is fetched.** It has been since
 * 2026-08-30, when a public article started showing where it came from — so for
 * that one column the braces are off and this file is the only thing between it
 * and a stranger. `publicMeta` runs it through `publicSourceUrl` (../urls.ts)
 * and publishes the answer; the column itself never crosses. That is a heavier
 * responsibility than any other line here carries, which is why it is written
 * down twice — again at the field.
 *
 * ## Only two of these are exported, deliberately
 *
 * `publicMeta`, `publicBlock`, `publicTree`, `publicArc` and the four artefact
 * projections slice 1b added are the pieces `publicArticle` is built from, and
 * nothing outside this file assembles a public response by hand — which is the
 * property worth keeping. Slice 1b was expected to want some of them exported
 * for four sibling endpoints; Greg's decision that there are no sibling
 * endpoints means there is still nothing to export them to.
 *
 * ## What is NOT here
 *
 * `profileChanged`, on any artefact. It cannot even be computed on this path:
 * `withProfileChanged()` calls `resolveProfile(slug)`, which needs a reader and
 * therefore an owner, and on an ownerless request `currentOwnerId()` throws.
 * That is the right answer anyway — it is a property of an artefact against a
 * *person*, and there is no person here.
 */

import type { Assets } from "../assets.js";
import type { Sketch } from "../sketch-scene.js";
import type {
  Arc,
  ArcEntry,
  Block,
  BlockId,
  BlockKind,
  Citation,
  CitationPlace,
  Bibliography,
  CitedWork,
  ClaimDebateRow,
  Comment,
  Crossref,
  Crossrefs,
  Debate,
  DirectDebateRow,
  Faq,
  FaqQuestion,
  DebateClaimList,
  ListedClaim,
  SimpleParagraph,
  SimpleSummary,
  Glossary,
  Idea,
  Ideas,
  IdentificationSignal,
  NavLabelStatus,
  Quote,
  Quotes,
  RegistryWork,
  NodeId,
  SearchHit,
  SearchRun,
  Timeline,
  TimelineEvent,
  Skim,
  SkimStop,
  TimelineOccurrence,
  Tree,
  TreeNode,
  Tweet,
  TweetThread,
} from "../types.js";
import {
  anchorFields,
  identifiesOf,
  isUsableSimpleSummary,
  paragraphShape,
  publishedYearOf,
  readStoredBears,
  readStoredLean,
} from "../types.js";
import type { DebateSynthesis } from "../types.js";
import { dayFrame } from "../timeline-time.js";
import { ratedDifficultyOf } from "../reading-time.js";
import { ENTRY_CAP, entryOfText } from "../citation-entry.js";
import { readStoredSynthesis, settleSynthesis, type SynthesisRow } from "../debate-synthesis.js";
import { readCitationRegistry, readRegistryWork } from "../registry-work.js";
import type {
  PublicArticle,
  PublicBlock,
  PublicBibliography,
  PublicCitedWork,
  PublicCrossrefs,
  PublicCitationRegistry,
  PublicClaimDebateRow,
  PublicDebate,
  PublicDirectDebateRow,
  PublicFaq,
  PublicDebateClaimList,
  PublicSimpleSummary,
  PublicIdentificationSignal,
  PublicGlossary,
  PublicGlossaryEntry,
  PublicIdeas,
  PublicComment,
  PublicQuotes,
  PublicMeta,
  PublicSearchRun,
  PublicSharedBy,
  PublicSketch,
  PublicSourceGuess,
  PublicTimeline,
  PublicSkim,
  PublicTweets,
} from "../public-types.js";
import { hostOf, publicCitationUrl, publicSourceUrl } from "../urls.js";

/**
 * The masthead.
 *
 * **`titleFor()` is not called here and must never be.** Both stores run the
 * owner's meta through it so that the reading view's masthead calls a renamed
 * article what the shelf calls it — correct for the owner, and the owner's
 * private rename for everybody else. The reader does not even select
 * `articles.title_override`, so there is nothing here to run it on.
 *
 * The fallback that *is* kept is `metaFrom`'s: a stored title, then the
 * article's own first `<h1>`, then the slug. That one is about the article.
 */
function publicMeta(row: {
  slug: string;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  excerpt: string | null;
  journal: string | null;
  /**
   * The owner's `Meta.publishedAt`, **not the thing that goes out**: it may
   * carry a time of day and an offset. Named for the column, like `finalUrl`
   * below, and cut to the calendar day here.
   */
  publishedAt: string | null;
  publishedYear: number | null;
  /** The three rating columns a screen is shown; `ratedDifficultyOf` makes one value of them or none. */
  readingLanguage: number | null;
  readingIdeas: number | null;
  readingDifficultyReason: string | null;
  headingTitle: string | null;
  /**
   * Stage 1's post-redirect address, **still not the thing that goes out**.
   *
   * Named for the column so the reader below can hand its projection straight
   * over, and converted here rather than there for the reason this whole file
   * exists: the decision about what a stranger receives is made in one place,
   * in code a reviewer reads. `publicSourceUrl` is the policy.
   */
  finalUrl: string | null;
}): PublicMeta {
  /* A named const rather than the expression inline, so the shorthand `{ url }`
     below ties the published key to it. `opt()` cannot be used here — it copies
     a field, and this computes one — and the spread it saves you from is the one
     that compiles clean with the key misspelled. */
  const url = row.finalUrl === null ? null : publicSourceUrl(row.finalUrl);
  /* **The day, not the stored string**, and a day or a year, never both
     (plan 261004h). Computed like `url`, so named consts and shorthand keys
     for its reason. A stored string that does not start with a real day sends
     nothing; a year is sent only when there is no day to send. */
  const published = dayFrame(row.publishedAt);
  const publishedYear = published === null ? publishedYearOf(row.publishedYear) : undefined;
  /* Rebuilt field by field through the owner's own rule, so a visitor's
     minutes are the owner's and nothing beside the three fields can ride
     along. The model's id and the time are not in the row to begin with. */
  const readingDifficulty = ratedDifficultyOf({
    language: row.readingLanguage,
    ideas: row.readingIdeas,
    reason: row.readingDifficultyReason,
  });
  return {
    slug: row.slug,
    title: row.title ?? row.headingTitle ?? row.slug,
    /* Conditional spreads throughout, because `exactOptionalPropertyTypes` is
       on: Postgres hands back `null` where the shape simply has no key, and
       `byline: undefined` is a different type from an absent `byline`. */
    ...(row.byline === null ? {} : { byline: row.byline }),
    ...(row.siteName === null ? {} : { siteName: row.siteName }),
    ...(row.lang === null ? {} : { lang: row.lang }),
    ...(row.excerpt === null ? {} : { excerpt: row.excerpt }),
    /* Where and when it was published. Greg, 2026-10-04: "Q-visitor-page yes".
       The journal is copied, so its name is a checked literal (`optNull`); the
       other two are computed, so shorthand keys. A DOI is not named and must
       not be. */
    ...optNull(row, "journal"),
    ...(published === null ? {} : { published }),
    ...(publishedYear === undefined ? {} : { publishedYear }),
    /* **Two ways to get no key**, and they collapse on purpose: no address at
       all, and an address the policy will not publish. A visitor is told the
       same thing by both — nothing — because there is nothing they could do
       differently, and a "we have one but will not show you" would be a fact
       about us rather than about the piece. src/urls.ts § `publicSourceUrl`. */
    ...(url === null ? {} : { url }),
    /* A model's judgement of the published text: the levels and its sentence
       (plan 261005j). Computed, so a shorthand key, like `url`. */
    ...(readingDifficulty === null ? {} : { readingDifficulty }),
  };
}

/**
 * **Carry one optional field across, with the compiler checking its name.**
 *
 * Every field in this file is named on purpose, and until 2026-08-29 the idiom
 * for an optional one spread a fresh object literal into the result, naming the
 * key twice. That idiom has a hole, confirmed by GPT Sol's sixth review and
 * then measured:
 * spelling the key `treatmnt` inside the spread compiles **clean**. TypeScript's
 * excess-property check does not look at keys contributed through a spread, and
 * an outer `satisfies` on the whole object does not repair it. So the one
 * mistake this file cannot afford — a field that silently fails to cross — was
 * the one mistake the compiler would not catch. `publicTree` dropping
 * `treatment` reverted the entire footnotes feature for anyone following a
 * shared link, and that was an omission rather than a typo; a typo would have
 * looked identical and been harder to see.
 *
 * `K extends keyof T` closes it: the field name is a checked literal, so a typo
 * is a compile error, and it still reads at the call site as this file naming
 * the field deliberately, which is the property the whole design rests on. The
 * cast is for the computed key alone — `{ [key]: … }` widens to `string` — and
 * it is contained here rather than repeated twenty-two times.
 *
 * The output is byte-identical to the idiom it replaces: absent stays absent,
 * so no cached public payload changes shape. tests/public-dto.test.ts pins the
 * exact recursive key set.
 */
function opt<T, K extends keyof T>(source: T, key: K): Partial<Pick<T, K>> {
  return source[key] === undefined ? {} : ({ [key]: source[key] } as Partial<Pick<T, K>>);
}

/**
 * `opt`, for a database row: a column Postgres had nothing in is `null`, and
 * crosses as an absent key. The same checked name, for the same reason.
 */
function optNull<T, K extends keyof T>(source: T, key: K): { [P in K]?: NonNullable<T[P]> } {
  const value = source[key];
  return value == null ? {} : ({ [key]: value } as { [P in K]?: NonNullable<T[P]> });
}

/**
 * One block, rebuilt.
 *
 * `note` is the field that must not cross, and it is gone twice over: the query
 * does not select it, and this function does not name it.
 */
function publicBlock(block: Block | PublicBlock): PublicBlock {
  return {
    id: block.id,
    tag: block.tag,
    kind: block.kind as BlockKind,
    ...opt(block, "level"),
    text: block.text,
    words: block.words,
    html: block.html,
    gistable: block.gistable,
    ...opt(block, "role"),
    ...opt(block, "treatment"),
    ...opt(block, "noteId"),
    /* **The authored box crosses, for the same reason `treatment` does**: a
       visitor following a shared link reads the same article, and a callout set
       as ordinary prose is the piece rendered wrong rather than rendered
       privately.
       **Rebuilt field by field, not copied by reference.** The first version
       spread `opt(block, "context")`, which is this file's own rule broken in
       the one place it is easiest to break it: a nested object passes whatever
       it happens to carry, so a third field added to `BlockContext` next month —
       or a caller constructing one with something extra on it — crosses without
       anybody naming it. Nothing of the owner's is reachable today; the point is
       that "today" is not the guarantee this file offers. GPT Sol, 2026-08-31. */
    ...(block.context === undefined
      ? {}
      : { context: { id: block.context.id, type: block.context.type } }),
  };
}

/**
 * The tree, rebuilt node by node.
 *
 * **Still typed `Tree`, and that is the decision.** A public twin of the
 * granularity-zoom tree would fork the whole client — the ToC, the spine and
 * the zoom are one structure by design
 * (docs/project/granularity-zoom.md#the-tree) and the plan is explicit that
 * they must not become two. Nothing in a `TreeNode` is about a person: it is
 * the article's skeleton, its titles, and the one-sentence gists.
 *
 * So why rebuild it at all? Because *default-absent* is the property worth
 * having. A field added to `TreeNode` next month is not in a public response
 * until somebody adds a line here. If it is a **required** field, this function
 * stops compiling, which is the loud version; if it is optional, it is silently
 * dropped, which is the safe one.
 *
 * `version` and `generator` are named rather than dropped, deliberately: they
 * say which of our generators wrote the tree, which is provenance about us and
 * not about the owner, and the client reads `rootId` and `nodes` beside them.
 */
function publicTree(tree: Tree): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id as NodeId] = {
      id: node.id,
      depth: node.depth,
      parent: node.parent,
      /* **`?? []`: a node with no list is a leaf, and goes out with an empty
         one.** The tree is JSON out of the store and its type is a claim, not
         a check; spreading a list that is not there throws, and the public
         route answers a visitor with a 500. The same rule as the client's
         mend, src/web/tree.ts § `withChildLists`. tests/public-dto.test.ts. */
      children: [...(node.children ?? [])],
      range: [node.range[0], node.range[1]],
      title: node.title,
      ...opt(node, "gist"),
      /* Summary mode is a signed-in and a public surface alike, so the question
         crosses with the gist it sits under. SPIDERYARN-READING2-1V. */
      ...opt(node, "question"),
      ...opt(node, "navLabel"),
      ...opt(node, "summary"),
      ...opt(node, "sourceHeading"),
      /* Whose words the title is, as `sourceHeading` is: a visitor's page draws the same faces. */
      ...opt(node, "titleFrom"),
      /* **`treatment` crosses, and that is a decision.** The safe default here
         is to drop an optional field, and this one was dropped until 2026-08-29
         — with the test below saying in as many words that whoever landed the
         footnotes lane had to come here and choose.
         It has to cross. Every consumer that tells the apparatus from the
         argument reads it off the *node*: the fisheye collapses forty endnotes
         into one "Notes" row, the spine dims it, Structure's list face and
         Summary mode refuse to descend into it or number it, and the diagram
         leaves it out of the argument's picture. A public reader without it
         gets all of that back as it was — footnotes numbered as a part of the piece, one blank
         row per endnote, and "No summary for this section" on each. Measured
         through the real DTO: 1 part and 1 section for the owner, 2 and 2 for
         a visitor.
         Nothing about it is private. It says a node is apparatus rather than
         argument, which is structure exactly as `depth` and `title` are, and it
         is derived from the article's own markup rather than from anything the
         owner did. GPT Sol, fifth review. */
      ...opt(node, "treatment"),
    };
  }
  return {
    version: tree.version,
    generator: tree.generator,
    slug: tree.slug,
    rootId: tree.rootId,
    nodes,
    /* **`provisional` crosses, for the same reason `treatment` does.** It says
       the structure is a stand-in carved from the author's headings and has no
       gists yet (src/heading-tree.ts). A public reader without it gets a
       reading view that draws empty cells at every coarse zoom level and no way
       to tell that from an article whose gists are simply bad — the client
       branches on this to say the structure is still arriving. Nothing about it
       is private: it is a fact about which of our generators wrote the tree,
       which is exactly what `version` and `generator` above already say. */
    ...(tree.provisional ? { provisional: tree.provisional } : {}),
  };
}

/** The arc, rebuilt, for the same reason and by the same rule as the tree. */
function publicArc(arc: Arc): Arc {
  return {
    version: arc.version,
    generator: arc.generator,
    slug: arc.slug,
    entries: arc.entries.map(
      (entry): ArcEntry => ({ range: [entry.range[0], entry.range[1]], text: entry.text }),
    ),
  };
}

/**
 * The glossary, rebuilt entry by entry — **and neither `lookup` nor `hidden` is
 * among the fields.**
 *
 * This is the projection GPT Sol's design input named as the hazardous one, and
 * it is worth saying why in the file that does it rather than only in the plan.
 * `loadGlossary` on the owner's side attaches `glossary_lookups` and the
 * owner's hidden ids to entries at the read seam, on purpose. A lookup is what
 * came back when *that reader* pressed "check the web", and `hidden` is what
 * they chose not to see. Both are correct for the owner; neither belongs on a
 * shared link.
 *
 * Two things stop it, and neither is this function on its own. The public
 * reader selects the `glossary` column off `article_revisions` and joins
 * neither private table, and tests/public-imports.test.ts derives every
 * forbidden table from the schema and refuses a public module that names one.
 * This is the third: even handed an entry that carried either field, neither is
 * copied.
 */
function publicGlossary(glossary: Glossary): PublicGlossary {
  return {
    entries: glossary.entries.map(
      (entry): PublicGlossaryEntry => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        aliases: [...entry.aliases],
        /* Conditional spreads throughout, because `exactOptionalPropertyTypes`
           is on and absent is a meaningful answer for most of these — an entry
           with no `background` is one the model did not claim to know about,
           which is visibly different from an invented one. */
        ...opt(entry, "senseHere"),
        ...opt(entry, "background"),
        ...opt(entry, "gloss"),
        ...opt(entry, "detail"),
        ...opt(entry, "url"),
        ...opt(entry, "difficulty"),
        ...opt(entry, "centrality"),
        ...opt(entry, "fromOutside"),
        blocks: [...entry.blocks],
      }),
    ),
  };
}

/**
 * The quotes, rebuilt quote by quote.
 *
 * Field by field like its neighbours rather than passed through whole, for the
 * reason this whole file exists: a projection that spreads is a projection that
 * publishes whatever the artefact gains next. What is deliberately left behind
 * is every pipeline fact around the list — `sourceHash`, `version`,
 * `generator`, `profileHash`, `elapsedMs`.
 *
 * **`generatedAt` and each quote's `addedAt` cross, since 2026-10-03**, for the
 * reason `discarded` does: the reader is shown them. Every quote's card ends
 * *Chosen by the AI · {date}*, a visitor has that card too, and a quote stored
 * before `addedAt` existed can only say *on or before* the list's time — so
 * dropping either would make the line true for the owner and missing for
 * everybody else (GPT Sol, 261003h Q3). src/public-types.ts § `PublicQuotes`.
 *
 * `start` is kept. It is an offset into a block of the article the visitor is
 * already reading, and without it a quote that appears twice in one paragraph
 * marks the wrong occurrence — src/quote-match.ts § `findQuote`.
 */
function publicQuotes(quotes: Quotes): PublicQuotes {
  return {
    generatedAt: quotes.generatedAt,
    /* Rebuilt field by field like the list itself, rather than passed through:
       a projection that spreads is one that publishes whatever the artefact
       gains next. See the field's note in src/public-types.ts for why this one
       crosses at all when no other pipeline fact does. */
    ...(quotes.discarded === undefined
      ? {}
      : {
          discarded: {
            unfound: quotes.discarded.unfound,
            otherVoice: quotes.discarded.otherVoice,
            wrongLength: quotes.discarded.wrongLength,
            overlapping: quotes.discarded.overlapping,
            overCap: quotes.discarded.overCap,
            malformed: quotes.discarded.malformed,
          },
        }),
    quotes: quotes.quotes.map(
      (quote): Quote => ({
        id: quote.id,
        blockId: quote.blockId,
        text: quote.text,
        ...opt(quote, "start"),
        ...opt(quote, "reason"),
        ...opt(quote, "importance"),
        ...opt(quote, "striking"),
        ...opt(quote, "addedAt"),
      }),
    ),
  };
}

/**
 * The timeline, rebuilt event by event.
 *
 * The envelope is the work here: `version`, `generator`, `slug`, `sourceHash`,
 * `generatedAt`, `elapsedMs` and `orderConflicts` all stay behind, and
 * src/public-types.ts § `PublicTimeline` argues the last of those, which is the
 * only one that is a close call.
 *
 * **The events cross whole**, like `Idea` and `Quote` and unlike the glossary:
 * every field of a `TimelineEvent` is about the article — a label, the
 * article's own dating words, the model's ordering, and offsets into blocks the
 * visitor is already reading. `dating` and `occurrences` are passed through as
 * the structures they are rather than rebuilt field by field, because
 * `Dating` is a four-member union whose members a hand-copy would have to
 * re-switch on, and a `default:` arm that dropped an unhandled kind would
 * silently publish an event with no date rather than fail. The type is the
 * allowlist for these two; the day `TimelineEvent` grows a field that is about
 * a person, this comment is wrong and the test below is what says so.
 */
function publicTimeline(timeline: Timeline): PublicTimeline {
  return {
    events: timeline.events.map(
      (event): TimelineEvent => ({
        id: event.id,
        label: event.label,
        dating: event.dating,
        order: event.order,
        modality: event.modality,
        occurrences: event.occurrences.map(
          (occurrence): TimelineOccurrence => ({
            blockId: occurrence.blockId,
            quote: occurrence.quote,
            start: occurrence.start,
          }),
        ),
      }),
    ),
  };
}

/**
 * **The Skim route, rebuilt stop by stop** — since 2026-09-29
 * (SPIDERYARN-READING2-56).
 *
 * Five fields of a stop and `offered`, and nothing else: `profileHash` is
 * who the route was planned for and never crosses, and the rest of the
 * document is pipeline provenance. `cue` is optional on a stored stop (routes
 * before `trajectory/5` have none), so it goes through `opt`; so is `again`
 * (absent before `skim/9`, and on any stop carried nowhere). `again` is which
 * passes the stop is walked in — the route itself, so without it a visitor
 * would walk a different pass from the owner (plan 261003l, Sol F4).
 * src/public-types.ts § `PublicSkim` is the argument for each.
 */
function publicSkim(skim: Skim): PublicSkim {
  return {
    stops: skim.stops.map(
      (stop): SkimStop => ({
        quoteId: stop.quoteId,
        depth: stop.depth,
        role: stop.role,
        ...opt(stop, "cue"),
        ...opt(stop, "again"),
      }),
    ),
    offered: skim.offered,
  };
}

/**
 * **The FAQ, rebuilt question by question and passage by passage** — since
 * 2026-09-29 (SPIDERYARN-READING2-56, plan 260929c stage 2).
 *
 * The question and the article's own passages, and nothing else: `dropped` is
 * our checking's tally and the rest is pipeline provenance.
 * src/public-types.ts § `PublicFaq` is the argument.
 */
function publicFaq(faq: Faq): PublicFaq {
  return {
    questions: faq.questions.map(
      (q): FaqQuestion => ({
        id: q.id,
        question: q.question,
        passages: q.passages.map(publicPlace),
        /* The model's two judgments cross, because a visitor's panel orders and
           thresholds on them exactly as the owner's does (plan 260929g). Absent
           stays absent: a list from before `faq/4` has neither. */
        ...(q.difficulty !== undefined ? { difficulty: q.difficulty } : {}),
        ...(q.centrality !== undefined ? { centrality: q.centrality } : {}),
      }),
    ),
  };
}

/**
 * **Debate's claims list, rebuilt claim by claim** — since 2026-10-08 (plan
 * 261008i § 2). The article's quote and its place, the model's statement and
 * the claim's id, and nothing else: `dropped` is our checking's tally and the
 * rest is pipeline provenance. src/public-types.ts § `PublicDebateClaimList`
 * is the argument.
 */
function publicDebateClaimList(list: DebateClaimList): PublicDebateClaimList {
  return {
    claims: list.claims.map(
      (c): ListedClaim => ({ id: c.id, blockId: c.blockId, quote: c.quote, statement: c.statement }),
    ),
  };
}

/**
 * **Simple, rebuilt level by level and paragraph by paragraph** — each
 * `{ text, ids }`, plus `sentences` when they are usable (each with its `key`
 * when that is valid) and `list: true` when it draws as one, and nothing else;
 * the stamp is pipeline provenance, and `profileHash` is the owner's.
 * src/public-types.ts § `PublicSimpleSummary` is the argument.
 */
function publicSimpleSummary(simple: SimpleSummary): PublicSimpleSummary {
  /* Sentences cross only through `usableSentences` — the owner's panel asks
     the same question — so a visitor never gets a list that is not the
     paragraph's own checked text (plan 261002e, Sol F2). It returns each
     sentence rebuilt as `{ text, id }` and a `key` only when that is a phrase
     of the sentence, so bold discloses no word the text does not (plan
     261004b). `list` is one boolean about sentences that already cross, and
     goes only with them: without usable sentences there is no list to draw. */
  const level = (paragraphs: readonly SimpleParagraph[]): SimpleParagraph[] =>
    paragraphs.map((p): SimpleParagraph => {
      const shape = paragraphShape(p);
      const sentences =
        shape.kind === "text" ? null : shape.kind === "prose" ? shape.sentences : [shape.lead, ...shape.items];
      return {
        text: p.text,
        ids: [...p.ids],
        ...(sentences ? { sentences } : {}),
        ...(shape.kind === "list" ? { list: true } : {}),
      };
    });
  /* Named one by one, so a row stored before 2026-10-04, which still has the
     removed middle level, sends a visitor only these two (plan 261004f). */
  return {
    levels: {
      brief: level(simple.levels.brief),
      fuller: level(simple.levels.fuller),
    },
  };
}

/** One quoted place in the article — the FAQ's passage and a citation's mention share the shape. */
function publicPlace(place: CitationPlace): CitationPlace {
  return { blockId: place.blockId, quote: place.quote, start: place.start };
}

/**
 * **One cited work, rebuilt field by field** — since 2026-09-29 (plan 260929c
 * stage 3).
 *
 * **`url` goes through `publicCitationUrl`** (src/urls.ts), as a comment's
 * citations do, but a refusal here drops the *link* and keeps the row: a work
 * the piece cites is still cited without an address, where a comment's
 * citation *is* its address. **A `web` link is dropped outright** without
 * being judged: that rule means the owner's own *Find it* found it, and the
 * finds are private (plan 260929c § What stays owner-only). Its `linkFrom`
 * goes too: leaving `"web"` behind would still disclose that the owner ran
 * Find it, so the public row returns to the pre-find `"search"` state. The
 * stored column never holds one — the owner's read attaches finds from
 * `citation_finds` — so this is the second of two, for the day something
 * writes one back or hands this projection an attached owner read.
 *
 * `key` and `found` are not named, so they do not cross. src/public-types.ts §
 * `PublicCitedWork` has why for each.
 */
function publicCitedWork(work: CitedWork, blockText: ReadonlyMap<string, string>): PublicCitedWork {
  /* A named const, so the shorthand `{ url }` below ties the key to it —
     `publicMeta`'s idiom, since `opt()` copies a field and this computes one. */
  const ownerFound = work.linkFrom === "web";
  const url = ownerFound ? null : publicCitationUrl(work.url);
  const linkFrom: PublicCitedWork["linkFrom"] =
    work.linkFrom === "web" ? "search" : work.linkFrom;
  return {
    id: work.id,
    title: work.title,
    ...opt(work, "authors"),
    ...opt(work, "year"),
    why: work.why,
    ...opt(work, "relevance"),
    ...opt(work, "influence"),
    ...(work.reference === undefined ? {} : { reference: publicPlace(work.reference) }),
    ...publicEntry(work, blockText),
    mentions: work.mentions.map(publicPlace),
    citedAt: [...work.citedAt],
    firstCited: work.firstCited,
    citedInBody: work.citedInBody,
    ...(url === null ? {} : { url }),
    linkFrom,
    ...publicCitationRegistry(work.registry),
  };
}

/**
 * **A found registry record, and nothing else** (plan 261001a stage 5) —
 * rebuilt by `readRegistryWork`, so only its named fields cross. A `conflict`
 * stays with the owner: it is our verdict on the article's identifier, and a
 * visitor's row is drawn as the article gives it.
 */
function publicCitationRegistry(registry: unknown): { registry?: PublicCitationRegistry } {
  const read = readCitationRegistry(registry);
  return read?.kind === "found" ? { registry: read } : {};
}

/**
 * **A work's entry, only when it is its own bibliography block's text** —
 * since 2026-10-01 (plan 261001b, SPIDERYARN-READING2-6K).
 *
 * The test is equality with `entryOfText` of the `reference` block's text, the
 * same function the stage built a block entry with (src/citation-entry.ts), and
 * the block must be in this payload. Then the entry adds no character a visitor
 * could not already read. **An entry read from a PDF's text layer fails it**,
 * because a PDF's bibliography is not rendered as blocks, and that is the
 * point: such an entry can hold a publisher's one-page "Downloaded by …" stamp
 * that the furniture filter missed (GPT Sol, plan review P1). It stays
 * owner-only. A value that is not a string within the cap fails too, since
 * JSONB arrives unchecked (Sol P2).
 */
function publicEntry(work: CitedWork, blockText: ReadonlyMap<string, string>): { entry?: string } {
  const entry: unknown = work.entry;
  if (typeof entry !== "string" || entry.length > ENTRY_CAP) return {};
  const at: unknown = work.reference?.blockId;
  const text = typeof at === "string" ? blockText.get(at) : undefined;
  return text !== undefined && entryOfText(text) === entry ? { entry } : {};
}

/**
 * **The Bibliography** — the works, and `capped` because the panel prints it.
 * src/public-types.ts § `PublicBibliography`. `blockText` is this payload's own
 * blocks, which `publicEntry` checks an entry against.
 */
function bothBibliographyKeys(list: PublicBibliography): { bibliography: PublicBibliography; citations: PublicBibliography } {
  return { bibliography: list, citations: list };
}

function publicBibliographyList(
  bibliography: Bibliography,
  blockText: ReadonlyMap<string, string>,
): PublicBibliography {
  return {
    citations: bibliography.citations.map((work) => publicCitedWork(work, blockText)),
    capped: bibliography.capped,
  };
}

/**
 * **The Debate, rebuilt group by group, row by row and signal by signal** —
 * since 2026-09-29 (SPIDERYARN-READING2-56, plan 260929c stage 4), by the
 * contract its own plan set: 260905f § Security and § Stage 4.
 *
 * Three kinds of address can be on a row, and each is judged by the policy
 * that fits what it *is*:
 *
 * - **The row's `url`** is a stranger's page the search returned — a citation,
 *   so `publicCitationUrl`, as a comment's citations are judged. **A refusal
 *   drops the whole row**, not the link: a Debate row is its source, and there
 *   is no public row type without one (260905f § Security).
 * - **A `linked` signal's `url`** is *the article's own address* as the page
 *   spelled it (src/debate.ts § `linkTo`, matched against `meta.url`, which is
 *   `final_url`). So it gets the article's own policy, `publicSourceUrl` —
 *   what `publicMeta` publishes the masthead's address by, which also refuses
 *   a query string, because a query on an address the owner fetched can carry
 *   their token. `publicCitationUrl` would pass that query, and that is the
 *   hazard: a visitor would read, in a tooltip, the address `publicMeta` took
 *   off the masthead. A refusal takes the address off the signal; the fact
 *   that the page links the piece stays. GPT Sol, plan review 1 (P0).
 * - **An address inside the row's words** — `articleReferenceQuote` above all,
 *   which is the witness that the page names the article and so is exactly
 *   where the article's address turns up. Words cannot lose a link, so **a row
 *   whose words contain an address this boundary refused is dropped** —
 *   `refusedAddresses` below says which, and every string on the row is asked,
 *   not only the witness, so the property is "a refused address appears nowhere
 *   in the payload" rather than "not in the field we thought of".
 *
 * Every dropped row is counted in its group's `sourceNotPublishable`, computed
 * **here** and never read off the artefact (260905f § What is counted, Sol's
 * F17), and the visitor's foot line says it. The stored `counts` do not cross.
 *
 * Legacy rows: `lean` is read through `readStoredLean` (a row stored before
 * 2026-09-08 has `valence`), and `identifies` through `identifiesOf` (a row
 * stored before 2026-09-06 has none), so a visitor's row is always in the
 * current vocabulary and never has an empty evidence list.
 */
function publicDebate(debate: Debate, finalUrl: string | null): PublicDebate {
  const refused = refusedAddresses(debate, finalUrl);
  /** Does any of these strings contain an address the boundary refused? Decode
   * percent-escaped ASCII first as well: generated prose may quote a URL in
   * encoded form, but that does not make the capability inside it public. */
  const carriesRefused = (texts: readonly unknown[]): boolean =>
    texts.some((text) => {
      if (typeof text !== "string") return false;
      const decoded = decodePercentEscapedAscii(text);
      return refused.some((address) => text.includes(address) || decoded.includes(address));
    });

  const direct: PublicDirectDebateRow[] = [];
  let directWithheld = 0;
  for (const row of debate.direct.rows) {
    const url = publicCitationUrl(row.url);
    const signals = identifiesOf(row);
    if (
      url === null ||
      carriesRefused([row.url, row.title, row.sourceQuote, row.applies, row.limits, row.articleReferenceQuote]) ||
      carriesRefused(signals.flatMap(signalTexts))
    ) {
      directWithheld += 1;
      continue;
    }
    direct.push({
      ...publicDebateRowBase(row, url),
      articleReferenceQuote: row.articleReferenceQuote,
      identifies: signals.map(publicSignal),
    });
  }

  const claims: PublicClaimDebateRow[] = [];
  let claimsWithheld = 0;
  for (const row of debate.claims.rows) {
    const url = publicCitationUrl(row.url);
    if (url === null || carriesRefused([row.url, row.title, row.sourceQuote, row.applies, row.limits, row.claimQuote])) {
      claimsWithheld += 1;
      continue;
    }
    claims.push({ ...publicDebateRowBase(row, url), claimQuote: row.claimQuote, blockId: row.blockId });
  }

  const synthesis = publicSynthesis(
    debate,
    [...direct, ...claims],
    directWithheld + claimsWithheld > 0,
    carriesRefused,
  );
  return {
    searchedAt: debate.searchedAt,
    direct: { rows: direct, sourceNotPublishable: directWithheld },
    /* A debate searched at `debate/7` or later ran no claims search, and says
       so rather than crossing as an empty group, which a visitor's panel would
       read as a search that kept nothing (src/types.ts § `DebateClaims`). It
       has no rows, so there is nothing above for it to withhold. */
    claims:
      debate.claims.pass === "not-run"
        ? { pass: "not-run", rows: [] }
        : { rows: claims, sourceNotPublishable: claimsWithheld },
    ...(synthesis === undefined ? {} : { synthesis }),
  };
}

/**
 * **The threads and key sources, as a visitor may have them** — since
 * 2026-10-01 (plan 261001b, SPIDERYARN-READING2-6M).
 *
 * Read through `readStoredSynthesis` first, all rows, exactly as the owner's
 * panel reads it, so a visitor never gets a synthesis the owner would not.
 * Then:
 *
 * - `failed` and `too-few` cross as they are: no prose, and `rows` is a count.
 * - **`made` does not cross at all if any row was withheld.** The call saw
 *   every row, so a theme kept over two published rows can still describe a
 *   withheld one in its gist without containing its address, and nothing here
 *   can see that (GPT Sol, plan review P1). Absent is honest: the visitor's
 *   foot line already says rows were withheld.
 * - Otherwise every label, gist and why is asked `carriesRefused`, as the rows'
 *   words are — the article's own refused address can still be quoted with no
 *   row withheld — and an item that carries one is dropped. What is left is
 *   re-settled against the **published** rows by `settleSynthesis`, the one
 *   rule set both readers share, so every row id named is one this payload
 *   carries and a theme still spans two works. Settled to nothing, it stays
 *   `made` with empty lists rather than becoming `failed`: the call did not
 *   fail, this boundary took its answer.
 */
function publicSynthesis(
  debate: Debate,
  published: readonly SynthesisRow[],
  withheld: boolean,
  carriesRefused: (texts: readonly unknown[]) => boolean,
): DebateSynthesis | undefined {
  const stored = readStoredSynthesis(debate);
  if (stored === null) return undefined;
  switch (stored.kind) {
    case "failed":
      return { kind: "failed" };
    case "too-few":
      return { kind: "too-few", rows: stored.rows };
    case "made": {
      if (withheld) return undefined;
      const settled = settleSynthesis(
        stored.themes.filter((t) => !carriesRefused([t.label, t.gist])),
        stored.key.filter((k) => !carriesRefused([k.why])),
        published,
      );
      return { kind: "made", themes: settled.themes, key: settled.key };
    }
    default: {
      const unreachable: never = stored;
      return unreachable;
    }
  }
}

/**
 * **Every address this boundary refuses to publish for this debate**, as the
 * strings to look for in a row's words — each one whole and without its
 * scheme, since a page's prose spells an address either way.
 *
 * - the article's own `final_url`, when `publicSourceUrl` refuses it — the
 *   masthead's address, which `publicMeta` already leaves off;
 * - every `linked` signal's address that `publicSourceUrl` refuses — the same
 *   address, as a stranger's page spelled it;
 * - every row `url` that `publicCitationUrl` refuses, so a credential in one
 *   row's source cannot ride out in another row's quotation.
 *
 * The comparison also decodes percent-escaped ASCII, including nested escapes,
 * before looking. That catches an encoded credential or signed query without
 * turning malformed `%` sequences into an exception at the public boundary.
 */
function refusedAddresses(debate: Debate, finalUrl: string | null): string[] {
  const out = new Set<string>();
  const add = (address: string) => {
    if (address === "") return;
    out.add(address);
    const bare = address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    if (bare !== "" && bare !== address) out.add(bare);
  };
  if (finalUrl !== null && publicSourceUrl(finalUrl) === null) add(finalUrl);
  for (const row of debate.direct.rows) {
    if (typeof row.url === "string" && publicCitationUrl(row.url) === null) add(row.url);
    for (const signal of identifiesOf(row)) {
      if (signal.kind === "linked" && publicSourceUrl(signal.url) === null) add(signal.url);
    }
  }
  for (const row of debate.claims.rows) {
    if (typeof row.url === "string" && publicCitationUrl(row.url) === null) add(row.url);
  }
  return [...out];
}

/** Decode URL punctuation and other ASCII bytes without throwing on malformed
 * escapes. Repeating catches `%253A` as well as `%3A`, and every pass shortens
 * the string so the loop necessarily terminates. */
function decodePercentEscapedAscii(value: string): string {
  let decoded = value;
  for (;;) {
    const next = decoded.replace(/%([0-7][0-9a-f])/gi, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === decoded) return decoded;
    decoded = next;
  }
}

/** The words on one signal, for `carriesRefused`. A `linked` address is judged on its own, above. */
function signalTexts(signal: IdentificationSignal): string[] {
  switch (signal.kind) {
    case "linked":
      return [];
    case "quoted":
      return [signal.quote];
    case "named":
      return [signal.witness];
    default: {
      const unreachable: never = signal;
      return unreachable;
    }
  }
}

/**
 * One signal, rebuilt. A `linked` address goes through `publicSourceUrl` — the
 * article's own policy; `publicDebate` has why — and a refusal leaves the
 * signal without it.
 */
function publicSignal(signal: IdentificationSignal): PublicIdentificationSignal {
  switch (signal.kind) {
    case "linked": {
      const url = publicSourceUrl(signal.url);
      return url === null ? { kind: "linked" } : { kind: "linked", url };
    }
    case "quoted":
      return {
        kind: "quoted",
        quote: signal.quote,
        blockId: signal.blockId,
        coverage: signal.coverage,
        density: signal.density,
      };
    case "named":
      return { kind: "named", by: signal.by, witness: signal.witness };
    default: {
      const unreachable: never = signal;
      return unreachable;
    }
  }
}

/** What both groups' rows carry, field by field; `url` is the one the caller already judged. */
function publicDebateRowBase(
  row: DirectDebateRow | ClaimDebateRow,
  url: string,
): Omit<PublicClaimDebateRow, "claimQuote" | "blockId"> {
  return {
    id: row.id,
    url,
    ...(typeof row.title === "string" ? { title: row.title } : {}),
    sourceQuote: row.sourceQuote,
    relation: row.relation,
    lean: readStoredLean(row),
    applies: row.applies,
    ...(typeof row.limits === "string" ? { limits: row.limits } : {}),
    /* The relevance stop, since 2026-10-01 (plan 261001b, 5P): one of three
       closed words, through `readStoredBears` so anything else is absent. */
    ...bearsOf(row),
    ...publicRegistryWork(row.registry),
  };
}

/** A Debate row's registry record, rebuilt field by field (plan 261001a stage 6). */
function publicRegistryWork(registry: unknown): { registry?: RegistryWork } {
  const read = readRegistryWork(registry);
  return read === null ? {} : { registry: read };
}

function bearsOf(row: DirectDebateRow | ClaimDebateRow): Pick<PublicClaimDebateRow, "bears"> {
  const bears = readStoredBears(row);
  return bears === null ? {} : { bears };
}

/**
 * The owner's comments, rebuilt comment by comment and citation by citation.
 *
 * **The filtering is not here**, and that is deliberate rather than an
 * oversight: the two rows that must never reach a visitor — a referee's note,
 * and an unfinished or failed model call — are refused **in SQL**, by
 * `PUBLIC_COMMENTS_WHERE` in src/store/public-reader.ts. A projection that
 * dropped them would be a second answer to the same question, and the one that
 * ran second would be the one nobody tested. See that predicate for the
 * argument.
 *
 * What this does is the allowlist half: name every key, and re-judge the one
 * value in a comment that is an address.
 */
function publicComments(comments: readonly Comment[]): PublicComment[] {
  return comments.map(
    (comment): PublicComment => ({
      id: comment.id,
      blockId: comment.blockId,
      /* Both or neither: a whole-block bookmark crosses with no anchor keys at
         all rather than `undefined` ones. */
      ...anchorFields(comment),
      createdAt: comment.createdAt,
      ...opt(comment, "body"),
      ...opt(comment, "answer"),
      ...opt(comment, "colour"),
      ...publicCitations(comment.citations),
    }),
  );
}

/**
 * **The citations, re-judged one at a time**, or the key left off entirely.
 *
 * `publicCitationUrl` (src/urls.ts) refuses a credential in the address and a
 * host a stranger could not have reached anyway. A citation that fails is
 * **dropped rather than blanked**: a footnote whose address has been replaced
 * by nothing is a claim the reader cannot follow and cannot see the failure of.
 *
 * **An empty result drops the key**, rather than crossing as `[]`. The two
 * would render differently — `citations: []` is *"the model cited nothing"* and
 * an absent key is *"this comment has no citations"* — and after this function
 * has thrown one away, neither of those is true. Absent is the honest one of
 * the two, because it is what a comment that never had any looks like.
 *
 * `title` through `opt`, so a mis-spelled key is a compile error rather than a
 * field that silently stops crossing. src/public/dto.ts § the idiom.
 */
function publicCitations(citations: Citation[] | undefined): { citations?: Citation[] } {
  if (citations === undefined) return {};
  const kept = citations.flatMap((citation): Citation[] => {
    const url = publicCitationUrl(citation.url);
    return url === null ? [] : [{ url, ...opt(citation, "title") }];
  });
  return kept.length === 0 ? {} : { citations: kept };
}

/**
 * The Sketch, as three fields of the artefact's nine.
 *
 * **The scenes are passed through whole**, and src/public-types.ts
 * § `PublicSketch` argues it: a scene is geometry and the model's own labels,
 * with `SketchNode.block` carrying a block id of the article the visitor is
 * already reading. There is nothing in it about a person, so copying a hundred
 * nested fields by hand would buy a transcription error rather than safety.
 *
 * **`profileHash` is the field to notice going.** It is who the drawing was
 * made for — a hash of the owner's reader profile — and a visitor is looking at
 * a picture drawn for somebody else. The other four absences are the ordinary
 * pipeline ones.
 */
function publicSketch(sketch: Sketch): PublicSketch {
  return {
    title: sketch.title,
    caption: sketch.caption,
    scenes: sketch.scenes,
  };
}

/**
 * The owner's saved searches, run by run and hit by hit.
 *
 * **The filtering is in SQL, not here**, exactly as `publicComments` above says
 * of itself: `PUBLIC_SEARCHES_WHERE` in src/store/public-reader.ts takes
 * finished runs only, so a pending or failed one never reaches this function.
 * Two answers to one question is how the untested one ends up being the one
 * that runs.
 *
 * **`stale` arrives already computed** and is passed through rather than worked
 * out here, because working it out needs the article's fingerprint — which is a
 * fact about the blocks the reader fetched, not about the run. src/store's job;
 * this function's job is the allowlist.
 */
function publicSearches(runs: readonly (SearchRun & { stale: boolean })[]): PublicSearchRun[] {
  return runs.map(
    (run): PublicSearchRun => ({
      id: run.id,
      criterion: run.criterion,
      kind: run.kind,
      createdAt: run.createdAt,
      hits: publicSearchHits(run.hits),
      ...opt(run, "colour"),
      stale: run.stale,
    }),
  );
}

/**
 * **Every hit rebuilt**, though `SearchHit` has nothing in it that is about a
 * person today.
 *
 * That is the point rather than an oversight — the same argument
 * `publicTimeline` makes about `TimelineEvent`. A hit is a block id, the words
 * the model pointed at, how sure it was and why; there is no cost, no model and
 * no URL in it, and it was checked against the type on 2026-09-04. What copying
 * it by hand buys is the *next* field: one added to `SearchHit` for the owner's
 * panel does not cross until somebody adds a line here, which is the whole
 * design of this file.
 *
 * `start` through `opt`, because it is genuinely optional — a disambiguator
 * between repeats of the same words, never the anchor (docs/project/block-ids.md).
 */
function publicSearchHits(hits: readonly SearchHit[]): SearchHit[] {
  return hits.map(
    (hit): SearchHit => ({
      blockId: hit.blockId,
      quote: hit.quote,
      confidence: hit.confidence,
      reasoning: hit.reasoning,
      ...opt(hit, "start"),
    }),
  );
}

/** The ideas, rebuilt idea by idea and occurrence by occurrence. */
function publicIdeas(ideas: Ideas): PublicIdeas {
  return {
    ideas: ideas.ideas.map(
      (idea): Idea => ({
        id: idea.id,
        name: idea.name,
        provenance: idea.provenance,
        statement: idea.statement,
        ...opt(idea, "whyYouNeedIt"),
        ...opt(idea, "analogy"),
        occurrences: idea.occurrences.map((at) => ({
          blockId: at.blockId,
          quote: at.quote,
          reasoning: at.reasoning,
          ...opt(at, "start"),
        })),
      }),
    ),
  };
}

/**
 * **The cross-references, link by link** — since 2026-10-01 (plan 261001b,
 * SPIDERYARN-READING2-5Z).
 *
 * `fresh` is the reader's answer to `isStale` (src/crossrefs-fingerprint.ts),
 * the owner's own question asked of the same inputs; this function projects
 * and does not hash, for `stale`'s reason in `publicSearches`. Not fresh, a
 * document for another slug, or no `links` array: no key at all, which is what
 * the owner's hook draws in those cases too (src/web/useCrossrefs.ts).
 *
 * **Each link is checked, not copied**, because JSONB arrives unchecked (GPT
 * Sol, plan review P2): a record of three strings, both ends blocks of this
 * payload and not the same block, and a phrase whose exact characters are
 * already present in its public source block. Freshness authenticates the
 * article inputs, not the stored model output: without the phrase check, a
 * malformed JSONB row could put arbitrary private text on the public wire while
 * carrying a current `sourceHash`. Anything else is dropped. `dropped`, the
 * counts, and the stamp stay behind.
 */
function publicCrossrefs(
  crossrefs: Crossrefs,
  fresh: boolean,
  slug: string,
  blocks: ReadonlyMap<string, PublicBlock>,
): PublicCrossrefs | undefined {
  const doc: unknown = crossrefs;
  if (!fresh || !isRecord(doc) || doc.slug !== slug || !Array.isArray(doc.links)) return undefined;
  const links: Crossref[] = [];
  for (const link of doc.links as unknown[]) {
    if (!isRecord(link)) continue;
    const { from, phrase, to } = link;
    if (typeof from !== "string" || typeof phrase !== "string" || typeof to !== "string") continue;
    const source = blocks.get(from);
    if (
      phrase.trim() === "" ||
      from === to ||
      source === undefined ||
      !blocks.has(to) ||
      (!source.text.includes(phrase) && !source.html.includes(phrase))
    ) {
      continue;
    }
    links.push({ from: from as BlockId, phrase, to: to as BlockId });
  }
  return { links };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The thread, rebuilt post by post. `limit` crosses; the provenance does not. */
function publicTweets(thread: TweetThread): PublicTweets {
  return {
    limit: thread.limit,
    /* `blocks` crosses when the post has it: the ids of this public article's
       own blocks, which every other public artefact carries too, and what the
       visitor's band links each post back with. */
    tweets: thread.tweets.map((tweet): Tweet => ({
      text: tweet.text,
      chars: tweet.chars,
      ...(tweet.blocks ? { blocks: [...tweet.blocks] } : {}),
    })),
  };
}

/**
 * `GET /api/public/article/:slug`, assembled.
 *
 * **The artefacts are keys of this one response, and that is Greg's
 * decision rather than the design Sol gave.** Four sibling endpoints would each
 * have needed a route, a projection, a reader method, a client hook and a
 * tagged wire result saying whether the artefact exists; folding them in here
 * makes existence a property of the payload — a key that is present exists —
 * with no second request to be in flight, to fail, or to disagree with the
 * first. docs/plans/260827ai-public-read-only-access.md § Slice 1b.
 *
 * `null` in, absent out. The reader hands `null` for a column Postgres had
 * nothing in, and an absent key is what the client reads as *nobody built one*.
 * An artefact that exists and is **empty** — a glossary whose step ran and
 * found no terms — is a present key holding an empty list, and the two must
 * stay different.
 */
export function publicArticle(row: {
  slug: string;
  /**
   * Which way the visitor was let in: `PublicArticle.sharedBy`. The reader
   * works it out from the row the access predicate matched, never from whether
   * the request carried a key. Required, so a caller that forgot is a type
   * error rather than a private link wearing the public notice.
   */
  sharedBy: PublicSharedBy;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  excerpt: string | null;
  journal: string | null;
  /** The owner's string — `publicMeta` sends the calendar day of it, or the year, never this. */
  publishedAt: string | null;
  publishedYear: number | null;
  /** The difficulty rating's three shown columns — `publicMeta` makes one value of them or none. */
  readingLanguage: number | null;
  readingIdeas: number | null;
  readingDifficultyReason: string | null;
  headingTitle: string | null;
  /** Stage 1's post-redirect address — `publicMeta` decides what of it is published. */
  finalUrl: string | null;
  blocks: (Block | PublicBlock)[];
  tree: Tree;
  arc: Arc | null;
  assets: Assets | null;
  glossary: Glossary | null;
  ideas: Ideas | null;
  quotes: Quotes | null;
  tweets: TweetThread | null;
  timeline: Timeline | null;
  skim: Skim | null;
  faq: Faq | null;
  simpleSummary: SimpleSummary | null;
  bibliography: Bibliography | null;
  debate: Debate | null;
  /** Debate's claims list, or `null` for none made. */
  debateClaims: DebateClaimList | null;
  /** The stored cross-references, or `null` for none built. */
  crossrefs: Crossrefs | null;
  /**
   * Whether `crossrefs` still describes this revision — the reader's `isStale`,
   * inverted. Required rather than defaulted, so a caller that forgot to ask
   * is a type error rather than links drawn over an article that moved.
   */
  crossrefsFresh: boolean;
  comments: readonly Comment[];
  searches: readonly (SearchRun & { stale: boolean })[];
  sketch: Sketch | null;
  /** Where the paragraph nav labels are — the column, `not null`, so no `| null`. */
  navLabelStatus: NavLabelStatus;
  /**
   * A `found` guess at an upload's source, or `null` for none — the columns
   * `publicSourceGuessQuery` (src/store/public-reader.ts) selects, **not yet
   * published**: `publicSourceGuess` below is the policy. Required, so a reader
   * that forgot to ask is a type error rather than a banner that never names an
   * upload's source.
   */
  sourceGuess: SourceGuessRow | null;
}): PublicArticle {
  const blocks = row.blocks.map(publicBlock);
  const blocksById = new Map(blocks.map((block): [string, PublicBlock] => [block.id, block]));
  const blockText = new Map(blocks.map((block): [string, string] => [block.id, block.text]));
  const crossrefs =
    row.crossrefs === null
      ? undefined
      : publicCrossrefs(row.crossrefs, row.crossrefsFresh, row.slug, blocksById);
  return {
    /* One of two words, and nothing about the key that was or was not sent. */
    sharedBy: row.sharedBy,
    meta: publicMeta(row),
    blocks,
    tree: publicTree(row.tree),
    ...(row.arc ? { arc: publicArc(row.arc) } : {}),
    /* **Named, not spread**, and passed through whole rather than rebuilt field
       by field like the tree and the arc beside it. Nothing in an `Assets` is
       about a person: the URLs are the publisher's own and are already in the
       `blocks` in this same payload, and the rest of each entry is a hash, a
       format, a byte count, or the reason an image was not stored. The same is
       true of `pdfFigures`, added 2026-09-06 — a page number, an opaque ref
       that is already in the `blocks` here too, dimensions, a hash and a
       bounded reason, and no object key or bucket path anywhere in it.
       GPT Sol, I-9; src/assets.ts § `PdfFigureEntry`.

       `?? undefined` rather than a conditional spread, because
       `PublicArticle.assets` is a required key holding `Assets | undefined` —
       which is what makes leaving this line out a type error instead of a
       public article that silently hot-links every image. See the field's note
       in src/public-types.ts. */
    assets: row.assets ?? undefined,
    /* **Named, and it is a plain assignment rather than a conditional spread**,
       because there is no "absent" reading of it: the column is `not null`, and
       the reader has to be told *which* of the three it is in order to know
       whether to draw the paragraph layer at all. A key that could go missing
       would be a fourth state meaning nothing.

       The enum crosses whole and nothing else does — no reason, no provider
       message, no timestamp. See `PublicArticle.navLabelStatus`. */
    navLabelStatus: row.navLabelStatus,
    /* `!== null` rather than truthiness, on all four. An artefact is an object
       and so always truthy, so the two agree today — but the day one of these
       becomes a value that can be falsy while present, truthiness silently
       reports it as never built. The distinction this payload rests on is
       present-versus-absent, and the test is written to say so. */
    ...(row.glossary !== null ? { glossary: publicGlossary(row.glossary) } : {}),
    ...(row.ideas !== null ? { ideas: publicIdeas(row.ideas) } : {}),
    ...(row.quotes !== null ? { quotes: publicQuotes(row.quotes) } : {}),
    ...(row.tweets !== null ? { tweets: publicTweets(row.tweets) } : {}),
    ...(row.timeline !== null ? { timeline: publicTimeline(row.timeline) } : {}),
    ...(row.skim !== null ? { skim: publicSkim(row.skim) } : {}),
    ...(row.faq !== null ? { faq: publicFaq(row.faq) } : {}),
    ...(isUsableSimpleSummary(row.simpleSummary)
      ? { simpleSummary: publicSimpleSummary(row.simpleSummary) }
      : {}),
    /* Under both keys, the same object, for one deploy: `citations` is the
       one a public tab loaded before 2026-10-09 reads (`PublicArticle.citations`;
       plan 261009w F1, removed by its contract). */
    ...(row.bibliography !== null ? bothBibliographyKeys(publicBibliographyList(row.bibliography, blockText)) : {}),
    /* The article's own address goes in with it: a direct row can carry it in
       its witness and its `linked` signal, and it is judged there by the policy
       `publicMeta` above applies to it. */
    ...(row.debate !== null ? { debate: publicDebate(row.debate, row.finalUrl) } : {}),
    /* `Array.isArray`, not only `!== null`: a document without its `claims`
       is what the owner's read calls none, and a visitor is not sent a list
       their panel could not draw. */
    ...(row.debateClaims !== null && Array.isArray(row.debateClaims.claims)
      ? { debateClaims: publicDebateClaimList(row.debateClaims) }
      : {}),
    ...(row.sketch !== null ? { sketch: publicSketch(row.sketch) } : {}),
    ...(crossrefs === undefined ? {} : { crossrefs }),
    /* **A required key, so leaving this line out is a type error** — unlike the
       artefacts above it, where an absent key is the meaning. An article with
       no comments crosses as `[]`. See PublicArticle.comments. */
    comments: publicComments(row.comments),
    /* A required key too, and for the same reason: an article nobody has
       searched crosses as `[]`, which is a state rather than a missing
       artefact. See PublicArticle.searches. */
    searches: publicSearches(row.searches),
    ...optionalSourceGuess(row.sourceGuess),
  };
}

/** The columns of a `found` `upload_source_guesses` row the public read selects. */
type SourceGuessRow = {
  url: string;
  kind: PublicSourceGuess["kind"];
  matchedBy: PublicSourceGuess["matchedBy"];
};

/**
 * **A guessed source, as a stranger may see it** — plan 261002g § Decisions 3.
 *
 * `url` goes through `publicSourceUrl`, the policy the article's own address
 * gets in `publicMeta`: no credentials, no query, no private host. `host` is
 * then derived from the URL that survived, never copied from the stored
 * `host` column, which no constraint ties to `url` (GPT Sol, plan review
 * P2-1). A refused address publishes nothing at all, as `publicMeta` does.
 */
export function publicSourceGuess(row: SourceGuessRow): PublicSourceGuess | null {
  const url = publicSourceUrl(row.url);
  if (url === null) return null;
  const host = hostOf(url);
  if (host === "") return null;
  return { url, host, kind: row.kind, matchedBy: row.matchedBy };
}

/* A conditional spread, because `exactOptionalPropertyTypes` is on and an
   absent key is what "nothing to say" means here. */
function optionalSourceGuess(row: SourceGuessRow | null): { sourceGuess?: PublicSourceGuess } {
  const guess = row === null ? null : publicSourceGuess(row);
  return guess === null ? {} : { sourceGuess: guess };
}

/**
 * **The authors' names a visitor is already shown**, for the end of a link
 * preview's title (`PublicHead.authors`, src/store/public-reader.ts).
 *
 * A visitor is sent `byline` and never `authors`, so a name is published here
 * only when the public byline already contains it. For a paper the byline is
 * derived from these names, so that is all of them; for a web page with no
 * structured authors it is none, and the page's own free-text byline ("By Jane
 * Doe | Staff reporter") is not clean enough to print in a title. Names only:
 * an affiliation never leaves through this.
 */
export function publicAuthorNames(
  authors: readonly { name: string }[] | null,
  byline: string | null,
): string[] {
  if (authors === null || byline === null) return [];
  return authors.map((a) => a.name).filter((name) => name.trim() !== "" && byline.includes(name));
}
