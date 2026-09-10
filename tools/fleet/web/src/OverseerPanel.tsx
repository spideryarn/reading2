/**
 * The Overseer tab: **is supervision still working**, what is queued, and one
 * thing it still refuses to fake.
 *
 * ## What changed on 2026-09-08, and why the old text had to go
 *
 * This file used to open with *"There is no Overseer process"* and a hand-typed
 * roadmap of the slices. Both were true when they were written and neither was
 * by the evening: `tools/overseer/` holds a daemon, a store and a clock, and it
 * has been writing `~/.overseer/current.json` against the real store root.
 * A page whose whole claim is that what it shows is true cannot carry a
 * paragraph saying the thing it is looking at does not exist — that is the
 * failure the roadmap card predicted about itself (*"it is prose, so it will go
 * stale"*) arriving in the one place it was most expensive.
 *
 * The replacement is the card below, which computes everything it says.
 *
 * ## The two clocks, which are the point
 *
 * > **A dead dashboard is a fact the Overseer records, not a silence it sits
 * > in.** […] the thing that must never be allowed to look healthy is a daemon
 * > ticking against an empty stream.
 * >
 * > — docs/project/overseer-direction.md § Two tenses
 *
 * The Overseer has no collector: it lives off this dashboard's SSE stream. So
 * `writtenAt` says it is still WRITING and `lastGoodSnapshotAt` says it is still
 * HEARING, and the card draws a warning on a stale source **even while the
 * heartbeat advances**, because that pair is the whole diagnosis. A dead daemon
 * and a deaf one produce different sentences here.
 *
 * ## The box to send the Overseer a message, which arrived on 2026-09-09
 *
 * This section used to say there was none, and that a textarea over a daemon
 * with no inbox would be *"the most expensive lie this tool can tell — a page
 * quietly swallowing instructions into nothing"*. **That half is still true and
 * is why the new card says what it says.** What was wrong was the conclusion:
 * a daemon existing is indeed not an agent that can receive a message, but the
 * **Overseer is not only a daemon**. It is a Claude session in a tmux pane,
 * reachable by the same steer path as every other row on the Sessions tab.
 *
 * So `MessageOverseerCard` addresses the *session* — resolved from the claim
 * rather than picked — and its copy keeps the daemon caveat, because a card
 * that blurred the two would teach somebody that the checkpoint writer has an
 * inbox. Greg, 2026-09-08: *"there should be a way to send messages directly to
 * the Overseer in the Overseer tab, and also to broadcast to all agents"*.
 * docs/plans/260909b-messaging-the-overseer-and-broadcasting-to-all-agents-from-the-dashboard.md.
 *
 * ## The history is history, and is not joined to anything
 *
 * The register rows are what the Overseer REMEMBERS. They are not matched to
 * the fleet rows on the Sessions tab, and the card says so on screen. The
 * generation tuple can stay fixed while the child inside a pane is replaced.
 * Execution identity now provides a key that could support a continuity-aware
 * join, but this slice deliberately leaves that for later — wire.ts §
 * `OverseerRegister`. Here the rows remain history under their own heading.
 */
import type { ReactNode } from "react";

import { BoxActionsCard, FleetQueues } from "./ActionButtons";
import { BroadcastCard } from "./BroadcastCard";
import type { ReceiptsApi } from "./actions-client";
import { MessageOverseerCard } from "./MessageOverseerCard";
import { ReceiptList } from "./ReceiptList";
import { Explain } from "./Tooltip";
import type {
  ClockSkew,
  FleetRow,
  OverseerScheduler,
  OverseerSessionHistory,
  OverseerStatus,
  OverseerView,
  PaneWork,
  UsageView,
} from "./types";
import type { ActionsUi } from "./useActions";
import { Card, cx } from "./ui";
import { UsageCard } from "./UsagePanel";
import type { CodexObservationView } from "./usage-history-client";
import { formatDuration } from "./view";

