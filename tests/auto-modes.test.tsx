// @vitest-environment jsdom
/**
 * **The add page's "generate the main modes" box** — src/web/auto-modes.ts,
 * docs/plans/260930c-auto-generate-the-main-modes-after-import.md.
 *
 * Three things are worth pinning. Which steps the box queues, since the list is
 * derived and a mode moving in or out of the experimental switch changes it
 * silently. That they are created **one after another**, because Skim
 * only waits for Quotes and Ideas if its job is younger than theirs. And that
 * the page queues them on `done` only when the box is ticked, and opens the
 * article either way.
 */
import { act, createElement, StrictMode } from "react";
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
let addResult: Job | null = null;
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => addResult,
  addUpload: async () => null,
  run: async (request) => {
    runs.push({ slug: request.slug, steps: request.steps });
    return null;
  },
  reset: async () => null,
  cancel: async () => {},
  retry: async () => null,
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

/**
 * The order `queueAutoModes` posts in: the jobs that read nothing first, then
 * the rest. It was also `autoModeRequests()`'s own order until `crossrefs`
 * (plan 260930f) joined — last in `STEP_ORDER`, and reading nothing, so it is
 * posted before Skim though it sorts after it.
 */
const postingOrder = (): StepName[][] => {
  const requests = autoModeRequests();
  return [...requests.filter((s) => s.length === 1), ...requests.filter((s) => s.length > 1)];
};
const { AddPage } = await import("../src/web/AddPage.js");

describe("which steps the box queues", () => {
  it("is every step the main modes make, and the cross-references, in STEP_ORDER", () => {
    /* If this changes, a mode moved in or out of the experimental switch, or
       started or stopped making something. That may be right — then change
       this line, and the price in the plan. `crossrefs` is no mode: it is
       added by hand (`AUTO_EXTRA_STEPS`), plan 260930f § 3.

       **The whole list, on purpose.** `tweets` and `simple` are both Summary's
       since 2026-10-03, when the thread became its third view and its press
       became delegated — and `modeStep` answers `null` for a delegated mode,
       so the derivation alone lost both (GPT Sol, F2 of the 261003l review;
       watched red at five steps). auto-modes.ts § `DELEGATED_MODE_STEPS`. */
    expect(autoModeSteps()).toEqual(["tweets", "glossary", "quotes", "ideas", "simple", "skim", "crossrefs"]);
    expect(modeStep("summary")).toBeNull();
  });

  it("puts Skim after Quotes and Ideas, which it reads", () => {
    const steps = autoModeSteps();
    expect(steps.indexOf("skim")).toBeGreaterThan(steps.indexOf("quotes"));
    expect(steps.indexOf("skim")).toBeGreaterThan(steps.indexOf("ideas"));
  });

  it("takes nothing from behind the experimental switch", () => {
    for (const mode of MODES) {
      const step = modeStep(mode);
      if (step && MODE_CATALOG[mode].experimental) expect(autoModeSteps()).not.toContain(step);
    }
  });

  it("names them to the reader", () => {
    /* Summary once, though two of the steps are its own (its lengths and its
       thread). It must not vanish with its `fixed` row (F2). */
    expect(autoModesDetail()).toContain("Summary, Glossary, Quotes, Ideas and Skim are prepared");
    expect(autoModesDetail()).toContain("the links from one passage of the article to another");
  });
});

