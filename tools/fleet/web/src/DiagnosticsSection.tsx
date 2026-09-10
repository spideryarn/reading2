/**
 * **Diagnostics**, on Box health: which revision each Overseer service
 * recorded at start, which client bundle is where, how old each of the
 * dashboard's clocks is, and what every store file looks like from outside.
 * docs/plans/260910f Stage 3; the server half is `routes-diagnostics.ts`.
 *
 * ## The wording is the contract (Sol's F1)
 *
 * A start stamp is what the checkout looked like when the process started — a
 * HEAD sha and a git status — not proof of which bytes the process loaded. So
 * a clean stamp reads **"recorded start HEAD abc12345"**, a dirty one **"code
 * revision unknown — base HEAD abc12345, checkout dirty at start"**, and
 * nothing here says a service "is running" a revision. How a stamp relates to
 * this checkout's HEAD needs git, which the page does not have; `overseer
 * diagnose` says it.
 *
 * ## Three bundle facts, kept apart (plan D3)
 *
 * The bundle this tab is running (compiled in), the bundle the server saw on
 * disk when it started, and the bundle on disk now. A difference between any
 * two that can be compared is a plain sentence saying what to do; a stamp that
 * is unknown makes its comparison "cannot compare", and is **never** drawn as
 * the same — absence reading as agreement is the one conclusion this section
 * exists to prevent.
 *
 * ## Read-only, and it says what it cannot answer
 *
 * Whether the daemon holds the job list this checkout builds needs the
 * Overseer's code, which the fleet may not import; the section names the
 * command that answers it rather than guessing. Nothing here can be pressed.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { httpDiagnosticsApi, tabBuild, type DiagnosticsApi, type DiagnosticsView } from "./diagnostics-client";
import { Card, Mono, SectionHeading } from "./ui";
import { formatDuration } from "./view";
import type {
  BuildStamp,
  BuildStampReading,
  DiagnosticsDaemonStart,
  DiagnosticsInstant,
  DiagnosticsSummary,
  StartRevision,
  StoreFileProbe,
} from "../../wire";

/** Only while mounted: nothing here changes faster than a collection. */
export const DIAGNOSTICS_POLL_MS = 60_000;

const short = (sha: string): string => sha.slice(0, 8);

/** A service's start stamp, in F1's words. */
export function startText(revision: StartRevision): string {
  if (revision.kind === "unknown") return `code revision unknown — ${revision.why}`;
  return revision.dirty ? `code revision unknown — base HEAD ${short(revision.sha)}, checkout dirty at start` : `recorded start HEAD ${short(revision.sha)}`;
}

function daemonText(start: DiagnosticsDaemonStart): string {
  switch (start.kind) {
    case "stamped":
      return startText(start.revision);
    case "not-stamped":
      return "not stamped — started before revision stamps existed";
    case "unknown":
      return `unknown — ${start.why}`;
    default: {
      const never: never = start;
      return `unknown — ${JSON.stringify(never)}`;
    }
  }
}

function bundleText(reading: BuildStampReading): string {
  if (reading.kind === "unknown") return `unknown — ${reading.why}`;
  const { stamp } = reading;
  const from =
    stamp.kind === "unknown"
      ? `code revision unknown — ${stamp.why}`
      : stamp.dirty
        ? `code revision unknown — base HEAD ${short(stamp.sha)}, checkout dirty at build`
        : `built from HEAD ${short(stamp.sha)}`;
  return `${from}, built ${stamp.builtAt}`;
}

function sameBuild(a: BuildStamp, b: BuildStamp): boolean {
  if (a.builtAt !== b.builtAt || a.kind !== b.kind) return false;
  return a.kind === "unknown" || (b.kind === "known" && a.sha === b.sha && a.dirty === b.dirty);
}

