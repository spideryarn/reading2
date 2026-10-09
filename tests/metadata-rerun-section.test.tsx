// @vitest-environment jsdom
/**
 * **The *AI processing* section (*Re-run AI processing* until 2026-10-01) on the Metadata page** — Metadata.tsx
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
import type { Article, ArticleMetadata, Job, StageState, StepName } from "../src/types.js";

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
  titleOverridden: false,
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
/** The server's verdict on a glossary run, or absent as an older server sends it. */
let glossaryRun: ArticleMetadata["glossaryRun"];
/** The article's tags as the metadata endpoint currently sees them. */
let articleTags: string[];

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
    tags: [...articleTags],
    ...(glossaryRun !== undefined ? { glossaryRun } : {}),
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

function tagResponse(url: string, method: string, body: BodyInit | null | undefined): Response | null {
  if (url === `/api/library/${SLUG}/tags` && method === "PATCH") {
    const change = JSON.parse(String(body ?? "{}")) as {
      add?: string[];
      remove?: string[];
    };
    articleTags = articleTags.filter((tag) => !change.remove?.includes(tag));
    articleTags = [...new Set([...articleTags, ...(change.add ?? [])])].sort();
    return json({ tags: articleTags });
  }
  if (url === "/api/library/tags") {
    return json({ tags: articleTags.map((tag) => ({ tag, count: 1 })) });
  }
  return null;
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
  glossaryRun = undefined;
  articleTags = [];
  metadataReads = 0;
  jobEngine.reset();

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const tags = tagResponse(url, method, init?.body);
    if (tags) return Promise.resolve(tags);
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

describe("the AI processing section", () => {
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
      "structure",
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

  /**
   * **And once the server says which, the row says which** — plan 261001i § 3.
   * `glossaryRun` is `existingFor`'s verdict for the press this page sends, so
   * the label can promise the append again, and only when it will happen.
   */
  it("offers Find more terms when the server says the run will append", async () => {
    glossaryRun = "append";
    await open();
    expect(button("glossary", "Run it again")).toBeUndefined();
    expect(row("glossary")?.textContent).toContain(
      "Adds more terms to this list",
    );
    expect(row("glossary")?.textContent).not.toContain("otherwise");
    await press(button("glossary", "Find more terms"));
    expect(posts).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"] }]);
  });

  it("says the list will be written again when the server says it will rewrite", async () => {
    glossaryRun = "rewrite";
    await open();
    expect(button("glossary", "Find more terms")).toBeUndefined();
    expect(button("glossary", "Run it again")).toBeTruthy();
    expect(row("glossary")?.textContent).toContain(
      "Writes a new list, because",
    );
  });

  /**
   * **The verdict is judged against the purpose, and the purpose box is on this
   * page.** A saved purpose changes what the next glossary run is written from,
   * so a verdict read before it may be wrong after it: the page reads the
   * metadata again. GPT Sol's plan review of 261001i, P2.
   */
  it("reads the verdict again once a new purpose is saved", async () => {
    glossaryRun = "append";
    await open();
    const before = metadataReads;
    const box = host.querySelector<HTMLTextAreaElement>("#article-purpose");
    expect(box, "no purpose box on the page").toBeTruthy();
    glossaryRun = "rewrite";
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(box, "To check one claim.");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      box?.dispatchEvent(new FocusEvent("blur"));
    });
    await settle();
    expect(metadataReads, "the purpose was saved and the verdict not read again").toBeGreaterThan(
      before,
    );
    expect(button("glossary", "Find more terms")).toBeUndefined();
    expect(row("glossary")?.textContent).toContain(
      "Writes a new list, because",
    );
  });

  it("drops the hedge when there is no list yet", async () => {
    glossaryRun = "first";
    ran = new Set<StepName>(["arc"]);
    await open();
    expect(button("glossary", "Run it")).toBeTruthy();
    expect(host.querySelector("#rerun-note-glossary")).toBeNull();
  });

  it("says Run it over a glossary that has never run", async () => {
    ran = new Set<StepName>(["arc"]);
    await open();
    expect(button("glossary", "Run it again")).toBeUndefined();
    expect(button("glossary", "Run it")).toBeTruthy();
  });

  /**
   * What the press is and `SKETCH_WAIT`, beside the name and before any press:
   * the confirm used to be the only place on this page that said them.
   *
   * **And no price.** It named `about $0.20` until 2026-09-30, when Greg ruled
   * that what AI processing costs us is for the administrator alone —
   * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md § 3.
   */
  it("names the call and the wait on the sketch row, and no price, before anything is pressed", async () => {
    await open();

    const text = row("sketch")?.textContent ?? "";
    expect(text).toContain("One model call");
    expect(text).toContain("about a minute");
    expect(text).not.toMatch(/[$£€]\s?\d/);
    expect(posts).toEqual([]);
  });

  /**
   * **Debate is one metered web search plus optional search-free synthesis**,
   * and the dearest press on this page.
   *
   * **That range is no longer shown.** It was, until 2026-09-30: what AI
   * processing costs us is for the administrator alone (plan 260930k § 3). The
   * row still says what the reader is waiting on.
   */
  it("names Debate's web-searching call and optional synthesis call, and no price", async () => {
    await open();

    const text = row("debate")?.textContent ?? "";
    expect(text).toContain("One model call that searches the web");
    expect(text).toContain("one search-free call to find themes");
    expect(text).not.toMatch(/[$£€]\s?\d/);
  });

  it("says Skim needs Quotes before anything is pressed", async () => {
    await open();
    expect(row("skim")?.textContent).toContain(
      "Needs Quotes first; without them it stops before any model call",
    );
  });

  it("puts a note on the glossary, sketch, debate and skim rows and on no other", async () => {
    await open();
    const noted = new Set(["glossary", "sketch", "debate", "skim"]);
    for (const step of METADATA_RERUN_STEPS) {
      expect(
        host.querySelector(`#rerun-note-${step}`) !== null,
        `${step}'s note`,
      ).toBe(noted.has(step));
      /* No row names a price: what AI processing costs us is the
         administrator's alone since 2026-09-30 (plan 260930k § 3). The sketch
         and debate rows did until then. */
      expect(row(step)?.textContent ?? "", `${step}'s price`).not.toMatch(/[$£€]\s?\d/);
    }
  });

  /**
   * **The note is the button's accessible description**, asserted on the
   * resolved text rather than the attribute: an `aria-describedby` naming an id
   * that does not exist looks identical to a right one from outside. A sibling
   * `<span>` is not read to somebody reaching the button by keyboard, and with
   * the confirm gone this is the only place the note is said. ⟨Sol, plan
   * review F4, 2026-09-30.⟩ It carried a price until later that day; it says
   * what the press is now (plan 260930k § 3).
   */
  it("describes the Run and Retry buttons with the note, so a screen reader hears it", async () => {
    await open();
    const run = button("debate", "Run it again");
    const ids = (run?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    expect(ids, "Run is not described by anything").not.toEqual([]);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(described).toContain("One model call that searches the web");
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
    expect(retryDescription).toContain("One model call that searches the web");
  });

  /**
   * The stage pill lower in *AI processing* says `ran` / `not run` off the same `done`.
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

  it("does not let a stale metadata read overwrite a successful tag edit", async () => {
    articleTags = ["old"];
    await open();

    holdMetadata = true;
    await act(async () => jobEngine.receive([]));
    await act(async () => {
      jobEngine.receive([madeJob("job-before-tag-edit", "quiz", "done")]);
    });
    expect(heldMetadata).toHaveLength(1);
    expect(metadataReads).toBe(2);

    const input = host.querySelector<HTMLInputElement>('[aria-label="Add a tag"]')!;
    await act(async () => {
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "new");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(host.querySelector('[aria-label="Remove the tag new"]')).not.toBeNull();

    /* The old answer cannot commit as the final word. It is allowed to land,
       but the write arms one read behind it. */
    await act(async () => heldMetadata[0]?.());
    await settle();
    expect(metadataReads).toBe(3);
    expect(heldMetadata).toHaveLength(2);

    await act(async () => heldMetadata[1]?.());
    await settle();
    expect(host.querySelector('[aria-label="Remove the tag new"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove the tag old"]')).not.toBeNull();
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
