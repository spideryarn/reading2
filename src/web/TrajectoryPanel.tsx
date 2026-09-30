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
 * nothing there is no card and no sentence asking for one. Term and idea chips
 * open to one line and an icon into their mode; the FAQ question sits above
 * the row and opens its checked passages there. Events still link into their
 * mode. The tying-together is the juxtaposition, not a synthesis (Sol F21).
 *
 * ## The head is pinned, and the list follows the stop
 *
 * `‹ Stop k of N ›` and the depth control sit in `ModeSurface`'s head, which is
 * outside the scroller (`.band-head` is `flex: none`), so they stay put while
 * the list scrolls. When the current stop changes, by any path, the list's own
 * scroller (`.tl-scroll`) is nudged to show its row — `useFollow`, Summary's
 * machinery, which sets that scroller's `scrollTop` and never touches the
 * page, so it cannot fight the prose scroll landing the passage
 * (SPIDERYARN-READING2-54). The promise about where the passages come from is
 * an info button's tooltip in the head, not a paragraph in the foot
 * (SPIDERYARN-READING2-52).
 *
 * ## The depth control is three buttons, not a slider
 *
 * There are exactly three positions, and three buttons are easier to hit on an
 * iPad (Sol and Opus agreed). Only the depths that add stops are drawn
 * (`offeredDepths`). Each is a real `<button>` and its own tab stop, with
 * `aria-pressed` — keyboard.md's rule that arrow keys belong to the article.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  BadgeQuestionMark,
  BookA,
  ChevronLeft,
  ChevronRight,
  Info,
  Lightbulb,
  RotateCw,
  Route,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseTrajectory } from "./useTrajectory.js";
import type { PublicTrajectory } from "../public-types.js";
import type { DoorView, TrajectoryView } from "./modes/trajectory/TrajectoryMode.js";
import { FOLLOW_ATTR, useFollow } from "./follow.js";
import { entryProse } from "./GlossaryPanel.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { PurposeLine } from "./TrajectoryPurpose.js";
import { useRenderCount } from "./perf.js";
import { snippet } from "./citations.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import type { CardQuestion, CardTarget, StopCard } from "./stop-card.js";
import { sparkline, sparkWidth } from "./route-spark.js";
import type { WhereRow } from "./where.js";
import { WhereCard } from "./WhereCard.js";

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
  /** Where it sits in the article's outline, for its position mark's card — `[]` for none (260929f § 3). */
  where: readonly WhereRow[];
}

/**
 * **Which snippet is open on the current stop** — one at a time across the
 * row and its card (Sol, plan 260929f F4): a term's sense, an idea's
 * statement, or a FAQ question's passages. Held by the panel, not the card,
 * because a question sits above the row and the rest below it, and the list's
 * follow-scroll has to re-measure when one opens. `stop` ties it to the stop it
 * was opened on, so it is hidden during a step before the cleanup effect
 * forgets it permanently.
 */
interface OpenSnippet {
  stop: string;
  kind: "term" | "idea" | "faq";
  id: string;
}

/**
 * **Navigation is an icon with a tooltip, not a text label** — Greg,
 * SPIDERYARN-READING2-5C; docs/project/icons.md § Navigation. The mode's own
 * icon, so the button looks like the mode it opens.
 */
