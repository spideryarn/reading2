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
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, Route, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseTrajectory } from "./useTrajectory.js";
import type { DoorView, TrajectoryView } from "./modes/trajectory/TrajectoryMode.js";
import { entryProse } from "./GlossaryPanel.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";
import { snippet } from "./citations.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
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
  /**
   * The quote's own words — `Quote.text`, the article's characters, never a
   * model's. `null` when its quote has gone. Drawn cut short on every row but
   * the current one, the whole of it in a tooltip (plan 260928e).
   */
  words: string | null;
}

/**
 * **How much of a quote a row shows** before it is cut, in characters — about
 * two lines at the band's width. The current row shows all of it.
 */
export const WORDS_ON_A_ROW = 100;

/**
 * **The quote on a row**, in quotation marks: the whole of it on the current
 * row, otherwise cut on a word boundary with the whole of it in a tooltip —
 * on hover, and on focus since the row is a button. A quote that fits gets no
 * tooltip, which would only repeat it. Touch has no hover, so what a finger
 * gets is the tap: that makes the row current, and the current row is whole.
 *
 * Why a character cut and not CSS `line-clamp`: the clamp cannot say whether
 * it cut, and this decides whether there is a tooltip at all.
 */
function rowWords(row: TrajectoryRow): { shown: string; whole: string | null } | null {
  if (row.words === null) return null;
  const clean = row.words.replace(/\s+/g, " ").trim();
  if (clean === "") return null;
  if (row.current) return { shown: clean, whole: null };
  const cut = snippet(clean, WORDS_ON_A_ROW);
  return { shown: cut, whole: cut === clean ? null : clean };
}

/**
 * **Where the stop sits in the article** — a short vertical hairline under the
 * row's number, with a dot on it: the top of the line is the start of the
 * article, the bottom its end, the way the spine draws it. A hint, not a chart:
 * drawn for the eye only, and said in words for a screen reader. The plan's
 * stage 5b; vertical, in the number's column, since plan 260929a § 4 — it was
 * a horizontal track in a column of its own, about 53px of a band that can be
 * 280px wide (Greg, SPIDERYARN-READING2-4D).
 */
