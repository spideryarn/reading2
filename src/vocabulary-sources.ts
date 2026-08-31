/**
 * **Where the words come from.** Everything that decides *what to prime a
 * speech model with*, for any box in this app that takes dictation.
 *
 * Three files, and the split is the reusable part:
 *
 * - [`vocabulary.ts`](./vocabulary.ts) is **pure** — `properNouns`, `proseOf`,
 *   `pack`, `SITE_TERMS`. No store, no network, no model. That is what lets the
 *   eval run the real extractor over real articles.
 * - **this file** turns a *place* into a list of words: the store reads, the
 *   ranking, the caps, the priority order.
 * - [`transcribe.ts`](./transcribe.ts) does the model call and takes a
 *   vocabulary as a string, so it never needs to know any of this.
 *
 * ## Nothing here calls a model
 *
 * The whole list is assembled by script — a constant, three small reads, one
 * article read, a sort, a de-duplicate and a cap. The one part of it a model
 * wrote is the **glossary**, and that was written once by pipeline stage 6 and
 * stored as an artefact; this reads it. Greg's own fallback was to have a model
 * write and store a term list per article, and stage 6 already writes one, so
 * asking again would pay twice for a worse copy.
 * docs/plans/dictation-vocabulary.md.
 *
 * Nothing is cached but the one expensive read — {@link NAMES}, the article's
 * blocks. The other three are single rows, and one of them (`purpose`) is a
 * field the reader edits, so caching it would serve them their own stale
 * sentence.
 *
 * ## Adding a place that takes dictation
 *
 * Add a `kind` to {@link Where}, add a line to {@link RECIPES} naming the
 * sources it wants in the order the cap should spend on them, and teach
 * {@link parseWhere} to accept it. Nothing else changes — not the model call,
 * not the fence, not the client. A source that has nothing to say in a given
 * place returns `[]` rather than being conditionally skipped, so a recipe is
 * only ever a list of names.
 *
 * Adding a *source* is one entry in {@link SOURCES}: a name and an async
 * function from a `Where` to terms. It must never throw — see below.
 *
 * ## Best-effort, and it must stay that way
 *
 * Every read is wrapped and returns `[]` on failure. A reader who talks for a
 * minute and is then told "no glossary for this article" has lost a minute to
 * something that was never the point. The cost of a failed source is a slightly
 * worse transcript, which is exactly the shape
 * docs/reusable/silent-success.md warns about — so the tests here assert on the
 * *term list*, not on anything downstream of it.
 */
import { currentOwnerId } from "./owner.js";
import { loadArticle, loadGlossary, readerStore, shelfStore } from "./store/index.js";
import { SITE_TERMS, packTerms, phrases, properNouns, proseOf } from "./vocabulary.js";
import { isSlug } from "./ingest.js";

/**
 * Where the reader is dictating, which is the only thing the client has to
 * know. Everything else about the vocabulary is decided here.
 *
 * **Never the vocabulary itself.** A vocabulary accepted from a client is a
 * string a caller chooses landing in a model prompt, which is a prompt-injection
 * surface built on purpose for no gain — the server has the glossary already.
 */
export type Where =
  /** Into one of the profile boxes. Their own words are the best hint we have. */
  | { kind: "profile" }
  /** Into a box with an article in scope — chat, a comment follow-up. */
  | { kind: "article"; slug: string };

/**
 * The first `max` characters, cut at a space.
 *
 * A truncated word is a spelling the transcriber may go looking for, so the
 * last thing in the list is a whole word or nothing.
 */
function slice(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > 0 ? cut.slice(0, space) : cut;
}

/** The article this place is about, or `null` where there is not one. */
function slugOf(where: Where): string | null {
  return where.kind === "article" ? where.slug : null;
}

/**
 * The whole of what the vocabulary may cost.
 *
 * A cap in characters rather than terms, because a glossary of forty short
 * names and one of forty long ones are not the same purchase. Enough for a
 * substantial glossary, small beside the audio.
 */
const MAX_VOCABULARY = 2_000;

