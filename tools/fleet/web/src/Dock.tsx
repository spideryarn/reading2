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
 * screen, and nothing on this page is a long read. If a fourth mode arrives,
 * nothing here needs touching — `MODES` in mode.ts is the list, and the bar
 * measures its own fit (fit.ts).
 */
import { Gauge, ListChecks, Network, RefreshCw, type LucideIcon } from "lucide-react";
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
  health: Gauge,
  orchestrator: Network,
};

const MODE_TIPS: Record<Mode, Tip> = {
  sessions: {
    head: "Sessions",
    what: "Every tmux session on the box, worst first: who needs an answer, then what is moving, then everything quiet.",
    how: "Read off the box about once a minute. A session that is asking you something shows the question and the keys that would answer it — this page sends nothing.",
  },
  health: {
    head: "Box health",
    what: "Load, memory, swap and disk, with a verdict over them.",
    how: "The verdict is the collector's own, and it has a fourth level — a reading nobody could take never renders as a healthy zero.",
  },
  orchestrator: {
    head: "Orchestrator",
    what: "What this tool is meant to become: a coordinator agent rather than a person with a mouse.",
    how: "It is a roadmap, not a feature. Nothing on that panel is live, and it says so.",
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
