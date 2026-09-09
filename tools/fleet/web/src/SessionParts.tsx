/**
 * The pieces a session is drawn out of, shared by the list and the detail.
 *
 * **One spelling of each, because there are now two places a session appears.**
 * The list card and the detail pane both show a status, an uptime and the
 * dialog a blocked session is parked on; two copies of the question renderer
 * would be two things to keep in step, and the one that goes stale is always
 * the one nobody looks at.
 *
 * The difference between the two places is a PROP, not a component:
 * `QuestionCard` draws hints when it is handed no `onAnswer` and buttons when
 * it is. The list is read-only because a card there is a summary you tap to
 * open; the detail is where a person acts.
 *
 * This module exists rather than the detail importing from the panel because
 * the panel imports the detail, and a cycle between two component files is the
 * kind of thing that works until a bundler changes its mind about evaluation
 * order.
 */
import type { ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import { Mono, Pill, cx } from "./ui";
import type {
  FleetConsequence,
  FleetMaterial,
  FleetOption,
  FleetPermissionMode,
  FleetQuestion,
  FleetRow,
  FleetStatus,
} from "./types";
import {
  CONSEQUENCE_LABEL,
  CONSEQUENCE_TONE,
  CONSEQUENCE_HOW,
  CONSEQUENCE_WHAT,
  formatDuration,
  optionHint,
  statusLabel,
  uptime,
} from "./view";

/**
 * What each status actually means, as a card the pill carries.
 *
 * **These are the words the page is judged on.** "needs you" is the whole
 * product and it is still a guess made by grepping a terminal — the second
 * paragraph of each card is where that is admitted, per
 * docs/project/tooltips.md: *the first sentence is what a reader could have
 * guessed by pressing the control; the second is what they could not.*
 *
 * Keyed by `FleetStatus["kind"]` so an eighth arm is a type error here rather
 * than a pill that silently explains nothing.
 */
export const STATUS_TIPS: Record<FleetStatus["kind"], Tip> = {
  "needs-you": {
    head: "Needs you",
    what: "The session has stopped and is waiting for a person: a permission prompt, a choice of options, or a question in the chat.",
    how: "Read off the pane's own text, so it is a good guess rather than a fact. Open the session to answer it — the dashboard types the keystroke at the terminal, after checking that the pane is still asking what you were shown.",
  },
  working: {
    head: "Working",
    what: "The agent is mid-turn: thinking, running a tool, or writing.",
    how: "It means the pane changed recently, not that progress is being made. A session stuck in a loop looks exactly like one doing good work.",
  },
  idle: {
    head: "Idle",
    what: "The agent has finished and nothing is waiting on you.",
    how: "This is the state a completed job leaves behind, so a long-idle session is usually one whose work is done and whose tab nobody has closed.",
  },
  waiting: {
    head: "Waiting",
    what: "The session is in a timed wait of its own — a sleep, a poll, a scheduled retry — and will carry on by itself.",
    how: "The countdown is what the pane says is left. Nothing is expected of you, and a message sent now would go to the job script's shell rather than to Claude, so the server refuses one.",
  },
  "no-claude": {
    head: "No agent",
    what: "A tmux session with no Claude running in it.",
    how: "Usually a shell somebody left open. It is listed because an unlisted session is one you forget is holding memory on a box that runs out of it.",
  },
  shell: {
    head: "Shell",
    what: "A plain shell rather than an agent — busy if something is running in it.",
    how: "A busy shell stays in the quiet band deliberately (tools/fleet/status.ts): it is running, but nothing is waiting on you. Nothing can be typed at one either, because a shell would EXECUTE the message rather than read it.",
  },
  unknown: {
    head: "Unknown",
    what: "Nobody could say what this session is doing, and the reason is printed beneath.",
    how: "It is NOT the same as idle, which is why it has its own colour: one failed call turns every row unknown at once, and a page that rounded that to 'quiet' would be calm about a fleet it cannot see.",
  },
};

/**
 * The card an uptime carries.
 *
 * Not a `Tip` per row, because the sentence is the same on every row and only
 * the number differs — building three hundred of these would be three hundred
 * copies of one explanation.
 */
export const UPTIME_TIP: Tip = {
  head: "Up",
  what: "How long this tmux session has existed, from the time tmux itself recorded when it was created.",
  how: "It is the SESSION's age, not the agent's: a long-running window that has been handed a new job reads as old, and a session started an hour ago that has done nothing reads the same as one that has been working throughout.",
};

/**
 * A status chip that can explain itself.
 *
 * The visible word is the status; the card is what it means. `Explain` puts the
 * same sentence in the button's accessible name, so on a phone — where there is
 * no hover at all — the words are still there for a screen reader, and a tap
 * opens the card. **Nothing on this page is hover-only**, which is the rule
 * docs/project/touch.md exists to enforce.
 */
export function StatusPill({ status }: { status: FleetStatus }): ReactNode {
  const label = statusLabel(status);
  /* `Pill` rather than the chip's classes written out again here: the same chip
     is drawn on Box health's verdict, and two spellings of one component is one
     to change and one to forget. */
  return (
    <Explain tip={STATUS_TIPS[status.kind]} placement="bottom">
      <Pill tone={label.tone}>{label.text}</Pill>
    </Explain>
  );
}

/**
 * The card the launch-mode warning carries. One object, not one per row: the
 * sentences are the same on every row and only the mode's name differs.
 *
 * **The recovery is checked, not assumed.** "Yes, and switch to auto mode" is
 * option 3 on a Bash-command permission dialog in three real captures
 * (`dialog-bash-permission.txt`, `-ansi`, `-git-log`); a file-write dialog
 * offers "switch to accept edits" instead, which is a different and weaker
 * thing. So this says *the next time it asks to run a command*, because that is
 * the dialog the option is actually on.
 */
const NOT_AUTO_TIP: Tip = {
  head: "Not in auto mode",
  what: "This session will stop at the first command its settings cannot approve — a git fetch, an MCP read, a setup script — and wait for a person. Nothing else on the box notices: gjd-remote log lists it as running, exactly like a healthy one.",
  how: "To fix it for good, answer its next request to run a command with 'Yes, and switch to auto mode' — that unblocks it and converts the session permanently. Measured cost of not doing so: 34.9 agent-hours since 2026-09-06, across 20% of launches, the longest single stall 7.38 hours.",
};

/** And the card for the arm that is a shrug, so the shrug is at least explained. */
const MODE_UNKNOWN_TIP: Tip = {
  head: "Which mode it is in",
  what: "Read off the two lines of status bar at the foot of the pane, and those are not on this screenful.",
  how: "Usually because a dialog is up — Claude Code's modal covers the status bar, so a blocked session is the one whose mode cannot be read. This is neither good news nor bad; it is the absence of news.",
};

/**
 * **A SESSION THAT DID NOT LAUNCH IN AUTO MODE**, which is not an error so much
 * as a session that will stall the moment it does anything.
 *
 * ## Where this is drawn, and why not somewhere louder
 *
 * Under the status row, on the list card and on the detail — beside the other
 * per-session facts, not as a fourth band across the page. A band would put it
 * above sessions that are actually blocked right now, and this is a session
 * that is *fine until it isn't*: important, and not more important than
 * somebody actually waiting.
 *
 * ## The four arms draw three different amounts of nothing
 *
 *  - **`auto` DRAWS NOTHING AT ALL.** It is the norm — 14 of the 14 live panes
 *    whose status bar was readable on 2026-09-08 — and a green tick on every
 *    row is a tick nobody reads, which would make the one row without it harder
 *    to spot rather than easier. Silence is the signal.
 *  - **`not-applicable` draws nothing either.** A shell has no permission mode;
 *    a badge on one would be a false alarm about a session working perfectly.
 *  - **`cannot-tell` draws a quiet line, and only on the detail.** It must not
 *    read as "fine", and it must not read as "broken" — a grey line on the one
 *    screen you opened deliberately is the shape that is neither. It is kept
 *    off the list cards because a blocked session's mode is *always* unreadable
 *    (the modal covers the status bar), so on the list it would be a shrug
 *    printed next to every row that most needs the space.
 *  - **`not-auto` draws the strip below**, in both places, because it is the
 *    whole reason the check exists.
 */
export function LaunchMode({ mode, detail }: { mode: FleetPermissionMode; detail: boolean }): ReactNode {
  if (mode.kind === "auto" || mode.kind === "not-applicable") return null;
  if (mode.kind === "cannot-tell") {
    return !detail ? null : (
      <Explain tip={MODE_UNKNOWN_TIP} placement="bottom" className="tw:mt-1 tw:block tw:text-[12px] tw:text-ink-faint">
        permission mode unread
      </Explain>
    );
  }
  return (
    <div className="launch-mode tw:mt-2 tw:rounded-md tw:border tw:border-alarm/50 tw:bg-alarm-wash tw:p-2">
      <Explain tip={NOT_AUTO_TIP} placement="bottom" className="tw:block">
        <span className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
          {mode.mode} — not auto
        </span>
      </Explain>
      <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-ink">
        It will stop at the first command it cannot approve and wait for a person, and nothing else on
        the box will say so.
      </p>
      {detail ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
          Next time it asks to run a command, choose <em>Yes, and switch to auto mode</em> — that both
          unblocks it and converts it for the rest of the session. Sessions launched like this have cost
          34.9 agent-hours since 2026-09-06.
        </p>
      ) : null}
    </div>
  );
}

