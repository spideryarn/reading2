/**
 * **Where the referee places a passage themselves** — Stage 2 of
 * docs/plans/260901i-the-referee-places-the-passage-themselves.md.
 *
 * Referee mode has always had two judgements in it and only ever offered one.
 * The model's valence has been on screen since 2026-08-31; the referee's own
 * has been storable for exactly as long and unreachable ever since. This is the
 * control that makes it. `valenceGap` (src/referee-criteria.ts) measures the
 * distance between two independent judgements, and until this existed there was
 * only one.
 *
 * ## It lives in the selection flow, and that is the whole design
 *
 * The obvious home was a control beside each model result in `CriteriaPanel` —
 * two clicks instead of five. It was rejected, and the reason is worth having
 * here rather than only in the plan: **a control that renders the model's
 * judgement while soliciting the referee's is not measuring the referee's
 * judgement, it is measuring their willingness to copy a number.** It also
 * limits the referee to placing passages the model surfaced, which throws away
 * the more interesting half — the model's *misses*.
 *
 * Opening from a prose selection is independent by construction: it works
 * before any criterion has run, on a passage no criterion returned, and the
 * anchor comes from the referee's own reading rather than from a model row. So
 * **nothing in this file may ever render a `DivergingResult`**, and
 * tests/referee-placement.test.tsx renders the section with loud model valences
 * in scope and checks that none of them appears inside it.
 *
 * The objection that would falsify the choice is friction — select, open, pick,
 * press, per passage, per criterion. If real use shows model runs and near-zero
 * placements, the answer in the plan is a row-level "place this yourself" that
 * opens *this* instrument with the model's line hidden until commit.
 *
 * ## Five labelled positions, and never a slider
 *
 * A −100…+100 slider is what the column holds and the wrong instrument for a
 * person: nobody means −63, and a number line beside the model's number line
 * invites matching. Five, because a referee distinguishes a wrinkle from a
 * fatal flaw and with only ±100 available every objection paints as maximal;
 * not seven, because past five the labels stop being sayable in the poles' own
 * words.
 *
 * **The numbers are a wire format, not a claim.** The instrument is discrete,
 * so what is echoed back is always the exact label pressed and no precision is
 * ever invented — "ranking over scores" honoured in substance. The buttons
 * print no number at all; `CommentDialog` prints one beside a placement that
 * already exists, because that is where the referee is being shown a thing they
 * are about to overwrite.
 *
 * The words come from src/web/valence.ts, which is where the rule lives that
 * colour may never be the only carrier of a direction. Every position here is
 * legible with the swatch deleted; the swatch is `aria-hidden` decoration on
 * top of the words, and there is no second colour ramp in this file.
 */
import { useId } from "react";

import type { RefereeCriterionConfig, RefereePoles } from "../referee-criteria.js";
import { signedValence, valenceToken, valenceWords } from "./valence.js";
import { type SavedCriterionState, useCriteria } from "./useCriteria.js";

/**
 * **A placement, as it goes over the wire** — both fields, always, each a value
 * or `null`.
 *
 * The shape is the route's rather than the store's on purpose. `POST` takes the
 * fields as optional and `PATCH …/mark` takes both and reads `null` as *clear
 * this*, and a client type with optional fields could not express the
 * difference between "leave it alone" and "there is nothing here" — which is
 * precisely the ambiguity the named route exists to remove
 * (docs/project/comments.md § the four operations).
 *
 * `{ criterionId, valence: null }` is a legal and ordinary state: a referee who
 * writes a sentence about a criterion and does not score it.
 * `{ criterionId: null, valence: <anything> }` is not, and cannot be produced
 * here — the instrument only appears once a criterion is chosen.
 */
export interface Mark {
  criterionId: string | null;
  valence: number | null;
}

/** No placement at all, which is what an ordinary reading note carries. */
export const NO_MARK: Mark = { criterionId: null, valence: null };

/**
 * **The five positions, and the only place the mapping from a pressed label to
 * a stored number is written down.**
 *
 * Exported because tests/referee-placement.test.tsx derives its cases from it:
 * a sixth position cannot be added without every one of those cases seeing it,
 * and the labels the test presses are the labels the instrument draws rather
 * than a second copy that can drift.
 *
 * `end` names the pole the position leans towards, or `null` for the middle —
 * which is a real answer meaning *neither way*, not an absence, and is the
 * commonest one. `valenceStep` maps these five onto ramp steps 0/2/4/6/8, and
 * `markProblem` accepts all five unchanged.
 */
export const PLACEMENT_STEPS = [
  { valence: -100, degree: "clearly", end: "against" },
  { valence: -50, degree: "leans", end: "against" },
  { valence: 0, degree: null, end: null },
  { valence: 50, degree: "leans", end: "favour" },
  { valence: 100, degree: "clearly", end: "favour" },
] as const;

export type PlacementStep = (typeof PLACEMENT_STEPS)[number];

/**
 * What one position says, in this criterion's own pole words.
 *
 * The middle borrows `valenceWords(0)` rather than spelling "counts neither
 * way" a second time — one wording function, as this file's header says.
 */
