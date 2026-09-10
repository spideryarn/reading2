/**
 * Box health, rendered without knowing what it is.
 *
 * **THE COLLECTOR IS NOT OURS.** `tools/fleet/health.ts` was written in
 * parallel with this file by another agent, so the `health` field on the
 * payload is typed `unknown` in types.ts and this panel draws whatever arrives
 * — objects, arrays, numbers, strings, nothing. That is not a placeholder for a
 * schema-aware panel; it is the honest version of a panel whose schema belongs
 * to somebody else, and it means a reading the collector adds tomorrow appears
 * here without anybody editing this file.
 *
 * **That was true of the whole panel until 2026-09-08, and is now true of its
 * fallback.** Greg asked for the numbers that matter to be legible at a glance
 * and coloured red/amber/green, so `health-view.ts` reads five readings by name
 * and draws them as tiles at the top, and the generic view is a disclosure
 * underneath rather than the page itself. What keeps the original argument's
 * teeth: every threshold is health.ts's own and says so, a field that is absent
 * produces no tile rather than a zero, an unreadable one is violet carrying the
 * collector's own words, and when nothing at all is recognised the generic view
 * opens by itself. A collector that renames a reading loses a tile and keeps a
 * truthful page.
 *
 * **Absence is stated, never drawn as emptiness.** `health: null` means the
 * server had nothing to give, and this says so with the reason it is most
 * likely to be — because a blank panel and a healthy box look identical, and
 * the whole tool is built around not letting those two be confused.
 */
import type { ReactNode } from "react";

import { LONG_RUN_MS } from "../../resource-policy.js";
import { BoxActionsCard } from "./ActionButtons";
import { HealthHistory } from "./HealthHistory";
import { RawValue } from "./RawValue";
import { httpHistoryApi, type HistoryApi } from "./health-history-client";
import { Explain, type Tip } from "./Tooltip";
import { readHealthStats, type Stat, type StatBar } from "./health-view";
import type { ClockSkew, FleetRow } from "./types";
import type { ActionsUi } from "./useActions";
import { Card, Pill, SectionHeading, cx, toneClasses } from "./ui";
import { formatDuration, type Tone } from "./view";
import { CURRENT_WORK_NOT_REPORTED, type CurrentWorkView } from "./work-client";
import { recogniserLabel } from "./work-series";

/**
 * **The generic renderer moved out** to RawValue.tsx on 2026-09-08, unchanged,
 * because a second caller arrived: a box action's dry run answers *what would
 * you kill*, and that shape belongs to the route the same way the health
 * reading belongs to health.ts. Two generic renderers would be two places for a
 * phone to lock up on a deeply nested object, and two sets of truncation
 * guards. The depth and item limits, and the fact that they say so on the page
 * when they bite, went with it.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The one field this panel reads by name: `verdict`.
 *
 * `tools/fleet/health.ts` computes `{ level, reasons }` and its own header says
 * why `unknown` is a fourth level beside ok/strained/critical — *a missing
 * reading must never collapse into looking healthy*. That is the same argument
 * the session statuses make, so it gets the same treatment here: its own line,
 * in the tone the rest of the tool already uses for that meaning.
 *
 * **Lifting it is not inventing a schema.** Everything else stays generic
 * below, and this returns null the moment the shape is not what it expects — so
 * a collector that renames the field loses a banner rather than a page, and the
 * field still appears in the generic view underneath. Read the whole panel
 * before adding a second of these: one headline is a summary, six is a schema,
 * and a schema written here goes stale where nobody is looking.
 */
const LEVEL_TONE: Record<string, Tone> = {
  ok: "work",
  strained: "needs",
  /* Its own red rather than "needs you"'s orange, since 2026-09-08. The three
     levels are a scale, and drawing the top two in one colour threw away the
     step that matters most — and the tiles below colour red/amber/green against
     the same cutoffs, so a critical badge over a red tile has to be that red. */
  critical: "alarm",
  unknown: "unknown",
};

/**
 * The card the verdict wears. One sentence about what it is, one about the
 * fourth level — which is the thing a reader will not guess and the whole
 * reason the collector computes a verdict at all.
 */
const VERDICT_TIP: Tip = {
  head: "The verdict",
  what: "One level over every reading below — ok, strained or critical — with the reasons that produced it.",
  how: "There is a fourth, unknown, for when the core readings could not be taken. That is not the same as the box being fine, and keeping the two apart is what this whole panel is for.",
};

