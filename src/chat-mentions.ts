/**
 * **Other articles of the reader's, brought into a conversation by an
 * @-mention** — the server's two decisions about them. Plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 2 and § 3.
 *
 * - `admitMentions`: may this new question bring these articles in? Run by
 *   the send route before anything is written. Each refusal is a 400 with a
 *   sentence the composer shows, and nothing is silently dropped.
 * - `resolveMentions` / `resolveThreadMentions`: **the one resolver**. Which
 *   articles a stored conversation holds, and which of them can still be read
 *   now — re-checked against the *current* owner and re-measured against the
 *   cap on every turn. Send, retry, edit, the thread GET and the citation
 *   allowlist all go through it, so they cannot disagree.
 *
 * ## Never another reader's article
 *
 * Ownership is decided twice and both times by the owner-scoped seams the rest
 * of the store uses: `articleIdForOwned` / `loadArticle` (both through
 * `ownedSlug`) when a mention is admitted, and the owner-filtered join in
 * `mentionRows` (src/store/pg-chat-mentions.ts) when it is read back. An
 * article that has since changed hands, been deleted, been left unprocessed or
 * grown past the cap resolves to its **stored title only** — no slug, no block
 * ids, no text — and the model is told by that title that it is no longer
 * available.
 *
 * Logs nothing: titles and text are the reader's and an author's words.
 */

import { articleWithIds } from "./article-prompt.js";
import { ChatTurnRefused } from "./chat.js";
import {
  MENTION_MAX_CHARS,
  MENTIONS_MAX_PER_THREAD,
  MENTIONS_THREAD_FULL,
} from "./chat-mention-limits.js";
import { NotProcessed } from "./not-processed.js";
import { chatStore, loadArticle } from "./store/index.js";
import type { MentionRow, MentionToStore } from "./store/contracts.js";
import { articleIdForOwned } from "./store/pg.js";
import { mentionKey } from "./store/pg-chat-mentions.js";
import type {
  Article,
  Block,
  ChatThread,
  MentionedArticleView,
  MentionUnavailableReason,
  Meta,
} from "./types.js";

/**
 * **How long an article is, as a mention.** The length of exactly what the
 * prompt carries for it — `articleWithIds`, the head and every block with its
 * id — so the cap and the bill measure the same thing. The fence around it
 * adds a constant few dozen characters, which the cap does not need to know.
 */
export function mentionPromptChars(meta: Meta, blocks: readonly Pick<Block, "id" | "text">[]): number {
  return articleWithIds(meta, blocks).length;
}

/** A mention as one turn of the conversation sees it. */
export type ResolvedMention =
  | {
      available: true;
      /** The title the reader picked it by — the stored snapshot. */
      title: string;
      slug: string;
      meta: Meta;
      blocks: Block[];
    }
  | { available: false; title: string; reason: MentionUnavailableReason };

/** What the panel is told: the slug and ids only while the article is available. */
export function mentionView(m: ResolvedMention): MentionedArticleView {
  return m.available
    ? { available: true, title: m.title, slug: m.slug, blockIds: m.blocks.map((b) => b.id) }
    : { available: false, title: m.title, reason: m.reason };
}

/** An article read for a mention, or why it could not be. */
type Loaded = { article: Article } | { unreadable: true };

/**
 * Read one of the reader's articles for a mention. **Owner-scoped**:
 * `loadArticle` goes through `ownedSlug`. A minimal paper (`NotProcessed`) and
 * one with no published revision yet (a 404, mid-import) are unreadable rather
 * than errors; anything else — the database down — fails the turn as it would
 * for the open article.
 */
async function readForMention(slug: string): Promise<Loaded> {
  try {
    return { article: await loadArticle(slug) };
  } catch (err) {
    if (err instanceof NotProcessed) return { unreadable: true };
    if ((err as { status?: unknown } | null)?.status === 404) return { unreadable: true };
    throw err;
  }
}

/** Reads shared within one request, so one article mentioned in three threads is read once. */
export type MentionReads = Map<string, Promise<Loaded>>;

function readOnce(reads: MentionReads, slug: string): Promise<Loaded> {
  let found = reads.get(slug);
  if (!found) {
    found = readForMention(slug);
    reads.set(slug, found);
  }
  return found;
}

/**
 * **The rows of one conversation, resolved**, in the order the articles were
 * first mentioned, each article once.
 */
