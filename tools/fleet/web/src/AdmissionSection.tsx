import { useEffect, useState, type ReactNode } from "react";

import {
  ADMISSION_CENSUS_CADENCE_MS,
  ADMISSION_REQUEST_TIMEOUT_MS,
} from "../../admission-constants";
import {
  DATE_LIMIT_MS,
  type AdmissionApi,
  type AdmissionCensusCountsView,
  type AdmissionCensusView,
  type AdmissionJournalView,
  type AdmissionView,
} from "./admission-client";
import { shiftMsToBrowserClock, type ClockSkew } from "./types";
import { Card, Pill, SectionHeading } from "./ui";

/**
 * Memory, in the unit the gate's own message uses.
 *
 * `vitest-admission.ts` formats these two figures as `(n / 1024 ** 3).toFixed(2)`
 * followed by " GB", and a reader may see this forecast and that refusal text
 * next to each other, so the two must agree. Raw bytes were what shipped first
 * and a browser at 390 px was what caught it — "available memory
 * 20,733,063,168 bytes" is not a number anybody reads on a phone, and no other
 * figure on Box health is written like that. `health.ts` carries the scar that
 * makes this worth a comment rather than a silent edit: it once drew
 * "10298 GiB of 31337 GiB" on a 32 GB box, and every reading there now names
 * its unit for that reason.
 */
function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function forecastTime(ms: number | null, skew: ClockSkew): string | null {
  if (ms === null || !Number.isFinite(ms) || Math.abs(ms) > DATE_LIMIT_MS) return null;
  const corrected = shiftMsToBrowserClock(ms, skew);
  if (!Number.isFinite(corrected) || Math.abs(corrected) > DATE_LIMIT_MS) return null;
  return new Date(corrected).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
}

function Outcome({ view }: { view: Exclude<AdmissionView, { kind: "no-answer" }> }): ReactNode {
  if (view.label === "not-modelled") {
    return (
      <p className="tw:text-[13px] tw:text-ink-soft">
        We have no cost model for {view.requestKind} work, so this forecast has no answer to give. {view.outcome.why}.
      </p>
    );
  }

  const outcome = view.outcome;
  if (outcome.kind === "would-admit" || outcome.kind === "would-reduce") {
    return (
      <div className="tw:space-y-2 tw:text-[13px] tw:text-ink-soft">
        <p>
          For the machine-default request of {outcome.nominalWorkers} workers, the gate would admit the test run. The
          config would ask Vitest for {outcome.workers} workers{outcome.kind === "would-reduce" ? " instead" : ""}.
        </p>
        <p>
          Gate figures: capacity {outcome.capacity} workers; available memory {gb(outcome.availableBytes)};
          reserve {gb(outcome.reserveBytes)}.
        </p>
        <p className="tw:text-ink-faint">{outcome.caveat}</p>
      </div>
    );
  }
  if (outcome.kind === "would-refuse") {
    return (
      <div className="tw:space-y-2 tw:text-[13px] tw:text-ink-soft">
        <p>The gate would refuse a test run on this reading.</p>
        <p className="tw:text-ink-faint">
          Raw output from the dashboard's forecast call — its imperative wording and pid belong to that call:
        </p>
        <pre className="tw:overflow-x-auto tw:whitespace-pre-wrap tw:break-words tw:font-mono tw:text-[12px]">
          {outcome.forecastCallMessage}
        </pre>
      </div>
    );
  }
  if (outcome.kind === "not-applicable") {
    return <p className="tw:text-[13px] tw:text-ink-soft">The machine has no admission policy: {outcome.why}.</p>;
  }
  return <p className="tw:text-[13px] tw:text-ink-soft">The server could not ask its own gate: {outcome.why}.</p>;
}

function policy(view: Exclude<AdmissionView, { kind: "no-answer" }>): ReactNode {
  if (view.label !== "forecast") return null;
  if (view.policy.explanation === null) {
    return (
      <p className="tw:mt-2 tw:text-[12px] tw:text-unknown-ink">
        Policy explanation unavailable — {view.policy.whyWithheld}.
      </p>
    );
  }
  return (
    <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
      {view.policy.explanation}
    </p>
  );
}

