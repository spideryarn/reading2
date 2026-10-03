// @vitest-environment jsdom
/**
 * **"Why are you reading this?" on the add page** — stage 1 of
 * docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md.
 *
 * What is pinned, and why each matters:
 *
 *  - **The save lands before any mode is queued.** Each job freezes the profile
 *    when it is posted, so a PATCH that loses the race means five modes written
 *    without the sentence the reader just typed.
 *  - **An empty box is never sent** (Sol's F1). `purpose: null` clears the
 *    stored sentence, and on a re-add this box starts empty over one the reader
 *    cannot see.
 *  - **Exactly one queue and one navigation**, under StrictMode and a double
 *    press (F2). The server would de-duplicate the second set of jobs; nothing
 *    would de-duplicate the second navigation.
 *  - **A failed save queues nothing**, so no mode is written without it.
 *
 * Table-driven over the three ways an add finishes (F8), because each used to
 * queue and navigate on its own and the bug that matters is one of them
 * forgetting the rule.
 *
 * `JobCard` is the real one here — the Retry test (F3) is about what pressing
 * its button does to the page around it.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
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
/* And `sessionStorage`, where the ask-purpose mark lives (plan 261001s § Stage 3). */
const session = new Map<string, string>();
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => void session.set(key, value),
    removeItem: (key: string) => void session.delete(key),
    clear: () => session.clear(),
  },
});
const mark = () => session.get("spideryarn.ask-purpose") ?? null;

/** Everything that left the page, in order: `patch:<body>` and `run:<steps>`. */
const events: string[] = [];
const runs = () => events.filter((e) => e.startsWith("run:"));
const patches = () => events.filter((e) => e.startsWith("patch:"));

let jobs: Job[] = [];
let addResult: Job | null = null;
let addUploadResult: Promise<Job | { article: string } | null> = Promise.resolve(null);
let retryResult: (() => Job | null) | null = null;
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => addResult,
  addUpload: () => addUploadResult as ReturnType<UseJobs["addUpload"]>,
  run: async (request) => {
    events.push(`run:${request.steps.join(",")}`);
    return null;
  },
  reset: async () => null,
  cancel: async () => {},
  retry: async () => retryResult?.() ?? null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));

let transfer: Transfer | null = null;
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));
vi.mock("../src/web/uploadEngine.js", () => ({ uploadEngine: { retry: () => {}, cancel: () => {} } }));

const navigations: string[] = [];
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => navigations.push(href),
}));

/** How High-powered AI's PUT answers (plan 261002k). Replaced per test. */
let putAnswer: () => Promise<Response> = async () =>
  new Response(JSON.stringify({ highPowerSince: "2026-10-02T23:00:00.000Z" }), { status: 200 });
const puts = () => events.filter((e) => e.startsWith("put:"));

/** How the PATCH answers. Replaced per test; the default stores what it was sent. */
let patchAnswer: (body: { purpose: string | null }) => Promise<Response> = async (body) =>
  new Response(JSON.stringify({ purpose: body.purpose?.trim() ?? null }), { status: 200 });
vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string, init: RequestInit = {}) => {
      if (init.method === "PUT" && input.endsWith("/high-power")) {
        const body = JSON.parse(String(init.body)) as { on: boolean };
        events.push(`put:${input.split("/")[3]}:${body.on}`);
        return putAnswer();
      }
      if (init.method === "PATCH" && input.startsWith("/api/library/")) {
        const body = JSON.parse(String(init.body)) as { purpose: string | null };
        events.push(`patch:${JSON.stringify(body)}`);
        return patchAnswer(body);
      }
      throw new Error(`unexpected fetch ${input}`);
    },
  };
});

const { autoModePosts, writeAutoModes } = await import("../src/web/auto-modes.js");
const { AddPage } = await import("../src/web/AddPage.js");

const SLUG = "a-paper";
const UPLOAD_ID = "up-1";
const URL_SOURCE = { kind: "url", url: "https://example.com/a-paper" } as const;
const UPLOAD_SOURCE = { kind: "upload", uploadId: UPLOAD_ID } as const;
/* The order the page posts in — `autoModePosts`, which `queueAutoModes` reads
   (tests/auto-modes.test.tsx pins that order independently). Not
   `autoModeRequests()`'s order since `crossrefs` joined (260930f). */
const EXPECTED_RUNS = () => {
  const { together, after } = autoModePosts();
  return [...together, ...after].map((steps) => `run:${steps.join(",")}`);
};