/** `up 3h 20m`, or the honest absence of it, with the card that says what it counts. */
export function Uptime({ row, now, className }: { row: FleetRow; now: number; className?: string }): ReactNode {
  const age = uptime(row, now);
  return (
    <Explain tip={UPTIME_TIP} placement="bottom" className={cx("tw:text-[12px] tw:text-ink-faint", className)}>
      {age === null ? "start time unknown" : `up ${formatDuration(age)}`}
    </Explain>
  );
}

/**
 * **What each of the handles is, and why there are up to five of them.**
 *
 * This line is `bwj-quotes · $2705 · %2708` on every card on the page, and
 * nothing anywhere said what a `$` or a `%` was. They are not interchangeable
 * and the differences are load-bearing: `steer.ts` checks one of them before
 * typing at a pane, and only one of the five survives an agent exiting and
 * another starting in the same window. Every sentence below is quoted down from
 * `types.ts` § `FleetRow`.
 */
export const HANDLE_TIPS = {
  name: {
    head: "The session's name",
    what: "The word the session was launched under, and how a person refers to it — including when messaging it from another session.",
    how: "Renameable and reusable, so it identifies a launch rather than a conversation: a name freed by a session that died can be worn by a different one an hour later.",
  },
  id: {
    head: "tmux session handle",
    what: "tmux's own address for the session — the `$` one. This is what the dashboard uses to ask about it or type at it.",
    how: "Stable across renames, unlike the name beside it, which is why it and not the name is what a request carries. Meaningless without the tmux server it belongs to, so it is not a join key across boxes.",
  },
  pane: {
    head: "tmux pane handle",
    what: "The `%` one: the pane inside the session, which is the thing keystrokes are actually delivered to.",
    how: "A different thing from the `$` beside it, and it can go missing — a row with no pane handle is one nothing can be typed at. It survives the pane being respawned, which is why it alone is not enough to prove what is in there now.",
  },
  pid: {
    head: "The pane's process id",
    what: "The pid of the shell in the pane, as tmux reported it.",
    how: "Not an address — it is precisely the thing that changes when a pane is respawned under the same handle, which is the one way a pane's contents change identity without its `%` changing. It is compared before anything is typed; absent, that check is skipped rather than the row becoming unsteerable.",
  },
  conversation: {
    head: "The conversation's id",
    what: "Claude's own session uuid — the identifier of the conversation, not of anything tmux owns.",
    how: "The only one of these that survives a resume, so it is what distinguishes this agent from one that replaced it in the same pane. A shell has none, and where it is missing the dashboard refuses to steer rather than guessing.",
  },
} satisfies Record<string, Tip>;

