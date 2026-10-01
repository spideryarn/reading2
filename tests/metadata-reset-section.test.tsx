// @vitest-environment jsdom
/**
 * **The *Start this article again* section on the Metadata page** — stage 2 of
 * docs/plans/260928a-reset-and-regenerate-article.md.
 *
 * Mounted through `Metadata` for the reason tests/metadata-rerun-section.test.tsx
 * gives: what goes wrong with a control like this is the wiring — the gate, the
 * slug in the URL, the body, and whether the job it makes is ever driven.
 *
 * The things here that are about money or a reader's article rather than React:
 *
 *  - **Behind the experimental switch** (assumption 5 of the plan): absent when
 *    it is off, present when it is on.
 *  - **The first press asks and posts nothing.** A reset re-reads the article
 *    and can detach comments on maths, so a one-click control is the wrong shape.
 *    The mode rows beside it lost their confirm on 2026-09-30; this one keeps
 *    it, because what it guards is the reader's and not a model call of ours.
 *  - **Yes posts exactly `{ regenerate: false }` or `{ regenerate: true }`** to
 *    `/api/article/<slug>/reset` — the server rejects any other field, and the
 *    client may not name steps.
 *  - **The job is driven.** The browser is the worker (ingest-queue.md § The
 *    browser is the worker): a reset nobody drives sits queued for ever while
 *    the page says it has started. So the test asserts the `/advance` for the
 *    returned id, not merely that the POST happened.
 */
import { act, createElement } from "react";
import { NuqsAdapter } from "nuqs/adapters/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STEP_ORDER } from "../src/step-order.js";
import type { Article, Job, StageState, StepName } from "../src/types.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

/* The bar is not what is under test, and with the switch on it would draw the
   experimental modes too. */
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

/** Whether the experimental switch reads as on. */
let experimentalOn = true;
vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({
    on: experimentalOn,
    since: experimentalOn ? "2026-09-01T00:00:00.000Z" : null,
    loaded: true,
    signedIn: true,
    saving: false,
    error: null,
  }),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});

const { Metadata } = await import("../src/web/Metadata.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "a-piece";
const RESET_URL = `/api/article/${SLUG}/reset`;
const IMPORT_STEPS: StepName[] = ["fetch", "extract", "blocks", "hierarchy", "labels", "assets"];

const ARTICLE: Article = {
  highPowerSince: null,
  meta: { slug: SLUG, title: "A piece" },
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "p",
      kind: "text",
      text: "The first paragraph.",
      words: 3,
      html: "<p>The first paragraph.</p>",
      gistable: true,
    },
  ],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: {
    version: "t",
    generator: "t",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title: "A piece",
      },
    },
  },
};

/** Which steps the metadata endpoint currently says have run. */
let ran: Set<StepName>;
/** Steps with an artefact that is present but no longer current. */
let stale: Set<StepName>;
/** Every body posted to the reset route, parsed, in order. */
let resets: unknown[];
/** Every `POST /api/jobs` body — a reset must not go through that route. */
let jobPosts: unknown[];
/** The id of every `POST /api/jobs/:id/advance`, in order. */
let advances: string[];
/** How many `GET /api/jobs` have been made. */
let jobListReads: number;
/** What `GET /api/jobs` answers. */
let jobList: Job[];
/** What the reset route answers, when it is not the ordinary 202. */
let resetAnswer: (() => Response) | null;
/** How many times `GET /api/metadata/:slug` has been asked for. */
let metadataReads: number;
/** The id of every `POST /api/jobs/:id/retry`, in order. */
let retries: string[];
/** While true, a retry's answer waits for `releaseRetry`. */
let holdRetry: boolean;
let releaseRetry: (() => void) | undefined;
/** What the retry route answers. */
let retryAnswer: () => Response;