describe("queueAutoModes", () => {
  beforeEach(() => {
    runs.length = 0;
  });

  it("gives Skim's job the shape its panel posts when both prerequisites are absent", () => {
    /* The panel posts `[...precededBy, "skim"]` (useStepJob.ts). With
       neither prerequisite present this is the same work key; after one becomes
       ready the panel may post a narrower row, which serialises behind this job
       and skips rather than paying for Skim twice. Carrying both here is
       what keeps a job that lands first from refusing for want of Quotes (Sol
       P1). */
    expect(autoModeRequests()).toEqual([
      ["tweets"],
      ["glossary"],
      ["quotes"],
      ["ideas"],
      ["simple"],
      ["quotes", "ideas", "skim"],
      ["crossrefs"],
    ]);
  });

  it("knows the same dependencies as the server's queue", () => {
    /* `STEP_READS` is a copy of `STEP_SHARING`'s reads, because the browser
       may not import src/sharing-steps.ts. Watched red by adding a read there. */
    for (const step of SHARING_STEPS) {
      expect([...(STEP_READS[step] ?? [])], step).toEqual([...sharingPolicy(step).reads]);
    }
  });

  it("posts the ones that read nothing first, and Skim only after they have answered", async () => {
    const answered: StepName[][] = [];
    let skimPostedAfter: number | null = null;
    const run: UseJobs["run"] = async (request) => {
      if (request.steps.includes("skim")) skimPostedAfter = answered.length;
      await new Promise((resolve) => setTimeout(resolve, 1));
      answered.push(request.steps);
      return null;
    };
    await queueAutoModes(run, "an-article");
    expect(answered).toHaveLength(7);
    /* The five modes that read nothing, and `crossrefs`, which reads nothing either. */
    expect(skimPostedAfter, "Skim was posted before the other six had answered").toBe(6);
  });

  it("carries on past one that throws", async () => {
    const started: StepName[][] = [];
    await queueAutoModes(async (request) => {
      started.push(request.steps);
      if (request.steps[0] === "glossary") throw new Error("network");
      return null;
    }, "an-article");
    expect(started).toHaveLength(7);
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
    renderSource({ kind: "upload", uploadId: UPLOAD_ID });
  }

  function renderSource(source: Parameters<typeof AddPage>[0]["source"]): void {
    act(() => {
      root.render(createElement(AddPage, { source }));
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const box = (): HTMLInputElement | null => host.querySelector('input[type="checkbox"]');

  beforeEach(() => {
    window.localStorage.clear();
    runs.length = 0;
    navigations.length = 0;
    jobs = [];
    addResult = null;
    transfer = null;
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

  it("offers the box while an upload is still transferring, before its job exists", () => {
    transfer = {
      uploadId: UPLOAD_ID,
      filename: "p.pdf",
      bytes: 10,
      phase: { kind: "sending", sent: 4 },
    };
    renderSource({ kind: "upload", uploadId: UPLOAD_ID });
    expect(box(), "no box while the file was still transferring").not.toBeNull();
  });

  it("queues the modes and opens the article when it is done", async () => {
    render("running");
    render("done");
    await settle();
    expect(navigations).toHaveLength(1);
    expect(runs.map((r) => r.steps)).toEqual(postingOrder());
    expect(runs.every((r) => r.slug === "a-paper")).toBe(true);
  });

  it("queues when the returned URL job is already done on the first render", async () => {
    const finished = job("done");
    jobs = [finished];
    addResult = finished;
    renderSource({ kind: "url", url: "https://example.com/a-paper" });
    await settle();
    expect(runs.map((r) => r.steps)).toEqual(postingOrder());
    expect(navigations).toEqual(["/read/a-paper"]);
  });

  it("queues each mode only once under StrictMode's repeated effects", async () => {
    const finished = job("done");
    jobs = [finished];
    transfer = {
      uploadId: UPLOAD_ID,
      filename: "p.pdf",
      bytes: 1,
      phase: { kind: "queued", job: finished },
    };
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(AddPage, { source: { kind: "upload", uploadId: UPLOAD_ID } }),
        ),
      );
    });
    await settle();
    expect(runs.map((r) => r.steps)).toEqual(postingOrder());
  });

  it("queues the modes when an engine-owned upload resolves to an existing article", async () => {
    transfer = {
      uploadId: UPLOAD_ID,
      filename: "p.pdf",
      bytes: 1,
      phase: { kind: "article", slug: "a-paper" },
    };
    renderSource({ kind: "upload", uploadId: UPLOAD_ID });
    await settle();
    expect(runs.map((r) => r.steps)).toEqual(postingOrder());
    expect(navigations).toEqual(["/read/a-paper"]);
  });

  it("opens the article and queues nothing when unticked", async () => {
    render("running");
    act(() => box()?.click());
    expect(box()?.checked).toBe(false);
    render("done");
    await settle();
    expect(navigations).toHaveLength(1);
    expect(runs).toEqual([]);
    expect(readAutoModes(), "the untick was not remembered").toBe(false);
  });
});