/** The tmux and Claude handles, as one wrapping line. Addresses, not names. */
export function Handles({ row, full }: { row: FleetRow; full?: boolean }): ReactNode {
  const dot = <span className="tw:px-1 tw:text-ink-faint">·</span>;
  return (
    <p className="tw:mt-1">
      {/* Each handle its own trigger rather than one card over the line: the
          reader's question is about the `%` specifically, and a single card
          would have to describe five things to answer one. */}
      <Explain tip={HANDLE_TIPS.name} placement="bottom">
        <Mono>{row.name}</Mono>
      </Explain>
      {dot}
      <Explain tip={HANDLE_TIPS.id} placement="bottom">
        <Mono>{row.id}</Mono>
      </Explain>
      {row.paneId !== null ? (
        <>
          {dot}
          <Explain tip={HANDLE_TIPS.pane} placement="bottom">
            <Mono>{row.paneId}</Mono>
          </Explain>
        </>
      ) : null}
      {full === true && row.panePid !== null ? (
        <>
          {dot}
          <Explain tip={HANDLE_TIPS.pid} placement="bottom">
            <Mono>pid {row.panePid}</Mono>
          </Explain>
        </>
      ) : null}
      {full === true && row.claudeSessionId !== null ? (
        <>
          {dot}
          <Explain tip={HANDLE_TIPS.conversation} placement="bottom">
            <Mono>{row.claudeSessionId}</Mono>
          </Explain>
        </>
      ) : null}
    </p>
  );
}

