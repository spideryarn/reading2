/**
 * **A conversation as Markdown** — what *Copy this conversation* puts on the
 * clipboard, and what `your-words.md` carries for each conversation
 * (src/store/your-words.ts). One renderer for both, so the file and the
 * clipboard cannot describe the same conversation two ways.
 *
 * Markdown because it is the one format that reads plainly in a text editor and
 * that every chat model reads natively — the report asked for something "that
 * could be pasted into another AI" (Greg, 2026-10-19, `spya-p88dcx`). The
 * strictly machine-readable form is `chat.json` in the article's zip; this one
 * is for people and models. Message text goes in unchanged, so a reader's
 * question that itself contains a `## You` line would confuse a naive parser,
 * and that is accepted.
 *
 * Block ids stay in the text, for the reason `CopyAnswer` gives in
 * src/web/ChatPanel.tsx: they are the provenance.
 *
 * Imports nothing that reaches the server or the DOM: the browser and the
 * server both call it. docs/plans/261020w-export-your-own-words-and-a-chat-as-markdown.md.
 */
import { withoutCommandLines } from "./citable.js";
import { answerAsSeen } from "./recall-hint.js";
import type { ChatAnchor, ChatMessage, ChatThread, ThreadKind } from "./types.js";
import { articleUrl } from "./urls.js";

/** The fields of a message this file reads: the client's and the server's both have them. */
export type MarkdownMessage = Pick<
  ChatMessage,
  | "role"
  | "text"
  | "createdAt"
  | "status"
  | "hintOpenedAt"
  | "stopped"
  | "truncated"
  | "interrupted"
  | "passages"
  | "citations"
>;

export interface MarkdownThread extends Pick<ChatThread, "title" | "kind" | "createdAt"> {
  readonly anchor?: ChatAnchor;
  readonly messages: readonly MarkdownMessage[];
}

export interface MarkdownOptions {
  /**
   * Is this `[cmd:…]` token drawn as a button? Such a line is left out, as
   * *Copy answer* leaves it out (src/citable.ts § `withoutCommandLines`): the
   * reader was shown a button, not the syntax. Absent: every token is kept.
   */
  readonly isButton?: (raw: string) => boolean;
}

/**
 * The kind of conversation, in the words the app shows. Exhaustive, so a new
 * kind is a red compile here rather than a raw enum in somebody's export.
 */
export function conversationKindName(kind: ThreadKind): string {
  switch (kind) {
    case "chat":
      return "Chat";
    case "learn":
      return "Recall";
    case "explore":
      return "Explore";
    case "guide":
      return "Guide";
    case "candidates":
      return "Referee candidates";
    default: {
      const unknown: never = kind;
      return String(unknown);
    }
  }
}

/**
 * `2026-10-19 20:41 UTC` — always UTC, because the file is read on another
 * machine, later, and a local time with no zone is a guess. An unparseable
 * stamp is printed as it came rather than as `NaN`.
 */
export function markdownTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** One line, so a title with a newline in it cannot break the heading it is in. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Every line of `text` as a Markdown blockquote line. */
export function blockquote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/**
 * The italic lines under a turn that did not simply finish. A failed or
 * unfinished answer can still carry the words that arrived before it stopped
 * (src/routes.ts keeps them), so "failed" and "no answer" are two sentences.
 * The flags are not exclusive, so every one that applies is said.
 */
function statusLines(message: MarkdownMessage, hasText: boolean): string[] {
  if (message.role !== "assistant") return [];
  const out: string[] = [];
  if (message.status === "pending") {
    out.push(
      hasText
        ? "_This answer was still being written when this was exported; the above is what had arrived._"
        : "_This answer was still being written when this was exported._",
    );
  }
  if (message.status === "error") {
    out.push(hasText ? "_This answer failed part-way; the above is what arrived._" : "_No answer: it failed._");
  }
  if (message.stopped) out.push("_You stopped this answer early._");
  if (message.interrupted) {
    out.push("_This spoken answer ended early, and may hold words that were never heard._");
  }
  if (message.truncated) out.push("_This answer may be incomplete: it ran out of room._");
  return out;
}

