// @vitest-environment jsdom
/**
 * The diagnostics section on Box health (plan 260910f Stage 3), and the client
 * that feeds it.
 *
 * The wording is the contract, from Sol's F1: a start stamp is a checkout
 * observation, not a code identity, so a clean one reads "recorded start HEAD
 * <sha>", a dirty one "code revision unknown — base HEAD <sha>, checkout dirty
 * at start", and nothing anywhere says a service "is running" a revision. The
 * three bundle facts stay three, a mismatch is a plain sentence, and unknown
 * is never drawn as "same". The client's parse path is driven through
 * `makeDiagnosticsApi` with its request leaf injected, so a malformed answer
 * is shown to become an explicit unreadable state, never a partial page.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DiagnosticsSection } from "../tools/fleet/web/src/DiagnosticsSection";
import { makeDiagnosticsApi, tabBuild, type DiagnosticsApi, type DiagnosticsView } from "../tools/fleet/web/src/diagnostics-client";
import type { BuildStamp, BuildStampReading, DiagnosticsSummary, StartRevision } from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_SHA = "6e2b9d4f1a0c83e7b5d2f9a1c4e7b0d3f6a9c2e5";
const DAEMON_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const COMPOSED = "2026-09-10T15:00:00.000Z";
const NOW = Date.parse(COMPOSED);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const clean = (sha: string): StartRevision => ({ kind: "known", sha, dirty: false, readAt: "2026-09-10T14:00:00.000Z" });
const build = (builtAt: string, sha = SERVER_SHA): BuildStamp => ({ kind: "known", sha, dirty: false, readAt: builtAt, builtAt });
const stamp = (b: BuildStamp): BuildStampReading => ({ kind: "stamp", stamp: b });

const BUILT = "2026-09-10T13:00:00.000Z";

function summary(over: Partial<DiagnosticsSummary> = {}): DiagnosticsSummary {
  return {
    schema: 1,
    composedAt: COMPOSED,
    dashboard: { instance: "srv-1", start: clean(SERVER_SHA), bundleAtStart: stamp(build(BUILT)), bundleOnDisk: stamp(build(BUILT)) },
    collector: {
      attempted: { kind: "at", at: "2026-09-10T14:58:30.000Z" },
      collected: { kind: "at", at: "2026-09-10T14:58:00.000Z" },
      lastError: { kind: "none" },
    },
    health: { kind: "never", why: "no box-health reading has been taken since this server started" },
    store: {
      path: { kind: "override", label: "OVERSEER_STORE_DIR=/scratch/store", path: "/scratch/store" },
      files: {
        kind: "probed",
        files: [
          { name: "current.json", state: "present", bytes: 110_000, mtimeAgeMs: 30_000, format: "json", schema: 2, schemaUnread: null, tornTail: null },
          { name: "events.jsonl", state: "present", bytes: 900_000, mtimeAgeMs: 5_000, format: "jsonl", schema: "none-declared", schemaUnread: null, tornTail: true },
          { name: "recovery.json", state: "absent" },
          { name: "attention.json", state: "unreadable", why: "attention.json is a symbolic link, which this probe reports and does not follow" },
        ],
      },
    },
    daemon: { kind: "stamped", instanceId: "ov-1", at: "2026-09-10T12:00:00.000Z", revision: clean(DAEMON_SHA) },
    ...over,
  };
}

const answering = (view: DiagnosticsView): DiagnosticsApi => ({ fetch: async () => view });

async function draw(view: DiagnosticsView, tab: BuildStampReading = stamp(build(BUILT))): Promise<string> {
  await act(async () => {
    root.render(<DiagnosticsSection api={answering(view)} nowMs={NOW} tab={tab} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host.textContent ?? "";
}

describe("the services' start stamps (F1 wording)", () => {
  it("a clean start is a recorded start HEAD, for the dashboard and for the daemon", async () => {
    const page = await draw({ kind: "summary", summary: summary() });
    expect(page).toContain(`recorded start HEAD ${SERVER_SHA.slice(0, 8)}`);
    expect(page).toContain(`recorded start HEAD ${DAEMON_SHA.slice(0, 8)}`);
    expect(page).not.toMatch(/is running/);
  });

  it("a dirty start is a code revision unknown, with its base HEAD", async () => {
    const dirty: StartRevision = { kind: "known", sha: SERVER_SHA, dirty: true, readAt: "2026-09-10T14:00:00.000Z" };
    const page = await draw({ kind: "summary", summary: summary({ dashboard: { ...summary().dashboard, start: dirty } }) });
    expect(page).toContain(`code revision unknown — base HEAD ${SERVER_SHA.slice(0, 8)}, checkout dirty at start`);
    expect(page).not.toContain(`recorded start HEAD ${SERVER_SHA.slice(0, 8)}`);
  });

  it("an unknown start, an unstamped daemon, and an uncorrelated daemon each say so in words", async () => {
    const unknown: StartRevision = { kind: "unknown", why: "git rev-parse HEAD exited 128", readAt: "2026-09-10T14:00:00.000Z" };
    const page = await draw({
      kind: "summary",
      summary: summary({ dashboard: { ...summary().dashboard, start: unknown }, daemon: { kind: "not-stamped", instanceId: "ov-1", at: "2026-09-10T12:00:00.000Z" } }),
    });
    expect(page).toContain("code revision unknown — git rev-parse HEAD exited 128");
    expect(page).toContain("not stamped");
    const other = await draw({ kind: "summary", summary: summary({ daemon: { kind: "unknown", why: "there is no checkpoint, so no running instance is named" } }) });
    expect(other).toContain("there is no checkpoint, so no running instance is named");
  });

  it("the job-list question is handed to `overseer diagnose`, not answered", async () => {
    const page = await draw({ kind: "summary", summary: summary() });
    expect(page).toContain("whether the daemon holds this checkout's job list: run overseer diagnose");
  });
});

describe("three bundle facts", () => {
  it("all three the same build says so", async () => {
    const page = await draw({ kind: "summary", summary: summary() });
    expect(page).toContain("all three are the same build");
  });

  it("a newer bundle on disk than the server started with is a plain mismatch line", async () => {
    const newer = stamp(build("2026-09-10T14:30:00.000Z", DAEMON_SHA));
    const page = await draw({ kind: "summary", summary: summary({ dashboard: { ...summary().dashboard, bundleOnDisk: newer } }) }, newer);
    expect(page).toContain("a newer bundle is on disk than this server started with; reload after the dashboard restarts");
    expect(page).not.toContain("all three are the same build");
  });

  it("a tab running a different bundle from the one on disk says reloading this tab loads it", async () => {
    const page = await draw({ kind: "summary", summary: summary() }, stamp(build("2026-09-10T11:00:00.000Z")));
    expect(page).toContain("this tab is running a different bundle from the one on disk");
  });

  it("an unknown bundle is never drawn as the same", async () => {
    const page = await draw(
      { kind: "summary", summary: summary({ dashboard: { ...summary().dashboard, bundleOnDisk: { kind: "unknown", why: "no build stamp at /dist/build-stamp.json" } } }) },
    );
    expect(page).toContain("no build stamp at /dist/build-stamp.json");
    expect(page).toContain("cannot compare");
    expect(page).not.toContain("all three are the same build");
    const tabUnknown = await draw({ kind: "summary", summary: summary() }, { kind: "unknown", why: "this bundle carries no build stamp" });
    expect(tabUnknown).not.toContain("all three are the same build");
    expect(tabUnknown).toContain("cannot compare");
  });
});

describe("clocks and store files", () => {
  it("each collector clock has its age, a never has its reason, and an error its words", async () => {
    const page = await draw({
      kind: "summary",
      summary: summary({ collector: { ...summary().collector, lastError: { kind: "error", message: "tmux timed out after 30s" } } }),
    });
    expect(page).toContain("1m 30s ago");
    expect(page).toContain("2m ago");
    expect(page).toContain("tmux timed out after 30s");
    expect(page).toContain("no box-health reading has been taken since this server started");
  });

  it("store files are a compact table inside a horizontal scroller, with the store's label", async () => {
    const page = await draw({ kind: "summary", summary: summary() });
    expect(page).toContain("OVERSEER_STORE_DIR=/scratch/store");
    const table = host.querySelector('[data-testid="diagnostics-store-files"] table');
    expect(table).not.toBeNull();
    expect(table?.parentElement?.className).toContain("tw:overflow-x-auto");
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((row) => row.textContent ?? "");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("current.json");
    expect(rows[0]).toContain("schema 2");
    expect(rows[1]).toContain("torn tail");
    expect(rows[2]).toContain("absent");
    expect(rows[3]).toContain("symbolic link");
  });

  it("has nothing to press", async () => {
    await draw({ kind: "summary", summary: summary() });
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("the client", () => {
  const respond = (status: number, body: string) => async () => new Response(body, { status, headers: { "content-type": "application/json" } });

  it("a well-formed 200 is a summary", async () => {
    const view = await makeDiagnosticsApi(respond(200, JSON.stringify(summary()))).fetch();
    expect(view.kind).toBe("summary");
  });

  it("malformed JSON, a wrong shape, a non-2xx and a thrown request are each an explicit no-answer", async () => {
    const notJson = await makeDiagnosticsApi(respond(200, "{ nope")).fetch();
    expect(notJson).toMatchObject({ kind: "no-answer" });
    const broken = { ...summary(), daemon: { kind: "stamped" } };
    const wrong = await makeDiagnosticsApi(respond(200, JSON.stringify(broken))).fetch();
    expect(wrong.kind).toBe("no-answer");
    if (wrong.kind === "no-answer") expect(wrong.why).toContain("daemon");
    const failed = await makeDiagnosticsApi(respond(500, JSON.stringify({ schema: 1, kind: "error", why: "composing threw: boom" }))).fetch();
    expect(failed.kind).toBe("no-answer");
    if (failed.kind === "no-answer") expect(failed.why).toContain("boom");
    const thrown = await makeDiagnosticsApi(async () => {
      throw new TypeError("network down");
    }).fetch();
    expect(thrown.kind).toBe("no-answer");
  });

  it("a no-answer is drawn as itself, with none of the summary's lines", async () => {
    const page = await draw({ kind: "no-answer", why: "this browser could not reach the dashboard" });
    expect(page).toContain("this browser could not reach the dashboard");
    expect(page).not.toContain("recorded start HEAD");
    expect(page).not.toContain("all three are the same build");
  });

  it("a bundle with no compiled-in stamp reads as unknown, not as a stamp", () => {
    // vitest does not apply vite's `define`, so `__FLEET_BUILD__` is absent here.
    expect(tabBuild().kind).toBe("unknown");
  });
});

describe("the mount", () => {
  /* Through HealthPanel and the DEFAULT client, so the one-line mount and the
     real HTTP path are what is under test — a section that renders perfectly
     and is mounted nowhere passes every test above. `fetch` is swapped by hand
     and restored, and answers only the one URL this section asks for. */
  it("Box health mounts the section, which asks api/diagnostics through the real client", async () => {
    const { HealthPanel } = await import("../tools/fleet/web/src/HealthPanel");
    const { CLOCK_SKEW_UNMEASURED } = await import("../tools/fleet/web/src/types");
    const asked: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return String(input) === "api/diagnostics"
        ? new Response(JSON.stringify(summary()), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      const actions = {
        api: { feed: async () => ({ ok: false, why: "not part of this fixture" }) },
        feed: null,
        error: null,
        asked: false,
        lastGoodAt: null,
        pollMs: 3_600_000,
        refresh: () => undefined,
      } as unknown as import("../tools/fleet/web/src/useActions").ActionsUi;
      await act(async () => {
        root.render(
          <HealthPanel
            health={null}
            actions={actions}
            rows={[]}
            now={NOW}
            skew={CLOCK_SKEW_UNMEASURED}
            historyApi={{ window: async () => ({ kind: "no-answer", why: "not part of this fixture" }) } as import("../tools/fleet/web/src/health-history-client").HistoryApi}
            admissionApi={{ forecast: () => new Promise(() => undefined) }}
          />,
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.querySelector('[data-testid="diagnostics-section"]')).not.toBeNull();
      expect(asked).toContain("api/diagnostics");
      expect(host.textContent).toContain(`recorded start HEAD ${SERVER_SHA.slice(0, 8)}`);
    } finally {
      globalThis.fetch = original;
    }
  });
});
