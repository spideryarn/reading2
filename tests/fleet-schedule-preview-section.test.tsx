// @vitest-environment jsdom
/**
 * **"What the scheduler would run next"** — the section on the Overseer tab.
 * Plan 260910e § D7, Stage 3.
 *
 * Driven through its seam (`ScheduleApi`), never through `fetch`: the route and
 * the client's wire arms are tested in `fleet-schedule-route.test.ts`, and this
 * file is about what reaches the screen.
 *
 * What it pins down:
 *
 * - **every absence says which nothing it is** — asking, no file, a file the
 *   server could not read, one this page could not read, a schema either side
 *   does not know, and this page never reaching the route — each in the voice of
 *   whoever failed to answer (fleet-dashboard-modes.md § Absence is stated);
 * - **a dry-run row and a changed document are visibly marked**, the second
 *   outside the disclosure too, because it is the roadmap's acceptance sentence;
 * - **times are London first, with the day marked against London** — the
 *   `zonedLine` misreading Stage 2 found would print `(+1d)` here;
 * - **opening the Overseer tab triggers the read**, through the prop
 *   `OverseerPanel` defaults, and the section keeps asking every minute.
 *
 * Row assertions read a specific element with the tooltips' `sr-only` spans
 * removed, because those spans begin " — " and carry whole sentences that would
 * answer a `toContain` on their own. No id here is a uuid.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSchedulePreview } from "../tools/fleet/schedule-parse.js";
import type { SchedulePreview, SchedulePreviewJob } from "../tools/fleet/wire.js";
import type { ActionsApi } from "../tools/fleet/web/src/actions-client";
import { OverseerPanel } from "../tools/fleet/web/src/OverseerPanel";
import { SchedulePreview as ScheduleSection } from "../tools/fleet/web/src/SchedulePreview";
import { SCHEDULE_POLL_MS, type ScheduleApi, type ScheduleView } from "../tools/fleet/web/src/schedule-client";
import { CLOCK_SKEW_UNMEASURED, type OverseerView } from "../tools/fleet/web/src/types";
import type { ActionsUi } from "../tools/fleet/web/src/useActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * The fixture: a preview as the daemon writes it, read by the one parser.
 * ------------------------------------------------------------------ */

const WRITTEN = "2026-09-10T12:00:00.000Z";
const SERVED = "2026-09-10T12:00:30.000Z";
const RECEIVED_MS = Date.parse(SERVED);

const UNCHANGED_DOC: SchedulePreviewJob["documents"][number] = {
  path: "docs/fixture/section-unchanged.md",
  pinned: { kind: "pinned", sha256: "e".repeat(64) },
  current: { kind: "read", sha256: "e".repeat(64), when: "this-checkpoint" },
  changed: "no",
};

const DRY: SchedulePreviewJob = {
  jobId: "section-dry-job",
  resourceClass: "claude-session",
  dispatch: { kind: "dry-run", why: "a section fixture — it never launches" },
  verdict: { kind: "dry-run", sentence: "due, and in dry-run: the scheduler records it and launches nothing", next: { kind: "due-now" } },
  lastAttempt: { kind: "never" },
  schedule: { everyMs: 86_400_000, launcherLeaseMs: 3_600_000, initialDelayMs: 7_200_000 },
  sessionTimeout: { kind: "run-spec", timeoutMinutes: 5, access: "read-only" },
  sessionNoOverlap: "enforced",
  prompt: "reply with one line and stop",
  behaviourHash: { kind: "computed", hash: "465648545712" },
  authorisedHash: "465648545712",
  documents: [UNCHANGED_DOC],
};

const WAITING: SchedulePreviewJob = {
  ...DRY,
  jobId: "section-waiting-job",
  dispatch: { kind: "live" },
  /* 23:30 UTC is 00:30 London the NEXT day in BST — the instant that tells a
     London-first line marked against London from one marked against UTC. */
  verdict: { kind: "waiting", sentence: "not due for another 11h", next: { kind: "next-due", at: "2026-09-10T23:30:00.000Z" } },
  lastAttempt: {
    kind: "finished",
    occurrenceId: "section-waiting-job@2026-09-10T11:00:00.000Z#465648545712",
    reservedAt: "2026-09-10T11:00:00.000Z",
    finishedAt: "2026-09-10T11:00:04.000Z",
    outcome: { kind: "exited", code: 0 },
    meaning: "for a session job the ledger follows the gjd-remote launcher, not the session",
  },
};