/**
 * How far one option reaches, as a badge that can explain itself.
 *
 * **Drawn beside the option's button rather than inside it**, because `Explain`
 * is itself a `<button>` and a button inside a button is invalid and reads as
 * one control to a screen reader. On a narrow window it wraps onto its own
 * line, which is the rule for a row of things whose widths you do not control
 * (docs/project/narrow-windows.md).
 *
 * **`unknown` is drawn as loudly as `persistent`, and that is a guarantee
 * rather than a taste.** See `CONSEQUENCE_TONE` in view.ts; the inequality is
 * held by a test, because the failure — the conservative default becoming the
 * mildest badge on screen — is invisible in a screenshot.
 */
function Consequence({ consequence }: { consequence: FleetConsequence }): ReactNode {
  return (
    <Explain
      tip={{
        head: "How far this goes",
        what: CONSEQUENCE_WHAT[consequence],
        how: CONSEQUENCE_HOW[consequence],
      }}
      placement="left"
      className="tw:shrink-0"
    >
      <Pill tone={CONSEQUENCE_TONE[consequence]}>{CONSEQUENCE_LABEL[consequence]}</Pill>
    </Explain>
  );
}

/**
 * One option of a dialog the session is parked on.
 *
 * The keystroke is shown beside the label whether or not the option can be
 * pressed here, because it is the thing a reader cannot see and the one fact
 * that makes an answer checkable afterwards: *what did you actually press* is
 * the first question anybody asks about a session that then did something
 * surprising.
 *
 * **`unrecognised` does not disable the button.** It means this build has no
 * words for the keystroke, not that the option cannot be chosen — what goes
 * back to the server is the server's own object, so a newer server may know
 * exactly what to press (types.ts § `rawQuestion`).
 */