/** The comparisons between the three bundle facts, as sentences. Never "same" across an unknown. */
export function bundleVerdicts(tab: BuildStampReading, atStart: BuildStampReading, onDisk: BuildStampReading): string[] {
  const lines: string[] = [];
  const unknown = [
    ["this tab's", tab],
    ["the server's start", atStart],
    ["the on-disk", onDisk],
  ].filter(([, reading]) => (reading as BuildStampReading).kind === "unknown");
  if (unknown.length > 0) {
    lines.push(`cannot compare: ${unknown.map(([name]) => name).join(", ")} bundle stamp${unknown.length === 1 ? " is" : "s are"} unknown, which is not the same as matching`);
  }
  if (atStart.kind === "stamp" && onDisk.kind === "stamp" && !sameBuild(atStart.stamp, onDisk.stamp)) {
    lines.push(
      Date.parse(onDisk.stamp.builtAt) > Date.parse(atStart.stamp.builtAt)
        ? "a newer bundle is on disk than this server started with; reload after the dashboard restarts"
        : "the bundle on disk is not the one this server started with; reload after the dashboard restarts",
    );
  }
  if (tab.kind === "stamp" && onDisk.kind === "stamp" && !sameBuild(tab.stamp, onDisk.stamp)) {
    lines.push("this tab is running a different bundle from the one on disk; reloading this tab loads the one on disk");
  }
  if (lines.length === 0) lines.push("all three are the same build");
  return lines;
}

type Clock = { composedAt: string; elapsedMs: number };

/** How long ago `at` was: the server's own difference, advanced by how long this answer has been on the page. */
function ago(at: string, clock: Clock): string {
  const ms = Date.parse(clock.composedAt) - Date.parse(at) + clock.elapsedMs;
  return ms < 0 ? `${at}, later than the dashboard's clock` : `${formatDuration(ms)} ago`;
}

function instantText(value: DiagnosticsInstant, clock: Clock): string {
  return value.kind === "never" ? `never — ${value.why}` : ago(value.at, clock);
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5 tw:py-1">
      <dt className="tw:w-32 tw:shrink-0 tw:text-ink-faint">{label}</dt>
      <dd className="tw:min-w-0 tw:flex-1 tw:break-words tw:text-ink-soft">{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="tw:mt-3 tw:first:mt-0">
      <h3 className="tw:text-[12px] tw:font-semibold tw:text-ink">{title}</h3>
      <dl className="tw:mt-1">{children}</dl>
    </div>
  );
}

function fileCells(probe: StoreFileProbe, clock: Clock): { age: string; schema: string } {
  switch (probe.state) {
    case "absent":
      return { age: "—", schema: "absent" };
    case "unreadable":
      return { age: "—", schema: `unreadable — ${probe.why}` };
    case "present": {
      const schema =
        probe.schema === null ? `schema unknown — ${probe.schemaUnread ?? "no reason given"}` : probe.schema === "none-declared" ? "no schema declared" : `schema ${probe.schema}`;
      const torn = probe.tornTail === true ? " · torn tail (a write in progress, or one that died)" : "";
      const ms = probe.mtimeAgeMs + clock.elapsedMs;
      return { age: ms < 0 ? "in the future" : formatDuration(ms), schema: `${schema}${torn}` };
    }
    default: {
      const never: never = probe;
      return { age: "—", schema: JSON.stringify(never) };
    }
  }
}

