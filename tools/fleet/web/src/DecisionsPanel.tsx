/**
 * Decisions made in Greg's name, shown for review rather than approval.
 *
 * The headline is the number still unseen. The list keeps the server's order:
 * pending first — ranked by consequence, then reversibility, then newest —
 * and the rest newest first. This component does not sort, because a second
 * ordering rule in the browser would let the CLI and dashboard disagree about
 * which decision matters next. The search box only filters; it never reorders.
 *
 * Each row is a self-contained decision, so it is a card rather than a table.
 * The question, class, choice, who decided and review state stay visible; the
 * alternatives, trade-offs and provenance open on demand. The latter are never
 * omitted — the record exists so Greg can inspect the reasoning after work was
 * unblocked.
 *
 * **Who decided is not who recorded, and neither is a review.** A session's
 * decision reaches this record through the report drain (`by: daemon`); a
 * schema-1 row's author was never recorded and is not called the Overseer's.
 * `gregAsked` is the AUTHOR'S claim about Greg, so it is written as that
 * sentence, in prose, away from the review pill — never styled like review.
 * Evidence links come only from `artefactHref`, over references the client's
 * parser already validated. Plan 260910e.
 */
import { useEffect, useState, type ReactNode } from "react";

import { artefactHref, describeArtefactCheck, spellArtefactRef } from "../../artefact-ref";
import {
  decisionMatchesSearch,
  httpDecisionsApi,
  type DecisionsApi,
  type DecisionsView,
} from "./decisions-client";
import { Card, Mono, Pill, cx, toneClasses } from "./ui";
import { formatDuration, type Tone } from "./view";
import type {
  DecisionRow,
  DecisionWireAdviser,
  DecisionWireClass,
  DecisionWireGregAsked,
  DecisionWireNotRecorded,
  DecisionWireProblem,
  DecisionWireRecord,
  DecisionWireSessionState,
} from "../../wire";

type PanelView = DecisionsView | { kind: "loading" };

const CLASS_TONE: Record<DecisionWireClass, Tone> = {
  assumption: "unknown",
  decision: "work",
  decline: "idle",
};

const ADVISER_LABEL: Record<DecisionWireAdviser, string> = {
  sol: "GPT Sol",
  fable: "Fable",
  nobody: "Nobody",
};

function reviewState(row: DecisionRow): { label: string; tone: Tone } {
  if (row.pendingReview) return { label: "needs review", tone: "needs" };
  if (row.record.reversed) return { label: "reversed", tone: "idle" };
  if (row.record.supersededBy !== null) return { label: "superseded", tone: "idle" };
  return { label: "reviewed", tone: "idle" };
}

function sessionState(state: DecisionWireSessionState): { label: string; detail: ReactNode; tone: Tone } {
  switch (state.kind) {
    // The register retains its last verified execution across observations that
    // cannot verify the current process, so equality proves identity, not liveness.
    case "same-run-as-last-verified":
      return {
        label: "same run (as last verified)",
        detail: (
          <>
            last verified since <time dateTime={state.since}>{state.since}</time>
          </>
        ),
        tone: "work",
      };
    case "ended-or-replaced":
      return {
        label: "ended or replaced",
        detail: "the run recorded with the decision is no longer the verified run",
        tone: "idle",
      };
    case "unavailable":
      return state.why.kind === "checkpoint-unavailable"
        ? {
            label: "state unavailable",
            detail: "the Overseer checkpoint could not be read",
            tone: "unknown",
          }
        : {
            label: "state unavailable",
            detail: state.why.detail,
            tone: "unknown",
          };
    default: {
      const never: never = state;
      return never;
    }
  }
}

function authorLine(record: DecisionWireRecord): string {
  switch (record.author.kind) {
    case "session":
      return `decided by ${record.author.name} (session)`;
    case "overseer":
      return "decided by the Overseer";
    case "greg":
      return "decided by Greg";
    case "legacy-unrecorded":
      return "author not recorded";
    default: {
      const never: never = record.author;
      return never;
    }
  }
}

function recorderLabel(record: DecisionWireRecord): string {
  return record.recordedBy === "daemon" ? "the report drain" : record.recordedBy;
}

