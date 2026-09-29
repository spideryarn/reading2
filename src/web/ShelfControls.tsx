/**
 * The one row of controls above the shelf: how it is ordered, what is on it,
 * and how it is painted.
 *
 * Greg, 2026-08-26:
 *
 * > Maybe it's misleading to call this tabular, because I kind of like the rich
 * > cards that we have right now, so look for a best of all worlds.
 *
 * So: **one sort state, two renderers.** The chips here drive the cards and the
 * dense table identically, and switching between the two keeps your place in
 * the order — the pattern Raindrop and Notion both settled on, where a view is
 * a way of painting one list rather than a list of its own. The cards keep the
 * blurb and say what they are sorted by (ShelfEntry.tsx § the note); the table
 * offers the blurb from a card on each title and lets the reader hide any of
 * its five data columns (plan 260928a). Neither is a fallback for the other.
 *
 * The chips themselves are `SortChips` from lib/DataTable.tsx and know nothing
 * about the library — they are built from the table's own columns. What is left
 * here is the shelf's own filtering, column-visibility and view controls.
 *
 * Chips rather than a dropdown, deliberately: six keys fit on a line at this
 * width, one click beats two, and the current order is readable without opening
 * anything. Linear's "Display options" popover is the right answer at three
 * times this many dimensions, and is what to reach for if grouping arrives —
 * see docs/project/library.md § Sorting the shelf. Column visibility arrived
 * first (2026-09-28) and got one small menu of its own, `ColumnsMenu`, shown
 * in table view only: one dimension did not yet earn a popover of popovers.
 */