/**
 * How much of the budget the reader's profile may take.
 *
 * **`MAX_PROFILE_CHARS` is 1,500** (src/types.ts) and the whole vocabulary is
 * 2,000, so a reader who fills their profile in would have crowded out the
 * glossary and every proper noun behind it — the sources measured to be worth
 * the most. The eval never saw this because the test profile is 62 characters.
 * GPT Sol's review, item 6.
 *
 * A slice rather than a smaller profile: the profile is prose written for other
 * prompts, and the first sentences of "who I am and what I read" are where the
 * jargon is. The slice is then cut into {@link phrases}, **and for a day it was
 * not** — so `pack`'s 80-character rule for one term applied to the whole
 * paragraph and everything past it was thrown away in silence. Every fixture
 * anybody had written was shorter than eighty characters, so nothing saw it.
 *
 * **This source is a hypothesis, not a measurement.** No clip in the eval says
 * anything only the profile could supply, so the one run that isolated it is
 * uninformative rather than positive or negative. It stays because it is cheap
 * and the mechanism is plausible; docs/plans/dictation-vocabulary.md § Open
 * questions has the ten-call experiment that would settle it.
 */
const MAX_PROFILE_IN_VOCABULARY = 400;

/** The reader's own words, if they have written any. Never a reason to fail. */
async function profileTerms(): Promise<string[]> {
  try {
    /* Their prose rather than a term list, and that is the point: the jargon a
       reader is about to dictate is the jargon already in the box about
       themselves, spelled the way they spell it. */
    const profile = await readerStore.readProfile();
    if (!profile) return [];
    return phrases(slice(profile, MAX_PROFILE_IN_VOCABULARY));
  } catch {
    return [];
  }
}

/**
 * How much of the budget the reader's "why this one" may take.
 *
 * `MAX_PURPOSE_CHARS` is 600 (src/types.ts) and it gets less room than the
 * profile's 400 for a reason that is not importance: this box is one or two
 * sentences about *this* article, so the jargon in it is near the front, while
 * the profile is a paragraph of career and the sentence about their field may
 * be anywhere in it.
 */
const MAX_PURPOSE_IN_VOCABULARY = 300;

/**
 * "Why you're reading this one" — the box on the Metadata page.
 *
 * **The reader's own words about the article they are about to talk about**,
 * which is as close as anything in this app gets to knowing what they are
 * going to say. Somebody who wrote *"checking whether Fowler's
 * Alimentiveness stuff predates Broca"* and then presses the microphone is
 * likely to say those words out loud within the minute, and they are spelled
 * there the way that reader spells them.
 *
 * Ranked above the global profile because it is about this article, and below
 * nothing but the app's own words. Same shape as {@link profileTerms}, same
 * word-boundary cut, same refusal to be a reason the dictation fails.
 *
 * **Measured, and it is the strongest source in the table**: on the one clip
 * whose terms live only in this box, hard-term recall goes from 5/20 to 20/20 —
 * `Anjali Chaudhuri` against *Angeli Chowdhury* on every run without it, and
 * the reader's own `-ise` spelling kept, which nothing else managed.
 * evals/dictation/; the table is in docs/plans/dictation-vocabulary.md.
 *
 * Not cached, deliberately: this is a field the reader edits, and a cache would
 * serve them their own stale sentence.
 */
async function purposeTerms(slug: string): Promise<string[]> {
  try {
    const { purpose } = await shelfStore.read(slug);
    if (!purpose) return [];
    return phrases(slice(purpose, MAX_PURPOSE_IN_VOCABULARY));
  } catch {
    return [];
  }
}

/** The article's glossary terms, most central first, with their aliases. */
async function glossaryTerms(slug: string): Promise<string[]> {
  try {
    const found = await loadGlossary(slug);
    return [...(found.glossary?.entries ?? [])]
      /* **Most central first, because the cap bites.** Stage 6 scores every
         entry for how central it is to the piece; unranked, a long glossary
         cut at 2,000 characters keeps whichever terms the model happened to
         emit first, which is nothing to do with what the reader will say. */
      .sort((a, b) => (b.centrality ?? 0) - (a.centrality ?? 0))
      .flatMap((entry) => [entry.name, ...entry.aliases]);
  } catch {
    /* No glossary, no article, or a store having a moment. The transcript is a
       little worse and the dictation still works, which is the trade every read
       in here is making. */
    return [];
  }
}

/**
 * How many of the article's own names to add. Not a budget — {@link pack} is the
 * budget — but a limit on how far down the frequency list is worth going.
 *
 * The published guidance and the one measurement of it both point at the same
 * band. The Whisper rare-word study (arXiv 2502.11572) tested biasing lists of
 * 35, 70 and 150 words and found rare-word errors rising with size, since the
 * longer list is mostly words the speaker did not say; it recommends about 70.
 * Deepgram, whose cap is 500 tokens, recommends 20–50 terms. Nobody has
 * published anything at all for a term list in a chat prompt to Gemini, which
 * is what we do, so this is 40 on top of a glossary — landing the whole list in
 * the 35–60 term range those two agree on.
 */
