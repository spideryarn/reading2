// @vitest-environment jsdom
/**
 * **Skim says what it was planned for, and asks when nobody has said** —
 * the purpose line in src/web/SkimPanel.tsx (`PurposeLine`).
 *
 * The owner sees *Reading for: …* with an Edit link to Metadata when the
 * article has a purpose; when it has none and a route is on screen, a box and
 * *Plan the route for this*, which saves the purpose and only then asks for the
 * route, once. Never in the empty state — `useAutoRun` plans one there, and a
 * second, differently profiled request would not de-duplicate (Sol F6). Never
 * for a visitor, and never when the purpose could not be read.
 *
 * docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md § Stage 2.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, Skim } from "../src/types.js";
import type { UseSkim } from "../src/web/useSkim.js";
import type { SkimView } from "../src/web/modes/skim/SkimMode.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom has no `CSS.escape`, which `useFollow` uses; skim-panel.test.tsx does the same. */
globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

/* ------------------------------------------------------------ the network -- */

/** What `GET /api/reader?slug=` answers, or `"fail"` for a 500. */
let readerBody: { purpose: string | null; purposeFailed?: boolean } | "fail" | "held" = { purpose: null };
/** A held PATCH, so a test can look between the press and the save's answer. */
let patchReply: Promise<Response> | null = null;
const requested: { url: string; method: string; body?: unknown }[] = [];
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    requested.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.startsWith("/api/reader")) {
      if (readerBody === "held") return new Promise<Response>(() => {});
      return readerBody === "fail"
        ? new Response(JSON.stringify({ error: "Could not read." }), { status: 500 })
        : new Response(JSON.stringify(readerBody), { status: 200 });
    }
    if (url.startsWith("/api/library/") && init?.method === "PATCH") {
      if (patchReply) return patchReply;
      const sent = JSON.parse(String(init.body)) as { purpose: string | null };
      return new Response(JSON.stringify({ purpose: sent.purpose?.trim() ?? null }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: apiFetch };
});

const { SkimPanel } = await import("../src/web/SkimPanel.js");

/* ------------------------------------------------------------- the harness -- */

const ROUTE: Skim = {
  version: "test",
  generator: "test",
  slug: "a-route",
  sourceHash: "hash",
  profileHash: null,
  stops: [{ quoteId: "spya-tq2abc", depth: 1, role: null, cue: "Look for the headline." }],
  visible: [1, 1, 1],
  offered: 1,
  dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
  generatedAt: "2026-09-30T09:00:00.000Z",
  elapsedMs: 1,
};

let ensured = 0;
function owner(over: Partial<UseSkim> = {}): UseSkim {
  return {
    status: "ready",
    skim: ROUTE,
    stale: false,
    outdated: false,
    profileChanged: false,
    notOnRoute: 0,
    slug: "a-route",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    quotesFirst: false,
    ideasFirst: false,
    retryRead: async () => {},
    ensure: async () => {
      ensured += 1;
    },
    regenerate: async () => {},
    cancel: () => {},
    ...over,
  };
}

const VIEW: SkimView = {
  depth: 1,
  depths: [{ depth: 1, label: "Gist", count: 1 }],
  rows: [
    {
      quoteId: "spya-tq2abc",
      n: 1,
      place: [{ title: "Results", voice: "ai" }],
      cue: "Look for the headline.",
      current: true,
      missing: false,
      position: null,
      words: null,
      where: [],
    },
  ],
  position: 1,
  card: null,
  onDepth: () => {},
  onRow: () => {},
  onStep: () => {},
  onOpen: () => {},
  canOpen: () => true,
};

const RUNNING: Job = {
  id: "job-skim",
  ownerId: "owner" as Job["ownerId"],
  slug: "a-route",
  status: "running",
  createdAt: "2026-09-30T00:00:00.000Z",
  startedAt: "2026-09-30T00:00:01.000Z",
  steps: [{ name: "skim", label: "Planning the route", status: "running", startedAt: "2026-09-30T00:00:01.000Z" }],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  readerBody = { purpose: null };
  patchReply = null;
  requested.length = 0;
  ensured = 0;
  history.replaceState(null, "", "/read/a-route?mode=skim");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function drawOwner(o: UseSkim) {
  await act(async () =>
    root.render(createElement(SkimPanel, { access: { kind: "owner", owner: o }, view: VIEW, away: false })),
  );
  /* The purpose read answers on a later tick. */
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const line = () => host.querySelector(".skim-purpose");
const box = () => host.querySelector<HTMLTextAreaElement>(".skim-purpose textarea");
const planButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".skim-purpose button")].find((b) =>
    /Plan the route for this/.test(b.textContent ?? ""),
  ) ?? null;

