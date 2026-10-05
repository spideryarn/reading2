/**
 * **The card that explains the reading-time estimate** — what the number was
 * made from, how far a real reader may be from it, and what it does not know.
 *
 * > Create a rich tooltip that explains the estimate of reading time, reused
 * > both at the top of article and in Metadata.
 * >
 * > — Greg, 2026-10-04 (spya-jew7ds)
 *
 * One component because two places show the same number (Masthead.tsx's facts
 * line, Metadata.tsx's *Read time* tile), and two explanations of one number
 * would drift exactly as two formulas for it once did (src/reading-time.ts).
 *
 * **It says the estimate is blind to difficulty rather than pretending
 * otherwise.** Greg's question in the same report was whether the number knows
 * how hard the piece is; it does not, and the cheap way to make it look as if
 * it did would get his own example backwards. The working is in
 * docs/research/261005a-reading-time-estimates-and-text-difficulty.md and the
 * decision in docs/plans/261005c-….
 *
 * Short paragraphs, not one block — docs/project/tooltips.md. The classes are
 * `ControlTip`'s (Tooltip.tsx), so the caller's `Tooltip` needs
 * `className="tip-soon"`; it is not a `ControlTip` because none of this is
 * about a control.
 */
import { readingMinutes, readingRange, WPM, WPM_QUICK, WPM_SLOW } from "../reading-time.js";

export function ReadTimeCard({
  words,
  supplementWords,
}: {
  /** The body's words: what the headline number was made from. */
  words: number;
  /** Footnotes, endnotes and references, which the number leaves out. */
  supplementWords: number;
}) {
  const minutes = readingMinutes(words);
  const { quick, slow } = readingRange(words);
  return (
    <>
      <div className="tip-soon-head">
        About {minutes} {minutes === 1 ? "minute" : "minutes"} to read
      </div>
      <p>
        {words.toLocaleString()} {words === 1 ? "word" : "words"} at {WPM} words a minute, the average for an
        adult reading English non-fiction silently.
      </p>
      {/* The rates, not "most adults would take": the range is what is known
          about readers in general, and nothing here has measured this piece.
          GPT Sol, plan review, 2026-10-05. */}
      {quick < slow && (
        <p>
          Most adults read between {WPM_SLOW} and {WPM_QUICK} words a minute, so between {quick} and {slow}{" "}
          minutes here.
        </p>
      )}
      <p>
        The estimate does not know how hard this piece is, or who is reading it. Dense ideas, maths, figures
        or an unfamiliar subject can all take longer.
      </p>
      {/* "Set apart from the main text", because that is the test: a note the
          extractor left inline is body prose and is counted (src/notes.ts). */}
      {supplementWords > 0 && (
        <p className="tip-soon-how">
          {supplementWords.toLocaleString()} {supplementWords === 1 ? "word" : "words"} of notes set apart from
          the main text {supplementWords === 1 ? "is" : "are"} not counted.
        </p>
      )}
    </>
  );
}
