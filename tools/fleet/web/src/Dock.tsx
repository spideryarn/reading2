/**
 * The bottom bar: the three modes, and the one control worth putting under a
 * thumb.
 *
 * **PORTED FROM src/web/Dock.tsx**, whose 3,000 lines are mostly a drawer this
 * tool has no use for. What came across is the shape and the argument, and the
 * argument is the reason this is not a row of tabs at the top any more:
 *
 * > docs/plans/260825c-bottom-bar.md — why the bottom rather than the left.
 *
 * On a phone the top of the screen is the furthest thing from your thumb, and
 * this page is read one-handed while walking to the kettle. The measurements —
 * the 2.5rem bar, the 3.5rem one under a coarse pointer, the 40px floor on a
 * button, the segment's hairlines, the inset cap that marks the active mode —
 * are all the product's, and tailwind.css § dock says what changed and why.
 *
 * **What is NOT here, deliberately.** No drawer, no scrim, no sliding away as
 * you scroll: the product's bar hides itself to give a long article the whole
 * screen, and nothing on this page is a long read.
 *
 * **A new mode DOES need touching here**, and this comment used to say it did
 * not. That was true of the bar's layout and fit (fit.ts) and false of the two
 * `Record<Mode, …>` maps below, which is the half a reader acts on. Adding a
 * mode is four registrations — `MODES` and `MODE_LABELS` in mode.ts, plus
 * `MODE_ICONS` and `MODE_TIPS` here — and then a mount in App.tsx.
 * docs/project/fleet-dashboard-modes.md is the checklist.
 */
