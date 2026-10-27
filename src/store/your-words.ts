/**
 * **`your-words.md` — what the reader put into one article, as one Markdown
 * file**: their title and purpose, their tags, their comments and notes in
 * article order, their quiz answers, and every conversation they had about it.
 *
 * > Provide a way to export the user's input/content from an article.
 * >
 * > — Greg, 2026-10-19 (`spya-p88dcx`)
 *
 * The zip already carries all of it as JSON (docs/project/export.md), mixed in
 * with the model's augmentations and readable only by a program. This is the
 * same words for a person, or for pasting into another AI. It is built from
 * the same owner-scoped, one-snapshot walk as the zip (`readArticleRows`), so
 * it cannot see another reader's rows and cannot disagree with the zip it
 * also sits inside. Served on its own by `GET /api/export/:slug/your-words`
 * (src/routes.ts § `sendYourWords`).
 *
 * **What the model wrote is marked as the model's** wherever it sits beside
 * the reader's: an answer under a comment, the mark on a quiz answer, the
 * Spideryarn turns of a conversation. Nothing here is rendered by us — it is a
 * download — so there is no markup boundary to escape at.
 *
 * The Skim briefs the reader added ride with the title and purpose (plan
 * 261027d): each is a *why you're reading*, asked again.
 *
 * Left out for now, and in the zip as JSON: searches, glossary look-ups,
 * referee criteria, Sources claim checks, reading time. Plan
 * docs/plans/261020w-export-your-own-words-and-a-chat-as-markdown.md § Deferred.
 */
import {
  blockquote,
  conversationMarkdown,
  frontMatter,
  markdownTime,
  webLinksMarkdown,
  type MarkdownThread,
} from "../chat-markdown.js";
import { commentKind } from "../comment-kind.js";
import { byArticlePlace, type ArticlePlace } from "../reader-notes.js";
import { storedThreadKind } from "../types.js";
import { articleUrl } from "../urls.js";
import type { ArticleRows } from "./article-rows.js";
import { anchorOf, toMessage } from "./pg-chat.js";
import { mentionKey } from "./pg-chat-mentions.js";

type Comment = ArticleRows["comments"][number];

/** At most this much of a block's text stands in for a whole-block bookmark's passage. */
const BLOCK_EXCERPT_CHARS = 400;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function excerpt(text: string): string {
  const flat = oneLine(text);
  return flat.length <= BLOCK_EXCERPT_CHARS ? flat : `${flat.slice(0, BLOCK_EXCERPT_CHARS).trimEnd()}…`;
}

export function yourWordsMarkdown(rows: ArticleRows, exportedAt: Date): string {
  const { article, revision } = rows;
  const title = oneLine(article.titleOverride ?? revision.title ?? "") || article.slug;
  const source = revision.finalUrl ?? revision.requestedUrl;

  const head = frontMatter({
    spideryarn: "your-words",
    article: title,
    article_url: articleUrl(article.slug),
    ...(source ? { source_url: source } : {}),
    exported: exportedAt.toISOString(),
  });

  const sections = [
    shelfSection(rows),
    commentsSection(rows),
    quizSection(rows),
    conversationsSection(rows),
  ].filter((s): s is string => s !== null);

  const intro =
    `# Your words on "${title}"\n\n` +
    "Everything you wrote in Spideryarn about this article, and what the AI said back where it " +
    "answered you. Ids like spya-k3m9qt name passages of the article." +
    (sections.length === 0 ? "\n\nYou have not written anything about this article yet." : "");

  return `${[head, intro, ...sections].join("\n\n")}\n`;
}

