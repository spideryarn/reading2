/**
 * **Explanations, in the band**: the places the model expected this reader to
 * get stuck, in reading order, each with the passage's own words, a short
 * explanation of what is missing there, and a way to ask about it in chat.
 * Greg's report spya-nkq6rj; the design is
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md
 * § Idea 2.
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
 *   trip this reader up. It is said plainly, with no retry.
 *
 * **Owner only.** There is no visitor arm: a visitor's band is `VisitorBand`
 * saying the mode is the owner's (src/web/visitor.ts § POLICY.explanations).
 *
 * **No marks in the prose in this version** (the underline is the plan's
 * deferred stage 3), so `selectPassages` answers `NOTHING` and each quote is a
 * jump.
 */
import { useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import type { BlockId, Explanation, ExplanationsDropped } from "../types.js";
import type { UseExplanations } from "./useExplanations.js";
import { AboutMade } from "./BandAbout.js";
import { BandWaiting } from "./BandWaiting.js";
import { BlockRef } from "./BlockRef.js";
import { Excerpt } from "./Excerpt.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { AskInChatButton } from "./OriginChat.js";
import { useRenderCount } from "./perf.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { type ItemFocus, useLandOnItem } from "./item-focus.js";
import { ASK_EXPLANATION_IN_CHAT, explanationLabels } from "./explanation-labels.js";
import { DismissibleNotice, STALE_NOTICE_LABEL, STALE_NOTICE_TOOLTIP } from "./StaleNotice.js";
import { WrittenForYou } from "./WrittenForYou.js";

/** What a deliberate `explanations: []` is drawn as — a real answer, with no retry. */
export const EXPLANATIONS_NONE = "Nothing in this piece looked likely to trip you up, so there is nothing to explain.";

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

export function ExplanationsPanel({
  owner,
  onJump,
  onAsk,
  focus = null,
  onFocusTaken,
}: {
  owner: UseExplanations;
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
  /* **Land on the focused explanation** (item-focus.ts): every row of a
     ready list is drawn, so known is drawn. */
  const surface = useRef<HTMLElement>(null);
  const known = focus !== null && list.some((e) => e.id === focus.id);
  useLandOnItem({
    focus,
    ready,
    known,
    drawn: known,
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
  /* A forced run has finished and its result is not here yet: the forced
     button gives way to a read, never to a second paid run. rewrite-hold.ts. */
  const waiting = owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  /* **Write it again**, beside a list written by an older prompt or for an
     older profile (plan 261028c § States), as well as while a job runs,
     failed or a rewrite has not loaded. Not while the stale banner shows: it
     carries the button itself. */
  const showFoot =
    ready &&
    !staleShowing &&
    (owner.job !== null ||
      owner.starting ||
      owner.failed !== null ||
      owner.outdated ||
      owner.profileChanged ||
      (waiting && !owner.error));

  /**
   * @param again whether this is the button beside a list that is already
   *   there. The empty state's button must be `ensure` — the identical,
   *   unforced request the automatic run makes — or it buys a second model
   *   call. useIdeas.ts § `ensure`.
   */
  const run = (label: string, again = false) =>
    again && waiting && !owner.error ? (
      <RewriteWaiting line="The new explanations haven't loaded yet." onRead={owner.refresh} className="tw:m-0" />
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
        step="explanations"
        icon={<Puzzle size={13} />}
        runningLabel="Finding…"
      />
    );

  const dropped = made && ready ? droppedCount(made.dropped) : 0;

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
                  ? "One explanation."
                  : `${list.length} explanations.`}
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
      /* Written for the reader's profile, so the corner badge, as Ideas has
         it; its panel offers the forced run when the profile has changed. */
      profile={
        ready ? (
          <WrittenForYou
            written={owner.profiled}
            changed={owner.profileChanged}
            slug={owner.slug}
            /* The forced run replaces the list. */
            regenerate={{
              run: () => void owner.regenerate(),
              busy: owner.job !== null || owner.starting || owner.rewriting,
              refresh: () => owner.refresh(),
            }}
          />
        ) : null
      }
      /* **No head**, as FAQ: nothing needs a row of its own. */
      foot={showFoot ? <div className="expl-foot">{run("Write it again", true)}</div> : null}
    >
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
          {run("Find them")}
        </div>
      )}

      {ready && (
        <>
          {staleShowing && (
            <DismissibleNotice
              onDismiss={() => setDismissedFor(made.generatedAt)}
              tooltip={STALE_NOTICE_TOOLTIP}
              label={STALE_NOTICE_LABEL}
              failed={null}
              action={run("Write it again", true)}
              mode="explanations"
            >
              These describe an older version of the article.
            </DismissibleNotice>
          )}

          {list.length === 0 && <p className="gloss-quiet">{EXPLANATIONS_NONE}</p>}

          {list.length > 0 && (
            <div className="tl-scroll">
              <ol className="tl-list expl-list">
                {list.map((e) => (
                  <ExplanationRow key={e.id} explanation={e} onJump={onJump} onAsk={onAsk} />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </ModeSurface>
  );
}

function ExplanationRow({
  explanation,
  onJump,
  onAsk,
}: {
  explanation: Explanation;
  onJump(id: BlockId): void;
  onAsk(explanation: Explanation): void;
}) {
  const labels = explanationLabels(explanation);
  return (
    <li className="tl-item expl-item" data-explanation-id={explanation.id}>
      {/* The article's own words first, with the solid rule FAQ and the
          Glossary draw for exactly that, and the jump beside them. */}
      <div className="gloss-part gloss-part-senseHere expl-passage">
        <blockquote className="gloss-part-text expl-quote">
          <Excerpt blockId={explanation.blockId} words={explanation.quote} />
        </blockquote>
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