const EDITED: SchedulePreviewJob = {
  ...DRY,
  jobId: "section-edited-job",
  dispatch: { kind: "live" },
  verdict: {
    kind: "unauthorised",
    sentence: "a document it leans on has changed since it was pinned",
    drift: ["docs/fixture/section-edited.md: pinned aaaaaaaa…, now cccccccc…"],
    next: { kind: "none", why: "not until somebody reads what changed and re-pins it" },
  },
  behaviourHash: { kind: "computed", hash: "111111111111" },
  authorisedHash: "222222222222",
  documents: [
    {
      path: "docs/fixture/section-edited.md",
      pinned: { kind: "pinned", sha256: "a".repeat(64) },
      current: { kind: "read", sha256: "c".repeat(64), when: "this-checkpoint" },
      changed: "yes",
    },
  ],
};

const PREVIEW: SchedulePreview = {
  schema: 1,
  writtenAt: WRITTEN,
  instanceId: "section-fixture-instance",
  list: { kind: "given", listRevision: "abcdef012345" },
  capabilities: { session: false, rules: false },
  arming: { kind: "none", why: "the scheduler has not been armed on this box" },
  history: { kind: "intact" },
  sessionHistory: { kind: "intact" },
  headline: { kind: "off", why: "not armed", at: WRITTEN },
  missedRunPolicy: { kind: "one-run", sentence: "a missed run runs once" },
  caveat: "As of the instant it was written.",
  jobs: [DRY, WAITING, EDITED],
};

/** The preview with one row from a newer daemon, whose verdict this build does not know. */
function withFutureRow(): unknown {
  const raw = JSON.parse(JSON.stringify(PREVIEW)) as { jobs: unknown[] };
  raw.jobs.push({ ...WAITING, jobId: "section-future-job", verdict: { kind: "a-verdict-from-a-newer-daemon", sentence: "x", next: { kind: "due-now" } } });
  return raw;
}

function previewView(raw: unknown = PREVIEW): ScheduleView {
  const parsed = parseSchedulePreview(raw);
  if (parsed.kind !== "preview") throw new Error(`the fixture did not parse: ${JSON.stringify(parsed)}`);
  return { kind: "preview", preview: parsed.preview, servedAt: SERVED, receivedAtMs: RECEIVED_MS };
}

/* ------------------------------------------------------------------ *
 * Drawing.
 * ------------------------------------------------------------------ */

function recording(answer: () => Promise<ScheduleView>): { api: ScheduleApi; calls: () => number } {
  let count = 0;
  return {
    api: {
      read: () => {
        count += 1;
        return answer();
      },
    },
    calls: () => count,
  };
}

async function draw(view: ScheduleView, now = RECEIVED_MS): Promise<void> {
  const { api } = recording(async () => view);
  await act(async () => root.render(<ScheduleSection api={api} now={now} currentInstanceId={null} />));
}