function OpenIn({ label, icon, onOpen }: { label: string; icon: ReactNode; onOpen(): void }) {
  return (
    <Tooltip content={<p>{label}</p>} placement="top">
      <button type="button" className="traj-open" aria-label={label} onClick={onOpen}>
        {icon}
      </button>
    </Tooltip>
  );
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
 * **The honest promise**, in the tooltip of the head's info button — the
 * foot's first line until SPIDERYARN-READING2-52. The first half is what the
 * mode can prove — the passages are the Quotes' own, checked against the
 * article by that step; the second is what it cannot.
 */
export function trajectoryPromise(profiled: boolean): string {
  return profiled
    ? "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, shaped by your profile."
    : "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, for somebody reading the piece for the first time.";
}

/**
 * At Most, how much of the Quotes offered to this route the three passes walk
 * between them — *"every one of the N quotes offered to this route"*, or *"M of
 * N"*. **All three, not Most alone**: since plan 260929e each pass walks only
 * its own stops, so Most by itself is the last tranche, and "this pass" would
 * undercount. The denominator is the route's stored `offered`, not today's raw
 * Quotes count: abstract quotes were deliberately never offered. `null` below
 * Most, or with no Quotes.
 */
export function coverageNote(walked: number, offered: number): string | null {
  if (offered === 0) return null;
  if (walked >= offered) {
    return `Gist, More and Most together stop at every one of the ${offered} quotes offered to this route.`;
  }
  return `Gist, More and Most together stop at ${walked} of the ${offered} quotes offered to this route.`;
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

/**
 * The one banner over a route, and why it is there — or `null`.
 *
 * **Not for an outdated route.** A route planned by an older prompt, over the
 * same article, is not announced: Greg, 2026-09-29 (SPIDERYARN-READING2-55),
 * *"There are probably lots of cases where the prompt will get out of date,
 * and it's not worth bugging the user about it."* Re-running is in Metadata.
 * `outdated` itself is still read — the stop card treats outdated sources as
 * usable. docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md.
 */
export function bannerReason(owner: Pick<UseTrajectory, "stale" | "profileChanged">): string | null {
  if (owner.stale) {
    /* One input hash covers all three, so this read cannot honestly attribute
       the mismatch to Quotes. `notOnRoute` is also only a present-day count: a
       route may deliberately omit a quote, so it is not evidence that quote
       arrived later. */
    return "The Quotes, Ideas, or outline have changed since this route was planned.";
  }
  if (owner.profileChanged) return "This route was planned before your profile said what it says now.";
  return null;
}

/** The sparkline's drawing — src/web/route-spark.ts has the geometry. */
const SPARK_H = 26;
const SPARK_PAD = 4;
function RouteSpark({ positions, current }: { positions: readonly (number | null)[]; current: number }) {
  const width = sparkWidth(positions.length);
  const { dots, runs } = sparkline(positions, { width, height: SPARK_H, pad: SPARK_PAD });
  return (
    <svg width={width} height={SPARK_H} viewBox={`0 0 ${width} ${SPARK_H}`} aria-hidden="true" focusable="false">
      {runs.map((points) => (
        <polyline key={points} points={points} className="traj-spark-line" />
      ))}
      {dots.map((d) => (
        <circle
          key={d.index}
          cx={d.x}
          cy={d.y}
          r={d.index === current ? 3.5 : 2.2}
          className={`traj-spark-dot${d.index === current ? " on" : d.index < current ? " done" : ""}`}
        />
      ))}
    </svg>
  );
}

/**
 * **The pinned head**: the stepper, and the depth control when there is more
 * than one depth to offer.
 */
function RouteHead({ view, total, about }: { view: TrajectoryView; total: number; about: string[] }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sparkOpen, setSparkOpen] = useState(false);
  const here = view.rows[view.position - 1]?.position ?? null;
  const said =
    `Stop ${view.position} of ${total}` +
    (here === null ? " · position unavailable" : ` · about ${Math.round(here * 100)}% through the article`);
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
        {/* **The route as a line** instead of "Stop k of N" (Greg,
            SPIDERYARN-READING2-5C): a real button, so a keyboard and a finger
            reach its tooltip, which holds the number (Sol, 260929f F6). The
            number is also a status line for a screen reader, spoken on a step. */}
        <Tooltip content={<p>{said}</p>} placement="bottom" open={sparkOpen} onOpenChange={setSparkOpen}>
          <button
            type="button"
            className="traj-spark"
            aria-label={said}
            aria-expanded={sparkOpen}
            onClick={() => setSparkOpen((was) => !was)}
          >
            <RouteSpark positions={view.rows.map((r) => r.position)} current={view.position - 1} />
          </button>
        </Tooltip>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
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
      {/* **Where the passages come from**, said once and out of the way — the
          two foot sentences Greg asked to move into a tooltip
          (SPIDERYARN-READING2-52). Controlled, as Quotes' *Why this one* is,
          so a tap toggles it on a touch device with no hover; hover and focus
          open it too. */}
      <Tooltip
        content={
          <>
            {about.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </>
        }
        placement="bottom"
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        className="traj-about-card"
      >
        <button
          type="button"
          className={`traj-about${aboutOpen ? " on" : ""}`}
          aria-label="About this route"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((was) => !was)}
        >
          <Info size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * **Who is looking, and what they hold.** The owner's arm is the whole
 * `useTrajectory` read — the job, the freshness, the verbs that spend. The
 * visitor's arm is the stored route off the public payload and nothing else:
 * no read state (it arrived with the page), no job, no verb. A union rather
 * than a `readOnly` flag beside `owner`, so a visitor's panel has nothing to
 * press that could plan a route — the shape `TimelinePanel`'s access has, and
 * new-mode.md asks for. Since 2026-09-29, SPIDERYARN-READING2-56.
 */
export type TrajectoryAccess =
  | { kind: "owner"; owner: UseTrajectory }
  | { kind: "visitor"; route: PublicTrajectory };

/**
 * **The promise, for somebody the route was not planned for.** It says nothing
 * about a profile — not *"shaped by your profile"*, which would be false, and
 * not whether the owner had one, which `profileHash` staying off the wire
 * exists to keep from a stranger (src/public-types.ts § `PublicTrajectory`).
 */
export const VISITOR_TRAJECTORY_PROMISE =
  "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, planned for whoever added this article.";

interface Props {
  access: TrajectoryAccess;
  view: TrajectoryView;
  /** Stepped aside and not drawn — `TrajectoryBand`'s `away`. */
  away: boolean;
}

export function TrajectoryPanel({ access, view, away }: Props) {
  useRenderCount("TrajectoryPanel");
  /* `null` for a visitor, and every owner-only thing below is behind it. */
  const owner = access.kind === "owner" ? access.owner : null;
  const route = access.kind === "owner" ? access.owner.trajectory : access.route;
  /* A visitor's route arrived with the page, so it is ready by construction. */
  const ready = route !== null && (owner === null || owner.status === "ready");
  const promise = owner
    ? trajectoryPromise(owner.trajectory?.profileHash != null)
    : VISITOR_TRAJECTORY_PROMISE;
  const total = view.rows.length;
  const deepest = view.depths.at(-1)?.depth ?? null;
  const atMost = ready && view.depth !== null && view.depth === deepest && view.depth === 3;
  /** The row whose whole quote is up — one at a time, and only by mouse or focus. */
  const [tipFor, setTipFor] = useState<string | null>(null);
  /** The row whose "where am I" card is up — by hover, focus or a tap. */
  const [whereFor, setWhereFor] = useState<string | null>(null);
  const [snippetOpen, setSnippet] = useState<OpenSnippet | null>(null);
  /** The list's own scroller, kept pointed at the current row (54). */
  const scroller = useRef<HTMLDivElement>(null);
  const currentId = ready ? (view.rows.find((row) => row.current)?.quoteId ?? null) : null;
  /* The depth and the card reflow the list without changing the current row.
     `away` is there because a band that stepped aside is `display: none`: a
     step made from the prose's door measures nothing, so the list is measured
     again when the band comes back (GPT Sol, plan review F1). */
  /* Only a snippet on the current stop counts as open — see `OpenSnippet`. */
  const snippet = snippetOpen !== null && snippetOpen.stop === currentId ? snippetOpen : null;
  const toggle = (kind: OpenSnippet["kind"], id: string) =>
    setSnippet((was) =>
      currentId === null || (was?.stop === currentId && was.kind === kind && was.id === id)
        ? null
        : { stop: currentId, kind, id },
    );
  useFollow(scroller, currentId, [view.depth, view.card, away, snippet?.kind, snippet?.id]);
  /* A depth or route refresh can remove an open row, so its Tooltip unmounts
     before it can report that it closed. Do not let that stale id reopen if
     the row later returns. The enabled check also covers words disappearing. */
  useEffect(() => {
    if (tipFor === null) return;
    const row = ready ? view.rows.find((candidate) => candidate.quoteId === tipFor) : undefined;
    if (row === undefined || !rowWords(row)?.whole) setTipFor(null);
  }, [ready, tipFor, view.rows]);
  /* A controlled tooltip can unmount before reporting that it closed. Do not
     let its stale id reopen if a shallower pass removes the row and a later
     pass brings it back. This is the where-card equivalent of `tipFor` above. */
  useEffect(() => {
    if (whereFor === null) return;
    const row = ready ? view.rows.find((candidate) => candidate.quoteId === whereFor) : undefined;
    if (row === undefined || row.position === null || row.where.length === 0) setWhereFor(null);
  }, [ready, whereFor, view.rows]);
  /* `snippet` hides an old stop's opening immediately during the step. Clear
     the stored value afterwards as well, so walking back does not resurrect
     something the reader closed by leaving the stop. Also forget an artefact
     removed by a read refresh while the stop itself stays current. */
  useEffect(() => {
    if (snippetOpen === null) return;
    const exists =
      snippetOpen.stop === currentId &&
      view.card !== null &&
      (snippetOpen.kind === "term"
        ? view.card.terms.some((term) => term.entry.id === snippetOpen.id)
        : snippetOpen.kind === "idea"
          ? view.card.ideas.some((idea) => idea.id === snippetOpen.id)
          : view.card.questions.some((question) => question.id === snippetOpen.id));
    if (!exists) setSnippet(null);
  }, [currentId, snippetOpen, view.card]);

  /**
   * @param again whether this is the button beside a route already there. The
   *   empty state's must be `ensure`, the automatic run's own request, or it
   *   buys a second model call — useIdeas.ts § `ensure`.
   */
  const run = (label: string, again = false) =>
    owner === null ? null : (
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
      head={
        ready && total > 0 && view.depth !== null ? (
          <RouteHead
            view={view}
            total={total}
            about={[
              promise,
              ...(atMost ? [coverageNote(route.stops.length, route.offered)].filter((n): n is string => n !== null) : []),
            ]}
          />
        ) : null
      }
      foot={
        /* **A status-only foot.** The promise moved to the head's tooltip
           (SPIDERYARN-READING2-52), and the standing *Plan it again* went —
           Greg, 2026-09-29 (SPIDERYARN-READING2-53): *"remove the "Plan it
           again" button … let's just rely on the Metadata mode for that."*
           Metadata's *Re-run AI processing* has a Trajectory row, and the
           stale and profile-changed banners keep their own button, which
           carries the job there — hence the gate on those two. What is left is
           a job's progress, Stop and failure while one is starting, running or
           failed; idle, there is no foot at all. An outdated route has no
           banner (plan 260929c), so its job shows here.
           docs/plans/260929b-one-place-to-re-run-ai-processing.md. */
        owner &&
        ready &&
        !owner.stale &&
        !owner.profileChanged &&
        (owner.job || owner.starting || owner.failed) ? (
          <div className="traj-foot">
            <div className="traj-again">{run("Plan it again", true)}</div>
          </div>
        ) : null
      }
    >
      {owner?.error && (
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

      {owner?.status === "loading" && <p className="gloss-quiet">Looking for the route…</p>}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has planned a route through this piece yet.</p>
          <p className="gloss-hint">{emptyHint(owner)}</p>
          {run("Plan the route")}
        </div>
      )}

      {ready && (
        <>
          {owner && bannerReason(owner) && (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                {bannerReason(owner)}
              </p>
              {run("Plan it again", true)}
            </div>
          )}

          {/* What the route was planned for, or the question — owner only,
              and only over a ready route (Sol F6: the empty state's automatic
              run would race a press). TrajectoryPurpose.tsx. */}
          {owner && (
            <PurposeLine
              key={owner.slug}
              owner={owner}
              bannerUp={bannerReason(owner) !== null}
            />
          )}

          {total === 0 && <p className="gloss-quiet">This route has no stops.</p>}

          {total > 0 && (
            <div className="tl-scroll" ref={scroller}>
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
                    const questions = row.current ? (view.card?.questions ?? []) : [];
                    const below = row.current && view.card !== null && cardHasBelow(view.card);
                    return (
                      <li
                        key={row.quoteId}
                        className={`traj-row${row.current ? " current" : ""}`}
                        data-stop={row.quoteId}
                        {...{ [FOLLOW_ATTR]: row.quoteId }}
                      >
                        {/* **The question first, then the passage** (Greg,
                            SPIDERYARN-READING2-5C): FAQ's question, above the
                            row rather than under it, as a sibling of the row's
                            button so opening it cannot also press the row. */}
                        {questions.length > 0 && (
                          <StopQuestions
                            questions={questions}
                            place={row.place}
                            open={snippet?.kind === "faq" ? snippet.id : null}
                            onToggle={(id) => toggle("faq", id)}
                            onOpen={view.onOpen}
                            canOpen={view.canOpen}
                          />
                        )}
                        <div className="traj-line">
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
                        {/* **Where am I** — the position mark's card: a
                            sibling button laid over the mark, so a keyboard
                            and a finger reach it and it never presses the row
                            (Sol, 260929f F5). */}
                        {row.position !== null && row.where.length > 0 && (
                          <Tooltip
                            content={<WhereCard rows={row.where} />}
                            placement="right"
                            open={whereFor === row.quoteId}
                            onOpenChange={(open) =>
                              setWhereFor((was) => (open ? row.quoteId : was === row.quoteId ? null : was))
                            }
                            className="where-tip"
                          >
                            <button
                              type="button"
                              className="traj-where"
                              aria-label={`Where stop ${row.n} is in the article`}
                              aria-expanded={whereFor === row.quoteId}
                              onClick={() => setWhereFor((was) => (was === row.quoteId ? null : row.quoteId))}
                            />
                          </Tooltip>
                        )}
                        </div>
                        {below && view.card && (
                          <StopCardView
                            card={view.card}
                            open={snippet}
                            onToggle={toggle}
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

/** Whether the card under the row has anything — the FAQ question sits above it now. */
function cardHasBelow(card: StopCard): boolean {
  return card.terms.length > 0 || card.ideas.length > 0 || card.events.length > 0;
}

/**
 * **The FAQ's question, above the stop** — Greg, SPIDERYARN-READING2-5C: *"I
 * kind of like the idea of situating the quote in terms of the question for
 * which it's an answer. But if so, maybe the question should go first and add
 * a tooltip."* Pressing it opens, in place, **every** passage FAQ pairs with it
 * — FAQ answers only in the article's own words — and an icon opens FAQ.
 *
 * The tooltip says what the pairing is and is not (Sol, 260929f F3): FAQ
 * pairs a question with a *paragraph*, by the model's reading, and its words
 * there may not be the stop's quote.
 */
function StopQuestions({
  questions,
  place,
  open,
  onToggle,
  onOpen,
  canOpen,
}: {
  questions: readonly CardQuestion[];
  place: string | null;
  open: string | null;
  onToggle(id: string): void;
  onOpen(target: CardTarget): void;
  canOpen(target: CardTarget): boolean;
}) {
  const where = place ? ` in ${place}` : "";
  return (
    <div className="traj-asks">
      {questions.map((q) => (
        <div key={q.id} className="traj-ask">
          <Tooltip
            content={
              <p>
                A question the FAQ wrote. It pairs it with a passage in this paragraph{where} — the model's
                reading. Press for its passages.
              </p>
            }
            placement="top"
            className="traj-ask-tip"
          >
            <button
              type="button"
              className={`traj-ask-q${open === q.id ? " on" : ""}`}
              aria-expanded={open === q.id}
              onClick={() => onToggle(q.id)}
            >
              <BadgeQuestionMark size={14} aria-hidden="true" />
              <span>{q.question}</span>
            </button>
          </Tooltip>
          {open === q.id && (
            <div className="traj-sense">
              {q.passages.map((p) => (
                <div key={`${p.blockId}:${p.start}`} className="traj-passage">
                  {/* The stop's own quote is right below: say so rather than repeat it. */}
                  {p.here ? (
                    <p className="traj-passage-here">This stop's passage, below</p>
                  ) : (
                    <>
                      <p>“{p.quote}”</p>
                      {p.place && <p className="traj-passage-at">{p.place}</p>}
                    </>
                  )}
                </div>
              ))}
              {canOpen({ kind: "faq" }) && (
                <OpenIn label="Open FAQ" icon={<BadgeQuestionMark size={16} />} onOpen={() => onOpen({ kind: "faq" })} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * **The stop card** — see the file header. One cluster per artefact that has
 * something for this paragraph, in a fixed order: the words first (they are
 * what trips a skimmer), then the ideas and the study. The FAQ question went
 * above the row (`StopQuestions`).
 *
 * **Terms and ideas are chips that open in place** — the sense of a term, the
 * statement of an idea — so the reader can stay in Trajectory (Greg,
 * SPIDERYARN-READING2-59: *"can we make them be expandable as well, like the
 * glossary"*). The way to the full mode is an icon inside what opened.
 */
function StopCardView({
  card,
  open,
  onToggle,
  onOpen,
  canOpen,
}: {
  card: StopCard;
  open: OpenSnippet | null;
  onToggle(kind: OpenSnippet["kind"], id: string): void;
  onOpen(target: CardTarget): void;
  canOpen(target: CardTarget): boolean;
}) {
  const term = open?.kind === "term" ? (card.terms.find((t) => t.entry.id === open.id) ?? null) : null;
  const idea = open?.kind === "idea" ? (card.ideas.find((i) => i.id === open.id) ?? null) : null;
  const lead = term ? entryProse(term.entry).lead : "";
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
                className={`traj-chip${entry.id === term?.entry.id ? " on" : ""}`}
                aria-expanded={entry.id === term?.entry.id}
                onClick={() => onToggle("term", entry.id)}
              >
                {entry.name}
                {alsoAt !== null && <span className="traj-also">also at stop {alsoAt}</span>}
              </button>
            ))}
          </div>
          {term && (
            <div className="traj-sense">
              {lead && <p>{lead}</p>}
              {canOpen({ kind: "term", id: term.entry.id }) && (
                <OpenIn
                  label="Open in Glossary"
                  icon={<BookA size={16} />}
                  onOpen={() => onOpen({ kind: "term", id: term.entry.id })}
                />
              )}
            </div>
          )}
        </section>
      )}
      {card.ideas.length > 0 && (
        <section className="traj-cluster" aria-label="Ideas it bears on">
          <p className="traj-cluster-h">Ideas it bears on</p>
          <div className="traj-chips">
            {card.ideas.map((i) => (
              <button
                key={i.id}
                type="button"
                className={`traj-chip${i.id === idea?.id ? " on" : ""}`}
                aria-expanded={i.id === idea?.id}
                onClick={() => onToggle("idea", i.id)}
              >
                {i.name}
              </button>
            ))}
          </div>
          {idea && (
            <div className="traj-sense">
              <p>{idea.statement}</p>
              {canOpen({ kind: "idea", id: idea.id }) && (
                <OpenIn label="Open in Ideas" icon={<Lightbulb size={16} />} onOpen={() => onOpen({ kind: "idea", id: idea.id })} />
              )}
            </div>
          )}
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
 * the end of a pass *More detail ›* (stop 1 of the next deeper pass), or no
 * button at all at the end of the deepest, only the line saying which pass
 * ended. *Go round again* sat beside it until Greg asked for it to go: ← walks
 * back, and ← on stop 1 goes to its passage (SPIDERYARN-READING2-51 and 4K,
 * plan 260929b). It is there because on an iPad
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
  onDeeper,
  onRoute,
}: {
  door: DoorView | null;
  onNext(): void;
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
        {door?.kind === "end" && door.deeper && (
          <button
            type="button"
            className="traj-door-btn"
            title={`Go on to ${door.deeper}: the stops the passes before it left out`}
            onClick={onDeeper}
          >
            More detail ›
          </button>
        )}
      </div>
      {/* Where the door leads: the next stop's cue, small and muted — or, at
          the end of a pass, which pass has ended. */}
      {door?.kind === "next" && door.cue && <p className="traj-door-cue">{door.cue}</p>}
      {door?.kind === "end" && (
        <p className="traj-door-cue">
          End of {door.pass} — {door.count} {door.count === 1 ? "stop" : "stops"}.
        </p>
      )}
    </div>
  );
}
