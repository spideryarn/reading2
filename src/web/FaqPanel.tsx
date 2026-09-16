/**
 * The FAQ, in the band between the spine and the prose: the questions a careful
 * first-time reader would put to this piece while reading it, each followed by
 * the passages where the piece itself responds.
 *
 * docs/plans/260916d-faq-mode.md is the design and docs/project/faq.md the
 * summary. Three things to know before changing anything here, all of them
 * about honesty rather than layout:
 *
 * ## There is no written answer, and there must not be one by accident
 *
 * The passages *are* the answer. A model-written paragraph under each question
 * would be generated text standing in for prose the view can show — a summary
 * wearing question marks, which is vision.md's anti-goal exactly. Fable and GPT
 * Sol both argued it out of v1 (the plan's § The one product call). So a row is
 * the question, then the article's own words, then a jump — and nothing else.
 *
 * ## The words are checked; the pairing is not
 *
 * Every quote on a row is a slice of the block it names, found by
 * `verifyPassage` in src/faq.ts — so drawing it with the solid left rule, the
 * treatment Ideas and the Glossary give *what comes from the article*, is true.
 * What nothing checks is that the passage answers the question: that is the
 * model's reading. The foot says both halves (Sol F3), and must keep saying the
 * second.
 *
 * ## Not Quiz, not Ideas
 *
 * Quiz is the article asking *you*, afterwards, and marking your answer. Ideas
 * are propositions nobody asks. Nothing here marks the reader or states a
 * proposition, and no copy in this file should read as if it did.
 *
 * No scores, no threshold bar, no marks in the prose and no `?faq=` selection in
 * v1 — `selectPassages` answers `NOTHING` (src/web/reader/passages.ts).
 */
import { BadgeQuestionMark, TriangleAlert } from "lucide-react";
import type { BlockId, FaqDropped, FaqQuestion } from "../types.js";
import type { UseFaq } from "./useFaq.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";

/** What a deliberate `questions: []` is drawn as — a real answer, with no retry. */
export const FAQ_NONE = "The model found no questions worth asking this piece.";

/**
 * **The honest promise**, pinned under the list. Both halves are load-bearing:
 * the first is what `verifyPassage` proves, the second is what it does not.
 */
export const FAQ_PROMISE =
  "The quoted words are the article's own, checked against it. Which passage answers which question is the model's reading.";

/**
 * How many things the model offered that validation left out — questions and
 * passages together, because `FaqDropped` counts both in some fields
 * (`duplicate`, `overCap`) and splitting them would be a guess.
 */
export function droppedCount(dropped: FaqDropped): number {
  return (
    dropped.unknownIds +
    dropped.unquoted +
    dropped.tooLong +
    dropped.duplicate +
    dropped.unanchored +
    dropped.overCap +
    dropped.malformed
  );
}

/** The quiet line under the promise, or null when nothing was left out. */
export function droppedNote(dropped: FaqDropped): string | null {
  const n = droppedCount(dropped);
  if (n === 0) return null;
  return n === 1
    ? "1 more question or passage the model gave was left out in checking."
    : `${n} more questions or passages the model gave were left out in checking.`;
}

interface Props {
  owner: UseFaq;
  onJump(id: BlockId): void;
}

export function FaqPanel({ owner, onJump }: Props) {
  useRenderCount("FaqPanel");
  const faq = owner.faq;
  const questions = faq?.questions ?? [];
  const ready = faq !== null && owner.status === "ready";
  const dropped = ready ? droppedNote(faq.dropped) : null;

  /**
   * @param again whether this is the button beside a list that is already
   *   there. The empty state's button must be `ensure` — the identical, unforced
   *   request the automatic run makes — or it buys a second model call.
   *   useIdeas.ts § `ensure`.
   */
  const run = (label: string, again = false) => (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      onCancel={owner.cancel}
      label={label}
      step="faq"
      icon={<BadgeQuestionMark size={13} />}
      runningLabel="Reading…"
    />
  );

  return (
    <ModeSurface
      label="FAQ"
      feature="gloss faq"
      /* **No head.** The Dock names the mode, and there is no count, order or
         control that needs a row of its own — so no `.band-head` at all, as
         Summary and Search have none. */
      /* Pinned under the scroller, so the promise is about the whole list rather
         than read as the last row's. No re-run here: a fresh list offers none,
         the rule Greg set for the Glossary and Quotes; the stale and outdated
         banners carry it. */
      foot={
        ready && questions.length > 0 ? (
          <div className="faq-foot">
            <p className="faq-note">{FAQ_PROMISE}</p>
            {dropped && <p className="faq-note">{dropped}</p>}
          </div>
        ) : null
      }
    >
      {owner.error && <p className="gloss-error">{owner.error}</p>}

      {owner.status === "loading" && <p className="gloss-quiet">Looking for the questions…</p>}

      {owner.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has asked this piece its questions yet.</p>
          <p className="gloss-hint">
            One model pass over the whole article, and it takes tens of seconds. Written once and kept —
            you will not be asked again unless the article changes.
          </p>
          {run("Find the questions")}
        </div>
      )}

      {ready && (
        <>
          {/* Stale wins when both are true: it is the one that can make a
              passage's jump land somewhere else. */}
          {owner.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These describe an older version of the article.
              </p>
              {run("Find them again", true)}
            </div>
          ) : owner.outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These were written by an older version of the prompt.
              </p>
              {run("Find them again", true)}
            </div>
          ) : null}

          {questions.length === 0 && <p className="gloss-quiet">{FAQ_NONE}</p>}

          {questions.length > 0 && (
            <div className="tl-scroll">
              <ol className="tl-list faq-list">
                {questions.map((q) => (
                  <QuestionRow key={q.id} question={q} onJump={onJump} />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </ModeSurface>
  );
}

function QuestionRow({ question, onJump }: { question: FaqQuestion; onJump(id: BlockId): void }) {
  return (
    <li className="tl-item faq-item" data-faq-id={question.id}>
      <h3 className="faq-question">{question.question}</h3>
      {/* In the order the artefact stores them, which is document order
          (src/faq.ts). Each is the article's own words — `.gloss-part-senseHere`
          is the solid rule Ideas and the Glossary draw for exactly that, reused
          rather than re-declared so the distinction is drawn one way. */}
      <ol className="faq-passages">
        {question.passages.map((p) => (
          <li key={`${p.blockId}:${p.start}`} className="gloss-part gloss-part-senseHere faq-passage">
            <blockquote className="gloss-part-text faq-quote">{p.quote}</blockquote>
            <BlockRef id={p.blockId} onJump={onJump} className="faq-jump" />
          </li>
        ))}
      </ol>
    </li>
  );
}
