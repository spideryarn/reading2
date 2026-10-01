/**
 * The Skim, in the band between the spine and the prose: a route through
 * the article's own Quotes, walked at three depths. The stops are read in the
 * prose, where they sit; this band only says where to stand and in what order.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client) is the design; docs/project/skim.md the vision.
 * Three things to know before changing anything here:
 *
 * ## The cue is shown on the current row only
 *
 * Every other row shows where its stop is — the section path, read from the
 * tree — and not its cue. At Most there can be thirty rows, and thirty
 * generated lines would be a summary a reader could read *instead of* the
 * paper, which is vision.md's anti-goal exactly. The cue names what to look
 * for, never what the passage found (src/skim.ts), and one at a time. An
 * old route has a role instead, and that is drawn in its place.
 *
 * ## The stop card: the scrapbook, by juxtaposition
 *
 * Under the current row, and only there, whatever the other modes have
 * *already* written about this paragraph — src/web/stop-card.ts gathers it.
 * Nothing on it is generated for it, nothing starts a run, and when there is
 * nothing there is no card and no sentence asking for one. Term and idea chips
 * open to one line and an icon into their mode; events link into theirs. The tying-together is the juxtaposition, not a synthesis (Sol F21).
 *
 * ## The head is pinned, and the list follows the stop
 *
 * `‹ Stop k of N ›` and the depth control sit in `ModeSurface`'s head, which is
 * outside the scroller (`.band-head` is `flex: none`), so they stay put while
 * the list scrolls. When the current stop changes, by any path, the list's own
 * scroller (`.tl-scroll`) is nudged to show its row — `useFollow`, Summary's
 * machinery, which sets that scroller's `scrollTop` and never touches the
 * page, so it cannot fight the prose scroll landing the passage
 * (SPIDERYARN-READING2-54). The promise about where the passages come from is in
 * the band's (i), not a paragraph in the foot
 * (SPIDERYARN-READING2-52).
 *
 * ## The depth control is three buttons, not a slider
 *
 * There are exactly three positions, and three buttons are easier to hit on an
 * iPad (Sol and Opus agreed). Only the depths that add stops are drawn
 * (`offeredDepths`). Each is a real `<button>` and its own tab stop, with
 * `aria-pressed` — keyboard.md's rule that arrow keys belong to the article.
 */
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import {
  BookA,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  RotateCw,
  Route,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseSkim } from "./useSkim.js";
import type { PublicSkim } from "../public-types.js";
import type { DoorView, SkimView } from "./modes/skim/SkimMode.js";
import { FOLLOW_ATTR, useFollow } from "./follow.js";
import { entryProse } from "./GlossaryPanel.js";
import { JobProgress } from "./JobProgress.js";
import { AboutMade } from "./BandAbout.js";
import { ModeSurface } from "./ModeSurface.js";
import { PurposeLine } from "./SkimPurpose.js";
import { useRenderCount } from "./perf.js";
import { snippet } from "./citations.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import { type CardTarget, cardIsEmpty, type StopCard } from "./stop-card.js";
import { sparkline, sparkWidth } from "./route-spark.js";
import type { WhereRow } from "./where.js";
import { WhereCard } from "./WhereCard.js";

/** One row of the list. Built by `useSkimMode`, drawn here. */
export interface SkimRow {
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
   * `positionOf` (skim-route.ts). `null` when it cannot be placed.
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
 * card (Sol, plan 260929f F4): a term's sense or an idea's statement. Held by
 * the panel, not the card, because the list's follow-scroll has to re-measure
 * when one opens. `stop` ties it to the stop it was opened on, so it is hidden
 * during a step before the cleanup effect forgets it permanently.
 */
interface OpenSnippet {
  stop: string;
  kind: "term" | "idea";
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
      <button type="button" className="skim-open" aria-label={label} onClick={onOpen}>
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
function rowWords(row: SkimRow): { shown: string; whole: string | null } | null {
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
      <span className="skim-pos" aria-hidden="true">
        <span className={`skim-pos-dot${current ? " on" : ""}`} style={{ top: `${pct}%` }} />
      </span>
      <span className="skim-pos-said sr-only">about {pct}% of the way through</span>
    </>
  );
}

/**
 * **The honest promise**, in the tooltip of the head's info button — the
 * foot's first line until SPIDERYARN-READING2-52. The first half is what the
 * mode can prove — the passages are the Quotes' own, checked against the
 * article by that step; the second is what it cannot.
 */
export function skimPromise(profiled: boolean): string {
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
export function emptyHint(owner: Pick<UseSkim, "quotesFirst" | "ideasFirst">): string {
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
export function bannerReason(owner: Pick<UseSkim, "stale" | "profileChanged">): string | null {
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
        <polyline key={points} points={points} className="skim-spark-line" />
      ))}
      {dots.map((d) => (
        <circle
          key={d.index}
          cx={d.x}
          cy={d.y}
          r={d.index === current ? 3.5 : 2.2}
          className={`skim-spark-dot${d.index === current ? " on" : d.index < current ? " done" : ""}`}
        />
      ))}
    </svg>
  );
}

