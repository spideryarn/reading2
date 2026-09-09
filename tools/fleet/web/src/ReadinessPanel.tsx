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

/**
 * **The mark colours, which are NOT `toneClasses(...).pill`.**
 *
 * That was the first version and it was wrong in a way a screenshot showed and
 * no test could: `idle.pill` is `bg-quiet-wash`, a near-white **chip
 * background** meant to sit behind dark text. Rendered as a 2px bar it came out
 * at RGB(239,239,239) on a white track — about 6% luminance difference, which a
 * browser subagent could only find by sampling pixels. So the most important
 * mark on the page, *a passing run on dev*, was the least visible thing on it.
 *
 * These are the solid tokens instead. A chip and a mark are different visual
 * roles and the design system has both; reaching for the one already imported
 * is how they got confused.
 */
const MARK_COLOUR: Record<ReadingView["state"], string> = {
  /**
   * **Green is `pass`, and `running` is not green.**
   *
   * The first version took the dashboard's own vocabulary literally: `quiet` for
   * a pass (nothing needs you) and `work` for a run in progress. But `--work` IS
   * green, so an `unknown` panel could be full of green marks that anybody
   * without a mouse would read as passing runs, while the actual passes were
   * achromatic grey. On a phone there is no hover to correct the impression.
   *
   * So this band departs from the session vocabulary deliberately: on a
   * pass/fail chart, green means passed, because that is what green means
   * everywhere else a person has ever looked at one. `running` gets a SHAPE
   * instead — a hollow outline, which reads as in-progress without competing
   * for the pass colour.
   */
  pass: "tw:bg-work",
  fail: "tw:bg-alarm",
  void: "tw:bg-unknown",
  running: "tw:bg-transparent tw:border tw:border-ink-faint",
};

/** Worse states win their pixel, so a failure is never hidden behind a pass. */
const MARK_LAYER: Record<ReadingView["state"], number> = { pass: 1, running: 2, void: 3, fail: 4 };

/**
 * How close two marks have to be before they are one mark, as a percentage of
 * the band.
 *
 * A 2px mark on a ~200px band is about 1% of it, so anything nearer than that
 * would overlap on screen — and an overlap that is not merged is a run drawn on
 * top of another run, silently.
 */
const MERGE_PCT = 1;


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
  /* Only a log reconstruction is `nosha`. A WRAPPER run whose tree we cannot
     read is `other` — it is a real run about something, and labelling it
     "reconstructed from a log" was simply false. */
  /* **`nosha` is for a log reconstruction and nothing else.** Adding the
     client's third `source` arm re-opened the mislabelling it was added to
     close: `!== "wrapper"` swept `unknown` in here too, and the tooltip would
     have called a run from some future source "reconstructed from a log", which
     is a specific claim about where it came from and would be a guess. */
  if (reading.source === "tmux-log") return "nosha";
  if (reading.source !== "wrapper") return "other";
  if (reading.scope !== "full") return "other";
  if (devSha === null) return "other";
  const { treeAtStart, treeAtEnd } = reading;
  if (treeAtStart.kind !== "known") return "other";
  if (treeAtStart.sha !== devSha || treeAtStart.dirty) return "other";
  /**
   * **Both ends, and clean at both** — the same clauses `canVote` applies on the
   * server. Reading only the start let a run whose checkout moved or went dirty
   * mid-way wear the "this one counts" treatment while the verdict correctly
   * refused it, so the picture and the headline disagreed.
   *
   * A run still going has no end stamp: it cannot count yet, and `other` is
   * what it is until it does.
   */
  if (treeAtEnd.kind !== "known") return "other";
  if (treeAtEnd.sha !== treeAtStart.sha || treeAtEnd.dirty) return "other";
  return "dev";
}

/** One drawn mark: the worst reading in its pixel, and how many it stands for. */
type Bucket = {
  reading: ReadingView;
  left: number;
  /** How many other runs landed on the same pixel and are not drawn. */
  hidden: number;
  provenance: "dev" | "other" | "nosha";
};

/**
 * Group readings by the pixel they land on, keeping the worst.
 *
 * **Exported for its test.** The rule it enforces is the one the reducer needed
 * on the server: when two things want the same place, the bad news wins. Drawing
 * order is not evidence about anything.
 *
 * A `dev` mark beats a non-`dev` one at equal severity, because the ringed
 * treatment is the more informative of the two and losing it hides the run that
 * actually counts.
 */
export function bucketMarks(
  readings: readonly ReadingView[],
  fromMs: number,
  span: number,
  devSha: string | null,
): Bucket[] {
  const placed = readings
    .map((reading) => ({
      reading,
      left: Math.min(100, Math.max(0, ((reading.atMs - fromMs) / span) * 100)),
      provenance: provenanceOf(reading, devSha),
    }))
    .sort((a, b) => a.left - b.left);

  const out: Bucket[] = [];
  for (const item of placed) {
    const open = out[out.length - 1];
    /* **A greedy walk over sorted marks, not a rounded slot.** Slotting by
       `Math.round(left / step)` was the first attempt and it does not do what it
       looks like: two marks 0.35% apart straddled a boundary and were drawn
       separately, while the whole point is that anything closer than a mark's
       width must merge. Walking in order and comparing to the group's own
       position has no boundaries to straddle. */
    if (open === undefined || item.left - open.left >= MERGE_PCT) {
      out.push({ reading: item.reading, left: item.left, hidden: 0, provenance: item.provenance });
      continue;
    }
    const worse =
      MARK_LAYER[item.reading.state] > MARK_LAYER[open.reading.state] ||
      (MARK_LAYER[item.reading.state] === MARK_LAYER[open.reading.state] &&
        item.provenance === "dev" &&
        open.provenance !== "dev");
    out[out.length - 1] = worse
      ? { reading: item.reading, left: open.left, hidden: open.hidden + 1, provenance: item.provenance }
      : { ...open, hidden: open.hidden + 1 };
  }
  return out;
}

