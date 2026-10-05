/**
 * How long the article takes to read, stated once.
 *
 * It lives in a module of its own because two things now say it out loud — the
 * masthead over an article you are already reading (src/web/Masthead.tsx), and
 * the library card you decide from before you open it (src/library-scalars.ts). Those run
 * on opposite sides of the wire, so nothing would ever have told us they had
 * drifted: the card would say 47 min, the masthead 54, and both would look
 * perfectly reasonable on their own page. See docs/reusable/silent-success.md.
 *
 * No dependencies, deliberately — the client imports this too, so it must not
 * pull in anything node-side.
 */

/**
 * Words per minute: the average for an adult reading English non-fiction
 * silently, from Brysbaert's 2019 meta-analysis of 190 studies (J. Memory and
 * Language 109). It was 230, "the middling end of the usual 200–250 range",
 * until 2026-10-05 — a fair folk number; this one has a source.
 *
 * **The starting rate, not always the one used.** A piece a model has rated
 * for difficulty has its minutes multiplied (`difficultyMultiplier`, below);
 * an unrated one is read at this rate flat. Either way it knows nothing about
 * who is reading. The research behind both:
 * docs/research/261005a-reading-time-estimates-and-text-difficulty.md.
 */
export const WPM = 238;

/**
 * The ends of the range the same paper gives: "most adults fall in the range of
 * 175 to 300 wpm" for non-fiction. The card that explains the estimate says
 * this range out loud (src/web/ReadTimeCard.tsx), because reading pace varies
 * between readers as well as between texts.
 */
export const WPM_QUICK = 300;
export const WPM_SLOW = 175;

/** One step of either difficulty scale: 1 is easiest, 5 hardest. */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

/**
 * **How hard the piece is to read, on two scales**, because they come apart:
 * Greg's example is a book in "fairly simple language for complex ideas"
 * (spya-jew7ds). A model rates both when the piece is imported
 * (src/reading-difficulty.ts); the numbers each level stands for are below.
 */
export interface ReadingDifficulty {
  /** Vocabulary and sentences. 3 is ordinary adult non-fiction. */
  language: DifficultyLevel;
  /** How much there is to work out. 1 is nothing new to hold. */
  ideas: DifficultyLevel;
}

/**
 * **The rating as a screen needs it**: the two levels and the model's one
 * sentence saying why. The owner's article and a visitor's both carry exactly
 * this (`Meta.readingDifficulty`, `PublicMeta.readingDifficulty`), so the two
 * show the same minutes. Which model rated it, and when, are stored beside it
 * and are not here: `StoredReadingDifficulty` in src/types.ts.
 */
export type RatedDifficulty = ReadingDifficulty & { reason: string };

export function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/**
 * **A rating off three stored values, or null when they are not one.** Every
 * read that shows a rating builds it here (the owner's article and the shelf
 * in src/store/pg.ts, a visitor's in src/public/dto.ts), so the three cannot
 * disagree about what counts. Null rather than a guess for a level outside 1
 * to 5 or a blank sentence: the piece then reads at the flat rate and its card
 * says it has not been rated, which is true of a rating we cannot use.
 */
export function ratedDifficultyOf(stored: {
  language: unknown;
  ideas: unknown;
  reason: unknown;
}): RatedDifficulty | null {
  const { language, ideas, reason } = stored;
  if (!isDifficultyLevel(language) || !isDifficultyLevel(ideas)) return null;
  if (typeof reason !== "string" || reason.trim() === "") return null;
  return { language, ideas, reason };
}

/**
 * **How much longer each level takes than the reading `WPM` describes**, one
 * table per scale, multiplied together.
 *
 * **These numbers are provisional.** They are our choice of steps, informed by
 * studies of how reading rate falls with word length and with conceptual load.
 * No study measures a model's rating against reading time and none gives five
 * levels. The sources, the quotes and the arithmetic are in
 * docs/investigations/261005b-reading-time-difficulty-multiplier-coefficients-and-where-the-rating-comes-from.md.
 *
 * **The neutral case is language 3, ideas 2**: ordinary adult non-fiction that
 * explains a few ideas as it goes. That is what we take 238 words a minute to
 * describe, and it multiplies to exactly 1.
 *
 * Multiplying the two is an assumption: "ideas" is meant as the slowdown left
 * over once the words are accounted for. A model asked for both may count one
 * thing twice, and nothing here shows it does not.
 */
export const LANGUAGE_FACTOR: Record<DifficultyLevel, number> = {
  1: 0.88,
  2: 0.92,
  3: 1.0,
  4: 1.08,
  5: 1.17,
};
export const IDEAS_FACTOR: Record<DifficultyLevel, number> = {
  1: 0.95,
  2: 1.0,
  3: 1.05,
  4: 1.12,
  5: 1.2,
};

/**
 * The furthest the multiplier may go either way. The tables' own corners are
 * inside these (0.836 and 1.404), so today they change nothing: they are here
 * so a later edit to one cell cannot quietly take the estimate outside them.
 */
export const DIFFICULTY_FLOOR = 0.8;
export const DIFFICULTY_CEILING = 1.45;

/** What to multiply the flat minutes by. Exactly 1 for a piece nobody has rated. */
export function difficultyMultiplier(rating?: ReadingDifficulty): number {
  if (!rating) return 1;
  const product = LANGUAGE_FACTOR[rating.language] * IDEAS_FACTOR[rating.ideas];
  return Math.min(DIFFICULTY_CEILING, Math.max(DIFFICULTY_FLOOR, product));
}

/**
 * **The multiplier goes in before the rounding and before the one-minute
 * floor.** 360 words at the hardest rating is 2 minutes; multiplying the
 * already-rounded flat figure would say 3.
 */
function minutesAt(words: number, wpm: number, rating?: ReadingDifficulty): number {
  return Math.max(1, Math.round((Math.max(0, words) / wpm) * difficultyMultiplier(rating)));
}

/** Never zero: a two-line article still takes a moment to read. */
export function readingMinutes(words: number, rating?: ReadingDifficulty): number {
  return minutesAt(words, WPM, rating);
}

/**
 * The minutes a quick and a slow reader would take: `quick` ≤ `readingMinutes`
 * ≤ `slow`, for the same rating. The range is what is known about readers in
 * general with the piece's adjustment applied to it, not a measurement of
 * this piece.
 */
export function readingRange(
  words: number,
  rating?: ReadingDifficulty,
): { quick: number; slow: number } {
  return { quick: minutesAt(words, WPM_QUICK, rating), slow: minutesAt(words, WPM_SLOW, rating) };
}