function Option({
  option,
  index,
  onAnswer,
  busy,
}: {
  option: FleetOption;
  index: number;
  onAnswer: ((index: number) => void) | null;
  busy: boolean;
}): ReactNode {
  const selected = option.key.via === "selected";
  const marker = option.key.via === "digit" ? option.key.digit : selected ? "❯" : String(index + 1);
  const hint = optionHint(option.key);
  const body = (
    <>
      <span aria-hidden="true" className="tw:mt-0.5 tw:w-4 tw:shrink-0 tw:text-right tw:font-mono tw:text-[12px] tw:text-ink-faint">
        {marker}
      </span>
      <span className="tw:min-w-0 tw:flex-1 tw:break-words">{option.label}</span>
      <span className="tw:shrink-0 tw:font-mono tw:text-[11px] tw:text-ink-faint">{hint}</span>
    </>
  );
  return (
    <li className="tw:flex tw:flex-wrap tw:items-start tw:gap-x-2 tw:gap-y-1 tw:py-1">
      {onAnswer === null ? (
        <span className={cx("tw:flex tw:min-w-[12rem] tw:flex-1 tw:items-start tw:gap-2", selected && "tw:font-semibold tw:text-ink")}>
          {body}
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(index)}
          /* Not `Button`: that one is a chip, `h-7` and `whitespace-nowrap`, and
             an option label is a sentence off somebody's terminal. Same radius,
             same border, same hover — a row that may wrap to three lines. */
          className={cx(
            "answer tw:flex tw:min-w-[12rem] tw:flex-1 tw:items-start tw:gap-2 tw:rounded-md tw:border tw:border-rule tw:px-2 tw:py-1.5 tw:text-left",
            "tw:transition-colors tw:hover:border-rule-strong tw:hover:bg-panel-raised tw:disabled:opacity-50",
            selected && "tw:font-semibold",
          )}
        >
          {body}
        </button>
      )}
      <Consequence consequence={option.consequence} />
    </li>
  );
}

/**
 * The way out, when the page has decided it cannot honestly offer a button.
 *
 * **A REFUSAL THAT DOES NOT NAME THE NEXT MOVE IS A REFUSAL A PERSON CANNOT
 * ACT ON.** Astra's recommendation for the incomplete-capture case was a
 * handoff rather than a button — "a button that cannot be honest should not
 * exist" — and taking the button away was only the first half of that. The card
 * said "Answer it in the terminal" to somebody holding a phone in another room,
 * with no way to get to a terminal from there.
 *
 * **SELECTABLE, NOT MERELY LEGIBLE.** `select-all` makes one tap take the whole
 * command, because the reader is on a phone and is about to paste this into an
 * ssh session on some other device. A command they have to retype from a
 * screenshot is barely better than no command.
 *
 * **THE SESSION'S NAME, NEVER ITS ID.** `gjd-remote resume` takes the name —
 * `fleet-approval-binding`, not `$1996` — and a command that looks right and
 * cannot run is worse than none, because it is tried first.
 *
 * **AND THE NAME IS NOT NECESSARILY A SHELL WORD**, which is GPT Sol's finding
 * on the first version of this. `FleetRow.name` is typed `string` and comes off
 * tmux, so it is whatever somebody called a session. The fleet's own create and
 * rename routes enforce a slug, but `tmux new-session -s 'two words'` at a
 * terminal does not, and this component's promise — *here is a command you can
 * paste* — was wider than its type. A name that is not a bare word is quoted;
 * one that could not survive quoting is not offered at all, because a command
 * that runs and resumes the WRONG session is the one outcome worse than no
 * command.
 */
/**
 * A code-point loop, NOT a character class, and the reason is a byte that was
 * in this file for about ten minutes.
 *
 * `steer.ts`'s `checkText` already says it: *"a control character in a SOURCE
 * file is a byte grep cannot see and a reviewer cannot read, and this repo has
 * been bitten by writing one."* Writing `/[\x00-\x1f]/` here put a literal NUL
 * into this file, which made `grep` treat the whole thing as binary and return
 * nothing for every pattern — including `Handoff`, which is how it was found:
 * the component appeared to have vanished. The escape was correct in intent and
 * arrived as data.
 *
 * So the rule is the one that file already reached, for the same reason, and it
 * is worth stating twice rather than being rediscovered a third time.
 */
