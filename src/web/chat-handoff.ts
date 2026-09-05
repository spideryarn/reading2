/**
 * The first message of a conversation started from a passage.
 *
 * ## What used to be here, and why it has gone
 *
 * This file was a module-level cell that carried a question from the
 * explanation dialog into chat *mode*, because the two could not talk: chat
 * lived behind a component boundary that only existed in its own mode, and the
 * question could not go in the URL — it is arbitrary length and it is the
 * reader's private text, which would then be in every access log between here
 * and the server.
 *
 * Since 2026-08-26 the conversation floats over the article
 * (docs/plans/260826ab-chat-as-gateway.md), so the dialog and the chat are on screen at
 * the same time and the reader's follow-up is handed across as a prop. The cell
 * had nothing left to carry.
 *
 * It is worth saying what went with it, because all three were real and are now
 * simply not reachable: a question outliving its article, a question outliving
 * the moment (hence a two-minute expiry), and a question firing twice under
 * React StrictMode. A prop has none of those problems, which is the argument
 * for the change rather than a happy accident.
 */

/**
 * How much of a paragraph to show when the reader has not picked out a phrase.
 *
 * Enough to recognise which paragraph you pressed, short enough that the
 * composer is still somewhere you type rather than somewhere you scroll.
 */
const OPENING_CHARS = 60;

/**
 * **What the "?" in the gutter sends, in the reader's own voice.**
 *
 * The button is one press and no typing, so this sentence stands in for words
 * the reader never got to choose — which is the whole argument for it being
 * short, plain, and something a person would actually say. It appears in the
 * transcript above the answer, attributed to them.
 *
 * **"here, or somewhere earlier" is the load-bearing half.** Greg, 2026-09-04:
 * *"even though it's a question mark for a specific block, often the confusion
 * is wider in scope than just that block, so the LLM is going to have to use
 * its judgment on that."* An earlier draft said *"explain this and surrounding
 * blocks"*, which names a window — and a window is the one thing we know is
 * usually wrong, because the thing you needed was three sections ago or in a
 * definition you skimmed. So this asks for the *gap* rather than for a radius.
 * docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md.
 *
 * The model is told the rest — that a "?" was pressed, and what to do about it
 * — in the anchor addendum rather than here, because this text is the reader's
 * and instructions to the machine do not belong in it. src/converse.ts
 * § anchorSection.
 */
export const HELP_QUESTION = "I don't get this. What am I missing — here, or somewhere earlier?";

/**
 * The first message of a conversation started from a block.
 *
 * Greg's call, 2026-08-26: the id **and** the opening words, not the bare id —
 * "a six-character code in a text box is not something you can check you
 * clicked correctly". The id earns its place too: the model cites block ids
 * back, so having it here is what makes *"as you said in k3m9qt"* resolvable
 * when the reader reads the transcript afterwards.
 *
 * ## This is not how the model is told
 *
 * It looks like it is, and an earlier draft of the plan assumed so. The
 * conversation's anchor is stored on the **thread**, and `converse` renders it
 * into every turn — because `recentHistory` drops the oldest turns, so a
 * passage that lives only in the first message stops being sent once the
 * conversation passes twenty turns, while the panel and the database go on
 * saying the thread is anchored to it. See src/converse.ts § anchorSection.
 *
 * So this text is **for the human**. It is the reader's own words, editable
 * before they send and shown back to them in the transcript, and nothing
 * downstream parses it.
 */
export function askAboutBlock(opts: {
  blockId: string;
  /** The selection, or the paragraph's opening words. Absent for neither. */
  quote?: string | undefined;
  /** What the reader typed. Empty means "just explain it". */
  question?: string | undefined;
}): string {
  const short = opts.blockId.replace(/^spya-/, "");
  const opening = opts.quote?.trim();
  const trimmed =
    opening && opening.length > OPENING_CHARS
      ? `${opening.slice(0, OPENING_CHARS).trimEnd()}…`
      : opening;
  const head = trimmed
    ? `About block ${short} ("${trimmed}"):`
    : `About block ${short}:`;
  /* An empty box means "explain this passage", which is Greg's call and is what
     keeps the old one-press behaviour a keystroke away rather than gone. The
     sentence is the reader's, phrased as they would phrase it. */
  const asked = opts.question?.trim() || "Explain this passage.";
  return `${head}\n\n${asked}`;
}