function consequenceText(value: DecisionWireRecord["consequence"]): string {
  return value === "not-recorded" ? "consequence not recorded" : `${value} consequence`;
}

function reversibilityText(value: DecisionWireRecord["reversibility"]): string {
  switch (value) {
    case "not-recorded":
      return "reversibility not recorded";
    case "one-way":
      return "one-way";
    case "costly":
      return "costly to reverse";
    case "easy":
      return "easy to reverse";
    default: {
      const never: never = value;
      return never;
    }
  }
}

/** The author's words about Greg, as the author's — never Greg's own review. */
function gregAskedClaim(value: DecisionWireGregAsked | DecisionWireNotRecorded): string {
  switch (value) {
    case "no":
      return "the author says Greg was not asked";
    case "asked-answered":
      return "the author says Greg answered";
    case "asked-awaiting":
      return "the author says Greg has been asked and has not answered";
    case "not-recorded":
      return "whether Greg was asked was not recorded";
    default: {
      const never: never = value;
      return never;
    }
  }
}

function confidenceText(value: DecisionWireRecord["confidence"]): string {
  if (value === "not-recorded") return "confidence not recorded";
  return value === null ? "no confidence given" : `author's confidence: ${value}`;
}

function recommendationText(value: DecisionWireRecord["recommendation"]): string {
  if (value.kind === "not-recorded") return "not recorded";
  return value.value ?? "none given";
}

