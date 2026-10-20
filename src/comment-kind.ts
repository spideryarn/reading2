/**
 * **What kind of mark a comment is**, in the reader's terms — Greg,
 * SPIDERYARN-READING2-9H: *"a comment from the user that didn't want an AI chat
 * response, or one that did want an AI chat response, or a question with AI chat
 * response."*
 *
 * **What happened, not what was wanted.** Read off what is already stored, not
 * a field of its own: *Also ask the AI* links the chat the reader then sends as
 * `threadId`, and a comment from before 2026-08-28 carries the model's
 * explanation attempt in place (`status` other than `none`) — so the label is
 * the deliberately broad `comment-ai`, true whether the AI is answering,
 * answered, failed, or replied in a chat rather than in place. A reader who
 * ticked the box and closed the chat draft unsent, or whose chat failed before
 * it existed, gets `comment`: that is what they ended up with. Storing the tick
 * itself would be a column, and is deferred in the plan. A `threadId` outlives
 * a deleted conversation, so the label may name AI involvement whose
 * conversation is gone; it still happened.
 *
 * A visitor's copy carries no `threadId` or `status` (`public-types.ts`), so an
 * owner's comment reads to them as `comment-ai` only when it carries a legacy
 * answer, as `comment` when it has words, and as `bookmark` when it has neither
 * — less than the owner sees, never more.
 *
 * The question — the gutter's `?` or *Chat about this* — is not a comment at
 * all but an `AskedQuestion`, and `askedQuestions` already leaves out chats a
 * comment points at, so the three never overlap.
 *
 * Shared by the reading view and by `your-words.md`, and kept outside
 * `src/web/` because the latter is built on the server.
 * docs/plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md.
 */

export type CommentKind = "bookmark" | "highlight" | "comment" | "comment-ai";
export type MarkKind = CommentKind | "question";

/**
 * `highlight`, since 2026-10-03, is a wordless comment with a colour and no AI
 * involvement. The precedence is deliberate: `comment-ai` > `comment` >
 * `highlight` > `bookmark`. Nullable fields admit database rows as well as the
 * browser's absent-field shape.
 */
export function commentKind(c: {
  readonly body?: string | null | undefined;
  readonly answer?: string | null | undefined;
  readonly threadId?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly colour?: string | null | undefined;
}): CommentKind {
  if (c.threadId || c.answer || (c.status != null && c.status !== "none")) return "comment-ai";
  if (c.body) return "comment";
  return c.colour ? "highlight" : "bookmark";
}

/** One label per kind, for the drawer and the margin alike. */
export const MARK_KIND_LABEL: Record<MarkKind, string> = {
  bookmark: "Bookmark",
  highlight: "Highlight",
  comment: "Comment",
  "comment-ai": "Comment + AI",
  question: "Question",
};