function Journal({ journal, skew }: { journal: AdmissionJournalView; skew: ClockSkew }): ReactNode {
  let contents: ReactNode;
  if (journal.kind === "directory-absent") {
    contents = <p>The refusal journal directory does not exist, so there is no record to read.</p>;
  } else if (journal.kind === "unreadable") {
    contents = <p>The refusal journal could not be read: {journal.why}.</p>;
  } else if (journal.entries.length === 0 && journal.unparseableLines === 0) {
    contents = <p>The journal is readable, but nothing was recorded.</p>;
  } else if (journal.entries.length === 0) {
    contents = <p>No readable refusal entries were found.</p>;
  } else {
    contents = (
      <ol className="tw:space-y-1 tw:pl-5">
        {journal.entries.map((entry) => (
          <li key={JSON.stringify(entry)}>
            {forecastTime(Date.parse(entry.at), skew) ?? "Recorded at an unreadable time"} — {entry.source.replace("-", " ")} on {entry.host}, pid {entry.pid}, policy v
            {entry.policyVersion}; available {entry.availableBytes === null ? "unreadable" : gb(entry.availableBytes)},
            reserve {entry.reserveBytes === null ? "not configured" : gb(entry.reserveBytes)}.
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div data-admission-journal className="tw:mt-4 tw:border-t tw:border-rule tw:pt-3 tw:text-[12px] tw:text-ink-faint">
      <p className="tw:mb-2 tw:font-medium tw:text-ink-soft">Recorded admission refusals</p>
      {contents}
      {journal.kind === "read" && journal.unparseableLines > 0 ? (
        <p className="tw:mt-2 tw:text-unknown-ink">
          {journal.unparseableLines} {journal.unparseableLines === 1 ? "line could" : "lines could"} not be parsed.
        </p>
      ) : null}
      <p className="tw:mt-2">
        This best-effort journal sees refusals from test runs using this repo's Vitest config on this machine and from
        the readiness loop, and nothing else. It cannot see another machine, a run that bypassed the config, or an
        append that failed. Only a bounded number of the newest records are kept; older entries are discarded.
      </p>
    </div>
  );
}

function SignalLabel({ label }: { label: "forecast" | "not-modelled" }): ReactNode {
  if (label === "not-modelled") {
    return <span data-admission-label><Pill tone="unknown">{label}</Pill></span>;
  }
  return (
    <span
      data-admission-label
      className="tw:inline-flex tw:shrink-0 tw:items-center tw:rounded-full tw:border tw:border-rule-strong tw:bg-panel-raised tw:px-2 tw:py-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-soft tw:uppercase tw:whitespace-nowrap"
    >
      {label}
    </span>
  );
}

function ObservedLabel(): ReactNode {
  return (
    <span
      data-admission-census-label
      className="tw:inline-flex tw:shrink-0 tw:items-center tw:rounded-full tw:border tw:border-rule-strong tw:bg-panel-raised tw:px-2 tw:py-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-soft tw:uppercase tw:whitespace-nowrap"
    >
      observed
    </span>
  );
}

type CensusClassCopy = { singular: string; plural: string };

function CensusClassCounts({
  counts,
  copy,
  qualifiedZero,
}: {
  counts: { roots: number; uncertain: number };
  copy: CensusClassCopy;
  qualifiedZero: boolean;
}): ReactNode {
  const roots = counts.roots === 0
    ? qualifiedZero
      ? `No recognised ${copy.plural} roots were confirmed; the gaps described below mean this is not a clean zero.`
      : `No recognised ${copy.plural} roots were observed.`
    : `${counts.roots} recognised ${counts.roots === 1 ? copy.singular : copy.plural} ${counts.roots === 1 ? "root" : "roots"}.`;
  const uncertain = counts.uncertain === 0
    ? qualifiedZero
      ? `Among the rows stable enough to classify, no ${copy.plural} candidates had unsettled ancestry; the gaps described below mean this is not a clean zero.`
      : `No ${copy.plural} candidates had unsettled ancestry.`
    : `${counts.uncertain} ${counts.uncertain === 1 ? copy.singular : copy.plural} ${counts.uncertain === 1 ? "candidate had" : "candidates had"} unsettled ancestry.`;
  return <li>{roots} {uncertain}</li>;
}

function CensusCounts({ census }: { census: AdmissionCensusCountsView }): ReactNode {
  const qualifiedZero = census.changedUnderRead > 0 || census.unreadable > 0;
  return (
    <div className="tw:space-y-2">
      <ul className="tw:space-y-1 tw:pl-5">
        <CensusClassCounts counts={census.byClass.test} copy={{ singular: "Vitest", plural: "Vitest" }} qualifiedZero={qualifiedZero} />
        <CensusClassCounts counts={census.byClass["codex-batch"]} copy={{ singular: "Codex batch", plural: "Codex batch" }} qualifiedZero={qualifiedZero} />
        <CensusClassCounts counts={census.byClass.browser} copy={{ singular: "browser", plural: "browser" }} qualifiedZero={qualifiedZero} />
      </ul>
      <p>
        {census.changedUnderRead === 0
          ? "No rows changed while they were read; changed rows would be in no count above."
          : `${census.changedUnderRead} ${census.changedUnderRead === 1 ? "row changed" : "rows changed"} while ${census.changedUnderRead === 1 ? "it was" : "they were"} read and ${census.changedUnderRead === 1 ? "is" : "are"} in no count above.`}
      </p>
      <p>
        {census.unreadable === 0
          ? "No process rows were unreadable; unreadable rows would be in no count above."
          : `${census.unreadable} process ${census.unreadable === 1 ? "row" : "rows"} could not be read and ${census.unreadable === 1 ? "is" : "are"} in no count above.`}
      </p>
      <p>
        {census.processesSeen === 0
          ? "No process-table entries were seen during the pass."
          : `${census.processesSeen} process-table ${census.processesSeen === 1 ? "entry was" : "entries were"} seen during the pass.`}
      </p>
    </div>
  );
}

function CensusState({ census, skew }: { census: AdmissionCensusView; skew: ClockSkew }): ReactNode {
  if (census.kind === "unreadable") {
    return <p>This browser could not read the process census in the server's response: {census.why}.</p>;
  }
  if (census.kind === "not-yet-computed") {
    return <p>The dashboard has not finished its first look at the process table yet.</p>;
  }
  if (census.kind === "failed") {
    const failedAt = forecastTime(census.failedAtMs, skew);
    if (census.lastGood === null) {
      return (
        <p>
          The process census failed{failedAt === null ? " at an unreadable time" : ` at ${failedAt}`}: {census.why}.
          There is no earlier readable census to show.
        </p>
      );
    }
    const staleStartedAt = forecastTime(census.lastGood.startedAtMs, skew);
    const staleCompletedAt = forecastTime(census.lastGood.completedAtMs, skew);
    return (
      <div className="tw:space-y-2">
        <p>The latest process census failed{failedAt === null ? " at an unreadable time" : ` at ${failedAt}`}: {census.why}.</p>
        <p>
          {staleStartedAt === null || staleCompletedAt === null
            ? "The counts below are stale; their pass boundary could not be displayed on this page's clock."
            : `The counts below are stale; their pass ran from ${staleStartedAt} to ${staleCompletedAt}.`}
        </p>
        <CensusCounts census={census.lastGood.census} />
      </div>
    );
  }

  const startedAt = forecastTime(census.startedAtMs, skew);
  const completedAt = forecastTime(census.completedAtMs, skew);
  const correctedCompletedAt = shiftMsToBrowserClock(census.completedAtMs, skew);
  const isOld =
    skew.kind === "known" &&
    Number.isFinite(correctedCompletedAt) &&
    Date.now() - correctedCompletedAt > census.cadenceMs * 2;
  return (
    <div className="tw:space-y-2">
      <p>
        {startedAt === null || completedAt === null
          ? "These processes were observed during a pass whose time could not be displayed on this page's clock."
          : `These processes were observed during a pass that ran from ${startedAt} to ${completedAt}.`}
      </p>
      {isOld ? <p>This observation is older than twice its {census.cadenceMs / 1_000}-second cadence.</p> : null}
      <CensusCounts census={census.census} />
    </div>
  );
}

function Census({ census, skew }: { census: AdmissionCensusView; skew: ClockSkew }): ReactNode {
  return (
    <div data-admission-census className="tw:mt-4 tw:border-t tw:border-rule tw:pt-3 tw:text-[12px] tw:text-ink-faint">
      <div className="tw:mb-2 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
        <p className="tw:font-medium tw:text-ink-soft">Recognised live process roots</p>
        <ObservedLabel />
      </div>
      <p className="tw:mb-2">
        This uses three existing process recognisers: Vitest runners, Codex batch jobs (<code>codex exec</code>), and
        Chrome or Chromium browsers. Anything else is not counted at all, however much it is doing. A root here may
        be idle; this says only that the process existed when it was read during the pass.
      </p>
      <CensusState census={census} skew={skew} />
    </div>
  );
}

function AdmissionBody({ view, skew }: { view: AdmissionView | null; skew: ClockSkew }): ReactNode {
  if (view === null) {
    return <p className="tw:text-[13px] tw:text-ink-faint">Asking the gate for a forecast…</p>;
  }
  if (view.kind === "no-answer") {
    return (
      <div>
        <p className="tw:text-[13px] tw:text-ink-soft">
          {view.source === "browser"
            ? `This browser never got an answer it could read: ${view.why}.`
            : `The server did not produce an admission forecast this page could use: ${view.why}.`}
        </p>
        <div className="tw:mt-3"><Pill tone="unknown">forecast</Pill></div>
        {view.census === null ? null : <Census census={view.census} skew={skew} />}
      </div>
    );
  }

  /* **An unreadable instant loses the instant, never the answer.** The outcome
     is the thing the reader came for; the time is a caption. The parser keeps
     this distinction too, so the real fetch path reaches this arm rather than
     turning a server answer into a browser-owned `no-answer`. */
  const at = forecastTime(view.computedAtMs, skew);
  return (
    <div>
      <p className="tw:mb-2 tw:text-[12px] tw:text-ink-faint">
        {at === null
          ? "The forecast time could not be displayed on this page's clock, so this answer is undated."
          : `The forecast was computed at ${at}.`}
      </p>
      <Outcome view={view} />
      {policy(view)}
      {/* The label says what sort of knowledge this is, not whether the box is
          healthy. A forecast is neutral rather than live green/amber/red; a
          missing model is genuinely unknown rather than the page's idle grey. */}
      <div className="tw:mt-3"><SignalLabel label={view.label} /></div>
      <Journal journal={view.journal} skew={skew} />
      <Census census={view.census} skew={skew} />
    </div>
  );
}

/* One bounded request per API while it is pending. The consumer count lets
   StrictMode's setup-cleanup-setup rehearsal share its harmless GET, while a
   real unmount abandons it after that synchronous rehearsal has had a chance
   to acquire the same request. */
type PendingForecast = {
  promise: Promise<AdmissionView>;
  consumers: number;
  cancel(): void;
};

const pendingForecasts = new WeakMap<AdmissionApi, PendingForecast>();

function newPendingForecast(api: AdmissionApi): PendingForecast {
  const controller = new AbortController();
  let rejectInterruption!: (cause: Error) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const request = Promise.resolve().then(() => api.forecast({ signal: controller.signal }));
  const pending: PendingForecast = {
    promise: Promise.race([request, interruption]),
    consumers: 0,
    cancel() {
      controller.abort();
      rejectInterruption(new Error("the admission request was abandoned"));
    },
  };
  const timeout = setTimeout(() => {
    controller.abort();
    rejectInterruption(new Error(`the admission request gave no answer in ${ADMISSION_REQUEST_TIMEOUT_MS / 1_000}s`));
  }, ADMISSION_REQUEST_TIMEOUT_MS);
  const clear = (): void => {
    clearTimeout(timeout);
    if (pendingForecasts.get(api) === pending) pendingForecasts.delete(api);
  };
  void pending.promise.then(clear, clear);
  pendingForecasts.set(api, pending);
  return pending;
}

function forecastOnce(api: AdmissionApi): { promise: Promise<AdmissionView>; release(): void } {
  const pending = pendingForecasts.get(api) ?? newPendingForecast(api);
  pending.consumers += 1;
  let released = false;
  return {
    promise: pending.promise,
    release() {
      if (released) return;
      released = true;
      pending.consumers -= 1;
      queueMicrotask(() => {
        if (pending.consumers !== 0 || pendingForecasts.get(api) !== pending) return;
        pendingForecasts.delete(api);
        pending.cancel();
      });
    },
  };
}

function tabIsHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function failedRefresh(previous: AdmissionView | null, cause: unknown): AdmissionView {
  const detail = cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "the request failed without a readable reason";
  return {
    kind: "no-answer",
    source: "browser",
    why: `the admission refresh failed: ${detail}`,
    census: previous?.census ?? null,
  };
}

export function AdmissionSection({ api, skew }: { api: AdmissionApi; skew: ClockSkew }): ReactNode {
  const [view, setView] = useState<AdmissionView | null>(null);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let releaseInFlight: (() => void) | null = null;
    const clearTimer = (): void => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    const schedule = (): void => {
      if (!alive) return;
      clearTimer();
      timer = setTimeout(() => void refresh(), ADMISSION_CENSUS_CADENCE_MS);
    };
    const refresh = async (): Promise<void> => {
      if (!alive || inFlight) return;
      if (tabIsHidden()) {
        schedule();
        return;
      }
      inFlight = true;
      const request = forecastOnce(api);
      releaseInFlight = request.release;
      try {
        const answer = await request.promise;
        if (alive) setView(answer);
      } catch (cause) {
        if (alive) setView((previous) => failedRefresh(previous, cause));
      } finally {
        request.release();
        if (releaseInFlight === request.release) releaseInFlight = null;
        inFlight = false;
        schedule();
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState !== "visible" || inFlight) return;
      clearTimer();
      void refresh();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    void refresh();
    return () => {
      alive = false;
      clearTimer();
      releaseInFlight?.();
      releaseInFlight = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [api]);

  return (
    <section data-section="admission" className="tw:mt-4">
      <SectionHeading>If a test run started right now, what would the gate say?</SectionHeading>
      <Card className="tw:border-l-4 tw:p-4">
        <p className="tw:mb-3 tw:text-[13px] tw:font-medium">Gate forecast — this panel admitted or refused nothing.</p>
        <AdmissionBody view={view} skew={skew} />
      </Card>
    </section>
  );
}
