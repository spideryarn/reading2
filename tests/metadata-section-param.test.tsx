// @vitest-environment jsdom
/**
 * **`?section=` on the Metadata page** — open, scroll to and flash the section
 * it names, then take it off the address. Stage A of
 * docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md, where
 * the command bar's *Run again* lands the reader in *AI processing*.
 *
 * Driven through the real page, with the real `Dock` and its real command bar
 * in it, for the reason tests/metadata-contents-reveal.test.tsx gives: an event
 * sent to an element nobody listens on looks exactly like success from the
 * sending side.
 *
 * GPT Sol's F4 is the part a happy path cannot see: **the address is consumed
 * only once the reveal has found its section**, and the reveal is tried again
 * while a section may still be mounting — a parameter taken off before the
 * section existed would be a press that did nothing. The last describe holds
 * that against a section that arrives late, and one that never does.
 */
import { act, createElement, type RefObject, useEffect, useRef, useState } from "react";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
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

vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({
    on: false,
    since: null,
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

/* The bar's `navigate` writes with `history.replaceState`; this is what lets
   the page's `useQueryState` hear it, exactly as main.tsx arranges. */
enableHistorySync();

const { Metadata } = await import("../src/web/Metadata.js");
const { Section } = await import("../src/web/PageSection.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { METADATA_SECTIONS } = await import("../src/web/params.js");
const { useRevealOnArrival } = await import("../src/web/PageContents.js");

const OLD_SECTION_ARRIVAL_GIVE_UP_MS = 15_000;

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

let posts: unknown[];
/** Every archive PATCH body, and the answer the next one gets. */
let patches: unknown[];
let patchAnswer: () => Response;
let host: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stages(): StageState[] {
  return STEP_ORDER.map((step) => ({
    step,
    label: `Doing ${step}`,
    outputs: [`data/${SLUG}/${step}.json`],
    done: (METADATA_RERUN_STEPS as readonly StepName[]).includes(step),
    ranAt: null,
    startedAt: null,
    bytes: null,
  }));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  patches = [];
  patchAnswer = () => json({ entry: { slug: SLUG, archivedAt: "2026-10-02T00:00:00.000Z" } });
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/metadata/")) {
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
    if (url === "/api/jobs" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { steps: StepName[] };
      posts.push(body);
      const job: Job = {
        id: `job-${posts.length}`,
        ownerId: "owner" as Job["ownerId"],
        slug: SLUG,
        steps: [{ name: body.steps[0] ?? "arc", label: "Doing it", status: "pending" }],
        status: "queued",
        createdAt: "2026-10-02T00:00:00.000Z",
      };
      return Promise.resolve(json(job));
    }
    if (url === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
    if (url === `/api/library/${SLUG}` && method === "PATCH") {
      patches.push(JSON.parse(String(init?.body ?? "{}")));
      return Promise.resolve(patchAnswer());
    }
    return Promise.resolve(json({}));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function open(search: string): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}/metadata${search}`);
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

const section = (label: string) => host.querySelector<HTMLElement>(`main [data-section="${label}"]`);
const expanded = (label: string) =>
  section(label)?.querySelector("h2 button")?.getAttribute("aria-expanded");

describe("arriving with ?section=", () => {
  it("opens AI processing, puts focus on its heading, and takes the parameter off in place", async () => {
    history.replaceState(null, "", "/elsewhere");
    const depth = history.length;
    await open("?at=spya-aaaaaa&section=ai-processing");
    expect(expanded("AI processing")).toBe("true");
    expect(document.activeElement).toBe(section("AI processing")?.querySelector("h2"));
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toBe("?at=spya-aaaaaa");
    expect(history.length, "the parameter came off with a push, not a replace").toBe(depth);
    expect(posts, "opening a section from a link started work").toEqual([]);
  });

  it("names, in every value it accepts, a section this page really has", async () => {
    await open("");
    for (const value of METADATA_SECTIONS) {
      expect(host.querySelector(`main #sec-${value}[data-section]`), value).not.toBeNull();
    }
  });

  it("does nothing with a value it does not know, and leaves it where it is", async () => {
    await open("?section=what-it-cost");
    expect(expanded("AI processing")).toBe("false");
    expect(location.search).toBe("?section=what-it-cost");
  });

  it("is where the command bar's Run again lands on this page: one run, the section opened, the address clean", async () => {
    await open("?at=spya-aaaaaa");
    expect(expanded("AI processing")).toBe("false");
    act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
    const input = host.querySelector<HTMLInputElement>("dialog.cmdbar input.cmdbar-input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "rerun quotes");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(posts).toEqual([{ slug: SLUG, steps: ["quotes"], force: ["quotes"] }]);
    expect(expanded("AI processing")).toBe("true");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toBe("?at=spya-aaaaaa");
  });

  it("replaces an encoded section key before revealing the accepted run", async () => {
    await open("?at=spya-aaaaaa&%73ection=what-it-cost");
    act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
    const input = host.querySelector<HTMLInputElement>("dialog.cmdbar input.cmdbar-input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "rerun quotes");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(posts).toEqual([{ slug: SLUG, steps: ["quotes"], force: ["quotes"] }]);
    expect(expanded("AI processing")).toBe("true");
    expect(new URLSearchParams(location.search).getAll("section")).toEqual([]);
  });
});

/**
 * **The bar's other Metadata rows, on the page itself** — stage B of plan
 * 261002c: a section row reveals its section in place, as *Run again* does,
 * and Archive goes through the page's own controller, so the bar and the
 * buttons on the page cannot disagree about which way round the article is.
 */
describe("the command bar's Metadata rows, on this page", () => {
  function command(query: string): void {
    act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
    const input = host.querySelector<HTMLInputElement>("dialog.cmdbar input.cmdbar-input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, query);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
  }
  const status = () => host.querySelector("dialog.cmdbar [role='status']")?.textContent ?? "";

  it("reveals Access & sharing in place for `publish`, and leaves the address clean", async () => {
    await open("?at=spya-aaaaaa");
    command("publish");
    await settle();
    /* By id: jsdom's selector engine misreads `&` inside an attribute value. */
    const heading = host.querySelector("main #sec-access-sharing h2");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toBe("?at=spya-aaaaaa");
    expect(posts).toEqual([]);
  });

  it("archives through the page's controller, and the page's own button follows", async () => {
    await open("");
    command("archive");
    await settle();
    expect(patches).toEqual([{ archived: true }]);
    expect(host.querySelector<HTMLDialogElement>("dialog.cmdbar")?.open).toBe(false);
    expect(host.querySelector('[data-top-action="archive"]')?.textContent).toContain("Put back");
  });

  it("stays open with a sentence when the archive could not be confirmed", async () => {
    patchAnswer = () => json({ error: "The shelf is busy." }, 500);
    await open("");
    command("archive");
    await settle();
    expect(patches).toHaveLength(1);
    expect(status()).toContain("The shelf is busy.");
  });
});

/**
 * **The hook on its own**, against a section that is not there yet — the case
 * the page itself cannot easily stage, because *AI processing* mounts with the
 * page. A section that arrives with a request (Stage B's *Access & sharing*
 * waits for the shelf row) is the one this protects.
 */
function Harness({
  id,
  showAfter,
  onRevealed,
}: {
  id: string | null;
  showAfter: number | null;
  onRevealed: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  if (showAfter !== null && !shown) setTimeout(() => setShown(true), showAfter);
  useRevealOnArrival(ref as RefObject<HTMLElement | null>, id, onRevealed);
  return createElement(
    "main",
    { ref },
    shown ? createElement("section", { id: "sec-late", "data-section": "Late" }, createElement("h2", { tabIndex: -1 }, "Late")) : null,
  );
}

function CollapsibleHarness({ onRevealed }: { onRevealed: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 0);
    return () => clearTimeout(timer);
  }, []);
  useRevealOnArrival(ref as RefObject<HTMLElement | null>, "sec-late", onRevealed);
  return createElement(
    "main",
    { ref },
    shown
      ? <Section label="Late" keywords="late" collapsible>
          <p>Revealed</p>
        </Section>
      : null,
  );
}

describe("useRevealOnArrival", () => {
  it("waits for a section that mounts late, and reports only once it has revealed it", async () => {
    vi.useFakeTimers();
    const onRevealed = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { id: "sec-late", showAfter: 2000, onRevealed }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRevealed, "reported before the section existed").not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(onRevealed).toHaveBeenCalledOnce();
    expect(document.activeElement?.textContent).toBe("Late");
  });

  it("does not consume a late section before its reveal listener can open it", async () => {
    const onRevealed = vi.fn();
    await act(async () => {
      root.render(createElement(CollapsibleHarness, { onRevealed }));
    });
    /* Deliberately outside `act`: a browser delivers the MutationObserver
       between React's commit and passive effects. Wrapping the timer in act
       flushes passive effects first and hides the race this test exists for. */
    await new Promise((go) => setTimeout(go, 50));
    expect(host.querySelector("#sec-late p")?.textContent).toBe("Revealed");
    expect(onRevealed).toHaveBeenCalledOnce();
  });

  it("keeps waiting past the old bound for a validated section that mounts slowly", async () => {
    vi.useFakeTimers();
    const onRevealed = vi.fn();
    await act(async () => {
      root.render(
        createElement(Harness, {
          id: "sec-late",
          showAfter: OLD_SECTION_ARRIVAL_GIVE_UP_MS + 1000,
          onRevealed,
        }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OLD_SECTION_ARRIVAL_GIVE_UP_MS + 2000);
    });
    expect(onRevealed).toHaveBeenCalledOnce();
  });

  it("does nothing at all without an id", async () => {
    vi.useFakeTimers();
    const onRevealed = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { id: null, showAfter: 0, onRevealed }));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onRevealed).not.toHaveBeenCalled();
  });
});
