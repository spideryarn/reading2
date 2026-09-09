/**
 * The Queued ideas tab: what Greg has asked for and has not got yet.
 *
 * Greg, 2026-09-08: *"add a mode for 'Queued ideas' that shows a list of ideas
 * that will each get turned into a prompt for their own new-claude agent"*.
 *
 * ## The badge is the point of this tab, not the list
 *
 * A list of queued work is easy and not very useful. What Greg cannot see
 * anywhere else is **why each item is not moving**, and there are four different
 * answers, which the badge keeps apart:
 *
 *  - **needs you** — waiting on an answer from him. The only pile he can shift.
 *  - **proposal** — the Overseer noticed it and nobody has authorised it.
 *  - **approval lapsed** — he approved it, and it has been edited since, so the
 *    approval no longer names what the item says.
 *  - **ready** — authorised, unblocked, waiting for a slot.
 *
 * Flattening those into "blocked" would delete the tab's whole value. The
 * reasoning behind them is in
 * [`idea-queue.ts`](../../../overseer/idea-queue.ts) § three axes.
 *
 * ## The verdict is the server's, always
 *
 * `ready` and `why` arrive computed. They are `isDispatchable`, which is gate
 * 3's own test, and a second implementation of it here would be a second answer
 * to *"may this go out?"*. **Nothing in this file decides whether an item may be
 * dispatched** — it renders the sentence it is given.
 *
 * ## No forecast, and the tab says so out loud
 *
 * Greg asked for an estimate of the wait. There isn't one, deliberately, and the
 * panel prints the reason rather than leaving a gap where a number should be —
 * [`idea-queue-wait.ts`](../../../overseer/idea-queue-wait.ts) has the argument,
 * and *"a wide range does not repair a wrong estimator"* is the sentence.
 *
 * ## Read-only, and that is stated on the page
 *
 * Not because writes are unbuilt, but because the queue is an authorisation
 * record served by a process with no authentication. The footer says where to
 * write instead, so a reader who wants to reorder something is not left tapping
 * a row that does nothing.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import {
  badgeFor,
  depthClauses,
  httpQueueApi,
  shortId,
  type Badge,
  type QueueApi,
  type QueueView,
} from "./queue-client";
import { Card, Mono, Pill, SectionHeading, cx, toneClasses } from "./ui";
import type { Tone } from "./view";
import type { QueueRow } from "../../wire";

/** The badge's tone in the page's own colour language. A `Record`, so a fifth badge is a type error. */
const BADGE_TONE: Record<Badge["tone"], Tone> = {
  ready: "work",
  you: "needs",
  unapproved: "unknown",
  running: "work",
  settled: "idle",
  broken: "alarm",
};

const WAIT_TIP: Tip = {
  head: "Why there is no ETA",
  what: "How many items are ahead, and how many have actually gone out in the last 7 and 30 days.",
  how: "Measured on this queue's own events. A duration would need position × how long an item takes, and 'how long an item takes' is not a number this fleet has — sessions run from ten minutes to six hours, and most sessions were never queue items at all.",
};

const APPROVAL_TIP: Tip = {
  head: "Approval names a revision",
  what: "An item approved and then edited shows as lapsed rather than staying approved.",
  how: "Your own edits re-approve as you make them; an agent's do not, so nothing can be approved small and then quietly enlarged.",
};