let host: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function answerRetry(id: string): Promise<Response> {
  retries.push(id);
  const answer = retryAnswer();
  if (!holdRetry) return Promise.resolve(answer);
  return new Promise<Response>((go) => {
    releaseRetry = () => go(answer);
  });
}

function answerReset(body: BodyInit | null | undefined): Promise<Response> {
  resets.push(JSON.parse(String(body ?? "null")));
  return Promise.resolve(
    resetAnswer ? resetAnswer() : json({ jobId: "job-reset", regenerate: [] }, 202),
  );
}

function stages(): StageState[] {
  return STEP_ORDER.map((step) => ({
    step,
    label: `Doing ${step}`,
    outputs: [`data/${SLUG}/${step}.json`],
    done: ran.has(step) && !stale.has(step),
    ranAt: ran.has(step) ? "2026-09-01T00:00:00.000Z" : null,
    startedAt: ran.has(step) ? "2026-08-31T23:59:52.000Z" : null,
    bytes: null,
  }));
}

function resetJob(
  id: string,
  status: Job["status"] = "queued",
  regenerate: StepName[] = [],
): Job {
  return {
    id,
    ownerId: "owner" as Job["ownerId"],
    slug: SLUG,
    steps: ["fetch", "extract", "blocks", "hierarchy", "assets"].map((name) => ({
      name: name as StepName,
      label: `Doing ${name}`,
      status: "pending" as const,
    })),
    status,
    createdAt: "2026-09-28T00:00:00.000Z",
    ...(status === "done" ? { finishedAt: "2026-09-28T00:00:01.000Z" } : {}),
    reset: { regenerate },
  };
}

