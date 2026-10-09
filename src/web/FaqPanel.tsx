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
 * model's reading. The promise says both halves (Sol F3), and must keep saying
 * the second. It was the band's foot; since SPIDERYARN-READING2-62 it is
 * behind the band's corner (i) (`FaqAbout`).
 *
 * ## Not Quiz, not Ideas
 *
 * Quiz is the article asking *you*, afterwards, and marking your answer. Ideas
 * are propositions nobody asks. Nothing here marks the reader or states a
 * proposition, and no copy in this file should read as if it did.
 *
 * ## A prioritised order and a bar, since `faq/4`
 *
 * The model is asked for `difficulty` and `centrality` on every question, and
 * the default order is *prioritised*: what survives the bar on
 * `centrality × (1 − difficulty)`, the most central and approachable first —
 * Greg's *"start with a few that are a little bit more high level"*
 * (SPIDERYARN-READING2-5D). *Reading order* is one tap away, and since
 * SPIDERYARN-READING2-67 so are *most central* and *hardest*, the two scores
 * the compound is built from, as the Glossary offers them. The rule is in
 * src/web/faq-order.ts; a row draws the raw scores it was placed by, never the
 * compound. A list from before `faq/4` has no scores, so it offers no order
 * and no bar and is drawn in reading order, as it always was.
 * docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md,
 * docs/plans/260930d-faq-provenance-into-a-tooltip-and-sort-by-centrality-and-difficulty.md.
 *
 * Still no marks in the prose and no `?faq=` selection — `selectPassages`
 * answers `NOTHING` (src/web/reader/passages.ts).
 */
import { BadgeQuestionMark, TriangleAlert } from "lucide-react";
import type { BlockId, FaqDropped, FaqQuestion } from "../types.js";
import type { UseFaq } from "./useFaq.js";
import type { PublicFaq } from "../public-types.js";
import { AboutMade } from "./BandAbout.js";
import { BlockRef } from "./BlockRef.js";
import { OrderGroup } from "./OrderGroup.js";
import {
  availableOrders,
  barMax,
  effectiveOrder,
  FAQ_BAR_DEFAULT,
  type FaqOrder,
  faqNote,
  orderQuestions,
  priorityOf,
  scoresOf,
  visibleQuestions,
} from "./faq-order.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";
import { ScoreBars } from "./ScoreBars.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { ThresholdSlider } from "./ThresholdSlider.js";
import { BandWaiting } from "./BandWaiting.js";
import { Excerpt } from "./Excerpt.js";

/** What a deliberate `questions: []` is drawn as — a real answer, with no retry. */
export const FAQ_NONE = "The model found no questions worth asking this piece.";

/**
 * **The honest promise**, behind the (i) in the order row. Both halves are load-bearing:
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

/**
 * **Who is reading, and the questions they get — one prop, so the two cannot
 * disagree.** The owner's arm is the whole `useFaq` read: its status, the job,
 * the verbs that spend. The visitor's arm is the stored FAQ off the public
 * payload and nothing else — no read state (it arrived with the page), no job,
 * no verb — so a visitor's panel has nothing to press that could ask the model.
 * `owner?: never` for `TimelineAccess`'s reason: without it the same object
 * built in a variable first would typecheck with an owner hook inside a
 * visitor's arm. Since 2026-09-29, SPIDERYARN-READING2-56, plan 260929c.
 */
export type FaqAccess =
  | { kind: "owner"; owner: UseFaq }
  | { kind: "visitor"; faq: PublicFaq; owner?: never };

interface Props {
  access: FaqAccess;
  /** `?faqby=`. `prioritised` is the default; an unavailable order falls back to reading order. */
  order: FaqOrder;
  onOrder(order: FaqOrder): void;
  /** `?faqbar=`, or null for "nobody has touched it" — which is `FAQ_BAR_DEFAULT`. */
  bar: number | null;
  onBar(bar: number | null): void;
  onJump(id: BlockId): void;
}

/** Stable, so an absent list does not hand the ordering helpers a new array each render. */
const NO_QUESTIONS: readonly FaqQuestion[] = [];

