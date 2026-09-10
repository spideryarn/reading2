// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import type { ActionsApi } from "../tools/fleet/web/src/actions-client";
import type { AdmissionApi, AdmissionView } from "../tools/fleet/web/src/admission-client";
import type { HistoryApi } from "../tools/fleet/web/src/health-history-client";
import { CLOCK_SKEW_UNMEASURED, type FleetState } from "../tools/fleet/web/src/types";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPUTED_AT = Date.parse("2026-09-10T11:12:13.000Z");
const CAVEAT = "A reduced worker count is the config default; --maxWorkers on the command line overrides it.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.location.hash = "#health";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.location.hash = "";
});

function state(): FleetState {
  return {
    collectedAt: new Date().toISOString(),
    tookMs: 12,
    error: null,
    rows: [],
    unreadableRows: 0,
    health: { verdict: { level: "ok", reasons: [] } },
    refreshMs: null,
    attention: { kind: "not-asked" },
    questions: { kind: "not-observed", gaps: [{ kind: "attention-not-asked" }] },
    overseer: { kind: "not-asked" },
    usage: { kind: "not-asked" },
    clockSkew: CLOCK_SKEW_UNMEASURED,
    answeringEnabled: { kind: "not-reported" },
    attemptedAt: { kind: "not-reported", why: "the fixture did not say" },
    tmuxServerPid: 132280,
  };
}

function manualTransport(): { transport: Transport; push: (next: FleetState) => void } {
  let sink: TransportSink | null = null;
  return {
    transport: (nextSink) => {
      sink = nextSink;
      return { refresh: () => {}, stop: () => { sink = null; } };
    },
    push: (next) => sink?.onState(next),
  };
}

const actionsApi = {
  feed: async () => ({ ok: false as const, why: "not part of this fixture" }),
} as ActionsApi;

const historyApi: HistoryApi = {
  window: async () => ({ kind: "no-answer", why: "not part of this fixture" }),
};

function forecast(
  outcome: Extract<AdmissionView, { label: "forecast" }>["outcome"],
): Extract<AdmissionView, { label: "forecast" }> {
  return {
    kind: "answer",
    label: "forecast",
    computedAtMs: COMPUTED_AT,
    requestKind: "test",
    policy: { gateVersion: 1, explanation: "The gate uses its measured test-run cost model.", whyWithheld: null },
    outcome,
  };
}

async function mountFull(api: AdmissionApi): Promise<void> {
  const feed = manualTransport();
  act(() => {
    root.render(
      <App
        transport={feed.transport}
        actionsApi={actionsApi}
        historyApi={historyApi}
        admissionApi={api}
        actionsPollMs={3_600_000}
      />,
    );
  });
  act(() => feed.push(state()));
  await act(async () => {});
}