function StopPosition({ at, current }: { at: number; current: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, at)) * 100);
  return (
    <>
      <span className="traj-pos" aria-hidden="true">
        <span className={`traj-pos-dot${current ? " on" : ""}`} style={{ top: `${pct}%` }} />
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
 * At Most, how much of the Quotes offered to this route it walks — *"every one
 * of the N quotes offered to this route"*, or *"M of N"*. The denominator is
 * the route's stored `offered`, not today's raw Quotes count: abstract quotes
 * were deliberately never offered. `null` below Most, or with no Quotes.
 */
export function coverageNote(atMost: number, offered: number): string | null {
  if (offered === 0) return null;
  if (atMost >= offered) {
    return `This pass stops at every one of the ${offered} quotes offered to this route.`;
  }
  return `This pass stops at ${atMost} of the ${offered} quotes offered to this route.`;
}

/**
 * **Why the route is out of date, in one sentence — or `null`.** One banner, the
 * most serious first: stale can mean a stop's passage has gone; the other two
 * only that we would plan it differently now.
 */
/**
 * **What pressing *Plan the route* will make, said before the press** (Sol
 * F64). Since stage 6 the route waits for the Ideas, a whole-article call of
 * tens of seconds beside a route of a few, so the sentence names what goes
 * first and which part is the long one.
 */
export function emptyHint(owner: Pick<UseTrajectory, "quotesFirst" | "ideasFirst">): string {
  const kept = "Written once and kept.";
  if (owner.quotesFirst && owner.ideasFirst) {
    return (
      "First the article's Quotes are chosen and its key Ideas found — finding the Ideas is the " +
      "long part, tens of seconds — then a short model pass puts the Quotes in an order that " +
      `covers the Ideas. ${kept}`
    );
  }
  if (owner.ideasFirst) {
    return (
      "First the article's key Ideas are found — the long part, tens of seconds — then a short " +
      `model pass puts its Quotes in an order that covers them. ${kept}`
    );
  }
  if (owner.quotesFirst) {
    return (
      "The article's Quotes are chosen first, then a short model pass puts them in an order — " +
      `longer than the order alone. ${kept}`
    );
  }
  return `A short model pass puts the article's Quotes in an order, and takes a few seconds. ${kept}`;
}

export function outdatedBy(
  owner: Pick<UseTrajectory, "stale" | "profileChanged" | "outdated">,
): string | null {
  if (owner.stale) {
    /* One input hash covers all three, so this read cannot honestly attribute
       the mismatch to Quotes. `notOnRoute` is also only a present-day count: a
       route may deliberately omit a quote, so it is not evidence that quote
       arrived later. */
    return "The Quotes, Ideas, or outline have changed since this route was planned.";
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
        {/* Enabled on stop 1 too, where it goes to stop 1's passage again —
            ← does the same (SPIDERYARN-READING2-4K), and the keys may not do
            more than the buttons. */}
        <button
          type="button"
          className="traj-arrow"
          aria-label={view.position <= 1 ? "Back to stop 1" : "Previous stop"}
          title={view.position <= 1 ? "Back to stop 1" : undefined}
          disabled={view.position < 1}
          onClick={() => view.onStep(-1)}
        >
          <ChevronLeft size={20} />
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
          <ChevronRight size={20} />
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
}

export function TrajectoryPanel({ owner, view }: Props) {
  useRenderCount("TrajectoryPanel");
  const route = owner.trajectory;
  const ready = route !== null && owner.status === "ready";
  const total = view.rows.length;
  const deepest = view.depths.at(-1)?.depth ?? null;
  const atMost = ready && view.depth !== null && view.depth === deepest && view.depth === 3;
  /** The row whose whole quote is up — one at a time, and only by mouse or focus. */
  const [tipFor, setTipFor] = useState<string | null>(null);
  /* A depth or route refresh can remove an open row, so its Tooltip unmounts
     before it can report that it closed. Do not let that stale id reopen if
     the row later returns. The enabled check also covers words disappearing. */
  useEffect(() => {
    if (tipFor === null) return;
    const row = ready ? view.rows.find((candidate) => candidate.quoteId === tipFor) : undefined;
    if (row === undefined || !rowWords(row)?.whole) setTipFor(null);
  }, [ready, tipFor, view.rows]);

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
            {atMost && coverageNote(total, route.offered) && (
              <p className="traj-note">{coverageNote(total, route.offered)}</p>
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
          <p className="gloss-hint">{emptyHint(owner)}</p>
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
              <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
                <ol className="traj-list">
                  {view.rows.map((row, index) => {
                    const repeatedPlace =
                      row.place !== null && row.place === view.rows[index - 1]?.place;
                    const words = rowWords(row);
                    const go = (
                      <button
                        type="button"
                        className="traj-go"
                        aria-current={row.current ? "step" : undefined}
                        disabled={row.missing}
                        onClick={() => view.onRow(row.quoteId)}
                      >
                        <span className="traj-n">
                          {row.n}
                          {row.position !== null && <StopPosition at={row.position} current={row.current} />}
                        </span>
                        <span className="traj-what">
                          {/* A repeated section is said, not drawn: a ditto mark
                              beside a quotation reads as another quotation mark,
                              which is the report behind plan 260928e. */}
                          {repeatedPlace ? (
                            <span className="sr-only">{row.place}</span>
                          ) : (
                            <span className="traj-place">{row.place ?? "—"}</span>
                          )}
                          {words && <span className="traj-words">“{words.shown}”</span>}
                          {row.current && row.cue && <span className="traj-cue">{row.cue}</span>}
                        </span>
                      </button>
                    );
                    return (
                      <li
                        key={row.quoteId}
                        className={`traj-row${row.current ? " current" : ""}${row.seen ? " seen" : ""}`}
                        data-stop={row.quoteId}
                      >
                        {/* Always wrapped, enabled only while the row is cut, so the
                            button is never remounted as its row becomes current.
                            Controlled, which makes it mouse-only: a tap's
                            synthetic hover must not flash it (Sol, plan review). */}
                        <Tooltip
                          content={words?.whole ? <p>“{words.whole}”</p> : null}
                          enabled={Boolean(words?.whole)}
                          open={tipFor === row.quoteId}
                          onOpenChange={(open) =>
                            setTipFor((was) => (open ? row.quoteId : was === row.quoteId ? null : was))
                          }
                          className="traj-words-tip"
                        >
                          {go}
                        </Tooltip>
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
              </TooltipGroup>
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
 * **The door after the current stop's block** — "Next stop ›" mid-pass, and at
 * the end of a pass two buttons: *Go round again* (stop 1 of this pass) and
 * *More detail ›* (stop 1 of the next deeper pass, when there is one). It was
 * one button, "Go round again — More ›", until Greg found it confusing
 * (SPIDERYARN-READING2-4N, plan 260929a § 2). It is there because on an iPad
 * the reader's eyes and thumb are in the prose after reading a stop, and on a
 * narrow window the band has stepped aside altogether (F4).
 *
 * Drawn by `TableView` after the block's prose, outside `.prose`, on the path
 * `PdfFigureNotes` already uses (TableView.tsx § After the prose) — so it
 * shifts no comment anchor.
 */
export function TrajectoryDoor({
  door,
  onNext,
  onAgain,
  onDeeper,
  onRoute,
}: {
  door: DoorView | null;
  onNext(): void;
  onAgain(): void;
  onDeeper(): void;
  /** Bring the band back — offered only while it has stepped aside. */
  onRoute: (() => void) | null;
}) {
  if (door === null && onRoute === null) return null;
  return (
    <div className="traj-door">
      <div className="traj-door-row">
        {onRoute && (
          <button type="button" className="traj-door-btn quiet" onClick={onRoute}>
            <Route size={14} />
            All stops
          </button>
        )}
        {door?.kind === "next" && (
          <button type="button" className="traj-door-btn" onClick={onNext}>
            Next stop ›
          </button>
        )}
        {door?.kind === "end" && (
          <>
            <button type="button" className={`traj-door-btn${door.deeper ? " quiet" : ""}`} onClick={onAgain}>
              <RotateCcw size={14} />
              Go round again
            </button>
            {door.deeper && (
              <button
                type="button"
                className="traj-door-btn"
                title={`Go round at ${door.deeper}, with more stops between these`}
                onClick={onDeeper}
              >
                More detail ›
              </button>
            )}
          </>
        )}
      </div>
      {/* Where the door leads: the next stop's cue, small and muted — or, at
          the end of a pass, which pass has ended, since two doors lead to two
          different places. */}
      {door?.kind === "next" && door.cue && <p className="traj-door-cue">{door.cue}</p>}
      {door?.kind === "end" && (
        <p className="traj-door-cue">
          End of {door.pass} — {door.count} {door.count === 1 ? "stop" : "stops"}.
        </p>
      )}
    </div>
  );
}