/** Your title if you renamed it, your purpose, your tags. */
function shelfSection(rows: ArticleRows): string | null {
  const { article } = rows;
  const lines: string[] = [];
  if (article.titleOverride?.trim()) lines.push(`- **Your title:** ${oneLine(article.titleOverride)}`);
  if (article.purpose?.trim()) lines.push(`- **Why you are reading it:** ${oneLine(article.purpose)}`);
  if (rows.articleTags.length > 0) {
    lines.push(`- **Your tags:** ${rows.articleTags.map((t) => t.tag).join(", ")}`);
  }
  /* The Skim briefs you added, planned or not (plan 261027d, Sol F8). */
  for (const b of rows.skimBriefs) lines.push(`- **A Skim brief you added:** ${oneLine(b.brief)}`);
  return lines.length === 0 ? null : `## On your shelf\n\n${lines.join("\n")}`;
}

/**
 * Comments, notes, bookmarks and highlights, in the order of the article. A
 * comment whose block has left the article (block-ids.md: ids outlive their
 * blocks) goes last, in the order it was made, rather than being dropped.
 */
function commentsSection(rows: ArticleRows): string | null {
  if (rows.comments.length === 0) return null;
  const ordinal = new Map(rows.blocks.map((b) => [b.blockId, b.ordinal]));
  const text = new Map(rows.blocks.map((b) => [b.blockId, b.text]));
  const criteria = new Map(rows.refereeCriteria.map((c) => [c.id, c.criterion]));
  const of = (c: Comment): ArticlePlace => ({
    at: ordinal.get(c.blockId) ?? Number.POSITIVE_INFINITY,
    start: c.start ?? -1,
    created: c.createdAt.toISOString(),
    id: c.id,
  });
  const sorted = [...rows.comments].sort((a, b) => byArticlePlace(of(a), of(b)));
  const items = sorted.map((c) => commentMarkdown(c, text.get(c.blockId), criteria));
  return `## Your comments and notes\n\n${items.join("\n\n")}`;
}

/**
 * What kind of mark a comment row is, in the reader's words. Only `body` is
 * the reader's prose; a row without one is a mark they made (a highlight, a
 * bookmark) or, before 2026-08-28, a passage they asked the AI to explain —
 * and no question is invented for it.
 */
function markWords(comment: Comment): string {
  switch (commentKind(comment)) {
    case "comment-ai":
      return comment.body?.trim() ? "Note" : "Asked the AI about this passage";
    case "comment":
      return "Note";
    case "highlight":
      return "Highlight";
    case "bookmark":
      return "Bookmark";
  }
}

/** What an unfinished or failed legacy explanation says beside any text kept. */
function commentStatus(comment: Comment, hasAnswer: boolean): string | null {
  if (comment.status === "pending") {
    return hasAnswer
      ? "_This answer was still being written when this was exported; the above is what had arrived._"
      : "_This answer was still being written when this was exported._";
  }
  if (comment.status === "error") {
    return hasAnswer
      ? "_This answer failed part-way; the above is what arrived._"
      : "_No answer: it failed._";
  }
  return null;
}

/**
 * One comment: the article's passage as a quote, the reader's words, and the
 * AI's answer marked as its own. A failed explanation may retain partial text
 * the reader already saw, so answer presence — not only `done` — decides what
 * is written, and its status is said separately.
 */
