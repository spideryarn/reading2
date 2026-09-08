/**
 * The list — what is running on the box, worst first.
 *
 * ## The one thing this screen is for
 *
 * A `needs-you` row, especially one carrying a question, is what Greg opens
 * this on a phone to see. So it is sorted first, drawn in its own band under
 * its own heading, given the loud edge, and its question is rendered in full
 * rather than summarised. Everything else on this page is arrangement; that is
 * the feature.
 *
 * ## Three bands, not seven ranks
 *
 * `triageSort` in view.ts puts them in order and `triageBand` says which band a
 * row is in; this file only groups what it is handed. The bands are Greg's, out
 * of docs/project/orchestrator-direction.md, and the reasoning for the two
 * surprising memberships — a busy shell is not promoted, and `unknown` is not
 * promoted either — is in tools/fleet/status.ts, which is where it belongs.
 *
 * An `unknown` row therefore sits in the quiet band while carrying a reason
 * that may be the most interesting thing on the page. That is why the reason is
 * always drawn, in the violet the whole tool reserves for it: the ORDER cannot
 * make it visible, so the COLOUR has to.
 *
 * ## And why the bands go side by side on a desk
 *
 * The page is phone-first and stays so: at 390px this is one column and nothing
 * about it has changed. What is new is that at 1280px it no longer draws a
 * 740px column with half the window empty beside it — the three bands take the
 * room, which is the arrangement the bands were already asking for.
 *
 * **The count is measured, never a breakpoint** (fit.ts, and
 * docs/project/narrow-windows.md § the reading view's narrow window, where the
 * same decision is made in JavaScript for the same reason). A column is given
 * up whole rather than squeezed: a card narrower than `COLUMN_MIN_PX` wraps its
 * row of tmux handles onto three lines, which is worse than not having the
 * column.
 */
