import { useEffect, useState, type ReactNode } from "react";

import { DATE_LIMIT_MS, type AdmissionApi, type AdmissionView } from "./admission-client";
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
    </div>
  );
}

/* One request per API while it is pending. Besides ordinary quick remounts,
   this covers React StrictMode's setup-cleanup-setup rehearsal: both mounts
   observe the same harmless GET, while each keeps its own state-write guard. */
const pendingForecasts = new WeakMap<AdmissionApi, Promise<AdmissionView>>();

function forecastOnce(api: AdmissionApi): Promise<AdmissionView> {
  const pending = pendingForecasts.get(api);
  if (pending !== undefined) return pending;
  const request = api.forecast();
  pendingForecasts.set(api, request);
  const clear = (): void => {
    if (pendingForecasts.get(api) === request) pendingForecasts.delete(api);
  };
  void request.then(clear, clear);
  return request;
}

export function AdmissionSection({ api, skew }: { api: AdmissionApi; skew: ClockSkew }): ReactNode {
  const [view, setView] = useState<AdmissionView | null>(null);

  useEffect(() => {
    let alive = true;
    void forecastOnce(api).then((answer) => {
      if (alive) setView(answer);
    });
    return () => {
      alive = false;
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
