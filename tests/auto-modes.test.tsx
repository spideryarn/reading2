// @vitest-environment jsdom
/**
 * **The add page's "generate the main modes" box** — src/auto-mode-steps.ts,
 * src/web/auto-modes.ts and src/web/auto-modes-setting.ts.
 * docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md
 * (and 260930c before it).
 *
 * Four things are pinned.
 *
 * 1. **Which jobs.** The server queues from a written list, because the
 *    derivation reads the browser's mode catalogue. This holds the written
 *    list equal to the derived one, so a mode moved in or out of the
 *    experimental switch fails here until the list follows.
 * 2. **The page posts no mode job.** It did until 261004h; the server queues
 *    them at the import's publication
 *    (tests/publication-queues-the-main-modes.test.ts), so a job from here
 *    would be a second set.
 * 3. **The box is the reader's setting**: read from `GET /api/reader`, written
 *    by `PATCH /api/reader { autoModes }` on each change.
 * 4. **The one-time hand-over** of a browser's old `localStorage` "off", which
 *    forgets the key only once the server has answered.
 */
import { readFileSync } from "node:fs";

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_MODE_STEPS, STEP_READS, autoModePosts, autoModeRequests } from "../src/auto-mode-steps.js";
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

/**
 * **The server's half of the setting**, as far as the page can see it: what
 * `GET /api/reader` answers, every `PATCH` body in order, and how the next
 * `PATCH` answers.
 */
