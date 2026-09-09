/**
 * **Readiness: whether dev is green, and the day behind that answer.**
 *
 * > add a tab for "Readiness" that shows information about the latest tests and
 * > type-checking (on dev, when last run, able to trigger/refresh) and anything
 * > else you can think of. Ideally shows graphs of 24h history
 * >
 * > — Greg, 2026-09-08
 *
 * docs/plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md,
 * and its § 5 is what the headline here renders. Read that before changing the
 * headline: five review rounds went into deciding when this page is allowed to
 * say the word *ready*, and every one of them found a way it could have said it
 * about a tree that was not.
 *
 * ## Three things this panel refuses to do
 *
 * **It never turns `unknown` into a colour that reads as fine.** Unknown is the
 * common answer on this box and it has its own tone, its own sentence, and the
 * clause that failed named in it. A page that says *unknown — typecheck has no
 * reading on this commit* is useful; one that shows a grey tick is not.
 *
 * **It never draws a reading as coverage.** The bands are marks at instants,
 * not spans: extending a pass rightwards to the next run would paint hours
 * nobody observed in green, which is the same lie as a blank chart over a dead
 * box.
 *
 * **It separates the three provenances visually.** A run on somebody's branch,
 * and a run reconstructed from a log with no commit at all, are drawn
 * differently from a wrapper run on dev — because a branch's green mark sitting
 * between two red ones reads as a recovery that never happened.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import { httpReadinessApi, type ReadinessApi } from "./readiness-client";
import type {
  DiagnosticsView,
  EvidenceView,
  ReadingView,
  ReadinessView,
  VerdictView,
} from "./readiness-client";
import { shiftMsToBrowserClock, type ClockSkew } from "./types";
import { Card, Pill, SectionHeading, cx, toneClasses } from "./ui";
import type { Tone } from "./view";

/** The checks that get a row, in the order a person asks about them. */
const ROWS = ["test", "typecheck", "check", "lint", "build"] as const;

const STATE_TONE: Record<ReadingView["state"], Tone> = {
  pass: "idle",
  fail: "alarm",
  void: "unknown",
  running: "work",
};

const VERDICT_TONE: Record<VerdictView["kind"], Tone> = {
  ready: "idle",
  "not-ready": "alarm",
  unknown: "unknown",
};

const VERDICT_WORD: Record<VerdictView["kind"], string> = {
  ready: "dev is green",
  "not-ready": "dev is not green",
  unknown: "we do not know",
};

const HEADLINE_TIP: Tip = {
  head: "What “green” means here",
  what: "Every required check passed on the commit origin/dev is on right now — the same commit, both ends of each run, and a clean tree at both.",
  how: "It is a claim about this box's CACHED origin/dev; when that was last checked against the remote is not knowable from the ref, so it is never a claim about what is on GitHub now.",
};

const PROVENANCE_TIP: Tip = {
  head: "Why some runs do not count",
  what: "Only a full-scope run recorded by readiness-run.ts, on this exact commit, with a clean tree at both ends, can make the answer green.",
  how: "Runs reconstructed from tmux logs carry no commit at all — nothing writes one into the log — so they are history, and history never votes.",
};

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

function describeDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.round(ms / 6000) / 10}m`;
}

/**
 * How a reading is allowed to look.
 *
 * `dev` — a wrapper run at full scope on the commit dev is on. The only kind
 * that can make the headline green.
 * `other` — a real run, but about another commit, a narrower command, or
 * somebody's branch.
 * `nosha` — reconstructed from a log, so about no commit anybody can name.
 */
function provenanceOf(reading: ReadingView, devSha: string | null): "dev" | "other" | "nosha" {
  if (reading.source !== "wrapper") return "nosha";
  if (reading.tree.kind !== "known") return "nosha";
  if (reading.scope !== "full") return "other";
  if (devSha === null || reading.tree.sha !== devSha) return "other";
  return "dev";
}

/**
 * A day of one check, as marks at instants.
 *
 * **Not a line, and not a filled span.** Each mark sits where its run finished
 * and says nothing about the time either side of it; the gaps are gaps because
 * nothing was observed there. Provenance is carried by opacity and by a ring on
 * the ones that count, so a branch's green mark cannot be mistaken for dev
 * recovering.
 */
function DayBand({
  readings,
  fromMs,
  toMs,
  devSha,
  formatTime,
}: {
  readings: ReadingView[];
  fromMs: number;
  toMs: number;
  devSha: string | null;
  formatTime: (ms: number) => string;
}): ReactNode {
  const span = Math.max(1, toMs - fromMs);
  return (
    /* **The empty track is drawn**, faintly. A day on which nothing ran is a
       real answer and it should look like an empty shelf, not like a row that
       failed to render — which is what a transparent band gave. */
    <div className="tw:relative tw:h-5 tw:w-full tw:rounded tw:border tw:border-rule tw:bg-hover/60">
      {readings.map((reading) => {
        const left = Math.min(100, Math.max(0, ((reading.atMs - fromMs) / span) * 100));
        const provenance = provenanceOf(reading, devSha);
        const tone = toneClasses(STATE_TONE[reading.state]);
        return (
          <span
            key={`${reading.atMs}-${reading.check}-${reading.source}-${reading.commandLine ?? ""}`}
            className={cx(
              /* **Two pixels, not one.** A 24-hour band is about 200px on a
                 phone, and a 1px mark at 45% opacity was invisible in the first
                 screenshot — a graph that draws its data where nobody can see it
                 is the same as not drawing it. */
              "tw:absolute tw:top-0.5 tw:h-4 tw:w-0.5 tw:min-w-[2px] tw:rounded-sm",
              tone.pill,
              /* The two weaker provenances recede — they are history, and the
                 eye should not read them as the answer — but they stay legible.
                 Receding is not disappearing. */
              provenance === "dev" ? "tw:opacity-100 tw:ring-1 tw:ring-ink-faint" : "tw:opacity-70",
            )}
            style={{ left: `${left}%` }}
            title={`${formatTime(reading.atMs)} · ${reading.state}${
              provenance === "dev"
                ? " · on dev"
                : provenance === "nosha"
                  ? " · reconstructed from a log, no commit"
                  : " · another commit or a narrowed run"
            }${reading.durationMs === null ? "" : ` · ${describeDuration(reading.durationMs)}`}`}
          />
        );
      })}
    </div>
  );
}

function EvidenceLine({ item }: { item: EvidenceView }): ReactNode {
  const tone = toneClasses(
    item.state === "pass" ? "idle" : item.state === "fail" ? "alarm" : item.state === "running" ? "work" : "unknown",
  );
  return (
    <li className="tw:flex tw:gap-2 tw:py-0.5 tw:text-[12px]">
      <span className={cx("tw:mt-1.5 tw:h-1.5 tw:w-1.5 tw:shrink-0 tw:rounded-full", tone.pill)} />
      <span className="tw:text-ink-faint">
        <span className="tw:text-ink">{item.check}</span> — {item.why}
      </span>
    </li>
  );
}

/**
 * Everything the answer could not see.
 *
 * **Shown whether or not anything is wrong**, because a page that only
 * mentioned a truncated scan when it broke has no way to say "and it is fine",
 * and a quietly incomplete answer is worse than a loudly incomplete one.
 */
function Diagnostics({ d }: { d: DiagnosticsView }): ReactNode {
  const notes: string[] = [];
  if (d.storeRefused !== null) notes.push(`nothing is being recorded: ${d.storeRefused}`);
  if (d.unreadableRecords > 0) notes.push(`${d.unreadableRecords} record(s) could not be read`);
  if (d.unreadableLogs > 0) notes.push(`${d.unreadableLogs} log(s) looked like checks and would not parse`);
  for (const root of d.unreadableRoots) notes.push(`could not list ${root.root}: ${root.why}`);
  if (d.scanTruncated) notes.push("a log directory held more than the scan looks at, so the day may be incomplete");
  if (d.rootsTruncated) notes.push("there are more checkouts than the scan looks at");
  if (d.logsSkippedForBudget > 0) notes.push(`${d.logsSkippedForBudget} log(s) were not read, oldest first`);
  if (d.tmuxWhy !== null) notes.push(`whether a quiet run is still going is a guess: ${d.tmuxWhy}`);

  return (
    <p className="tw:px-1 tw:pt-2 tw:text-[11px] tw:text-ink-faint">
      {notes.length === 0
        ? `Scanned ${d.checkoutsScanned} checkout${d.checkoutsScanned === 1 ? "" : "s"}; nothing was unreadable or skipped.`
        : notes.join(" · ")}
    </p>
  );
}

export function ReadinessPanel({
  api = httpReadinessApi,
  nowMs,
  skew,
  refreshNonce = 0,
}: {
  /** Injected so a test can drive the panel without a network. */
  api?: ReadinessApi;
  nowMs: number;
  skew: ClockSkew;
  /** Bumped by the Dock's Refresh button. */
  refreshNonce?: number;
}): ReactNode {
  const [view, setView] = useState<ReadinessView | null>(null);

  /* `refreshNonce` is in the dependency list for its effect on identity alone —
     it changes when somebody presses Refresh, and re-running is the point. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal.
  useEffect(() => {
    let live = true;
    void api.fetch().then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [api, refreshNonce]);

  const formatTime = (ms: number): string =>
    new Date(shiftMsToBrowserClock(ms, skew)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (view === null) {
    return (
      <Card className="tw:p-4 tw:text-[13px] tw:text-ink-faint">
        Asking the box whether dev is green…
      </Card>
    );
  }

  if (view.kind === "unavailable") {
    /* **Not an empty page.** "We could not get an answer" and "the answer is
       that nothing has run" are different facts, and drawn the same they become
       one claim — the wrong one. */
    return (
      <Card className="tw:p-4">
        <div className="tw:text-[13px] tw:font-semibold tw:text-ink">No readiness answer</div>
        <p className="tw:pt-1 tw:text-[12px] tw:text-ink-faint">{view.why}</p>
      </Card>
    );
  }

  const devSha = view.dev.kind === "known" ? view.dev.devSha : null;
  const verdictTone = toneClasses(VERDICT_TONE[view.verdict.kind]);
  const fromMs = view.collectedAtMs - view.windowHours * 60 * 60 * 1000;
  const byCheck = new Map<string, ReadingView[]>();
  for (const reading of view.readings) {
    const held = byCheck.get(reading.check);
    if (held === undefined) byCheck.set(reading.check, [reading]);
    else held.push(reading);
  }

  const ageMin = Math.max(0, Math.round((nowMs - view.collectedAtMs) / 60_000));

  return (
    <div className="tw:flex tw:flex-col tw:gap-1">
      <Card className={cx("tw:border-l-4 tw:p-4", verdictTone.edge, verdictTone.wash)}>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Explain tip={HEADLINE_TIP}>
            <span className={cx("tw:text-[15px] tw:font-semibold", verdictTone.ink)}>
              {VERDICT_WORD[view.verdict.kind]}
            </span>
          </Explain>
          {view.verdict.sha === null ? null : <Pill tone="unknown">{shortSha(view.verdict.sha)}</Pill>}
          <span className="tw:text-[11px] tw:text-ink-faint">
            as of {formatTime(view.collectedAtMs)}
            {ageMin > 0 ? `, ${ageMin} min ago` : ""}
          </span>
        </div>

        {view.verdict.kind === "unknown" ? (
          <p className="tw:pt-2 tw:text-[12px] tw:text-ink-faint">{view.verdict.why}</p>
        ) : null}

        {view.verdict.evidence.length > 0 ? (
          <ul className="tw:pt-2">
            {view.verdict.evidence.map((item) => (
              <EvidenceLine key={`${item.check}-${item.state}`} item={item} />
            ))}
          </ul>
        ) : null}

        {view.verdict.kind === "unknown" ? null : (
          <p className="tw:pt-2 tw:text-[11px] tw:text-ink-faint">{view.verdict.caveat}</p>
        )}
      </Card>

      <SectionHeading>The last day</SectionHeading>
      <Card className="tw:p-3">
        <Explain tip={PROVENANCE_TIP}>
          <span className="tw:text-[11px] tw:text-ink-faint">
            Marks are runs, not coverage. Ringed marks are full runs on this commit — the only ones that count.
          </span>
        </Explain>
        <div className="tw:flex tw:flex-col tw:gap-2 tw:pt-3">
          {ROWS.map((check) => {
            const readings = byCheck.get(check) ?? [];
            const latest = readings[readings.length - 1];
            return (
              <div key={check} className="tw:flex tw:items-center tw:gap-2">
                <span className="tw:w-16 tw:shrink-0 tw:text-[11px] tw:text-ink-faint">{check}</span>
                <div className="tw:min-w-0 tw:flex-1">
                  <DayBand
                    readings={readings}
                    fromMs={fromMs}
                    toMs={view.collectedAtMs}
                    devSha={devSha}
                    formatTime={formatTime}
                  />
                </div>
                <span className="tw:w-28 tw:shrink-0 tw:text-right tw:text-[11px] tw:text-ink-faint">
                  {latest === undefined
                    ? "nothing ran"
                    : `${latest.state} ${formatTime(latest.atMs)}${
                        latest.durationMs === null ? "" : ` · ${describeDuration(latest.durationMs)}`
                      }`}
                </span>
              </div>
            );
          })}
        </div>
        {/* **The left edge says "24h ago", not a clock time.** Both ends of a
            24-hour window fall at the same hour and minute, so two
            `toLocaleTimeString` labels read `05:43` and `05:43` — a window that
            looks zero-width. Caught by looking at the first screenshot; no test
            would have. */}
        <div className="tw:flex tw:justify-between tw:pt-2 tw:text-[10px] tw:text-ink-faint">
          <span>{view.windowHours}h ago · {formatTime(fromMs)}</span>
          <span>now · {formatTime(view.collectedAtMs)}</span>
        </div>
      </Card>

      <SectionHeading>The tree</SectionHeading>
      <Card className="tw:p-3 tw:text-[12px]">
        {view.dev.kind === "unknown" ? (
          <p className="tw:text-ink-faint">git could not say what dev is: {view.dev.why}</p>
        ) : (
          <dl className="tw:flex tw:flex-col tw:gap-1">
            <div className="tw:flex tw:gap-2">
              <dt className="tw:w-32 tw:shrink-0 tw:text-ink-faint">origin/dev</dt>
              <dd className="tw:text-ink">{shortSha(view.dev.devSha)}</dd>
            </div>
            <div className="tw:flex tw:gap-2">
              <dt className="tw:w-32 tw:shrink-0 tw:text-ink-faint">this checkout</dt>
              <dd className="tw:text-ink">
                {view.dev.primarySha === null ? "unknown" : shortSha(view.dev.primarySha)}
                {view.dev.primaryBehind === null
                  ? ""
                  : view.dev.primaryBehind === 0
                    ? " · up to date"
                    : ` · ${view.dev.primaryBehind} behind`}
              </dd>
            </div>
            <div className="tw:flex tw:gap-2">
              <dt className="tw:w-32 tw:shrink-0 tw:text-ink-faint">dev → main</dt>
              <dd className="tw:text-ink">
                {view.dev.trunkGap === null
                  ? "unknown"
                  : `${view.dev.trunkGap} commit${view.dev.trunkGap === 1 ? "" : "s"} not deployed`}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Diagnostics d={view.diagnostics} />
    </div>
  );
}
