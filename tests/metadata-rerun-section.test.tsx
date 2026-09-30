// @vitest-environment jsdom
/**
 * **The *Re-run AI processing* section on the Metadata page** — Metadata.tsx
 * § `RerunSection`, stage 2 of
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md.
 *
 * Mounted through `Metadata` rather than by rendering the section directly, for
 * the reason `tests/metadata-export-button.test.tsx` gives and which is sharper
 * here: what goes wrong with a control like this is the wiring — which slug
 * reaches the request, which row a press posted for, and whether the
 * read that follows the run is the one that trails. Rendering the section with
 * hand-written props asserts the props.
 *
 * Five things here are about money or about a lost artefact rather than about
 * React:
 *
 *  - **One press posts exactly `{ slug, steps: [step], force: [step] }`**, and
 *    asks nothing first — since 2026-09-30, when Greg asked for the confirm to
 *    go (SPIDERYARN-READING2-64). A positional force would cascade over
 *    everything after it (`cascadeForce`, src/jobs.ts) and buy calls nobody
 *    pressed for; a *missing* force would run a step that skips itself as
 *    current, which reads exactly like a run that worked and changed nothing.
 *  - **A double press posts once.** With no confirm, `starting` is the only
 *    thing between a double click and two paid runs.
 *  - **The Sketch and Debate rows say their price before the press**, which
 *    the confirm used to be the only place to say.
 *  - **The glossary's note says it may add or rewrite**, because which one a
 *    forced run does is `existingFor`'s decision (src/glossary.ts), not the
 *    page's to predict.
 *  - **The completion read trails an outstanding GET rather than joining it.**
 *    The last test drives the interleaving `useOrderedRead` exists for, through
 *    the page, so it is about the callback the rows were really handed.
 *
 * The rows are found by `data-rerun-step`, the same kind of hook `data-section`
 * already is on this page, because asserting on DOM order would pass whatever
 * the list happened to be.
 *
 * **That attribute is a test hook and nothing else, and this header said
 * otherwise until 2026-09-07** — it read *"nine buttons reading Run it again
 * have no accessible name to tell them apart"*, which described a defect and
 * then used the hook to work around it in the tests. A cross-family review found
 * the defect by reading this file (⟨Sol, F11⟩). The last test here is the one
 * that would have: it asserts on the computed accessible names, which is what a
 * reader navigating by button list actually gets.
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

/**
 * **Whether the experimental switch reads as on** — off unless a test says
 * otherwise, which is what a reader who has never touched it gets.
 *
 * Mocked so the rows' rule about the switch is asserted rather than inherited
 * from however an unanswered `GET /api/reader` happens to settle. **The rule is
 * that there is no rule**: a mode behind the switch (Timeline, Quiz, Debate,
 * FAQ, Citations) keeps its row here with the switch off, because hiding is
 * about the bar's clutter and never about reaching a thing already made —
 * docs/project/experimental-features.md § The four rules.
 */
let experimentalOn = false;
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
/** Every `POST /api/jobs` body, in order. */
let posts: unknown[];
/**
 * The id of every `POST /api/jobs/:id/retry`, in order.
 *
 * A separate list from `posts` on purpose: a confirmed Retry must reach *this*
 * route and not start a fresh job, and one list of "things that were sent" could
 * not tell those apart.
 */