const MAX_NAMES = 40;

/**
 * `${owner}:${slug}` → the names in that article.
 *
 * **Keyed by owner as well as slug**, and that is not defensive tidiness:
 * `articles.slug` is globally unique but ownership is not, so a cache on the
 * slug alone would hand one reader the proper nouns out of another reader's
 * article — a small leak, and the sort that no test looks for. src/owner.ts.
 *
 * The extraction itself is a few milliseconds; what this saves is
 * `loadArticle`, which ships every block. Bounded, and it may be empty at any
 * moment — a serverless instance is cold more often than not, and the cost of a
 * miss is one store read the reader is already waiting through.
 */
const NAMES = new Map<string, string[]>();
const MAX_CACHED = 32;

/**
 * How long any one source may hold the transcription up.
 *
 * **Every source, not just the slow one.** The article read ships every block
 * and was bounded from the start; the three small reads were not, on the
 * reasoning that a row is a row. But a row is a row *when the database is
 * well*: Postgres's default statement timeout is two minutes
 * (docs/project/database.md), the 90-second transcription timeout is only
 * created after the vocabulary is built, and `Promise.all` waits for the
 * slowest — so one sick row could have held a reader on a spinner for longer
 * than the whole transcription is allowed to take. GPT Sol's second review,
 * item 5.
 *
 * The whole round trip is ~2 seconds, so a store having a bad minute must not
 * turn dictation into a six-second wait for a slightly better transcript.
 *
 * **A losing read is not cancelled** — it goes on and fills the cache, so the
 * reader pays it once and the next press of the microphone has the names.
 * Degrading and being slow are different failures.
 */
const SOURCE_DEADLINE_MS = 1_500;

/**
 * The source's answer, or nothing if it takes too long.
 *
 * No `.catch`, and none is needed: every source swallows its own failures and
 * resolves to `[]`, so the losing promise can never become an unhandled
 * rejection. `unref` so a pending timer never holds a process open.
 */
function within(work: Promise<readonly string[]>): Promise<readonly string[]> {
  return Promise.race([
    work,
    new Promise<readonly string[]>((resolve) => {
      setTimeout(() => resolve([]), SOURCE_DEADLINE_MS).unref?.();
    }),
  ]);
}

/**
 * The article's title, its author, and its own names — the people cited, the
 * books, the institutions.
 *
 * **The glossary does not carry any of this and is not supposed to.** It names
 * the concepts a reader needs defining; a reader dictating about the Noema
 * piece says "Hinton" and "Ex Machina", and neither is a concept the article
 * introduces. They are the reason the `fowler-names` clip stopped losing
 * `Alimentiveness`; the measurement is `evals/dictation/` and the numbers are
 * in docs/plans/dictation-vocabulary.md, so a re-run has one place to update.
 *
 * The title and byline are here because **this read is already being made** for
 * the names. docs/project/dictation.md called their absence a cost for one day,
 * on the reasoning that the only reads carrying a title ship every block —
 * which was true, and stopped being true the moment we started shipping every
 * block anyway.
 */
async function readArticleTerms(slug: string): Promise<string[]> {
  let owner = "cli";
  try {
    owner = currentOwnerId();
  } catch {
    /* Outside a request — the CLI, a test. Its own bucket, never shared with a
       real owner's. */
  }
  const key = `${owner}:${slug}`;
  const cached = NAMES.get(key);
  if (cached) return cached;
  try {
    const article = await loadArticle(slug);
    const terms = [
      article.meta?.title,
      article.meta?.byline,
      ...properNouns(proseOf(article.blocks), MAX_NAMES),
    ].filter((t): t is string => Boolean(t));
    if (NAMES.size >= MAX_CACHED) NAMES.delete(NAMES.keys().next().value as string);
    NAMES.set(key, terms);
    return terms;
  } catch {
    return [];
  }
}

/**
 * Which sources exist, by name.
 *
 * Each returns the terms it has for a place, and `[]` where it has none — so a
 * recipe is a list of names rather than a list of conditions. **None of them
 * may throw**; each wraps its own read.
 *
 * Declared here and exported as {@link SOURCES} below, only so that
 * {@link SourceName} can be derived from these keys.
 */