function Row({ row, queueHasProblems }: { row: QueueRow; queueHasProblems: boolean }): ReactNode {
  const badge = badgeFor(row, queueHasProblems);
  const tone = BADGE_TONE[badge.tone];
  const [open, setOpen] = useState(false);
  const facts: [string, string | null][] = [
    ["waiting on", row.waitingOn],
    ["size", row.size],
    ["plan", row.source],
    ["runs", row.runs],
    ["areas", row.areas.length === 0 ? null : row.areas.join(", ")],
    ["session", row.dispatchedTo],
  ];

  return (
    <Card className={cx("tw:mb-2 tw:border-l-4", toneClasses(tone).edge)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="tw:flex tw:w-full tw:flex-wrap tw:items-start tw:gap-2 tw:p-3 tw:text-left"
      >
        <Pill tone={tone}>{badge.label}</Pill>
        <span className="tw:min-w-0 tw:flex-1 tw:text-[13px] tw:text-ink">
          {row.title ?? row.text}
          {/* **The server's sentence, verbatim.** This is the only place the
              page explains a verdict, and it is not paraphrased — a shortened
              version would be a second claim about the same thing. */}
          {row.why === null ? null : (
            <span className="tw:mt-0.5 tw:block tw:text-[12px] tw:text-ink-soft">{row.why}</span>
          )}
          {row.wait.kind === "ahead" ? (
            <span className="tw:mt-0.5 tw:block tw:text-[12px] tw:text-ink-faint">{row.wait.why}</span>
          ) : null}
        </span>
        <Mono>{shortId(row.id)}</Mono>
      </button>

      {open ? (
        <div className="tw:border-t tw:border-rule tw:px-3 tw:pt-2 tw:pb-3">
          {/* The full text, when the row was showing only a title. */}
          {row.title === null ? null : (
            <p className="tw:mb-2 tw:text-[12px] tw:whitespace-pre-wrap tw:text-ink-soft">{row.text}</p>
          )}
          <dl className="tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1 tw:text-[12px]">
            {facts.map(([label, value]) =>
              value === null ? null : (
                <div key={label} className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
                  <dt className="tw:text-ink-faint">{label}</dt>
                  <dd className="tw:min-w-0 tw:break-words tw:text-ink-soft">{value}</dd>
                </div>
              ),
            )}
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">approval</dt>
              <dd className="tw:text-ink-soft">
                {row.authority === "proposed"
                  ? "none — a proposal"
                  : row.authorizedRevision === row.revision
                    ? `granted for revision ${row.revision}`
                    : `granted for revision ${row.authorizedRevision}, now at ${row.revision}`}
              </dd>
            </div>
          </dl>

          {/* **The history, because provenance is why this is an event log.**
              Who did what, in order — the question a Markdown table could not
              answer and the reason the file is shaped the way it is. */}
          <SectionHeading>History</SectionHeading>
          <ol className="tw:space-y-0.5 tw:text-[12px]">
            {/* **Keyed on content, not on position.** A touch carries no id,
                and two of them can share a timestamp — a batch appended in one
                write does — so neither field alone is unique; all three
                together are, and unlike an array index they survive a list
                that ever gains an entry at the front. */}
            {row.history.map((touch) => (
              <li key={`${touch.at}-${touch.kind}-${touch.what}`} className="tw:flex tw:gap-2">
                <span className="tw:shrink-0 tw:text-ink-faint">{touch.by}</span>
                <span className="tw:min-w-0 tw:text-ink-soft">{touch.what}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Every kind of nothing, kept apart — the page's standing rule
 * ([fleet-dashboard-modes.md](../../../../docs/project/fleet-dashboard-modes.md)
 * § Absence is stated, never drawn).
 *
 * Five arms and each draws differently, because an empty list would read as
 * *nothing is queued* — a confident, false sentence about the record of what
 * Greg has asked for.
 */
export function QueuePanel({
  api = httpQueueApi,
  refreshNonce = 0,
}: {
  api?: QueueApi;
  /** Bumped by the dock's Refresh. The panel has its own route, so it must be told. */
  refreshNonce?: number;
}): ReactNode {
  const [view, setView] = useState<QueueView>({ kind: "loading" });

  /* `refreshNonce` is not read in the body — pressing the dock's Refresh
     changes it, which re-runs the effect, which re-reads the queue. Biome sees
     an unnecessary dependency, which is exactly what it is and exactly what is
     wanted; `DeploysPanel` says the same thing over the same line. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal — re-running when it changes is the point.
  useEffect(() => {
    let live = true;
    void api.fetch().then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [api, refreshNonce]);

  if (view.kind === "loading") {
    return <p className="tw:p-3 tw:text-[13px] tw:text-ink-faint">Reading the queue…</p>;
  }
  if (view.kind === "no-answer") {
    /* OUR voice, not the server's — the phone's network trouble must not appear
       on screen as a claim about the queue. */
    return (
      <Card className="tw:border-l-4 tw:border-l-unknown tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">This tab could not read the queue.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
      </Card>
    );
  }
  if (view.kind === "never-written") {
    return (
      <Card className="tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">Nothing has been queued here yet.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
      </Card>
    );
  }
  if (view.kind === "unreadable") {
    /* **THE LOUD ONE.** The Overseer's store may cold-start because losing it
       costs only history; this file is original human input and is not
       disposable, so it must never be drawn as a healthy empty queue. */
    return (
      <Card className="tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
        <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">The queue file could not be read.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">{view.why}</p>
        <p className="tw:mt-2 tw:text-[12px] tw:text-alarm-ink">
          This is not an empty queue — it is a queue nobody can currently read, so nothing in it should be
          dispatched until it is fixed.
        </p>
      </Card>
    );
  }

  const clauses = depthClauses(view.depth);
  const hasProblems = view.problems.length > 0;

  return (
    <div>
      {/* **PROBLEMS FIRST, ABOVE EVERYTHING.** A queue with a hole in it
          authorises nothing at all, and that outranks any individual row. */}
      {hasProblems ? (
        <Card className="tw:mb-3 tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
          <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
            {view.problems.length === 1 ? "One problem" : `${view.problems.length} problems`} in the queue file —
            nothing here is dispatchable until they are resolved.
          </p>
          <ul className="tw:mt-1 tw:space-y-0.5 tw:text-[12px] tw:text-alarm-ink">
            {/* Keyed on content, like the history: two problems of one kind
                differ only in their `why`, so the pair is what identifies one. */}
            {view.problems.map((problem) => (
              <li key={`${problem.kind}-${problem.why}`}>
                <span className="tw:font-semibold">{problem.kind}</span> — {problem.why}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="tw:mb-3 tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">
          {clauses.length === 0 ? "The queue is empty." : clauses.join(" · ")}
        </p>
        <Explain tip={WAIT_TIP} className="tw:mt-1 tw:block">
          <p className="tw:text-[12px] tw:text-ink-soft">
            {view.throughput.windows.map((w) => `${w.dispatched} dispatched in ${w.days}d`).join(" · ")}
          </p>
        </Explain>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">{view.throughput.duration.why}</p>
      </Card>

      {view.rows.length === 0 ? (
        <Card className="tw:p-3">
          <p className="tw:text-[13px] tw:text-ink">Nothing is waiting.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
            The queue file has been read and everything in it has been dispatched or dropped — which is not the
            same as nothing ever having been queued.
          </p>
        </Card>
      ) : (
        view.rows.map((row) => <Row key={row.id} row={row} queueHasProblems={hasProblems} />)
      )}

      {view.settled.length > 0 ? (
        <>
          <SectionHeading>
            Recently settled{view.settledWithheld > 0 ? ` (${view.settledWithheld} older not shown)` : ""}
          </SectionHeading>
          {view.settled.map((row) => (
            <Row key={row.id} row={row} queueHasProblems={hasProblems} />
          ))}
        </>
      ) : null}

      {/* **Says where to write, so a reader who taps a row and gets nothing is
          not left guessing.** The reason it is read-only is a security one and
          it is not hidden behind a tooltip. */}
      <Explain tip={APPROVAL_TIP} className="tw:mt-4 tw:block">
        <p className="tw:px-1 tw:text-[12px] tw:text-ink-faint">
          Read-only here: the queue is what authorises work, and this dashboard has no login. Add, approve or
          reorder with <Mono>npx tsx scripts/overseer-queue.ts</Mono> — the file is <Mono>{view.path}</Mono>,
          at version <Mono>{view.version}</Mono>.
        </p>
      </Explain>
    </div>
  );
}
