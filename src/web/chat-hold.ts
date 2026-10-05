/**
 * **A streamed answer stays where it starts** — the arithmetic.
 *
 * When a question is sent, `Conversation` (ChatPanel.tsx) puts it at the top of
 * the transcript once, and from then on the arriving answer moves nothing: the
 * reader starts at the first sentence and it is still there when they finish
 * it. Greg, 2026-10-05: *"What I would prefer is if it streams in, but stays in
 * position so that I can start reading without having to scroll back up to the
 * beginning of the response."*
 *
 * The two numbers that takes are here, pure, so they are tested without a
 * layout engine. All of them are pixels in the scroller's own content space —
 * measured from the top of everything it scrolls, not from the window.
 * docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md.
 */

/**
 * How far down the panel an answer may start before the question above it is
 * given up. A pasted passage or a Remember recall can be taller than the panel,
 * and holding *its* top at the top would stream the answer below the fold.
 */
export const LONG_QUESTION = 0.4;

/**
 * The `scrollTop` that puts the question at the top of the panel — or, when the
 * question is taller than `LONG_QUESTION` of it, the answer's first line that
 * far down instead.
 *
 * `questionTop` is null when nothing was asked: an answer that opens a
 * conversation is held by its own top.
 */
export function holdTarget(at: {
  questionTop: number | null;
  answerTop: number;
  clientHeight: number;
  /** The scroller's own top padding, so the question keeps its gap. */
  pad: number;
}): number {
  const byQuestion = (at.questionTop ?? at.answerTop) - at.pad;
  const byAnswer = at.answerTop - at.clientHeight * LONG_QUESTION;
  return Math.max(0, Math.round(Math.max(byQuestion, byAnswer)));
}

/**
 * How tall the empty block after the last turn must be for `target` to be a
 * place the scroller can reach.
 *
 * A scroller cannot put its last item at the top unless a panel's height of
 * content follows it. `naturalHeight` is the scroller's `scrollHeight` *without*
 * the room, so the room shrinks as the answer grows into it and is zero once
 * the answer fills the panel.
 */
export function roomNeeded(at: {
  target: number;
  clientHeight: number;
  naturalHeight: number;
}): number {
  /* The top is always reachable, however short the transcript. */
  if (at.target <= 0) return 0;
  return Math.max(0, Math.ceil(at.target + at.clientHeight - at.naturalHeight));
}
