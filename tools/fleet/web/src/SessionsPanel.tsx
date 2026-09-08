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
 */
import type { ReactNode } from "react";

import { Card, Mono, Pill, SectionHeading, cx, toneClasses } from "./ui";
import type { FleetOption, FleetQuestion, FleetRow } from "./types";
import { formatDuration, optionHint, statusLabel, triageBand, triageSort, uptime, whereLine } from "./view";

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
    <li
      className={cx(
        "tw:flex tw:items-start tw:gap-2 tw:py-1",
        selected && "tw:font-semibold tw:text-ink",
      )}
    >
      <span
        aria-hidden="true"
        className="tw:mt-0.5 tw:w-4 tw:shrink-0 tw:text-right tw:font-mono tw:text-[12px] tw:text-ink-faint"
      >
        {option.key.via === "digit" ? option.key.digit : selected ? "❯" : String(index + 1)}
      </span>
      <span className="tw:min-w-0 tw:flex-1 tw:break-words">{option.label}</span>
      <span className="tw:shrink-0 tw:font-mono tw:text-[11px] tw:text-ink-faint">
        {optionHint(option.key)}
      </span>
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
      <p className="tw:text-[13px] tw:font-semibold tw:tracking-wide tw:text-needs-ink tw:uppercase">
        Asking
      </p>
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
  return (
    <Card
      className={cx(
        "tw:mb-2 tw:border-l-4 tw:p-3",
        tone.edge,
        label.tone === "needs" && "tw:bg-needs-wash",
      )}
    >
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
        <Pill tone={label.tone}>{label.text}</Pill>
        <span className="tw:ml-auto tw:text-[12px] tw:text-ink-faint">
          {age === null ? "start time unknown" : `up ${formatDuration(age)}`}
        </span>
      </div>

      <h3
        className={cx(
          "tw:mt-1.5 tw:leading-snug tw:font-medium tw:break-words",
          row.title === null && "tw:text-ink-faint tw:italic",
        )}
      >
        {row.title ?? "no title yet"}
      </h3>

      {label.detail !== null ? (
        <p className={cx("tw:mt-1 tw:text-[13px] tw:break-words", tone.ink)}>{label.detail}</p>
      ) : null}

      <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-ink-soft">
        {where ?? <span className="tw:text-ink-faint">no repo recorded</span>}
      </p>

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

/** A band of rows under its own heading, or nothing at all when it is empty. */
function Band({ title, rows, now }: { title: string; rows: FleetRow[]; now: number }): ReactNode {
  if (rows.length === 0) return null;
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

export function SessionsPanel({ rows, now }: { rows: readonly FleetRow[]; now: number }): ReactNode {
  const sorted = triageSort(rows);
  const needsYou = sorted.filter((r) => triageBand(r.status) === 0);
  const working = sorted.filter((r) => triageBand(r.status) === 1);
  const quiet = sorted.filter((r) => triageBand(r.status) === 2);

  if (sorted.length === 0) {
    return (
      <Card className="tw:p-6 tw:text-center tw:text-ink-soft">
        <p className="tw:font-medium tw:text-ink">No sessions.</p>
        <p className="tw:mt-1 tw:text-[13px]">
          Either the box really is idle, or the collector could not read tmux — the age and any
          error above say which.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <Band title="Needs you" rows={needsYou} now={now} />
      <Band title="Working" rows={working} now={now} />
      <Band title="Everything else" rows={quiet} now={now} />
    </div>
  );
}