let serverAutoModes = true;
let readerAnswer: (() => Promise<Response>) | undefined;
const readerPatches: unknown[] = [];
const patchSignals: (AbortSignal | null | undefined)[] = [];
let patchAnswer: (body: { autoModes: boolean }) => Promise<Response>;
const stores = async (body: { autoModes: boolean }): Promise<Response> => {
  serverAutoModes = body.autoModes;
  return new Response(JSON.stringify({ autoModes: serverAutoModes }), { status: 200 });
};
vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string, init: RequestInit = {}) => {
      if (input === "/api/reader" && init.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { autoModes: boolean };
        readerPatches.push(body);
        patchSignals.push(init.signal);
        return patchAnswer(body);
      }
      if (input === "/api/reader") {
        if (readerAnswer) return readerAnswer();
        return new Response(JSON.stringify({ autoModes: serverAutoModes }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${init.method ?? "GET"} ${input}`);
    },
  };
});

const { autoModesDetail, derivedAutoModeSteps } = await import("../src/web/auto-modes.js");
const { LEGACY_AUTO_MODES_KEY, handOverAutoModesChoice, resetAutoModesSettingForTests } = await import(
  "../src/web/auto-modes-setting.js"
);
const { modeStep } = await import("../src/web/activation.js");
const { AddPage } = await import("../src/web/AddPage.js");

beforeEach(() => {
  window.localStorage.clear();
  resetAutoModesSettingForTests();
  serverAutoModes = true;
  readerAnswer = undefined;
  readerPatches.length = 0;
  patchSignals.length = 0;
  patchAnswer = stores;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("which steps are queued", () => {
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
    /* **No `relations`.** Marginalia is a main mode since 2026-10-05, and for
       part of that day its relation words were queued here. Greg: "generate
       linking words when Marginalia mode is opened" — so its row is delegated
       and names no step, and the column asks when it is shown
       (tests/marginalia-relations-on-open.test.tsx;
       docs/plans/261005d-marginalia-out-of-the-experimental-switch.md). */
    expect(derivedAutoModeSteps()).toEqual([
      "tweets",
      "glossary",
      "quotes",
      "ideas",
      "simple",
      "skim",
      /* Sources' Bibliography, since 2026-10-09: out of the switch, and
         its default sub-mode. Not `debate` (Reception's paid web search) nor
         `debate-claims`: each runs on the press of its own chip (plan 261009l
         § On import). */
      "bibliography",
      "crossrefs",
    ]);
    expect(modeStep("summary")).toBeNull();
    expect(modeStep("sources")).toBeNull();
    expect(AUTO_MODE_STEPS).not.toContain("reception");
    expect(AUTO_MODE_STEPS).not.toContain("sources-claims");
    expect(modeStep("marginalia")).toBeNull();
    expect(AUTO_MODE_STEPS).not.toContain("relations");
  });

  it("the written list the server queues from equals the derived one", () => {
    /* The server cannot run the derivation (`modeStep` imports the browser's
       job engine), so src/auto-mode-steps.ts names the steps. This is what
       stops the two drifting apart. */
    expect([...AUTO_MODE_STEPS]).toEqual(derivedAutoModeSteps());
  });

  it("the shared list is a leaf: it imports the step order and types, nothing else", () => {
    /* Both sides import it. One more import and the server pulls in whatever
       that module reaches, or the browser reaches into src/store/. */
    const source = readFileSync("src/auto-mode-steps.ts", "utf8");
    const imported = [...source.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]);
    expect(imported.sort()).toEqual(["./step-order.js", "./types.js"]);
  });

  it("puts Skim after Quotes and Ideas, which it reads", () => {
    expect(AUTO_MODE_STEPS.indexOf("skim")).toBeGreaterThan(AUTO_MODE_STEPS.indexOf("quotes"));
    expect(AUTO_MODE_STEPS.indexOf("skim")).toBeGreaterThan(AUTO_MODE_STEPS.indexOf("ideas"));
  });

  it("takes nothing from behind the experimental switch", () => {
    for (const mode of MODES) {
      const step = modeStep(mode);
      if (step && MODE_CATALOG[mode].experimental) expect(AUTO_MODE_STEPS).not.toContain(step);
    }
  });

  it("names them to the reader", () => {
    /* Summary once, though two of the steps are its own (its lengths and its
       thread). It must not vanish with its `fixed` row (F2). */
    expect(autoModesDetail()).toContain(
      "Summary, Glossary, Quotes, Ideas, Skim and Sources’ Bibliography are prepared",
    );
    expect(autoModesDetail()).toContain("the links from one passage of the article to another");
  });
});

describe("what each job asks for", () => {
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
      ["bibliography"],
      ["crossrefs"],
    ]);
  });

  it("queues the ones that read nothing first, and Skim's last", () => {
    /* `crossrefs` sorts after Skim in `STEP_ORDER` and reads nothing, so it
       goes before it. The publication stamps them in this order. */
    const { together, after } = autoModePosts();
    expect(together).toEqual([["tweets"], ["glossary"], ["quotes"], ["ideas"], ["simple"], ["bibliography"], ["crossrefs"]]);
    expect(after).toEqual([["quotes", "ideas", "skim"]]);
  });

  it("knows the same dependencies as the server's queue", () => {
    /* `STEP_READS` is a copy of `STEP_SHARING`'s reads, because the browser
       may not import src/sharing-steps.ts. Watched red by adding a read there. */
    for (const step of SHARING_STEPS) {
      expect([...(STEP_READS[step] ?? [])], step).toEqual([...sharingPolicy(step).reads]);
    }
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
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  const box = (): HTMLInputElement | null => host.querySelector('input[type="checkbox"]');

  beforeEach(() => {
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

  it("offers the box, ticked, while the import runs", async () => {
    render("running");
    await settle();
    expect(box(), "no box while the import was running").not.toBeNull();
    expect(box()?.checked).toBe(true);
    expect(readerPatches, "showing the box wrote the setting").toEqual([]);
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

  it("shows the box unticked for a reader whose setting is off", async () => {
    serverAutoModes = false;
    render("running");
    await settle();
    expect(box()?.checked, "the box ignored the reader's setting").toBe(false);
  });

  it("opens the article when it is done, and posts no mode job", async () => {
    render("running");
    render("done");
    await settle();
    expect(navigations).toHaveLength(1);
    expect(runs, "the page queued modes; the server does that at publication").toEqual([]);
  });

  it("posts none when the returned URL job is already done on the first render", async () => {
    const finished = job("done");
    jobs = [finished];
    addResult = finished;
    renderSource({ kind: "url", url: "https://example.com/a-paper" });
    await settle();
    expect(runs).toEqual([]);
    expect(navigations).toEqual(["/read/a-paper"]);
  });

  it("posts none under StrictMode's repeated effects", async () => {
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
    expect(runs).toEqual([]);
  });

  it("posts none when an engine-owned upload resolves to an existing article", async () => {
    /* Re-adding something already on the shelf publishes nothing, so nothing
       is queued anywhere: the modes it lacks are a press in the reading view. */
    transfer = {
      uploadId: UPLOAD_ID,
      filename: "p.pdf",
      bytes: 1,
      phase: { kind: "article", slug: "a-paper" },
    };
    renderSource({ kind: "upload", uploadId: UPLOAD_ID });
    await settle();
    expect(runs).toEqual([]);
    expect(navigations).toEqual(["/read/a-paper"]);
  });

  it("writes the setting when the box is changed, each time", async () => {
    render("running");
    await settle();
    act(() => box()?.click());
    expect(box()?.checked).toBe(false);
    await settle();
    expect(readerPatches).toEqual([{ autoModes: false }]);
    expect(serverAutoModes, "the untick did not reach the server").toBe(false);

    act(() => box()?.click());
    await settle();
    expect(box()?.checked).toBe(true);
    expect(readerPatches).toEqual([{ autoModes: false }, { autoModes: true }]);

    render("done");
    await settle();
    expect(navigations).toHaveLength(1);
    expect(runs).toEqual([]);
  });

  it("a press made before the setting has loaded is not overwritten by it", async () => {
    render("running");
    /* No settle: the opening GET (which will say on) is still out. */
    act(() => box()?.click());
    await settle();
    expect(box()?.checked, "the opening read undid the reader's untick").toBe(false);
    expect(readerPatches).toEqual([{ autoModes: false }]);
  });

  it("restores the confirmed server value when both rapid changes fail", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "Unavailable." }), { status: 503 });
    render("running");
    await settle();
    act(() => {
      box()?.click();
      box()?.click();
    });
    await settle();
    expect(readerPatches).toEqual([{ autoModes: false }, { autoModes: true }]);
    expect(box()?.checked, "rollback invented an off the server never stored").toBe(serverAutoModes);
  });

  it("serializes a checkbox change after the legacy hand-over", async () => {
    stored.set(LEGACY_AUTO_MODES_KEY, "off");
    let answer: () => void = () => {};
    patchAnswer = (body) => new Promise((resolve) => {
      answer = () => void stores(body).then(resolve);
    });
    const handed = handOverAutoModesChoice(new AbortController().signal);
    render("running");
    await settle();
    act(() => box()?.click());
    await settle();
    expect(readerPatches, "the new on raced the old off").toEqual([{ autoModes: false }]);
    patchAnswer = stores;
    answer();
    await handed;
    await settle();
    expect(readerPatches).toEqual([{ autoModes: false }, { autoModes: true }]);
    expect(serverAutoModes).toBe(true);
    expect(box()?.checked).toBe(true);
  });

  it("ignores an older page's read that answers after the newer read", async () => {
    let answer: (response: Response) => void = () => {};
    readerAnswer = () => new Promise((resolve) => { answer = resolve; });
    render("running");
    await settle();
    act(() => root.unmount());
    readerAnswer = undefined;
    serverAutoModes = false;
    root = createRoot(host);
    render("running");
    await settle();
    expect(box()?.checked).toBe(false);
    answer(new Response(JSON.stringify({ autoModes: true }), { status: 200 }));
    await settle();
    expect(box()?.checked, "an old page's read replaced the newer server answer").toBe(false);
  });

  it("re-reads the server choice on the next page mount", async () => {
    render("running");
    await settle();
    expect(box()?.checked).toBe(true);
    act(() => root.unmount());
    serverAutoModes = false; // another tab changed the account setting
    root = createRoot(host);
    render("running");
    await settle();
    expect(box()?.checked, "the next import showed the previous page's cached setting").toBe(false);
  });

  it("keeps the pending choice and write order across an add-page remount", async () => {
    let answer: () => void = () => {};
    render("running");
    await settle();
    patchAnswer = (body) => new Promise((resolve) => {
      answer = () => void stores(body).then(resolve);
    });
    act(() => box()?.click());
    await settle();
    act(() => root.unmount());
    root = createRoot(host);
    render("running");
    await settle();
    expect(box()?.checked, "the next page forgot the pending untick").toBe(false);
    act(() => box()?.click());
    await settle();
    expect(readerPatches).toEqual([{ autoModes: false }]);
    patchAnswer = stores;
    answer();
    await settle();
    expect(readerPatches).toEqual([{ autoModes: false }, { autoModes: true }]);
    expect(serverAutoModes).toBe(true);
  });

  it("aborts a pending write and discards queued writes when the reader leaves", async () => {
    const session = new AbortController();
    await handOverAutoModesChoice(session.signal);
    let answer: () => void = () => {};
    render("running");
    await settle();
    patchAnswer = (body) => new Promise((resolve) => {
      answer = () => void stores(body).then(resolve);
    });
    act(() => {
      box()?.click();
      box()?.click();
    });
    await settle();
    session.abort();
    expect(patchSignals[0]?.aborted, "the write can retry under the next reader").toBe(true);
    patchAnswer = stores;
    answer();
    await settle();
    expect(readerPatches, "a queued write was sent after sign-out").toEqual([{ autoModes: false }]);
  });

  it("puts the box back and says so when the save fails", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "Unavailable." }), { status: 503 });
    render("running");
    await settle();
    act(() => box()?.click());
    await settle();
    expect(box()?.checked, "a choice the server never got was left showing").toBe(true);
    expect(host.textContent).toContain("The save request failed.");
  });
});

/**
 * Until plan 261004h the choice was `localStorage["spideryarn.add.generate-main-modes"]`,
 * `"off"` when unticked, and the page did the queueing. The server queues now
 * and cannot see a browser's storage, so an old "off" is sent to it once — and
 * the key is forgotten only when the server has answered (GPT Sol, F3). That
 * `useJobSession` calls this at signed-in app start is held by
 * tests/job-session-effect.test.tsx.
 */
describe("the one-time hand-over of a browser's old choice", () => {
  const signal = () => new AbortController().signal;

  it("sends an old off to the server, and forgets the key once it has answered", async () => {
    stored.set(LEGACY_AUTO_MODES_KEY, "off");
    let answer: () => void = () => {};
    patchAnswer = (body) =>
      new Promise((resolve) => {
        answer = () => void stores(body).then(resolve);
      });
    const handed = handOverAutoModesChoice(signal());
    await Promise.resolve();
    expect(readerPatches).toEqual([{ autoModes: false }]);
    expect(stored.get(LEGACY_AUTO_MODES_KEY), "the key was forgotten before the server answered").toBe("off");
    answer();
    await handed;
    expect(stored.has(LEGACY_AUTO_MODES_KEY), "the key outlived the hand-over").toBe(false);
    expect(serverAutoModes).toBe(false);
  });

  it("keeps the key when the server refuses, so the next start tries again", async () => {
    stored.set(LEGACY_AUTO_MODES_KEY, "off");
    patchAnswer = async () => new Response(JSON.stringify({ error: "Unavailable." }), { status: 503 });
    await handOverAutoModesChoice(signal());
    expect(stored.get(LEGACY_AUTO_MODES_KEY)).toBe("off");
    patchAnswer = stores;
    await handOverAutoModesChoice(signal());
    expect(stored.has(LEGACY_AUTO_MODES_KEY)).toBe(false);
    expect(readerPatches).toEqual([{ autoModes: false }, { autoModes: false }]);
  });

  it("sends nothing for a browser that never chose, or that chose on", async () => {
    await handOverAutoModesChoice(signal());
    stored.set(LEGACY_AUTO_MODES_KEY, "on");
    await handOverAutoModesChoice(signal());
    expect(readerPatches).toEqual([]);
  });

  it("a failed hand-over shows the actual server choice and a save error", async () => {
    stored.set(LEGACY_AUTO_MODES_KEY, "off");
    patchAnswer = async () => new Response(JSON.stringify({ error: "Unavailable." }), { status: 503 });
    await handOverAutoModesChoice(signal());

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    jobs = [{ id: "job-1", slug: "a-paper", status: "running", steps: [] } as unknown as Job];
    transfer = { uploadId: "up-1", filename: "p.pdf", bytes: 1, phase: { kind: "queued", job: jobs[0] as Job } };
    act(() => {
      root.render(createElement(AddPage, { source: { kind: "upload", uploadId: "up-1" } }));
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked, "the failed hand-over hid the server's actual setting").toBe(true);
    expect(host.textContent).toContain("The save request failed.");
    expect(stored.get(LEGACY_AUTO_MODES_KEY)).toBe("off");
    act(() => root.unmount());
    host.remove();
  });
});