let retries: string[];
/** Resolves a held `POST /api/jobs`; set only while `holdPost` is true. */
let releasePost: (() => void) | undefined;
let holdPost = false;
/** Resolves a held `POST /api/jobs/:id/retry`; set only while `holdRetry` is true. */
let releaseRetry: (() => void) | undefined;
let holdRetry = false;
/** The retry route's next answer, varied by refusal tests. */
let retryAnswer: () => Response;
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
    startedAt: ran.has(step) ? "2026-08-31T23:59:52.000Z" : null,
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
  experimentalOn = false;
  posts = [];
  retries = [];
  releasePost = undefined;
  holdPost = false;
  releaseRetry = undefined;
  holdRetry = false;
  retryAnswer = () => json(madeJob("job-retried", "quotes"));
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
    const retried = /^\/api\/jobs\/([^/]+)\/retry$/.exec(url);
    if (retried && method === "POST") {
      retries.push(retried[1] ?? "");
      const answer = retryAnswer();
      if (!holdRetry) return Promise.resolve(answer);
      return new Promise<Response>((go) => {
        releaseRetry = () => go(answer);
      });
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

describe("the Re-run AI processing section", () => {
  it("offers a control for each step on the list and for no other step", async () => {
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

  /**
   * **FAQ and Citations joined on 2026-09-29**, when their out-of-date banner —
   * their only redo — went (docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md).
   * Both are behind the experimental switch, and so are Timeline, Quiz and
   * Debate, whose rows have always been drawn whatever the switch says: the
   * same rule, asserted for all five with it off and on.
   */
  it.each([false, true])(
    "draws the rows of modes behind the switch whether it is on or off (on: %s)",
    async (on) => {
      experimentalOn = on;
      await open();
      for (const step of ["timeline", "quiz", "faq", "debate", "citations"]) {
        expect(row(step), `no row for ${step}`).toBeTruthy();
        expect(button(step, "Run it again"), `no button for ${step}`).toBeTruthy();
      }
      expect(row("faq")?.textContent).toContain("FAQ");
      expect(row("citations")?.textContent).toContain("Citations");
    },
  );

  it.each(["faq", "citations"])(
    "runs the %s row on one press, forcing that step alone",
    async (step) => {
      await open();
      await press(button(step, "Run it again"));
      expect(posts).toEqual([{ slug: SLUG, steps: [step], force: [step] }]);
    },
  );

  /**
   * **One press, since 2026-09-30** — Greg, SPIDERYARN-READING2-64: *"don't
   * include the confirmation step. Just do it."* What the confirm guarded, and
   * why it went for every reader, is `RerunRow`'s header in Metadata.tsx.
   *
   * The payload is the half that still matters: a positional force would
   * cascade over everything after it (`cascadeForce`, src/jobs.ts) and buy
   * calls nobody pressed for; a missing force would run a step that skips
   * itself as current, which reads exactly like a run that worked and changed
   * nothing.
   */
  it("posts one step and one forced name on the first press, and asks nothing", async () => {
    await open();
    await press(button("ideas", "Run it again"));

    expect(posts).toEqual([{ slug: SLUG, steps: ["ideas"], force: ["ideas"] }]);
    expect(button("ideas", "Yes"), "a confirm is still drawn").toBeUndefined();
    expect(row("ideas")?.textContent).not.toContain("model call");
  });

  /**
   * **With the confirm gone, a synchronous ref closes the gap before React can
   * commit `starting`.** After that commit, `JobProgress` draws a status in
   * place of the button until polling carries the returned job — so there is
   * no second button after the POST answers either.
   */
  it("posts once however soon the second press comes", async () => {
    holdPost = true;
    await open();
    const run = button("timeline", "Run it again");
    /* Both events before React can commit the first one's state, as the Retry
       test below does: two separate `act` calls would click a detached button
       the second time and pass without any latch. */
    await act(async () => {
      run?.click();
      run?.click();
    });

    expect(row("timeline")?.textContent).toContain("Starting");
    expect(button("timeline", "Run it again"), "the button stayed up mid-flight").toBeUndefined();
    for (const b of [...(row("timeline")?.querySelectorAll("button") ?? [])]) {
      await act(async () => b.click());
    }
    expect(posts).toHaveLength(1);

    await act(async () => releasePost?.());
    await settle();
    expect(row("timeline")?.textContent).toContain("Starting");
    expect(
      button("timeline", "Run it again"),
      "the button returned after the POST but before the job appeared in polling",
    ).toBeUndefined();
    expect(posts).toHaveLength(1);
  });

  /**
   * **The glossary gets the plain label, and a note that says both outcomes.**
   * Forcing it appends when `existingFor` (src/glossary.ts) accepts the old
   * list — same source, prompt version and reader profile — and rewrites it
   * otherwise. *Find more terms* promised the append every time, and keying
   * the label on `done` guessed wrong both ways, because `done` tracks the
   * model and not the profile (GPT Sol, both reviews, 2026-09-30).
   */
  it("labels the glossary like any mode and says it may add or rewrite", async () => {
    await open();
    expect(button("glossary", "Find more terms")).toBeUndefined();
    expect(row("glossary")?.textContent).toContain(
      "Adds more terms to an up-to-date list; otherwise writes a new one",
    );
    await press(button("glossary", "Run it again"));
    expect(posts).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"] }]);
  });

  it("says Run it over a glossary that has never run", async () => {
    ran = new Set<StepName>(["arc"]);
    await open();
    expect(button("glossary", "Run it again")).toBeUndefined();
    expect(button("glossary", "Run it")).toBeTruthy();
  });

  /**
   * `SKETCH_PRICE` and `SKETCH_WAIT`, beside the name and before any press:
   * the confirm used to be the only place on this page that said them.
   */
  it("names the price and the wait on the sketch row before anything is pressed", async () => {
    await open();

    const text = row("sketch")?.textContent ?? "";
    expect(text).toContain("about $0.20");
    expect(text).toContain("about two minutes");
    expect(posts).toEqual([]);
  });

  /**
   * **Debate is two separately metered calls, not one** (src/debate.ts § *Two
   * groups, two passes, one atomic step*), and the dearest press on this page —
   * $0.20–0.40 for a completed run on a short article, rising with length
   * (docs/plans/260905f-debate-mode-stage-0-spike-results.md § Stage 3½ § 1).
   *
   * **The range, not the ceiling.** *Up to about $0.27* came from that spike's
   * § The spend ceiling, which § Stage 3½ corrects further down: the probes
   * carried no article, and a completed live run cost $0.3527 ⟨Sol, F12⟩.
   */
  it("names up to two calls and the price range on the debate row", async () => {
    await open();

    const text = row("debate")?.textContent ?? "";
    /* *Up to*: pass B runs only if pass A succeeded (src/debate.ts). */
    expect(text).toContain("Up to two calls");
    expect(text).toContain("$0.20–0.40 on a short article, more on a long one");
    expect(text, "the debate row quotes the disproven ceiling").not.toContain("$0.27");
  });

  it("says Trajectory needs Quotes before anything is pressed", async () => {
    await open();
    expect(row("trajectory")?.textContent).toContain(
      "Needs Quotes first; without them it stops before any model call",
    );
  });

  it("puts a note on the glossary, sketch, debate and trajectory rows and on no other", async () => {
    await open();
    const noted = new Set(["glossary", "sketch", "debate", "trajectory"]);
    for (const step of METADATA_RERUN_STEPS) {
      expect(
        host.querySelector(`#rerun-note-${step}`) !== null,
        `${step}'s note`,
      ).toBe(noted.has(step));
      expect((row(step)?.textContent ?? "").includes("$"), `${step}'s price`).toBe(
        step === "sketch" || step === "debate",
      );
    }
  });

  /**
   * **The note is the button's accessible description**, asserted on the
   * resolved text rather than the attribute: an `aria-describedby` naming an id
   * that does not exist looks identical to a right one from outside. A sibling
   * `<span>` is not read to somebody reaching the button by keyboard, and with
   * the confirm gone this is the only place the price is said. ⟨Sol, plan
   * review F4, 2026-09-30.⟩
   */
  it("describes the Run and Retry buttons with the note, so a screen reader hears the price", async () => {
    await open();
    const run = button("debate", "Run it again");
    const ids = (run?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    expect(ids, "Run is not described by anything").not.toEqual([]);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(described).toContain("$0.20–0.40");
    expect(button("quotes", "Run it again")?.hasAttribute("aria-describedby")).toBe(false);

    await press(run);
    await act(async () => jobEngine.receive([]));
    await act(async () => {
      jobEngine.receive([
        { ...madeJob("job-1", "debate", "error"), error: "The AI service is busy right now." },
      ]);
    });
    await settle();
    const retry = button("debate", "Retry");
    const retryIds = (retry?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const retryDescription = retryIds
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(retryDescription).toContain("$0.20–0.40");
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

  /**
   * **A Retry goes straight through too, and to the retry route.**
   *
   * It asked first from 2026-09-07 ⟨Sol, F10⟩, because `retryJob` carries the
   * original force forward and so re-buys the forced step. That is exactly what
   * the run buys, so since 2026-09-30 it is one press like the run — asking on
   * one and not the other would be a rule with no reason behind it.
   *
   * What still matters is **where** it goes: `/api/jobs/:id/retry`, and **not**
   * `POST /api/jobs`, which would be a different job.
   */
  it("retries the failed job on one press rather than starting a new one", async () => {
    await open();
    await press(button("quotes", "Run it again"));
    expect(posts).toHaveLength(1);

    /* The job the press made, come back failed. No `failureKind`, so
       `jobWorthRetrying` says yes and the band offers Retry. Two lists because
       the engine treats the first one it ever sees as a baseline. */
    await act(async () => jobEngine.receive([]));
    await act(async () => {
      jobEngine.receive([
        { ...madeJob("job-1", "quotes", "error"), error: "The AI service is busy right now." },
      ]);
    });
    await settle();
    expect(button("quotes", "Retry"), "no Retry offered after a retryable failure").toBeTruthy();

    await press(button("quotes", "Retry"));
    expect(retries, "Retry did not reach the retry route").toEqual(["job-1"]);
    expect(posts, "Retry started a new job").toHaveLength(1);
  });

  /**
   * **And a double click on Retry sends one retry.** Until 2026-09-30 a Retry
   * was fired and forgotten (`void queue.retry(id)`), so its button stayed up
   * until a poll found the new job — harmless behind a confirm, two paid
   * retries without one. ⟨Sol, plan review F1.⟩
   */
  it("sends one retry however soon the second press comes", async () => {
    await open();
    await press(button("quotes", "Run it again"));
    await act(async () => jobEngine.receive([]));
    await act(async () => {
      jobEngine.receive([
        { ...madeJob("job-1", "quotes", "error"), error: "The AI service is busy right now." },
      ]);
    });
    await settle();

    holdRetry = true;
    const retry = button("quotes", "Retry");
    /* Both events before React can commit the first one's state update. Two
       separate `act` calls only click a detached old button the second time and
       stay green without a synchronous request latch. */
    await act(async () => {
      retry?.click();
      retry?.click();
    });
    expect(button("quotes", "Retry"), "Retry stayed up mid-flight").toBeUndefined();
    expect(row("quotes")?.textContent).toContain("Starting");
    for (const b of [...(row("quotes")?.querySelectorAll("button") ?? [])]) {
      await act(async () => b.click());
    }
    expect(retries).toEqual(["job-1"]);

    await act(async () => releaseRetry?.());
    await settle();
    expect(retries).toEqual(["job-1"]);
    expect(posts).toHaveLength(1);
  });

  it("restores Retry instead of leaving Starting stuck when the retry is refused", async () => {
    retryAnswer = () => json({ error: "That job cannot be tried again." }, 409);
    await open();
    await press(button("quotes", "Run it again"));
    await act(async () => jobEngine.receive([]));
    await act(async () => {
      jobEngine.receive([
        { ...madeJob("job-1", "quotes", "error"), error: "The AI service is busy right now." },
      ]);
    });
    await settle();

    await press(button("quotes", "Retry"));

    expect(retries).toEqual(["job-1"]);
    expect(row("quotes")?.textContent).not.toContain("Starting");
    expect(button("quotes", "Retry"), "the refused action left no way to try again").toBeTruthy();
  });

  /**
   * **The accessible name is what tells a dozen identical buttons apart**, and
   * until 2026-09-07 nothing did: the mode's name is a sibling `<span>`, which a
   * screen reader's button list does not read ⟨Sol, F11⟩.
   *
   * Asserted on the name and not on `data-rerun-step`. That attribute is how the
   * *tests* find a row, and reading it as if it were a distinction the reader
   * gets is exactly what papered this over.
   *
   * **Each name begins with the visible text**, so speech input still matches:
   * somebody saying "Run it again" must not be told there is no such control.
   */
  it("gives every control in a row an accessible name that names the mode", async () => {
    await open();

    const names = METADATA_RERUN_STEPS.map((step) => {
      const b = row(step)?.querySelector("button");
      const name = b?.getAttribute("aria-label") ?? "";
      expect(name, `no accessible name on the ${step} button`).not.toBe("");
      /* The words on the button, then what it is about. */
      expect(name.startsWith(b?.textContent ?? "…"), `${name} does not start with its own text`).toBe(
        true,
      );
      return name;
    });
    expect(new Set(names).size, `two rows share a name: ${names.join(", ")}`).toBe(
      METADATA_RERUN_STEPS.length,
    );
  });
});