/**
 * When the Overseer's own write has been silent long enough to mean something.
 *
 * The cadence is the daemon's `TICK_MS`, 30s. Ten missed ticks rather than one,
 * for the reason AttentionPanel's thresholds are generous: a restart or a box
 * under load must not put a warning on a healthy page. If the cadence changes
 * and this does not, the page nags late rather than lying.
 */
const HEARTBEAT_STALE_MS = 5 * 60_000;

/**
 * The fallback for *the fleet source has gone quiet*, used **only when the
 * daemon did not say**.
 *
 * The daemon publishes its own deadline as `sourceStaleAfterMs` and the card
 * prefers it, because the two ends have already drifted once at exactly this
 * number — the watchdog computed 325,000 where the daemon computed 300,000 —
 * and a restated constant is how that happens. This value is the daemon's own
 * documented normal (a 60s collection chain, five missed), and the card names
 * it as a fallback rather than presenting it as the daemon's number.
 */
const SOURCE_STALE_FALLBACK_MS = 5 * 60_000;

/**
 * How old something is, or `null` when its timestamp is not one this page can
 * use. **A TIMESTAMP IN THE FUTURE IS UNREADABLE, NOT FRESH** — a `Math.max(0,
 * …)` here would read as "0s ago" for exactly as long as the fault lasted,
 * which suppresses every staleness branch below and leaves a dead Overseer
 * looking freshly written.
 *
 * `asOf` is the anchor: `Math.max(now, receivedAt)`, a browser-clock reading
 * that cannot be older than the payload it judges, so a tab iOS froze does not
 * age a just-arrived checkpoint against the clock it fell asleep with.
 *
 * **This is the same four lines as `ageMs` in AttentionPanel.tsx, and the
 * duplication is deliberate rather than unnoticed**: that copy is private to a
 * file this stage does not own, and the argument for both — including why there
 * is no render-slack constant — is written out there in full. Whoever next
 * touches both should hoist one into view.ts; two copies that agree are worth
 * less than one, and are still worth more than a wrong second derivation.
 */
function ageMs(at: string, asOf: number): number | null {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  const age = asOf - parsed;
  return age < 0 ? null : age;
}

/** An age in words, or the honest non-answer. Never "0s" standing in for a clock we cannot read. */
function age(at: string, asOf: number): string {
  const ms = ageMs(at, asOf);
  return ms === null ? "at a time this page cannot read" : `${formatDuration(ms)} ago`;
}

/**
 * A quiet one-line state with the detail one tap away — the shape
 * AttentionPanel's `Note` has, so the two panels' non-list arms cannot drift
 * into different sizes of apology.
 */
function Note({
  head,
  what,
  how,
  loud = false,
  children,
}: {
  head: string;
  what: string;
  how: string;
  loud?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <p className="tw:mt-2">
      <Explain
        tip={{ head, what, how }}
        placement="bottom"
        className={cx("tw:text-[13px]", loud ? "tw:font-medium tw:text-alarm-ink" : "tw:text-ink-faint")}
      >
        {children}
      </Explain>
    </p>
  );
}

/** The scheduler line, in the daemon's words or in the honest absence of them. */
function schedulerLine(scheduler: OverseerScheduler): string {
  switch (scheduler.kind) {
    case "armed":
      return `Scheduler armed — ${scheduler.why}`;
    case "blocked":
      /* Switched on and nothing can run. Shouted, because this is the state that
         used to render as "armed" and therefore as fine. */
      return `Scheduler BLOCKED — ${scheduler.why}`;
    case "off":
      return `Scheduler OFF — ${scheduler.why}`;
    case "not-said":
      /* The store's own `unknown`: a daemon that never said. NOT "off", which
         would disarm a running scheduler on screen. */
      return `Scheduler: nobody has said — ${scheduler.why}`;
    case "unreadable":
      return `Scheduler: this page cannot tell — ${scheduler.why}`;
    default: {
      const never: never = scheduler;
      return `Scheduler: ${JSON.stringify(never)}`;
    }
  }
}