export function FaqPanel({ access, order: chosenOrder, onOrder, bar: chosenBar, onBar, onJump }: Props) {
  useRenderCount("FaqPanel");
  /* `null` for a visitor, and every owner-only thing below is behind it. */
  const owner = access.kind === "owner" ? access.owner : null;
  const faq = access.kind === "owner" ? access.owner.faq : access.faq;
  const questions = faq?.questions ?? NO_QUESTIONS;
  /* One answer for the order in force, passed down, so the list, the pressed
     button, the slider and the bars on each row cannot disagree. */
  const order = effectiveOrder(questions, chosenOrder);
  const bar = chosenBar ?? FAQ_BAR_DEFAULT;
  const shown = orderQuestions(questions, order, bar);
  /* A visitor's FAQ arrived with the page, so it is ready by construction. */
  const ready = faq !== null && (owner === null || owner.status === "ready");
  /* The owner's alone: `dropped` does not cross (src/public-types.ts § PublicFaq). */
  const dropped = owner?.faq && ready ? droppedNote(owner.faq.dropped) : null;
  /* A forced run has finished and its result is not here yet: the forced
     button gives way to a read, never to a second paid run — IdeasPanel.tsx §
     `run` is the sibling. rewrite-hold.ts. */
  const waiting = owner !== null && owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const showJob =
    owner !== null &&
    ready &&
    !owner.stale &&
    (owner.job || owner.starting || owner.failed || (waiting && !owner.error));

  /**
   * @param again whether this is the button beside a list that is already
   *   there. The empty state's button must be `ensure` — the identical, unforced
   *   request the automatic run makes — or it buys a second model call.
   *   useIdeas.ts § `ensure`.
   */
  const run = (label: string, again = false) =>
    owner === null ? null : again && waiting && !owner.error ? (
    <RewriteWaiting line="The new questions haven't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      /* With `error` set the retry is `ReadError`'s; the button stays held. */
      runDisabled={again && owner.rewriting}
      onCancel={owner.cancel}
      label={label}
      step="faq"
      icon={<BadgeQuestionMark size={13} />}
      runningLabel="Finding…"
    />
  );

  return (
    <ModeSurface
      label="FAQ"
      feature="gloss faq"
      mode="faq"
      about={
        <FaqAbout
          count={ready ? questions.length : null}
          dropped={dropped}
          made={ready ? (owner?.faq ?? null) : null}
        />
      }
      /* **No head.** The Dock names the mode, and there is no count, order or
         control that needs a row of its own — so no `.band-head` at all, as
         Summary and Search have none. */
      /* Only a job's progress now: a job started from Metadata still needs its
         progress, Stop and failure here, including on an outdated list. No
         re-run otherwise — a fresh list offers none, the rule Greg set for the
         Glossary and Quotes; the stale banner carries it. The promise that
         used to live here is behind the band's (i) since
         SPIDERYARN-READING2-62 (`FaqAbout`). */
      foot={showJob ? <div className="faq-foot">{run("Find them again", true)}</div> : null}
    >
      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner?.status === "loading" && <BandWaiting className="gloss-quiet">Looking for the questions…</BandWaiting>}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has asked this one its questions yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Written once and kept —
            you will not be asked again unless the article changes.
          </p>
          {run("Find the questions")}
        </div>
      )}

      {ready && (
        <>
          {/* Stale wins when both are true: it is the one that can make a
              passage's jump land somewhere else. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These describe an older version of the article.
              </p>
              {run("Find them again", true)}
            </div>
          ) : null}
          {/* No banner for an outdated list (older prompt, same article) —
              Greg, 2026-09-29 (SPIDERYARN-READING2-55): *"it's not worth
              bugging the user about it."* Re-running is in Metadata. Plan
              260929c. */}

          {questions.length === 0 && <p className="gloss-quiet">{FAQ_NONE}</p>}

          {/* The orders there is something to do with — none for a list from
              before `faq/4`, which has no scores, because a control that would
              visibly do nothing is worse than none (GlossaryPanel.tsx §
              SortBar). No orders, no row: the (i) that once kept it standing is
              in the band's corner since 2026-10-01 (spya-ucu35y). */}
          {questions.length > 0 && availableOrders(questions).length > 0 && (
            <OrderBar options={availableOrders(questions)} order={order} onOrder={onOrder} />
          )}

          {/* Only in the order it belongs to. */}
          {order === "prioritised" && (
            <FaqBarSlider questions={questions} bar={bar} moved={chosenBar !== null} onBar={onBar} />
          )}

          {questions.length > 0 && (
            <div className="tl-scroll">
              <ol className="tl-list faq-list">
                {shown.map((q) => (
                  <QuestionRow key={q.id} question={q} order={order} onJump={onJump} />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </ModeSurface>
  );
}

/* --------------------------------------------------------------- controls -- */

/** Each order's button: the Glossary's words for the two scores (GlossaryPanel.tsx § sortOptions). */
const ORDER_BUTTON: Record<FaqOrder, { label: string; title: string }> = {
  prioritised: {
    label: "prioritised",
    title: "The most central and approachable questions first — the threshold below decides how many",
  },
  document: { label: "reading order", title: "Every question, in the order the piece raises it" },
  centrality: {
    label: "most central",
    title: "Every question, the ones the model judged most of the argument turns on first",
  },
  difficulty: {
    label: "hardest",
    title: "Every question, the ones the model judged need the most of the piece first",
  },
};

/** The order buttons. Their (i) was at this row's end until it moved to the band's corner (261001m). */
function OrderBar({
  options,
  order,
  onOrder,
}: {
  options: readonly FaqOrder[];
  order: FaqOrder;
  onOrder(order: FaqOrder): void;
}) {
  return (
    <div className="gloss-sort">
      {options.length > 0 && (
        <OrderGroup label="Order the questions by" selected={order}>
          {options.map((key) => (
            <button
              key={key}
              type="button"
              className={`gloss-sort-btn${order === key ? " on" : ""}`}
              aria-pressed={order === key}
              title={ORDER_BUTTON[key].title}
              onClick={() => onOrder(key)}
            >
              {ORDER_BUTTON[key].label}
            </button>
          ))}
        </OrderGroup>
      )}
    </div>
  );
}

/**
 * **The honest promise, behind the band's (i)** — Greg, 2026-09-30
 * (SPIDERYARN-READING2-62): *"move this text … into a tooltip, e.g. behind an
 * `(i)` icon"*. It was the band's foot, then the order row's (i), and since
 * 2026-10-01 the band's corner (spya-ucu35y), after the mode's own words. The
 * promise is unchanged and both halves still load-bearing; then how many
 * questions, the dropped count (a footnote to the promise), and who wrote it.
 */
function FaqAbout({
  count,
  dropped,
  made,
}: {
  count: number | null;
  dropped: string | null;
  made: { generator: string; version: string; generatedAt: string; elapsedMs: number } | null;
}) {
  return (
    <>
      {count !== null && count > 0 && <p>{FAQ_PROMISE}</p>}
      {count !== null && (
        <p>{count === 0 ? "No questions." : count === 1 ? "One question." : `${count} questions.`}</p>
      )}
      {dropped && <p>{dropped}</p>}
      {made && (
        <AboutMade
          generator={made.generator}
          version={made.version}
          generatedAt={made.generatedAt}
          elapsedMs={made.elapsedMs}
        />
      )}
    </>
  );
}

function FaqBarSlider({
  questions,
  bar,
  moved,
  onBar,
}: {
  questions: readonly FaqQuestion[];
  bar: number;
  moved: boolean;
  onBar(bar: number | null): void;
}) {
  /* One pass, and every number here comes out of it — threshold.ts. */
  const { visible, hiddenCount } = visibleQuestions(questions, bar);
  return (
    <ThresholdSlider
      id="faq-bar"
      value={bar}
      max={barMax(questions, bar)}
      defaultValue={FAQ_BAR_DEFAULT}
      moved={moved}
      visible={visible.length}
      total={questions.length}
      noun="questions"
      title="How high a question has to score to stay on screen: its centrality × (1 − its difficulty), so central, approachable questions score highest. Left shows more, right fewer."
      note={faqNote(hiddenCount, questions.length)}
      onChange={onBar}
    />
  );
}

/* ------------------------------------------------------------------ a row -- */

function QuestionRow({
  question,
  order,
  onJump,
}: {
  question: FaqQuestion;
  /** The order in force: a row draws the scores it was placed by (faq-order.ts § scoresOf). */
  order: FaqOrder;
  onJump(id: BlockId): void;
}) {
  const scores = scoresOf(question, order);
  const unscored = order === "prioritised" && priorityOf(question) === undefined;
  return (
    <li
      className="tl-item faq-item"
      data-faq-id={question.id}
      {...(unscored && { title: "Not scored for prioritising — shown regardless of the threshold" })}
    >
      <div className="faq-question-row">
        <h2 className="faq-question">{question.question}</h2>
        {scores.length > 0 && <ScoreBars className="faq-scores" scores={scores} />}
      </div>
      {/* In the order the artefact stores them, which is document order
          (src/faq.ts). Each is the article's own words — `.gloss-part-senseHere`
          is the solid rule Ideas and the Glossary draw for exactly that, reused
          rather than re-declared so the distinction is drawn one way. */}
      <ol className="faq-passages">
        {question.passages.map((p) => (
          <li key={`${p.blockId}:${p.start}`} className="gloss-part gloss-part-senseHere faq-passage">
            <blockquote className="gloss-part-text faq-quote">
              {/* The article's own words, drawn from the block's markup (Excerpt.tsx, plan 261009k). */}
              <Excerpt blockId={p.blockId} words={p.quote} />
            </blockquote>
            <BlockRef id={p.blockId} onJump={onJump} className="faq-jump" />
          </li>
        ))}
      </ol>
    </li>
  );
}
