/**
 * **The article, as a prompt block — in one place, so the bytes are one thing.**
 *
 * Prompt caching matches a *byte-exact* prefix. Not a similar prefix, not the
 * same article rendered two reasonable ways: the same bytes. That single fact
 * is why this module exists, because before it there were three hand-written
 * copies of the same function — `renderArticle` in src/search.ts,
 * src/explain.ts and src/converse.ts — and they had already drifted apart in
 * two ways, one of them fatal.
 *
 * See docs/plans/prompt-caching.md and docs/research/prompt-caching-callsites.md.
 *
 * ## The marker that was in the wrong place
 *
 * Two of those copies wrote the reader's position *into the article body*:
 *
 * ```ts
 * `[${i}]${b.id === at ? " ←READER IS HERE" : ""} ${b.id}: ${b.text}`
 * ```
 *
 * So the article's bytes changed every time the reader scrolled, and changed
 * again for every sentence they selected. `explain` never sent the same article
 * twice in its life. A cache breakpoint added on top of that would have been
 * worse than none: every call pays the 1.25× write premium and none ever
 * collects the 0.1× read.
 *
 * **The position is not part of the article.** It is part of the question, and
 * it now travels in the varying suffix — one line after this block naming the
 * block id. The model is told the same thing; the article stays identical.
 *
 * This is the failure mode from docs/reusable/silent-success.md in its purest
 * form: the field would be present, the code would look cached, and the bill
 * would go up. Nothing would have been red.
 *
 * ## Why the URL line is here for everyone
 *
 * src/search.ts's copy omitted `URL:`; the other two had it. Harmless in
 * itself — search sends no web tool, so it has no use for a URL — but a head
 * that differs by one line is a prefix that does not match. The three now share
 * one head, which costs search a handful of tokens and buys the only thing that
 * matters here.
 */
import type { Block, Meta } from "./types.js";

/**
 * One part of a multi-part message, as OpenRouter's Chat-Completions-shaped API
 * wants it.
 *
 * `cache_control` on a part is the **explicit** breakpoint: everything from the
 * start of the request through this part is the cached prefix. It is the form
 * search and explain need, because both have a long stable article followed by
 * a short varying question, and only an explicit boundary puts the line in the
 * right place. Converse uses the automatic top-level form instead — see
 * docs/research/prompt-caching-openrouter.md.
 */
interface TextPart {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/** A message with either a plain string body or an array of parts. */
export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | TextPart[];
}

/**
 * The head every article block starts with.
 *
 * Optional fields are dropped rather than emitted empty, so an article with no
 * byline does not carry a blank `BY:` line — but the *order* is fixed, because
 * a head assembled in a different order is a different prefix.
 */