/**
 * **What the answer pointed at besides its own text.** A spoken answer is
 * forbidden to say an id aloud and points with `passages` instead
 * (`PassageLinks` in src/web/ChatPanel.tsx), so without these lines it would
 * leave as an uncited claim. Web pages it cited go the same way.
 */
function pointerLines(message: MarkdownMessage): string[] {
  const out: string[] = [];
  const passages = message.passages ?? [];
  if (passages.length > 0) {
    const items = passages.map((p) => `- ${p.blockIds.join(", ")}${p.why.trim() ? ` — ${oneLine(p.why)}` : ""}`);
    out.push(`Passages it pointed to:\n\n${items.join("\n")}`);
  }
  const citations = message.citations ?? [];
  if (citations.length > 0) {
    const items = citations.map((c) => `- ${c.title?.trim() ? `${oneLine(c.title)}: ` : ""}${c.url}`);
    out.push(`Web pages it cited:\n\n${items.join("\n")}`);
  }
  return out;
}

/**
 * The conversation's body: its title as a heading at `level`, the passage it
 * started from, then each turn one level down. `level` lets the same body sit
 * inside the larger your-words.md file (title `###`, turns `####`).
 */
export function conversationMarkdown(
  thread: MarkdownThread,
  level: 1 | 2 | 3,
  options: MarkdownOptions = {},
): string {
  const h = "#".repeat(level);
  const turn = "#".repeat(level + 1);
  const parts: string[] = [`${h} ${oneLine(thread.title) || "Untitled conversation"}`];
  parts.push(`${conversationKindName(thread.kind)}, started ${markdownTime(thread.createdAt)}.`);

  if (thread.anchor && "quote" in thread.anchor && thread.anchor.quote.trim() !== "") {
    parts.push(`Started from this passage (${thread.anchor.blockId}):\n\n${blockquote(thread.anchor.quote)}`);
  } else if (thread.anchor) {
    parts.push(`Started from the passage ${thread.anchor.blockId}.`);
  }

  for (const message of thread.messages) {
    const who = message.role === "user" ? "You" : "Spideryarn";
    const seen = answerAsSeen(message, thread.kind);
    const text =
      message.role === "assistant" && options.isButton ? withoutCommandLines(seen, options.isButton) : seen;
    const lines = [`${turn} ${who} · ${markdownTime(message.createdAt)}`];
    const hasText = text.trim() !== "";
    if (hasText) lines.push(text.trim());
    lines.push(...pointerLines(message), ...statusLines(message, hasText));
    parts.push(lines.join("\n\n"));
  }
  return parts.join("\n\n");
}

/**
 * A YAML front-matter block. Every value is written as a JSON string, which is
 * valid YAML whatever it contains — quotes, colons, newlines, a `---` line —
 * so an importer can read the header with any YAML parser and nothing in a
 * title can end it early.
 */
export function frontMatter(fields: Readonly<Record<string, string>>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return ["---", ...lines, "---"].join("\n");
}

/** The article a conversation is about, as the header names it. */
export interface MarkdownArticle {
  readonly slug: string;
  /** Absent while the article payload has not arrived; the header then names only the address. */
  readonly title?: string | undefined;
}

/**
 * **One conversation, whole and standalone**: front matter, a line saying what
 * it is, then `conversationMarkdown` at level 1. What *Copy this conversation*
 * copies.
 */
export function conversationDocument(
  thread: MarkdownThread,
  article: MarkdownArticle,
  exportedAt: Date,
  options: MarkdownOptions = {},
): string {
  const articleTitle = oneLine(article.title ?? "");
  const head = frontMatter({
    spideryarn: "conversation",
    title: oneLine(thread.title),
    kind: thread.kind,
    ...(articleTitle ? { article: articleTitle } : {}),
    article_url: articleUrl(article.slug),
    started: thread.createdAt,
    exported: exportedAt.toISOString(),
  });
  const about =
    `A conversation in Spideryarn about ${articleTitle ? `"${articleTitle}"` : "an article"}. ` +
    "Ids like spya-k3m9qt name passages of the article; the answers cite them as their sources.";
  return `${head}\n\n${about}\n\n${conversationMarkdown(thread, 1, options)}\n`;
}
