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
  FleetQuestion,
  FleetRow,
  FleetStatus,
} from "./types";
import {
  CONSEQUENCE_LABEL,
  CONSEQUENCE_TONE,
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

/** `up 3h 20m`, or the honest absence of it, with the card that says what it counts. */
export function Uptime({ row, now, className }: { row: FleetRow; now: number; className?: string }): ReactNode {
  const age = uptime(row, now);
  return (
    <Explain tip={UPTIME_TIP} placement="bottom" className={cx("tw:text-[12px] tw:text-ink-faint", className)}>
      {age === null ? "start time unknown" : `up ${formatDuration(age)}`}
    </Explain>
  );
}

/** The tmux and Claude handles, as one wrapping line. Addresses, not names. */
export function Handles({ row, full }: { row: FleetRow; full?: boolean }): ReactNode {
  const dot = <span className="tw:px-1 tw:text-ink-faint">·</span>;
  return (
    <p className="tw:mt-1">
      <Mono>{row.name}</Mono>
      {dot}
      <Mono>{row.id}</Mono>
      {row.paneId !== null ? (
        <>
          {dot}
          <Mono>{row.paneId}</Mono>
        </>
      ) : null}
      {full === true && row.panePid !== null ? (
        <>
          {dot}
          <Mono>pid {row.panePid}</Mono>
        </>
      ) : null}
      {full === true && row.claudeSessionId !== null ? (
        <>
          {dot}
          <Mono>{row.claudeSessionId}</Mono>
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
        how: "Worked out from the wording of the label, which is all the terminal gives us. It is written to be wrong in one direction only, so anything it cannot classify is drawn as loudly as a permanent choice.",
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
function Material({ material, compact }: { material: FleetMaterial; compact: boolean }): ReactNode {
  if (material.kind === "unreadable") {
    return (
      <div className="tw:mt-2 tw:rounded-md tw:border tw:border-alarm/50 tw:bg-alarm-wash tw:p-2 tw:text-[13px]">
        <p className="tw:font-medium tw:text-alarm-ink">What this would approve could not be read.</p>
        <p className="tw:mt-1 tw:break-words tw:text-ink">{material.why}</p>
        {compact ? null : (
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
            So there is nothing to answer with here — an empty box in this place would look like a
            dialog that proposes nothing, and those are opposite claims. Answer it in the terminal.
          </p>
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
  onAnswer,
  busy = false,
  compact = false,
}: {
  question: FleetQuestion;
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

      {compact ? null : <Material material={question.material} compact={asked === null} />}

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