describe("the Box health admission section", () => {
  it("issues its request through the injected seam when Box health opens", async () => {
    let asks = 0;
    await mountFull({
      forecast: async () => {
        asks += 1;
        return forecast({
          kind: "would-admit",
          nominalWorkers: 4,
          workers: 4,
          capacity: 9,
          availableBytes: 17_179_869_184,
          reserveBytes: 4_294_967_296,
          caveat: CAVEAT,
        });
      },
    });
    expect(asks).toBe(1);
  });

  it.each([
    [
      "would-admit",
      forecast({
        kind: "would-admit",
        nominalWorkers: 4,
        workers: 4,
        capacity: 9,
        availableBytes: 17_179_869_184,
        reserveBytes: 4_294_967_296,
        caveat: CAVEAT,
      }),
      "would admit a test run with the machine default of 4 workers",
    ],
    [
      "would-reduce",
      forecast({
        kind: "would-reduce",
        nominalWorkers: 4,
        workers: 2,
        capacity: 2,
        availableBytes: 10_000_000_000,
        reserveBytes: 4_294_967_296,
        caveat: CAVEAT,
      }),
      "would ask the config for 2 workers instead of the machine default of 4",
    ],
    [
      "would-refuse",
      forecast({
        kind: "would-refuse",
        forecastCallMessage: "NO TESTS RAN AND NOTHING WAS VERIFIED (dashboard pid 4242)",
      }),
      "would refuse a test run on this reading",
    ],
    [
      "not-applicable",
      forecast({ kind: "not-applicable", why: "no reserve file" }),
      "The machine has no admission policy",
    ],
    [
      "unknown",
      forecast({ kind: "unknown", why: "worker file was unreadable" }),
      "The server could not ask its own gate",
    ],
  ] as const)("renders %s as its own sentence", async (_kind, reply, sentence) => {
    await mountFull({ forecast: async () => reply });
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain(sentence);
    if (_kind === "would-admit" || _kind === "would-reduce") expect(text).toContain(CAVEAT);
    else expect(text).not.toContain("--maxWorkers");
  });

  it("states that the forecast changed nothing and never labels it as enforced", async () => {
    await mountFull({
      forecast: async () =>
        forecast({
          kind: "would-admit",
          nominalWorkers: 4,
          workers: 4,
          capacity: 9,
          availableBytes: 17_179_869_184,
          reserveBytes: 4_294_967_296,
          caveat: CAVEAT,
        }),
    });
    expect(container.textContent).toContain("Gate forecast — this panel admitted or refused nothing.");
    expect(container.textContent).toContain("The forecast was computed at");
    expect(container.textContent).not.toContain("enforced");
    expect(container.textContent).toContain(CAVEAT);
  });

  it.each(["review", "browser"] as const)("says %s work has no cost model", async (requestKind) => {
    await mountFull({
      forecast: async () => ({
        kind: "answer",
        label: "not-modelled",
        computedAtMs: COMPUTED_AT,
        requestKind,
        outcome: { kind: "not-modelled", why: `no measured cost model exists for ${requestKind} work` },
      }),
    });
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain(`We have no cost model for ${requestKind} work`);
    expect(text).not.toContain("fine");
    expect(text).not.toContain("would refuse");
  });

  it("keeps a missing browser answer in the browser's own voice", async () => {
    await mountFull({ forecast: async () => ({ kind: "no-answer", why: "the connection ended" }) });
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain("This browser never got an answer it could read");
    expect(text.toLowerCase()).not.toContain("server");
  });

  it.each([
    forecast({ kind: "not-applicable", why: "no reserve file" }),
    forecast({ kind: "unknown", why: "worker file was unreadable" }),
    { kind: "no-answer", why: "the connection ended" } as const,
  ])("draws no zero or empty bar when an admission number is absent", async (reply) => {
    await mountFull({ forecast: async () => reply });
    const section = container.querySelector('[data-section="admission"]');
    expect(section).not.toBeNull();
    expect(section?.querySelector('[role="progressbar"]')).toBeNull();
    expect(section?.querySelector('[style*="width: 0"]')).toBeNull();
    expect(section?.textContent).not.toMatch(/\b0(?:\.0+)?\b/);
  });
});

describe("the defensive admission client", () => {
  it("turns an unrecognised body into the browser's stated no-answer arm", async () => {
    const { parseAdmission } = await import("../tools/fleet/web/src/admission-client");
    expect(
      parseAdmission({
        schema: 1,
        label: "forecast",
        computedAtMs: COMPUTED_AT,
        request: { kind: "test" },
        policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
        outcome: { kind: "future-answer", workers: 0 },
      }),
    ).toMatchObject({ kind: "no-answer" });
  });

  it("refuses an out-of-range instant before a renderer can throw", async () => {
    const { parseAdmission } = await import("../tools/fleet/web/src/admission-client");
    const parsed = parseAdmission({
      schema: 1,
      label: "forecast",
      computedAtMs: 1e300,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "unknown", why: "reader failed" },
    });
    expect(parsed).toMatchObject({ kind: "no-answer" });
  });

  /**
   * **The section's own range check must not throw away the server's answer,
   * and must not blame this browser for the server's clock.**
   *
   * `parseAdmission` above already refuses an out-of-range instant into
   * `no-answer`, so a view that reaches the section always has a displayable
   * time — which is exactly why the section's second check needs a test of its
   * own: it is unreachable through the parser, and an unreachable branch is one
   * nothing has ever watched. It said *"This browser never got an answer it
   * could read"* over a perfectly good `would-refuse`, which is two errors at
   * once: the browser did get an answer, and the answer was thrown away for a
   * bad timestamp rather than drawn without one.
   *
   * The view is constructed directly rather than parsed, because that is the
   * only way in — and it is the way a future caller building a view by hand
   * would arrive too.
   */
  it("keeps the outcome when the instant is unreadable, and does not blame the browser", async () => {
    await mountFull({
      forecast: async () => ({
        ...forecast({ kind: "would-refuse", forecastCallMessage: "REFUSING TO START: not enough memory" }),
        computedAtMs: 1e300,
      }),
    });

    const text = container.textContent ?? "";
    expect(text).toContain("REFUSING TO START: not enough memory");
    expect(text).not.toContain("This browser never got an answer");
    /* The time is missing and says so, rather than being absent in silence. */
    expect(text.toLowerCase()).toContain("time");
  });
});
