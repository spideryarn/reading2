/**
 * The list — what is running on the box — and, since 2026-09-08, the pane that
 * opens when you pick one.
 *
 * ## The one thing this screen is for
 *
 * A `needs-you` row, especially one carrying a question, is what Greg opens
 * this on a phone to see. So it is sorted first, drawn in its own band under
 * its own heading, given the loud edge, and its question is rendered in full
 * rather than summarised. Everything else on this page is arrangement; that is
 * the feature.
 *
 * ## Three bands, not seven ranks — and four other orders
 *
 * `triageSort` in view.ts puts them in order and `triageBand` says which band a
 * row is in; this file only groups what it is handed. The bands are Greg's, out
 * of docs/project/overseer-direction.md, and the reasoning for the two
 * surprising memberships — a busy shell is not promoted, and `unknown` is not
 * promoted either — is in tools/fleet/status.ts, which is where it belongs.
 *
 * An `unknown` row therefore sits in the quiet band while carrying a reason
 * that may be the most interesting thing on the page. That is why the reason is
 * always drawn, in the violet the whole tool reserves for it: the ORDER cannot
 * make it visible, so the COLOUR has to.
 *
 * **The bands exist only in the default order**, and that is deliberate rather
 * than an omission. Grouping by status while sorting by uptime would put the
 * longest-running session third, under a heading that is the thing the reader
 * just asked not to sort by — the grouping would silently win. So `status` gets
 * headings and the other four get one flat list, with the same coloured edge on
 * every card either way (`ORDERINGS` in view.ts).
 *
 * ## Master and detail, and why the detail is a push
 *
 * At a width that affords both, picking a session splits the page: the list
 * narrows to one column on the left and the detail takes the rest. Below that —
 * a phone, which is where this is mostly read — **the detail REPLACES the
 * list** and a button brings it back. A two-pane layout squeezed into 390px is
 * two columns of nothing; docs/project/narrow-windows.md's rule is that a
 * column which will not fit is given up whole rather than compressed, and
 * `choosePanes` in fit.ts is that rule for this pane. **Measured, never a
 * breakpoint** — the width it changes at is `COLUMN_MIN_PX + DETAIL_MIN_PX +
 * PANE_GAP_PX` and is written down nowhere else.
 *
 * With nothing selected the list is exactly what it was before any of this:
 * the three bands dealt into as many columns as the window affords. That is not
 * a third layout, it is the second one with the detail absent.
 */
import { useCallback, useRef, type ReactNode } from "react";

import { NewSessionPanel } from "./NewSessionPanel";
import { PauseLine } from "./PauseLine";
import { MissingSession, SessionDetail } from "./SessionDetail";
import { Handles, LaunchMode, QuestionCard, StatusPill, Uptime } from "./SessionParts";
import { Explain, type Tip } from "./Tooltip";
import { useExecutionEpoch } from "./continuity";
import { COLUMN_MIN_PX, chooseColumns, choosePanes, spreadIntoColumns, useContainerWidth } from "./fit";
import type { NewSessionApi } from "./new-session-client";
import type { MessagesApi } from "./messages-client";
import type { RenameApi } from "./rename-client";
import type { SteerApi } from "./steer-client";
import type { ActionsUi } from "./useActions";
import { Card, SectionHeading, cx, toneClasses } from "./ui";
import type { AnsweringReading, FleetRow } from "./types";
import {
  ORDERINGS,
  ORDERING_LABELS,
  type Ordering,
  sortRows,
  statusLabel,
  triageBand,
  whereLine,
} from "./view";


/**
 * One session, as a row you can open.
 *
 * The title is the heading because it is what identifies a session to a person;
 * the tmux handle is beneath it in mono because it is what identifies it to a
 * program. `no title yet` is a real state — Claude has not named the
 * conversation — and says so rather than falling back to the session name,
 * which would make an unnamed session look named.
 *
 * **The whole card is the target, and there is still only one button in it.**
 * The heading holds a real `<button>`; a `::after` on that button is stretched
 * across the card (tailwind.css § the session list), so a thumb can land
 * anywhere. The alternative — a `<button>` wrapping the card — would nest the
 * status pill's explanation inside another button, which is invalid and reads
 * as one control to a screen reader. The explanations sit above the overlay
 * (`z-index`), so tapping the pill still opens its card rather than the
 * session; that is the one place on the card where a tap does something else,
 * and it is the place a reader taps when they want to know what the word means.
 */
/**
 * **The two chips a card can wear, and what each one is claiming.**
 *
 * Exported so that tests/fleet-tooltip-copy.test.ts can assert the house rules
 * over them without mounting a panel that takes fifteen props. Both were native
 * `title=` attributes until 2026-09-09 — a sentence that does not exist on a
 * phone — and each `how` is the half a reader could not have guessed from the
 * word: for the Overseer badge, that a *missing* badge is not the same as there
 * being no Overseer; for `generated`, who wrote the words.
 */