function oneStepJob(
  id: string,
  step: StepName,
  status: Job["status"],
  createdAt = "2026-09-28T00:00:01.000Z",
): Job {
  return {
    id,
    ownerId: "owner" as Job["ownerId"],
    slug: SLUG,
    steps: [{ name: step, label: `Doing ${step}`, status: status === "done" ? "done" : "pending" }],
    status,
    createdAt,
    ...(status === "done" ? { finishedAt: "2026-09-28T00:00:02.000Z" } : {}),
    ...(status === "error" ? { error: `Couldn't make the ${step}.` } : {}),
  };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  experimentalOn = true;
  ran = new Set<StepName>([...IMPORT_STEPS, "arc", "glossary", "quotes", "faq"]);
  stale = new Set<StepName>();
  resets = [];
  jobPosts = [];
  advances = [];
  jobListReads = 0;
  jobList = [];
  resetAnswer = null;
  metadataReads = 0;
  retries = [];
  holdRetry = false;
  releaseRetry = undefined;
  retryAnswer = () => json(resetJob("job-reset-2"));
  jobEngine.reset();

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/metadata/")) {
      metadataReads++;
      return Promise.resolve(
        json({
          slug: SLUG,
          dir: `data/${SLUG}`,
          stages: stages(),
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
        }),
      );
    }
    if (url === RESET_URL && method === "POST") {
      return answerReset(init?.body);
    }
    const retried = /^\/api\/jobs\/([^/]+)\/retry$/.exec(url);
    if (retried && method === "POST") {
      return answerRetry(retried[1] ?? "");
    }
    const advanced = /^\/api\/jobs\/([^/]+)\/advance$/.exec(url);
    if (advanced && method === "POST") {
      advances.push(advanced[1] ?? "");
      const job = jobList.find((j) => j.id === advanced[1]) ?? resetJob(advanced[1] ?? "");
      /* Busy, so the drive loop waits rather than spinning inside the test. */
      return Promise.resolve(json({ job, ran: null, busy: true, done: false }));
    }
    if (url === "/api/jobs" && method === "POST") {
      jobPosts.push(JSON.parse(String(init?.body ?? "null")));
      return Promise.resolve(json({}));
    }
    if (url === "/api/jobs") {
      jobListReads++;
      return Promise.resolve(json({ jobs: jobList }));
    }
    return Promise.resolve(json({}));
  });

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}/metadata`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(Metadata, {
          slug: SLUG,
          article: ARTICLE,
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      ),
    );
  });
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const card = (): HTMLElement | null => host.querySelector<HTMLElement>("[data-reset]");
const sections = (): (string | undefined)[] =>
  [...host.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section);

function button(text: string): HTMLButtonElement | undefined {
  return [...(card()?.querySelectorAll("button") ?? [])].find((b) =>
    (b.textContent ?? "").includes(text),
  );
}
const checkbox = (): HTMLInputElement | null =>
  card()?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;

async function press(b: HTMLButtonElement | HTMLInputElement | undefined | null): Promise<void> {
  expect(b, "nothing to press").toBeTruthy();
  await act(async () => b?.click());
  await settle();
}

describe("the Start this article again section", () => {
  it("is not on the page when experimental features are off", async () => {
    experimentalOn = false;
    await open();
    expect(card()).toBeNull();
    expect(sections()).not.toContain("Start this article again");
  });

  it("is on the page, just above Archive, when they are on", async () => {
    await open();
    expect(card()).toBeTruthy();
    const order = sections();
    /* Inside *Re-run AI processing* since 2026-09-29, not a section of its
       own — docs/plans/260929b-one-place-to-re-run-ai-processing.md. That
       section is *AI processing* since 2026-10-01 (`spya-qgh5ta`). */
    expect(order).not.toContain("Start this article again");
    expect(card()?.closest("[data-section]")?.getAttribute("data-section")).toBe(
      "AI processing",
    );
    expect(order.indexOf("AI processing")).toBe(order.indexOf("Archive this article") - 1);
  });

  /**
   * **The first row of the modes' own card**, since 2026-09-30 — Greg,
   * SPIDERYARN-READING2-65: *"amalgamate the "Start the whole article again"
   * into the run-it-again section above, e.g. as a button at the top"*. It was
   * a subheading and a second card under the mode rows.
   */
  it("is the first row of the mode rows' card, with no heading of its own", async () => {
    await open();
    const firstMode = host.querySelector<HTMLElement>("[data-rerun-step]");
    expect(firstMode, "no mode rows").toBeTruthy();
    const list = firstMode?.parentElement;
    expect(list?.contains(card() ?? null), "the reset is not in the modes' card").toBe(true);
    expect(list?.firstElementChild?.contains(card() ?? null), "the reset is not the first row").toBe(
      true,
    );
    expect(card()?.textContent).toContain("Whole article");
    const section = card()?.closest("[data-section]");
    const headings = [...(section?.querySelectorAll("h3") ?? [])].map((h) => h.textContent);
    expect(headings).not.toContain("Start the whole article again");
  });

  it("names the extras this article has beside the checkbox, and no others", async () => {
    await open();
    const box = checkbox();
    expect(box, "no checkbox").toBeTruthy();
    expect(box?.checked, "the checkbox starts ticked").toBe(false);
    const label = box?.closest("label")?.textContent ?? "";
    for (const name of ["Arc", "Glossary", "Quotes", "FAQ"]) expect(label).toContain(name);
    /* Not an extra the article lacks, and not an import step. */
    for (const name of ["Ideas", "Quiz", "Sketch", "Hierarchy", "assets"]) {
      expect(label).not.toContain(name);
    }
  });

  it("names an extra that exists but is stale, as the reset route does", async () => {
    stale.add("glossary");
    await open();

    expect(checkbox()?.closest("label")?.textContent).toContain("Glossary");
  });

  it("refreshes the list when an extra outside the rerun rows finishes in another tab", async () => {
    await open();
    await act(async () => jobEngine.receive([]));
    expect(checkbox()?.closest("label")?.textContent).not.toContain("Illustrated");
    const before = metadataReads;
    ran.add("illustrated");

    await act(async () => jobEngine.receive([oneStepJob("job-illustrated", "illustrated", "running")]));
    await act(async () => jobEngine.receive([oneStepJob("job-illustrated", "illustrated", "done")]));
    await settle();

    expect(metadataReads).toBeGreaterThan(before);
    expect(checkbox()?.closest("label")?.textContent).toContain("Illustrated");
  });

  it("offers no checkbox when the article has no extras", async () => {
    ran = new Set<StepName>(IMPORT_STEPS);
    await open();
    expect(card(), "the section went with the checkbox").toBeTruthy();
    expect(checkbox()).toBeNull();
  });

  it("asks before it does anything, and says what is kept, lost and paid", async () => {
    await open();
    await press(button("Start again"));

    expect(resets).toEqual([]);
    expect(jobPosts).toEqual([]);
    const text = card()?.textContent ?? "";
    expect(text).toContain("Kept");
    expect(text).toContain("comments");
    expect(text).toContain("Lost");
    expect(text).toContain("no longer in this version");
    expect(text).toContain("Cost");
    expect(button("Yes, start again"), "no Yes on the confirm").toBeTruthy();
  });

  it("describes the guarded press without making the button describe itself", async () => {
    await open();
    await press(button("Start again"));

    const yes = button("Yes, start again");
    const describedBy = yes?.getAttribute("aria-describedby");
    const description = describedBy ? document.getElementById(describedBy) : null;
    expect(description, "the guarded press has no description").toBeTruthy();
    expect(description?.contains(yes ?? null), "the description contains the button itself").toBe(
      false,
    );
    expect(card()?.querySelector("fieldset > legend")?.textContent).toBe(
      "Start this article again?",
    );
    expect(checkbox()?.closest("label")?.textContent).toContain("Also make these again");
  });

  it("states the exceptional costs of the selected extras", async () => {
    ran.add("debate");
    ran.add("sketch");
    ran.add("illustrated");
    await open();
    await press(checkbox());
    await press(button("Start again"));

    const text = card()?.textContent ?? "";
    expect(text).toContain("Debate uses two");
    /* The wait, not a price: what AI processing costs us is the administrator's
       alone since 2026-09-30 (plan 260930k § 3). */
    expect(text).toContain("Sketch takes about two minutes");
    expect(text).not.toMatch(/[$£€]\s?\d/);
    expect(text).toContain("one image call per plate");
    expect(text).toContain("arc costs another model call when you next open the reading view");
  });

  it("posts regenerate: false when the box is not ticked", async () => {
    await open();
    await press(button("Start again"));
    await press(button("Yes, start again"));

    expect(resets).toEqual([{ regenerate: false }]);
    expect(jobPosts, "a reset went through POST /api/jobs").toEqual([]);
  });

  it("posts regenerate: true when the box is ticked", async () => {
    await open();
    await press(checkbox());
    await press(button("Start again"));
    await press(button("Yes, start again"));

    expect(resets).toEqual([{ regenerate: true }]);
  });

  it("goes back to the plain button on Cancel, having sent nothing", async () => {
    await open();
    await press(button("Start again"));
    await press(button("Cancel"));
    expect(resets).toEqual([]);
    expect(button("Yes, start again")).toBeUndefined();
    expect(button("Start again")).toBeTruthy();
  });

  /**
   * **A queued job nobody drives never runs.** The POST is answered with an id,
   * and the only thing that finds the job and starts `/advance` on it is the
   * engine's poll — which only an action's poke starts, at rest. So: the list
   * is read after the press, and the reset job is advanced.
   */
  it("pokes the tab's engine, which then drives the reset job", async () => {
    jobEngine.start("reader-1");
    await open();
    await press(button("Start again"));
    const readsBefore = jobListReads;
    jobList = [resetJob("job-reset")];
    await press(button("Yes, start again"));

    expect(jobListReads, "nothing asked the queue about the new job").toBeGreaterThan(readsBefore);
    expect(advances, "the reset job was never driven").toContain("job-reset");
  });

  it("shows the job's progress in place of the button while it runs", async () => {
    await open();
    await act(async () => jobEngine.receive([]));
    await act(async () => jobEngine.receive([resetJob("job-reset", "running")]));
    await settle();

    expect(button("Start again"), "the button is still offered over a running reset")
      .toBeUndefined();
    expect(button("Stop"), "the running reset has no Stop").toBeTruthy();
  });

  it("recovers the server's regeneration list with an active reset after reload", async () => {
    await act(async () =>
      jobEngine.receive([resetJob("job-reset", "running", ["faq", "citations"])]),
    );
    await open();

    expect(button("Start again")).toBeUndefined();
    expect(card()?.textContent).toContain("Then, one after another: FAQ and Citations.");
  });

  it("reads the metadata again when the reset finishes", async () => {
    await open();
    await act(async () => jobEngine.receive([]));
    await act(async () => jobEngine.receive([resetJob("job-reset", "running")]));
    await settle();
    const before = metadataReads;
    await act(async () => jobEngine.receive([resetJob("job-reset", "done")]));
    await settle();

    expect(metadataReads).toBeGreaterThan(before);
  });

  it("reads metadata again when a regenerated extra outside the rerun rows finishes", async () => {
    resetAnswer = () => json({ jobId: "job-reset", regenerate: ["illustrated"] }, 202);
    await open();
    await act(async () => jobEngine.receive([]));
    await press(checkbox());
    await press(button("Start again"));
    await press(button("Yes, start again"));
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "running", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "queued"),
      ]),
    );
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "running"),
      ]),
    );
    await settle();
    const before = metadataReads;

    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "done"),
      ]),
    );
    await settle();

    expect(metadataReads).toBeGreaterThan(before);
  });

  it("recovers a published reset's active regeneration after reload", async () => {
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "running"),
      ]),
    );
    await open();
    const before = metadataReads;

    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "done"),
      ]),
    );
    await settle();

    expect(metadataReads).toBeGreaterThan(before);
  });

  it("does not mistake a later ordinary run for an old reset's successor", async () => {
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated-later", "illustrated", "running", "2026-09-28T00:05:00.000Z"),
      ]),
    );
    await open();

    expect(card()?.textContent).not.toContain("Doing illustrated");
    expect(button("Stop")).toBeUndefined();
  });

  it("does not show one multi-step job once for every planned extra", async () => {
    const combined: Job = {
      ...oneStepJob("job-combined", "faq", "running"),
      steps: ["faq", "citations"].map((name) => ({
        name: name as StepName,
        label: `Doing ${name}`,
        status: "pending" as const,
      })),
    };
    await act(async () =>
      jobEngine.receive([resetJob("job-reset", "done", ["faq", "citations"]), combined]),
    );
    await open();

    expect([...(card()?.querySelectorAll("button") ?? [])].filter((b) => b.textContent === "Stop"))
      .toHaveLength(0);
  });

  it("stops associating later work after the reset's successor finishes", async () => {
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "running"),
      ]),
    );
    await open();
    expect(card()?.textContent).toContain("Doing illustrated");

    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "done"),
      ]),
    );
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "done"),
        oneStepJob("job-illustrated-later", "illustrated", "running", "2026-09-28T00:05:00.000Z"),
      ]),
    );
    await settle();

    expect(card()?.textContent).not.toContain("Doing illustrated");
    expect(button("Stop")).toBeUndefined();
  });

  it("keeps a failure visible for a regenerated extra with no rerun row", async () => {
    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "running"),
      ]),
    );
    await open();
    expect(card()?.textContent).toContain("Doing illustrated");

    await act(async () =>
      jobEngine.receive([
        resetJob("job-reset", "done", ["illustrated"]),
        oneStepJob("job-illustrated", "illustrated", "error"),
      ]),
    );
    await settle();

    expect(card()?.textContent).toContain("Illustrated did not finish: Couldn't make the illustrated.");
  });

  it("shows the server's own sentence when the reset is refused", async () => {
    resetAnswer = () => json({ error: "That article is not on your shelf." }, 404);
    await open();
    await press(button("Start again"));
    await press(button("Yes, start again"));

    expect(card()?.textContent).toContain("That article is not on your shelf.");
  });

  it("shows a conflicting reset in plain words", async () => {
    resetAnswer = () =>
      json(
        { error: "A reset with different regeneration options is already queued for this article." },
        409,
      );
    await open();
    await press(button("Start again"));
    await press(button("Yes, start again"));

    expect(card()?.textContent).toContain(
      "A reset with different regeneration options is already queued for this article.",
    );
  });
  /**
   * **A confirmed Retry sends one retry, and holds *Starting…* until the new
   * job is seen.** It was `void queue.retry(id)` until 2026-10-01: the confirm
   * closed straight away and put the failure, and its Retry, back on screen
   * until a poll found the new job — and two presses of *Yes, try again* before
   * React committed sent two. GPT Sol's code review of 260930e (P3); the latch
   * is `useStepJob`'s retry, copied.
   */
  it("sends one retry however soon the second press comes, and shows Starting meanwhile", async () => {
    await failedReset();

    holdRetry = true;
    await press(button("Retry"));
    const yes = button("Yes, try again");
    expect(yes, "the Retry did not ask first").toBeTruthy();
    /* Both events before React can commit the first one's state. */
    await act(async () => {
      yes?.click();
      yes?.click();
    });
    await settle();
    expect(button("Retry"), "Retry came back while the retry was still out").toBeUndefined();
    expect(card()?.textContent).toContain("Starting");
    expect(retries).toEqual(["job-reset"]);

    await act(async () => releaseRetry?.());
    await settle();
    expect(button("Retry"), "Retry came back before the new job was seen").toBeUndefined();
    expect(retries).toEqual(["job-reset"]);

    await act(async () =>
      jobEngine.receive([
        { ...resetJob("job-reset", "error"), error: "The AI service is busy right now." },
        resetJob("job-reset-2", "running"),
      ]),
    );
    await settle();
    expect(button("Stop"), "the retried reset is not the one being watched").toBeTruthy();
    expect(card()?.textContent).not.toContain("Starting");
  });

  it("puts Retry back, not a stuck Starting, when the retry is refused", async () => {
    retryAnswer = () => json({ error: "That job cannot be tried again." }, 409);
    await failedReset();

    await press(button("Retry"));
    await press(button("Yes, try again"));

    expect(retries).toEqual(["job-reset"]);
    expect(card()?.textContent).not.toContain("Starting");
    expect(button("Retry"), "the refused retry left no way to try again").toBeTruthy();

    /* The visible button is not enough: a latch left held would let the reader
       open this confirm and then silently ignore Yes. The second attempt also
       makes this case fail on the old, unlatched implementation — its two
       same-tick presses both reached the route. */
    retryAnswer = () => json(resetJob("job-reset-2"));
    holdRetry = true;
    await press(button("Retry"));
    const yes = button("Yes, try again");
    await act(async () => {
      yes?.click();
      yes?.click();
    });
    expect(retries).toEqual(["job-reset", "job-reset"]);

    await act(async () => releaseRetry?.());
    await settle();
  });
});

/** A reset this page watched run, then fail in a way worth another go. */
async function failedReset(): Promise<void> {
  await open();
  await act(async () => jobEngine.receive([]));
  await act(async () => jobEngine.receive([resetJob("job-reset", "running")]));
  await settle();
  await act(async () =>
    jobEngine.receive([
      { ...resetJob("job-reset", "error"), error: "The AI service is busy right now." },
    ]),
  );
  await settle();
  expect(button("Retry"), "no Retry offered after a retryable failure").toBeTruthy();
}
