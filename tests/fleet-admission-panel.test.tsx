// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import { AdmissionSection } from "../tools/fleet/web/src/AdmissionSection";
import type { ActionsApi } from "../tools/fleet/web/src/actions-client";
import {
  makeAdmissionApi,
  parseAdmission,
  type AdmissionApi,
  type AdmissionView,
} from "../tools/fleet/web/src/admission-client";
import type { HistoryApi } from "../tools/fleet/web/src/health-history-client";
import { CLOCK_SKEW_UNMEASURED, type FleetState } from "../tools/fleet/web/src/types";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPUTED_AT = Date.parse("2026-09-10T11:12:13.000Z");
const CAVEAT = "A reduced worker count is the config default; --maxWorkers on the command line overrides it.";

const EMPTY_CENSUS = {
  byClass: {
    test: { roots: 0, uncertain: 0 },
    "codex-batch": { roots: 0, uncertain: 0 },
    browser: { roots: 0, uncertain: 0 },
  },
  changedUnderRead: 0,
  unreadable: 0,
  processesSeen: 14,
} as const;

const CENSUS_VALUE = {
  kind: "value",
  label: "observed",
  census: {
    byClass: {
      test: { roots: 2, uncertain: 1 },
      "codex-batch": { roots: 1, uncertain: 0 },
      browser: { roots: 3, uncertain: 2 },
    },
    changedUnderRead: 4,
    unreadable: 5,
    processesSeen: 880,
  },
  startedAtMs: Date.parse("2026-09-10T11:12:00.000Z"),
  completedAtMs: Date.parse("2026-09-10T11:12:01.000Z"),
  durationMs: 1_000,
  cadenceMs: 30_000,
} as const;

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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function state(over: Partial<FleetState> = {}): FleetState {
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
    accountUsage: { kind: "not-asked" },
    /* Required since the work history landed, and stated rather than defaulted
       for the reason the rest of this fixture is: a payload that did not report
       current work is a different fact from one reporting an idle box. */
    currentWork: { kind: "not-reported" },
    clockSkew: CLOCK_SKEW_UNMEASURED,
    answeringEnabled: { kind: "not-reported" },
    attemptedAt: { kind: "not-reported", why: "the fixture did not say" },
    tmuxServerPid: 132280,
    ...over,
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
    journal: { kind: "read", entries: [], unparseableLines: 0 },
    census: { kind: "not-yet-computed", label: "observed", startedAtMs: COMPUTED_AT },
  };
}

function forecastWithCensus(census: unknown): AdmissionView {
  return {
    ...forecast({ kind: "not-applicable", why: "no reserve file" }),
    census,
  } as AdmissionView;
}