export const OVERSEER_BADGE_TIP: Tip = {
  head: "Overseer",
  what: "This session holds the Overseer claim — the box is meant to have exactly one, supervising all the others.",
  /* The claim is a variable in that session's tmux environment
     (overseer-claim.ts), so it dies with the tmux server; and a per-row badge
     structurally cannot draw an absence. The masthead is where `none` and
     `contested` are said out loud, which is why this points at it. */
  how: "The claim lives in that session's tmux environment, so a reboot leaves nobody holding it. No badge anywhere on the list does not mean the fleet is unsupervised — the line under the tally in the masthead is the one that can say so.",
};

export const GENERATED_TITLE_TIP: Tip = {
  head: "Generated title",
  what: "A model's one-line guess at what this session is for, written from its opening messages — not a title the session gave itself.",
  how: "Marked because a guess drawn like a fact is the thing this page is written against. A session that has named itself shows that name instead, unmarked, and one that has done neither falls back to its tmux handle in grey.",
};

/**
 * WHAT TO CALL A SESSION, IN ORDER OF WHO SAID IT.
 *
 * Three sources and they are not interchangeable, so the reader is told which
 * one they are looking at:
 *
 *  1. **The session's own title**, from Claude's `aiTitle` or from a name given
 *     at launch. It wins the moment it exists — Greg's rule.
 *  2. **A generated one**, marked as such. It is a model's guess about what the
 *     session is for, and a guess drawn like a fact is the thing this whole page
 *     is written against.
 *  3. **The tmux name**, which is always there and is an address rather than a
 *     description — but it beats "no title yet", which tells the reader nothing
 *     they could not see.
 *
 * **A title that IS the session's name is not a title.** Launching with a name
 * writes it as the session's own title, so most of this fleet carries one that
 * merely repeats the name in the line below it — and treating that as "already
 * titled" is what would make the generated one unreachable for exactly the
 * sessions that need it. Found by a cross-family review as F4.
 */
export function headingFor(row: FleetRow): { kind: "own" | "generated" | "name"; text: string } {
  const own = row.title?.trim() ?? "";
  if (own !== "" && own !== row.name) return { kind: "own", text: own };
  if (row.description.kind === "described") return { kind: "generated", text: row.description.title };
  return { kind: "name", text: row.name };
}

