// @vitest-environment jsdom
/**
 * **The command bar re-runs a mode, and searches the article** — stage A of
 * docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md, drawn
 * out of the real `Dock` as tests/command-bar.test.tsx draws it, and for that
 * file's reason: what goes wrong here is the wiring between the bar, the job
 * queue and the address.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-8D):
 *
 * > Add a lot more Metadata functionality to Commands, e.g. to reprocess (a
 * > particular mode) with more powerful AI.
 *
 * > "do they talk about X?" would add a search
 *
 * Four things here are about money, or about a press that silently did
 * nothing, rather than about React:
 *
 *  - **One Enter posts exactly the forced run Metadata's row posts**,
 *    `{ slug, steps: [step], force: [step] }`, and **once**, however soon the
 *    second Enter comes (GPT Sol's F2).
 *  - **It never opens the mode.** A mode opened with no artefact starts an
 *    unforced run of its own, which the server does not join to the forced
 *    one — two paid runs (F1). So the reader lands in Metadata's AI processing
 *    section, and the one POST below is the whole of the network traffic.
 *  - **A refusal keeps the bar open with the server's sentence**, read at once
 *    rather than from `useJobs.error`, which the next poll clears (F2).
 *  - **`find <words>` opens Search in words mode** — free, and only when the
 *    verb was typed, so *No command matches.* is still the answer to a query
 *    that names nothing.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, StepName } from "../src/types.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

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

const { Dock } = await import("../src/web/Dock.js");
const { NO_MATCH } = await import("../src/web/CommandBar.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { resetActivations, pendingActivation } = await import("../src/web/activation.js");

const SLUG = "a-piece";

/** Every `POST /api/jobs` body, in order. */
let posts: { slug?: string; steps?: StepName[]; force?: StepName[] }[];
/** Every request at all, so "nothing but the one POST" can be said. */
let requests: string[];
let holdPost: boolean;
let releasePost: (() => void) | undefined;
/** The POST's answer — a job, or a refusal a test swaps in. */
let postAnswer: () => Response;

