// @vitest-environment jsdom
/**
 * **The add page's "generate the main modes" box** — src/web/auto-modes.ts,
 * docs/plans/260930c-auto-generate-the-main-modes-after-import.md.
 *
 * Three things are worth pinning. Which steps the box queues, since the list is
 * derived and a mode moving in or out of the experimental switch changes it
 * silently. That they are created **one after another**, because Trajectory
 * only waits for Quotes and Ideas if its job is younger than theirs. And that
 * the page queues them on `done` only when the box is ticked, and opens the
 * article either way.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES } from "../src/modes.js";
import { SHARING_STEPS, sharingPolicy } from "../src/sharing-steps.js";
import type { Job, StepName } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";
import type { Transfer } from "../src/web/uploadEngine.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's `localStorage` is shadowed by Node's own global here (see
   src/web/shelf-hidden-columns.ts), so the test brings its own. */
const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
  },
});

const runs: { slug: string; steps: StepName[] }[] = [];
let jobs: Job[] = [];
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => null,
  addUpload: async () => null,
  run: async (request) => {
    runs.push({ slug: request.slug, steps: request.steps });
    return null;
  },
  reset: async () => null,
  cancel: async () => {},
  retry: async () => {},
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));
vi.mock("../src/web/AddArticle.js", () => ({ JobCard: () => null }));

let transfer: Transfer | null = null;
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));
vi.mock("../src/web/uploadEngine.js", () => ({ uploadEngine: { retry: () => {}, cancel: () => {} } }));

const navigations: string[] = [];
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => navigations.push(href),
}));

const { STEP_READS, autoModeRequests, autoModeSteps, autoModesDetail, queueAutoModes, readAutoModes, writeAutoModes } = await import(
  "../src/web/auto-modes.js"
);
const { modeStep } = await import("../src/web/activation.js");
const { AddPage } = await import("../src/web/AddPage.js");

describe("which steps the box queues", () => {
  it("is the five main modes that make something, in STEP_ORDER", () => {
    /* If this changes, a mode moved in or out of the experimental switch, or
       started or stopped making something. That may be right — then change
       this line, and the price in the plan. */
    expect(autoModeSteps()).toEqual(["tweets", "glossary", "quotes", "ideas", "trajectory"]);
  });

  it("puts Trajectory after Quotes and Ideas, which it reads", () => {
    const steps = autoModeSteps();
    expect(steps.indexOf("trajectory")).toBeGreaterThan(steps.indexOf("quotes"));
    expect(steps.indexOf("trajectory")).toBeGreaterThan(steps.indexOf("ideas"));
  });

  it("takes nothing from behind the experimental switch", () => {
    for (const mode of MODES) {
      const step = modeStep(mode);
      if (step && MODE_CATALOG[mode].experimental) expect(autoModeSteps()).not.toContain(step);
    }
  });

  it("names them to the reader", () => {
    expect(autoModesDetail()).toContain("Tweets, Glossary, Quotes, Ideas and Trajectory");
  });
});

describe("queueAutoModes", () => {
  beforeEach(() => {
    runs.length = 0;
  });

  it("gives Trajectory's job the steps it reads, the same shape its panel posts", () => {
    /* The panel posts `[...precededBy, "trajectory"]` (useStepJob.ts), and the
       work key hashes the step list — so this shape is what makes opening the
       mode join the job instead of adding a second. It is also what keeps a
       Trajectory job that lands in the line first from refusing for want of
       Quotes (GPT Sol, P1). */
    expect(autoModeRequests()).toEqual([
      ["tweets"],
      ["glossary"],
      ["quotes"],
      ["ideas"],
      ["quotes", "ideas", "trajectory"],
    ]);
  });

  it("knows the same dependencies as the server's queue", () => {
    /* `STEP_READS` is a copy of `STEP_SHARING`'s reads, because the browser
       may not import src/sharing-steps.ts. Watched red by adding a read there. */
    for (const step of SHARING_STEPS) {
      expect([...(STEP_READS[step] ?? [])], step).toEqual([...sharingPolicy(step).reads]);
    }
  });

  it("posts the ones that read nothing first, and Trajectory only after they have answered", async () => {
    const answered: StepName[][] = [];
    let trajectoryPostedAfter: number | null = null;
    const run: UseJobs["run"] = async (request) => {
      if (request.steps.includes("trajectory")) trajectoryPostedAfter = answered.length;
      await new Promise((resolve) => setTimeout(resolve, 1));
      answered.push(request.steps);
      return null;
    };
    await queueAutoModes(run, "an-article");
    expect(answered).toHaveLength(5);
    expect(trajectoryPostedAfter, "Trajectory was posted before the other four had answered").toBe(4);
  });

  it("carries on past one that throws", async () => {
    const started: StepName[][] = [];
    await queueAutoModes(async (request) => {
      started.push(request.steps);
      if (request.steps[0] === "glossary") throw new Error("network");
      return null;
    }, "an-article");
    expect(started).toHaveLength(5);
  });
});

describe("the choice is remembered", () => {
  beforeEach(() => window.localStorage.clear());

  it("is on for a reader who has never chosen", () => {
    expect(readAutoModes()).toBe(true);
  });

  it("stays off once turned off", () => {
    writeAutoModes(false);
    expect(readAutoModes()).toBe(false);
    writeAutoModes(true);
    expect(readAutoModes()).toBe(true);
  });
});

describe("the add page", () => {
  let host: HTMLDivElement;
  let root: Root;
  const UPLOAD_ID = "up-1";

  const job = (status: Job["status"]): Job =>
    ({ id: "job-1", slug: "a-paper", status, steps: [] }) as unknown as Job;

  function render(status: Job["status"]): void {
    jobs = [job(status)];
    transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 1, phase: { kind: "queued", job: job(status) } };
    act(() => {
      root.render(createElement(AddPage, { source: { kind: "upload", uploadId: UPLOAD_ID } }));
    });
  }

  const box = (): HTMLInputElement | null => host.querySelector('input[type="checkbox"]');

  beforeEach(() => {
    window.localStorage.clear();
    runs.length = 0;
    navigations.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("offers the box, ticked, while the import runs", () => {
    render("running");
    expect(box(), "no box while the import was running").not.toBeNull();
    expect(box()?.checked).toBe(true);
  });

  it("queues the modes and opens the article when it is done", async () => {
    render("running");
    render("done");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(navigations).toHaveLength(1);
    expect(runs.map((r) => r.steps)).toEqual(autoModeRequests());
    expect(runs.every((r) => r.slug === "a-paper")).toBe(true);
  });

  it("opens the article and queues nothing when unticked", async () => {
    render("running");
    act(() => box()?.click());
    expect(box()?.checked).toBe(false);
    render("done");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(navigations).toHaveLength(1);
    expect(runs).toEqual([]);
    expect(readAutoModes(), "the untick was not remembered").toBe(false);
  });
});