import { Gauge, Hourglass, ListChecks, MessagesSquare, Network, RefreshCw, Rocket, type LucideIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { Tooltip, TooltipGroup, TipCard, type Tip } from "./Tooltip";
import { MODES, MODE_LABELS, type Mode } from "./mode";
import { cx } from "./ui";

/**
 * One glyph per mode, and one card.
 *
 * **The glyph is not decoration** — at the bar's last rung it is the only thing
 * left of a button that is not the active one, which is what the fit ladder
 * trades a word for. `size` and `strokeWidth` follow the house defaults from
 * docs/project/icons.md (16px, 1.75 rather than Lucide's 2, so the chrome
 * recedes); the product sets them once in a `<LucideProvider>` and this tool
 * has four icons, which is fewer than the provider costs to explain.
 *
 * The cards follow docs/project/tooltips.md's rule: the first sentence is what
 * a reader could have guessed by pressing the button, and the second is what
 * they could not.
 */
const MODE_ICONS: Record<Mode, LucideIcon> = {
  sessions: ListChecks,
  messages: MessagesSquare,
  health: Gauge,
  /* An hourglass rather than a second dial: `health` already owns `Gauge`, and
     at dock size two dials are one shape. A limit is a window that runs out and
     turns over, which is the thing this tab is actually about. */
  usage: Hourglass,
  overseer: Network,
  deploys: Rocket,
};

const MODE_TIPS: Record<Mode, Tip> = {
  sessions: {
    head: "Sessions",
    what: "Every tmux session on the box, worst first: who needs an answer, then what is moving, then everything quiet.",
    how: "Read off the box about once a minute. Open one to see what it is asking, answer it, or say something to it — the dashboard types at the pane, and checks first that the pane is still the one you were shown.",
  },
  messages: {
    head: "Recent messages",
    what: "The last N messages across every session at once, newest first, filtered by session, speaker or text.",
    /* **The artefact, not the gesture** — this copy is read on the button, in
       the panel and by a screen reader, and "pressing this reads every
       transcript" is false on the surfaces where nothing is being pressed.
       What it could not have guessed is that the window is a snapshot rather
       than a live tail, and that it says what it could not read. */
    how: "A snapshot of the moment it was fetched, not a live tail — and it names the sessions it could not read, so a short list is never mistaken for a quiet fleet.",
  },
  health: {
    head: "Box health",
    what: "Load, memory, swap and disk, with a verdict over them.",
    how: "The verdict is the collector's own, and it has a fourth level — a reading nobody could take never renders as a healthy zero.",
  },
  usage: {
    head: "Usage limits",
    what: "How much of each Claude window has been spent, and every rate-limit rejection we can find in the transcripts.",
    /* The non-obvious half is the ATTRIBUTION, not the freshness. The cached
       percentages belong to the account that is logged in; a 429 in a transcript
       carries no account id at all, and the scan looks back eight days, which
       may span a /login swap. So "we were limited" and "this account was
       limited" are different claims, and only the verdict makes the second. */
    how: "The percentages are a cache the box reads, so an expired window shows as unknown rather than as a number. A rejection is exact, but carries no account — so it says a limit was hit, not whose.",
  },
  overseer: {
    head: "Overseer",
    what: "What this tool is meant to become: a coordinator agent rather than a person with a mouse.",
    how: "It is a roadmap, not a feature. Nothing on that panel is live, and it says so.",
  },
  deploys: {
    head: "Deploys",
    what: "Every production deploy there is a written record of, newest first: when it shipped, what a reader would have noticed, and the commits behind it.",
    /* The non-obvious half is that this is a FILE rather than a live reading —
       and it points at where the staleness is stated rather than promising a
       freshness here, which is `usage-limits-tab`'s note: a tooltip that says
       "only as fresh as the last run" invites the question the header already
       answers with a number. */
    how: "The record is a committed file, not a call to Vercel — this box has no token for one — so the first line of the tab says how far behind main it has fallen.",
  },
};

function DockMode({
  mode,
  current,
  count,
  onChoose,
}: {
  mode: Mode;
  current: Mode;
  /** The "needs you" tally, on the mode that owns it. `null` on the others. */
  count: number | null;
  onChoose: (mode: Mode) => void;
}): ReactNode {
  const active = mode === current;
  const Icon = MODE_ICONS[mode];
  const label = MODE_LABELS[mode];
  return (
    <Tooltip
      content={<TipCard tip={MODE_TIPS[mode]} />}
      placement="top"
      /* **`mouseOnly` here and nowhere else on the page.** A tap on this button
         switches mode, so a card opening at the same time lands over the panel
         the tap just brought up. Every other tooltip on this page explains
         something and does nothing else, so a finger is welcome to open it. */
      mouseOnly
    >
      <button
        type="button"
        role="radio"
        aria-checked={active}
        /* The card is the button's DESCRIPTION (`useRole` wires it up as
           `aria-describedby`), never its name — and the visible label is gone
           at the bar's last rung, so the name has to be stated. */
        aria-label={count === null || count === 0 ? label : `${label}, ${count} need you`}
        onClick={() => onChoose(mode)}
        className={cx("dock-btn", active && "on")}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="dock-btn-label">{label}</span>
        {count !== null && count > 0 ? (
          <span className="dock-count hot" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

const REFRESH_TIP: Tip = {
  head: "Refresh",
  what: "Ask the box for a fresh snapshot now, rather than waiting for the next poll.",
  how: "A collection costs the box about ten seconds of work, so the answer is not instant — the age in the masthead is what tells you it landed.",
};

export function Dock({
  mode,
  onChoose,
  needsYou,
  onRefresh,
  fitClass,
  barRef,
}: {
  mode: Mode;
  onChoose: (mode: Mode) => void;
  /** How many sessions are waiting on a person, for the badge. */
  needsYou: number;
  onRefresh: () => void;
  /** The rung, from `useDockFit`. See fit.ts for why it is written twice. */
  fitClass: string;
  barRef: RefObject<HTMLDivElement | null>;
}): ReactNode {
  return (
    /* One `TooltipGroup` around the whole bar: once a card is open its
       neighbours open instantly while the pointer keeps moving, so the row
       reads as one control to point along rather than four separate waits. */
    <TooltipGroup delay={{ open: 240, close: 90 }}>
      <nav ref={barRef} className={`dock${fitClass}`} aria-label="Fleet views">
        <div className="dock-modes" role="radiogroup" aria-label="Fleet views">
          {MODES.map((m) => (
            <DockMode
              key={m}
              mode={m}
              current={mode}
              count={m === "sessions" ? needsYou : null}
              onChoose={onChoose}
            />
          ))}
        </div>

        <div className="dock-gap" />

        {/* `.dock-app` is the cluster whose word goes first when the row will
            not fit — see the ladder in tailwind.css. */}
        <Tooltip content={<TipCard tip={REFRESH_TIP} />} placement="top" mouseOnly>
          <button type="button" onClick={onRefresh} aria-label="Refresh now" className="dock-btn dock-app">
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="dock-btn-label">Refresh</span>
          </button>
        </Tooltip>

        {/* The trailing gutter, as a real child rather than as padding: Chrome
            leaves a flex container's trailing padding out of its scrollable
            overflow, so a gutter spelled that way is invisible to the fit
            measurement and the last button ends up sitting in it — six pixels
            on a laptop, and the camera cutout on a phone held landscape. */}
        <div className="dock-tail" />
      </nav>
    </TooltipGroup>
  );
}
