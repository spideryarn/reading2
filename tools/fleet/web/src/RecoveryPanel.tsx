/**
 * Interrupted work: what a reboot or a tmux restart left behind, as the
 * Overseer recorded it — shown, and **never acted on**.
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § 6. Resuming is the next roadmap stage; this page is the evidence that stage
 * will consume. So there are no buttons, no links that act, and no command text:
 * a directory is a path to read, a host is a name to read, and `manual` is drawn
 * as "on <host>, in <dir>" rather than as anything to paste into a terminal.
 *
 * ## The states that must never become an empty list
 *
 * The server says why there is nothing (`absent`, `unreadable`,
 * `unsupported-schema`, `oversized`), and this page gives each its own
 * sentence. Inside a published index, four more facts get banners at the top
 * rather than being folded into the rows: the daemon has not checked the records
 * yet; the inventory it checked against cannot be trusted (drawn **once**, so
 * every `unknown` row is not wearing the same sentence); the one-time replay of
 * an old log did not run; and candidates past the capacity exist only in the
 * journal.
 *
 * ## The server's order, not ours
 *
 * Rows arrive grouped, interrupted first, newest disappearance first — the
 * feed's projection. This component inserts a subheading when the group
 * changes and does not sort, for DecisionsPanel's reason: a second ordering rule
 * in the browser would let two readers of one index disagree.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { httpRecoveryApi, type RecoveryApi, type RecoveryView } from "./recovery-client";
import { Card, Mono, Pill, SectionHeading, cx, toneClasses } from "./ui";
import { formatDuration, type Tone } from "./view";
import type {
  RecoveryFeed,
  RecoveryWireEvidence,
  RecoveryWireLiveRow,
  RecoveryWireRecord,
  RecoveryWireRecordState,
  RecoveryWireTranscript,
} from "../../wire";

/** No faster than this, and only while mounted: the index changes when the daemon writes it, which is not often. */
export const RECOVERY_POLL_MS = 60_000;

type Published = Extract<RecoveryFeed, { kind: "published" }>;
type PanelView = RecoveryView | { kind: "loading" };

type Group = { label: string; tone: Tone };

function groupOf(state: RecoveryWireRecordState): Group {
  switch (state.kind) {
    case "resolved":
      return { label: "Resolved", tone: "idle" };
    case "unchecked":
      return { label: "Not yet checked", tone: "unknown" };
    case "classified":
      switch (state.classification.kind) {
        case "interrupted":
          return { label: "Interrupted", tone: "needs" };
        case "present-but-unmatched":
          return { label: "Present but unmatched", tone: "unknown" };
        case "unknown":
          return { label: "Unknown", tone: "unknown" };
        case "ended-before-reboot":
          return { label: "Stopped before the world change", tone: "idle" };
        case "already-live":
          return { label: "Already live", tone: "work" };
        default: {
          const never: never = state.classification;
          return never;
        }
      }
    default: {
      const never: never = state;
      return never;
    }
  }
}

/** An age in words, or null — never "0s" standing in for a clock this page cannot read. */
function ageOf(at: string, nowMs: number): string | null {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed) || !Number.isFinite(nowMs) || nowMs - parsed < 0) return null;
  return formatDuration(nowMs - parsed);
}

function When({ at }: { at: string }): ReactNode {
  return <time dateTime={at}>{at}</time>;
}

/** A path, which must break anywhere on a phone: it has no spaces to wrap at. */
function PathText({ path }: { path: string }): ReactNode {
  return <span className="tw:font-mono tw:text-[12px] tw:break-all tw:text-ink">{path}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
      <dt className="tw:text-ink-faint">{label}</dt>
      <dd className="tw:min-w-0 tw:break-words tw:text-ink-soft">{children}</dd>
    </div>
  );
}

function Banner({ tone, head, children, testId }: { tone: Tone; head: string; children?: ReactNode; testId: string }): ReactNode {
  return (
    <Card className={cx("tw:mb-2 tw:border-l-4 tw:p-3", toneClasses(tone).edge, toneClasses(tone).wash)}>
      <div data-testid={testId}>
        <p className={cx("tw:text-[13px] tw:font-semibold", toneClasses(tone).ink)}>{head}</p>
        {children === undefined ? null : <div className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{children}</div>}
      </div>
    </Card>
  );
}