/**
 * **The pinned head**: the stepper, and the depth control when there is more
 * than one depth to offer.
 */
function RouteHead({ view, total }: { view: SkimView; total: number }) {
  const [sparkOpen, setSparkOpen] = useState(false);
  const here = view.rows[view.position - 1]?.position ?? null;
  const said =
    `Stop ${view.position} of ${total}` +
    (here === null ? " · position unavailable" : ` · about ${Math.round(here * 100)}% through the article`);
  return (
    <div className="skim-head">
      {/* **Each arrow names its key on its card** — Greg, SPIDERYARN-READING2-74:
          *"Add tooltips for the previous and next buttons … especially showing
          the keyboard shortcuts."* The rule: docs/project/tooltips.md § A
          shortcut is named on its card. Hover and focus cards: a finger's tap
          steps at once, on purpose (plan 260930h, Sol F3). The copy promises no
          scroll — a stale route's stop may have lost its block (Sol F1). */}
      <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
        <div className="skim-stepper">
          {/* Enabled on stop 1 too, where it goes to stop 1's passage again —
              ← does the same (SPIDERYARN-READING2-4K), and the keys may not do
              more than the buttons. */}
          <StepTip
            head={view.position <= 1 ? "Back to stop 1" : "Previous stop"}
            what={view.position <= 1 ? "Back to the first stop." : "Back one stop along the route."}
            keyName="←"
            enabled={view.position >= 1}
          >
            <button
              type="button"
              className="skim-arrow"
              aria-label={view.position <= 1 ? "Back to stop 1" : "Previous stop"}
              disabled={view.position < 1}
              onClick={() => view.onStep(-1)}
            >
              <ChevronLeft size={20} />
            </button>
          </StepTip>
          {/* **The route as a line** instead of "Stop k of N" (Greg,
              SPIDERYARN-READING2-5C): a real button, so a keyboard and a finger
              reach its tooltip, which holds the number (Sol, 260929f F6). The
              number is also a status line for a screen reader, spoken on a step. */}
          <Tooltip content={<p>{said}</p>} placement="bottom" open={sparkOpen} onOpenChange={setSparkOpen}>
            <button
              type="button"
              className="skim-spark"
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
          <StepTip
            head="Next stop"
            what="On to the next stop along the route."
            keyName="→"
            enabled={view.position < total}
          >
            <button
              type="button"
              className="skim-arrow"
              aria-label="Next stop"
              disabled={view.position >= total}
              onClick={() => view.onStep(1)}
            >
              <ChevronRight size={20} />
            </button>
          </StepTip>
        </div>
      </TooltipGroup>
      {/* **The depth control, one group that does not wrap**
          (SPIDERYARN-READING2-73), so a head too narrow for one row breaks
          before the depths. It held this head's own (i) too, until that moved
          to the band's corner on 2026-10-01 (spya-ucu35y, plan 261001m).
          skim.css § .skim-head-end. */}
      <div className="skim-head-end">
        {view.depths.length > 1 && (
          <fieldset className="skim-depths" aria-label="How deep">
            {view.depths.map((d) => (
              <button
                key={d.depth}
                type="button"
                className={`skim-depth${d.depth === view.depth ? " on" : ""}`}
                aria-pressed={d.depth === view.depth}
                onClick={() => {
                  if (d.depth !== view.depth) view.onDepth(d.depth);
                }}
              >
                <span>{d.label}</span>
                <span className="skim-depth-n">{d.count}</span>
              </button>
            ))}
          </fieldset>
        )}
      </div>
    </div>
  );
}

/**
 * **A step control's card**: what it does, and its key — Skim's ‹ › and
 * the door's *Next stop ›* (plan 260930h). "While reading" covers keynav's
 * guards, including the Dock drawer suspending the keys while the buttons stay
 * mounted behind it; docs/project/tooltips.md § A shortcut is named on its card.
 */
function StepTip({
  head,
  what,
  keyName,
  placement = "bottom",
  enabled = true,
  children,
}: {
  head: string;
  what: string;
  keyName: "←" | "→";
  placement?: "top" | "bottom";
  /** False when the native button is disabled; also closes a card already open. */
  enabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip
      placement={placement}
      keepSide
      className="tip-soon"
      enabled={enabled}
      content={<ControlTip head={head} what={what} how={`While reading, press ${keyName}.`} />}
    >
      {children}
    </Tooltip>
  );
}