function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function shellWord(name: string): string | null {
  if (name === "") return null;
  // A bare slug needs nothing, and it is every name the fleet's own create and
  // rename routes will mint. Left unquoted so the command a person meets almost
  // every time reads as something they would have typed.
  if (/^[A-Za-z0-9._-]+$/.test(name)) return name;
  // Everything else goes inside single quotes, which neutralise every
  // metacharacter POSIX sh has — spaces, `$`, backticks, `;`, `&&` — with two
  // exceptions that are refused rather than escaped. A single quote cannot be
  // escaped INSIDE single quotes (the `'\''` dance works and produces a string
  // nobody can check at a glance, on a phone, before pasting it into a shell on
  // another machine); and a control character, a newline above all, would paste
  // as a finished command line plus whatever came after it.
  if (name.includes("'") || hasControlChar(name)) return null;
  return `'${name}'`;
}

export function Handoff({ sessionName }: { sessionName: string }): ReactNode {
  const word = shellWord(sessionName);
  if (word === null) {
    return (
      <p className="tw:mt-1.5 tw:text-[12px] tw:text-ink-soft">
        Open it in the terminal — this session's name cannot be written as a shell argument, so
        there is no command here that would be safe to paste.
      </p>
    );
  }
  return (
    <p className="tw:mt-1.5">
      <code className="tw:select-all tw:rounded tw:border tw:border-rule tw:bg-panel tw:px-1.5 tw:py-1 tw:font-mono tw:text-[12px] tw:break-all tw:text-ink">
        gjd-remote resume {word}
      </code>
    </p>
  );
}

/**
 * **WHAT IS ACTUALLY BEING APPROVED.**
 *
 * The prompt is the headline and this is the evidence, and the distinction is
 * the whole of why this exists: two cross-family reviews found that an approval
 * bound only to the question sentence could be accepted for different material
 * than was displayed. A page that offers a way to say yes without showing this
 * is asking somebody to approve something they cannot see.
 *
 * **The three arms are three different pages, and collapsing any two of them is
 * the bug.** `no-material` is a positive claim that this dialog proposes
 * nothing — a `/loop` menu, where the options are the whole question — and is
 * safe to draw with no body. `unreadable` is *there is a dialog here and we
 * could not see what it is about*, and it makes this card refuse rather than
 * draw a confident empty box.
 *
 * `text` is agent-authored and comes off a terminal: React escapes it, the box
 * scrolls in its own right rather than pushing the page sideways
 * (docs/project/narrow-windows.md, § content that cannot reflow), and it is
 * never trusted for anything but display.
 */
function Material({
  material,
  sessionName,
  compact,
}: {
  material: FleetMaterial;
  sessionName: string;
  compact: boolean;
}): ReactNode {
  if (material.kind === "unreadable") {
    return (
      <div className="tw:mt-2 tw:rounded-md tw:border tw:border-alarm/50 tw:bg-alarm-wash tw:p-2 tw:text-[13px]">
        <p className="tw:font-medium tw:text-alarm-ink">What this would approve could not be read.</p>
        <p className="tw:mt-1 tw:break-words tw:text-ink">{material.why}</p>
        {compact ? null : (
          <>
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
              So there is nothing to answer with here — an empty box in this place would look like a
              dialog that proposes nothing, and those are opposite claims. Answer it in the terminal:
            </p>
            <Handoff sessionName={sessionName} />
          </>
        )}
      </div>
    );
  }
  if (material.kind === "no-material") {
    return compact ? null : (
      <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
        This dialog proposes nothing beyond the options — the menu is the whole question.
      </p>
    );
  }
  if (compact) {
    return (
      <p className="tw:mt-2 tw:text-[12px] tw:text-ink-soft">
        It carries {material.text.split("\n").length} line
        {material.text.split("\n").length === 1 ? "" : "s"} of what would be approved. Open the session
        to read it.
      </p>
    );
  }
  return (
    <div className="tw:mt-2">
      <p className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
        What you would be approving
      </p>
      {/* Its own scroll box. A diff has lines that cannot be hyphenated, and a
          card that grows to fit one pushes the whole page sideways on a phone. */}
      <pre className="material tw:mt-1 tw:max-h-72 tw:overflow-auto tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:p-2 tw:font-mono tw:text-[12px] tw:text-ink">
        {material.text}
      </pre>
      <p className="tw:mt-1 tw:text-[11px] tw:text-ink-faint">
        <Mono>{material.fingerprint}</Mono> — the hash the server compares against the pane before it
        types anything, so an answer cannot land on material that has changed underneath it.
      </p>
    </div>
  );
}

