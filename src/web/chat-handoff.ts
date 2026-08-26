/**
 * A question handed from the explanation dialog to chat mode.
 *
 * Greg, 2026-08-26, on the follow-up box in the dialog:
 *
 * > Add a follow-up text-input box, but if the user enters text into it, it
 * > should automatically open up as a new chat (rather than making the
 * > [explanation dialog] itself too complex).
 *
 * Which is what keeps a comment at one question and one answer. The dialog does
 * not grow a transcript; the reader is moved to the thing that already is one.
 *
 * ## Why a module-level cell and not a query parameter
 *
 * The obvious implementation is `?ask=…`, and it is wrong for a reason
 * `useChat.ts` already writes down about its own POST:
 *
 * > the question does not belong in a URL — it is arbitrary length and it is the
 * > reader's private text, which would then be in every access log between here
 * > and the server.
 *
 * A parameter would also put it in browser history and in any link the reader
 * shared. So it travels in memory, and is lost on reload, which is the correct
 * trade: the cost of losing it is retyping one sentence.
 *
 * The other candidate was lifting `useChat` into `Reader` so the dialog could
 * call `send` directly. That charges every reader of every article a chat fetch
 * they will not use, which is precisely what the `ChatBand` component boundary
 * exists to avoid (see App.tsx).
 *
 * ## The three ways a cell like this goes wrong
 *
 * All three were found in review before any of them shipped, and each is a
 * silent failure — nothing errors, the question simply does the wrong thing.
 *
 *  - **It outlives its article.** Set it on article A, navigate to B, open chat,
 *    and A's question arrives in B's conversation with A's quote attached. Hence
 *    `slug` in the cell, and a `take` that refuses a mismatch.
 *  - **It outlives the moment.** The reader types a question, presses Escape,
 *    and goes to the glossary instead. Without an expiry the cell sits there for
 *    the life of the tab and fires days later, next time they open chat. Hence
 *    `HANDOFF_TTL_MS`.
 *  - **It fires twice, or into a thread list that is about to be replaced.**
 *    React StrictMode double-invokes effects at mount, so `take` clears as it
 *    reads — one caller gets it, ever. And the caller must wait for `loaded`:
 *    sending into an unloaded `useChat` inserts optimistic rows that the
 *    in-flight GET then overwrites, after which every delta is dropped on the
 *    floor with no error anywhere.
 *
 * See docs/plans/explain-deeper-answers.md § 4, and `ChatBand` in App.tsx for
 * the receiving end — including why it must latch `started` before it sends.
 */

interface Handoff {
  slug: string;
  /** Exactly what to send, quote and all. Built by `askAboutQuote`. */
  question: string;
  /** The reading position, so the answer knows where "here" is. */
  at: string | null;
  createdAt: number;
}

/**
 * How long a handed-off question stays worth sending.
 *
 * Two minutes: long enough for the mode switch and the chat fetch, far too
 * short to still be there when the reader wanders into chat later on. A
 * question that has expired is dropped silently, because the alternative —
 * asking something the reader typed ten minutes ago and has forgotten — is
 * worse than asking nothing.
 */
export const HANDOFF_TTL_MS = 120_000;

let pending: Handoff | null = null;

/** Hand a question to chat mode. Overwrites anything not yet taken. */
export function handOffToChat(slug: string, question: string, at: string | null): void {
  pending = { slug, question, at, createdAt: Date.now() };
}

/**
 * Take the question waiting for this article, if there is one.
 *
 * **Clears as it reads**, so a double-invoked effect cannot send twice.
 */
export function takeHandoff(slug: string): { question: string; at: string | null } | null {
  const held = pending;
  if (!held) return null;
  if (held.slug !== slug) return null; // a different article's question; leave it for its own tab
  pending = null;
  if (Date.now() - held.createdAt > HANDOFF_TTL_MS) return null;
  return { question: held.question, at: held.at };
}

/** Throw away anything waiting. For a reader who plainly changed their mind. */
export function clearHandoff(): void {
  pending = null;
}

/**
 * The reader's follow-up, with the passage it is about.
 *
 * The quote goes in because the conversation has to stand on its own: chat is
 * given the whole article, but "what did he mean by that?" resolves to nothing
 * without the sentence in front of it. Written as the reader's own words rather
 * than as an instruction to the model, because that is what the transcript will
 * show them afterwards — see `SUGGESTIONS` in ChatPanel.tsx, which sends its
 * canned questions verbatim for the same reason.
 */
export function askAboutQuote(quote: string, question: string): string {
  return `About this passage:\n\n"${quote.trim()}"\n\n${question.trim()}`;
}
