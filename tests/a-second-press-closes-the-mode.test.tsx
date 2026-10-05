// @vitest-environment jsdom
/**
 * **Plain closes both columns, and a second press on a band closes it** —
 * through the whole page, since the rule (`modePress`,
 * src/web/reader/mode-press.ts) is only as good as `Reader` acting on it and
 * the Dock not arming a paid token for a press that closes. Also the three
 * frames the bar is drawn as. Greg, SPIDERYARN-READING2-96 and spya-ba8kqp.
 * docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md.
 *
 * The harness is tests/mode-herald-wiring.test.tsx's, cut to what this needs.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicArticle } from "../src/public-types.js";
import { MODE_LABEL } from "../src/title-text.js";
import type { Article } from "../src/types.js";

/** Who `useSession` says is here. Hoisted, because `vi.mock` is. */
const who = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

vi.mock("../src/web/useSession.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSession: () => ({
      session: null,
      user: useSyncExternalStore(who.subscribe, who.get, who.get),
      loading: false,
    }),
  };
});

const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

const SLUG = "a-second-press-piece";
const PARAGRAPH = "The paragraph a herald never covers.";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-aaaaaa",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 6,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
];

const TREE: PublicArticle["tree"] = {
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1"],
      range: ["spya-aaaaaa", "spya-bbbbbb"],
      title: "A piece",
      gist: "What the piece says.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-bbbbbb", "spya-bbbbbb"],
      title: "The argument it makes",
      gist: "Where the piece gets to.",
    },
  },
};

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
};

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/** The experimental switch, off unless a case turns it on. */
let experimentalSince: string | null = null;
let relationsState: "current" | "missing" | "outdated" = "current";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince });
  if (url === `/api/relations/${SLUG}`) {
    if (relationsState === "missing") return new Response(null, { status: 404 });
    return json({
      relations: { relations: {} },
      stale: false,
      outdated: relationsState === "outdated",
    });
  }
  if (method === "POST") {
    posts.push(url);
    return new Response(null, { status: 204 });
  }
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

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
  who.set({ id: "second-press-owner", email: "owner@example.com" });
  experimentalSince = null;
  relationsState = "current";
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init?.method ?? "GET")),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The whole app, exactly as `main.tsx` mounts it. */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(AppBoundary, null, createElement(App, null))),
      ),
    );
  });
  await act(async () => {
    const user = who.get();
    for (const fn of [...authListeners]) fn(user === null ? "SIGNED_OUT" : "SIGNED_IN", user && { user });
  });
  await settle();
}

const modeInUrl = (): string => new URLSearchParams(location.search).get("mode") ?? "plain";

async function press(label: string): Promise<void> {
  const before = modeInUrl();
  const button = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  expect(button, `the bar must draw ${label}`).toBeDefined();
  await act(async () => button?.click());
  // `?mode=` is written behind nuqs' throttle, so one read is a race.
  for (let i = 0; i < 40 && modeInUrl() === before; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  await settle();
}


/** Every POST the page makes — a job started is one. */
const posts: string[] = [];

/** Every `armActivationForMode` call the Dock makes, by mode. */
const armed = vi.hoisted(() => [] as string[]);
vi.mock("../src/web/activation.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/activation.js")>();
  return {
    ...real,
    armActivationForMode: (...args: Parameters<typeof real.armActivationForMode>) => {
      armed.push(args[1]);
      return real.armActivationForMode(...args);
    },
  };
});

async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !ok(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(ok(), "the history step never arrived").toBe(true);
  await settle();
}

const marginInUrl = (): boolean => new URLSearchParams(location.search).get("margin") === "1";
const band = (label: string): Element | null => host.querySelector(`.mode-band[aria-label="${label}"]`);

async function pressMarginalia(): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(
    `.dock-modes button[aria-label="${MODE_LABEL.marginalia}"]`,
  );
  expect(button, "the bar must draw Marginalia").not.toBeNull();
  await act(async () => button?.click());
  await settle();
}

async function command(label: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(".dock-commands");
  expect(button, "the bar must draw Commands").not.toBeNull();
  await act(async () => button?.click());
  const input = host.querySelector<HTMLInputElement>("dialog.cmdbar input.cmdbar-input");
  expect(input, "the command bar must open").not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, label);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

describe("a second press on the band you are in closes it", () => {
  it("Summary pressed while Summary is open goes to Plain, and Back reopens it", async () => {
    await open("?mode=summary");
    expect(band("Summary"), "the band opened").not.toBeNull();
    await press(MODE_LABEL.summary);
    expect(modeInUrl()).toBe("plain");
    expect(new URLSearchParams(location.search).has("mode"), "Plain is the absent default").toBe(
      false,
    );
    expect(band("Summary"), "the band closed").toBeNull();
    await act(async () => history.back());
    await until(() => modeInUrl() === "summary");
    expect(band("Summary"), "Back reopens it").not.toBeNull();
  });

  it("the command bar names a destination instead of toggling it", async () => {
    await open("?mode=summary&margin=1");
    armed.length = 0;
    posts.length = 0;
    const pushed = vi.spyOn(history, "pushState");
    await command(MODE_LABEL.summary);
    expect(modeInUrl()).toBe("summary");
    expect(band("Summary"), "choosing the open band must leave it open").not.toBeNull();
    expect(
      pushed,
      "choosing the current band added an empty history step",
    ).not.toHaveBeenCalled();

    armed.length = 0;
    posts.length = 0;
    await command(MODE_LABEL.marginalia);
    expect(marginInUrl(), "choosing the open Marginalia column must leave it open").toBe(true);
    expect(
      pushed,
      "choosing the open Marginalia column added an empty history step",
    ).not.toHaveBeenCalled();
    expect(armed, "choosing an already-open destination armed paid work").toEqual([]);
    expect(posts, "choosing an already-open destination started paid work").toEqual([]);
  });

  it("closing the band leaves the notes on", async () => {
    await open("?mode=summary&margin=1");
    await press(MODE_LABEL.summary);
    expect(modeInUrl()).toBe("plain");
    expect(marginInUrl(), "only that mode is deactivated").toBe(true);
  });

  it("arms no paid token for a press that closes", async () => {
    await open("?mode=summary");
    armed.length = 0;
    posts.length = 0;
    await press(MODE_LABEL.summary);
    expect(armed).toEqual([]);
    /* Not only no token: no job either (every-mode-draws-its-surface.test.tsx
       says why a token alone is not evidence). */
    expect(posts).toEqual([]);
  });

  it("a press on another band still opens it, and arms it", async () => {
    await open("?mode=summary");
    armed.length = 0;
    await press(MODE_LABEL.structure);
    expect(modeInUrl()).toBe("structure");
    expect(armed).toEqual(["structure"]);
  });
});