/**
 * **Who is looking, and what they hold.** The owner's arm is the whole
 * `useSkim` read — the job, the freshness, the verbs that spend. The
 * visitor's arm is the stored route off the public payload and nothing else:
 * no read state (it arrived with the page), no job, no verb. A union rather
 * than a `readOnly` flag beside `owner`, so a visitor's panel has nothing to
 * press that could plan a route — the shape `TimelinePanel`'s access has, and
 * mode.md asks for. Since 2026-09-29, SPIDERYARN-READING2-56.
 */
export type SkimAccess =
  | { kind: "owner"; owner: UseSkim }
  | { kind: "visitor"; route: PublicSkim };

/**
 * **The promise, for somebody the route was not planned for.** It says nothing
 * about a profile — not *"shaped by your profile"*, which would be false, and
 * not whether the owner had one, which `profileHash` staying off the wire
 * exists to keep from a stranger (src/public-types.ts § `PublicSkim`).
 */
export const VISITOR_SKIM_PROMISE =
  "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, planned for whoever added this article.";

interface Props {
  access: SkimAccess;
  view: SkimView;
  /** Stepped aside and not drawn — `SkimBand`'s `away`. */
  away: boolean;
}

export function SkimPanel({ access, view, away }: Props) {
  useRenderCount("SkimPanel");
  /* `null` for a visitor, and every owner-only thing below is behind it. */
  const owner = access.kind === "owner" ? access.owner : null;
  const route = access.kind === "owner" ? access.owner.skim : access.route;
  /* A visitor's route arrived with the page, so it is ready by construction. */
  const ready = route !== null && (owner === null || owner.status === "ready");
  const promise = owner
    ? skimPromise(owner.skim?.profileHash != null)
    : VISITOR_SKIM_PROMISE;
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
        : view.card.ideas.some((idea) => idea.id === snippetOpen.id));
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
      step="skim"
      icon={<Route size={13} />}
      runningLabel="Planning the route…"
    />
  );

  /* **Where the passages come from**, and who planned the route — the band's
     (i) since 2026-10-01 (spya-ucu35y, plan 261001m). The promise and the
     coverage note were the head's own (i) before that, and the two foot
     sentences before that (SPIDERYARN-READING2-52). Provenance is the owner's
     only: a visitor's route carries none (src/public-types.ts). */
  const routed = ready && total > 0 && view.depth !== null;
  const coverage = atMost ? coverageNote(route.stops.length, route.offered) : null;
  const made = owner?.skim ?? null;
  const about = routed ? (
    <>
      <p>{promise}</p>
      {coverage && <p>{coverage}</p>}
      {made && (
        <AboutMade
          generator={made.generator}
          version={made.version}
          generatedAt={made.generatedAt}
          elapsedMs={made.elapsedMs}
        />
      )}
    </>
  ) : null;

  return (
    <ModeSurface
      label="Skim"
      feature="gloss skim"
      mode="skim"
      about={about}
      /* **A head that stays put**: the stepper and the depth control, pinned
         above the scroller. Present only when there is a route to step — no
         empty row over the loading sentence (mode.md § the header row). */
      head={routed ? <RouteHead view={view} total={total} /> : null}
      foot={
        /* **A status-only foot.** The promise moved to the head's tooltip
           (SPIDERYARN-READING2-52), and the standing *Plan it again* went —
           Greg, 2026-09-29 (SPIDERYARN-READING2-53): *"remove the "Plan it
           again" button … let's just rely on the Metadata mode for that."*
           Metadata's *AI processing* has a Skim row, and the
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
          <div className="skim-foot">
            <div className="skim-again">{run("Plan it again", true)}</div>
          </div>
        ) : null
      }
    >
      {owner?.error && (
        <div className="skim-read-error">
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
              run would race a press). SkimPurpose.tsx. */}
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
                <ol className="skim-list">
                  {view.rows.map((row, index) => {
                    const repeatedPlace =
                      row.place !== null && row.place === view.rows[index - 1]?.place;
                    const words = rowWords(row);
                    const go = (
                      <button
                        type="button"
                        className="skim-go"
                        aria-current={row.current ? "step" : undefined}
                        disabled={row.missing}
                        onClick={() => view.onRow(row.quoteId)}
                      >
                        <span className="skim-n">
                          {row.n}
                          {row.position !== null && <StopPosition at={row.position} current={row.current} />}
                        </span>
                        <span className="skim-what">
                          {/* A repeated section is said, not drawn: a ditto mark
                              beside a quotation reads as another quotation mark,
                              which is the report behind plan 260928e. */}
                          {repeatedPlace ? (
                            <span className="sr-only">{row.place}</span>
                          ) : (
                            <span className="skim-place">{row.place ?? "—"}</span>
                          )}
                          {/* The cue before the quote: it is the question to
                              read the passage with (Greg, SPIDERYARN-READING2-8J). */}
                          {row.current && row.cue && <span className="skim-cue">{row.cue}</span>}
                          {words && <span className="skim-words">“{words.shown}”</span>}
                        </span>
                      </button>
                    );
                    const below = row.current && view.card !== null && !cardIsEmpty(view.card);
                    return (
                      <li
                        key={row.quoteId}
                        className={`skim-row${row.current ? " current" : ""}`}
                        data-stop={row.quoteId}
                        {...{ [FOLLOW_ATTR]: row.quoteId }}
                      >
                        <div className="skim-line">
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
                          className="skim-words-tip"
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
                              className="skim-where"
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

/**
 * **The stop card** — see the file header. One cluster per artefact that has
 * something for this paragraph, in a fixed order: the words first (they are
 * what trips a skimmer), then the ideas and the study.
 *
 * **Terms and ideas are chips that open in place** — the sense of a term, the
 * statement of an idea — so the reader can stay in Skim (Greg,
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
    <div className="skim-card">
      {card.terms.length > 0 && (
        <section className="skim-cluster" aria-label="Terms it uses">
          <p className="skim-cluster-h">Terms it uses</p>
          <div className="skim-chips">
            {card.terms.map(({ entry, alsoAt }) => (
              <button
                key={entry.id}
                type="button"
                className={`skim-chip${entry.id === term?.entry.id ? " on" : ""}`}
                aria-expanded={entry.id === term?.entry.id}
                onClick={() => onToggle("term", entry.id)}
              >
                {entry.name}
                {alsoAt !== null && <span className="skim-also">also at stop {alsoAt}</span>}
              </button>
            ))}
          </div>
          {term && (
            <div className="skim-sense">
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
        <section className="skim-cluster" aria-label="Ideas it bears on">
          <p className="skim-cluster-h">Ideas it bears on</p>
          <div className="skim-chips">
            {card.ideas.map((i) => (
              <button
                key={i.id}
                type="button"
                className={`skim-chip${i.id === idea?.id ? " on" : ""}`}
                aria-expanded={i.id === idea?.id}
                onClick={() => onToggle("idea", i.id)}
              >
                {i.name}
              </button>
            ))}
          </div>
          {idea && (
            <div className="skim-sense">
              <p>{idea.statement}</p>
              {canOpen({ kind: "idea", id: idea.id }) && (
                <OpenIn label="Open in Ideas" icon={<Lightbulb size={16} />} onOpen={() => onOpen({ kind: "idea", id: idea.id })} />
              )}
            </div>
          )}
        </section>
      )}
      {card.events.length > 0 && (
        <section className="skim-cluster" aria-label="Where it sits in the study">
          <p className="skim-cluster-h">Where it sits in the study</p>
          <ul>
            {card.events.map((event) => (
              <li key={event.id}>
                {canOpen({ kind: "event", id: event.id }) ? (
                  <button type="button" className="skim-link" onClick={() => onOpen({ kind: "event", id: event.id })}>
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
export function SkimDoor({
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
    <div className="skim-door">
      <div className="skim-door-row">
        {onRoute && (
          <button type="button" className="skim-door-btn quiet" onClick={onRoute}>
            <Route size={14} />
            All stops
          </button>
        )}
        {door?.kind === "next" && (
          <StepTip
            head="Next stop"
            what="On to the next stop along the route."
            keyName="→"
            placement="top"
          >
            <button type="button" className="skim-door-btn" onClick={onNext}>
              Next stop ›
            </button>
          </StepTip>
        )}
        {door?.kind === "end" && door.deeper && (
          <button
            type="button"
            className="skim-door-btn"
            title={`Go on to ${door.deeper}: the stops the passes before it left out`}
            onClick={onDeeper}
          >
            More detail ›
          </button>
        )}
      </div>
      {/* Where the door leads: the next stop's cue, small and muted — or, at
          the end of a pass, which pass has ended. */}
      {door?.kind === "next" && door.cue && <p className="skim-door-cue">{door.cue}</p>}
      {door?.kind === "end" && (
        <p className="skim-door-cue">
          End of {door.pass} — {door.count} {door.count === 1 ? "stop" : "stops"}.
        </p>
      )}
    </div>
  );
}