export function placementLabel(step: PlacementStep, poles: RefereePoles): string {
  return step.end === null ? valenceWords(0) : `${step.degree} ${poles[step.end]}`;
}

/** The step a stored valence came from, or `null` if it came from elsewhere. */
function stepOf(valence: number): PlacementStep | null {
  return PLACEMENT_STEPS.find((s) => s.valence === valence) ?? null;
}

/**
 * How a placement reads back — the label, then the number, then the swatch.
 *
 * That order is docs/project/colour-scales.md's, and it is the same order
 * `valenceLabel` uses: words first, colour last and never alone. A valence that
 * is not one of the five (a placement made by some future instrument, or by the
 * API directly) falls back to the direction in words, so there is no state this
 * cannot describe.
 *
 * **Exported for `CriteriaPanel`**, which prints the referee's placement beside
 * the model's on a row they both reached. That is an import in the safe
 * direction — a wording function travelling *out* of this file — and it is what
 * keeps "leans underpowered" one string rather than two. Nothing about the
 * model travels the other way; this file still renders no `DivergingResult`,
 * which is the rule the header states and tests/referee-placement.test.tsx
 * checks by rendering the section with loud model valences in scope.
 */
export function placementWords(valence: number, poles: RefereePoles): string {
  const step = stepOf(valence);
  return step ? placementLabel(step, poles) : valenceWords(valence);
}

type DivergingConfig = Extract<RefereeCriterionConfig, { kind: "diverging" }>;

/** A criterion with two ends — the only kind a placement may go on. */
interface DivergingCriterion extends SavedCriterionState {
  config: DivergingConfig;
}

/**
 * **Only the criteria that can hold a signed number.**
 *
 * `markProblem` refuses a placement on a `single` or a `literature` criterion,
 * because a signed number against a criterion with no ends is signed against
 * nothing and the panel has no poles to print it between. Offering them here
 * would make that an error the referee can only find by hitting it.
 */
function divergingOnly(criteria: readonly SavedCriterionState[]): DivergingCriterion[] {
  return criteria.filter((c): c is DivergingCriterion => c.config.kind === "diverging");
}

/** How a criterion reads in the picker: the referee's words, then both ends. */
function pickerLabel(criterion: DivergingCriterion): string {
  const { against, favour } = criterion.config.poles;
  return `${criterion.criterion} — ${against} ↔ ${favour}`;
}

/* Reader-facing, and each is a fact about *this app* rather than about the
   paper — docs/project/copy.md. None of them is a failure message, so none
   carries a bracketed code. */
export const PLACE_HEADING = "Place on a criterion";
export const NO_CRITERIA_TO_PLACE_ON =
  "You have no criteria with two ends on this article yet. Criteria, in Referee mode, is where you write one.";
export const PLACING_IS_OPTIONAL = "Optional — a comment with no criterion is an ordinary note.";

interface Props {
  /** The article. Only ever read; nothing here runs a criterion. */
  slug: string;
  /** The placement as it stands. The instrument is controlled by this, never by its own state. */
  value: Mark;
  onChange(next: Mark): void;
  /**
   * Show the placement that is already stored, above the instrument.
   *
   * `CommentDialog` passes the criterion's poles' words and the signed number,
   * because there the referee is about to overwrite a judgement they made
   * earlier and v1 keeps no history of it — the plan accepts that, and the
   * answer to "not silent" is that the overwrite is visibly a change to
   * something that was already there. `AnnotateDialog` has nothing to show.
   */
  showCurrent?: boolean;
}

/**
 * The section itself: a picker of the referee's criteria, and the instrument
 * underneath it in that criterion's pole words.
 *
 * **The criteria are fetched here rather than threaded in**, and that is a
 * decision. `CriteriaBand` only mounts on the `criteria` sub-mode, so a list
 * lifted out of it would be empty on Mirror, Claims and Candidates — three of
 * the four places a referee selects prose. Mounting the existing hook here
 * costs one GET, and only when a referee actually selects a passage.
 */