function StoreFiles({ store, clock }: { store: DiagnosticsSummary["store"]; clock: Clock }): ReactNode {
  const path = store.path.kind === "unknown" ? `unknown — ${store.path.why}` : `${store.path.label}${store.path.kind === "default" ? ` (${store.path.path})` : ""}`;
  return (
    <div className="tw:mt-3" data-testid="diagnostics-store-files">
      <h3 className="tw:text-[12px] tw:font-semibold tw:text-ink">Store files</h3>
      <p className="tw:mt-1 tw:break-all tw:text-ink-soft">
        <Mono>{path}</Mono>
      </p>
      {store.files.kind === "unknown" ? (
        <p className="tw:mt-1 tw:text-unknown-ink">Not probed: {store.files.why}</p>
      ) : (
        <div className="tw:overflow-x-auto">
          <table className="tw:mt-1 tw:w-full tw:text-left tw:text-[12px]">
            <thead className="tw:text-ink-faint">
              <tr>
                <th className="tw:py-1 tw:pr-3 tw:font-medium">File</th>
                <th className="tw:py-1 tw:pr-3 tw:font-medium">Age</th>
                <th className="tw:py-1 tw:font-medium">Schema</th>
              </tr>
            </thead>
            <tbody>
              {store.files.files.map((probe) => {
                const cells = fileCells(probe, clock);
                return (
                  <tr key={probe.name} className="tw:border-t tw:border-rule tw:align-top">
                    <td className="tw:py-1 tw:pr-3 tw:font-mono tw:whitespace-nowrap">{probe.name}</td>
                    <td className="tw:py-1 tw:pr-3 tw:whitespace-nowrap">{cells.age}</td>
                    <td className="tw:min-w-[12rem] tw:py-1 tw:break-words tw:text-ink-soft">{cells.schema}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Summary({ summary, tab, clock }: { summary: DiagnosticsSummary; tab: BuildStampReading; clock: Clock }): ReactNode {
  const { dashboard, collector } = summary;
  return (
    <Card className="tw:p-3 tw:text-[13px]">
      <Group title="Services">
        <Row label="Dashboard">
          {startText(dashboard.start)} <Mono>({dashboard.instance})</Mono>
        </Row>
        <Row label="Daemon">{daemonText(summary.daemon)}</Row>
        <Row label="Job list">
          whether the daemon holds this checkout's job list: run <code className="tw:font-mono">overseer diagnose</code>
        </Row>
      </Group>
      <p className="tw:px-0 tw:text-[12px] tw:text-ink-faint">
        A start HEAD is what the checkout was when the process started, not proof of the code it loaded.
      </p>

      <Group title="Client bundle">
        <Row label="This tab">{bundleText(tab)}</Row>
        <Row label="Server started with">{bundleText(dashboard.bundleAtStart)}</Row>
        <Row label="On disk now">{bundleText(dashboard.bundleOnDisk)}</Row>
      </Group>
      <ul className="tw:mt-1 tw:space-y-0.5 tw:text-ink">
        {bundleVerdicts(tab, dashboard.bundleAtStart, dashboard.bundleOnDisk).map((line) => (
          <li key={line} className="tw:break-words">
            {line}
          </li>
        ))}
      </ul>

      <Group title="Clocks">
        <Row label="Collection started">{instantText(collector.attempted, clock)}</Row>
        <Row label="Snapshot collected">{instantText(collector.collected, clock)}</Row>
        <Row label="Last error">{collector.lastError.kind === "none" ? "none recorded" : collector.lastError.message}</Row>
        <Row label="Health reading">{instantText(summary.health, clock)}</Row>
      </Group>

      <StoreFiles store={summary.store} clock={clock} />
    </Card>
  );
}

type Held = { view: DiagnosticsView | { kind: "loading" }; receivedAtMs: number };

export function DiagnosticsSection({
  api = httpDiagnosticsApi,
  nowMs,
  tab = tabBuild(),
}: {
  api?: DiagnosticsApi;
  /** The page's ticking clock, so ages keep moving between answers. */
  nowMs: number;
  /** The bundle this tab runs. Injected in tests, where `__FLEET_BUILD__` is not compiled in. */
  tab?: BuildStampReading;
}): ReactNode {
  const [held, setHeld] = useState<Held>({ view: { kind: "loading" }, receivedAtMs: 0 });
  const pageClock = useRef(nowMs);
  useEffect(() => {
    pageClock.current = nowMs;
  }, [nowMs]);

  useEffect(() => {
    let current: AbortController | null = null;
    let live = true;
    const load = (): void => {
      current?.abort();
      const request = new AbortController();
      current = request;
      void api.fetch(request.signal).then((next) => {
        if (live && !request.signal.aborted) setHeld({ view: next, receivedAtMs: pageClock.current });
      });
    };
    load();
    const timer = setInterval(load, DIAGNOSTICS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      current?.abort();
    };
  }, [api]);

  const { view } = held;
  let body: ReactNode;
  if (view.kind === "loading") {
    body = <Card className="tw:p-3 tw:text-[13px] tw:text-ink-faint">Asking the dashboard…</Card>;
  } else if (view.kind === "no-answer") {
    body = <Card className="tw:border-l-4 tw:border-l-unknown tw:p-3 tw:text-[13px] tw:text-ink-soft">No diagnostics: {view.why}</Card>;
  } else {
    body = <Summary summary={view.summary} tab={tab} clock={{ composedAt: view.summary.composedAt, elapsedMs: Math.max(0, nowMs - held.receivedAtMs) }} />;
  }

  return (
    <section aria-label="Diagnostics" data-testid="diagnostics-section" className="tw:mt-4">
      <SectionHeading>Diagnostics</SectionHeading>
      {body}
    </section>
  );
}