function commentMarkdown(
  comment: Comment,
  blockText: string | undefined,
  criteria: ReadonlyMap<string, string>,
): string {
  const answer = comment.answer?.trim() || null;
  const kind = markWords(comment);
  const heading = [
    kind === "Highlight" ? `Highlight (${comment.colour})` : kind,
    ...(comment.colour && kind !== "Highlight" ? [`${comment.colour} highlight`] : []),
    ...(comment.severity ? [comment.severity] : []),
  ].join(", ");
  const parts = [`### ${heading} · ${comment.blockId} · ${markdownTime(comment.createdAt.toISOString())}`];
  const passage = comment.quote?.trim()
    ? comment.quote
    : blockText !== undefined
      ? excerpt(blockText)
      : null;
  parts.push(
    passage
      ? `${comment.quote?.trim() ? "The passage" : "The paragraph"}:\n\n${blockquote(passage)}`
      : "_That paragraph is no longer in the article._",
  );
  if (comment.criterionId !== null) {
    const name = criteria.get(comment.criterionId);
    const placed = comment.valence === null ? "" : `; you placed it at ${comment.valence > 0 ? "+" : ""}${comment.valence} on its scale`;
    parts.push(`_Referee: on the criterion ${name ? `"${oneLine(name)}"` : comment.criterionId}${placed}._`);
  }
  if (comment.body?.trim()) parts.push(`**You wrote:**\n\n${comment.body.trim()}`);
  if (answer !== null) parts.push(`**Spideryarn answered:**\n\n${answer}`);
  const sources = webLinksMarkdown(comment.citations ?? [], "Web sources it found");
  if (sources !== null) parts.push(sources);
  const status = commentStatus(comment, answer !== null);
  if (status !== null) parts.push(status);
  return parts.join("\n\n");
}

/** Every answer the reader gave a quiz question, oldest first, with the mark it got. */
function quizSection(rows: ArticleRows): string | null {
  if (rows.quizAttempts.length === 0) return null;
  const sorted = [...rows.quizAttempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const items = sorted.map((a) =>
    [
      `### ${oneLine(a.question)}`,
      `_Answered ${markdownTime(a.createdAt.toISOString())}._`,
      `**Your answer:**\n\n${a.answer.trim()}`,
      `**Spideryarn's mark:**\n\n${a.reply.trim()}`,
    ].join("\n\n"),
  );
  return `## Your quiz answers\n\n${items.join("\n\n")}`;
}

/**
 * Every conversation but Referee's Candidates threads, which are machinery
 * rather than the reader's thinking — the line `reader_notes` draws too
 * (src/reader-notes.ts). Messages through `toMessage`, the store's own
 * row-to-message mapping, so a Recall hint is hidden by the same field the app
 * reads.
 */
function conversationsSection(rows: ArticleRows): string | null {
  const threads: MarkdownThread[] = [];
  for (const t of rows.chatThreads) {
    const kind = storedThreadKind(t.kind);
    if (kind === "candidates") continue;
    const messages = rows.chatMessages
      .filter((m) => m.threadId === t.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(toMessage);
    if (messages.length === 0) continue;
    /* The store's own column-to-field mappings (`anchorOf`, `toMessage`,
       `storedThreadKind`), applied to the snapshot's rows — not `threadsFor`,
       which would read again outside the walk's one transaction. */
    const messageOrder = new Map(
      rows.chatMessages.filter((message) => message.threadId === t.id).map((message) => [message.id, message.ordinal]),
    );
    const seenMentions = new Set<string>();
    const mentioned: { title: string }[] = [];
    /* `readArticleRows` orders mention rows by message id for the JSON export;
       ids carry no chronology. Restore the turn order the reading view uses. */
    const mentionRows = rows.chatMentions
      .filter((mention) => mention.threadId === t.id)
      .sort(
        (a, b) =>
          (messageOrder.get(a.messageId) ?? Number.POSITIVE_INFINITY) -
            (messageOrder.get(b.messageId) ?? Number.POSITIVE_INFINITY) ||
          a.position - b.position ||
          a.messageId.localeCompare(b.messageId),
      );
    for (const mention of mentionRows) {
      const key = mentionKey(mention.mentionedArticleId, mention.title);
      if (seenMentions.has(key)) continue;
      seenMentions.add(key);
      mentioned.push({ title: mention.title });
    }
    threads.push({
      title: t.title,
      kind,
      createdAt: t.createdAt.toISOString(),
      ...anchorOf(t),
      ...(mentioned.length > 0 ? { mentioned } : {}),
      messages,
    });
  }
  if (threads.length === 0) return null;
  return `## Your conversations\n\n${threads.map((t) => conversationMarkdown(t, 3)).join("\n\n")}`;
}