function head(meta: Meta): string {
  return [
    `TITLE: ${meta.title}`,
    meta.byline ? `BY: ${meta.byline}` : null,
    meta.siteName ? `PUBLISHED IN: ${meta.siteName}` : null,
    meta.url ? `URL: ${meta.url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The article for prompts whose answers cite blocks by id — search, explain and
 * converse.
 *
 * Every block carries its index and its id. **Nothing here depends on the
 * call**: no reading position, no selection, no timestamp. That is the whole
 * contract of this function, and `tests/article-prompt.test.ts` holds it to it.
 */
export function articleWithIds(meta: Meta, blocks: Block[]): string {
  const body = blocks.map((b, i) => `[${i}] ${b.id}: ${b.text}`).join("\n\n");
  return `${head(meta)}\n\n---\n\n${body}`;
}

/**
 * The article for prompts whose answers must **not** cite blocks — the arc, the
 * tweet thread, the glossary, and a whole-article summary.
 *
 * Bare block text, no ids and no tags, because those stages ask for prose about
 * the piece rather than pointers into it, and an id in the prompt is an
 * invitation to put one in the answer.
 *
 * **These four stages produce the same bytes for the same article, and that is
 * the point.** Before this they each built the string themselves — the same
 * one-line formula, copy-pasted three times, wrapped in three different sets of
 * headings. Identical enough to look shared, different enough to share nothing.
 * A cache needs the bytes, not the intention.
 *
 * `meta` is nullable because a stage may run before extraction has a title.
 */
export function articleText(meta: Meta | null, blocks: Block[]): string {
  const body = blocks
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");
  const title = meta?.title ? `TITLE: ${meta.title}` : null;
  const lines = [
    title,
    meta?.byline ? `BY: ${meta.byline}` : null,
    meta?.siteName ? `PUBLISHED IN: ${meta.siteName}` : null,
  ].filter(Boolean);
  const front = lines.length > 0 ? `${lines.join("\n")}\n\n---\n\n` : "";
  return `${front}${body}`;
}

/**
 * Where the reader is, as a line for the *suffix* — never for the body.
 *
 * Kept next to `articleWithIds` on purpose. The two belong to one decision, and
 * splitting them across files is how the marker would find its way back into
 * the body a year from now.
 */
export function readerPositionLine(blockId: string | undefined): string {
  return blockId ? `The reader is currently at block ${blockId}.` : "";
}

/**
 * A rough token count, for deciding whether a block is worth marking at all.
 *
 * Four characters per token is the usual English estimate and it is what the
 * rest of this repo assumes. It is deliberately *not* exact: the only decision
 * it feeds is "is this comfortably over the floor", and a call that needs
 * precision here is a call that should not be relying on a guess.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sonnet 5's minimum cacheable prefix.
 *
 * **This is a property of the model, not of us.** Below it a `cache_control`
 * marker is accepted and does nothing — no error, and zeros in both usage
 * fields. Opus 5 needs 512, Haiku 4.5 needs 4,096, and the progression is not
 * monotonic across generations, so anything that edits src/models.ts should
 * look here. See docs/research/prompt-caching-anthropic.md § 2.
 */
export const CACHE_FLOOR_TOKENS = 1_024;

/**
 * True when marking this block would silently buy nothing.
 *
 * Callers **log** this rather than throwing. A short article is a perfectly
 * good article; it just cannot be cached, and the right response to that is a
 * line in the log saying so — not a failed request. The reason it needs saying
 * out loud at all is that the alternative is zeros in the usage fields that
 * look exactly like a cache that has stopped working.
 */
export function underCacheFloor(text: string): boolean {
  return estimateTokens(text) < CACHE_FLOOR_TOKENS;
}

/**
 * The text a request is actually asking to have cached.
 *
 * **Everything from the top of the request through the marked part** — not just
 * the marked part itself. That distinction is the whole of this function, and
 * getting it wrong is not theoretical: the first version measured only the
 * marked block, and a 893-token article whose request cached 2,056 tokens
 * happily reported `tooShortToCache: true` while the cache was working
 * perfectly. The system prompt sits in front of the article and counts towards
 * the floor, because the provider matches the prefix from byte zero.
 *
 * A false "too short" is the costly direction to be wrong in: it is an alarm
 * that fires when nothing is wrong, and an alarm nobody believes is worse than
 * no alarm.
 *
 * **It still under-counts, and deliberately.** Tools are rendered ahead of both
 * system and messages, so explain's and converse's real prefixes are larger
 * than anything visible from here — this walks messages only. That errs the
 * safe way (it can say "too short" about something long enough, never the
 * reverse), but it means the result is a *hint* for a log line and not a
 * measurement. Anything that needs the true number should read
 * `cache_creation_input_tokens` off the response, which is the provider's own
 * count of exactly this. Raised by GPT Sol's review, 2026-08-26. So where the boundary is not explicit — converse uses OpenRouter's
 * automatic mode, which marks a block we never name — this returns *all* the
 * message text, which errs towards "long enough" rather than towards crying
 * wolf.
 */
export function cachedText(messages: OpenRouterMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      parts.push(m.content);
      continue;
    }
    for (const p of m.content) {
      parts.push(p.text);
      // The prefix ends here: nothing after a breakpoint is part of it.
      if (p.cache_control) return parts.join("\n");
    }
  }
  return parts.join("\n");
}