function SessionCard({
  row,
  now,
  selected,
  onSelect,
  compact,
}: {
  row: FleetRow;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
  /** The narrow left-hand column beside an open detail. See `QuestionCard`. */
  compact: boolean;
}): ReactNode {
  const label = statusLabel(row.status);
  const tone = toneClasses(label.tone);
  const where = whereLine(row);
  /* Only a version-1 meta has a directory; a `legacy` session recorded none,
     and there is nothing to show rather than something to apologise for. */
  const dir = row.meta.version === 1 ? row.meta.dir : null;
  const heading = headingFor(row);

  return (
    <Card
      className={cx(
        "session-card tw:mb-2 tw:border-l-4 tw:p-3",
        tone.edge,
        label.tone === "needs" && "tw:bg-needs-wash",
        selected && "on",
      )}
    >
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
        <StatusPill status={row.status} />
        {/* BESIDE THE PILL, NEVER INSTEAD OF IT. A cron-parked session and a
            rate-limited one are both genuinely `idle`, so the pill is unchanged
            and this is the added fact — the one that says whether the calm is
            "finished" or "blocked and nobody has noticed". It renders nothing
            when there is nothing to say. PauseLine.tsx has the reasoning. */}
        <PauseLine pause={row.pause} status={row.status} now={now} />
        {/* THE OVERSEER'S BADGE. Drawn only for the one session that holds the
            claim — the header carries the absent state, which is the one a
            per-row badge structurally cannot show. Nothing is drawn for a role
            this page does not know: it is not the Overseer, and a badge for it
            would read as one. */}
        {row.role.kind === "overseer" ? (
          /* **A card rather than the `title=` this carried until 2026-09-09.**
             The browser's own tooltip shows something under a mouse and nothing
             at all under a finger, on the page Tooltip.tsx's header says is
             mostly read on a phone — so the badge explained itself only to the
             reader least likely to need it. `Explain` puts the same sentence in
             the accessible name, which is also where a screen reader finds it. */
          <Explain tip={OVERSEER_BADGE_TIP} placement="bottom">
            <span className="tw:rounded tw:bg-ink/10 tw:px-1.5 tw:py-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:uppercase tw:text-ink-soft">
              Overseer
            </span>
          </Explain>
        ) : null}
        <Uptime row={row} now={now} className="tw:ml-auto" />
      </div>

      <h3 className="tw:mt-1.5 tw:leading-snug tw:font-medium tw:break-words">
        <button
          type="button"
          className={cx(
            "session-open",
            /* ONLY A BARE NAME IS FAINT. A generated title is real
               information about the session and a tmux name is the absence
               of any, and the first version drew both in the same grey — so
               a described row and an undescribed one looked equally
               de-emphasised, which defeats the point of distinguishing the
               three sources at all. The marker says it is generated; the
               colour no longer has to. Found in a browser, where it is the
               only place it is visible. */
            heading.kind === "name" && "tw:text-ink-faint",
          )}
          aria-current={selected ? "true" : undefined}
          onClick={() => onSelect(row.id)}
        >
          {heading.text}
        </button>
        {heading.kind === "generated" ? (
          /* SAID OUT LOUD, because a generated title is a guess about a session
             and the reader has to be able to tell it from the one Claude gave
             itself. Greg: show it "marked as generated". */
          /* A CHIP RATHER THAN FAINT TEXT, and the reason is a browser
             check's judgement rather than a measurement: with the title no
             longer greyed, faint grey text pushed to the right of a
             variable-length heading is easy for an eye scanning a left-aligned
             column to miss. The same chip the Overseer badge uses, so the page
             has one way of saying "this is a tag about the row" — and it costs
             the title nothing, which was the point of un-greying it. */
          /* The card, for the same reason as the Overseer badge above: what
             this chip means was a `title=` and therefore invisible on a phone. */
          <Explain tip={GENERATED_TITLE_TIP} placement="bottom" className="tw:ml-1.5 tw:align-middle">
            <span className="tw:rounded tw:bg-ink/10 tw:px-1.5 tw:py-0.5 tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-ink-soft tw:uppercase">
              generated
            </span>
          </Explain>
        ) : null}
      </h3>

      {/* WHAT THIS SESSION IS ABOUT, which is the whole point of the feature: a
          list of thirty rows showing a status pill and a tmux name is a list you
          cannot triage. Drawn under the title and above the status sentence,
          because it is what you scan for. */}
      {row.description.kind === "described" ? (
        /* CLAMPED TO TWO LINES, and the cap is about triage rather than
           tidiness: at 390px a 185-character description runs to four
           lines, which is about three cards per screen — a scroll rather
           than a list you can scan. Measured in a browser. The full text
           is one tap away in the detail view. */
        <p className="tw:mt-1 tw:line-clamp-2 tw:text-[13px] tw:break-words tw:text-ink-soft">
          {row.description.description}
        </p>
      ) : null}

      {label.detail !== null ? (
        <p className={cx("tw:mt-1 tw:text-[13px] tw:break-words", tone.ink)}>{label.detail}</p>
      ) : null}

      {/* Above the identifiers and below the title, because a session that did
          not launch in auto mode is a fact about the session rather than
          something you do to it — and it has to be visible on the LIST, since
          the point is to catch it inside a minute rather than to find it after
          you have already opened the session to wonder why it is quiet. Silent
          on a healthy row: see `LaunchMode`. */}
      <LaunchMode mode={row.permissionMode} detail={false} />

      {/* **The path is the disambiguation, and it exists nowhere else.**
          `row.worktree` is only the last segment of the directory, and this box
          runs several worktrees whose names differ by a word — so where two
          rows look identical, the full `dir` out of `row.meta` is the thing
          that tells them apart. Shown as a card rather than as a line, because
          it is long, it is only wanted when two rows collide, and `Explain`
          keeps it in the accessible name either way. */}
      {where === null ? (
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint">no repo recorded</p>
      ) : dir === null ? (
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-ink-soft">{where}</p>
      ) : (
        <Explain
          tip={{
            head: "Where it is running",
            what: dir,
            how: "The name above is only the last segment of that path. Two worktrees can differ by a word, so this is what tells them apart.",
          }}
          placement="bottom"
          className="tw:mt-1 tw:block tw:text-[13px] tw:break-words tw:text-ink-soft"
        >
          {where}
        </Explain>
      )}

      <Handles row={row} />

      {/* Still the whole dialog, not a preview. Seeing what a blocked session
          is asking WITHOUT tapping anything is the reason this page is opened
          on a phone; the detail's copy of it is the one with buttons on. */}
      {row.question !== null ? (
        <QuestionCard question={row.question} sessionName={row.name} compact={compact} />
      ) : null}
    </Card>
  );
}

/**
 * **What each band is, keyed by the heading the panel builds.**
 *
 * The three bands are Greg's, out of overseer-direction.md, and the words are
 * only in `SessionsPanel`'s own `bands` array — so a heading that changes there
 * silently falls through to the general card below rather than describing the
 * wrong band. `default` is that retreat, and it is a real answer: it says the
 * bands exist and what orders them, which is true of any of them.
 */
