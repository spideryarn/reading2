import { useEffect, useState, type ReactNode } from "react";

import { DATE_LIMIT_MS, type AdmissionApi, type AdmissionView } from "./admission-client";
import { Card, Pill, SectionHeading } from "./ui";
import type { Tone } from "./view";

function forecastTime(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > DATE_LIMIT_MS) return null;
  return new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
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
          {outcome.kind === "would-admit"
            ? `The gate would admit a test run with the machine default of ${outcome.workers} workers.`
            : `The gate would admit a test run and would ask the config for ${outcome.workers} workers instead of the machine default of ${outcome.nominalWorkers}.`}
        </p>
        <p>
          Gate figures: capacity {outcome.capacity} workers; available memory {outcome.availableBytes.toLocaleString()} bytes;
          reserve {outcome.reserveBytes.toLocaleString()} bytes.
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
  return (
    <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
      {view.policy.explanation ?? view.policy.whyWithheld}
    </p>
  );
}

function answerTone(view: AdmissionView): Tone {
  if (view.kind === "no-answer") return "unknown";
  if (view.label === "not-modelled") return "idle";
  if (view.outcome.kind === "would-admit") return "work";
  if (view.outcome.kind === "would-reduce") return "needs";
  if (view.outcome.kind === "would-refuse") return "alarm";
  return "unknown";
}

function AdmissionBody({ view }: { view: AdmissionView | null }): ReactNode {
  if (view === null) {
    return <p className="tw:text-[13px] tw:text-ink-faint">Asking the gate for a forecast…</p>;
  }
  if (view.kind === "no-answer") {
    return (
      <div>
        <p className="tw:text-[13px] tw:text-ink-soft">This browser never got an answer it could read: {view.why}.</p>
        <div className="tw:mt-3"><Pill tone="unknown">forecast</Pill></div>
      </div>
    );
  }

  /* **An unreadable instant loses the instant, never the answer.**
     `parseAdmission` already refuses an out-of-range `computedAtMs` into
     `no-answer`, so this branch is unreachable through the parser — which is
     precisely why it was wrong and why it now has its own test. It used to say
     "this browser never got an answer it could read" over a perfectly good
     would-refuse: two errors at once, since the browser HAD an answer and the
     answer was being discarded for a bad clock. The outcome is the thing the
     reader came for; the time is a caption. */
  const at = forecastTime(view.computedAtMs);
  return (
    <div>
      <p className="tw:mb-2 tw:text-[12px] tw:text-ink-faint">
        {at === null
          ? "The forecast time could not be read, so this answer is undated — the server sent an instant outside the range this page can display."
          : `The forecast was computed at ${at}.`}
      </p>
      <Outcome view={view} />
      {policy(view)}
      <div className="tw:mt-3"><Pill tone={answerTone(view)}>{view.label}</Pill></div>
    </div>
  );
}

export function AdmissionSection({ api }: { api: AdmissionApi }): ReactNode {
  const [view, setView] = useState<AdmissionView | null>(null);

  useEffect(() => {
    let alive = true;
    void api.forecast().then((answer) => {
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
        <AdmissionBody view={view} />
      </Card>
    </section>
  );
}
