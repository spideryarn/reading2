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
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Route,
  TriangleAlert,
} from "lucide-react";
import type { UseSkim } from "./useSkim.js";
import type { PublicSkim } from "../public-types.js";
import type { SkimDepth } from "../types.js";
import type { DoorView, SkimView } from "./modes/skim/SkimMode.js";
import { FOLLOW_ATTR, useFollow } from "./follow.js";
import { JobProgress } from "./JobProgress.js";
import { AboutMade } from "./BandAbout.js";
import { ModeSurface } from "./ModeSurface.js";
import { PurposeLine } from "./SkimPurpose.js";
import { useRenderCount } from "./perf.js";
import { snippet } from "./citations.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { StepTip } from "./StepTip.js";
import { ReadError } from "./ReadError.js";
import { type CardTarget, cardIsEmpty, type StopCard } from "./stop-card.js";
import { TermCard, type TermActions } from "./ProseHoverCard.js";
import type { GlossaryEntry } from "../types.js";
import { sparkline, sparkWidth } from "./route-spark.js";
import type { WhereRow } from "./where.js";
import { WhereCard } from "./WhereCard.js";
import { type Voice, voiceClass } from "./voice.js";

/** One title on a row's section path, and whose words it is — tree.ts § `titleVoice`. */
export interface PlaceStep {
  title: string;
  voice: Voice;
}

/** A path as one line of text: what a screen reader hears, and what "same place as the row above" compares. */
export function placeText(place: readonly PlaceStep[]): string {
  return place.map((step) => step.title).join(" › ");
}

/** One pass a row's stop could be in, and whether it is — one pip (`StopPasses`). */
export interface SkimPass {
  depth: SkimDepth;
  /** *Gist*, *More*, *Most* — said, never printed. */
  label: string;
  /** The stop is walked in this pass — `walkedIn` (skim-route.ts). */
  on: boolean;
}

/** One row of the list. Built by `useSkimMode`, drawn here. */
export interface SkimRow {
  quoteId: string;
  /** Its number on this pass, from 1. */
  n: number;
  /**
   * The section path, outermost first — drawn `Results › Robustness` — or
   * `null` if the tree does not cover it. Each title carries its voice, since
   * one path can hold the author's heading and the model's (fonts.md).
   */
  place: readonly PlaceStep[] | null;
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
  /**
   * Every pass the route offers, shallowest first, and whether this stop is
   * walked in it — the pips under the number. **`null` when the pips are not
   * drawn at all**: a route offering one depth, or one that carries no stop
   * into a deeper pass, which is every route from before `skim/9`. All rows or
   * none (plan 261003l § The mark).
   */
  passes: readonly SkimPass[] | null;
}

/**
 * **Which snippet is open on the current stop** — one at a time across the
 * card (Sol, plan 260929f F4): a term's card or an idea's statement. Held by
 * the panel, not the card, because the list's follow-scroll has to re-measure
 * when an idea opens. `stop` ties it to the stop it was opened on, so it is
 * hidden during a step before the cleanup effect forgets it permanently.
 *
 * **For a term it is the card a press opened** (a finger's tap, or Enter), and
 * not one that hover or focus is holding open: that is `TermChip`'s own, so
 * pointing at a term does not shut an idea the reader opened.
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
 * **The other passes a stop is in**, for the row's accessible name — *"Also in
 * Gist"*, *"Also in More and Most"* — or `null` for a stop in this pass only,
 * which needs no words. It names the others, not the pass being drawn: the
 * reader knows which pass they are in.
 */
export function alsoIn(passes: readonly SkimPass[], drawn: SkimDepth | null): string | null {
  const others = passes.filter((p) => p.on && p.depth !== drawn).map((p) => p.label);
  return others.length === 0 ? null : `Also in ${others.join(" and ")}`;
}

/**
 * **Which passes the stop is in** — one small pip per pass the route offers,
 * shallowest first, filled when the stop is walked there. Greg, 2026-10-03
 * (spya-ms9d69): *"some kind of subtle visual indicator that indicates which of
 * the three it shows up for ... if possible, we want to avoid text labels ...
 * the visual indicator is a way for me to see whether I've probably read it or
 * not."* On every row of a route that carries any stop, so it is one glyph to
 * learn: one filled pip is this pass only, more than one is "also in Gist".
 *
 * **Not a control** (Sol, plan 261003l review F3): the number column is inside
 * the row's own button and `.skim-where` already lies over the position line
 * below, so a third trigger would nest or collide. Plain marks, drawn for the
 * eye; the words go in the row's name, and the legend in the band's (i) —
 * `pipsLegend` — because a phone has no hover.
 */
function StopPasses({ passes, drawn }: { passes: readonly SkimPass[]; drawn: SkimDepth | null }) {
  const said = alsoIn(passes, drawn);
  return (
    <>
      <span className="skim-pips" aria-hidden="true">
        {passes.map((p) => (
          <span key={p.depth} className={`skim-pip${p.on ? " on" : ""}`} />
        ))}
      </span>
      {said && <span className="skim-pips-said sr-only">{said}</span>}
    </>
  );
}

