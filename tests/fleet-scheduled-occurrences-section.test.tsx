// @vitest-environment jsdom
/**
 * **"What the scheduler has launched"** — the section on the Overseer tab.
 * Plan 260910f-scheduled-dispatch § D7, Stage A.
 *
 * Driven through its seam (`OccurrencesApi`), never through `fetch`: the routes
 * and the client's wire arms are `fleet-occurrences-route.test.ts`'s.
 *
 * What it pins down:
 *
 * - **every absence says which nothing it is**, in the six arms the schedule
 *   preview has, each in the voice of whoever failed;
 * - **a failed occurrence is red and names its kind** — TIMED OUT, not a
 *   generic "failed" — and a succeeded one is not red; UNKNOWN is the warning
 *   tone and shows the command that disposes of it;
 * - **the answer link is there only when an answer is**, and says when it is
 *   not usable;
 * - **older occurrences sit behind a disclosure**, and the ones the file left
 *   out are a count;
 * - **a journal not read whole is said**, because an empty list would otherwise
 *   read as "nothing ran";
 * - **mounted by OverseerPanel** through a defaulted prop.
 *
 * Row assertions read a specific element with the tooltips' `sr-only` spans
 * removed, because those spans begin " — " and carry whole sentences that would
 * answer a `toContain` on their own. No id here is a uuid.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseOccurrencesFile } from "../tools/fleet/occurrences-parse.js";
import type { ScheduledOccurrence, ScheduledOccurrencesFile, ScheduledOccurrencesJob } from "../tools/fleet/wire.js";
import type { ActionsApi } from "../tools/fleet/web/src/actions-client";
import { OCCURRENCES_POLL_MS, type OccurrencesApi, type OccurrencesView } from "../tools/fleet/web/src/occurrences-client";
import { OverseerPanel } from "../tools/fleet/web/src/OverseerPanel";
import { ScheduledOccurrences } from "../tools/fleet/web/src/ScheduledOccurrences";
import type { ScheduleApi } from "../tools/fleet/web/src/schedule-client";
import { CLOCK_SKEW_UNMEASURED } from "../tools/fleet/web/src/types";
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
 * The fixture.
 * ------------------------------------------------------------------ */

const WRITTEN = "2026-09-10T12:00:00.000Z";
const SERVED = "2026-09-10T12:00:30.000Z";
const RECEIVED_MS = Date.parse(SERVED);