async function resolveRows(
  rows: readonly MentionRow[],
  maxChars: number,
  reads: MentionReads,
): Promise<ResolvedMention[]> {
  const seen = new Set<string>();
  const out: ResolvedMention[] = [];
  for (const row of rows) {
    const key = mentionKey(row.mentionedArticleId, row.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = row.title;
    if (row.mentionedArticleId === null) {
      out.push({ available: false, title, reason: "deleted" });
      continue;
    }
    /* The id is still there but the owner-scoped join found no slug: the
       article exists and is somebody else's now. */
    if (row.ownedSlug === null) {
      out.push({ available: false, title, reason: "not-owned" });
      continue;
    }
    const loaded = await readOnce(reads, row.ownedSlug);
    if ("unreadable" in loaded) {
      out.push({ available: false, title, reason: "not-processed" });
      continue;
    }
    const { meta, blocks } = loaded.article;
    if (mentionPromptChars(meta, blocks) > maxChars) {
      out.push({ available: false, title, reason: "too-long" });
      continue;
    }
    out.push({ available: true, title, slug: row.ownedSlug, meta, blocks });
  }
  return out;
}

export interface ResolveOptions {
  /** The cap, for a test that re-measures without re-extracting. */
  maxChars?: number;
  /** Reads already made in this request (`admitMentions` hands its own on). */
  reads?: MentionReads;
}

/**
 * **The articles a conversation holds at one question**: mentions on that
 * question and every question before it, never after. `upTo` is the user
 * message being answered — on a send the new question, on a retry the one
 * retried, on an edit the one rewritten — and it must be in `thread`.
 */
export async function resolveMentions(
  slug: string,
  thread: Pick<ChatThread, "id" | "messages">,
  upTo: string,
  { maxChars = MENTION_MAX_CHARS, reads = new Map() }: ResolveOptions = {},
): Promise<ResolvedMention[]> {
  const at = thread.messages.findIndex((m) => m.id === upTo);
  if (at < 0) throw new Error("resolveMentions: that message is not in this conversation");
  const before = new Set(thread.messages.slice(0, at + 1).map((m) => m.id));
  const rows = (await chatStore.mentions(slug, thread.id)).filter((r) => before.has(r.messageId));
  return resolveRows(rows, maxChars, reads);
}

/**
 * **Every conversation's mentions on one article**, for the thread GET: one
 * read of the rows, each mentioned article read once. Only threads that have
 * any are in the map.
 */
export async function resolveThreadMentions(
  slug: string,
  { maxChars = MENTION_MAX_CHARS, reads = new Map() }: ResolveOptions = {},
): Promise<Map<string, ResolvedMention[]>> {
  const byThread = new Map<string, MentionRow[]>();
  for (const row of await chatStore.mentions(slug)) {
    const list = byThread.get(row.threadId) ?? [];
    list.push(row);
    byThread.set(row.threadId, list);
  }
  const out = new Map<string, ResolvedMention[]>();
  for (const [threadId, rows] of byThread) out.set(threadId, await resolveRows(rows, maxChars, reads));
  return out;
}

/** "120,000", for a sentence. */
const count = (n: number) => n.toLocaleString("en-GB");

/**
 * **May this new question bring these articles in?** The slugs are already
 * shape-checked and at most `MENTIONS_MAX_PER_QUESTION` (the route). Each is
 * refused with a `ChatTurnRefused` — a 400 whose words the composer shows —
 * when it is:
 *
 * - not one of the reader's articles. Another reader's slug is "not found",
 *   exactly as a slug nobody has, so the refusal says nothing about whether it
 *   exists;
 * - the article open in this conversation;
 * - not readable yet (minimal, or still importing);
 * - over `MENTION_MAX_CHARS`, with its size and the limit;
 * - one more than the conversation may hold.
 *
 * Returns the rows to store — by article id, never the slug — and the reads it
 * made, for the resolver to reuse in the same request.
 */
export async function admitMentions(
  openSlug: string,
  threadId: string,
  slugs: readonly string[],
): Promise<{ mentions: MentionToStore[]; reads: MentionReads }> {
  const reads: MentionReads = new Map();
  const mentions: MentionToStore[] = [];
  const named = new Set<string>();
  for (const slug of slugs) {
    if (named.has(slug)) continue;
    named.add(slug);
    if (slug === openSlug) {
      throw new ChatTurnRefused(
        "That is the article you have open, so it is already part of this conversation.",
      );
    }
    let articleId: string;
    try {
      articleId = await articleIdForOwned(slug);
    } catch (err) {
      if ((err as { status?: unknown } | null)?.status === 404) {
        throw new ChatTurnRefused("One of the articles you mentioned is not on your shelf any more.");
      }
      throw err;
    }
    const loaded = await readOnce(reads, slug);
    if ("unreadable" in loaded) {
      throw new ChatTurnRefused(
        "One of the articles you mentioned has not been read through yet, so it cannot be brought into a conversation.",
      );
    }
    const { meta, blocks } = loaded.article;
    const title = meta.title || slug;
    const chars = mentionPromptChars(meta, blocks);
    if (chars > MENTION_MAX_CHARS) {
      throw new ChatTurnRefused(
        `"${title}" is too long to bring in whole: it is about ${count(chars)} characters, and the limit is ${count(MENTION_MAX_CHARS)}.`,
      );
    }
    mentions.push({ articleId, title });
  }
  /* The conversation's limit, read outside the store's lock for the sentence
     and the fast refusal. `chatStore.begin` decides it again inside its
     transaction, with the same words. */
  if (mentions.length > 0) {
    const held = new Set(
      (await chatStore.mentions(openSlug, threadId)).map((r) => mentionKey(r.mentionedArticleId, r.title)),
    );
    for (const m of mentions) held.add(mentionKey(m.articleId, m.title));
    if (held.size > MENTIONS_MAX_PER_THREAD) throw new ChatTurnRefused(MENTIONS_THREAD_FULL);
  }
  return { mentions, reads };
}