async function mountFull(api: AdmissionApi, nextState: FleetState = state()): Promise<void> {
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
  act(() => feed.push(nextState));
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

  it("still issues exactly one forecast request when the box has no health reading", async () => {
    let asks = 0;
    await mountFull(
      {
        forecast: async () => {
          asks += 1;
          return forecast({ kind: "not-applicable", why: "no reserve file" });
        },
      },
      state({ health: null }),
    );
    expect(asks).toBe(1);
    expect(container.querySelector('[data-section="admission"]')).not.toBeNull();
  });

  it("turns StrictMode's effect rehearsal into one forecast request", async () => {
    let asks = 0;
    const api: AdmissionApi = {
      forecast: async () => {
        asks += 1;
        return forecast({ kind: "not-applicable", why: "no reserve file" });
      },
    };
    act(() => root.render(<StrictMode><AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} /></StrictMode>));
    await act(async () => {});
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
      "For the machine-default request of 4 workers, the gate would admit the test run. The config would ask Vitest for 4 workers.",
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
      "For the machine-default request of 4 workers, the gate would admit the test run. The config would ask Vitest for 2 workers instead.",
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

  it('renders an empty journal as "nothing was recorded", without claiming nothing was refused', async () => {
    const reply = {
      ...forecast({ kind: "not-applicable", why: "no reserve file" }),
      journal: { kind: "read", entries: [], unparseableLines: 0 },
    } as AdmissionView;
    await mountFull({ forecast: async () => reply });

    const text = container.querySelector("[data-admission-journal]")?.textContent ?? "";
    expect(text.toLowerCase()).toContain("nothing was recorded");
    expect(text.toLowerCase()).not.toContain("nothing was refused");
    expect(text.toLowerCase()).not.toContain("no refusals");
    expect(text).toContain("this repo's Vitest config on this machine");
    expect(text).toContain("readiness loop");
    expect(text).toContain("another machine");
    expect(text).toContain("bypassed the config");
    expect(text).toContain("append that failed");
    expect(text).toContain("bounded number of the newest records");
    expect(text).toContain("older entries are discarded");
    expect(text).not.toContain("live file and one previous file");
  });

  it("does not call an all-unparseable journal empty", async () => {
    const reply = {
      ...forecast({ kind: "not-applicable", why: "no reserve file" }),
      journal: { kind: "read", entries: [], unparseableLines: 2 },
    } as AdmissionView;
    await mountFull({ forecast: async () => reply });

    const text = container.querySelector("[data-admission-journal]")?.textContent ?? "";
    expect(text).toContain("No readable refusal entries were found");
    expect(text).toContain("2 lines could not be parsed");
    expect(text.toLowerCase()).not.toContain("nothing was recorded");
  });

  it.each([
    [{ kind: "directory-absent" }, "The refusal journal directory does not exist"],
    [{ kind: "unreadable", why: "permission denied" }, "The refusal journal could not be read: permission denied"],
  ] as const)("renders the journal's %s arm as a stated absence", async (journal, sentence) => {
    const reply = {
      ...forecast({ kind: "not-applicable", why: "no reserve file" }),
      journal,
    } as AdmissionView;
    await mountFull({ forecast: async () => reply });
    const text = container.querySelector("[data-admission-journal]")?.textContent ?? "";
    expect(text).toContain(sentence);
    expect(text.toLowerCase()).not.toContain("nothing was recorded");
  });

  it("renders readable entries and counts lines it could not parse", async () => {
    const reply = {
      ...forecast({ kind: "not-applicable", why: "no reserve file" }),
      journal: {
        kind: "read",
        entries: [{
          at: "2026-09-10T04:05:06.000Z",
          source: "readiness-precheck",
          policyVersion: 1,
          availableBytes: 2 * 1024 ** 3,
          reserveBytes: 4 * 1024 ** 3,
          swapTotalBytes: 8 * 1024 ** 3,
          swapFreeBytes: 1024 ** 3,
          pid: 4242,
          host: "fleet-box",
        }],
        unparseableLines: 2,
      },
    } as AdmissionView;
    await mountFull({ forecast: async () => reply });
    const text = container.querySelector("[data-admission-journal]")?.textContent ?? "";
    expect(text).toContain("readiness precheck");
    expect(text).toContain("fleet-box");
    expect(text).toContain("2 lines could not be parsed");
  });

  it("prints journal instants on the corrected clock used by the rest of Box health", async () => {
    const recordedAt = "2026-09-10T04:05:06.000Z";
    const skew = { kind: "known", ms: -5 * 60_000 } as const;
    const reply = {
      ...forecast({ kind: "not-applicable", why: "no reserve file" }),
      journal: {
        kind: "read",
        entries: [{
          at: recordedAt,
          source: "test-run",
          policyVersion: 1,
          availableBytes: 2 * 1024 ** 3,
          reserveBytes: 4 * 1024 ** 3,
          swapTotalBytes: 8 * 1024 ** 3,
          swapFreeBytes: 1024 ** 3,
          pid: 4242,
          host: "fleet-box",
        }],
        unparseableLines: 0,
      },
    } as AdmissionView;
    await mountFull({ forecast: async () => reply }, state({ clockSkew: skew }));

    const expected = new Date(Date.parse(recordedAt) - skew.ms).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const text = container.querySelector("[data-admission-journal]")?.textContent ?? "";
    expect(text).toContain(expected);
    expect(text).not.toContain(recordedAt);
  });

  /**
   * **Memory is stated in the same unit the rest of this panel and the gate
   * itself use.** Found in a browser at 390 px rather than in a test: the
   * section rendered "available memory 20,733,063,168 bytes; reserve
   * 4,294,967,296 bytes", which nobody can read on a phone and which no other
   * number on Box health is written like.
   *
   * The unit is not a cosmetic choice here. `health.ts` carries a scar about
   * exactly this — it once drew "10298 GiB of 31337 GiB" on a 32 GB box because
   * a field named `…KiB` held bytes — and its rule since is that every reading
   * carries its unit in its name. The gate's own refusal message formats these
   * two figures as `(n / 1024 ** 3).toFixed(2)` GB, so matching it keeps the
   * forecast and the refusal text the reader may see next to each other in
   * agreement.
   */
  it("states memory in GB, as the gate's own message does, not in raw bytes", async () => {
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
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain("16.00 GB");
    expect(text).toContain("4.00 GB");
    expect(text).not.toContain("17,179,869,184");
    expect(text).not.toContain("4,294,967,296");
  });

  it.each(["review", "browser"] as const)("says %s work has no cost model", async (requestKind) => {
    await mountFull({
      forecast: async () => ({
        kind: "answer",
        label: "not-modelled",
        computedAtMs: COMPUTED_AT,
        requestKind,
        outcome: { kind: "not-modelled", why: `no measured cost model exists for ${requestKind} work` },
        journal: { kind: "read", entries: [], unparseableLines: 0 },
        census: { kind: "not-yet-computed", label: "observed", startedAtMs: COMPUTED_AT },
      }),
    });
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain(`We have no cost model for ${requestKind} work`);
    expect(text).not.toContain("fine");
    expect(text).not.toContain("would refuse");
  });

  it.each([
    [
      forecast({
        kind: "would-admit",
        nominalWorkers: 4,
        workers: 4,
        capacity: 9,
        availableBytes: 17_179_869_184,
        reserveBytes: 4_294_967_296,
        caveat: CAVEAT,
      }),
      "tw:bg-panel-raised",
    ],
    [
      forecast({ kind: "would-refuse", forecastCallMessage: "REFUSING TO START: not enough memory" }),
      "tw:bg-panel-raised",
    ],
    [
      {
        kind: "answer",
        label: "not-modelled",
        computedAtMs: COMPUTED_AT,
        requestKind: "review",
        outcome: { kind: "not-modelled", why: "no measured cost model exists" },
        journal: { kind: "read", entries: [], unparseableLines: 0 },
        census: { kind: "not-yet-computed", label: "observed", startedAtMs: COMPUTED_AT },
      } as AdmissionView,
      "tw:bg-unknown",
    ],
  ] as const)("does not reuse a live-health tone for a forecast or an idle tone for an unknown", async (reply, expected) => {
    await mountFull({ forecast: async () => reply });
    const label = container.querySelector('[data-section="admission"] [data-admission-label]');
    const styledLabel = label?.querySelector('[data-slot="pill"]') ?? label;
    expect(styledLabel?.className).toContain(expected);
    expect(styledLabel?.className).not.toContain("tw:bg-alarm");
    expect(styledLabel?.className).not.toContain("tw:bg-work");
    expect(styledLabel?.className).not.toContain("tw:bg-needs");
    expect(styledLabel?.className).not.toContain("tw:bg-quiet-wash");
  });

  it("prints the forecast instant on the corrected clock used by the rest of Box health", async () => {
    const skew = { kind: "known", ms: -5 * 60_000 } as const;
    await mountFull(
      { forecast: async () => forecast({ kind: "not-applicable", why: "no reserve file" }) },
      state({ clockSkew: skew }),
    );
    const expected = new Date(COMPUTED_AT - skew.ms).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const uncorrected = new Date(COMPUTED_AT).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain(expected);
    expect(text).not.toContain(uncorrected);
  });

  it("marks a withheld policy explanation as unavailable instead of styling it like policy prose", async () => {
    await mountFull({
      forecast: async () => ({
        ...forecast({ kind: "not-applicable", why: "no reserve file" }),
        policy: {
          gateVersion: 99,
          explanation: null,
          whyWithheld: "this dashboard has no explanation for admission policy v99; policy wording is withheld",
        },
      }),
    });
    const section = container.querySelector('[data-section="admission"]');
    expect(section?.textContent).toContain("Policy explanation unavailable");
    expect(section?.querySelector(".tw\\:text-unknown-ink")?.textContent).toContain("policy v99");
  });

  it("keeps a missing browser answer in the browser's own voice", async () => {
    await mountFull({
      forecast: async () => ({ kind: "no-answer", source: "browser", why: "the connection ended", census: null }),
    });
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain("This browser never got an answer it could read");
    expect(text.toLowerCase()).not.toContain("server");
  });

  it("speaks a readable HTTP failure in the server's voice, not the browser's", async () => {
    const api = makeAdmissionApi(async () =>
      new Response(JSON.stringify({ error: "internal-error", why: "building the answer threw" }), { status: 500 }),
    );
    await mountFull(api);
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain("The server did not produce an admission forecast");
    expect(text).not.toContain("This browser never got an answer");
  });

  it.each([
    forecast({ kind: "not-applicable", why: "no reserve file" }),
    forecast({ kind: "unknown", why: "worker file was unreadable" }),
    { kind: "no-answer", source: "browser", why: "the connection ended", census: null } as const,
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
  it("passes the caller's abort signal to the admission fetch", async () => {
    const controller = new AbortController();
    let received: AbortSignal | null | undefined;
    const api = makeAdmissionApi(async (_input, init) => {
      received = init?.signal;
      return new Response("{}", { status: 500 });
    });

    await api.forecast({ signal: controller.signal });
    expect(received).toBe(controller.signal);
  });

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

  it("keeps a valid outcome when only its forecast instant is out of range", () => {
    const parsed = parseAdmission({
      schema: 1,
      label: "forecast",
      computedAtMs: 1e300,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "unknown", why: "reader failed" },
    });
    expect(parsed).toMatchObject({
      kind: "answer",
      computedAtMs: null,
      outcome: { kind: "unknown", why: "reader failed" },
    });
  });

  it("keeps that outcome through the real fetch-parser-render path", async () => {
    const api = makeAdmissionApi(async () =>
      new Response(JSON.stringify({
        schema: 1,
        label: "forecast",
        computedAtMs: 1e300,
        request: { kind: "test" },
        policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
        outcome: {
          kind: "would-refuse",
          forecastCallMessage: "REFUSING TO START: not enough memory",
          messageContext: "dashboard-forecast-call",
        },
      }), { status: 200 }),
    );
    await mountFull(api);
    const text = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    expect(text).toContain("REFUSING TO START: not enough memory");
    expect(text).toContain("this answer is undated");
    expect(text).not.toContain("This browser never got an answer");
  });

  /**
   * **The section's own range check must not throw away the server's answer,
   * and must not blame this browser for the server's clock.**
   *
   * This direct view still checks the renderer's own boundary independently of
   * the parser test above. Before the parser was corrected, this branch was
   * unreachable through the real fetch path and nothing had ever watched it.
   * The old pair of paths could say *"This browser never got an answer it could
   * read"* over a perfectly good `would-refuse`: the browser did get an answer,
   * and the answer was thrown away for a bad timestamp rather than drawn
   * without one.
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

  it("keeps a valid forecast when only the census is unreadable", () => {
    const parsed = parseAdmission({
      schema: 1,
      label: "forecast",
      computedAtMs: COMPUTED_AT,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "not-applicable", why: "no reserve file" },
      census: {
        ...CENSUS_VALUE,
        census: { ...CENSUS_VALUE.census, processesSeen: "many" },
      },
    });

    expect(parsed).toMatchObject({
      kind: "answer",
      label: "forecast",
      outcome: { kind: "not-applicable" },
      census: { kind: "unreadable" },
    });
  });

  it("keeps a valid census when only the forecast is unreadable", async () => {
    const parsed = parseAdmission({
      schema: 1,
      label: "forecast",
      computedAtMs: COMPUTED_AT,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "future-answer" },
      census: CENSUS_VALUE,
    });

    expect(parsed).toMatchObject({ kind: "no-answer", census: CENSUS_VALUE });
    await mountFull({ forecast: async () => parsed });
    expect(container.textContent).toContain("This browser never got an answer it could read");
    expect(container.textContent).toContain("2 recognised Vitest roots");
  });

  it("refuses a census whose classified and unreadable rows exceed the table it saw", () => {
    const parsed = parseAdmission({
      schema: 1,
      label: "forecast",
      computedAtMs: COMPUTED_AT,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "not-applicable", why: "no reserve file" },
      census: {
        ...CENSUS_VALUE,
        census: {
          ...CENSUS_VALUE.census,
          processesSeen: 1,
        },
      },
    });

    expect(parsed).toMatchObject({
      kind: "answer",
      outcome: { kind: "not-applicable" },
      census: { kind: "unreadable" },
    });
  });

  it("refuses a census whose pass ends before it starts", () => {
    const parsed = parseAdmission({
      schema: 1,
      label: "forecast",
      computedAtMs: COMPUTED_AT,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "not-applicable", why: "no reserve file" },
      census: {
        ...CENSUS_VALUE,
        startedAtMs: CENSUS_VALUE.completedAtMs + 1,
      },
    });

    expect(parsed).toMatchObject({
      kind: "answer",
      outcome: { kind: "not-applicable" },
      census: { kind: "unreadable" },
    });
  });
});

describe("the recognised process census block", () => {
  it("re-reads the cache after the cadence and replaces a transitional state", async () => {
    vi.useFakeTimers();
    let asks = 0;
    const api: AdmissionApi = {
      forecast: async () => {
        asks += 1;
        return forecastWithCensus(asks === 1
          ? { kind: "not-yet-computed", label: "observed", startedAtMs: COMPUTED_AT }
          : CENSUS_VALUE);
      },
    };

    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(1);
    expect(container.textContent).toContain("has not finished its first look");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(asks).toBe(2);
    expect(container.textContent).toContain("2 recognised Vitest roots");
  });

  it("retries after a rejected request instead of stopping the refresh loop", async () => {
    vi.useFakeTimers();
    let asks = 0;
    const api: AdmissionApi = {
      forecast: async () => {
        asks += 1;
        if (asks === 1) throw new Error("connection reset");
        return forecastWithCensus(CENSUS_VALUE);
      },
    };

    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(asks).toBe(2);
    expect(container.textContent).toContain("2 recognised Vitest roots");
  });

  it("times out a hung request and does not let it poison a later refresh", async () => {
    vi.useFakeTimers();
    let asks = 0;
    const signals: AbortSignal[] = [];
    const api: AdmissionApi = {
      forecast: async (options) => {
        asks += 1;
        if (options?.signal !== undefined) signals.push(options.signal);
        if (asks === 1) return new Promise<AdmissionView>(() => {});
        return forecastWithCensus(CENSUS_VALUE);
      },
    };

    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000);
    });
    expect(asks).toBe(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(container.textContent).toContain("2 recognised Vitest roots");
  });

  it("does not reuse an abandoned hung request after unmount", async () => {
    let asks = 0;
    const signals: AbortSignal[] = [];
    const api: AdmissionApi = {
      forecast: async (options) => {
        asks += 1;
        if (options?.signal !== undefined) signals.push(options.signal);
        return new Promise<AdmissionView>(() => {});
      },
    };

    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(1);

    act(() => root.unmount());
    await act(async () => {});
    expect(signals[0]?.aborted).toBe(true);
    root = createRoot(container);
    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(2);
  });

  it("removes the visibility catch-up and cadence timer on unmount", async () => {
    vi.useFakeTimers();
    let asks = 0;
    const api: AdmissionApi = {
      forecast: async () => {
        asks += 1;
        return forecastWithCensus(CENSUS_VALUE);
      },
    };

    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(1);

    act(() => root.unmount());
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(asks).toBe(1);
    root = createRoot(container);
  });

  it("skips hidden-tab polls and catches up once when the tab becomes visible", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    let asks = 0;
    const api: AdmissionApi = {
      forecast: async () => {
        asks += 1;
        return forecastWithCensus(CENSUS_VALUE);
      },
    };

    act(() => root.render(<AdmissionSection api={api} skew={CLOCK_SKEW_UNMEASURED} />));
    await act(async () => {});
    expect(asks).toBe(1);

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(asks).toBe(1);

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {});
    expect(asks).toBe(2);
  });

  it("renders not-yet-computed as its own sentence, never as a zero or an empty reading", async () => {
    await mountFull({
      forecast: async () => forecastWithCensus({
        kind: "not-yet-computed",
        label: "observed",
        startedAtMs: COMPUTED_AT,
      }),
    });

    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).toContain("The dashboard has not finished its first look at the process table yet");
    expect(text.toLowerCase()).not.toContain("nothing is running");
    expect(text).not.toMatch(/\b0(?:\.0+)?\b/);
  });

  it.each([
    ["not yet", { kind: "not-yet-computed", label: "observed", startedAtMs: COMPUTED_AT }],
    ["value", CENSUS_VALUE],
    ["failed before a value", {
      kind: "failed",
      label: "observed",
      why: "proc could not be listed",
      failedAtMs: COMPUTED_AT,
      cadenceMs: 30_000,
      lastGood: null,
    }],
    ["failed after a value", {
      kind: "failed",
      label: "observed",
      why: "proc could not be listed",
      failedAtMs: COMPUTED_AT,
      cadenceMs: 30_000,
      lastGood: {
        census: CENSUS_VALUE.census,
        startedAtMs: CENSUS_VALUE.startedAtMs,
        completedAtMs: CENSUS_VALUE.completedAtMs,
      },
    }],
    ["browser unreadable", { kind: "unreadable", why: "the response had an unknown census shape" }],
  ] as const)("states its heading and finite scope without banned language in the %s state", async (_name, census) => {
    await mountFull({ forecast: async () => forecastWithCensus(census) });

    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).toContain("Recognised live process roots");
    expect(text).toContain("Vitest runners");
    expect(text).toContain("Codex batch jobs");
    expect(text).toContain("Chrome or Chromium browsers");
    expect(text).toContain("Anything else is not counted at all");
    expect(text).toContain("may be idle");
    expect(text.toLowerCase()).not.toMatch(/\b(?:heavy|active|review)\b/);
  });

  it("states the pass boundary on the corrected clock and calls an old value old", async () => {
    const skew = { kind: "known", ms: -5 * 60_000 } as const;
    const completedAtMs = Date.now() + skew.ms - 61_000;
    const startedAtMs = completedAtMs - 800;
    await mountFull(
      { forecast: async () => forecastWithCensus({
        ...CENSUS_VALUE,
        startedAtMs,
        completedAtMs,
      }) },
      state({ clockSkew: skew }),
    );

    const expectedStart = new Date(startedAtMs - skew.ms).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const expectedEnd = new Date(completedAtMs - skew.ms).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).toContain(`ran from ${expectedStart} to ${expectedEnd}`);
    expect(text).toContain("older than twice its 30-second cadence");
  });

  it("does not call an observation old when server/browser clock skew is unknown", async () => {
    await mountFull({
      forecast: async () => forecastWithCensus({
        ...CENSUS_VALUE,
        startedAtMs: Date.now() - 101_000,
        completedAtMs: Date.now() - 100_000,
      }),
    });

    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).not.toContain("older than twice");
  });

  it("states every count and says changed and unreadable rows belong to no count above", async () => {
    await mountFull({ forecast: async () => forecastWithCensus(CENSUS_VALUE) });

    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).toContain("2 recognised Vitest roots");
    expect(text).toContain("1 Vitest candidate had unsettled ancestry");
    expect(text).toContain("1 recognised Codex batch root");
    expect(text).toContain("Among the rows stable enough to classify, no Codex batch candidates had unsettled ancestry");
    expect(text).toContain("3 recognised browser roots");
    expect(text).toContain("2 browser candidates had unsettled ancestry");
    expect(text).toContain("4 rows changed while they were read and are in no count above");
    expect(text).toContain("5 process rows could not be read and are in no count above");
    expect(text).toContain("880 process-table entries were seen during the pass");
  });

  it("does not present zero roots as clean when rows were unreadable", async () => {
    await mountFull({ forecast: async () => forecastWithCensus({
      ...CENSUS_VALUE,
      census: { ...EMPTY_CENSUS, unreadable: 2 },
    }) });

    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).toContain("No recognised Vitest roots were confirmed");
    expect(text).toContain("No recognised Codex batch roots were confirmed");
    expect(text).toContain("No recognised browser roots were confirmed");
    expect(text).toContain("Among the rows stable enough to classify, no Vitest candidates had unsettled ancestry");
    expect(text).toContain("Among the rows stable enough to classify, no Codex batch candidates had unsettled ancestry");
    expect(text).toContain("Among the rows stable enough to classify, no browser candidates had unsettled ancestry");
    expect(text).toContain("not a clean zero");
    expect(text.toLowerCase()).not.toContain("nothing");
    expect(text.toLowerCase()).not.toContain("running");
  });

  it("marks a last good census stale at its own corrected instant after a failure", async () => {
    const skew = { kind: "known", ms: -5 * 60_000 } as const;
    await mountFull(
      { forecast: async () => forecastWithCensus({
        kind: "failed",
        label: "observed",
        why: "permission denied",
        failedAtMs: COMPUTED_AT + 10_000,
        cadenceMs: 30_000,
        lastGood: {
          census: CENSUS_VALUE.census,
          startedAtMs: CENSUS_VALUE.startedAtMs,
          completedAtMs: CENSUS_VALUE.completedAtMs,
        },
      }) },
      state({ clockSkew: skew }),
    );

    const staleStartedAt = new Date(CENSUS_VALUE.startedAtMs - skew.ms).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const staleCompletedAt = new Date(CENSUS_VALUE.completedAtMs - skew.ms).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const text = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(text).toContain("permission denied");
    expect(text).toContain("stale");
    expect(text).toContain(`ran from ${staleStartedAt} to ${staleCompletedAt}`);
    expect(text).toContain("2 recognised Vitest roots");
  });

  it("renders a valid forecast when the browser cannot parse its census", async () => {
    const api = makeAdmissionApi(async () => new Response(JSON.stringify({
      schema: 1,
      label: "forecast",
      computedAtMs: COMPUTED_AT,
      request: { kind: "test" },
      policy: { gateVersion: 1, explanation: "known", whyWithheld: null },
      outcome: { kind: "not-applicable", why: "no reserve file" },
      census: { kind: "future-census", label: "observed" },
    }), { status: 200 }));

    await mountFull(api);
    const section = container.querySelector('[data-section="admission"]')?.textContent ?? "";
    const census = container.querySelector("[data-admission-census]")?.textContent ?? "";
    expect(section).toContain("The machine has no admission policy");
    expect(section).not.toContain("This browser never got an answer");
    expect(census).toContain("This browser could not read the process census");
  });
});