/** An element's words as a sighted reader sees them: the tooltips' sr-only copies removed. */
function visible(selector: string, within: ParentNode = container): string {
  const element = within.querySelector(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll(".tw\\:sr-only")) hidden.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function row(jobId: string): Element {
  const found = container.querySelector(`[data-schedule-job="${jobId}"]`);
  if (found === null) throw new Error(`no row for ${jobId}`);
  return found;
}

/* ------------------------------------------------------------------ */

describe("every absence says which nothing it is", () => {
  it("says it is asking before any answer, and draws no rows", async () => {
    const { api } = recording(() => new Promise<ScheduleView>(() => undefined));
    await act(async () => root.render(<ScheduleSection api={api} now={RECEIVED_MS} currentInstanceId={null} />));
    expect(visible('[data-schedule-state="asking"]')).toContain("Asking");
    expect(container.querySelectorAll("[data-schedule-job]")).toHaveLength(0);
  });

  const cases: { name: string; view: ScheduleView; state: string; says: string[] }[] = [
    {
      name: "no file: the server's own sentence",
      view: { kind: "absent", why: "there is no schedule.json: the running daemon predates this build", servedAt: SERVED },
      state: "absent",
      says: ["No preview", "predates this build"],
    },
    {
      name: "a file the server could not read",
      view: { kind: "unreadable", source: "server", why: "schedule.json could not be read (EACCES)", servedAt: SERVED },
      state: "unreadable",
      says: ["The dashboard could not read", "EACCES"],
    },
    {
      name: "a file this page could not read",
      view: { kind: "unreadable", source: "page", why: "job x has no jobId", servedAt: SERVED },
      state: "unreadable",
      says: ["This page could not read", "no jobId"],
    },
    {
      name: "a schema the dashboard does not know",
      view: { kind: "unsupported-schema", source: "server", schema: 2, known: 1, servedAt: SERVED },
      state: "unsupported-schema",
      says: ["schema 2", "this dashboard reads schema 1"],
    },
    {
      name: "a schema this page does not know",
      view: { kind: "unsupported-schema", source: "page", schema: 2, known: 1, servedAt: SERVED },
      state: "unsupported-schema",
      says: ["schema 2", "this page reads schema 1"],
    },
    {
      name: "this page never reached the route",
      view: { kind: "no-answer", why: "this page could not reach the dashboard's schedule route: Failed to fetch" },
      state: "no-answer",
      says: ["This page got no answer", "Failed to fetch"],
    },
  ];

  it.each(cases)("$name", async ({ view, state, says }) => {
    await draw(view);
    const text = visible(`[data-schedule-state="${state}"]`);
    for (const words of says) expect(text).toContain(words);
    expect(container.querySelectorAll("[data-schedule-job]")).toHaveLength(0);
  });

  it("says the list is empty rather than drawing an empty list", async () => {
    await draw(previewView({ ...PREVIEW, jobs: [] }));
    expect(visible('[data-slot="schedule-empty"]')).toContain("holds no jobs");
  });

  it("says the daemon was handed no list, in its own words", async () => {
    await draw(previewView({ ...PREVIEW, list: { kind: "not-given", why: "started without --jobs" }, jobs: [] }));
    expect(visible('[data-slot="schedule-empty"]')).toContain("started without --jobs");
  });
});

describe("the preview", () => {
  it("leads with the daemon's word and its sentence, and the file's own caveat and age", async () => {
    await draw(previewView());
    expect(visible('[data-slot="schedule-headline"]')).toContain("OFF — not armed");
    const caveat = visible('[data-slot="schedule-caveat"]');
    expect(caveat).toContain("30s");
    expect(caveat).toContain("As of the instant it was written.");
    expect(container.querySelector('[data-slot="schedule-caveat"]')?.getAttribute("data-stale")).toBe("no");
  });

  it("says loudly when the file is older than the caveat allows", async () => {
    await draw(previewView(), RECEIVED_MS + 10 * 60_000);
    expect(container.querySelector('[data-slot="schedule-caveat"]')?.getAttribute("data-stale")).toBe("yes");
  });

  it("marks a dry-run row visibly, and a live one as live", async () => {
    await draw(previewView());
    const dry = row("section-dry-job").querySelector("[data-dispatch]");
    expect(dry?.getAttribute("data-dispatch")).toBe("dry-run");
    expect(visible("[data-dispatch]", row("section-dry-job")).toLowerCase()).toContain("dry run");
    expect(row("section-waiting-job").querySelector("[data-dispatch]")?.getAttribute("data-dispatch")).toBe("live");
  });

  it("draws a changed document loudly, on the row itself and inside the disclosure, with both digests", async () => {
    await draw(previewView());
    const edited = row("section-edited-job");
    expect(visible('[data-slot="documents-changed"]', edited)).toContain("CHANGED");
    const document = visible('[data-document-changed="yes"]', edited);
    expect(document).toContain("CHANGED since it was authorised");
    expect(document).toContain("a".repeat(64));
    expect(document).toContain("c".repeat(64));
    /* …and a row whose documents are as pinned says so, and carries no alarm. */
    const waiting = row("section-waiting-job");
    expect(waiting.querySelector('[data-slot="documents-changed"]')).toBeNull();
    expect(visible('[data-document-changed="no"]', waiting)).toContain("as pinned");
  });

  it("prints the next run London first, with the day marked against London, and relative", async () => {
    await draw(previewView());
    const next = visible('[data-slot="next"]', row("section-waiting-job"));
    expect(next).toContain("2026-09-11 00:30 London · 23:30 UTC (−1d) · 02:30 Athens");
    /* THE MISREADING STAGE 2 FOUND: a day mark taken against UTC. */
    expect(next).not.toContain("(+1d)");
    expect(next).toContain("in 11h 29m");
  });

  it("shows the verdict in the daemon's words, and the last attempt", async () => {
    await draw(previewView());
    expect(visible('[data-slot="verdict"]', row("section-waiting-job"))).toContain("WAITING — not due for another 11h");
    expect(visible('[data-slot="last"]', row("section-waiting-job"))).toContain("exit 0");
    expect(visible('[data-slot="last"]', row("section-dry-job"))).toContain("never run");
  });

  it("puts the prompt, the pin, the lease and the authorised run spec behind the disclosure", async () => {
    await draw(previewView());
    const details = visible("details", row("section-edited-job"));
    expect(details).toContain("reply with one line and stop");
    expect(details).toContain("NOT the job that was authorised");
    expect(details).toContain("launcher lease 1h");
    expect(details).toContain("session timeout: 5 min, read-only access");
    expect(details).toContain("session no-overlap: enforced");
  });

  it("draws a session job's launch as its last attempt, the two Stage B verdicts in their own words, and a lost launch journal", async () => {
    const resumed: SchedulePreviewJob = {
      ...DRY,
      jobId: "section-resume-job",
      dispatch: { kind: "live" },
      verdict: { kind: "resume", sentence: "its occurrence is waiting for admission: the scheduler resumes it", next: { kind: "due-now" } },
      lastAttempt: {
        kind: "launch",
        occurrenceId: "section-resume-job@2026-09-10T11:00:00.000Z#540c65ff660b",
        launchId: `lo-${"0b".repeat(10)}`,
        plannedAt: "2026-09-10T11:00:00.000Z",
        state: "waiting-admission",
        standing: "resumable",
        endedAt: null,
        why: "waiting for admission: the one claude-session slot is taken",
        meaning: "the launch journal's own record of this occurrence",
      },
    };
    const held: SchedulePreviewJob = {
      ...DRY,
      jobId: "section-usage-job",
      dispatch: { kind: "live" },
      verdict: { kind: "usage-held", sentence: "due, and no pool account may start a session now", next: { kind: "none", why: "nobody can date it" } },
    };
    await draw(previewView({ ...PREVIEW, sessionHistory: { kind: "lost", why: "a torn line at 3" }, jobs: [resumed, held] }));
    expect(visible('[data-slot="verdict"]', row("section-resume-job"))).toContain("WOULD RESUME");
    const last = visible('[data-slot="last"]', row("section-resume-job"));
    expect(last).toContain("waiting-admission");
    expect(last).toContain("the one claude-session slot is taken");
    expect(visible('[data-slot="verdict"]', row("section-usage-job"))).toContain("HELD FOR A POOL ACCOUNT");
    expect(container.textContent).toContain("the launch journal is LOST, so every session job is held — a torn line at 3");
    expect(container.textContent).toContain("launch protocol no");
  });

  it("gives a row this build cannot read its own line, naming the job", async () => {
    await draw(previewView(withFutureRow()));
    const text = visible('[data-schedule-row-unreadable="section-future-job"]');
    expect(text).toContain("section-future-job");
    expect(text).toContain("does not know");
  });
});

describe("mounted on the Overseer tab", () => {
  function actions(): ActionsUi {
    return {
      api: {} as ActionsApi,
      feed: null,
      error: null,
      asked: false,
      lastGoodAt: null,
      pollMs: 3_600_000,
      refresh: () => undefined,
    };
  }

  function drawPanel(api: ScheduleApi, overseer: OverseerView | null = null): void {
    act(() =>
      root.render(
        <OverseerPanel
          actions={actions()}
          rows={[]}
          unreadableRows={null}
          overseer={overseer}
          usage={null}
          codex={null}
          now={RECEIVED_MS}
          receivedAt={null}
          skew={CLOCK_SKEW_UNMEASURED}
          scheduleApi={api}
        />,
      ),
    );
  }

  it("opening the tab asks for the preview once, and draws the answer", async () => {
    const { api, calls } = recording(async () => previewView());
    expect(calls()).toBe(0);
    drawPanel(api);
    await act(async () => undefined);
    expect(calls()).toBe(1);
    expect(container.querySelector('[data-section="schedule-preview"]')).not.toBeNull();
    expect(row("section-dry-job")).not.toBeNull();
  });

  it("says when the preview belongs to another daemon instance", async () => {
    const current: OverseerView = {
      kind: "published",
      status: {
        schema: 2,
        writtenAt: SERVED,
        lastGoodSnapshotAt: SERVED,
        sourceStaleAfterMs: 300_000,
        heartbeat: {
          kind: "reading",
          pid: 42,
          instanceId: "section-current-instance",
          startedAt: WRITTEN,
          lastTickAt: SERVED,
          ticks: 2,
        },
        scheduler: { kind: "off", why: "not armed", at: SERVED },
        register: { kind: "read", total: 0, work: { kind: "unavailable", why: "not relevant to this test" }, sessions: [] },
      },
    };
    const { api } = recording(async () => previewView());
    drawPanel(api, current);
    await act(async () => undefined);

    const warning = visible('[data-slot="schedule-instance-mismatch"]');
    expect(warning).toContain("FROM ANOTHER DAEMON INSTANCE");
    expect(warning).toContain("section-fixture-instance");
    expect(warning).toContain("section-current-instance");
  });

  it("asks again every minute while it is open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { api, calls } = recording(async () => previewView());
    drawPanel(api);
    await act(async () => undefined);
    expect(calls()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(SCHEDULE_POLL_MS);
    });
    expect(calls()).toBe(2);
  });
});