const BASE: ScheduledOccurrence = {
  launchOccurrenceId: "lo-1111111111111111111a",
  schedulerOccurrenceId: "section-occ-timeout@2026-09-10T11:00:00.000Z#465648545712",
  scheduledAt: "2026-09-10T11:00:00.000Z",
  behaviourHash: "465648545712",
  plannedAt: "2026-09-10T11:00:01.000Z",
  updatedAt: "2026-09-10T11:05:02.000Z",
  attempts: 1,
  state: "completed",
  run: { timeoutMinutes: 5, access: "read-only", account: "pool-a" },
  result: { kind: "timed-out", why: "the wrapper stopped it at its 5-minute limit", at: "2026-09-10T11:05:02.000Z" },
  answer: { kind: "present", attempt: 1, bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", usable: false },
  transcriptPath: "/scratch/launches/o/lo-1111111111111111111a/a1/transcript.ndjson",
  tmuxSession: null,
  commands: { cancel: null, dispose: null },
};

const OLDER_SUCCEEDED: ScheduledOccurrence = {
  ...BASE,
  launchOccurrenceId: "lo-2222222222222222222b",
  scheduledAt: "2026-09-09T11:00:00.000Z",
  result: { kind: "succeeded", why: "exit 0, a usable answer, no denials", at: "2026-09-09T11:02:00.000Z" },
  answer: { kind: "present", attempt: 1, bytes: 21, sha256: "0123456789abcdef".repeat(4), usable: true },
};

const TIMED_OUT_JOB: ScheduledOccurrencesJob = {
  jobId: "section-occ-timeout",
  dispatch: { kind: "live" },
  run: { timeoutMinutes: 5, access: "read-only" },
  /* 23:30 UTC is 00:30 London the next day in BST. */
  next: { kind: "next-due", at: "2026-09-10T23:30:00.000Z" },
  occurrences: [BASE, OLDER_SUCCEEDED],
  omitted: 4,
};

const SUCCEEDED_JOB: ScheduledOccurrencesJob = {
  jobId: "section-occ-good",
  dispatch: { kind: "live" },
  run: { timeoutMinutes: 30, access: "write" },
  next: { kind: "due-now" },
  occurrences: [{ ...OLDER_SUCCEEDED, launchOccurrenceId: "lo-3333333333333333333c", scheduledAt: "2026-09-10T10:00:00.000Z" }],
  omitted: 0,
};

const UNKNOWN_JOB: ScheduledOccurrencesJob = {
  jobId: "section-occ-unknown",
  dispatch: { kind: "live" },
  run: { timeoutMinutes: 5, access: "review" },
  next: { kind: "none", why: "held until the unknown occurrence is disposed of" },
  occurrences: [
    {
      ...BASE,
      launchOccurrenceId: "lo-4444444444444444444d",
      state: "outcome-unknown",
      result: { kind: "unknown", why: "the launcher may have run and nothing recorded what it did", at: "2026-09-10T11:06:00.000Z" },
      answer: { kind: "absent" },
      transcriptPath: null,
      commands: { cancel: null, dispose: "npx tsx scripts/overseer-launches.ts dispose lo-4444444444444444444d" },
    },
  ],
  omitted: 0,
};

const NEVER_JOB: ScheduledOccurrencesJob = {
  jobId: "section-occ-never",
  dispatch: { kind: "dry-run", why: "a section fixture" },
  run: { timeoutMinutes: 5, access: "read-only" },
  next: { kind: "due-now" },
  occurrences: [],
  omitted: 0,
};

const FILE: ScheduledOccurrencesFile = {
  schema: 1,
  writtenAt: WRITTEN,
  instanceId: "section-occ-instance",
  journal: { kind: "whole" },
  jobs: [TIMED_OUT_JOB, SUCCEEDED_JOB, UNKNOWN_JOB, NEVER_JOB],
};

function occurrencesView(raw: unknown = FILE): OccurrencesView {
  const parsed = parseOccurrencesFile(raw);
  if (parsed.kind !== "parsed") throw new Error(`the fixture did not parse: ${JSON.stringify(parsed)}`);
  return { kind: "occurrences", file: parsed.file, servedAt: SERVED, receivedAtMs: RECEIVED_MS };
}

function recording(answer: () => Promise<OccurrencesView>): { api: OccurrencesApi; calls: () => number } {
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

async function draw(view: OccurrencesView): Promise<void> {
  const { api } = recording(async () => view);
  await act(async () => root.render(<ScheduledOccurrences api={api} now={RECEIVED_MS} />));
}

function visible(selector: string, within: ParentNode = container): string {
  const element = within.querySelector(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll(".tw\\:sr-only")) hidden.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function job(jobId: string): Element {
  const found = container.querySelector(`[data-occurrences-job="${jobId}"]`);
  if (found === null) throw new Error(`no row for ${jobId}`);
  return found;
}

function last(jobId: string): Element {
  const found = job(jobId).querySelector('[data-slot="last-occurrence"]');
  if (found === null) throw new Error(`no last occurrence for ${jobId}`);
  return found;
}

/* ------------------------------------------------------------------ */

describe("every absence says which nothing it is", () => {
  it("says it is asking before any answer", async () => {
    const { api } = recording(() => new Promise<OccurrencesView>(() => undefined));
    await act(async () => root.render(<ScheduledOccurrences api={api} now={RECEIVED_MS} />));
    expect(visible('[data-occurrences-state="asking"]')).toContain("Asking");
    expect(container.querySelectorAll("[data-occurrences-job]")).toHaveLength(0);
  });

  const cases: { name: string; view: OccurrencesView; state: string; says: string[] }[] = [
    {
      name: "no file: the server's own sentence",
      view: { kind: "absent", why: "there is no occurrences.json: the running daemon predates this build", servedAt: SERVED },
      state: "absent",
      says: ["No record of launches", "predates this build"],
    },
    {
      name: "a file the server could not read",
      view: { kind: "unreadable", source: "server", why: "occurrences.json could not be read (EACCES)", servedAt: SERVED },
      state: "unreadable",
      says: ["The dashboard could not read", "EACCES"],
    },
    {
      name: "a file this page could not read",
      view: { kind: "unreadable", source: "page", why: "the occurrences file has no jobs list", servedAt: SERVED },
      state: "unreadable",
      says: ["This page could not read", "no jobs list"],
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
      view: { kind: "no-answer", why: "this page could not reach the dashboard's occurrences route: Failed to fetch" },
      state: "no-answer",
      says: ["This page got no answer", "Failed to fetch"],
    },
  ];

  it.each(cases)("$name", async ({ view, state, says }) => {
    await draw(view);
    const text = visible(`[data-occurrences-state="${state}"]`);
    for (const words of says) expect(text).toContain(words);
    expect(container.querySelectorAll("[data-occurrences-job]")).toHaveLength(0);
  });

  it("says a job that has never launched has never launched, and says the list may be missing launches when the journal was not whole", async () => {
    await draw(occurrencesView());
    expect(visible('[data-slot="last-occurrence"]', job("section-occ-never"))).toContain("never launched");
    expect(container.querySelector('[data-slot="journal"]')?.getAttribute("data-journal")).toBe("whole");

    for (const journal of [
      { kind: "history-lost", why: "a line of the journal is torn" },
      { kind: "not-open", why: "the journal is held by another process" },
    ]) {
      await draw(occurrencesView({ ...FILE, journal }));
      const text = visible('[data-slot="journal"]');
      expect(text).toContain("may be missing launches");
      expect(text).toContain(journal.why);
    }
  });
});

describe("the last occurrence", () => {
  it("a failure is red and names its own kind, with its why, and the attempt count", async () => {
    await draw(occurrencesView());
    const result = last("section-occ-timeout").querySelector('[data-slot="result"]');
    expect(result?.getAttribute("data-result")).toBe("timed-out");
    expect(result?.getAttribute("data-tone")).toBe("alarm");
    expect(result?.querySelector('[data-slot="pill"]')?.className).toContain("tw:bg-alarm");
    const text = visible('[data-slot="last-occurrence"]', job("section-occ-timeout"));
    expect(text).toContain("TIMED OUT");
    expect(text).toContain("the wrapper stopped it at its 5-minute limit");
    expect(text).toContain("1 attempt");
    expect(text).toContain("/scratch/launches/o/lo-1111111111111111111a/a1/transcript.ndjson");
  });

  it("a succeeded one is not red, and links to its answer", async () => {
    await draw(occurrencesView());
    const result = last("section-occ-good").querySelector('[data-slot="result"]');
    expect(result?.getAttribute("data-result")).toBe("succeeded");
    expect(result?.getAttribute("data-tone")).not.toBe("alarm");
    expect(result?.querySelector('[data-slot="pill"]')?.className).not.toContain("tw:bg-alarm");
    const link = last("section-occ-good").querySelector('a[data-slot="answer-link"]');
    expect(link?.getAttribute("href")).toBe("api/overseer/occurrences/lo-3333333333333333333c/answer");
    expect(visible('a[data-slot="answer-link"]', last("section-occ-good"))).toBe("answer");
  });

  it("an answer that is not usable is linked and marked empty or unusable", async () => {
    await draw(occurrencesView());
    const text = visible('[data-slot="answer"]', last("section-occ-timeout"));
    expect(text).toContain("answer");
    expect(text).toContain("(empty or unusable)");
  });

  it("UNKNOWN is the warning tone, has no answer link, and shows the command that disposes of it", async () => {
    await draw(occurrencesView());
    const result = last("section-occ-unknown").querySelector('[data-slot="result"]');
    expect(result?.getAttribute("data-tone")).toBe("unknown");
    expect(visible('[data-slot="result"]', last("section-occ-unknown"))).toContain("UNKNOWN");
    expect(last("section-occ-unknown").querySelector('a[data-slot="answer-link"]')).toBeNull();
    expect(visible('[data-slot="command"]', last("section-occ-unknown"))).toContain("npx tsx scripts/overseer-launches.ts dispose lo-4444444444444444444d");
  });

  it("SUPERSEDED is neither danger nor success: its own label, a neutral tone, and the abandon's reason (M13)", async () => {
    const superseded: ScheduledOccurrencesJob = {
      ...SUCCEEDED_JOB,
      jobId: "section-occ-superseded",
      occurrences: [
        {
          ...BASE,
          launchOccurrenceId: "lo-6666666666666666666f",
          state: "failed-before-launch",
          attempts: 0,
          result: { kind: "superseded", why: "superseded by fedcba987654", at: "2026-09-10T11:04:00.000Z" },
          answer: { kind: "absent" },
          transcriptPath: null,
        },
      ],
    };
    await draw(occurrencesView({ ...FILE, jobs: [superseded, SUCCEEDED_JOB] }));
    const result = last("section-occ-superseded").querySelector('[data-slot="result"]');
    expect(result?.getAttribute("data-result")).toBe("superseded");
    const tone = result?.getAttribute("data-tone");
    expect(tone).not.toBe("alarm");
    /* NOT THE SUCCEEDED TONE EITHER — read off the real succeeded row, not a restated word. */
    expect(tone).not.toBe(last("section-occ-good").querySelector('[data-slot="result"]')?.getAttribute("data-tone"));
    expect(result?.querySelector('[data-slot="pill"]')?.className).not.toContain("tw:bg-alarm");
    const text = visible('[data-slot="last-occurrence"]', job("section-occ-superseded"));
    expect(text).toContain("SUPERSEDED");
    expect(text).toContain("superseded by fedcba987654");
  });

  it("a running one shows its cancel command", async () => {
    const running: ScheduledOccurrencesJob = {
      ...SUCCEEDED_JOB,
      jobId: "section-occ-running",
      occurrences: [
        {
          ...BASE,
          launchOccurrenceId: "lo-5555555555555555555e",
          state: "observed-running",
          result: { kind: "running", why: "its tmux session is alive", at: null },
          answer: { kind: "absent" },
          tmuxSession: "sched-section-occ-running",
          commands: { cancel: "tmux kill-session -t '=sched-section-occ-running'", dispose: null },
        },
      ],
    };
    await draw(occurrencesView({ ...FILE, jobs: [running] }));
    expect(visible('[data-slot="command"]', last("section-occ-running"))).toContain("tmux kill-session -t '=sched-section-occ-running'");
    expect(visible('[data-slot="last-occurrence"]', job("section-occ-running"))).toContain("sched-section-occ-running");
  });
});

describe("each job", () => {
  it("shows its run spec and its next occurrence, London first", async () => {
    await draw(occurrencesView());
    expect(visible('[data-slot="run"]', job("section-occ-good"))).toContain("30 min");
    expect(visible('[data-slot="run"]', job("section-occ-good"))).toContain("write");
    const next = visible('[data-slot="next"]', job("section-occ-timeout"));
    expect(next).toContain("2026-09-11 00:30 London");
    expect(next).toContain("in 11h 29m");
  });

  it("each occurrence shows the pool account it ran on beside its timeout and access — and says when the record names none", async () => {
    const tmux: ScheduledOccurrencesJob = {
      ...SUCCEEDED_JOB,
      jobId: "section-occ-no-account",
      occurrences: [{ ...OLDER_SUCCEEDED, launchOccurrenceId: "lo-7777777777777777777a", run: { timeoutMinutes: 5, access: "read-only", account: null } }],
    };
    await draw(occurrencesView({ ...FILE, jobs: [TIMED_OUT_JOB, tmux] }));
    const ran = visible('[data-slot="occurrence-run"]', last("section-occ-timeout"));
    expect(ran).toContain("5 min");
    expect(ran).toContain("read-only");
    expect(ran).toContain("pool account pool-a");
    expect(visible('[data-slot="occurrence-run"]', last("section-occ-no-account"))).toContain("no pool account recorded");
    /* THE JOB'S OWN LINE NAMES NO ACCOUNT: which account runs it is chosen per occurrence. */
    expect(visible('[data-slot="run"]', job("section-occ-timeout"))).not.toContain("account");
  });

  it("puts the older occurrences behind a disclosure, and states what the file left out as a count", async () => {
    await draw(occurrencesView());
    const details = job("section-occ-timeout").querySelector('details[data-slot="earlier-occurrences"]');
    expect(details).not.toBeNull();
    expect(details?.querySelector('[data-occurrence="lo-2222222222222222222b"]')).not.toBeNull();
    /* The last one is NOT inside the disclosure. */
    expect(details?.querySelector('[data-occurrence="lo-1111111111111111111a"]')).toBeNull();
    expect(visible('[data-slot="omitted"]', job("section-occ-timeout"))).toContain("4");
    expect(job("section-occ-good").querySelector('details[data-slot="earlier-occurrences"]')).toBeNull();
  });

  it("gives a row this build cannot read its own line, never a dropped one", async () => {
    const raw = JSON.parse(JSON.stringify(FILE)) as { jobs: Record<string, unknown>[] };
    ((raw.jobs[0] as Record<string, unknown>)["occurrences"] as Record<string, unknown>[])[0] = { ...BASE, state: "paused-by-greg" };
    raw.jobs.push({ ...NEVER_JOB, jobId: "section-occ-future", next: { kind: "whenever" } });
    await draw(occurrencesView(raw));
    expect(visible('[data-occurrence-unreadable="lo-1111111111111111111a"]')).toContain("paused-by-greg");
    expect(visible('[data-occurrences-job-unreadable="section-occ-future"]')).toContain("whenever");
  });
});

describe("mounted on the Overseer tab", () => {
  function actions(): ActionsUi {
    return { api: {} as ActionsApi, feed: null, error: null, asked: false, lastGoodAt: null, pollMs: 3_600_000, refresh: () => undefined };
  }

  const quietSchedule: ScheduleApi = { read: () => new Promise(() => undefined) };

  function drawPanel(api: OccurrencesApi): void {
    act(() =>
      root.render(
        <OverseerPanel
          actions={actions()}
          rows={[]}
          unreadableRows={null}
          overseer={null}
          usage={null}
          codex={null}
          now={RECEIVED_MS}
          receivedAt={null}
          skew={CLOCK_SKEW_UNMEASURED}
          scheduleApi={quietSchedule}
          occurrencesApi={api}
        />,
      ),
    );
  }

  it("opening the tab asks once, and draws the section directly after the schedule preview", async () => {
    const { api, calls } = recording(async () => occurrencesView());
    drawPanel(api);
    await act(async () => undefined);
    expect(calls()).toBe(1);
    const section = container.querySelector('[data-section="scheduled-occurrences"]');
    expect(section).not.toBeNull();
    expect(section?.previousElementSibling?.getAttribute("data-section")).toBe("schedule-preview");
    expect(visible('[data-section="scheduled-occurrences"] h2')).toBe("What the scheduler has launched");
  });

  it("asks again every minute while it is open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { api, calls } = recording(async () => occurrencesView());
    drawPanel(api);
    await act(async () => undefined);
    expect(calls()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(OCCURRENCES_POLL_MS);
    });
    expect(calls()).toBe(2);
  });
});
