// @vitest-environment jsdom
/**
 * **The *Generate it again* section on the Metadata page** — Metadata.tsx
 * § `RerunSection`, stage 2 of
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md.
 *
 * Mounted through `Metadata` rather than by rendering the section directly, for
 * the reason `tests/metadata-export-button.test.tsx` gives and which is sharper
 * here: what goes wrong with a control like this is the wiring — which slug
 * reaches the request, which of nine rows a press posted for, and whether the
 * read that follows the run is the one that trails. Rendering the section with
 * hand-written props asserts the props.
 *
 * Five things here are about money or about a lost artefact rather than about
 * React:
 *
 *  - **The first press asks and posts nothing.** The confirm step is the whole
 *    answer to *"a one-click repeatable paid button on a page of nine of them is
 *    the wrong shape"*, and a test that only checked the second press would pass
 *    over a button that had lost the first.
 *  - **The second press posts exactly `{ slug, steps: [step], force: [step] }`.**
 *    A positional force would cascade over everything after it (`cascadeForce`,
 *    src/jobs.ts) and buy calls nobody pressed for; a *missing* force would run
 *    a step that skips itself as current, which reads exactly like a run that
 *    worked and changed nothing.
 *  - **The confirm row survives the round trip.** Without `busy` the plain
 *    button comes back between the press and the POST being answered, so the
 *    press looks ignored and gets made twice — docs/reusable/silent-success.md.
 *  - **The glossary says something different, in both places.** Forcing that
 *    step *appends* (src/glossary.ts § `generateGlossary`), so a row labelled
 *    *Run it again* over a confirm promising a replacement would be wrong twice
 *    about one press.
 *  - **The completion read trails an outstanding GET rather than joining it.**
 *    The last test drives the interleaving `useOrderedRead` exists for, through
 *    the page, so it is about the callback the rows were really handed.
 *
 * The rows are found by `data-rerun-step`, the same kind of hook `data-section`
 * already is on this page: nine buttons reading *Run it again* have no
 * accessible name to tell them apart, and asserting on DOM order would pass
 * whatever the list happened to be.
 */
import { act, createElement } from "react";
import { NuqsAdapter } from "nuqs/adapters/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { METADATA_RERUN_STEPS } from "../src/rerun-steps.js";
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