function transcriptFact(t: RecoveryWireTranscript): ReactNode {
  switch (t.kind) {
    case "found":
      return (
        <>
          found, for its verified conversation <Mono>{t.conversationId}</Mono>: <PathText path={t.path} />
        </>
      );
    case "found-under-claim":
      return (
        <>
          <Pill tone="unknown">unverified</Pill> found under the session's claim <Mono>{t.claimedConversationId}</Mono>, not under a
          verified conversation: <PathText path={t.path} />. {t.why}
        </>
      );
    case "not-found":
      return (
        <>
          not found, looked for under the {t.under === "verified" ? "verified conversation" : "claim"} <Mono>{t.conversationId}</Mono>:{" "}
          {t.why}
        </>
      );
    case "cannot-tell":
      return (
        <>
          <Pill tone="unknown">cannot tell</Pill> looked for under the {t.under === "verified" ? "verified conversation" : "claim"}{" "}
          <Mono>{t.conversationId}</Mono>: {t.why}
        </>
      );
    case "no-conversation":
      return <>none to look for: {t.why}</>;
    default: {
      const never: never = t;
      return never;
    }
  }
}

function EvidenceFacts({ evidence }: { evidence: RecoveryWireEvidence }): ReactNode {
  if (evidence.kind === "unavailable") return <Fact label="evidence">{evidence.why}</Fact>;
  const { dir, worktree, transcript, lastActivity, resume } = evidence;
  return (
    <>
      <Fact label="directory">
        {dir.kind === "exists" ? (
          <>
            <PathText path={dir.path} /> — exists
          </>
        ) : dir.kind === "missing" ? (
          <>
            <PathText path={dir.path} /> — <span className="tw:font-semibold tw:text-needs-ink">missing</span>: {dir.why}
          </>
        ) : dir.kind === "cannot-tell" ? (
          <>
            <PathText path={dir.path} /> — cannot tell whether it exists: {dir.why}
          </>
        ) : (
          <>not recorded: {dir.why}</>
        )}
      </Fact>
      {worktree.kind === "none" ? null : (
        <Fact label="worktree">
          <Mono>{worktree.name}</Mono>
          {worktree.kind === "recorded" ? " — the directory above is inside it" : ` — ${worktree.why}`}
        </Fact>
      )}
      <Fact label="transcript">{transcriptFact(transcript)}</Fact>
      <Fact label="last activity">
        {lastActivity.source === "transcript" ? (
          <>
            <When at={lastActivity.at} /> (the transcript's last write)
          </>
        ) : (
          <>
            ≥ <When at={lastActivity.at} /> (a floor: alive at least this recently)
          </>
        )}
      </Fact>
      <Fact label="resume">
        {resume.kind === "supported"
          ? "supported by the next stage: its verified conversation's transcript was found. Nothing here starts it."
          : resume.kind === "not-supported"
            ? `not supported: ${resume.why}`
            : `manual: ${resume.why}`}
      </Fact>
      {resume.kind === "manual" ? (
        <Fact label="where to look">
          on <Mono>{resume.host}</Mono>, in {resume.dir === null ? "no recorded directory" : <PathText path={resume.dir} />}
        </Fact>
      ) : null}
    </>
  );
}

/**
 * The live row a record was matched against, or only resembles — **with the
 * four facts the match turns on** (Sol's F32): its directory, the conversation
 * its session claims, the conversation it was verified to be running, and its
 * execution token. Without them "present but unmatched" is a verdict nobody can
 * check. Each says so when it is absent rather than being left out.
 */
function LiveRowFacts({ row }: { row: RecoveryWireLiveRow }): ReactNode {
  return (
    <>
      <Fact label="live row">
        <Mono>{row.name}</Mono> ({row.tmuxId}), {row.statusKey}
      </Fact>
      <Fact label="live directory">{row.dir === null ? "not recorded" : <PathText path={row.dir} />}</Fact>
      <Fact label="live claim">
        {row.claimedConversationId === null ? (
          "none"
        ) : (
          <>
            <Mono>{row.claimedConversationId}</Mono> (the session's claim, unverified)
          </>
        )}
      </Fact>
      <Fact label="live conversation">
        {row.conversationId === null ? (
          "not verified"
        ) : (
          <>
            <Mono>{row.conversationId}</Mono> (verified)
          </>
        )}
      </Fact>
      <Fact label="live run">{row.executionToken === null ? "not verified" : <Mono>{row.executionToken}</Mono>}</Fact>
    </>
  );
}

function RecordCard({ record, untrusted }: { record: RecoveryWireRecord; untrusted: boolean }): ReactNode {
  const group = groupOf(record.state);
  const state = record.state;
  let why: string;
  let pill: string;
  switch (state.kind) {
    case "resolved":
      pill = state.resolution.disposition;
      why =
        state.resolution.disposition === "resumed"
          ? `resumed: its verified conversation ${state.resolution.evidence.conversationId} is live under a different run (${state.resolution.evidence.previousToken} → ${state.resolution.evidence.token})`
          : state.resolution.disposition === "superseded"
            ? `superseded by a newer record, ${state.resolution.evidence.by}`
            : `dismissed: “${state.resolution.evidence.why}”`;
      break;
    case "unchecked":
      pill = "not checked";
      why = state.why;
      break;
    case "classified":
      pill = state.classification.kind;
      // THE INVENTORY-TRUST SENTENCE IS THE BANNER'S, drawn once above. Every
      // row it makes unknown says so in five words rather than repeating it.
      why =
        untrusted && state.classification.kind === "unknown"
          ? "unknown: the current inventory cannot be trusted (see above)"
          : state.classification.why;
      break;
    default: {
      const never: never = state;
      return never;
    }
  }
  const gone = record.disappearance;
  return (
    <Card className={cx("tw:mb-2 tw:border-l-4 tw:p-3", toneClasses(group.tone).edge)}>
      <div data-testid="recovery-record" data-state={state.kind === "classified" ? state.classification.kind : state.kind}>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Pill tone={group.tone}>{pill}</Pill>
          {record.origin === "legacy" ? <Pill tone="idle">from an old log</Pill> : null}
          <span className="tw:min-w-0 tw:text-[13px] tw:font-semibold tw:break-all tw:text-ink">{record.name}</span>
        </div>
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-soft">{why}</p>
        <dl className="tw:mt-2 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1 tw:text-[12px]">
          <Fact label="disappeared">
            <When at={record.at} />
            {gone === null
              ? null
              : ` — ${gone.goneWhy}; ${gone.watched ? "the daemon watched it go" : "nobody watched it go"}${gone.bootChanged ? "; the host's boot id changed" : ""}`}
          </Fact>
          {record.oversize ? <Fact label="record">too large for the index; the full candidate is in events.jsonl</Fact> : null}
          {state.kind === "classified" && (state.classification.kind === "already-live" || state.classification.kind === "present-but-unmatched") ? (
            <LiveRowFacts row={state.classification.row} />
          ) : null}
          {state.kind === "classified" ? (
            <EvidenceFacts evidence={state.evidence} />
          ) : (
            <>
              {record.entry === null ? null : (
                <>
                  <Fact label="directory">
                    {record.entry.dir === null ? (
                      "not recorded"
                    ) : (
                      <>
                        <PathText path={record.entry.dir} /> — whether it exists was not checked
                      </>
                    )}
                  </Fact>
                  {/* THE STORED WORKTREE, AS RECORDED (Sol's F32): a name, unchecked. */}
                  <Fact label="worktree">{record.entry.worktree === null ? "none recorded" : <Mono>{record.entry.worktree}</Mono>}</Fact>
                  <Fact label="transcript">not checked</Fact>
                  <Fact label="last activity">
                    ≥ <When at={record.entry.lastSeenAlive} /> (a floor: alive at least this recently)
                  </Fact>
                </>
              )}
              <Fact label="resume">{state.kind === "resolved" ? "not applicable, this record is resolved" : "not checked"}</Fact>
            </>
          )}
          <Fact label="latest evidence">
            {record.lastSeen !== null ? (
              <>
                last seen <Mono>{record.lastSeen.statusKey}</Mono>, harness {record.lastSeen.harness ?? "not verified"}, at{" "}
                <When at={record.lastSeen.collectedAt} />
                {record.lastSeen.title === null ? null : <> — “{record.lastSeen.title}”</>}
              </>
            ) : record.entry !== null ? (
              <>
                no watched sighting; the register last recorded <Mono>{record.entry.lastStatusKey}</Mono>
              </>
            ) : (
              "no sighting survives"
            )}
          </Fact>
          {state.kind === "resolved" ? (
            <Fact label="resolved">
              <When at={state.resolution.at} />
            </Fact>
          ) : null}
        </dl>
      </div>
    </Card>
  );
}

function PublishedView({ feed, nowMs, receivedAtMs }: { feed: Published; nowMs: number; receivedAtMs: number }): ReactNode {
  const view = feed.view;
  const untrusted = view.kind === "checked" && view.inventory.kind === "untrusted";
  // THE AGE IS THE SERVER'S (Sol's F31). `checkedAt` is the box's clock; a
  // phone's can be minutes out, and measuring one against the other said
  // "checked 0s ago" of a view the server already knew was half an hour old.
  // So it is measured against `composedAt`, the server's clock when it
  // answered, advanced by how long this page has held the answer — an interval
  // on this page's clock, which is the one thing that clock can measure.
  const serverNowMs = Date.parse(feed.composedAt) + Math.max(0, nowMs - receivedAtMs);
  const age = view.kind === "checked" ? ageOf(view.checkedAt, serverNowMs) : null;
  // THE PLAIN EMPTY STATE ONLY FOR A TRULY EMPTY INDEX (Sol's F33). Beside an
  // overflow, or a replay that did not run, "no interrupted work is recorded"
  // contradicts the banner above it: there is work recorded, just not here.
  const trulyEmpty = feed.total === 0 && feed.overflow === 0 && feed.replay.kind === "ran";
  let lastGroup: string | null = null;
  return (
    <div>
      {view.kind === "not-yet-checked" ? (
        <Banner tone="unknown" head="Not yet checked by this daemon." testId="recovery-banner-unchecked">
          {view.why}. The records below are the ones it holds; their classification is unknown until then.
        </Banner>
      ) : view.kind === "unreadable" ? (
        <Banner tone="alarm" head="The daemon's view of these records could not be read." testId="recovery-banner-view-unreadable">
          {view.why}. The records are shown unchecked.
        </Banner>
      ) : view.inventory.kind === "untrusted" ? (
        <Banner tone="unknown" head="The inventory cannot be trusted right now, so every record is unknown." testId="recovery-banner-untrusted">
          {view.inventory.why}
        </Banner>
      ) : null}
      {feed.replay.kind === "not-run" ? (
        <Banner tone="alarm" head="The one-time replay of the log did not run." testId="recovery-banner-replay">
          {feed.replay.why}. Work interrupted before this index existed may be missing from it.
        </Banner>
      ) : null}
      {feed.overflow > 0 ? (
        <Banner
          tone="alarm"
          head={`${feed.overflow} ${feed.overflow === 1 ? "candidate is" : "candidates are"} past the index's capacity and not listed.`}
          testId="recovery-banner-overflow"
        >
          Those events survive only in <Mono>events.jsonl</Mono>; neither this page nor the CLI lists them.
        </Banner>
      ) : null}

      <p data-testid="recovery-age" className="tw:mb-2 tw:px-1 tw:text-[12px] tw:text-ink-faint">
        {view.kind === "checked" ? (
          <>
            {age === null ? (
              <>
                Checked at <When at={view.checkedAt} /> (how long ago cannot be read from the server's clock)
              </>
            ) : (
              <>
                Checked {age} ago by the server's clock, at <When at={view.checkedAt} />
              </>
            )}
            {view.inventory.kind === "trusted" ? (
              <>
                , against the inventory collected at <When at={view.inventory.collectedAt} /> ({view.inventory.rows}{" "}
                {view.inventory.rows === 1 ? "session" : "sessions"})
              </>
            ) : null}
            .{" "}
          </>
        ) : null}
        {feed.unresolved} unresolved of {feed.total} {feed.total === 1 ? "record" : "records"}.
        {feed.writtenAt === null ? null : (
          <>
            {" "}
            Index written <When at={feed.writtenAt} />.
          </>
        )}
      </p>

      {feed.records.length === 0 ? (
        trulyEmpty ? (
          <Card className="tw:p-3">
            <p data-testid="recovery-empty" className="tw:text-[13px] tw:text-ink">
              No interrupted work is recorded.
            </p>
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">The index was read, and it holds no records.</p>
          </Card>
        ) : (
          <Card className="tw:p-3">
            <p data-testid="recovery-empty" className="tw:text-[13px] tw:text-ink">
              The recovery index currently holds no records.
            </p>
          </Card>
        )
      ) : (
        feed.records.map((record) => {
          const group = groupOf(record.state).label;
          const heading = group === lastGroup ? null : <h3 className="tw:px-1 tw:pt-2 tw:pb-1 tw:text-[12px] tw:font-semibold tw:text-ink-soft">{group}</h3>;
          lastGroup = group;
          return (
            <div key={record.id}>
              {heading}
              <RecordCard record={record} untrusted={untrusted} />
            </div>
          );
        })
      )}

      {feed.olderCount > 0 ? (
        <p className="tw:mt-2 tw:px-1 tw:text-[12px] tw:text-ink-faint">
          {feed.olderCount} older {feed.olderCount === 1 ? "record is" : "records are"} not shown here; the recovery CLI's list shows every
          record the index holds.
        </p>
      ) : null}
      {feed.replay.kind === "ran" ? (
        <p className="tw:mt-2 tw:px-1 tw:text-[11px] tw:text-ink-faint">
          The old log was scanned once: {feed.replay.worldChanges} world {feed.replay.worldChanges === 1 ? "change" : "changes"},{" "}
          {feed.replay.derived} {feed.replay.derived === 1 ? "record" : "records"} derived.
        </p>
      ) : null}
    </div>
  );
}

function Body({ view, nowMs, receivedAtMs }: { view: PanelView; nowMs: number; receivedAtMs: number }): ReactNode {
  switch (view.kind) {
    case "loading":
      return <p className="tw:p-3 tw:text-[13px] tw:text-ink-faint">Reading the recovery index…</p>;
    case "no-answer":
      return (
        <Banner tone="unknown" head="This browser did not get an answer from the recovery API." testId="recovery-no-answer">
          {view.why}
        </Banner>
      );
    case "absent":
      return (
        <Banner tone="idle" head="No recovery index has been written here yet." testId="recovery-absent">
          {view.why} <PathText path={view.path} />
        </Banner>
      );
    case "unreadable":
      return (
        <Banner tone="alarm" head="The recovery index could not be read." testId="recovery-unreadable">
          {view.why}
          <p className="tw:mt-1">This is not an empty list: interrupted work could be hidden.</p>
        </Banner>
      );
    case "unsupported-schema":
      return (
        <Banner tone="alarm" head="The recovery index is in a format this dashboard cannot read." testId="recovery-unsupported">
          {view.why}
        </Banner>
      );
    case "oversized":
      return (
        <Banner tone="alarm" head="The recovery index is too large for this page." testId="recovery-oversized">
          {view.why}
        </Banner>
      );
    case "published":
      return <PublishedView feed={view} nowMs={nowMs} receivedAtMs={receivedAtMs} />;
    default: {
      const never: never = view;
      return never;
    }
  }
}

export function RecoveryPanel({
  api = httpRecoveryApi,
  refreshNonce = 0,
  nowMs,
}: {
  api?: RecoveryApi;
  /** Bumped by the dock's Refresh. */
  refreshNonce?: number;
  /** The page's ticking clock, for the view's age. */
  nowMs?: number;
}): ReactNode {
  // The answer, and when this page got it on the page's own clock: the view's
  // age is the server's clock advanced by the interval since (F31).
  const [held, setHeld] = useState<{ view: PanelView; receivedAtMs: number }>({ view: { kind: "loading" }, receivedAtMs: 0 });
  const pageClock = useRef(nowMs);
  useEffect(() => {
    pageClock.current = nowMs;
  }, [nowMs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal.
  useEffect(() => {
    let current: AbortController | null = null;
    let live = true;
    const load = (): void => {
      current?.abort();
      const request = new AbortController();
      current = request;
      void api.fetch(request.signal).then((next) => {
        if (live && !request.signal.aborted) setHeld({ view: next, receivedAtMs: pageClock.current ?? Date.now() });
      });
    };
    load();
    const timer = setInterval(load, RECOVERY_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      current?.abort();
    };
  }, [api, refreshNonce]);

  return (
    <section aria-label="Interrupted work" data-testid="recovery-panel">
      <SectionHeading>Interrupted work</SectionHeading>
      <Body view={held.view} nowMs={nowMs ?? Date.now()} receivedAtMs={held.receivedAtMs} />
      <p className="tw:mt-3 tw:px-1 tw:text-[12px] tw:text-ink-faint">
        Read-only. Nothing on this page starts, resumes or dismisses anything.
      </p>
    </section>
  );
}