let host: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function madeJob(step: StepName): Job {
  return {
    id: `job-${posts.length}`,
    ownerId: "owner" as Job["ownerId"],
    slug: SLUG,
    steps: [{ name: step, label: `Doing ${step}`, status: "pending" }],
    status: "queued",
    createdAt: "2026-10-02T00:00:00.000Z",
  };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?at=spya-k3m9qt`);
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  posts = [];
  requests = [];
  holdPost = false;
  releasePost = undefined;
  postAnswer = () => json(madeJob(posts.at(-1)?.steps?.at(-1) ?? "arc"));
  jobEngine.reset();
  resetActivations();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "POST") {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      const answer = postAnswer();
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
});

function reading(onMode: (m: string) => void = () => {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view: "article",
        mode: "plain",
        onMode,
        experimental: EXPERIMENTAL_OFF,
      }),
    );
  });
}

function metadataPage(): void {
  history.replaceState(null, "", `/read/${SLUG}/metadata?at=spya-k3m9qt`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the metadata page's Dock has no onMode, on purpose
      createElement(Dock as any, { slug: SLUG, view: "metadata", experimental: EXPERIMENTAL_OFF }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const listed = (): string[] => rows().map((r) => r.querySelector(".cmdbar-name")?.textContent ?? "");
const status = (): HTMLElement | null => dialog().querySelector('[role="status"]');

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** Let every pending microtask and zero-delay timer run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

describe("a Run again row", () => {
  it("is not in the list the bar opens on", () => {
    reading();
    openBar();
    expect(listed().some((name) => name.includes("Run again"))).toBe(false);
  });

  it("is found by `rerun glossary`, and says it generates", () => {
    reading();
    openBar();
    type("rerun glossary");
    expect(listed()[0]).toBe("Glossary › Run again");
    expect(rows()[0]?.querySelector(".cmdbar-generates")).not.toBeNull();
  });

  it("leaves plain `glossary` to the mode", () => {
    reading();
    openBar();
    type("glossary");
    expect(listed()[0]).toBe("Glossary");
    expect(rows()[0]?.dataset.kind).toBe("mode");
  });

  it("is offered for a mode the experimental switch hides", () => {
    /* FAQ is behind the switch, and the switch is off here; Metadata's row is
       offered whatever it says, and so is this one (F7). */
    reading();
    openBar();
    type("rerun faq");
    expect(listed()[0]).toBe("FAQ › Run again");
  });

  it("posts the forced run once, and nothing else, then lands in Metadata's AI processing", async () => {
    const onMode = vi.fn();
    reading(onMode);
    openBar();
    type("rerun glossary");
    press("Enter");
    await settle();
    expect(posts).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"] }]);
    /* Not the mode: opening it would start an unforced run beside this one. */
    expect(onMode).not.toHaveBeenCalled();
    expect(pendingActivation(SLUG, "glossary"), "a glossary run was armed for the band").toBeNull();
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    /* The reader's place carried, as the Metadata row carries it, and the
       section named. */
    expect(location.search).toBe("?at=spya-k3m9qt&section=ai-processing");
    expect(dialog().open).toBe(false);
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual(["POST /api/jobs"]);
  });

  it("posts once however soon the second Enter comes, and says it is working meanwhile", async () => {
    holdPost = true;
    reading();
    openBar();
    type("rerun glossary");
    press("Enter");
    press("Enter");
    act(() => rows()[0]?.click());
    await settle();
    expect(posts).toHaveLength(1);
    expect(dialog().open, "the bar shut before the post was answered").toBe(true);
    expect(status()?.textContent).not.toBe("");
    await act(async () => releasePost?.());
    await settle();
    expect(posts).toHaveLength(1);
    expect(dialog().open).toBe(false);
  });

  it("stays open with the server's sentence when the run is refused", async () => {
    postAnswer = () => json({ error: "That article is still being read." }, 409);
    reading();
    openBar();
    type("rerun glossary");
    press("Enter");
    await settle();
    expect(posts).toHaveLength(1);
    expect(dialog().open).toBe(true);
    expect(status()?.textContent).toContain("That article is still being read.");
    expect(location.pathname).toBe(`/read/${SLUG}`);
    /* And the sentence goes when the reader types again. */
    type("rerun quotes");
    expect(status()?.textContent ?? "").toBe("");
  });

  it("on the Metadata page, adds the section to this address in place rather than going anywhere", async () => {
    metadataPage();
    const depth = history.length;
    openBar();
    type("rerun quotes");
    press("Enter");
    await settle();
    expect(posts).toEqual([{ slug: SLUG, steps: ["quotes"], force: ["quotes"] }]);
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toBe("?at=spya-k3m9qt&section=ai-processing");
    /* `replace`: the page did not change, so Back has nothing new to retrace. */
    expect(history.length).toBe(depth);
    expect(dialog().open).toBe(false);
  });
});

describe("find <words>", () => {
  it("offers a search of this article for the words after the verb", () => {
    reading();
    openBar();
    type("do they talk about wet hardware?");
    expect(listed()).toEqual(["Find “wet hardware” in this article"]);
    expect(rows()[0]?.querySelector(".cmdbar-generates")).toBeNull();
  });

  it("opens Search in words mode on Enter, keeping the reader's place", () => {
    reading();
    openBar();
    type("find wet hardware");
    press("Enter");
    expect(location.pathname).toBe(`/read/${SLUG}`);
    const params = new URLSearchParams(location.search);
    expect(params.get("mode")).toBe("search");
    expect(params.get("match")).toBe("words");
    expect(params.get("find")).toBe("wet hardware");
    expect(params.get("at")).toBe("spya-k3m9qt");
    expect(dialog().open).toBe(false);
    expect(requests).toEqual([]);
  });

  it("goes back to the reading view from the Metadata page", () => {
    metadataPage();
    openBar();
    type("search for priors");
    press("Enter");
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(new URLSearchParams(location.search).get("find")).toBe("priors");
  });

  it("is not offered without the verb, so a query naming nothing still matches nothing", () => {
    reading();
    openBar();
    type("wet hardware");
    expect(rows()).toEqual([]);
    expect(dialog().querySelector(".cmdbar-empty")?.textContent).toBe(NO_MATCH);
    type("find");
    expect(listed().some((n) => n.startsWith("Find “"))).toBe(false);
  });
});