export const BAND_TIPS: Record<string, Tip> = {
  "Needs you": {
    head: "Needs you",
    what: "Blocked on a person: a permission prompt, a question, a dialog waiting for an answer. Nothing in here is moving.",
    how: "First on the page whatever else is happening, because it is the only band anybody can clear. Each row is read off that session's own terminal, so it is a good guess rather than something the box reported.",
  },
  Working: {
    head: "Working",
    what: "An agent is mid-turn here, with nothing waiting on anybody.",
    how: "Second, and sorted newest first inside the band. A session can be working and wrong, so the number is about motion rather than progress — what a session is actually doing is in its own card.",
  },
  "Everything else": {
    head: "Everything else",
    what: "Idle agents, sessions sleeping until a time, and shells with no agent in them at all — one band, not three.",
    how: "Deliberately not split further: a screen with seven ranks is one nobody reads the bottom of. The distinctions are still on every row, because “sleeping until 4pm” and “nobody is home” are different things to find out at midnight.",
  },
};

/** The general card, for a heading `BAND_TIPS` has no entry for — a real answer, not a shrug. */
export const ANY_BAND_TIP: Tip = {
  head: "A band",
  what: "The list is grouped into three: who needs an answer, then what is moving, then everything quiet.",
  how: "Ordered that way because the first question this page is built to answer is whether anybody is waiting on you, and the second is what is actually running. Inside a band, newest first.",
};

function bandTip(title: string): Tip {
  return BAND_TIPS[title] ?? ANY_BAND_TIP;
}

export const ORDER_TIP: Tip = {
  head: "Order",
  what: "How the list is sorted. The default is the three-band triage — needs you, working, everything else — and the others are flat lists of the same sessions.",
  how: "The alternatives exist for questions triage cannot answer: what has been running all night, what did I just start, where is the one in that worktree. Sorting by repo and worktree is the only way to find a session when you know where it is working but not what it is called.",
};