describe("Plain closes both columns", () => {
  it("from a band with the notes on, one press closes both, and one Back restores both", async () => {
    await open("?mode=summary&margin=1");
    await press(MODE_LABEL.plain);
    expect(modeInUrl()).toBe("plain");
    expect(new URLSearchParams(location.search).has("mode"), "Plain is the absent default").toBe(
      false,
    );
    expect(marginInUrl()).toBe(false);
    await act(async () => history.back());
    await until(() => modeInUrl() === "summary");
    expect(marginInUrl(), "the same Back step").toBe(true);
  });

  it("already in Plain with the notes on, it turns the notes off", async () => {
    await open("?margin=1");
    await press(MODE_LABEL.plain);
    await until(() => !marginInUrl());
    expect(modeInUrl()).toBe("plain");
  });

  it("already in Plain with no notes, it adds no empty history step", async () => {
    await open();
    const pushed = vi.spyOn(history, "pushState");
    await press(MODE_LABEL.plain);
    expect(pushed).not.toHaveBeenCalled();
  });

  it("Marginalia's own button still toggles only the notes", async () => {
    await open("?mode=summary&margin=1");
    await pressMarginalia();
    await until(() => !marginInUrl());
    expect(modeInUrl()).toBe("summary");
  });

  /* The column's relation words are asked for when it is shown (plan 261005d),
     so no press of the toggle arms anything, and the one that turns it off
     starts nothing either. */
  it("the press that turns the notes off arms nothing", async () => {
    await open("?mode=summary&margin=1");
    armed.length = 0;
    posts.length = 0;
    await pressMarginalia();
    await until(() => !marginInUrl());
    expect(armed).toEqual([]);
    expect(posts).toEqual([]);
    /* That the on-press does arm, and starts the one job, is
       every-mode-draws-its-surface.test.tsx § marginalia. */
  });

  it.each(["missing", "outdated"] as const)(
    "the press that turns the notes on starts one job for %s relations under StrictMode",
    async (state) => {
      relationsState = state;
      experimentalSince = "2026-10-03T00:00:00.000Z";
      await open("?mode=summary");
      armed.length = 0;
      posts.length = 0;

      await pressMarginalia();
      await until(() => marginInUrl());

      expect(armed).toEqual(["marginalia"]);
      expect(posts).toEqual(["/api/jobs"]);
    },
  );
});

describe("the bar is three frames: Plain, the bands, Marginalia", () => {
  it("draws Plain alone in the first frame and Marginalia alone in the last", async () => {
    await open("?margin=1");
    const frames = [...host.querySelectorAll(".dock-modes .dock-frame")];
    expect(frames).toHaveLength(3);
    const labels = (f: Element | undefined) =>
      [...(f?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label"));
    expect(labels(frames[0])).toEqual([MODE_LABEL.plain]);
    expect(labels(frames[2])).toEqual([MODE_LABEL.marginalia]);
    expect(labels(frames[1])).toContain(MODE_LABEL.summary);
    /* Plain and the bands are still one radiogroup: exactly one is on. */
    const group = host.querySelector('.dock-modes [role="radiogroup"]');
    expect(group?.contains(frames[0] ?? null)).toBe(true);
    expect(group?.contains(frames[1] ?? null)).toBe(true);
    expect(group?.contains(frames[2] ?? null)).toBe(false);
    /* A frame's edge separates Plain and Marginalia; no run line beside them. */
    expect(frames[1]?.querySelector("button")?.classList.contains("dock-group-start")).toBe(false);
    expect(frames[2]?.querySelector("button")?.classList.contains("dock-group-start")).toBe(false);
    expect(
      [...(frames[1]?.querySelectorAll("button.dock-group-start") ?? [])].map((button) =>
        button.getAttribute("aria-label"),
      ),
      "the lines between the surviving band runs moved or disappeared",
    ).toEqual([MODE_LABEL.skim, MODE_LABEL.search]);

    /* Coarse-pointer growth is weighted by the controls actually drawn, at
       both levels. A fixed outer weight was the plan review's P2-1. */
    const modes = host.querySelector<HTMLElement>(".dock-modes");
    expect(modes?.style.getPropertyValue("--dock-mode-count")).toBe(
      String(modes?.querySelectorAll("button").length),
    );
    for (const frame of frames) {
      expect((frame as HTMLElement).style.getPropertyValue("--dock-frame-count")).toBe(
        String(frame.querySelectorAll("button").length),
      );
    }
  });
});