/**
 * One remembered session. **`≥` is load-bearing**: it means the Overseer found
 * the session already in that state and cannot see when it began, which was
 * four identical `13m` rows against sessions that had been working for hours.
 * The rule is `describeStatusAge`'s in scripts/overseer.ts — copied, because
 * that is a node module and this file compiles under DOM-only libs.
 */
type WorkScan = { scannedAt: string; shownAge: string; fresh: boolean };

/** The frozen observation in one line. Its tense comes from the scan, not the process start. */
function workLine(work: PaneWork | null, paneStatus: string, scan: WorkScan): string {
  const prefix = `pane: ${paneStatus} · work: `;
  if (work === null) {
    return scan.fresh
      ? `${prefix}the scan carried no reading for this session`
      : `${prefix}the scan carried no reading for this session when checked ${scan.shownAge}`;
  }
  switch (work.kind) {
    case "cannot-tell":
      return scan.fresh
        ? `${prefix}cannot tell — ${work.why}`
        : `${prefix}could not tell when checked ${scan.shownAge} — ${work.why}`;
    case "none":
      return scan.fresh
        ? `${prefix}nothing recognised under it (${work.inspected} processes inspected)`
        : `${prefix}nothing was recognised under it when checked ${scan.shownAge} (${work.inspected} processes inspected)`;
    case "work": {
      // `jobs` is a non-empty tuple, so there is no jobless arm to write a sentence
      // for. There used to be one, and it was unreachable: three parsers refused an
      // empty array and the type still allowed it, which is the shape that grows a
      // branch nobody can test. The type carries it now.
      const [first] = work.jobs;
      const more = work.jobs.length > 1 ? ` + ${work.jobs.length - 1} more` : "";
      const ranFor = first.ranForMs === null ? "an unreadable duration" : formatDuration(first.ranForMs);
      return scan.fresh
        ? `${prefix}${first.label}${more}, running ${ranFor}`
        : `${prefix}${first.label}${more} — was running ${ranFor} when checked ${scan.shownAge}`;
    }
    default: {
      const never: never = work;
      return `${prefix}${JSON.stringify(never)}`;
    }
  }
}

/** The evidence behind one work phrase, including facts too dense for a phone-width row. */
function workEvidence(work: PaneWork | null, scan: WorkScan): { head: string; what: string; how: string } {
  const order = "Rows are ordered by pane-status age, not by child-work age.";
  if (work === null) {
    return {
      head: "No pane reading in this scan",
      what: "The process-table scan carried no entry for this session. That is not a no-work result.",
      how: `Process table read ${scan.scannedAt}. ${order}`,
    };
  }
  switch (work.kind) {
    case "cannot-tell":
      return {
        head: "Work could not be measured",
        what: `The process-tree scan could not classify this pane: ${work.why}`,
        how: `Cause ${work.cause}. Process table read ${scan.scannedAt}. ${order}`,
      };
    case "none":
      return {
        head: "No recognised child work",
        what: `The scan inspected ${work.inspected} processes without matching a known long-running job.`,
        how: `Pane command ${work.paneCommand}; pane started ${work.paneStartedAt}; process table read ${scan.scannedAt}. ${order}`,
      };
    case "work": {
      const jobs = work.jobs
        .map(
          (job) =>
            `${job.label}: ${job.command}, pid ${job.pid}, depth ${job.depth}, started ${job.startedAt ?? "at an unreadable time"}`,
        )
        .join("; ");
      return {
        head: "Recognised child work",
        what: `The process-tree scan matched ${work.jobs.length} known long-running ${work.jobs.length === 1 ? "job" : "jobs"} under this pane.`,
        how: `${jobs}. ${work.inspected} processes inspected beneath pane command ${work.paneCommand}; pane started ${work.paneStartedAt}; process table read ${scan.scannedAt}. ${order}`,
      };
    }
    default: {
      const never: never = work;
      return { head: "Work evidence", what: JSON.stringify(never), how: order };
    }
  }
}