/** A band of rows under its own heading. Only ever built for a non-empty one. */
function Band({
  title,
  rows,
  now,
  selectedId,
  onSelect,
  compact,
}: {
  title: string;
  rows: FleetRow[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact: boolean;
}): ReactNode {
  return (
    <section>
      {/* **The band heading, which is the one place the three-way triage is
          named.** `Everything else` in particular says nothing about what is in
          it, and it is the biggest band on a quiet box. */}
      <SectionHeading tip={bandTip(title)}>
        {title} · {rows.length}
      </SectionHeading>
      {rows.map((row) => (
        <SessionCard
          key={row.id}
          row={row}
          now={now}
          selected={row.id === selectedId}
          onSelect={onSelect}
          compact={compact}
        />
      ))}
    </section>
  );
}

/**
 * The row above the list: how many there are, and how they are sorted.
 *
 * A native `<select>` rather than a row of chips. It is one control at every
 * width, it is what a phone already knows how to draw, and five orderings as
 * chips would be a row that wraps to two lines on the device this page is
 * mostly read on. `flex-wrap` regardless, per the rule that a row of things
 * whose widths you do not control must be allowed to wrap
 * (docs/project/narrow-windows.md).
 */
function ListControls({
  count,
  order,
  onOrder,
}: {
  count: number;
  order: Ordering;
  onOrder: (order: Ordering) => void;
}): ReactNode {
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
      <h2 className="tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
        {count} {count === 1 ? "session" : "sessions"}
      </h2>
      {/* **NOT a `<label>` wrapping both**, which is what this was for about an
          hour. A `<button>` is a labelable element, so an `Explain` trigger
          placed inside a label before the select becomes the control that label
          names — and the select silently loses its accessible name. An
          accessibility regression introduced by an accessibility improvement;
          GPT Sol found it. The word keeps its card, the select names itself. */}
      <div className="tw:ml-auto tw:flex tw:items-center tw:gap-1.5 tw:text-[12px] tw:text-ink-faint">
        <Explain tip={ORDER_TIP} placement="bottom">
          Order
        </Explain>
        <select
          aria-label="Order the session list"
          value={order}
          onChange={(e) => onOrder(e.target.value as Ordering)}
          /* `h-7` and `rounded-md`, the one height and the one radius this page
             uses for anything sitting in a row beside other controls —
             docs/project/controls.md. */
          className="tw:h-7 tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:px-1.5 tw:text-[12px] tw:text-ink"
        >
          {ORDERINGS.map((value) => (
            <option key={value} value={value}>
              {ORDERING_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SessionsPanel({
  rows,
  now,
  collected,
  unreadableRows,
  answeringEnabled,
  answeringRefusal,
  onAnsweringRefused,
  tmuxServerPid,
  order,
  onOrder,
  selectedId,
  selectedPid,
  onSelect,
  steer,
  rename,
  actions,
  messages,
  newSession,
  onRefresh,
}: {
  rows: readonly FleetRow[];
  now: number;
  /**
   * **Whether a collection has ever finished.** An empty `rows` is only a claim
   * about the box when this is true — see the empty states below, which is the
   * whole reason the flag exists rather than being inferred here.
   */
  collected: boolean;
  /**
   * How many rows in the last payload could not be read at all.
   *
   * Drawn rather than swallowed: a dropped row shortens authoritative state,
   * and the row most likely to be malformed is a blocked one carrying a
   * question scraped off a terminal — which is the row this page is opened to
   * see. types.ts § `unreadableRows`.
   */
  unreadableRows: number;
  /**
   * Whether the server says answering a dialog will do anything — the four-arm
   * reading, since silence is not a yes. **Passed straight through to the detail
   * pane**; the list cards have no answer buttons, so nothing here reads it.
   * types.ts § `AnsweringReading`.
   */
  answeringEnabled: AnsweringReading;
  /**
   * A `answering-disabled` refusal the server has already made, latched by
   * `App` — and the way to tell it about a new one. **Passed straight through**
   * for the same reason as the flag above: the list cards have no answer
   * buttons, so nothing here reads either. SessionDetail.tsx § `answeringRefusal`
   * says why the owner has to be `App` and not this panel.
   */
  answeringRefusal: string | null;
  onAnsweringRefused: (why: string) => void;
  /**
   * Which tmux server every `$…` and `%…` below belongs to. Passed through for
   * the same reason: it is drawn beside the handles in the detail pane, which
   * is the only place the handles themselves are written out.
   */
  tmuxServerPid: number | null;
  order: Ordering;
  onOrder: (order: Ordering) => void;
  /** The session the URL names, whether or not the box still lists it. */
  selectedId: string | null;
  /**
   * Which tmux server the selected handle came from, when whoever wrote the URL
   * said. `null` means nobody said, which resolves exactly as it always did —
   * only a pid that is PRESENT and disagrees refuses. See `wrongWorld`.
   */
  selectedPid: number | null;
  onSelect: (id: string | null) => void;
  steer: SteerApi;
  rename: RenameApi;
  /** The action vocabulary and the queues. Only the detail pane uses them. */
  actions: ActionsUi;
  /**
   * The transcript reader. **Only the detail pane uses it, and only for the one
   * open row** — reading a transcript costs disk, and the list must never do it
   * forty times. SessionDetail's `messages` prop says the rest.
   */
  messages: MessagesApi;
  newSession: NewSessionApi;
  onRefresh: () => void;
}): ReactNode {
  const { ref, width } = useContainerWidth();

  /**
   * **Sessions the payload had and this page could not read.**
   *
   * Above everything, in the alarm colour, because the alternative is a list
   * that is quietly short — and a page whose whole job is to say when it cannot
   * see the fleet must not lose three rows in silence. GPT Sol's F15,
   * 2026-09-08.
   */
  const unreadable =
    unreadableRows > 0 ? (
      <Card className="tw:mb-3 tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
        <p className="tw:text-[13px] tw:font-medium tw:text-alarm-ink">
          {unreadableRows} of {rows.length + unreadableRows} sessions could not be read.
        </p>
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-soft">
          The box listed them and this page could not make sense of them, so they are missing from
          everything below. The list is short by that many — it is not a shorter fleet.
        </p>
      </Card>
    ) : null;
  const panes = choosePanes(width);
  const columns = chooseColumns(width);

  const sorted = sortRows(rows, order);
  /**
   * **A HANDLE FROM ANOTHER TMUX SERVER IS NOT THIS SESSION**, however exactly
   * it matches.
   *
   * `sel` is a tmux session handle and `$1643` is only meaningful inside one
   * tmux server, so a selection that arrived from somewhere carrying a `selpid`
   * is checked against the one this snapshot came from before it is resolved.
   * Without this, the Recent messages tab's own check was cosmetic: it proved
   * the join safe on the row and then handed over a bare handle, which this
   * matched against whatever world it was looking at by the time it rendered —
   * and the pane it opened would print a handle that agreed. GPT Sol's P0.
   *
   * **A MISSING `selectedPid` RESOLVES EXACTLY AS BEFORE.** Not knowing is not
   * evidence: a tap on the list, a hand-typed URL, a link written before this
   * existed and every bookmark anyone already has arrive without one, and a
   * check that refused them would break the feature it is guarding.
   */
  const wrongWorld =
    selectedPid !== null && tmuxServerPid !== null && selectedPid !== tmuxServerPid;
  const selected =
    selectedId === null || wrongWorld ? null : (sorted.find((r) => r.id === selectedId) ?? null);

  /**
   * **WHAT THE DETAIL PANE IS MOUNTED UNDER.** See the `key` below, and
   * continuity.ts for the whole argument. Called unconditionally, `null`
   * included, because it is a hook.
   */
  const executionKey = useExecutionEpoch(selected);
  /**
   * The execution epoch is necessary but not sufficient to name the target the
   * detail pane is drawing. A handle lives inside one tmux server, and every
   * transcript and write request is resolved against the row's claimed Claude
   * conversation. Either can change while execution is unverifiable, when the
   * epoch deliberately holds. Keeping them in the mount key prevents state
   * created against one resolvable target from riding into another.
   */
  const detailKey = JSON.stringify([tmuxServerPid, selected?.claudeSessionId ?? null, executionKey]);

  /**
   * **BRING THE DETAIL ONTO THE SCREEN WHEN A SELECTION ARRIVES.**
   *
   * A selection can now come from somewhere the reader cannot see: the Recent
   * messages tab writes `sel` into the hash and switches mode, and the page
   * keeps whatever scroll offset the feed had — a thousand pixels down a list
   * of other people's messages. Without this the click appears to do nothing.
   *
   * **The DETAIL rather than the selected card**, one rule at both widths. At
   * 390 there is one pane and the detail has replaced the list, so this is "go
   * to the top of the thing I just opened". At 1280 the detail is the right-hand
   * column and is what the click was *for*; the card keeps its `selected`
   * highlight so it is still findable in the list. Scrolling to the CARD is the
   * other candidate and it is worse in both directions: `block: "nearest"` on an
   * element taller than the viewport aligns its bottom edge, and `block: "start"`
   * on a card halfway down the column pushes the detail's top off screen.
   *
   * It fires for a selection made in the list too, which is right — you tapped a
   * row to read it — and costs nothing when the detail is already at the top.
   *
   * **FOCUS MOVES TOO, and scrolling alone would not be enough.** The control
   * that was activated is on the Recent messages tab, which at 390 has just been
   * unmounted and at 1280 can be several screens away — so a keyboard or
   * screen-reader user is left with focus nowhere useful while the page silently
   * scrolls somewhere else. `focus({ preventScroll: true })` first, then the
   * scroll: focusing scrolls by default, and letting it would fight the line
   * below over which of them decides where the page ends up. GPT Sol's P1.
   *
   * **NOT `behavior: "smooth"`, and a browser check is why.** The first version
   * animated, and from a feed scrolled to the bottom of a 1280×600 window the
   * page moved 25px of the ~90 it owed and stopped: the detail's own status
   * badge finished 68px above the top of the viewport, so the reader landed in
   * the middle of the card with nothing on screen saying which session they were
   * looking at. A smooth scroll is an animation, and an animation that overlaps
   * a mode switch, a container measurement and a re-render is one that can be
   * cut short — silently, and looking exactly like a scroll that never fired.
   * This is a navigation, so it is instant.
   *
   * **A CALLBACK REF RATHER THAN AN EFFECT, because the node this wants is not
   * reliably there when an effect on `selectedId` runs.** The detail is rendered
   * into one of two mutually exclusive branches depending on a MEASURED width
   * (fit.ts), and it is not rendered at all until there are rows to list — so
   * the element can attach one or two renders after the selection changed, with
   * `selectedId` unmoved and an effect keyed to it already spent. This fires
   * when the node for a new selection actually attaches, whenever that is;
   * `scrolledFor` keeps it to once per selection, so a later re-attach (a window
   * resize crossing the two-pane threshold) does not yank a reader who has since
   * scrolled somewhere of their own accord.
   *
   * **The optional calls are not defensiveness about browsers.** jsdom does not
   * implement `scrollIntoView` at all, so an unguarded call would turn every
   * existing test that selects a session red for a reason that has nothing to do
   * with what it is testing.
   */
  const scrolledFor = useRef<string | null>(null);
  if (selectedId === null) scrolledFor.current = null;
  const detailRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null || selectedId === null || scrolledFor.current === selectedId) return;
      scrolledFor.current = selectedId;
      node.focus?.({ preventScroll: true });
      /* **THE MASTHEAD IS STICKY, SO THE TOP OF THE VIEWPORT IS NOT THE TOP OF
         THE PAGE** — tailwind.css § `.masthead`, and the rule stated beside it:
         *every piece of fixed or sticky chrome adds the edge it faces*. Without
         this, `block: "start"` aligns the detail to the scroll box and the
         masthead then paints over the top of it: measured at 27.92px under a
         116.92px header at 1280, and 107px under a 255px one at 390, where the
         reader landed below the session's own name and status with nothing
         saying whose pane they were looking at. Two browser passes to find,
         because it only misses by the height of a bar that is not there in
         jsdom.

         **Measured rather than a constant**, because the masthead wraps: it is
         116.92px at 1280 and 255.375px at 390, and a fixed number would be
         wrong at one of them by more than a header. There is no `--masthead-h`
         to read the way there is a `--dock-space` for the bar at the bottom;
         publishing one means a `ResizeObserver` in `Header.tsx`, which is not
         this branch's file. **The fallback is zero**, which is exactly the
         behaviour before this line — so a masthead that is renamed or absent
         degrades to the old miss rather than to a broken scroll. */
      const masthead = document.querySelector(".masthead");
      const chrome = masthead === null ? 0 : Math.ceil(masthead.getBoundingClientRect().height);
      node.style.scrollMarginTop = `${chrome}px`;
      node.scrollIntoView?.({ block: "start" });
    },
    [selectedId],
  );

  const detail =
    selectedId === null ? null : wrongWorld ? (
      /* **NOT "we could not find it" — "we will not look".** `MissingSession`
         says the box did not list it, which would be a false statement about
         this session: it is a true statement about a handle belonging to a tmux
         server that no longer exists. */
      <Card className="tw:border-l-4 tw:border-l-unknown tw:p-4">
        <p className="tw:font-medium tw:text-ink">That link is for a different tmux server.</p>
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-soft">
          It selects <span className="tw:font-mono">{selectedId}</span> on tmux server{" "}
          {selectedPid ?? "—"}, and this page is looking at {tmuxServerPid ?? "—"}. A handle like that
          only means something inside one tmux server, so the row it would open here is somebody
          else's session rather than the one the link was made for.
        </p>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="tw:mt-2 tw:text-[13px] tw:text-work-ink tw:underline"
        >
          Show every session
        </button>
      </Card>
    ) : selected === null ? (
      <MissingSession id={selectedId} onBack={() => onSelect(null)} />
    ) : (
      <SessionDetail
        /* **KEYED BY THE TMUX WORLD, SESSION, CONVERSATION CLAIM AND WHICH RUN
           IS IN ITS PANE**, so that
           everything this component holds — the message box, the two outcome
           cards, the dialog refusal — is thrown away when it stops being about
           the agent it was created against.

           Four changes reset it and they are all changes of resolvable target:
           a different tmux server, a different row, a different conversation
           claim, and a **verifiably replaced process** under this one.
           A pane outlives the `claude` inside it, and across that replacement
           the handle, the pane pid and `CLAUDE_SESSION_ID` are all unchanged —
           so `key={selected.id}` went on carrying one agent's half-typed
           message onto the terminal of the one that replaced it.

           **WHAT DOES NOT RESET IT, and this is the half worth stating:** an
           execution reading that goes unverifiable and comes back. On a loaded
           box that is the normal weather rather than an event — the probe's own
           tolerance was widened to 15 s in September for exactly this — and a
           key built from the token itself would read `T → "" → T`, remount
           twice, and eat whatever was being typed. continuity.ts holds the last
           token that was VERIFIED and advances only on `continuityOf` saying
           `replaced`. */
        key={detailKey}
        row={selected}
        now={now}
        answeringEnabled={answeringEnabled}
        answeringRefusal={answeringRefusal}
        onAnsweringRefused={onAnsweringRefused}
        tmuxServerPid={tmuxServerPid}
        steer={steer}
        rename={rename}
        actions={actions}
        messages={messages}
        onRefresh={onRefresh}
        onBack={panes === 1 ? () => onSelect(null) : null}
      />
    );

  /**
   * The bands, and whether they are being used.
   *
   * Only the default order gets headings — see the header. In the other four
   * the list is flat, and it is ONE column however wide the window: dealing
   * cards into columns is column-major reading, which is fine for three bands
   * whose order does not matter and wrong for a list whose order is the thing
   * the reader just asked for.
   */
  const banded = order === "status";
  const bands = [
    { title: "Needs you", rows: sorted.filter((r) => triageBand(r.status) === 0) },
    { title: "Working", rows: sorted.filter((r) => triageBand(r.status) === 1) },
    { title: "Everything else", rows: sorted.filter((r) => triageBand(r.status) === 2) },
  ].filter((band) => band.rows.length > 0);

  /* The list is the narrow left-hand column exactly when a detail is open
     beside it, and that is when its cards go compact — the dialog is already
     drawn at full size two inches to the right. */
  const compact = selectedId !== null;

  const card = (row: FleetRow): ReactNode => (
    <SessionCard
      key={row.id}
      row={row}
      now={now}
      selected={row.id === selectedId}
      onSelect={onSelect}
      compact={compact}
    />
  );

  const band = (one: { title: string; rows: FleetRow[] }): ReactNode => (
    <Band
      key={one.title}
      title={one.title}
      rows={one.rows}
      now={now}
      selectedId={selectedId}
      onSelect={onSelect}
      compact={compact}
    />
  );

  /** The whole list in one column — what the left pane and a phone both get. */
  const oneColumnList: ReactNode = banded ? (
    <>{bands.map(band)}</>
  ) : (
    <div className="tw:pt-2">{sorted.map(card)}</div>
  );

  /**
   * **Three empty pages, not one**, and telling them apart is the single most
   * load-bearing thing on this panel.
   *
   * The server answers `rows: []` with `collectedAt: null` for the ten seconds
   * after a restart, while a collection runs. Drawing "No sessions." over that
   * says *the box is idle* — on a phone, with nothing to suggest otherwise —
   * at a moment when three dozen agents may be running on it. It is the same
   * shape of lie as an `unknown` status rendered as `idle`, and it is the one
   * this whole tool is built to refuse.
   *
   * So: nothing collected yet is its own page; a collection that found nothing
   * is a different one; and a failure is neither, because the masthead's banner
   * owns that and the last good rows stay on screen underneath it.
   *
   * The New session panel is drawn above all three, because "there is nothing
   * running" is exactly when somebody wants to start something — and it is
   * OUTSIDE the measured container on purpose, so that the container still
   * appears only when there is a list to measure. That is what the callback-ref
   * regression in fit.ts is guarded by.
   */
  const empty =
    sorted.length === 0 ? (
      collected ? (
        <Card className="tw:p-6 tw:text-center tw:text-ink-soft">
          <p className="tw:font-medium tw:text-ink">No sessions.</p>
          <p className="tw:mt-1 tw:text-[13px]">
            Either the box really is idle, or the collector could not read tmux — the age and any error above say
            which.
          </p>
        </Card>
      ) : (
        <Card className="tw:border-l-4 tw:border-l-unknown tw:p-6 tw:text-center tw:text-ink-soft">
          <p className="tw:font-medium tw:text-ink">Collecting…</p>
          <p className="tw:mt-1 tw:text-[13px]">
            Nothing has been read off the box yet — the first collection takes about ten seconds. This is not an
            empty fleet; it is a fleet nobody has looked at.
          </p>
        </Card>
      )
    ) : null;

  if (empty !== null) {
    return (
      <div className="tw:mx-auto tw:max-w-3xl">
        {unreadable}
        <NewSessionPanel api={newSession} />
        {/* **A SELECTION SURVIVES AN EMPTY LIST, and it did not until now.**
            This arm returned before `detail` was rendered, so a `sel` naming
            the only session on the box — or naming anything at all in a
            snapshot every row of which was dropped — showed "No sessions." or
            "Collecting…" and swallowed the selection whole. Nothing was wrong
            on screen, it was simply an answer to a question nobody asked.

            The Recent messages tab is what made that reachable: it hands out
            links to sessions the reader has not looked at, so the destination
            has to say something about the one they asked for. `MissingSession`
            already exists for exactly this and was merely unreachable here.
            GPT Sol's P0 on the code review, over my "this branch does not own
            it" — the branch that adds the path owns where it leads. */}
        {detail}
        {empty}
      </div>
    );
  }

  /* Never more columns than there are bands to put in them: an empty first
     column beside two full ones reads as a rendering fault, not as good news. */
  const groups = banded ? spreadIntoColumns(bands, Math.min(columns, bands.length)) : [];
  const spread = detail === null && groups.length > 1;
  /* The header spans whatever the body spans. Centring it over a full-width
     two-pane grid puts the ordering control in the middle of nothing. */
  const wideHeader = spread || (detail !== null && panes === 2);

  return (
    /* The measured element is this one, and it is always full width — the
       narrowing happens INSIDE it. Capping the measured box at `max-w-3xl`
       would make the answer to "how much room is there?" depend on the answer,
       which is how a layout ends up oscillating between two states. */
    <div ref={ref}>
      <div className={cx("tw:mb-1", wideHeader ? null : "tw:mx-auto tw:max-w-3xl")}>
        {unreadable}
        <NewSessionPanel api={newSession} />
        <ListControls count={sorted.length} order={order} onOrder={onOrder} />
      </div>

      {detail !== null && panes === 1 ? (
        /* ONE PANE, SOMETHING SELECTED: the detail is a push. The list is not
           on screen at all, and the detail carries the button back to it. */
        <div ref={detailRef} tabIndex={-1} aria-label="The selected session" className="tw:mx-auto tw:max-w-3xl tw:pt-2 tw:outline-none">
          {detail}
        </div>
      ) : detail !== null ? (
        /* TWO PANES. The list column is exactly `COLUMN_MIN_PX` wide, which is
           the same number `chooseColumns` gives a column up at — one constant,
           read twice, rather than a second one written down here. */
        <div
          className="tw:grid tw:items-start tw:gap-x-5 tw:pt-2"
          style={{ gridTemplateColumns: `minmax(0, ${COLUMN_MIN_PX}px) minmax(0, 1fr)` }}
        >
          <div>{oneColumnList}</div>
          <div ref={detailRef} tabIndex={-1} aria-label="The selected session" className="tw:max-w-3xl tw:outline-none">
            {detail}
          </div>
        </div>
      ) : spread ? (
        <div
          className="tw:grid tw:items-start tw:gap-x-5"
          style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
        >
          {groups.map((group, index) => (
            <div key={group[0]?.title ?? index}>{group.map(band)}</div>
          ))}
        </div>
      ) : (
        <div className="tw:mx-auto tw:max-w-3xl">{oneColumnList}</div>
      )}
    </div>
  );
}