/**
 * A day of one check, as marks at instants.
 *
 * **Not a line, and not a filled span.** Each mark sits where its run finished
 * and says nothing about the time either side of it; the gaps are gaps because
 * nothing was observed there.
 *
 * Provenance is height plus a ring: a full-height ringed bar is a run that
 * counts, a half-height one is history. Not opacity — that was the first
 * attempt and it traded away the one property a mark must have.
 *
 * ## Two runs can want the same pixel
 *
 * A 2px mark on a ~200px day is about fifteen minutes wide, so runs closer
 * together than that overlap — and with plain DOM order **a later pass paints
 * over an earlier failure**, which is the reducer's same-millisecond tie bug
 * wearing a coat of CSS. So marks are bucketed by the pixel they land on and
 * the WORST state in each bucket is the one drawn, with the count carried into
 * the tooltip. GPT Sol, Stage 2 review.
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
  const buckets = bucketMarks(readings, fromMs, span, devSha);
  return (
    /* **The empty track is drawn**, faintly. A day on which nothing ran is a
       real answer and it should look like an empty shelf, not like a row that
       failed to render — which is what a transparent band gave. */
    <div className="tw:relative tw:h-5 tw:w-full tw:rounded tw:border tw:border-rule tw:bg-hover/60">
      {buckets.map(({ reading, left, hidden, provenance }) => {
        return (
          <span
            key={`${reading.check}-${reading.runId}`}
            className={cx(
              /* **Two pixels, not one.** A 24-hour band is about 200px on a
                 phone, and a 1px mark was invisible in the first screenshot — a
                 graph that draws its data where nobody can see it is the same as
                 not drawing it. */
              "tw:absolute tw:w-0.5 tw:min-w-[2px] tw:rounded-sm",
              MARK_COLOUR[reading.state],
              /* **Provenance is HEIGHT, not opacity.** Fading was the first
                 attempt and it traded away the one thing a mark must have. A
                 full-height ringed bar is a run that counts; a half-height one
                 is history — unmistakably different, at full colour, so no mark
                 has to be hunted for. */
              provenance === "dev"
                ? "tw:top-0.5 tw:h-4 tw:ring-1 tw:ring-ink-faint"
                : "tw:top-1.5 tw:h-2",
            )}
            style={{ left: `${left}%` }}
            title={`${formatTime(reading.atMs)} · ${reading.state}${
              provenance === "dev"
                ? " · on dev"
                : provenance === "nosha"
                  ? " · reconstructed from a log, no commit"
                  : " · another commit, a dirty tree, or a narrowed run"
            }${reading.durationMs === null ? "" : ` · ${describeDuration(reading.durationMs)}`}${
              hidden === 0 ? "" : ` · and ${hidden} other run${hidden === 1 ? "" : "s"} at this minute`
            }`}
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

  /**
   * **It polls, and the first version did not.**
   *
   * This ran on mount and on Refresh only, and `refreshMs` was parsed and never
   * used — so a page left open on a phone, which is what this dashboard is for,
   * would say *dev is green* indefinitely while dev moved and a check failed
   * underneath it. GPT Sol, Stage 2 review.
   *
   * The interval comes from the server rather than a constant here, because the
   * server is the thing that knows how often it recollects; polling faster than
   * that fetches the same snapshot repeatedly, and slower shows a stale one for
   * no reason. It is clamped because a bad number from a future build must not
   * turn this into a busy loop.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal.
  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.fetch().then((next) => {
        if (live) setView(next);
      });
    };
    load();
    const everyMs = Math.min(
      10 * 60_000,
      Math.max(15_000, view?.kind === "readiness" ? view.refreshMs : 120_000),
    );
    const timer = setInterval(load, everyMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
    /* `view?.refreshMs` deliberately NOT in the deps: it would tear down and
       rebuild the interval on every successful poll, which is a slow leak of
       timers and a drifting cadence. The first answer's interval is good enough
       for the life of the mount. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* **Through the skew, like every other timestamp on this page.** Subtracting a
     server stamp from the browser clock directly makes a phone that is behind
     the server clamp the age to zero — concealing exactly the staleness this
     number exists to reveal. `shiftMsToBrowserClock` is the shared correction. */
  const ageMin = Math.max(0, Math.round((nowMs - shiftMsToBrowserClock(view.collectedAtMs, skew)) / 60_000));

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
            Marks are runs, not coverage. Tall ringed marks are full runs on this commit — the only ones that count; short ones are history.
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