const SOURCE_LIST = {
  /** The app's own words. Small, flat, always. */
  site: async () => SITE_TERMS,
  /** "Why you're reading this one", the Metadata page's box. */
  purpose: async (where: Where) => {
    const slug = slugOf(where);
    return slug ? purposeTerms(slug) : [];
  },
  /** "About you", the reader's global profile. */
  profile: () => profileTerms(),
  /** Stage 6's entries, most central first, with their aliases. */
  glossary: async (where: Where) => {
    const slug = slugOf(where);
    return slug ? glossaryTerms(slug) : [];
  },
  /** The article's title, its author, and its own proper nouns. */
  names: async (where: Where) => {
    const slug = slugOf(where);
    return slug ? readArticleTerms(slug) : [];
  },
} satisfies Record<string, (where: Where) => Promise<readonly string[]>>;

/**
 * A source's name, as a recipe may spell it.
 *
 * **A type rather than a runtime check, because the failure is silent.** A
 * recipe naming a source that does not exist would drop that source and return
 * a slightly worse vocabulary, with nothing anywhere saying so —
 * docs/reusable/silent-success.md. Deriving the name from the map makes a typo
 * a compile error instead.
 */
export type SourceName = keyof typeof SOURCE_LIST;

export const SOURCES: Record<SourceName, (where: Where) => Promise<readonly string[]>> =
  SOURCE_LIST;

/**
 * What each place asks for, **in the order the cap should spend on it**.
 *
 * The order is the whole design. `pack` stops at 2,000 characters rather than
 * skipping ahead to a later short term, so what falls off the end should be
 * what the reader is least likely to say. Each source was added one at a time
 * over ten clips and five runs and each one moved hard-term recall; nothing was
 * ever invented at any size, and the one thing that hurt was a vocabulary aimed
 * at the *wrong* article. The table, the noise floor and the caveats are in
 * docs/plans/dictation-vocabulary.md § Results — one place, so a re-run has one
 * place to update. A number copied into a comment outlives the run that
 * produced it.
 *
 * A new place gets a line here and nothing else.
 */
export const RECIPES: Record<Where["kind"], readonly SourceName[]> = {
  /* No article in scope, so the three article sources would return `[]`
     anyway; naming only the two that can answer saves two calls rather than
     changing the result. */
  profile: ["site", "profile"],
  article: ["site", "purpose", "profile", "glossary", "names"],
};

/**
 * The words this reader is likely to be about to say.
 *
 * All of a place's sources are started at once, so the reader waits for the
 * slowest rather than for their sum, and `pack` then applies the priority order
 * to whatever came back. Every one of them is bounded by
 * {@link SOURCE_DEADLINE_MS}, so the vocabulary can be worse but it cannot be
 * slow.
 */
export async function vocabularyFor(where: Where): Promise<string> {
  return (await vocabularyTermsFor(where)).join(", ");
}

/**
 * The same words, as the list they were before anything joined them.
 *
 * Live conversation needs the array: OpenAI's realtime transcription takes a
 * jargon list as `keywords`, and **that field is not merely a nicer shape, it
 * is the fix for a real bug.** With the list in `prompt` instead,
 * `gpt-4o-transcribe` reads the whole vocabulary back as a transcript whenever
 * it is handed non-speech — measured on 2026-08-31, and the thing Greg noticed
 * in the first real conversation. `keywords` is documented as a hint that must
 * only appear if it was actually said, and on noise it invents nothing.
 * evals/live/hallucination-on-noise.mts, docs/plans/live-conversation.md.
 */
export async function vocabularyTermsFor(where: Where): Promise<string[]> {
  const wanted = RECIPES[where.kind];
  const lists = await Promise.all(wanted.map((name) => within(SOURCES[name](where))));
  return packTerms([...lists], MAX_VOCABULARY);
}

/**
 * The client's `where`, checked.
 *
 * `isSlug` and not a looser check: this string is about to be used to read from
 * the store, and every other slug in this app goes through the same gate.
 */
export function parseWhere(x: unknown): Where | null {
  if (typeof x !== "object" || x === null) return null;
  const where = x as { kind?: unknown; slug?: unknown };
  if (where.kind === "profile") return { kind: "profile" };
  if (where.kind === "article" && typeof where.slug === "string" && isSlug(where.slug)) {
    return { kind: "article", slug: where.slug };
  }
  return null;
}