const ARTICLE: Article = {
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
/** Every `POST /api/jobs` body, in order. */
let posts: unknown[];
/** Resolves a held `POST /api/jobs`; set only while `holdPost` is true. */
let releasePost: (() => void) | undefined;
let holdPost = false;
/**
 * Held `GET /api/metadata/:slug` answers, oldest first — each already carrying
 * the stages as they stood **when it was asked for**, which is what makes the
 * race test's first read a genuinely stale one. Empty unless `holdMetadata`.
 */
let heldMetadata: (() => void)[];
let holdMetadata = false;
/** How many times `GET /api/metadata/:slug` has been asked for. */
let metadataReads: number;

let host: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The stage rows of `GET /api/metadata/:slug`, as they stand right now. */
function stages(): StageState[] {
  return STEP_ORDER.map((step) => ({
    step,
    label: `Doing ${step}`,
    outputs: [`data/${SLUG}/${step}.json`],
    done: ran.has(step),
    ranAt: ran.has(step) ? "2026-09-01T00:00:00.000Z" : null,
    bytes: null,
  }));
}

function metadataBody() {
  return {
    slug: SLUG,
    dir: `data/${SLUG}`,
    stages: stages(),
    comments: 0,
    profile: null,
    purpose: null,
    archivedAt: null,
  };
}

function madeJob(id: string, step: StepName, status: Job["status"] = "queued"): Job {
  return {
    id,
    ownerId: "owner" as Job["ownerId"],
    slug: SLUG,
    steps: [{ name: step, label: `Doing ${step}`, status: "pending" }],
    status,
    createdAt: "2026-09-07T00:00:00.000Z",
  };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ran = new Set<StepName>(METADATA_RERUN_STEPS);
  posts = [];
  releasePost = undefined;
  holdPost = false;
  heldMetadata = [];
  holdMetadata = false;
  metadataReads = 0;
  jobEngine.reset();

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/metadata/")) {
      metadataReads++;
      /* Snapshotted at ask-time, not at answer-time. A read that went out
         before the job wrote must carry what it would really have read. */
      const answer = json(metadataBody());
      if (!holdMetadata) return Promise.resolve(answer);
      return new Promise<Response>((go) => heldMetadata.push(() => go(answer)));
    }
    if (url === "/api/jobs" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { steps?: StepName[] };
      posts.push(body);
      const answer = json(madeJob(`job-${posts.length}`, body.steps?.[0] ?? "arc"));
      if (!holdPost) return Promise.resolve(answer);
      return new Promise<Response>((go) => {
        releasePost = () => go(answer);
      });
    }
    if (url === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
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

/** Mount the page. Settles unless the metadata answer is being held. */
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

/** Let every pending microtask and zero-delay timer run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const row = (step: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-rerun-step="${step}"]`);

function button(step: string, text: string): HTMLButtonElement | undefined {
  return [...(row(step)?.querySelectorAll("button") ?? [])].find((b) =>
    (b.textContent ?? "").includes(text),
  );
}

async function press(b: HTMLButtonElement | undefined): Promise<void> {
  await act(async () => b?.click());
  await settle();
}

describe("the Generate it again section", () => {
  it("offers a control for each of the nine and for no other step", async () => {
    await open();
    for (const step of METADATA_RERUN_STEPS) {
      expect(row(step), `no row for ${step}`).toBeTruthy();
      expect(row(step)?.querySelector("button"), `no button for ${step}`).toBeTruthy();
    }
    for (const step of [
      "fetch",
      "extract",
      "blocks",
      "assets",
      "labels",
      "hierarchy",
      "illustrated",
    ]) {
      expect(row(step), `${step} should have no control here`).toBeNull();
    }
  });

  it("asks before it spends anything", async () => {
    await open();
    await press(button("ideas", "Run it again"));

    expect(posts).toEqual([]);
    expect(row("ideas")?.textContent).toContain(
      "Another model call. The result changes only if the run succeeds.",
    );
    /* Only that row asked. A confirm that opened on all nine would be a
       page-wide state pretending to belong to a row. */
    expect(row("quotes")?.textContent).not.toContain("Another model call");
  });

  it("posts one step and one forced name on the second press", async () => {
    await open();
    await press(button("ideas", "Run it again"));
    await press(button("ideas", "Yes, run it"));

    expect(posts).toEqual([{ slug: SLUG, steps: ["ideas"], force: ["ideas"] }]);
  });

  /**
   * The gap between the press and the POST being answered — a real round trip,
   * during which the queue has nothing to report yet.
   *
   * `busy` is what holds the confirm row up across it, so the reader is still
   * looking at the sentence they agreed to with *Starting…* under it. Without it
   * the row swaps to something else mid-flight, and the second press guarded
   * below is one nothing is stopping.
   */
  it("keeps the confirm row up for the whole round trip", async () => {
    holdPost = true;
    await open();
    await press(button("timeline", "Run it again"));
    await act(async () => button("timeline", "Yes, run it")?.click());

    const midFlight = row("timeline")?.textContent ?? "";
    expect(midFlight, "the confirm row went away mid-flight").toContain("Another model call");
    expect(midFlight).toContain("Starting");
    expect(button("timeline", "Run it again")).toBeUndefined();

    /* And a second press on it must not buy a second run. */
    for (const b of [...(row("timeline")?.querySelectorAll("button") ?? [])]) {
      await act(async () => b.click());
    }
    expect(posts).toHaveLength(1);

    await act(async () => releasePost?.());
    await settle();
    expect(posts).toHaveLength(1);
  });

  /**
   * Forcing the glossary **appends** a batch of terms. A row labelled *Run it
   * again* over a confirm promising a replacement would be wrong twice about
   * one press, which is why the label and the sentence move together.
   */
  it("says what the glossary really does, in the button and in the confirm", async () => {
    await open();
    expect(button("glossary", "Run it again")).toBeUndefined();
    await press(button("glossary", "Find more terms"));

    expect(row("glossary")?.textContent).toContain("New terms are added only if the run succeeds.");
    expect(row("glossary")?.textContent).not.toContain("The result changes only if");
  });

  /**
   * `SKETCH_PRICE` and `SKETCH_WAIT`, because *"another model call"* understates
   * this press by an order of magnitude.
   */
  it("names the price and the wait on the sketch row", async () => {
    await open();
    await press(button("sketch", "Run it again"));

    const text = row("sketch")?.textContent ?? "";
    expect(text).toContain("about $0.20");
    expect(text).toContain("about two minutes");
  });

  /**
   * The pill in *Technical details* says `ran` / `not run` off the same `done`.
   * A button offering to run something *again* over a row that says it never ran
   * is the page contradicting itself.
   */
  it("says Run it, not Run it again, for a stage that has not run", async () => {
    ran = new Set<StepName>(["arc"]);
    await open();

    expect(button("quiz", "Run it again")).toBeUndefined();
    expect(button("quiz", "Run it")).toBeTruthy();
    expect(button("arc", "Run it again")).toBeTruthy();
  });

  /**
   * **The completion read must trail an outstanding metadata GET, never join
   * it** — the whole of `useOrderedRead`, driven here through the page.
   *
   * The losing interleaving: a GET goes out and reads the pre-job stages; the
   * job finishes and the row's `onFinished` fires; a `reload` would *join* that
   * request and be answered with what it already read, so no second read ever
   * happens and the new artefact is lost for good — nothing announces a job
   * twice. `refresh` arms a trailing read instead.
   *
   * Passing `reload` where `refresh` belongs makes this go red and nothing else
   * in this file does.
   */
  it("does not let a stale metadata read overwrite what a finished run wrote", async () => {
    ran = new Set<StepName>(["arc"]);
    holdMetadata = true;
    await open();

    /* The opening GET is out and holding the pre-job stages. */
    expect(heldMetadata).toHaveLength(1);
    expect(metadataReads).toBe(1);

    /* The run lands while it is still in the air: the queue reports the job as
       done, which is what calls `onFinished`. Two lists, because the engine
       treats the **first** one it ever sees as a baseline rather than as news —
       opening the app does not make every job that ever succeeded finish
       again (`recordCompletions`, src/web/jobEngine.ts). */
    ran = new Set<StepName>(["arc", "quiz"]);
    await act(async () => jobEngine.receive([]));
    await act(async () => {
      jobEngine.receive([madeJob("job-1", "quiz", "done")]);
    });

    /* Now the stale answer arrives — carrying the stages as they were before
       the quiz was written. */
    await act(async () => heldMetadata[0]?.());
    await settle();

    /* A second read went out because the first was not an answer to the
       question the completion asked. */
    expect(metadataReads, "the completion joined the read already in flight").toBe(2);
    await act(async () => heldMetadata[1]?.());
    await settle();

    /* And the page ends on what the run wrote, not on what the older read
       carried. */
    expect(button("quiz", "Run it again"), "the stale read won").toBeTruthy();
  });
});