import type { ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import { spreadIntoColumns, useColumns } from "./fit";
import { Card, Mono, Pill, SectionHeading, cx, toneClasses } from "./ui";
import type { FleetOption, FleetQuestion, FleetRow, FleetStatus } from "./types";
import { formatDuration, optionHint, statusLabel, triageBand, triageSort, uptime, whereLine } from "./view";

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
    how: "Read off the pane's own text, so it is a good guess rather than a fact — and this page cannot answer for you. Whatever it shows, the keystroke has to be typed at the terminal.",
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
    how: "The countdown is what the pane says is left. Nothing is expected of you, which is why it sits in the quiet band rather than beside the blocked ones.",
  },
  "no-claude": {
    head: "No agent",
    what: "A tmux session with no Claude running in it.",
    how: "Usually a shell somebody left open. It is listed because an unlisted session is one you forget is holding memory on a box that runs out of it.",
  },
  shell: {
    head: "Shell",
    what: "A plain shell rather than an agent — busy if something is running in it.",
    how: "A busy shell stays in the quiet band deliberately (tools/fleet/status.ts): it is running, but nothing is waiting on you, and promoting it would push a blocked agent down the page.",
  },
  unknown: {
    head: "Unknown",
    what: "Nobody could say what this session is doing, and the reason is printed beneath.",
    how: "It is NOT the same as idle, which is why it has its own colour: one failed call turns every row unknown at once, and a page that rounded that to 'quiet' would be calm about a fleet it cannot see.",
  },
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
function StatusPill({ status }: { status: FleetStatus }): ReactNode {
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
 * One option of a dialog the session is parked on.
 *
 * The keystroke is shown as a hint rather than as a button. **This page sends
 * nothing** — read-only until a channel is proven is the standing principle in
 * orchestrator-direction.md, and the channel that is proven (`tmux send-keys`)
 * belongs to tools/fleet/steer.ts, not here. A button that looked like it would
 * answer and did not would be the exact failure that document was written
 * after.
 */
function Option({ option, index }: { option: FleetOption; index: number }): ReactNode {
  const selected = option.key.via === "selected";
  return (
    <li className={cx("tw:flex tw:items-start tw:gap-2 tw:py-1", selected && "tw:font-semibold tw:text-ink")}>
      <span
        aria-hidden="true"
        className="tw:mt-0.5 tw:w-4 tw:shrink-0 tw:text-right tw:font-mono tw:text-[12px] tw:text-ink-faint"
      >
        {option.key.via === "digit" ? option.key.digit : selected ? "❯" : String(index + 1)}
      </span>
      <span className="tw:min-w-0 tw:flex-1 tw:break-words">{option.label}</span>
      <span className="tw:shrink-0 tw:font-mono tw:text-[11px] tw:text-ink-faint">{optionHint(option.key)}</span>
    </li>
  );
}

/**
 * The dialog itself.
 *
 * The footnote about the option list is not padding. `options` is what was on
 * the SCREEN, and a long menu scrolls — the model selector shows four rows and
 * a `… +1 model` line, and a pane capture cannot see the fifth. So this reads
 * "what the pane is showing" rather than counting, per the argument in
 * tools/fleet/pane.ts.
 */
function QuestionCard({ question }: { question: FleetQuestion }): ReactNode {
  return (
    <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-needs/40 tw:bg-needs-wash tw:p-3">
      <p className="tw:text-[13px] tw:font-semibold tw:tracking-wide tw:text-needs-ink tw:uppercase">Asking</p>
      <p className="tw:mt-1 tw:font-medium tw:break-words tw:whitespace-pre-wrap">{question.prompt}</p>
      {question.options.length > 0 ? (
        <>
          <ul className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
            {question.options.map((option, index) => (
              <Option key={`${index}-${option.label}`} option={option} index={index} />
            ))}
          </ul>
          <p className="tw:mt-2 tw:text-[11px] tw:text-ink-faint">
            What the pane is showing. A long menu scrolls, so there may be more below.
          </p>
        </>
      ) : (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
          No options could be read off the pane — only the prompt.
        </p>
      )}
    </div>
  );
}

/**
 * The card an uptime carries.
 *
 * Not a `Tip` per row, because the sentence is the same on every row and only
 * the number differs — building three hundred of these would be three hundred
 * copies of one explanation.
 */
const UPTIME_TIP: Tip = {
  head: "Up",
  what: "How long this tmux session has existed, from the time tmux itself recorded when it was created.",
  how: "It is the SESSION's age, not the agent's: a long-running window that has been handed a new job reads as old, and a session started an hour ago that has done nothing reads the same as one that has been working throughout.",
};

/**
 * One session.
 *
 * The title is the heading because it is what identifies a session to a person;
 * the tmux handle is beneath it in mono because it is what identifies it to a
 * program. `no title yet` is a real state — Claude has not named the
 * conversation — and says so rather than falling back to the session name,
 * which would make an unnamed session look named.
 */
function SessionCard({ row, now }: { row: FleetRow; now: number }): ReactNode {
  const label = statusLabel(row.status);
  const tone = toneClasses(label.tone);
  const where = whereLine(row);
  const age = uptime(row, now);
  /* Only a version-1 meta has a directory; a `legacy` session recorded none,
     and there is nothing to show rather than something to apologise for. */
  const dir = row.meta.version === 1 ? row.meta.dir : null;
  return (
    <Card className={cx("tw:mb-2 tw:border-l-4 tw:p-3", tone.edge, label.tone === "needs" && "tw:bg-needs-wash")}>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
        <StatusPill status={row.status} />
        <Explain tip={UPTIME_TIP} placement="bottom" className="tw:ml-auto tw:text-[12px] tw:text-ink-faint">
          {age === null ? "start time unknown" : `up ${formatDuration(age)}`}
        </Explain>
      </div>

      <h3 className={cx("tw:mt-1.5 tw:leading-snug tw:font-medium tw:break-words", row.title === null && "tw:text-ink-faint tw:italic")}>
        {row.title ?? "no title yet"}
      </h3>

      {label.detail !== null ? (
        <p className={cx("tw:mt-1 tw:text-[13px] tw:break-words", tone.ink)}>{label.detail}</p>
      ) : null}

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

      <p className="tw:mt-1">
        <Mono>{row.name}</Mono>
        <span className="tw:px-1 tw:text-ink-faint">·</span>
        <Mono>{row.id}</Mono>
        {row.paneId !== null ? (
          <>
            <span className="tw:px-1 tw:text-ink-faint">·</span>
            <Mono>{row.paneId}</Mono>
          </>
        ) : null}
      </p>

      {row.question !== null ? <QuestionCard question={row.question} /> : null}
    </Card>
  );
}

/** A band of rows under its own heading. Only ever built for a non-empty one. */
function Band({ title, rows, now }: { title: string; rows: FleetRow[]; now: number }): ReactNode {
  return (
    <section>
      <SectionHeading>
        {title} · {rows.length}
      </SectionHeading>
      {rows.map((row) => (
        <SessionCard key={row.id} row={row} now={now} />
      ))}
    </section>
  );
}

export function SessionsPanel({
  rows,
  now,
  collected,
}: {
  rows: readonly FleetRow[];
  now: number;
  /**
   * **Whether a collection has ever finished.** An empty `rows` is only a claim
   * about the box when this is true — see the empty states below, which is the
   * whole reason the flag exists rather than being inferred here.
   */
  collected: boolean;
}): ReactNode {
  const { ref, columns } = useColumns();

  const sorted = triageSort(rows);
  const bands = [
    { title: "Needs you", rows: sorted.filter((r) => triageBand(r.status) === 0) },
    { title: "Working", rows: sorted.filter((r) => triageBand(r.status) === 1) },
    { title: "Everything else", rows: sorted.filter((r) => triageBand(r.status) === 2) },
  ].filter((band) => band.rows.length > 0);

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
   */
  if (sorted.length === 0) {
    return collected ? (
      <Card className="tw:mx-auto tw:max-w-3xl tw:p-6 tw:text-center tw:text-ink-soft">
        <p className="tw:font-medium tw:text-ink">No sessions.</p>
        <p className="tw:mt-1 tw:text-[13px]">
          Either the box really is idle, or the collector could not read tmux — the age and any error above say
          which.
        </p>
      </Card>
    ) : (
      <Card className="tw:mx-auto tw:max-w-3xl tw:border-l-4 tw:border-l-unknown tw:p-6 tw:text-center tw:text-ink-soft">
        <p className="tw:font-medium tw:text-ink">Collecting…</p>
        <p className="tw:mt-1 tw:text-[13px]">
          Nothing has been read off the box yet — the first collection takes about ten seconds. This is not an
          empty fleet; it is a fleet nobody has looked at.
        </p>
      </Card>
    );
  }

  /* Never more columns than there are bands to put in them: an empty first
     column beside two full ones reads as a rendering fault, not as good news. */
  const groups = spreadIntoColumns(bands, Math.min(columns, bands.length));

  return (
    /* The measured element is this one, and it is always full width — the
       narrowing happens INSIDE it. Capping the measured box at `max-w-3xl`
       would make the answer to "how much room is there?" depend on the answer,
       which is how a layout ends up oscillating between two states. */
    <div ref={ref}>
      {groups.length === 1 ? (
        <div className="tw:mx-auto tw:max-w-3xl">
          {groups[0]?.map((band) => (
            <Band key={band.title} title={band.title} rows={band.rows} now={now} />
          ))}
        </div>
      ) : (
        <div
          className="tw:grid tw:items-start tw:gap-x-5"
          style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
        >
          {groups.map((group, index) => (
            <div key={group[0]?.title ?? index}>
              {group.map((band) => (
                <Band key={band.title} title={band.title} rows={band.rows} now={now} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
