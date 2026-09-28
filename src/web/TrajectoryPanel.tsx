/**
 * The Trajectory, in the band between the spine and the prose: a route through
 * the article's own Quotes, walked at three depths. The stops are read in the
 * prose, where they sit; this band only says where to stand and in what order.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client) is the design; docs/project/trajectory.md the vision.
 * Three things to know before changing anything here:
 *
 * ## The cue is shown on the current row only
 *
 * Every other row shows where its stop is — the section path, read from the
 * tree — and not its cue. At Most there can be thirty rows, and thirty
 * generated lines would be a summary a reader could read *instead of* the
 * paper, which is vision.md's anti-goal exactly. The cue names what to look
 * for, never what the passage found (src/trajectory.ts), and one at a time. An
 * old route has a role instead, and that is drawn in its place.
 *
 * ## The stop card: the scrapbook, by juxtaposition
 *
 * Under the current row, and only there, whatever the other modes have
 * *already* written about this paragraph — src/web/stop-card.ts gathers it.
 * Nothing on it is generated for it, nothing starts a run, and when there is
 * nothing there is no card and no sentence asking for one. The term chips
 * open to one line and a link; ideas and events link into their modes, while
 * the FAQ question is text because its passage is the stop already open. The
 * tying-together is the juxtaposition, not a synthesis (Sol F21).
 *
 * ## The head is pinned
 *
 * `‹ Stop k of N ›` and the depth control sit in `ModeSurface`'s head, which is
 * outside the scroller (`.band-head` is `flex: none`), so they stay put while
 * the list scrolls.
 *
 * ## The depth control is three buttons, not a slider
 *
 * There are exactly three positions, and three buttons are easier to hit on an
 * iPad (Sol and Opus agreed). Only the depths that add stops are drawn
 * (`offeredDepths`). Each is a real `<button>` and its own tab stop, with
 * `aria-pressed` — keyboard.md's rule that arrow keys belong to the article.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw, Route, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseTrajectory } from "./useTrajectory.js";
import type { TrajectoryView } from "./modes/trajectory/TrajectoryMode.js";
import { entryProse } from "./GlossaryPanel.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";
import { type CardTarget, cardIsEmpty, type StopCard } from "./stop-card.js";

/** One row of the list. Built by `useTrajectoryMode`, drawn here. */
export interface TrajectoryRow {
  quoteId: string;
  /** Its number on this pass, from 1. */
  n: number;
  /** The section path, `Results › Robustness`, or `null` if the tree does not cover it. */
  place: string | null;
  /**
   * What to look for in the passage — the stop's cue, or an old route's role
   * where it has no cue. Drawn on the current row only.
   */
  cue: string | null;
  /** From a shallower pass — already seen on the way round. Dimmed. */
  seen: boolean;
  current: boolean;
  /** Its quote is no longer in the Quotes. */
  missing: boolean;
  /**
   * How far through the article the stop's block sits, 0 to 1, in words —
   * `positionOf` (trajectory-route.ts). `null` when it cannot be placed.
   */
  position: number | null;
}

/**
 * **Where the stop sits in the article** — a thin track with a dot on it, the
 * same width on every row, so down the list the dots zig-zag when the route
 * jumps from the results back to the methods. A hint, not a chart: drawn for
 * the eye only, and said in words for a screen reader. The plan's stage 5b.
 */
function StopPosition({ at, current }: { at: number; current: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, at)) * 100);
  return (
    <>
      <span className="traj-pos" aria-hidden="true">
        <span className={`traj-pos-dot${current ? " on" : ""}`} style={{ left: `${pct}%` }} />
      </span>
      <span className="traj-pos-said sr-only">about {pct}% of the way through</span>
    </>
  );
}

/**
 * **The honest promise**, pinned under the list. The first half is what the
 * mode can prove — the passages are the Quotes' own, checked against the
 * article by that step; the second is what it cannot.
 */
export function trajectoryPromise(profiled: boolean): string {
  return profiled
    ? "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, shaped by your profile."
    : "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, for somebody reading the piece for the first time.";
}

/**
 * At Most, how much of the Quotes the route walks — *"every one of the
 * article's N quotes"*, or *"M of N"*. `null` below Most, or with no Quotes.
 */
export function coverageNote(atMost: number, quotes: number): string | null {
  if (quotes === 0) return null;
  if (atMost >= quotes) return `This pass stops at every one of the article's ${quotes} quotes.`;
  return `This pass stops at ${atMost} of the article's ${quotes} quotes.`;
}

/**
 * **Why the route is out of date, in one sentence — or `null`.** One banner, the
 * most serious first: stale can mean a stop's passage has gone; the other two
 * only that we would plan it differently now.
 */
export function outdatedBy(
  owner: Pick<UseTrajectory, "stale" | "notOnRoute" | "profileChanged" | "outdated">,
): string | null {
  if (owner.stale) {
    const n = owner.notOnRoute;
    return n > 0
      ? `The Quotes have changed since this route was planned, and ${n} ${n === 1 ? "is" : "are"} not on it.`
      : "The Quotes have changed since this route was planned.";
  }
  if (owner.profileChanged) return "This route was planned before your profile said what it says now.";
  if (owner.outdated) return "This route was planned by an older version of the prompt.";
  return null;
}