export function PlaceOnCriterion({ slug, value, onChange, showCurrent }: Props) {
  const { criteria, loaded, loadFailed } = useCriteria(slug);
  const pickerId = useId();
  const choices = divergingOnly(criteria);
  const chosen = choices.find((c) => c.id === value.criterionId) ?? null;

  return (
    <section className="place" aria-label={PLACE_HEADING}>
      <div className="place-head">
        <span className="place-title">{PLACE_HEADING}</span>
        <span className="place-optional">{PLACING_IS_OPTIONAL}</span>
      </div>

      {/* Three states, not two: *we have not asked yet*, *we asked and it did
          not come back*, and *there is nothing to place on*. The middle one is
          the half `loaded` cannot carry — useCriteria.ts says why. */}
      {!loaded && <p className="place-note">Loading your criteria…</p>}
      {loaded && loadFailed && (
        <p className="place-note">Your criteria could not be loaded, so there is nothing to place this on yet.</p>
      )}
      {loaded && !loadFailed && choices.length === 0 && (
        <p className="place-note">{NO_CRITERIA_TO_PLACE_ON}</p>
      )}

      {choices.length > 0 && (
        <>
          {/* A native `<select>`, for `ChatPanel`'s reason: this sits inside the
              reading view, where ↑ / ↓ step the article and ← / → choose the
              stride, and a second custom radiogroup here would be a third
              claimant on those keys. A select has the whole keyboard for free
              and announces itself correctly.

              **And it needs no `stopPropagation`**, unlike the composer's,
              which carries one. `keynav.ts` already skips a key typed into a
              `SELECT` along with an `INPUT` and a `TEXTAREA`, so a stop here
              would buy nothing and would cost the reader Escape — which closes
              this dialog from a window listener. */}
          <label className="place-pick" htmlFor={pickerId}>
            <span className="place-pick-label">Criterion</span>
            <select
              id={pickerId}
              value={value.criterionId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                /* Clearing the picker clears the number with it: a valence with
                   nothing to place it on is a number against nothing, and the
                   database says so as well (`comments_valence_needs_criterion`).
                   Changing to a *different* criterion keeps it — re-placing on
                   the right criterion should not mean starting again. */
                onChange(id === "" ? NO_MARK : { criterionId: id, valence: value.valence });
              }}
            >
              <option value="">Not placed</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickerLabel(c)}
                </option>
              ))}
            </select>
          </label>

          {chosen && (
            <>
              {showCurrent && value.valence !== null && (
                <p className="place-current">
                  {/* Words, then the number, then the colour — never the colour
                      alone, and never the colour first. colour-scales.md. */}
                  <span className="place-current-label">
                    Now: {placementWords(value.valence, chosen.config.poles)}
                  </span>
                  <span className="place-current-number">{signedValence(value.valence)}</span>
                  <span
                    className="place-swatch"
                    style={{ background: valenceToken(chosen.config.scale, value.valence) }}
                    aria-hidden="true"
                  />
                </p>
              )}

              <Instrument
                poles={chosen.config.poles}
                scale={chosen.config.scale}
                criterion={chosen.criterion}
                valence={value.valence}
                onPick={(valence) => onChange({ criterionId: chosen.id, valence })}
              />

              {/* Offered as soon as there is a criterion, not only once there
                  is a number: naming a criterion is itself a placement — it is
                  what makes a note a review comment — and "put the picker back
                  to Not placed" is a thing the referee has to work out rather
                  than a thing they can press. */}
              <button
                type="button"
                className="linky place-clear"
                onClick={() => onChange(NO_MARK)}
              >
                Clear placement
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The five buttons.
 *
 * **A `role="radiogroup"` of buttons with no arrow-key handling**, which is the
 * shape `Dock.tsx`, `SearchPanel.tsx` and `RefereeViews` all landed on and for
 * the same reason: the roles are the honest description — one of these is on,
 * choosing another turns this one off — but on this page ↑ / ↓ step the article
 * and ← / → choose the stride, and a group that swallowed them would leave the
 * reader's keyboard dead while a position had focus. Greg met that as a bug on
 * 2026-08-31. So every button is its own tab stop, Enter, Space or a click
 * selects, and nothing here calls `stopPropagation` on a key.
 * tests/arrows-belong-to-the-article.test.tsx sweeps every `role="radio"` in
 * the client for exactly this.
 */
function Instrument({
  poles,
  scale,
  criterion,
  valence,
  onPick,
}: {
  poles: RefereePoles;
  scale: DivergingConfig["scale"];
  criterion: string;
  valence: number | null;
  onPick(valence: number): void;
}) {
  return (
    <div
      className="place-scale"
      role="radiogroup"
      /* The criterion's own words, because "How this passage counts" on its own
         would be five radio buttons about nothing to a screen reader. */
      aria-label={`How this passage counts on: ${criterion}`}
    >
      {PLACEMENT_STEPS.map((step) => {
        const label = placementLabel(step, poles);
        const on = valence === step.valence;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern and the call Dock.tsx, SearchPanel.tsx, DiagramPanel.tsx and App.tsx's RefereeViews already make — a real <input type="radio"> cannot carry a swatch beside its label without hiding the input and faking every state it already had
          <button
            key={step.valence}
            type="button"
            role="radio"
            aria-checked={on}
            /* Every position its own tab stop, written out although a button
               already has one. A roving `tabIndex={x ? 0 : -1}` is inseparable
               from arrow navigation — one tab stop for the group, navigable
               only because the arrows move within it — so
               tests/arrows-belong-to-the-article.test.tsx sweeps every radio in
               the client for this literal string, and saying it here is what
               tells "deliberately five tab stops" from "nobody thought about
               it". Note for whoever edits this comment: that sweep reads to the
               end of the opening tag, so an angle bracket in here truncates it
               and the check passes over nothing. */
            tabIndex={0}
            className={`place-step${on ? " on" : ""}`}
            onClick={() => onPick(step.valence)}
          >
            {/* Decoration on top of the words, never instead of them: delete
                this span and every position is still legible, which is the
                condition src/web/valence.ts states for the red↔green ramp
                being permitted at all. */}
            <span
              className="place-swatch"
              style={{ background: valenceToken(scale, step.valence) }}
              aria-hidden="true"
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