async function type(value: string) {
  const el = box()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

const patches = () => requested.filter((r) => r.method === "PATCH");

/* ================================================================= tests == */

describe("the purpose line in Skim", () => {
  it("says what the route was planned for, whole in a tooltip, with an Edit link to Metadata", async () => {
    readerBody = { purpose: "How they handled missing data in the second cohort" };
    await drawOwner(owner());
    expect(line()?.textContent).toContain("Reading for:");
    expect(line()?.textContent).toContain("How they handled missing data in the second cohort");
    const edit = [...line()!.querySelectorAll("a")].find((a) => a.textContent === "Edit");
    /* The view state travels, as the dock's and the masthead's Metadata links carry it. */
    expect(edit?.getAttribute("href")).toBe("/read/a-route/metadata?mode=skim");
    /* The whole sentence is in a tooltip, on a trigger a keyboard reaches. */
    expect(line()!.querySelector(".skim-purpose-said")?.getAttribute("tabindex")).toBe("0");
    expect(box()).toBeNull();
  });

  it("asks when there is no purpose and a route is on screen", async () => {
    await drawOwner(owner());
    expect(box()).not.toBeNull();
    expect(box()!.maxLength).toBe(600);
    expect(line()?.textContent).toContain("What do you want from this piece?");
    expect(planButton()).not.toBeNull();
    expect(line()?.textContent).toMatch(/paid/i);
  });

  it("does not ask in the empty state, where the automatic run plans a route (Sol F6)", async () => {
    await drawOwner(owner({ status: "none", skim: null }));
    expect(line()).toBeNull();
  });

  it("draws nothing while the purpose is being read", async () => {
    readerBody = "held";
    await drawOwner(owner());
    expect(requested.some((r) => r.url === "/api/reader?slug=a-route")).toBe(true);
    expect(line()).toBeNull();
  });

  it("saves first, and asks for the route only once the save has answered — exactly once", async () => {
    let answer!: (r: Response) => void;
    patchReply = new Promise((r) => {
      answer = r;
    });
    await drawOwner(owner());
    await type("  how they handled missing data  ");
    await press(planButton()!);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.body).toEqual({ purpose: "how they handled missing data" });
    expect(ensured).toBe(0);
    expect(planButton()!.disabled).toBe(true);
    await act(async () => {
      answer(new Response(JSON.stringify({ purpose: "how they handled missing data" }), { status: 200 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ensured).toBe(1);
    expect(line()?.textContent).toContain("Reading for:");
    expect(line()?.textContent).toContain("how they handled missing data");
  });

  it("submits only once when the plan button is pressed twice before re-render", async () => {
    let answer!: (r: Response) => void;
    patchReply = new Promise((resolve) => {
      answer = resolve;
    });
    await drawOwner(owner());
    await type("the method");
    const button = planButton()!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(patches()).toHaveLength(1);
    expect(ensured).toBe(0);
    await act(async () => {
      answer(new Response(JSON.stringify({ purpose: "the method" }), { status: 200 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ensured).toBe(1);
  });

  it("does not show one article's saved purpose on the next article", async () => {
    await drawOwner(owner());
    await type("the first article's method");
    await press(planButton()!);
    expect(line()?.textContent).toContain("the first article's method");

    readerBody = { purpose: null };
    await drawOwner(owner({ slug: "another-route" }));
    expect(line()?.textContent).not.toContain("the first article's method");
    expect(box()).not.toBeNull();
  });

  it("keeps the draft and asks for nothing when the save fails", async () => {
    patchReply = Promise.resolve(new Response(JSON.stringify({ error: "The shelf is down." }), { status: 500 }));
    await drawOwner(owner());
    await type("the method");
    await press(planButton()!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ensured).toBe(0);
    expect(line()?.textContent).toContain("Not saved —");
    expect(box()?.value).toBe("the method");
  });

  it("cannot submit an empty or blank draft", async () => {
    await drawOwner(owner());
    expect(planButton()!.disabled).toBe(true);
    await type("   ");
    expect(planButton()!.disabled).toBe(true);
    await press(planButton()!);
    expect(patches()).toHaveLength(0);
    expect(ensured).toBe(0);
  });

  it("is disabled while a Skim job is starting or running", async () => {
    await drawOwner(owner({ job: RUNNING }));
    await type("the method");
    expect(planButton()!.disabled).toBe(true);
    await drawOwner(owner({ starting: true }));
    expect(planButton()!.disabled).toBe(true);
    await drawOwner(owner());
    expect(planButton()!.disabled).toBe(false);
  });

  it("does not ask a second time under the stale or profile-changed banner, but still says a set purpose", async () => {
    await drawOwner(owner({ profileChanged: true }));
    expect(box()).toBeNull();
    readerBody = { purpose: "the method" };
    await act(async () => root.unmount());
    root = createRoot(host);
    await drawOwner(owner({ stale: true }));
    expect(line()?.textContent).toContain("Reading for:");
  });

  it("draws nothing, and reads nothing, for a visitor", async () => {
    await act(async () =>
      root.render(
        createElement(SkimPanel, {
          access: { kind: "visitor", route: { stops: ROUTE.stops, offered: 1 } },
          view: VIEW,
          away: false,
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(line()).toBeNull();
    expect(requested.filter((r) => r.url.startsWith("/api/reader"))).toEqual([]);
  });

  it("draws nothing when the server says the purpose could not be read", async () => {
    readerBody = { purpose: null, purposeFailed: true };
    await drawOwner(owner());
    expect(line()).toBeNull();
  });

  it("draws nothing when the purpose read itself fails", async () => {
    readerBody = "fail";
    await drawOwner(owner());
    expect(line()).toBeNull();
  });
});