function HistoryRow({ entry, asOf, scan }: { entry: OverseerSessionHistory; asOf: number; scan: WorkScan | null }): ReactNode {
  const ms = ageMs(entry.since.at, asOf);
  const shown = ms === null ? "unreadable" : `${entry.since.kind === "lower-bound" ? "≥" : ""}${formatDuration(ms)}`;
  return (
    <li className="tw:text-[13px]">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
        <span className="tw:font-mono tw:text-[12px] tw:text-ink-faint">{entry.status}</span>
        <span className="tw:tabular-nums tw:text-ink-soft">{shown}</span>
        <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-ink-soft">{entry.name}</span>
        <span className="tw:font-mono tw:text-[11px] tw:text-ink-faint">{entry.tmuxId}</span>
      </div>
      {scan !== null ? (
        <div className="tw:min-w-0 tw:whitespace-normal tw:break-words tw:pl-0 tw:text-[12px] tw:text-ink-faint">
          <Explain tip={workEvidence(entry.work, scan)} placement="bottom" className="tw:max-w-full tw:whitespace-normal tw:text-left">
            {workLine(entry.work, entry.status, scan)}
          </Explain>
        </div>
      ) : null}
    </li>
  );
}

/** The reading itself: two clocks, a heartbeat, a scheduler line, and history. */
function Reading({ status, asOf }: { status: OverseerStatus; asOf: number }): ReactNode {
  const writtenMs = ageMs(status.writtenAt, asOf);
  /* AN AGE NOBODY CAN COMPUTE IS NOT EVIDENCE OF FRESHNESS. Every branch below
     treats `null` as stale, which is the loud direction and the honest one. */
  const writeStale = writtenMs === null || writtenMs > HEARTBEAT_STALE_MS;
  const sourceStaleAfterMs = status.sourceStaleAfterMs ?? SOURCE_STALE_FALLBACK_MS;
  const sourceMs = status.lastGoodSnapshotAt === null ? null : ageMs(status.lastGoodSnapshotAt, asOf);
  /* NEVER-ACCEPTED IS STALE, and it is the purest form of deaf: a daemon that
     has been up for an hour without one accepted snapshot is watching nothing. */
  const sourceStale = status.lastGoodSnapshotAt === null || sourceMs === null || sourceMs > sourceStaleAfterMs;

  /* THE HEADLINE IS THE DIAGNOSIS, and there are three because the two clocks
     fail independently. A stale source with a live heartbeat is the case a
     watchdog reading only the heartbeat would bless, so it gets its own
     sentence rather than a caveat under the reassuring one. */
  const head = writeStale
    ? "The Overseer has stopped writing."
    : sourceStale
      ? "The Overseer is writing, but it is not hearing from this dashboard."
      : "Supervision is running.";

  return (
    <>
      <h2 className={cx("tw:font-medium", writeStale || sourceStale ? "tw:text-alarm-ink" : undefined)}>{head}</h2>

      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        <Explain
          tip={{
            head: "The Overseer's own clock",
            what: "When it last wrote its checkpoint.",
            how: "The daemon writes ~/.overseer/current.json every 30 seconds or so. If this age keeps growing, the daemon is gone or wedged — and everything else on this card is as old as this number, including the inbox on the Sessions tab.",
          }}
        >
          Overseer last wrote <strong className="tw:tabular-nums">{age(status.writtenAt, asOf)}</strong>
        </Explain>
        {"; "}
        <Explain
          tip={{
            head: "Its fleet source",
            what: "When it last accepted a snapshot from this dashboard.",
            how: "The Overseer has no collector of its own — it subscribes to this page's stream. These two clocks come apart exactly when something is wrong: a daemon ticking against a dead stream advances the first and freezes this one.",
          }}
        >
          its fleet source last updated{" "}
          <strong className="tw:tabular-nums">
            {status.lastGoodSnapshotAt === null ? "never" : age(status.lastGoodSnapshotAt, asOf)}
          </strong>
        </Explain>
        .
      </p>

      {/* THE WARNING SURVIVES A LIVE HEARTBEAT. It is drawn whenever the source
          is stale, including when the write above is fresh — which is the whole
          reason there are two clocks rather than one. */}
      {sourceStale ? (
        <Note
          head="The Overseer is not hearing from the dashboard"
          what="Its last accepted snapshot is older than the deadline the daemon itself uses."
          how={`The Overseer subscribes to this dashboard's stream and falls back to polling it. When that fails it keeps ticking, and its register goes on describing a fleet it can no longer see. Deadline used: ${formatDuration(sourceStaleAfterMs)}${status.sourceStaleAfterMs === null ? ", this page's fallback — the daemon did not publish one" : ", the daemon's own"}.`}
          loud
        >
          {status.lastGoodSnapshotAt === null
            ? "it has never accepted a snapshot from this dashboard"
            : "its view of the fleet is stale, however recently it wrote"}
        </Note>
      ) : null}

      <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
        {/* THE VERSION IS ON SCREEN, quietly. It is what turns "this page and
            that daemon disagree" from a guess into a thing somebody can act on,
            and it costs one word beside facts a reader is already skimming. */}
        schema {status.schema} ·{" "}
        {status.heartbeat.kind === "reading" ? (
          <>
            pid {status.heartbeat.pid} · {status.heartbeat.ticks} ticks ·{" "}
            {status.heartbeat.lastTickAt === null
              ? "no tick finished yet"
              : `last tick ${age(status.heartbeat.lastTickAt, asOf)}`}{" "}
            · started {age(status.heartbeat.startedAt, asOf)} · instance{" "}
            <span className="tw:font-mono">{status.heartbeat.instanceId}</span>
          </>
        ) : (
          /* NOT "there is no daemon". The field is there and this build cannot
             read it, which is a different fact and the only one we have. */
          <>heartbeat: this page cannot read it — {status.heartbeat.why}</>
        )}
      </p>

      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        {schedulerLine(status.scheduler)}
        {/* WHOSE DEADLINE IS BEING USED, on the healthy path too. It used to be
            said only inside the stale warning, which is the one moment a reader
            cannot check it against a calm card. A daemon that publishes one
            needs no line: that is the ordinary case. GPT Sol, round two. */}
        {status.sourceStaleAfterMs === null
          ? ` · source deadline: this page's own ${formatDuration(SOURCE_STALE_FALLBACK_MS)} — the daemon did not publish one`
          : null}
      </p>

      <History register={status.register} asOf={asOf} sourceStaleAfterMs={sourceStaleAfterMs} />
    </>
  );
}

