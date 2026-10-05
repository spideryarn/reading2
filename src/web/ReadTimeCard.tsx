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
 * **It says where the number started and what moved it.** 238 words a minute
 * is the starting rate. When a model has rated the piece, the card gives the
 * flat figure, then the two ratings, how much they change the time and the
 * model's own sentence, and says the rating came from sampled passages rather
 * than claiming to know how hard the whole piece is. When nothing has rated
 * it, the card says so and that the number is the flat rate. Either way it
 * does not know who is reading. The research is
 * docs/research/261005a-reading-time-estimates-and-text-difficulty.md and the
 * decision docs/plans/261005j-….
 *
 * **Never a model's name or what the rating cost**: neither is a reader's
 * business here, and the rating as it reaches this file does not carry them.
 *
 * Short paragraphs, not one block — docs/project/tooltips.md. The classes are
 * `ControlTip`'s (Tooltip.tsx), so the caller's `Tooltip` needs
 * `className="tip-soon"`; it is not a `ControlTip` because none of this is
 * about a control.
 */
import {
  difficultyMultiplier,
  readingMinutes,
  readingRange,
  WPM,
  WPM_QUICK,
  WPM_SLOW,
  type RatedDifficulty,
} from "../reading-time.js";
import { voiceClass } from "./voice.js";

const minutesWord = (n: number) => (n === 1 ? "minute" : "minutes");

/**
 * What the rating does to the time, as the end of a sentence that began "a
 * model judged…". A percentage of the time, because the multiplier is on the
 * minutes: 1.10 adds a tenth to them.
 */
function effectOf(multiplier: number, changed: boolean): string {
  if (multiplier === 1) return "which is about average, so the estimate is not adjusted.";
  const percent = Math.round(Math.abs(multiplier - 1) * 100);
  const effect =
    multiplier > 1 ? `which adds about ${percent}% to the time` : `which takes about ${percent}% off the time`;
  /* A short piece can round to the same minute either way; say so rather
     than announce an adjustment the reader cannot see. */
  return changed ? `${effect}.` : `${effect}, too little to change the number here.`;
}

export function ReadTimeCard({
  words,
  supplementWords,
  difficulty,
}: {
  /** The body's words: what the headline number was made from. */
  words: number;
  /** Footnotes, endnotes and references, which the number leaves out. */
  supplementWords: number;
  /**
   * The rating the minutes were multiplied by, or null for a piece nobody has
   * rated. Required, so a caller cannot show adjusted minutes over a card that
   * explains flat ones (`Stats.difficulty`, stats.ts).
   */
  difficulty: RatedDifficulty | null;
}) {
  const rating = difficulty ?? undefined;
  const minutes = readingMinutes(words, rating);
  const flat = readingMinutes(words);
  const { quick, slow } = readingRange(words, rating);
  const multiplier = difficultyMultiplier(rating);
  const adjusted = multiplier !== 1;
  return (
    <>
      <div className="tip-soon-head">
        About {minutes} {minutesWord(minutes)} to read
      </div>
      <p>
        {words.toLocaleString()} {words === 1 ? "word" : "words"} at {WPM} words a minute, the average for an
        adult reading English non-fiction silently
        {/* For a rated piece the head is no longer this arithmetic's answer,
            so the answer is said: 238 is where the estimate starts. */}
        {difficulty ? `, is about ${flat} ${minutesWord(flat)}.` : "."}
        {/* Only where the arithmetic would otherwise look wrong: a one-word
            piece at 238 a minute is not a minute. GPT Sol, code review. */}
        {words < WPM / 2 && " Never shown as less than a minute."}
      </p>
      {difficulty && (
        <>
          {/* "Judged … from sampled passages": the model read a sample, and
              this is its estimate, not a measurement. GPT Sol, plan review F5. */}
          <p>
            {minutes !== flat ? `Adjusted to ${minutes}: a model` : "A model"} judged the language{" "}
            {difficulty.language} of 5 and the ideas {difficulty.ideas} of 5 from sampled passages,{" "}
            {effectOf(multiplier, minutes !== flat)}
          </p>
          {/* The model's own sentence, so in the model's face (fonts.md). A
              span, because `.tooltip` resets its paragraphs to the UI face. */}
          <p>
            <span className={voiceClass("ai")}>{difficulty.reason}</span>
          </p>
        </>
      )}
      {/* The rates, not "most adults would take": the range is what is known
          about readers in general, and nothing here has measured this piece.
          GPT Sol, plan review, 2026-10-05. For an adjusted piece it is the
          same range with the same adjustment, and says so. */}
      {quick < slow && (
        <p>
          Most adults read such text at between {WPM_SLOW} and {WPM_QUICK} words a minute
          {adjusted ? ". With the same adjustment that would be about " : ", which would be about "}
          {quick}–{slow} minutes.
        </p>
      )}
      {difficulty ? (
        <p>
          The estimate does not know who is reading. A subject you know well will go faster; maths, figures
          or an unfamiliar one can take longer.
        </p>
      ) : (
        <p>
          This piece has not been rated for difficulty, so this is the flat rate. Dense ideas, maths,
          figures or an unfamiliar subject can all take longer.
        </p>
      )}
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