import { Archive, EyeOff, Rows3, Table as TableIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import type { Table } from "@tanstack/react-table";
import type { LibraryEntry } from "../types.js";
import { chipClass, ColumnsMenu, SortChips } from "./lib/DataTable.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";

export type ShelfView = "cards" | "table";
export type ShelfFilter = "all" | "unread";

export function ShelfControls({
  table,
  chipOrder,
  view,
  onView,
  filter,
  onFilter,
  archived,
  onArchived,
  bare = false,
}: {
  table: Table<LibraryEntry>;
  /** Last opened first, because it is the default sort — library-columns.tsx § CHIP_ORDER. */
  chipOrder: string[];
  view: ShelfView;
  onView: (v: ShelfView) => void;
  filter: ShelfFilter;
  onFilter: (f: ShelfFilter) => void;
  /** `?archived=1`: archived articles on the shelf too. */
  archived: boolean;
  onArchived: (on: boolean) => void;
  /**
   * **Nothing is in scope** — no active article, and the archive either off
   * or empty — so only the Archived chip is drawn. A sort control over an
   * empty shelf is furniture, but a reader whose every article is archived
   * must still be able to reach them (plan 260929a, GPT Sol R2): the chip
   * used to live at the foot of the shelf, outside the guard that hid these
   * controls from an empty shelf.
   */
  bare?: boolean;
}) {
  /* Every accessible name here **begins with the visible text** — see the
     Unread chip below for why. */
  const archivedChip = (
    <Chip
      pressed={archived}
      describe={
        archived
          ? "Archived — showing archived articles on the shelf too, each marked. Activate to hide them."
          : "Archived — show archived articles on the shelf too, sorted and filtered with the rest"
      }
      onClick={() => onArchived(!archived)}
    >
      <Archive size={12} />
      Archived
    </Chip>
  );

  if (bare) {
    return (
      <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        {archivedChip}
      </div>
    );
  }

  return (
    <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
      <SortChips table={table} order={chipOrder} />

      {/* `flex-wrap` since 2026-09-28: with Columns beside the view switch the
          group is four controls, and at phone width a group that cannot wrap
          pushes the page sideways rather than taking a second line (plan
          260928a, Sol P-8). `justify-end` so a wrapped control stays at the
          right, under the others. */}
      <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
        <div className="tw:ml-auto tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
          <Chip
            pressed={filter === "unread"}
            /* Every accessible name here **begins with the visible text**, so
               that somebody driving the page by voice can say what they can see —
               `aria-label` replaces the button's own words outright, and WCAG
               2.5.3 Label in Name is what that fails. The first version of this
               one said "Showing only articles you have never opened" and never
               contained the word "Unread". Caught by a cross-family review,
               2026-08-26. */
            describe={
              filter === "unread"
                ? "Unread — showing only articles you have never opened. Activate to show all."
                : "Unread — show only articles you have never opened"
            }
            onClick={() => onFilter(filter === "unread" ? "all" : "unread")}
          >
            <EyeOff size={12} />
            Unread
          </Chip>

          {/* **Archived, beside Unread**, since plan 260929a. Greg,
              2026-09-29 (SPIDERYARN-READING2-4V): *"it would be better if it
              was a (default-hide-archived) toggle at the top (like for
              "Unread"), so that it's easy to show some/all (so we can use the
              faceted-search-topic-pills and/or sort to look through the
              Archived articles easily too)"*. It was a disclosure at the foot
              of the shelf. On, the archived articles join the one list, so the
              sort, the search, Unread and the topics all apply to them. */}
          {archivedChip}

          {/* **Columns, in table view only** — the cards have no columns to
              hide. Beside the switch, because which columns the table shows is a
              question about how the shelf is drawn, the same as the switch.
              The way back from a right-click hide, and the route that works on a
              finger (lib/DataTable.tsx § ColumnsMenu; plan 260928a, Decision 3). */}
          {view === "table" && <ColumnsMenu table={table} />}

          <ViewSwitch view={view} onView={onView} />
        </div>
      </TooltipGroup>
    </div>
  );
}

function Chip({
  pressed,
  describe,
  onClick,
  children,
}: {
  pressed: boolean;
  describe: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Both: `title` is the hover hint, `aria-pressed` + `aria-label` are what
      // a screen reader gets. `aria-pressed` is what makes this read as state
      // rather than as a button that does something unrelated.
      aria-pressed={pressed}
      aria-label={describe}
      title={describe}
      // The same pill the sort chips wear, from the one place that spells it —
      // see `chipClass` in lib/DataTable.tsx on why it is not written twice.
      className={chipClass(pressed)}
    >
      {children}
    </button>
  );
}

/**
 * **Cards or table: one of two, so it is a radio group.**
 *
 * It was two `aria-pressed` buttons in a `<fieldset>` until 2026-09-06, and that
 * is the wrong pattern by the APG's own definitions. A toggle button models an
 * *independent* binary control ("is bold on") and cannot express that exactly
 * one of these is always chosen; the radio pattern is "a set of checkable
 * buttons where no more than one can be checked at a time", and it explicitly
 * endorses styling them to look like toggle buttons, which is what this is.
 *
 * **Tabs is the other wrong answer**, and the more tempting one. The APG defines
 * tabs as switching between *layered sections of content*. These two switch the
 * *painting of one list* — same rows, same order, same sort state, which is the
 * distinction this file's header comment has always drawn. Nothing is being
 * shown or hidden, so there is no tabpanel for a tab to control.
 *
 * **Radix's `RadioGroup`, not its `ToggleGroup`.** `ToggleGroup type="single"`
 * gives radiogroup roles too and was the first suggestion, but a toggle group
 * can be deselected to an empty value, and "no view at all" is not a state this
 * page has. `RadioGroup` models the invariant exactly and brings the roving
 * tabindex, the arrow keys that move selection as well as focus, Home/End,
 * wrapping and RTL — all of which a hand-rolled version has to get right, and
 * the plan for this change badly underestimated. GPT Sol, 2026-09-06.
 *
 * **`onValueChange` only fires on a change**, which preserves the property the
 * old handlers spelled out by hand: `view` is a `push` parameter, so re-selecting
 * the current view would put an identical entry on the history stack and cost
 * the reader an extra press of Back.
 */
function ViewSwitch({ view, onView }: { view: ShelfView; onView: (v: ShelfView) => void }) {
  return (
    /* **A 32px track holding 28px targets**, and the two numbers are worth
       stating separately because an earlier version of this comment said "32px,
       not 28" and meant the track — which overstates what actually got bigger.
       GPT Sol, 2026-09-06.

       The track is `h-8`; each radio is `h-7`, and the 2px between them (1px
       border + 1px padding) is not clickable. So the **hit target** went from
       24px to 28px, and the thing you aim at went from a bare icon to an icon
       with a word beside it. 28 is comfortably above WCAG 2.2's 24px floor and
       still under Material's 40dp segmented-button ideal; the old 24px was
       below every shadcn default (`sm` is `h-8`), which is most of why Greg
       could not find this control.

       The chips beside it are `h-7`, so the track stands 4px proud of them. A
       control doing something different is allowed to be the taller thing in
       the row, and at 32 against 28 it reads as deliberate rather than as a
       mismatch.

       `rounded-sm` inside `rounded-md` is still not a guess: an inner radius is
       the outer one minus the padding between them, 8 − 2 = 6px, which is what
       `radius-sm` resolves to. */
    <RadioGroup.Root
      value={view}
      onValueChange={(v) => onView(v as ShelfView)}
      /* Horizontal, so ← and → drive it rather than ↑ and ↓ — the arrows that
         match the way the two sit on screen. */
      orientation="horizontal"
      aria-label="How the shelf is shown"
      className="tw:flex tw:h-8 tw:items-center tw:gap-0.5 tw:rounded-md tw:border tw:border-border tw:p-px"
    >
      <ViewOption value="cards" tip={VIEW_TIPS.cards} current={view}>
        <Rows3 size={14} />
      </ViewOption>
      <ViewOption value="table" tip={VIEW_TIPS.table} current={view}>
        <TableIcon size={14} />
      </ViewOption>
    </RadioGroup.Root>
  );
}

/**
 * One segment.
 *
 * **The label is drawn beside the icon above `sm` and hidden below it.** Two
 * well-known glyphs are enough on their own for a two-option switcher — Linear
 * ships exactly this, icon-only — but there is room on this row at any ordinary
 * window width, and a word is free discoverability for the reader who has never
 * pressed it. The `sr-only` span is what keeps the accessible name intact when
 * the visible word goes away, so the control is named identically either way.
 */
function ViewOption({
  value,
  tip,
  current,
  children,
}: {
  value: ShelfView;
  tip: { head: string; what: string; how: string };
  current: ShelfView;
  children: React.ReactNode;
}) {
  const selected = current === value;
  return (
    <Tooltip content={<ControlTip {...tip} />} placement="bottom">
      <RadioGroup.Item
        value={value}
        className={`tw:inline-flex tw:h-7 tw:items-center tw:gap-1.5 tw:rounded-sm tw:px-2 tw:text-xs tw:transition-colors ${
          selected
            ? "tw:bg-highlight/15 tw:text-highlight"
            : "tw:bg-transparent tw:text-muted-foreground tw:hover:bg-highlight/10 tw:hover:text-foreground"
        }`}
      >
        {children}
        {/* **One span, not two.** The first version drew the word twice — once
            `hidden sm:inline` and once `sm:hidden sr-only` — which is correct in
            both directions and needs a reader to hold two media queries in their
            head to see that it is. `sr-only` clips rather than hiding, so the
            word is in the accessible name at every width and merely *visible*
            from `sm` up. */}
        <span className="tw:sr-only tw:sm:not-sr-only">{tip.head}</span>
      </RadioGroup.Item>
    </Tooltip>
  );
}

/**
 * **What each view is, then what it costs you** — the shape every other card in
 * this app uses (Tooltip.tsx § `ControlTip`).
 *
 * A native `title` was what these carried until 2026-09-06, and Greg asked for
 * "a rich tooltip" by name. He was right to: a `title` waits about a second,
 * cannot be styled, truncates at the OS's idea of a line, and **does not exist
 * at all on a touch device** — which for a sentence whose whole job is to say
 * what a control means is close to not being there.
 *
 * The second paragraph is the one a reader could not have worked out by pressing
 * the button, which is the rule for this card: not "it shows a table", but what
 * that costs and what it does not promise.
 *
 * **The Table card was rewritten on 2026-09-28**, because two of its promises
 * stopped being true in plan 260928a: it said "every column at once" and "No
 * blurb". It now says where the blurb went and what hiding leaves unchanged.
 * Exported for tests/shelf-table-row-card.test.tsx.
 */
export const VIEW_TIPS = {
  cards: {
    head: "Cards",
    what: "One card per article, with the blurb — the tree root's own sentence about the whole piece.",
    how: "The blurb is what makes a card a decision aid rather than a row: you are choosing what to read, and it says what the piece is about before you open it. Costs vertical space, so fewer articles fit on a screen.",
  },
  table: {
    head: "Table",
    what: "One compact row per article, with its title and the data columns you have chosen to show.",
    how: "The blurb is not on the row: point at a title, or tab to it. The card shows its blurb when there is one, plus the date and time behind each date the row has. A column you hide, from Columns or by right-clicking its header, stays available in that card. Both views share one sort, so switching keeps your place in the order.",
  },
} as const;