/**
 * What the Overseer remembers, in three arms — **and none of them touches the
 * fleet rows.**
 *
 * Its own component rather than a branch inside `Reading`, which is how the two
 * clocks stay readable at the top of that function: the history is the longest
 * part of the card and the least urgent thing on it.
 *
 * *Unreadable* says so and says the Sessions tab is unaffected, because the one
 * thing a reader must not conclude from a broken register is that the box is
 * quiet. *Empty* is two different facts — nothing held at all, and everything
 * held was idle — and the second is worth saying: a register of thirty-six
 * idle sessions is a calm fleet, not an absent one.
 */
function History({
  register,
  asOf,
  sourceStaleAfterMs,
}: {
  register: OverseerStatus["register"];
  asOf: number;
  sourceStaleAfterMs: number;
}): ReactNode {
  if (register.kind === "unreadable") {
    return (
      <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
        The register could not be read — {register.why}. The sessions on the Sessions tab are unaffected: they are
        collected here and owe nothing to this file.
      </p>
    );
  }
  /* One process-table reading serves every row, so its age and freshness are
     computed once here. Per-row clocks would imply measurements that did not happen. */
  const scanMs = register.work.kind === "scanned" ? ageMs(register.work.scannedAt, asOf) : null;
  const shownScanAge = scanMs === null ? "at a time this page cannot read" : `${formatDuration(scanMs)} ago`;
  const scan: WorkScan | null =
    register.work.kind === "scanned"
      ? {
          scannedAt: register.work.scannedAt,
          shownAge: shownScanAge,
          fresh: scanMs !== null && scanMs <= sourceStaleAfterMs,
        }
      : null;
  const workState =
    register.work.kind === "unavailable" ? (
      <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">Work evidence is unavailable — {register.work.why}.</p>
    ) : (
      <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">Process table read {shownScanAge}.</p>
    );
  if (register.sessions.length === 0) {
    return (
      <>
        <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
          {register.total === 0
            ? "The Overseer is holding no sessions in its register."
            : register.work.kind === "scanned"
              ? `All ${register.total} sessions in the Overseer's register had pane status idle, and the scan found no recognised child work under them.`
              : `All ${register.total} sessions in the Overseer's register had pane status idle when it last wrote.`}
        </p>
        {workState}
      </>
    );
  }
  return (
    <>
      <p className="tw:mt-3 tw:text-[13px] tw:text-ink-soft">
        <Explain
          tip={{
            head: "The Overseer's history, not this page's sessions",
            what: "The oldest pane-status records worth showing: non-idle sessions, plus idle sessions with recognised child work or without a usable pane reading.",
            how: "Rows are ordered by pane-status age, not by child-work age. They are not matched to Sessions-tab rows: a pane can keep its identifiers while the agent inside it is replaced, so read them only as what the Overseer remembers.",
          }}
        >
          {register.total} sessions in the Overseer's register — the oldest {register.sessions.length} status records
          worth showing, as history rather than as a claim about the rows on the Sessions tab
        </Explain>
      </p>
      {workState}
      <ul className="tw:mt-2 tw:space-y-1">
        {register.sessions.map((entry) => (
          <HistoryRow key={`${entry.tmuxId}:${entry.name}`} entry={entry} asOf={asOf} scan={scan} />
        ))}
      </ul>
      {/* ONLY WHEN ONE IS ON SCREEN. A legend printed under every healthy pass
          is one a reader learns to skip — the daemon's own status output makes
          the same choice against the same register. */}
      {register.sessions.some((entry) => entry.since.kind === "lower-bound") ? (
        <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
          ≥ is a floor: the Overseer found it already in that state and cannot see when it began.
        </p>
      ) : null}
    </>
  );
}