function Verdict({ health }: { health: unknown }): ReactNode {
  if (!isRecord(health)) return null;
  const verdict = health["verdict"];
  if (!isRecord(verdict)) return null;
  const level = verdict["level"];
  if (typeof level !== "string") return null;
  const tone = LEVEL_TONE[level] ?? "unknown";
  const reasons = Array.isArray(verdict["reasons"])
    ? verdict["reasons"].filter((r): r is string => typeof r === "string")
    : [];
  return (
    <Card
      className={cx(
        "tw:mb-3 tw:border-l-4 tw:p-4",
        toneClasses(tone).edge,
        tone === "needs" && "tw:bg-needs-wash",
      )}
    >
      <div className="tw:flex tw:items-center tw:gap-2">
        <Explain tip={VERDICT_TIP} placement="bottom">
          <Pill tone={tone}>{level}</Pill>
        </Explain>
        <span className="tw:text-[13px] tw:text-ink-faint">the box, as it reports itself</span>
      </div>
      {reasons.length > 0 ? (
        <ul className="tw:mt-2 tw:space-y-1 tw:text-[13px] tw:text-ink-soft">
          {reasons.map((reason, index) => (
            <li key={`${index}-${reason}`} className="tw:break-words">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function HealthPanel({
  health,
  actions,
  rows,
  /* Injectable for the same reason `MessagesApi` is: a test needs to hand this
     panel a window of history without a server, and the default is the real
     one so no caller has to know. */
  historyApi = httpHistoryApi,
  currentWork = CURRENT_WORK_NOT_REPORTED,
  now,
  skew,
}: {
  health: unknown;
  actions: ActionsUi;
  rows: readonly FleetRow[];
  historyApi?: HistoryApi;
  /** The live checkpoint projection. It is deliberately not sourced from `historyApi`. */
  currentWork?: CurrentWorkView;
  /** Browser clock shared by the whole page, so reading age keeps moving. */
  now: number;
  /**
   * **PASSED STRAIGHT THROUGH TO THE CHART'S LABELS, and nothing else here
   * reads it.** Required rather than defaulted for the reason `parsePause`'s is:
   * a new caller has to say which clock it is holding, and a default of
   * "unmeasured" would let a page that HAS measured one quietly stop correcting
   * the only times on this panel that a reader compares against their watch.
   */
  skew: ClockSkew;
}): ReactNode {
  /**
   * **The buttons are drawn even when the readings are not.**
   *
   * A box whose health could not be collected is a box you are more likely to
   * want to kill something on, not less — the collector failing and the box
   * being in trouble are the same picture, which is this whole panel's subject.
   * So `BoxActionsCard` sits under both branches, and its own dry run is what
   * says what the box actually looks like right now.
   */
  const acts = (
    <BoxActionsCard
      feed={actions.feed}
      api={actions.api}
      asked={actions.asked}
      error={actions.error}
      onChanged={actions.refresh}
      rows={rows}
    />
  );
  const running = <CurrentWork currentWork={currentWork} now={now} />;

  if (health === null || health === undefined) {
    return (
      <div>
        <Card className="tw:border-l-4 tw:border-l-unknown tw:p-4">
          <h2 className="tw:font-medium">No box health data.</h2>
          <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
            The server sent <code className="tw:font-mono">health: null</code>, which means it had
            nothing to give — not that the box is well. The collector is
            <code className="tw:font-mono"> tools/fleet/health.ts</code>, and it is being written
            separately from this page.
          </p>
          <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
            Until it lands, load average and memory are what the box reports to whoever is logged into
            it. This page will draw whatever shape the collector chooses without needing a change here.
          </p>
        </Card>
        {running}
        {acts}
      </div>
    );
  }

  const stats = readHealthStats(health);

  return (
    <div>
      <Verdict health={health} />

      {stats.length > 0 ? (
        <>
          <SectionHeading>The numbers</SectionHeading>
          {/* `auto-fit` with a `minmax` floor rather than a column count: the
              tiles are all the same shape, so this is the one case on the page
              where CSS can be trusted to do the arithmetic itself — unlike the
              session bands, whose widths depend on their content (fit.ts). */}
          <div className="tw:grid tw:gap-2 tw:[grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]">
            {stats.map((stat) => (
              <StatTile key={stat.key} stat={stat} />
            ))}
          </div>
        </>
      ) : null}

      {running}

      {/* **Under the tiles, above the raw dump.** The tiles say how the box is
          now; this says how it has been, which is the question the tiles cannot
          answer and the one Greg opens the page after an outage to ask. It
          fetches its own data — the history is about a megabyte and changes
          once a minute, so putting it in the five-second state poll would be
          the wrong shape twice over. */}
      <HealthHistory api={historyApi} nowMs={now} skew={skew} />

      {/* **The raw dump is a disclosure now, not the page.** It read as a debug
          view — load, memory, swap, disk and attribution as bare key-value
          pairs under a shouted heading — and it was the first thing after the
          verdict. It stays because it is the honest fallback for a shape this
          panel does not recognise, which is why it opens by itself when there
          were no tiles to draw: in that case it is not the appendix, it is
          everything there is.

          A `<details>` rather than a button and a piece of state: it is a
          disclosure, the browser has one, and it needs no JavaScript to be
          keyboard-reachable and announced correctly. */}
      <details open={stats.length === 0} className="tw:mt-3">
        <summary className="tw:cursor-pointer tw:rounded-md tw:px-1 tw:py-1 tw:text-[12px] tw:text-ink-faint tw:hover:text-ink-soft">
          Everything the server sent
        </summary>
        <Card className="tw:mt-2 tw:p-4">
          <RawValue value={health} depth={0} />
        </Card>
      </details>

      {/* Under the readings rather than over them: the numbers are what tell
          you whether to press anything, and a row of kill buttons above the
          verdict would be an invitation rather than a response. */}
      {acts}
    </div>
  );
}

/**
 * The live work reading. Its durations and its age are intentionally two
 * numbers: `ranForMs` was frozen by the process-table scan, while age says how
 * long ago that scan happened. Recomputing the first from `startedAt` would
 * make a stale daemon appear to keep observing a job it has not seen.
 */
function CurrentWork({ currentWork, now }: { currentWork: CurrentWorkView; now: number }): ReactNode {
  let content: ReactNode;
  if (currentWork.kind === "not-reported") {
    content = "This server did not report current work; that is not a reading of an idle box.";
  } else if (currentWork.kind === "payload-unreadable") {
    content = `This page could not read current work: ${currentWork.why}.`;
  } else if (currentWork.kind === "checkpoint-absent") {
    content = "The Overseer has not published a current-work checkpoint yet.";
  } else if (currentWork.kind === "checkpoint-unreadable") {
    content = `The current-work checkpoint could not be read: ${currentWork.why}.`;
  } else {
    const { work } = currentWork;
    if (work.kind === "not-yet-run") {
      content = `No work scan has run yet: ${work.why}.`;
    } else if (work.kind === "probe-failed") {
      content = `The current-work probe failed: ${work.why}.`;
    } else if (work.kind === "checkpoint-unavailable") {
      content = `Current work could not be established: ${work.why}.`;
    } else {
      const scanAge = Math.max(0, now - Date.parse(work.scannedAt));
      content = (
        <div>
          {work.groups.length === 0 ? (
            <p>Nothing recognised was running when this reading was taken.</p>
          ) : (
            <ul className="tw:space-y-2">
              {work.groups.map((group) => {
                const measured = group.timing.kind === "unknown" ? null : group.timing.longestRanForMs;
                return (
                  <li key={`${group.session}:${group.recogniser}`} className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
                    <span className="tw:font-medium tw:text-ink">{group.session}</span>
                    <span className="tw:text-ink-soft">
                      {recogniserLabel(group.recogniser)} · {group.jobs} job{group.jobs === 1 ? "" : "s"}
                    </span>
                    <span className="tw:text-ink-faint">
                      {measured === null
                        ? "measured timing unavailable"
                        : group.timing.kind === "partial"
                          ? `longest measured run ${formatDuration(measured)} among ${group.timing.knownJobs} of ${group.jobs} jobs; timing was unavailable for ${group.jobs - group.timing.knownJobs}`
                          : `longest measured run ${formatDuration(measured)}`}
                    </span>
                    {measured !== null && measured >= LONG_RUN_MS ? <Pill tone="needs">long-running</Pill> : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="tw:mt-2 tw:text-ink-faint">Reading {formatDuration(scanAge)} old.</p>
          {work.panes.cannotTell > 0 ? (
            <p className="tw:mt-1 tw:text-unknown-ink">
              {work.panes.cannotTell} pane{work.panes.cannotTell === 1 ? "" : "s"} could not be read at this sample.
            </p>
          ) : null}
          {work.groupsDropped > 0 ? (
            <p className="tw:mt-1 tw:text-unknown-ink">
              {work.groupsDropped} additional group{work.groupsDropped === 1 ? " was" : "s were"} omitted by the checkpoint cap.
            </p>
          ) : null}
        </div>
      );
    }
  }

  return (
    <div className="tw:mt-4">
      <SectionHeading>Current expensive work</SectionHeading>
      <Card className="tw:p-3 tw:text-[13px] tw:text-ink-soft">{content}</Card>
    </div>
  );
}

/**
 * One number, large, in the colour it has earned.
 *
 * The label sits above the value rather than beside it so a tile is a fixed
 * shape whatever the number is; the sub-line under it is what the number is out
 * of, which is the half that makes "72%" mean something. The card carries the
 * threshold, so a reader who wants to know why this one is amber can ask
 * without leaving the page — and `Explain` puts the same words in the
 * accessible name, so the colour is never the only carrier. **Colour alone is
 * not information**: every tile says its number and its context in text.
 */
function StatTile({ stat }: { stat: Stat }): ReactNode {
  const tone = toneClasses(stat.tone);
  return (
    <Explain tip={stat.tip} placement="bottom" className="tw:block tw:w-full">
      <Card className={cx("tw:h-full tw:border-l-4 tw:p-3 tw:text-left", tone.edge, tone.wash)}>
        <div className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
          {stat.label}
        </div>
        <div className={cx("tw:mt-0.5 tw:text-[22px] tw:leading-tight tw:font-semibold", tone.ink)}>{stat.value}</div>
        <div className="tw:mt-0.5 tw:text-[12px] tw:break-words tw:text-ink-soft">{stat.sub}</div>
        {stat.bar === undefined ? null : <Bar bar={stat.bar} tone={stat.tone} />}
      </Card>
    </Explain>
  );
}

/**
 * How full or busy this one is, as a length.
 *
 * > if possible show something like a progress bar to indicate visually how
 * > full/busy things are
 * >
 * > — Greg, 2026-09-09
 *
 * **`aria-hidden`, and that is not an oversight.** The number above it and the
 * sub-line beside it already say everything this shape says, in words, and a
 * second announcement of the same fact is noise in a screen reader rather than
 * access. The bar is the glance; the text is the carrier. `health-view.ts`
 * refuses to build one at all when there is no number, so this never draws an
 * empty track under a dash.
 *
 * The ticks are the amber and red cutoffs, from the same constants the chart's
 * bands use — see `StatBar`. They are drawn OVER the fill, because the question
 * they answer is "how close is this to trouble", and a mark hidden under the
 * fill answers it only while the answer is 'not very'.
 */
function Bar({ bar, tone }: { bar: StatBar; tone: Stat["tone"] }): ReactNode {
  const classes = toneClasses(tone);
  return (
    <div
      aria-hidden="true"
      className="tw:relative tw:mt-2 tw:h-1.5 tw:w-full tw:overflow-hidden tw:rounded-full tw:bg-quiet-wash"
    >
      <div
        className={cx("tw:absolute tw:inset-y-0 tw:left-0 tw:rounded-full", classes.pill)}
        style={{ width: `${(bar.fill * 100).toFixed(1)}%` }}
      />
      {bar.marks.map((mark) => (
        <div
          key={mark}
          className="tw:absolute tw:inset-y-0 tw:w-px tw:bg-ink-faint"
          style={{ left: `${(mark * 100).toFixed(1)}%` }}
        />
      ))}
      {/* **CLIPPED IS NOT FULL.** A bar pinned at the end of its track looks the
          same whether the value just reached it or is four times past it, and
          load has no ceiling — so an over-run gets its own mark at the end,
          the same argument `overCeiling` makes about the chart's fixed axis. */}
      {bar.over ? (
        <div className="tw:absolute tw:inset-y-0 tw:right-0 tw:w-1 tw:bg-page">
          <div className="tw:absolute tw:inset-y-0 tw:right-0 tw:w-px tw:bg-alarm" />
        </div>
      ) : null}
    </div>
  );
}
