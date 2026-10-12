/**
 * **The limits on bringing other articles into a conversation**, each one
 * constant, and the words the reader is told when one is reached. A leaf, so
 * the store (which enforces both caps inside `begin`'s transaction) and the
 * route (which refuses first, with the sentence) share one number.
 *
 * Plan docs/plans/261012d-chat-at-mention-your-own-articles.md § 3, "The cap".
 */

/**
 * **Per article: 120,000 characters of the article as the prompt carries it**
 * (`mentionPromptChars`, src/chat-mentions.ts), about 42,000 tokens at this
 * repo's measured 0.35 tokens a character. Measured on production 2026-10-12:
 * of 160 articles the median is 28k characters and 7 (4%) are over this.
 * Per article rather than a thread total, so a second paper is never refused
 * because of the first.
 */
export const MENTION_MAX_CHARS = 120_000;

/** At most this many articles named by one question. */
export const MENTIONS_MAX_PER_QUESTION = 3;

/** The reader-facing refusal when one question names too many articles. */
export const MENTIONS_QUESTION_FULL = `You can bring in at most ${MENTIONS_MAX_PER_QUESTION} articles with one question.`;

/** At most this many distinct articles brought into one conversation, ever. */
export const MENTIONS_MAX_PER_THREAD = 3;

/** The reader-facing refusal when a conversation is full. Fixed words, none of the reader's. */
export const MENTIONS_THREAD_FULL = `This conversation already has ${MENTIONS_MAX_PER_THREAD} other articles brought into it, which is the most it can hold. Start a new conversation to bring in a different one.`;