/**
 * **IS SUPERVISION STILL WORKING?** — one card, five ways of not being able to
 * answer, and one reading.
 *
 * **Only `null` draws nothing**, and `null` is *no payload has arrived yet*.
 * `not-asked` — a payload from a server that does not report supervision at all
 * — draws a quiet line, because a card that vanishes after a rollback leaves a
 * reader looking for it with no explanation. See the prop's own comment.
 *
 * The other four each say what was observed rather than what it implies — an
 * absent checkpoint proves only that nothing has been published at the path we
 * looked at, not that the Overseer is dead.
 */
export function OverseerStatusCard({
  overseer,
  now,
  receivedAt,
}: {
  /**
   * The reading, or **`null` for *no payload has arrived yet***.
   *
   * Those are two different silences and this card used to draw both as
   * nothing. `null` is a page that has not been told anything — there is
   * genuinely nothing to say, and a line there would flash on every load.
   * `not-asked` is a payload that ARRIVED from a server which does not report
   * supervision at all, which happens after a rollback or against an older
   * server, and drawing nothing for it puts the page back to exactly its
   * pre-stage appearance: a reader looking for the status card finds no card
   * and no explanation. GPT Sol's P1, 2026-09-08.
   *
   * It is a narrower rule than `AttentionPanel`'s, and deliberately: that panel
   * sits above a list which is itself the evidence, and this card IS the
   * evidence.
   */
  overseer: OverseerView | null;
  now: number;
  receivedAt: number | null;
}): ReactNode {
  /* ONE ANCHOR FOR THE WHOLE CARD, so the two clocks cannot be judged against
     two different readings of ours. AttentionPanel.tsx § `ageMs`. */
  const asOf = receivedAt === null ? now : Math.max(now, receivedAt);

  /* NOTHING AT ALL, and only here: nothing has arrived to report. */
  if (overseer === null) return null;

  if (overseer.kind === "published") {
    return (
      <Card className="tw:mb-3 tw:p-4">
        <Reading status={overseer.status} asOf={asOf} />
      </Card>
    );
  }

  return (
    <Card className="tw:mb-3 tw:border-l-4 tw:border-l-unknown tw:p-4">
      <h2 className="tw:font-medium">There is no reading of the Overseer's own state.</h2>
      {overseer.kind === "not-asked" ? (
        <Note
          head="This server does not report the Overseer's status"
          what="The payload arrived and carried no reading at all."
          how="A server older than this feature sends no Overseer status — after a rollback, or against a box running an earlier build. It is not a claim that nothing is watching: nothing here has looked. Restarting the dashboard on a current build is what makes this card say something."
        >
          this server did not report whether anything is watching
        </Note>
      ) : null}
      {overseer.kind === "checkpoint-absent" ? (
        <Note
          head="No checkpoint has been published"
          /* NOT "the Overseer is not running", which the evidence does not
             support: it may be starting, may have failed before its first write,
             may be pointed at another OVERSEER_STORE_DIR. */
          what="No Overseer checkpoint has been published at the path this server looked at."
          how="The Overseer publishes ~/.overseer/current.json (or under OVERSEER_STORE_DIR). There is nothing there, so this page cannot say whether anything is watching the fleet — which is NOT the same as nothing watching it."
        >
          no Overseer checkpoint has been published where this server looked
        </Note>
      ) : null}
      {overseer.kind === "checkpoint-unreadable" ? (
        <Note
          head="The checkpoint could not be read"
          what="A checkpoint is there and this server could not open, read or parse it."
          how="Nothing on this page depends on it except this card: the sessions are collected here. Until it can be read, nothing on the box is reporting whether supervision is alive."
          loud
        >
          the checkpoint could not be read — {overseer.why}
        </Note>
      ) : null}
      {overseer.kind === "unsupported-schema" ? (
        <Note
          head="The checkpoint is a version this build does not read"
          what={`It declares schema ${overseer.saw}; this build reads schema ${overseer.known}.`}
          how="Refused rather than coerced: fields have changed meaning across versions — statusSince went from a bare timestamp to a pair — so reading one version as the other draws confident nonsense rather than a gap. One of the two halves needs deploying."
          loud
        >
          the checkpoint says schema {overseer.saw} and this page reads schema {overseer.known}
        </Note>
      ) : null}
      {overseer.kind === "feed-unreadable" ? (
        <Note
          head="The server's answer could not be read"
          what="The server sent an Overseer status this build cannot make sense of."
          how="A page and a server that have come apart — most likely one of them is older than the other. It is not the same as the server not looking, which draws nothing at all."
          loud
        >
          this page could not read the server's answer — {overseer.why}
        </Note>
      ) : null}
    </Card>
  );
}

