/**
 * **The wider world, labelled: one section, shared by the prompts that answer
 * or mark the reader and otherwise stay in the article** — Chat, Recall,
 * Tutorial and Quiz marking. Greg, 2026-10-18 (`spya-h5mteu`): *"I do want to
 * distinguish between what is in the article versus what's in the pre-training
 * versus what's in the web search. But I don't want to restrict it into black
 * and white away to what's in the article."*
 *
 * Interpolated, like `plainWords` (src/plain-words.ts), so the four cannot
 * drift and the next prompt that wants it imports it rather than writing a
 * fifth copy. What is shared is the trigger, the three labels, how sure to
 * sound, the privacy rule for a search, and "never against the reader". Where
 * the note goes is NOT shared: each prompt has its own turn shape (Recall ends
 * on a nudge and a hint, Tutorial on a task, Quiz may not open with a verdict),
 * so each passes its own `placement` sentence. GPT Sol's plan review, F1.
 *
 * The trigger is narrow on purpose (F2): in argumentative writing nearly every
 * claim has opponents, and a model told to flag "disputed" claims flags all of
 * them. Explore has its own, wider version (`THE WIDER WORLD` in
 * src/converse.ts) because placing the piece is that mode's job.
 *
 * docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md;
 * the measurement is evals/wider-world.ts.
 */

export type WiderWorldOptions = {
  /** Whether this call can search the web. Quiz marking cannot. */
  search: "can" | "cannot";
  /**
   * The prompt already carries `CLAIM_ORIGINS` (src/converse.ts): point at it
   * rather than restate the labels, so a prompt gives one rule, not two.
   */
  origins?: "claim-origins";
  /** Where the note goes in this prompt's reply, in the prompt's own terms. */
  placement: string;
};

/** The section's heading, which tests pin and prompts may refer to. */
export const WIDER_WORLD_HEADING = "WHEN THE ARTICLE IS NOT THE LAST WORD";

export function widerWorld({ search, origins, placement }: WiderWorldOptions): string {
  const labels =
    origins === "claim-origins"
      ? `Mark where it came from, as WHERE EACH CLAIM CAME FROM says.`
      : `Keep the three sources apart in the sentence itself, so the reader can tell
which is which:
  · what the article says → its block id, as above;
  · what you knew before this conversation → say that it is not from the
    article: "Outside this piece, …", "The article doesn't say so, but…";
  · what a web search found → a link to the page.
A sentence that carries a block id says what the article says. Nothing from
outside the article rides in it.`;
  const checking =
    search === "can"
      ? `If you are unsure, either search to check it before you say it, and link
what you used, or say it is from memory and unchecked. A search may check a
doubt you already have about the point in front of you. Never search to find
out whether there is an objection to raise. Never put the reader's words,
notes or anything about them in a search: search for the article's claim, in
your own neutral words.`
      : `You cannot search here, so say that it is from memory and unchecked
whenever it is a specific fact: a date, a number, or what a study found.`;
  return `${WIDER_WORLD_HEADING}

The article is what you and the reader are working through, but it is not the
last word. Speak up, briefly and even unasked, in only two cases:
  · a concrete, checkable fact the piece states is wrong or out of date — a
    date, a number, a finding that did not hold up;
  · a settled consensus, or a substantial live dispute among the people who
    work on it, would change whether the reader should believe or carry away a
    CENTRAL claim of the piece.
Not for a view that merely has opponents (most do), not for nuance or
background, not for a tangent. If the piece itself already says the view is
contested, that is the article's own point: cite it, do not repeat it from
outside. Most turns have nothing to add, and then add nothing.

${labels}

Say how sure you are: settled, a live disagreement, or your own memory.
${checking}

The world disagreeing with the piece is never the reader getting the piece
wrong. The outside note is about the piece, not about them: it changes nothing
the rest of this prompt tells you to say, or not say, about their words. It is
not a correction and not a question, and it needs no sentence about their
answer to lead into it. Put what the article says and the note side by side.
The note is one sentence, two at most, inside the length you already have.

${placement}`;
}