/**
 * The dialog itself, as a card — read-only in the list, answerable in the
 * detail.
 *
 * The footnote about the option list is not padding. `options` is what was on
 * the SCREEN, and a long menu scrolls — the model selector shows four rows and
 * a `… +1 model` line, and a pane capture cannot see the fifth. So this reads
 * "what the pane is showing" rather than counting, per the argument in
 * tools/fleet/pane.ts. It matters more now that the options are buttons: the
 * one you want may not be on the page at all.
 *
 * **An unreadable material takes the buttons away**, whatever the caller asked
 * for. That is not the caller's decision to make: an option you can press
 * beside a body nobody could read is the exact thing the material field was
 * added to prevent.
 */
export function QuestionCard({
  question,
  sessionName,
  onAnswer,
  busy = false,
  compact = false,
}: {
  question: FleetQuestion;
  /**
   * For the handoff command when the card cannot offer a button. REQUIRED
   * rather than optional: a call site that could omit it is a call site that
   * renders a dead end, and the compiler is the only thing that will notice.
   */
  sessionName: string;
  /** Null makes this a summary. A function makes every option a button. */
  onAnswer?: ((index: number) => void) | null;
  busy?: boolean;
  /**
   * **The prompt and nothing else.**
   *
   * For the narrow left-hand list beside an open detail, where the same dialog
   * is already drawn at full size two inches to the right: repeating the
   * options in a 340px column makes every blocked card a screenful and the list
   * unscannable. A full-width list is NOT compact, because seeing what a
   * session is asking without tapping anything is why this page is opened on a
   * phone.
   */
  compact?: boolean;
}): ReactNode {
  const asked = onAnswer ?? null;
  const blind = question.material.kind === "unreadable";
  const answer = blind ? null : asked;
  return (
    <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-needs/40 tw:bg-needs-wash tw:p-3">
      <p className="tw:text-[13px] tw:font-semibold tw:tracking-wide tw:text-needs-ink tw:uppercase">Asking</p>
      <p
        className={cx(
          "tw:mt-1 tw:font-medium tw:break-words tw:whitespace-pre-wrap",
          compact && "tw:line-clamp-3",
        )}
      >
        {question.prompt}
      </p>

      {compact ? (
        <p className="tw:mt-2 tw:text-[12px] tw:text-ink-soft">
          {question.options.length === 0
            ? "No options could be read off the pane."
            : `${question.options.length} options — open it to read them.`}
          {question.material.kind === "unreadable" ? " What it would approve could not be read." : ""}
        </p>
      ) : null}

      {/* NEVER compact here, and it used to be `asked === null`, which was a
          bug the moment a dialog could be un-tappable in the detail view. Being
          unable to press a button is exactly when you most need to READ what is
          being asked — you are about to go and answer it in the terminal. The
          collapsed form belongs to the list card, and the list card is the
          `compact` branch above. */}
      {compact ? null : <Material material={question.material} sessionName={sessionName} compact={false} />}

      {!compact && question.options.length > 0 ? (
        <>
          <ul className={cx("tw:mt-2 tw:text-[13px]", answer === null ? "tw:text-ink-soft" : "tw:space-y-1")}>
            {question.options.map((option, index) => (
              <Option key={`${index}-${option.label}`} option={option} index={index} onAnswer={answer} busy={busy} />
            ))}
          </ul>
          <p className="tw:mt-2 tw:text-[11px] tw:text-ink-faint">
            What the pane is showing. A long menu scrolls, so there may be more below.
          </p>
        </>
      ) : compact ? null : (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
          No options could be read off the pane — only the prompt.
        </p>
      )}
    </div>
  );
}