/** What the pips mean, for the band's (i) — shown only when they are drawn. */
export function pipsLegend(passes: readonly SkimPass[]): string {
  return (
    `The dots under a stop's number show which passes it is in — ${passes.map((p) => p.label).join(", ")}. ` +
    "A stop with more than one filled is one you may have read already."
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
 * N"*. **All three, not Most alone**: since plan 260929e a pass does not
 * contain the ones before it (it may carry some of their stops since plan
 * 261003l), so Most by itself would undercount. The denominator is the route's stored `offered`, not today's raw
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
  /* Close, and only that: a card's own dismissal (Escape, a press elsewhere)
     can arrive after something else took the slot, and must not reopen it. */
  const closeTerm = (id: string) =>
    setSnippet((was) => (was?.kind === "term" && was.id === id ? null : was));
  /**
   * **After a Hide, the keyboard goes to the stop's row.** The chip that held
   * focus, or the card's own button, has just been removed with the term, and
   * focus would fall to `<body>` (GPT Sol, plan review of 261006e, F4). Only
   * when focus is still where the press left it: a slow answer must not pull
   * a reader back from wherever they went meanwhile.
   */
  const focusCurrentRow = () => {
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      active.closest(".skim-term-tip, .skim-card") !== null;
    if (!lost) return;
    scroller.current
      ?.querySelector<HTMLButtonElement>('.skim-go[aria-current="step"]')
      ?.focus({ preventScroll: true });
  };
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
  /* All rows carry the pips or none does (`SkimRow.passes`). */
  const pips = routed ? (view.rows[0]?.passes ?? null) : null;
  const about = routed ? (
    <>
      <p>{promise}</p>
      {pips && <p>{pipsLegend(pips)}</p>}
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
      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

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
                    const place = row.place === null ? null : placeText(row.place);
                    const above = view.rows[index - 1]?.place;
                    const repeatedPlace = place !== null && above != null && place === placeText(above);
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
                          {row.passes && <StopPasses passes={row.passes} drawn={view.depth} />}
                          {row.position !== null && <StopPosition at={row.position} current={row.current} />}
                        </span>
                        <span className="skim-what">
                          {/* A repeated section is said, not drawn: a ditto mark
                              beside a quotation reads as another quotation mark,
                              which is the report behind plan 260928e. */}
                          {repeatedPlace ? (
                            <span className="sr-only">{place}</span>
                          ) : (
                            <span className="skim-place">
                              {row.place === null
                                ? "—"
                                : /* Each title in its own voice; the › between them is ours. */
                                  row.place.map((step, i) => (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ancestry, outermost first; position is its identity.
                                    <Fragment key={i}>
                                      {i > 0 && " › "}
                                      <span className={voiceClass(step.voice)}>{step.title}</span>
                                    </Fragment>
                                  ))}
                            </span>
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
                        {/* `piped`: the pips sit between the number and the
                            position line, so the line and the button laid over
                            it move down by their height (skim.css § .skim-pips). */}
                        <div className={`skim-line${row.passes ? " piped" : ""}`}>
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
                            onCloseTerm={closeTerm}
                            termActions={view.termActions}
                            onHidden={focusCurrentRow}
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
 * **Terms and ideas are chips**, so the reader can stay in Skim (Greg,
 * SPIDERYARN-READING2-59: *"can we make them be expandable as well, like the
 * glossary"*). An idea opens in place to its statement, with an icon into
 * Ideas. A term opens the glossary's own card (`TermChip`): it opened in place
 * to one line of its sense until 2026-10-06.
 */
function StopCardView({
  card,
  open,
  onToggle,
  onCloseTerm,
  termActions,
  onHidden,
  onOpen,
  canOpen,
}: {
  card: StopCard;
  open: OpenSnippet | null;
  onToggle(kind: OpenSnippet["kind"], id: string): void;
  onCloseTerm(id: string): void;
  /** `null` for a visitor. */
  termActions: TermActions | null;
  /** A term was hidden from its card, and its chip is gone or going. */
  onHidden(): void;
  onOpen(target: CardTarget): void;
  canOpen(target: CardTarget): boolean;
}) {
  const pinned = open?.kind === "term" ? open.id : null;
  const idea = open?.kind === "idea" ? (card.ideas.find((i) => i.id === open.id) ?? null) : null;
  return (
    <div className="skim-card">
      {card.terms.length > 0 && (
        <section className="skim-cluster" aria-label="Terms it uses">
          <p className="skim-cluster-h">Terms it uses</p>
          <div className="skim-chips">
            {card.terms.map(({ entry }) => (
              <TermChip
                key={entry.id}
                entry={entry}
                pinned={pinned === entry.id}
                onPress={() => onToggle("term", entry.id)}
                onUnpin={() => onCloseTerm(entry.id)}
                actions={termActions}
                onHidden={onHidden}
                onOpen={
                  canOpen({ kind: "term", id: entry.id })
                    ? () => onOpen({ kind: "term", id: entry.id })
                    : null
                }
              />
            ))}
          </div>
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
                <span className="skim-chip-name">{i.name}</span>
              </button>
            ))}
          </div>
          {idea && (
            <div className="skim-sense">
              <p className="skim-sense-text">{idea.statement}</p>
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
                  <button
                    type="button"
                    className="skim-link skim-event-label"
                    onClick={() => onOpen({ kind: "event", id: event.id })}
                  >
                    {event.label}
                  </button>
                ) : (
                  <span className="skim-event-label">{event.label}</span>
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
 * **A term chip, and the glossary's own card on it** — `TermCard`, the card
 * the prose draws for the same term, inside the shared `Tooltip`. Greg,
 * 2026-10-06 (spya-se0e4v): *"they should provide/reuse the usual 'go to
 * glossary' etc in rich tooltips"*. Plan 261006e.
 *
 * **Two things can hold it open, and they are kept apart.** Hover or focus
 * (`held`, here) is a mouse's and a keyboard's way in, and ends when they
 * leave. A press (`pinned`, the panel's one open snippet) is a finger's: a tap
 * opens the card and it stays until a tap elsewhere, because `Tooltip` does not
 * let hover close a controlled card a finger opened (Tooltip.tsx § `byTouch`).
 * A mouse click does not pin: the card is already up under the pointer, and
 * goes when the pointer does (GPT Sol, plan review F2).
 *
 * `onOpen` is the way into Glossary, or `null` when this reader has no
 * Glossary control. Then the card has no *Open glossary*, and no *Dig deeper*
 * either, since that is where a dig's answer is drawn.
 */
function TermChip({
  entry,
  pinned,
  onPress,
  onUnpin,
  actions,
  onHidden,
  onOpen,
}: {
  entry: GlossaryEntry;
  pinned: boolean;
  onPress(): void;
  onUnpin(): void;
  actions: TermActions | null;
  onHidden(): void;
  onOpen: (() => void) | null;
}) {
  const [held, setHeld] = useState(false);
  const open = held || pinned;
  const close = () => {
    setHeld(false);
    onUnpin();
  };
  /* Hide, and then put the keyboard somewhere: the chip is about to go. */
  const acts: TermActions | null = actions && {
    look: actions.look,
    looking: actions.looking,
    stale: actions.stale,
    hiding: actions.hiding,
    setHidden: async (id, hidden) => {
      await actions.setHidden(id, hidden);
      onHidden();
    },
  };
  return (
    <Tooltip
      content={
        /* Its own scroller, with a height tied to the window, so the row of
           buttons under a long entry can be reached on a short screen
           (skim.css § .skim-term-card; plan review F3). */
        <div className="skim-term-card">
          <TermCard
            entry={entry}
            actions={acts}
            onClose={close}
            onOpen={
              onOpen
                ? () => {
                    close();
                    onOpen();
                  }
                : undefined
            }
            onOpenTerm={onOpen ?? undefined}
          />
        </div>
      }
      /* Under the chip and kept there: a card thrown sideways would sit on
         the chips beside this one (Tooltip.tsx § `keepSide`). */
      placement="bottom"
      keepSide
      className="prose-card skim-term-tip"
      interactive={{ label: `${entry.name}, in the glossary` }}
      open={open}
      onOpenChange={(next) => (next ? setHeld(true) : close())}
    >
      <button
        type="button"
        className={`skim-chip${open ? " on" : ""}`}
        onClick={() => {
          /* Already up by hover or focus: a click is not a second way to shut it. */
          if (held && !pinned) return;
          onPress();
        }}
      >
        <span className="skim-chip-name">{entry.name}</span>
      </button>
    </Tooltip>
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
 * narrow window the band has stepped aside altogether once a row is pressed
 * (F4). Only a row does that since 2026-10-03: the head's ‹ › and depth
 * buttons keep a covering band up (spya-kudr63, SkimMode.tsx § `moveTo`).
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
            title={`Go on to ${door.deeper}: the next pass, in more detail`}
            onClick={onDeeper}
          >
            More detail ›
          </button>
        )}
      </div>
      {/* Where the door leads: the next stop's cue, small and muted — or, at
          the end of a pass, which pass has ended. */}
      {/* The model's cue for the next stop; the fixed "End of …" line below
          shares `skim-door-cue` and stays UI, so the voice is on a modifier. */}
      {door?.kind === "next" && door.cue && (
        <p className="skim-door-cue skim-door-cue-next">{door.cue}</p>
      )}
      {door?.kind === "end" && (
        <p className="skim-door-cue">
          End of {door.pass} — {door.count} {door.count === 1 ? "stop" : "stops"}.
        </p>
      )}
    </div>
  );
}
