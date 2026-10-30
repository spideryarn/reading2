/**
 * **Explanations, in the band**: the places the model expected this reader to
 * get stuck, each with the passage's own words, a short explanation of what is
 * missing there, and a way to ask about it in chat. Greg's report spya-nkq6rj;
 * the design is
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md
 * § Idea 2.
 *
 * **Glossary's controls since 2026-10-29** — Greg, spya-ay3u4w: *"I was
 * expecting different orderings and a prioritized default with thresholding
 * and an option to find more"*. So, top to bottom, Glossary's pieces rather
 * than new ones (controls.md § Controls that do the same job look the same):
 * the run row (*Find more* or *Write a new list*, the band's one run button),
 * the order row (`OrderGroup` and its shared chips), and in the prioritised
 * order the threshold (`ThresholdSlider`). The rule behind the orders is
 * src/web/explanations-order.ts. Plan
 * docs/plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md § 2.
 *
 * Three things to keep true, all about honesty rather than layout:
 *
 * - **Beside the author's words, never in place of them.** A row is the
 *   passage first, in the article's own face with the article-provenance rule
 *   (`.gloss-part-senseHere`, as FAQ draws it), then the explanation in the
 *   AI's. The explanation is the missing piece, not a paraphrase — the
 *   prompt's rule (src/explanations.ts § 3); nothing here may present it as a
 *   summary of the passage.
 * - **The two labels say what the model said of itself**, and only when they
 *   apply: *Not sure* when `sure` is false, *Draws on AI memory, unchecked*
 *   when `outside` is true. Nothing in code checks either.
 * - **An empty list is a real answer**: nothing in the piece looked likely to
 *   trip this reader up. It is said plainly, with no retry — no *Find more* on
 *   it either (Sol F7), only *Write a new list* when the list no longer fits
 *   the article, the prompt or the reader.
 *
 * **Owner only.** There is no visitor arm: a visitor's band is `VisitorBand`
 * saying the mode is the owner's (src/web/visitor.ts § POLICY.explanations).
 *
 * **No marks in the prose in this version** (the underline is the plan's
 * deferred stage 3), so `selectPassages` answers `NOTHING` and each quote is a
 * jump.
 */
import { useEffect, useRef, useState } from "react";
import { Puzzle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlockId, Explanation, ExplanationsDropped, Job } from "../types.js";
import type { UseExplanations } from "./useExplanations.js";
import { AboutMade } from "./BandAbout.js";
import { BandWaiting } from "./BandWaiting.js";
import { BlockRef } from "./BlockRef.js";
import { Excerpt } from "./Excerpt.js";
import {
  EXPLANATIONS_BAR_DEFAULT,
  type ExplanationOrder,
  type ExplanationOrderOption,
  availableOrders,
  barMax,
  barStops,
  barToReveal,
  effectiveOrder,
  explanationsNote,
  orderExplanations,
  priorityOf,
  rowScores,
  visibleExplanations,
} from "./explanations-order.js";
import { freshRunOffered } from "./find-more.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { OrderGroup } from "./OrderGroup.js";
import { AskInChatButton } from "./OriginChat.js";
import { useRenderCount } from "./perf.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { ScoreBars } from "./ScoreBars.js";
import { ThresholdSlider } from "./ThresholdSlider.js";
import { type ItemFocus, useLandOnItem } from "./item-focus.js";
import { ASK_EXPLANATION_IN_CHAT, explanationLabels } from "./explanation-labels.js";
import { DismissibleNotice, STALE_NOTICE_LABEL, STALE_NOTICE_TOOLTIP } from "./StaleNotice.js";
import type { StepFailure } from "./useStepJob.js";
import { WrittenForYou } from "./WrittenForYou.js";

/** What a deliberate `explanations: []` is drawn as — a real answer, with no retry. */
export const EXPLANATIONS_NONE = "Nothing in this piece looked likely to trip you up, so there is nothing to explain.";

/** Said under *Find more* after a pass that added nothing — the button did something. */
export const EXPLANATIONS_NO_MORE = "No more places found.";