export function OverseerPanel({
  actions,
  rows,
  unreadableRows,
  overseer,
  usage,
  codex,
  now,
  receivedAt,
  skew,
  receipts,
}: {
  /**
   * The receipts seam — `ReceiptList` reads through it. Optional, and the
   * browser gets the default; a test that wants the list without a network
   * passes one.
   */
  receipts?: ReceiptsApi;
  actions: ActionsUi;
  rows: readonly FleetRow[];
  /**
   * How many rows in this payload could not be read, **or `null` when no
   * collection has finished** — which is not the same as zero and must not be
   * flattened into it.
   *
   * Both cards below refuse while it is non-zero, for two different reasons: a
   * dropped row can be the one holding the Overseer claim or a second claimant,
   * and it is also a session that would silently miss a broadcast labelled
   * *every agent*. `null` refuses too — see each card — because "we have not
   * looked" is not "we looked and found none".
   */
  unreadableRows: number | null;
  /** The Overseer's own state, `not-asked` from a server that does not report it, or `null` before any payload. */
  overseer: OverseerView | null;
  /** What the last usage pass found about the account, or `null` before any payload. */
  usage: UsageView | null;
  /** The newest persisted Codex attempt, owned once by App for both card mounts. */
  codex: CodexObservationView | null;
  /** The page's one clock. Every age on screen agrees because they all read this. */
  now: number;
  /** When this browser received the payload, by its own clock — the anchor. */
  receivedAt: number | null;
  /** For the usage card only, which is the one that draws wall-clock times. See `UsageCard`. */
  skew: ClockSkew;
}): ReactNode {
  /* Handle → title, so a queue can be labelled with the thing a person
     recognises. Built from the latest snapshot; a queue whose session is not in
     it is still drawn, and says so, because an item waiting for a session
     nobody can see is the most interesting one on the page. */
  const titles = new Map<string, string>();
  for (const row of rows) if (row.title !== null) titles.set(row.id, row.title);

  return (
    <div>
      {/* FIRST, because it is the answer to "can I trust the rest of this
          page's account of what is being watched". */}
      <OverseerStatusCard overseer={overseer} now={now} receivedAt={receivedAt} />

      {/* SECOND, and beside the status card rather than on a tab of its own:
          *is anything watching* and *can either subscription afford more work*
          are the two questions you ask before reading anything else here. */}
      <UsageCard usage={usage} codex={codex} now={now} receivedAt={receivedAt} skew={skew} />

      <Card className="tw:p-4">
        <h2 className="tw:font-medium">Everything queued, across the fleet</h2>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          What is about to be said to whom, in the order it will be said. Nothing here has been sent: each item goes
          when its session is next at a prompt, and any of it can be cancelled until then.
        </p>
        <FleetQueues
          feed={actions.feed}
          api={actions.api}
          asked={actions.asked}
          error={actions.error}
          titles={titles}
          onChanged={actions.refresh}
        />
      </Card>

      {/* The same component Box Health draws. One implementation of "say this
          to everybody", per the plan.

          `rows` IS WHAT MAKES THE BROADCAST REACH ANYBODY. The route refuses a
          fleet-wide message that names no recipients, on purpose — it must act
          on the list the person was looking at — and this tab is the one that
          has that list. See `boxActionBody`. Passed straight through, never
          re-read. */}
      <BoxActionsCard
        feed={actions.feed}
        api={actions.api}
        asked={actions.asked}
        error={actions.error}
        onChanged={actions.refresh}
        rows={rows}
      />

      {/* **A DAEMON IS NOT A RECIPIENT — AND THE OVERSEER IS NOT ONLY A
          DAEMON.** This slot used to hold a card saying there was nothing here
          to send a message to. It was right about `tools/overseer/`, which
          publishes a checkpoint and reads no inbox, and wrong about the session:
          the Overseer is a Claude agent in a pane, reachable by the same steer
          path as everything else. The card below keeps both halves — see its
          header, and docs/plans/260909b-…. */}
      <MessageOverseerCard rows={rows} unreadableRows={unreadableRows} />

      {/* The other half of what Greg asked for on 2026-09-08. Beside the
          ease-off broadcast rather than replacing it: that one says a reviewed
          sentence with a staggered pause in it, this one says whatever you type.
          routes-broadcast.ts § the header says why they are two loops today and
          which way the dependency should run when they become one. */}
      <BroadcastCard rows={rows} unreadableRows={unreadableRows} />

      {/* **WHAT BECAME OF WHAT WAS SENT**, beside the two cards that send —
          plan 260910d, Stage 4. Here and not in the Sessions detail pane, which
          remounts on a change of execution identity; this tab is the neutral
          host its cards already share (agreed with `session-continuity`). */}
      <ReceiptList {...(receipts === undefined ? {} : { api: receipts })} />
    </div>
  );
}