/**
 * **The pinned head**: the stepper, and the depth control when there is more
 * than one depth to offer.
 */
function RouteHead({ view, total }: { view: TrajectoryView; total: number }) {
  return (
    <div className="traj-head">
      <div className="traj-stepper">
        <button
          type="button"
          className="traj-arrow"
          aria-label="Previous stop"
          disabled={view.position <= 1}
          onClick={() => view.onStep(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="traj-count" aria-live="polite">
          Stop {view.position} of {total}
        </span>
        <button
          type="button"
          className="traj-arrow"
          aria-label="Next stop"
          disabled={view.position >= total}
          onClick={() => view.onStep(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {view.depths.length > 1 && (
        <fieldset className="traj-depths" aria-label="How deep">
          {view.depths.map((d) => (
            <button
              key={d.depth}
              type="button"
              className={`traj-depth${d.depth === view.depth ? " on" : ""}`}
              aria-pressed={d.depth === view.depth}
              onClick={() => {
                if (d.depth !== view.depth) view.onDepth(d.depth);
              }}
            >
              <span>{d.label}</span>
              <span className="traj-depth-n">{d.count}</span>
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}

interface Props {
  owner: UseTrajectory;
  view: TrajectoryView;
  /** How many quotes the article has now — for the coverage note at Most. */
  quoteCount: number;
}

export function TrajectoryPanel({ owner, view, quoteCount }: Props) {
  useRenderCount("TrajectoryPanel");
  const route = owner.trajectory;
  const ready = route !== null && owner.status === "ready";
  const total = view.rows.length;
  const deepest = view.depths.at(-1)?.depth ?? null;
  const atMost = ready && view.depth !== null && view.depth === deepest && view.depth === 3;

  /**
   * @param again whether this is the button beside a route already there. The
   *   empty state's must be `ensure`, the automatic run's own request, or it
   *   buys a second model call — useIdeas.ts § `ensure`.
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
      step="trajectory"
      icon={<Route size={13} />}
      runningLabel="Planning the route…"
    />
  );

  return (
    <ModeSurface
      label="Trajectory"
      feature="gloss trajectory"
      /* **A head that stays put**: the stepper and the depth control, pinned
         above the scroller. Present only when there is a route to step — no
         empty row over the loading sentence (new-mode.md § the header row). */
      head={ready && total > 0 && view.depth !== null ? <RouteHead view={view} total={total} /> : null}
      foot={
        ready && total > 0 ? (
          <div className="traj-foot">
            <p className="traj-note">{trajectoryPromise(route.profileHash !== null)}</p>
            {atMost && coverageNote(total, quoteCount) && (
              <p className="traj-note">{coverageNote(total, quoteCount)}</p>
            )}
            {/* **Plan it again**, pinned under the list as Ideas' and
                Timeline's are — the plan's stage 5e. It rebuilds the route
                only: Quotes is an unforced prerequisite on the request, so the
                server checks its currency, while `useStepJob` names only
                Trajectory in `force`. Quotes has its own button for replacing
                a current list. Not drawn while the outdated banner is up,
                which offers the same press already. */}
            {!outdatedBy(owner) && <div className="traj-again">{run("Plan it again", true)}</div>}
          </div>
        ) : null
      }
    >
      {owner.error && (
        <div className="traj-read-error">
          <p className="gloss-error" role="alert">
            {owner.error}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void owner.retryRead()}>
            <RotateCw size={13} />
            Try again
          </Button>
        </div>
      )}

      {owner.status === "loading" && <p className="gloss-quiet">Looking for the route…</p>}

      {owner.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has planned a route through this piece yet.</p>
          <p className="gloss-hint">
            {owner.quotesFirst
              ? "The article's Quotes are chosen first, then a short model pass puts them in an order — longer than the order alone. Written once and kept."
              : "A short model pass puts the article's Quotes in an order, and takes a few seconds. Written once and kept."}
          </p>
          {run("Plan the route")}
        </div>
      )}

      {ready && (
        <>
          {outdatedBy(owner) && (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                {outdatedBy(owner)}
              </p>
              {run("Plan it again", true)}
            </div>
          )}

          {total === 0 && <p className="gloss-quiet">This route has no stops.</p>}

          {total > 0 && (
            <div className="tl-scroll">
              <ol className="traj-list">
                {view.rows.map((row, index) => {
                  const repeatedPlace =
                    row.place !== null && row.place === view.rows[index - 1]?.place;
                  return (
                    <li
                      key={row.quoteId}
                      className={`traj-row${row.current ? " current" : ""}${row.seen ? " seen" : ""}`}
                      data-stop={row.quoteId}
                    >
                      <button
                        type="button"
                        className="traj-go"
                        aria-current={row.current ? "step" : undefined}
                        disabled={row.missing}
                        onClick={() => view.onRow(row.quoteId)}
                      >
                        <span className="traj-n">{row.n}</span>
                        <span className="traj-what">
                          <span className="traj-place">
                            {repeatedPlace ? (
                              <>
                                <span className="traj-place-repeat" aria-hidden="true">
                                  〃
                                </span>
                                <span className="sr-only">{row.place}</span>
                              </>
                            ) : (
                              (row.place ?? "—")
                            )}
                          </span>
                          {row.current && row.cue && <span className="traj-cue">{row.cue}</span>}
                        </span>
                        {row.position !== null && <StopPosition at={row.position} current={row.current} />}
                      </button>
                      {row.current && view.card && !cardIsEmpty(view.card) && (
                        <StopCardView
                          key={row.quoteId}
                          card={view.card}
                          onOpen={view.onOpen}
                          canOpen={view.canOpen}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </>
      )}
    </ModeSurface>
  );
}

/**
 * **The stop card** — see the file header. One cluster per artefact that has
 * something for this paragraph, in a fixed order: the words first (they are
 * what trips a skimmer), then the ideas, the question, and the study.
 *
 * Keyed on the stop by its caller, so an open chip closes when the reader
 * steps on.
 */
function StopCardView({
  card,
  onOpen,
  canOpen,
}: {
  card: StopCard;
  onOpen(target: CardTarget): void;
  canOpen(target: CardTarget): boolean;
}) {
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const open = card.terms.find((t) => t.entry.id === openTerm) ?? null;
  const lead = open ? entryProse(open.entry).lead : "";
  return (
    <div className="traj-card">
      {card.terms.length > 0 && (
        <section className="traj-cluster" aria-label="Terms it uses">
          <p className="traj-cluster-h">Terms it uses</p>
          <div className="traj-chips">
            {card.terms.map(({ entry, alsoAt }) => (
              <button
                key={entry.id}
                type="button"
                className={`traj-chip${entry.id === openTerm ? " on" : ""}`}
                aria-expanded={entry.id === openTerm}
                onClick={() => setOpenTerm((was) => (was === entry.id ? null : entry.id))}
              >
                {entry.name}
                {alsoAt !== null && <span className="traj-also">also at stop {alsoAt}</span>}
              </button>
            ))}
          </div>
          {open && (
            <div className="traj-sense">
              {lead && <p>{lead}</p>}
              {canOpen({ kind: "term", id: open.entry.id }) && (
                <button
                  type="button"
                  className="traj-link"
                  onClick={() => onOpen({ kind: "term", id: open.entry.id })}
                >
                  In the glossary ›
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {card.ideas.length > 0 && (
        <section className="traj-cluster" aria-label="Ideas it bears on">
          <p className="traj-cluster-h">Ideas it bears on</p>
          <ul>
            {card.ideas.map((idea) => (
              <li key={idea.id}>
                {canOpen({ kind: "idea", id: idea.id }) ? (
                  <button type="button" className="traj-link" onClick={() => onOpen({ kind: "idea", id: idea.id })}>
                    {idea.name}
                  </button>
                ) : (
                  <span>{idea.name}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {card.questions.length > 0 && (
        <section className="traj-cluster" aria-label="The question it answers">
          <p className="traj-cluster-h">
            {card.questions.length === 1 ? "The question it answers" : "Questions it answers"}
          </p>
          <ul>
            {card.questions.map((q) => (
              <li key={q.id}>
                <span className="traj-question">{q.question}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {card.events.length > 0 && (
        <section className="traj-cluster" aria-label="Where it sits in the study">
          <p className="traj-cluster-h">Where it sits in the study</p>
          <ul>
            {card.events.map((event) => (
              <li key={event.id}>
                {canOpen({ kind: "event", id: event.id }) ? (
                  <button type="button" className="traj-link" onClick={() => onOpen({ kind: "event", id: event.id })}>
                    {event.label}
                  </button>
                ) : (
                  <span>{event.label}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * **The door after the current stop's block** — "Next stop ›", or at the end
 * of a pass "Go round again — More ›". It is there because on an iPad the
 * reader's eyes and thumb are in the prose after reading a stop, and on a
 * narrow window the band has stepped aside altogether (F4).
 *
 * Drawn by `TableView` after the block's prose, outside `.prose`, on the path
 * `PdfFigureNotes` already uses (TableView.tsx § After the prose) — so it
 * shifts no comment anchor.
 */
export function TrajectoryDoor({
  label,
  cue,
  onPress,
  onRoute,
}: {
  label: string | null;
  /**
   * The cue of the stop the door leads to, drawn small and muted under it, so
   * the door says where it goes. `null` for none, or an old route.
   */
  cue: string | null;
  onPress(): void;
  /** Bring the band back — offered only while it has stepped aside. */
  onRoute: (() => void) | null;
}) {
  if (label === null && onRoute === null) return null;
  return (
    <div className="traj-door">
      <div className="traj-door-row">
        {onRoute && (
          <button type="button" className="traj-door-btn quiet" onClick={onRoute}>
            <Route size={14} />
            All stops
          </button>
        )}
        {label && (
          <button type="button" className="traj-door-btn" onClick={onPress}>
            {label}
          </button>
        )}
      </div>
      {label && cue && <p className="traj-door-cue">{cue}</p>}
    </div>
  );
}