function Evidence({ record }: { record: DecisionWireRecord }): ReactNode {
  if (record.evidence.kind === "not-recorded") {
    return <p className="tw:mt-1 tw:text-ink-soft">evidence not recorded (this decision predates the field)</p>;
  }
  if (record.evidence.value.length === 0) {
    return <p className="tw:mt-1 tw:text-ink-soft">no evidence given</p>;
  }
  return (
    <ul data-testid="decision-evidence" className="tw:mt-1 tw:space-y-1">
      {record.evidence.value.map((item, index) => {
        // The one place a link is built, from a reference the parser validated.
        const href = artefactHref(item);
        const label = spellArtefactRef(item.ref);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed server list that never reorders, and a reference may repeat.
          <li key={`${label}-${index}`} className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
            {href === null ? (
              <Mono>{label}</Mono>
            ) : (
              <a
                href={href}
                rel="noreferrer"
                target={href.startsWith("https://") ? "_blank" : undefined}
                className="tw:font-mono tw:text-[12px] tw:break-all tw:text-ink tw:underline"
              >
                {label}
              </a>
            )}
            <span className="tw:text-ink-soft">{describeArtefactCheck(item.check)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function DecisionCard({ row, elapsedSinceReadMs }: { row: DecisionRow; elapsedSinceReadMs: number }): ReactNode {
  const [open, setOpen] = useState(false);
  const status = reviewState(row);
  const record = row.record;

  return (
    // The id is what `#decision-<id>` — `artefactHref` for a found decision — lands on.
    <div id={`decision-${record.id}`} className="tw:scroll-mt-4">
    <Card className={cx("tw:mb-2 tw:border-l-4", toneClasses(status.tone).edge)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="tw:block tw:w-full tw:p-3 tw:text-left"
      >
        {/* **THE BADGES GET THEIR OWN ROW, AND THE QUESTION GETS THE WIDTH.**
            These were one flex row with the question as a `flex-1 min-w-0`
            sibling of two pills and the meta. At 390px that is not a wrap — the
            question shrinks to about one word per line and its text overflows
            its own box, so the class pill paints on top of it. Nothing in the
            suite could see it: jsdom has no layout, every assertion passed, and
            it took a screenshot to find. Two rows need no breakpoint and read
            the same at 390 and 1280. */}
        <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Pill tone={status.tone}>{status.label}</Pill>
          <Pill tone={CLASS_TONE[record.class]}>{record.class}</Pill>
          {/* Consequence and reversibility are what the pending order ranks by,
              so they are on the closed card: the order explains itself. */}
          <span className="tw:text-[11px] tw:text-ink-soft">
            {consequenceText(record.consequence)} · {reversibilityText(record.reversibility)}
          </span>
          <span className="tw:text-[11px] tw:text-ink-faint">
            {open ? "hide details" : "show details"} · {formatDuration(row.ageMs + elapsedSinceReadMs)} ago
          </span>
        </span>
        <span className="tw:mt-1.5 tw:block tw:text-[13px] tw:font-semibold tw:break-words tw:text-ink">
          {record.question}
        </span>
        <span className="tw:mt-0.5 tw:block tw:text-[12px] tw:break-words tw:text-ink-soft">
          Chose {record.chose.option}
          {record.chose.note === null ? "" : ` — ${record.chose.note}`}
        </span>
        <span className="tw:mt-0.5 tw:block tw:text-[11px] tw:break-words tw:text-ink-faint">
          {authorLine(record)}
          {record.recordedBy === "daemon" ? " · recorded by the report drain" : ""}
        </span>
      </button>

      {open ? (
        <div className="tw:border-t tw:border-rule tw:px-3 tw:pt-2 tw:pb-3 tw:text-[12px]">
          <h3 className="tw:font-semibold tw:text-ink">Options and trade-offs</h3>
          <ul className="tw:mt-1 tw:space-y-1">
            {record.options.map((option) => (
              <li key={option.name} className="tw:text-ink-soft">
                <span className="tw:font-semibold tw:text-ink">
                  {option.name}
                  {option.name === record.chose.option ? " — chosen" : ""}
                </span>
                {" — "}
                {option.tradeoffs}
              </li>
            ))}
          </ul>
          <p data-testid="decision-confidence" className="tw:mt-1 tw:text-[11px] tw:text-ink-faint">
            {confidenceText(record.confidence)}
          </p>

          <dl className="tw:mt-3 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1">
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">why</dt>
              <dd className="tw:min-w-0 tw:text-ink-soft">{record.why}</dd>
            </div>
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">recommends</dt>
              <dd className="tw:min-w-0 tw:break-words tw:text-ink-soft">{recommendationText(record.recommendation)}</dd>
            </div>
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">domain</dt>
              <dd className="tw:min-w-0 tw:text-ink-soft">
                {record.domain === "not-recorded" ? "not recorded" : record.domain}
              </dd>
            </div>
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">advised by</dt>
              <dd className="tw:min-w-0 tw:text-ink-soft">
                {record.advisers.map((adviser) => ADVISER_LABEL[adviser]).join(", ")}
              </dd>
            </div>
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">decided</dt>
              <dd className="tw:min-w-0 tw:text-ink-soft">
                <time dateTime={record.decidedAt}>{record.decidedAt}</time> · {authorLine(record)} · recorded by{" "}
                {recorderLabel(record)}
              </dd>
            </div>
            {record.bearsOn.plan === null ? null : (
              <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
                <dt className="tw:text-ink-faint">plan</dt>
                <dd className="tw:min-w-0 tw:break-words tw:text-ink-soft">
                  <Mono>{record.bearsOn.plan}</Mono>
                </dd>
              </div>
            )}
            {record.reviewNote === null ? null : (
              <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
                <dt className="tw:text-ink-faint">review note</dt>
                <dd className="tw:min-w-0 tw:text-ink-soft">{record.reviewNote}</dd>
              </div>
            )}
            {record.reversedWhy === null ? null : (
              <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
                <dt className="tw:text-ink-faint">reversed because</dt>
                <dd className="tw:min-w-0 tw:text-ink-soft">{record.reversedWhy}</dd>
              </div>
            )}
          </dl>

          {/* **A CLAIM, IN PROSE, AWAY FROM THE REVIEW STATE.** Only Greg's own
              `reviewed` event reviews; this is what the author SAYS about him,
              so it is never a pill and never beside the review pill. */}
          <p
            data-testid="greg-asked-claim"
            className="tw:mt-3 tw:border-l-2 tw:border-rule tw:pl-2 tw:text-[12px] tw:italic tw:text-ink-soft"
          >
            {gregAskedClaim(record.gregAsked)}
          </p>

          <h3 className="tw:mt-3 tw:font-semibold tw:text-ink">Evidence</h3>
          <Evidence record={record} />

          <h3 className="tw:mt-3 tw:font-semibold tw:text-ink">Sessions</h3>
          {row.sessions.length === 0 ? (
            <p className="tw:mt-1 tw:text-ink-soft">No sessions were recorded against this decision.</p>
          ) : (
            <ul className="tw:mt-1 tw:space-y-1">
              {row.sessions.map((session) => {
                const state = sessionState(session.state);
                return (
                  <li key={session.name} className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
                    <Mono>{session.name}</Mono>
                    <Pill tone={state.tone}>{state.label}</Pill>
                    <span className="tw:text-ink-soft">{state.detail}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
    </div>
  );
}

function ProblemList({ problems }: { problems: readonly DecisionWireProblem[] }): ReactNode {
  if (problems.length === 0) return null;
  return (
    <Card className="tw:mb-3 tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
      <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
        The decision record has {problems.length === 1 ? "a problem" : `${problems.length} problems`}.
      </p>
      <ul className="tw:mt-1 tw:space-y-0.5 tw:text-[12px] tw:text-alarm-ink">
        {problems.map((problem) => (
          <li key={`${problem.kind}-${problem.eventId ?? "none"}-${problem.why}`}>
            <span className="tw:font-semibold">{problem.kind}</span> — {problem.why}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ComposedAt({ instant }: { instant: string }): ReactNode {
  return (
    <p className="tw:mt-2 tw:text-[11px] tw:tabular-nums tw:text-ink-faint">
      Composed at <time dateTime={instant}>{instant}</time>
    </p>
  );
}

/** Every absence has its own sentence; only a measured count is drawn as a number. */
export function DecisionsPanel({
  api = httpDecisionsApi,
  refreshNonce = 0,
  nowMs = Date.now(),
}: {
  api?: DecisionsApi;
  /** Bumped by the dock's Refresh. This is an on-demand route, so it must be told. */
  refreshNonce?: number;
  /** The page's ticking clock; elapsed browser time advances server-computed ages. */
  nowMs?: number;
}): ReactNode {
  const [view, setView] = useState<PanelView>({ kind: "loading" });
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal.
  useEffect(() => {
    const controller = new AbortController();
    setView({ kind: "loading" });
    void api.fetch(controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setReceivedAt(Date.now());
        setView(next);
      }
    });
    return () => controller.abort();
  }, [api, refreshNonce]);

  if (view.kind === "loading") {
    return <p className="tw:p-3 tw:text-[13px] tw:text-ink-faint">Reading the decision record…</p>;
  }
  if (view.kind === "no-answer") {
    return (
      <Card className="tw:border-l-4 tw:border-l-unknown tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">This browser did not get an answer from the decisions API.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
      </Card>
    );
  }
  if (view.kind === "never-written") {
    return (
      <Card className="tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">No decision has been recorded here yet.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
        <ComposedAt instant={view.composedAt} />
      </Card>
    );
  }
  if (view.kind === "unreadable") {
    return (
      <Card className="tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
        <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
          The decision record could not be read.
        </p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">{view.why}</p>
        <p className="tw:mt-2 tw:text-[12px] tw:text-alarm-ink">
          This is not an empty record — a decision Greg has not reviewed could be hidden.
        </p>
        <ComposedAt instant={view.composedAt} />
      </Card>
    );
  }
  if (view.kind === "oversized-unreviewed") {
    return (
      <Card className="tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
        <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
          The decisions that must be shown are too large to send.
        </p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">{view.why}</p>
        <p className="tw:mt-2 tw:text-[12px] tw:text-alarm-ink">
          {/* **NOT "the unreviewed decisions are too large".** A small pending
              successor with a long superseded ancestry trips this same arm, and
              blaming the unreviewed rows would send somebody looking at the
              wrong thing. What did not fit is the unreviewed rows PLUS the
              history they cannot be understood without. GPT Sol's note. */}
          The server refused to truncate {view.unreviewedCount} unreviewed decisions, or the superseded history
          they replace, at its {view.limitBytes}-byte limit.
        </p>
        <ComposedAt instant={view.composedAt} />
      </Card>
    );
  }
  if (view.kind === "oversized-file") {
    return (
      <Card className="tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
        <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
          The decision record is too large to read synchronously.
        </p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">{view.why}</p>
        <p className="tw:mt-2 tw:text-[12px] tw:text-alarm-ink">
          The server refused to read {view.sizeBytes} bytes at its {view.limitBytes}-byte input limit.
        </p>
        <ComposedAt instant={view.composedAt} />
      </Card>
    );
  }

  /* `row.ageMs` and `composedAt` were computed against the server's clock.
     Adding only time elapsed in this browser keeps that clock boundary intact
     while preventing an overnight-open tab from freezing every “ago” label. */
  const elapsedSinceReadMs = receivedAt === null ? 0 : Math.max(0, nowMs - receivedAt);
  // A filter over the server's order, never a sort: the rows keep their places.
  const shown = view.rows.filter((row) => decisionMatchesSearch(row.record, query));

  return (
    <div>
      <ProblemList problems={view.problems} />

      <Card className="tw:mb-3 tw:p-3">
        {view.aggregates.kind === "counts" ? (
          <div data-testid="decisions-headline">
            <p className="tw:text-3xl tw:font-semibold tw:tabular-nums tw:text-ink">
              {view.aggregates.notYetReviewed}
            </p>
            <p className="tw:text-[13px] tw:text-ink-soft">not yet reviewed</p>
          </div>
        ) : (
          <p data-testid="decisions-headline" className="tw:text-[13px] tw:text-unknown-ink">
            The not-yet-reviewed count is unavailable: {view.aggregates.why}.
          </p>
        )}

        {view.aggregates.kind === "counts" ? (
          <p className="tw:mt-2 tw:text-[12px] tw:tabular-nums tw:text-ink-soft">
            Last 7 days: {view.aggregates.trailingSevenDays.decisions} decisions ·{" "}
            {view.aggregates.trailingSevenDays.reviews} reviews · {view.aggregates.trailingSevenDays.reversals}{" "}
            reversals
          </p>
        ) : null}
        <ComposedAt instant={view.composedAt} />
        {view.checkpoint.kind === "unavailable" ? (
          <p className="tw:mt-1 tw:text-[12px] tw:text-unknown-ink">
            Session states are unavailable: {view.checkpoint.why}.
          </p>
        ) : null}
      </Card>

      {view.rows.length > 0 ? (
        <input
          type="search"
          aria-label="Search these decisions"
          placeholder="Search questions, options, reasons, recommendations, sessions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="tw:mb-2 tw:w-full tw:rounded-lg tw:border tw:border-rule tw:bg-panel tw:px-3 tw:py-1.5 tw:text-[13px] tw:text-ink"
        />
      ) : null}

      {view.rows.length === 0 && view.aggregates.kind === "counts" ? (
        <Card className="tw:p-3">
          <p className="tw:text-[13px] tw:text-ink">Nothing is waiting for review.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
            The decision record was read successfully; every decision in it has been reviewed.
          </p>
        </Card>
      ) : view.rows.length === 0 ? (
        <Card className="tw:p-3">
          <p className="tw:text-[13px] tw:text-ink">No decision rows can be shown.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
            The record has unresolved problems, so this does not mean that everything has been reviewed.
          </p>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="tw:p-3">
          <p className="tw:text-[13px] tw:text-ink">No decision shown here matches “{query.trim()}”.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
            The search reads only the rows this page received. Clear it to see them all, or use{" "}
            <Mono>overseer-decisions list --search</Mono> for the whole record.
          </p>
        </Card>
      ) : (
        shown.map((row) => <DecisionCard key={row.record.id} row={row} elapsedSinceReadMs={elapsedSinceReadMs} />)
      )}

      {view.historyWithheld > 0 ? (
        <p className="tw:mt-3 tw:px-1 tw:text-[12px] tw:text-ink-faint">
          {view.historyWithheld} older {view.historyWithheld === 1 ? "decision is" : "decisions are"} not shown from history.
        </p>
      ) : null}

      <p className="tw:mt-4 tw:px-1 tw:text-[12px] tw:text-ink-faint">
        Read-only here. Reviews and reversals are written with <Mono>npx tsx scripts/overseer-decisions.ts</Mono>.
      </p>
    </div>
  );
}