const makeJob = (id: string, status: Job["status"], slug = SLUG): Job =>
  ({ id, slug, status, steps: [] }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;
let strict = false;
let source: Parameters<typeof AddPage>[0]["source"] = URL_SOURCE;

function render(next = source): void {
  source = next;
  const page = createElement(AddPage, { source });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const box = (): HTMLTextAreaElement => {
  const el = host.querySelector<HTMLTextAreaElement>("textarea");
  if (!el) throw new Error("no purpose box on the page");
  return el;
};
const button = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const press = (name: string): void => {
  const b = button(name);
  if (!b) throw new Error(`no ${name} button`);
  act(() => b.click());
};

function type(value: string): void {
  const el = box();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const focus = () => act(() => box().focus());
const blur = () => act(() => box().blur());

/**
 * The three ways an add finishes. `start` leaves the page mid-add with the
 * purpose box showing; `finish` makes the completion arrive.
 */
interface Producer {
  name: string;
  start(): Promise<void>;
  finish(): Promise<void>;
}

const PRODUCERS: Producer[] = [
  {
    name: "a job reaching done",
    async start() {
      addResult = makeJob("job-1", "running");
      jobs = [addResult];
      render(URL_SOURCE);
      await settle();
    },
    async finish() {
      jobs = [makeJob("job-1", "done")];
      render();
      await settle();
    },
  },
  {
    name: "the engine's upload answered with an existing article",
    async start() {
      transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 10, phase: { kind: "sending", sent: 4 } };
      render(UPLOAD_SOURCE);
      await settle();
    },
    async finish() {
      transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 10, phase: { kind: "article", slug: SLUG } };
      render();
      await settle();
    },
  },
  {
    name: "this page's own POST answered with an existing article",
    async start() {
      let answer: (value: { article: string }) => void = () => {};
      addUploadResult = new Promise((resolve) => {
        answer = resolve;
      });
      this.finish = async () => {
        answer({ article: SLUG });
        await settle();
      };
      render(UPLOAD_SOURCE);
      await settle();
    },
    async finish() {
      throw new Error("start() sets this");
    },
  },
];

beforeEach(() => {
  window.localStorage.clear();
  session.clear();
  events.length = 0;
  navigations.length = 0;
  jobs = [];
  addResult = null;
  addUploadResult = Promise.resolve(null);
  retryResult = null;
  transfer = null;
  strict = false;
  source = URL_SOURCE;
  patchAnswer = async (body) =>
    new Response(JSON.stringify({ purpose: body.purpose?.trim() ?? null }), { status: 200 });
  putAnswer = async () =>
    new Response(JSON.stringify({ highPowerSince: "2026-10-02T23:00:00.000Z" }), { status: 200 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe.each(PRODUCERS)("when $name", (producer) => {
  it("an untouched box opens the article exactly as before, with no PATCH", async () => {
    await producer.start();
    expect(box(), "the purpose box was not offered while the add ran").toBeTruthy();
    await producer.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(patches()).toEqual([]);
  });

  it("a typed box waits, then Save and open PATCHes before any mode is queued", async () => {
    await producer.start();
    focus();
    type("how they handled missing data");
    blur();
    await producer.finish();
    expect(navigations, "navigated over a typed purpose").toEqual([]);
    expect(runs(), "queued modes before the purpose was saved").toEqual([]);
    press("Save and open");
    await settle();
    expect(patches()).toEqual([`patch:${JSON.stringify({ purpose: "how they handled missing data" })}`]);
    expect(events.indexOf(patches()[0] as string)).toBe(0);
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a failed save stays on the page with the draft, and queues nothing", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "The shelf is unavailable." }), { status: 503 });
    await producer.start();
    type("the evidence");
    await producer.finish();
    press("Save and open");
    await settle();
    expect(patches()).toHaveLength(1);
    expect(runs()).toEqual([]);
    expect(navigations).toEqual([]);
    expect(box().value).toBe("the evidence");
    expect(host.textContent).toContain("The shelf is unavailable.");
    expect(button("Save and open")?.disabled, "no second go after a failure").toBe(false);
  });

  it("Open without it queues and opens without a PATCH", async () => {
    await producer.start();
    type("the evidence");
    await producer.finish();
    press("Open without it");
    await settle();
    expect(patches()).toEqual([]);
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a touched-but-empty box never sends a PATCH, focused or not (F1)", async () => {
    await producer.start();
    focus();
    type("x");
    type("   ");
    /* Still focused: the reader may be about to type, so it waits. */
    await producer.finish();
    expect(navigations).toEqual([]);
    press("Save and open");
    await settle();
    expect(patches(), "an empty draft was sent, which would clear a stored purpose").toEqual([]);
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a touched, emptied and blurred box opens as if untouched", async () => {
    await producer.start();
    focus();
    type("x");
    type("");
    blur();
    await producer.finish();
    expect(patches()).toEqual([]);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("under StrictMode, untouched: one queue and one navigation", async () => {
    strict = true;
    await producer.start();
    await producer.finish();
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("under StrictMode, a double press: one PATCH, one queue, one navigation", async () => {
    strict = true;
    await producer.start();
    type("the evidence");
    await producer.finish();
    const save = button("Save and open");
    act(() => {
      save?.click();
      save?.click();
    });
    press("Open without it");
    await settle();
    expect(patches()).toHaveLength(1);
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("a completion already there on the first render", () => {
  it("under StrictMode's double effect: one queue and one navigation", async () => {
    /* The only producer that can be non-null at mount — the other two arrive
       through state an effect sets — so the only one that meets StrictMode's
       second run of the deciding effect. */
    strict = true;
    transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 10, phase: { kind: "article", slug: SLUG } };
    render(UPLOAD_SOURCE);
    await settle();
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("while the save is in flight", () => {
  it("queues nothing, disables both buttons, and goes on only once it answers", async () => {
    let answer: (r: Response) => void = () => {};
    patchAnswer = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const producer = PRODUCERS[0] as Producer;
    await producer.start();
    type("the evidence");
    await producer.finish();
    press("Save and open");
    await settle();
    expect(runs()).toEqual([]);
    expect(navigations).toEqual([]);
    expect(button("Saving…")?.disabled, "Save was not disabled while saving").toBe(true);
    expect(button("Open without it")?.disabled).toBe(true);
    expect(box().disabled, "the box could accept words that were not in the save").toBe(true);
    act(() => button("Open without it")?.click());
    await settle();
    expect(runs(), "Open without it raced the save").toEqual([]);
    answer(new Response(JSON.stringify({ purpose: "the evidence" }), { status: 200 }));
    await settle();
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("when the address changes before the old completion is opened", () => {
  const OTHER_SOURCE = { kind: "url", url: "https://example.com/another-paper" } as const;
  const OTHER_SLUG = "another-paper";

  async function readyFirstArticle(): Promise<void> {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    type("the first article's evidence");
    jobs = [makeJob("job-1", "done")];
    render();
    await settle();
    expect(button("Save and open")).toBeTruthy();
  }

  it("does not carry the old article's purpose into the new add", async () => {
    await readyFirstArticle();
    addResult = makeJob("job-2", "running", OTHER_SLUG);
    jobs = [makeJob("job-1", "done"), addResult];
    render(OTHER_SOURCE);
    await settle();
    expect(box().value).toBe("");

    jobs = [makeJob("job-1", "done"), makeJob("job-2", "done", OTHER_SLUG)];
    render();
    await settle();
    expect(patches()).toEqual([]);
    expect(navigations).toEqual([`/read/${OTHER_SLUG}`]);
  });

  it("ignores the old save when it answers after the new add has begun", async () => {
    let answer: (r: Response) => void = () => {};
    patchAnswer = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await readyFirstArticle();
    press("Save and open");
    await settle();

    addResult = makeJob("job-2", "running", OTHER_SLUG);
    jobs = [makeJob("job-1", "done"), addResult];
    render(OTHER_SOURCE);
    await settle();
    answer(new Response(JSON.stringify({ purpose: "the first article's evidence" }), { status: 200 }));
    await settle();

    expect(runs()).toEqual([]);
    expect(navigations).toEqual([]);
    expect(box().value).toBe("");
  });
});

describe("the shortcut and the tick box", () => {
  it("⌘/Ctrl+Enter in the box is Save and open", async () => {
    const producer = PRODUCERS[0] as Producer;
    await producer.start();
    type("the evidence");
    await producer.finish();
    act(() => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await settle();
    expect(patches()).toHaveLength(1);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("saves the purpose even when the modes are not to be generated", async () => {
    writeAutoModes(false);
    const producer = PRODUCERS[0] as Producer;
    await producer.start();
    type("the evidence");
    await producer.finish();
    press("Save and open");
    await settle();
    expect(patches()).toHaveLength(1);
    expect(runs()).toEqual([]);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("Retry after a failed import (F3)", () => {
  async function failThenRetry(): Promise<void> {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    return;
  }

  async function retryToDone(): Promise<void> {
    jobs = [makeJob("job-1", "error")];
    render();
    await settle();
    retryResult = () => {
      const replacement = makeJob("job-2", "running");
      jobs = [makeJob("job-1", "error"), replacement];
      return replacement;
    };
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry"));
    expect(retry, "the failed job's card offered no Retry").toBeTruthy();
    act(() => retry?.click());
    await settle();
    jobs = [makeJob("job-1", "error"), makeJob("job-2", "done")];
    render();
    await settle();
  }

  it("follows the replacement job and opens the article when it finishes", async () => {
    await failThenRetry();
    await retryToDone();
    expect(navigations, "the page kept watching the failed job").toEqual([`/read/${SLUG}`]);
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(mark(), "an untouched retry completion lost the first-open question").toBe(SLUG);
  });

  it("does not mark a retry completion after the empty box was focused and blurred", async () => {
    await failThenRetry();
    focus();
    blur();
    await retryToDone();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark(), "Retry forgot that the reader had already seen the box").toBeNull();
  });

  it("does not promise the import will finish once it has failed (261001s browser check)", async () => {
    await failThenRetry();
    type("the evidence");
    expect(statusLine()).toBe("Not saved yet — kept here until the import finishes.");
    jobs = [makeJob("job-1", "error")];
    render();
    await settle();
    expect(statusLine()).toBe(
      "Not saved — the import didn't finish, so there is nothing to save it to yet.",
    );
  });

  it("keeps a typed purpose across the retry", async () => {
    await failThenRetry();
    type("the evidence");
    await retryToDone();
    expect(box().value).toBe("the evidence");
    press("Save and open");
    await settle();
    expect(patches()).toHaveLength(1);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

/* ---------------------------------------------------------------------------
 * Plan 261001s (Greg, 2026-10-01, spya-hbqezu): *"it doesn't have a UI
 * indication of when/whether it has saved it or not"* — Stage 2's status line —
 * and *"if they don't fill this in … pop up an input box asking why they're
 * reading it when the article loads for the first time"* — Stage 3's mark.
 * ------------------------------------------------------------------------- */

const statusLine = (): string => host.querySelector(".prof-save")?.textContent?.trim() ?? "";

describe("the purpose box's status line (261001s § Stage 2)", () => {
  it("says nothing over an empty box, and says where typed words are in each phase", async () => {
    let answer: (r: Response) => void = () => {};
    patchAnswer = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const producer = PRODUCERS[0] as Producer;
    await producer.start();
    expect(statusLine(), "an empty box claimed a save state").toBe("");
    type("the evidence");
    expect(statusLine()).toBe("Not saved yet — kept here until the import finishes.");
    await producer.finish();
    expect(statusLine()).toBe("Not saved yet — Save and open stores it.");
    press("Save and open");
    await settle();
    expect(statusLine()).toBe("Saving…");
    answer(new Response(JSON.stringify({ purpose: "the evidence" }), { status: 200 }));
    await settle();
  });

  it("shows a refusal in the line, and an edit clears it (Sol's item 10)", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "The shelf is unavailable." }), { status: 503 });
    const producer = PRODUCERS[0] as Producer;
    await producer.start();
    type("the evidence");
    await producer.finish();
    press("Save and open");
    await settle();
    expect(statusLine()).toBe("Not saved — The shelf is unavailable.");
    expect(host.querySelector(".prof-save [role=alert]"), "the refusal is no longer an alert").toBeTruthy();
    type("the evidence, again");
    expect(statusLine()).toBe("Not saved yet — Save and open stores it.");
    expect(host.textContent).not.toContain("The shelf is unavailable.");
  });
});

describe.each(PRODUCERS)("the ask-purpose mark (261001s § Stage 3) when $name", (producer) => {
  it("is written when the page opens the article by itself, untouched", async () => {
    await producer.start();
    await producer.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBe(SLUG);
  });

  it("is not written after a focus and a blur over an empty box", async () => {
    await producer.start();
    focus();
    blur();
    await producer.finish();
    expect(navigations, "the auto-open rule changed").toEqual([`/read/${SLUG}`]);
    expect(mark(), "a reader who looked at the box is asked again").toBeNull();
  });

  it("is not written for a box typed in and emptied", async () => {
    await producer.start();
    type("x");
    type("");
    await producer.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBeNull();
  });

  it("is not written on Open without it", async () => {
    await producer.start();
    /* Keep the draft empty: the action, not the presence of words, is what says
       the reader saw the question and declined it. Keeping focus through the
       completion is how an empty draft reaches the decision buttons. */
    focus();
    await producer.finish();
    press("Open without it");
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBeNull();
  });

  it("is not written on Save and open", async () => {
    await producer.start();
    /* An empty Save and open sends no PATCH, but it is still an explicit choice
       and must not be mistaken for the silent auto-open path. */
    focus();
    await producer.finish();
    press("Save and open");
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBeNull();
  });
});

/**
 * **High-powered AI chosen at import** — plan 261002k. The box sends the
 * Metadata switch's own PUT; what is pinned here is the page's half: nothing is
 * sent unless ticked, and **no mode is queued before the switch has answered**
 * (GPT Sol's plan review P1-3), over all three ways an add finishes — one of
 * which never had a job, so the intent is sent against the completion's slug.
 */
describe.each(PRODUCERS)("High-powered AI at import, when $name", (producer) => {
  const powerBox = (): HTMLInputElement => {
    const el = host.querySelector<HTMLInputElement>("[data-add-high-power] input[type=checkbox]");
    if (!el) throw new Error("no High-powered AI box on the page");
    return el;
  };

  it("is offered, off, and sends nothing when left alone", async () => {
    await producer.start();
    expect(powerBox().checked).toBe(false);
    await producer.finish();
    expect(puts()).toEqual([]);
    expect(runs()).toEqual(EXPECTED_RUNS());
  });

  it("ticked, it switches the article on before any mode is queued", async () => {
    let answer: () => void = () => {};
    putAnswer = () =>
      new Promise((resolve) => {
        answer = () =>
          resolve(new Response(JSON.stringify({ highPowerSince: "2026-10-02T23:00:00.000Z" }), { status: 200 }));
      });
    await producer.start();
    act(() => powerBox().click());
    expect(powerBox().checked).toBe(true);
    await producer.finish();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
    expect(navigations, "the navigation waited for the switch").toEqual([`/read/${SLUG}`]);
    expect(runs(), "a mode was queued before High-powered AI answered").toEqual([]);
    answer();
    await settle();
    expect(runs()).toEqual(EXPECTED_RUNS());
    expect(events.indexOf(`put:${SLUG}:true`)).toBe(0);
  });

  it("a refusal still queues the modes, on the standard model", async () => {
    putAnswer = async () =>
      new Response(JSON.stringify({ error: "[pay-high-power] Not enough of your allowance left." }), {
        status: 402,
      });
    await producer.start();
    act(() => powerBox().click());
    await producer.finish();
    await settle();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
    expect(runs()).toEqual(EXPECTED_RUNS());
  });
});

describe("High-powered AI add-page wiring", () => {
  const powerBox = (): HTMLInputElement => {
    const el = host.querySelector<HTMLInputElement>("[data-add-high-power] input[type=checkbox]");
    if (!el) throw new Error("no High-powered AI box on the page");
    return el;
  };

  it("uses the job's allocated slug, not one derived from the address", async () => {
    addResult = makeJob("job-allocated", "running", "allocated-title-2");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();
    expect(puts()).toEqual(["put:allocated-title-2:true"]);
  });

  it("under StrictMode sends one switch request", async () => {
    strict = true;
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
  });

  it("starts a new address with a fresh intent and sends only to that address's job slug", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();

    const other = { kind: "url", url: "https://example.com/another-paper" } as const;
    addResult = makeJob("job-2", "running", "allocated-other-paper");
    jobs = [makeJob("job-1", "running"), addResult];
    render(other);
    await settle();
    expect(powerBox().checked, "the first address's choice leaked into the second").toBe(false);
    act(() => powerBox().click());
    await settle();

    expect(puts()).toEqual([`put:${SLUG}:true`, "put:allocated-other-paper:true"]);
  });

  it("keeps the box on and says switch-off failed when the server refuses it", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();

    putAnswer = async () =>
      new Response(JSON.stringify({ error: "The article could not be changed." }), { status: 503 });
    act(() => powerBox().click());
    await settle();

    expect(powerBox().checked, "a refused switch-off was drawn as off").toBe(true);
    expect(host.textContent).toContain("Not switched off — The article could not be changed.");
  });
});