/** How many explanations the model offered that checking left out. */
export function droppedCount(dropped: ExplanationsDropped): number {
  return (
    dropped.malformed +
    dropped.unknownIds +
    dropped.unquoted +
    dropped.tooLong +
    dropped.ambiguous +
    dropped.badText +
    dropped.repeated +
    dropped.overCap
  );
}

/**
 * **Does the band's run button rewrite?** The server's `panelRun` when it gave
 * one — `existingFor`, which also sees a cleared profile. Absent (a response
 * from before the field), read conservatively: any of the three facts that can
 * make the step refuse to append says rewrite.
 */
export function runRewrites(
  owner: Pick<UseExplanations, "panelRun" | "stale" | "outdated" | "profileChanged">,
): boolean {
  return owner.panelRun ? owner.panelRun === "rewrite" : owner.stale || owner.outdated || owner.profileChanged;
}

export function ExplanationsPanel({
  owner,
  order: chosenOrder,
  onOrder,
  bar: chosenBar,
  onBar,
  onJump,
  onAsk,
  focus = null,
  onFocusTaken,
}: {
  owner: UseExplanations;
  /** `?explby=` — the parser's default is `prioritised`. */
  order: ExplanationOrder;
  onOrder(order: ExplanationOrder): void;
  /** `?explbar=` — null is "nobody has touched it", resolved to `EXPLANATIONS_BAR_DEFAULT`. */
  bar: number | null;
  onBar(bar: number | null): void;
  onJump(id: BlockId): void;
  /** Ask about one explanation in a chat anchored on its passage (Reader.tsx § `askExplanationInChat`). */
  onAsk(explanation: Explanation): void;
  /** One explanation to bring into view once — the margin's *Open in Explanations* (item-focus.ts). */
  focus?: ItemFocus | null;
  onFocusTaken?: ((focus: ItemFocus) => void) | undefined;
}) {
  useRenderCount("ExplanationsPanel");
  const made = owner.explanations;
  const list = made?.explanations ?? [];
  const ready = made !== null && owner.status === "ready";
  /* `effectiveOrder`, not the URL's: `prioritised` is the default, so it
     arrives on lists that cannot support it (every `explanations/1` list), and
     the list, the pressed button and the scores on each row must agree about
     the order actually in force. */
  const order = effectiveOrder(list, chosenOrder);
  const bar = chosenBar ?? EXPLANATIONS_BAR_DEFAULT;
  const shown = orderExplanations(list, order, bar);
  const orders = ready ? availableOrders(list) : [];

  /* **Land on the focused explanation** (item-focus.ts) — and first, if the
     bar is hiding it, lower the bar just enough to draw it (Sol F4), as
     Bibliography does: the margin's *Open in Explanations* is a request to see
     that one. The landing waits for the render that draws it. */
  const surface = useRef<HTMLElement>(null);
  const known = focus !== null && list.some((e) => e.id === focus.id);
  const drawn = focus !== null && shown.some((e) => e.id === focus.id);
  useEffect(() => {
    if (focus === null || !ready || !known) return;
    const lowered = barToReveal(list, focus.id, chosenOrder, bar);
    if (lowered !== null) onBar(lowered);
  }, [focus, ready, known, list, chosenOrder, bar, onBar]);
  useLandOnItem({
    focus,
    ready,
    known,
    drawn,
    scope: surface,
    attribute: "data-explanation-id",
    onTaken: onFocusTaken,
  });
  /* **The stale banner's × hides it for this page view only.** The stored
     dismissals (useStaleNotices.ts) are keyed on `STALE_NOTICE_MODES`, whose
     column has a CHECK; adding this mode there is a migration, left for after
     stage 1's review (plan 261028c). Until then the × still works, and the
     banner comes back on the next visit. Keyed by the list's clock, so a
     rewrite that is stale again shows it again. */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const staleShowing = ready && owner.stale && dismissedFor !== made.generatedAt;
  /* A forced run has finished and its result is not here yet: the run button
     gives way to a read, never to a second paid run. rewrite-hold.ts. */
  const waiting = owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const rewrites = runRewrites(owner);
  /* **The run row, first in the column, on a finished list** — Glossary's
     (GlossaryPanel.tsx § MoreRow). Not on an empty list that would append
     (Sol F7): *Find more* with nothing to extend is the same question asked
     again, and the empty answer is a real one. On an empty list that no
     longer fits — stale, outdated, another profile — it says *Write a new
     list*, which is then the only way to ask again. */
  const runRow = ready && (list.length > 0 || rewrites);
  /* **Only a running job's progress, below an empty list**, where there is no
     run row to carry it (a run started from another tab, or the profile
     panel's Regenerate). */
  const showFoot =
    ready &&
    !runRow &&
    (owner.job !== null || owner.starting || owner.failed !== null || (waiting && !owner.error));
  /* **Find more in the list's own recorded setting**, not the current
     profile's (useGlossary.ts § `more`): `existingFor` refuses to merge across
     a profile difference, so asking a plain list for the profile would
     rewrite it under a button that says "more". */
  const findMore = () => owner.more(owner.profiled);

  const dropped = made && ready ? droppedCount(made.dropped) : 0;
  const passes = made?.passes ?? 1;

  return (
    <ModeSurface
      ref={surface}
      label="Explanations"
      feature="gloss expl"
      mode="explanations"
      about={
        <>
          {ready && (
            <p>
              {list.length === 0
                ? "No explanations."
                : list.length === 1
                  ? "One explanation"
                  : `${list.length} explanations`}
              {list.length > 0 && passes > 1 ? `, found in ${passes} passes.` : list.length > 0 ? "." : ""}
            </p>
          )}
          {ready && list.length > 0 && (
            <p>The quoted words are the article’s own, checked against it. Which passages need explaining, and the explanations, are the AI’s.</p>
          )}
          {dropped > 0 && (
            <p>
              {dropped === 1
                ? "1 more explanation the model gave was left out in checking."
                : `${dropped} more explanations the model gave were left out in checking.`}
            </p>
          )}
          {made && ready && (
            <AboutMade
              generator={made.generator}
              version={made.version}
              generatedAt={made.generatedAt}
              elapsedMs={made.elapsedMs}
            />
          )}
        </>
      }
      /* Written for the reader's profile, so the corner badge, as Ideas and
         Glossary have it. **Its Regenerate is the forced run with today's
         profile**, as Glossary's is (`more(true)`): the panel offers it only
         when the profile has changed, and then `existingFor` refuses to append,
         so it rewrites. It sits inside the profile panel, beside the profile
         it is about — Greg's 2026-10-01 request (WrittenForYou.tsx) — not as a
         second button in the band. */
      profile={
        ready ? (
          <WrittenForYou
            written={owner.profiled}
            changed={owner.profileChanged}
            slug={owner.slug}
            regenerate={{
              run: () => void owner.more(true),
              busy: owner.job !== null || owner.starting || owner.rewriting,
              refresh: () => owner.refresh(),
            }}
          />
        ) : null
      }
      foot={
        showFoot ? (
          <div className="expl-foot">
            {waiting && !owner.error ? (
              <RewriteWaiting line="The new explanations haven't loaded yet." onRead={owner.refresh} className="tw:m-0" />
            ) : (
              <ExplanationsProgress
                job={owner.job}
                starting={owner.starting}
                failed={owner.failed}
                stalled={owner.stalled}
                onRun={findMore}
                onCancel={owner.cancel}
                label="Write a new list"
              />
            )}
          </div>
        ) : null
      }
    >
      {runRow && made && (
        <RunRow
          job={owner.job}
          loaded={owner.loaded}
          starting={owner.starting}
          failed={owner.failed}
          stalled={owner.stalled}
          rewrites={rewrites}
          foundNothing={passes > 1 && made.lastAdded === 0}
          waiting={owner.rewriting ? (owner.error ? "held" : "read") : null}
          onRead={owner.refresh}
          onMore={findMore}
          onCancel={owner.cancel}
        />
      )}

      {orders.length > 0 && <OrderBar options={orders} order={order} onOrder={onOrder} />}

      {/* Only in the order it belongs to: a number that means nothing in the
          other three orders would be furniture (GlossaryPanel.tsx). */}
      {ready && order === "prioritised" && (
        <ExplanationsBarSlider explanations={list} bar={bar} moved={chosenBar !== null} onBar={onBar} />
      )}

      {owner.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner.status === "loading" && (
        <BandWaiting className="gloss-quiet">Looking for the explanations…</BandWaiting>
      )}

      {owner.status === "none" && (
        <div className="gloss-empty">
          {/* Not while a run is under way: a press into the mode starts one, and
              "nobody has asked" beside its progress reads as a contradiction. */}
          {!(owner.job || owner.starting) && <p>Nobody has looked for the hard parts of this one yet.</p>}
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Written once and kept — you
            will not be asked again unless the article changes.
          </p>
          {/* `ensure`, the identical unforced request the automatic run makes,
              or it buys a second model call. useIdeas.ts § `ensure`. */}
          <ExplanationsProgress
            job={owner.job}
            starting={owner.starting}
            failed={owner.failed}
            stalled={owner.stalled}
            onRun={() => owner.ensure()}
            onCancel={owner.cancel}
            label="Find them"
          />
        </div>
      )}

      {ready && (
        <>
          {/* **No run button of its own**: *Write a new list* at the top of the
              column is the same rewrite (Sol F10), as Glossary's notice. */}
          {staleShowing && (
            <DismissibleNotice
              onDismiss={() => setDismissedFor(made.generatedAt)}
              tooltip={STALE_NOTICE_TOOLTIP}
              label={STALE_NOTICE_LABEL}
              failed={null}
              mode="explanations"
            >
              These describe an older version of the article.
            </DismissibleNotice>
          )}

          {list.length === 0 && <p className="gloss-quiet">{EXPLANATIONS_NONE}</p>}

          {list.length > 0 && (
            <div className="tl-scroll">
              <ol className="tl-list expl-list">
                {shown.map((e) => (
                  <ExplanationRow key={e.id} explanation={e} order={order} onJump={onJump} onAsk={onAsk} />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </ModeSurface>
  );
}

/** The band's run, through the shared `JobProgress` with this mode's icon and words. */
function ExplanationsProgress(props: {
  job: Job | null;
  starting: boolean;
  failed: StepFailure | null;
  stalled: boolean;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
}) {
  return (
    <JobProgress {...props} step="explanations" icon={<Puzzle size={13} />} runningLabel="Finding…" />
  );
}

/**
 * **The run row** — Glossary's `MoreRow` (GlossaryPanel.tsx), with this
 * mode's words, its classes (`.gloss-more`, `.gloss-more-go`,
 * `.gloss-more-note`) and the shared `JobProgress`. It says what its run will
 * do: *Find more* when it appends, *Write a new list* when it rewrites. A run
 * starting, going or failed draws the progress in the button's place; a
 * finished rewrite whose list has not loaded draws the read.
 *
 * **Held, not hidden, before the first job poll** (`loaded`), where Glossary
 * draws nothing: this row owns the corner's clearance (§ 3 of the plan), and
 * a row that arrived a poll late would drop the list under the (i) meanwhile.
 */
function RunRow({
  job,
  loaded,
  starting,
  failed,
  stalled,
  rewrites,
  foundNothing,
  waiting,
  onRead,
  onMore,
  onCancel,
}: {
  job: Job | null;
  loaded: boolean;
  starting: boolean;
  failed: StepFailure | null;
  stalled: boolean;
  rewrites: boolean;
  /** The last pass was a *Find more* and added nothing. */
  foundNothing: boolean;
  /** `"read"` draws the read in the button's place; `"held"` only disables it. */
  waiting: "read" | "held" | null;
  onRead(): Promise<void>;
  onMore(): Promise<void>;
  onCancel(id: string): void;
}) {
  const label = rewrites ? "Write a new list" : "Find more";
  const title = rewrites
    ? "Writes a fresh list rather than adding to this one, so some places here may not come back"
    : "Another model call, told the places it has already explained, looking for more";

  if (loaded && !freshRunOffered({ job, loaded, starting, failed })) {
    return (
      <div className="gloss-more">
        <ExplanationsProgress
          job={job}
          starting={starting}
          failed={failed}
          stalled={stalled}
          onRun={onMore}
          onCancel={onCancel}
          label={label}
        />
      </div>
    );
  }

  if (waiting === "read") {
    return (
      <div className="gloss-more">
        <RewriteWaiting line="The new explanations haven't loaded yet." onRead={onRead} className="tw:m-0" />
      </div>
    );
  }

  return (
    <div className="gloss-more">
      <div className="gloss-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gloss-btn gloss-more-go"
          data-tip={title}
          disabled={!loaded || waiting === "held"}
          onClick={() => void onMore()}
        >
          <Search size={12} />
          {label}
        </Button>
      </div>
      {!rewrites && foundNothing ? <p className="gloss-more-note">{EXPLANATIONS_NO_MORE}</p> : null}
    </div>
  );
}

/** The order buttons — Glossary's `SortBar`, FAQ's `OrderBar`. */
function OrderBar({
  options,
  order,
  onOrder,
}: {
  options: readonly ExplanationOrderOption[];
  order: ExplanationOrder;
  onOrder(order: ExplanationOrder): void;
}) {
  return (
    <div className="gloss-sort">
      <OrderGroup label="Order the explanations by" selected={order}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`gloss-sort-btn${order === option.key ? " on" : ""}`}
            aria-pressed={order === option.key}
            data-tip={option.title}
            onClick={() => onOrder(option.key)}
          >
            {option.label}
          </button>
        ))}
      </OrderGroup>
    </div>
  );
}

/** The threshold — the shared `ThresholdSlider`, one pass for every number on it. */
function ExplanationsBarSlider({
  explanations,
  bar,
  moved,
  onBar,
}: {
  explanations: readonly Explanation[];
  bar: number;
  moved: boolean;
  onBar(bar: number | null): void;
}) {
  const { visible, hiddenCount } = visibleExplanations(explanations, bar);
  return (
    <ThresholdSlider
      id="expl-bar"
      value={bar}
      max={barMax(explanations, bar)}
      stops={barStops(explanations)}
      defaultValue={EXPLANATIONS_BAR_DEFAULT}
      moved={moved}
      visible={visible.length}
      total={explanations.length}
      noun="explanations"
      tip="How high an explanation has to score to stay on screen: how likely you are to get stuck there × how much of the argument depends on getting past it. Left shows more, right fewer."
      note={explanationsNote(hiddenCount, explanations.length)}
      onChange={onBar}
    />
  );
}

function ExplanationRow({
  explanation,
  order,
  onJump,
  onAsk,
}: {
  explanation: Explanation;
  /** The order in force: a row draws the scores it was placed by (explanations-order.ts § rowScores). */
  order: ExplanationOrder;
  onJump(id: BlockId): void;
  onAsk(explanation: Explanation): void;
}) {
  const labels = explanationLabels(explanation);
  const scores = rowScores(explanation, order);
  const unscored = order === "prioritised" && priorityOf(explanation) === undefined;
  return (
    <li
      className="tl-item expl-item"
      data-explanation-id={explanation.id}
      data-tip={unscored ? "Not scored for prioritising — shown regardless of the threshold" : undefined}
    >
      {/* The article's own words first, with the solid rule FAQ and the
          Glossary draw for exactly that, the scores it was placed by, and the
          jump beside them. */}
      <div className="gloss-part gloss-part-senseHere expl-passage">
        <blockquote className="gloss-part-text expl-quote">
          <Excerpt blockId={explanation.blockId} words={explanation.quote} />
        </blockquote>
        {scores.length > 0 && <ScoreBars className="expl-scores" scores={scores} />}
        <BlockRef id={explanation.blockId} onJump={onJump} className="expl-jump" />
      </div>
      {/* The model's words, in its face (fonts.md; voices.css § `.expl-text`). */}
      <p className="expl-text">{explanation.text}</p>
      {/* Ours, so in the app's face: what the model said of its own answer. */}
      {labels.length > 0 && (
        <p className="expl-labels">
          {labels.map((label) => (
            <span key={label} className="expl-label">
              {label}
            </span>
          ))}
        </p>
      )}
      <div className="expl-actions">
        <AskInChatButton
          label={ASK_EXPLANATION_IN_CHAT}
          className="gloss-btn expl-ask-chat"
          onAsk={() => onAsk(explanation)}
        />
      </div>
    </li>
  );
}
