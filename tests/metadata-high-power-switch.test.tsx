// @vitest-environment jsdom
/**
 * **The *High-powered AI* switch on the Metadata page** — HighPowerSwitch.tsx,
 * stage 3 of docs/plans/260930f-high-powered-ai-per-article.md, opened to
 * readers by docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
 *
 * Mounted through `Metadata`, like tests/metadata-rerun-section.test.tsx and
 * for its reason: what goes wrong with a control like this is the wiring —
 * which slug reaches the URL, whose session decides what it says, and whether
 * the page's own read follows the write.
 *
 *  - **Drawn for a reader**, stating the price in articles and never in money,
 *    and **for the administrator**, saying there is no charge.
 *  - **A press sends `PUT /api/article/:slug/high-power` with `{ on: true }`**
 *    and shows the server's answer, `On since …`.
 *  - **A failed write leaves the box as it was** and says so — a 402 when the
 *    allowance has no room is the ordinary case of that. The checkbox is
 *    controlled by the last answer the server gave, not by the click, so a
 *    refusal cannot leave it reading "on" over an article that is not.
 */
import { act, createElement } from "react";
import { NuqsAdapter } from "nuqs/adapters/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { STEP_ORDER } from "../src/step-order.js";
import type { Article, StageState } from "../src/types.js";

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

/** Who `useSession` says is here. Re-posed by each test before it renders. */
const session: { user: { id: string } | null } = { user: null };
vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
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

const { Metadata } = await import("../src/web/Metadata.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "a-hard-piece";
const SINCE = "2026-09-30T09:15:00.000Z";

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: SLUG, title: "A hard piece" },
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
        title: "A hard piece",
      },
    },
  },
};

/** What the column holds, as the server would answer it. */
let serverSince: string | null;
/** Every PUT to the high-power route: its URL and parsed body. */
let puts: { url: string; body: unknown }[];
/** The next PUT's answer; a test that wants a failure replaces it. */
let putAnswer: (on: boolean) => Response | Promise<Response>;
let metadataReads: number;
/** While true, metadata reads wait here until released, oldest first. */
let holdMetadata: boolean;
let heldMetadata: (() => void)[];

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
    outputs: [],
    done: true,
    ranAt: "2026-09-01T00:00:00.000Z",
    startedAt: "2026-08-31T23:59:52.000Z",
    bytes: null,
  }));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = null;
  serverSince = null;
  puts = [];
  metadataReads = 0;
  holdMetadata = false;
  heldMetadata = [];
  putAnswer = (on) => {
    serverSince = on ? (serverSince ?? SINCE) : null;
    return json({ highPowerSince: serverSince });
  };
  jobEngine.reset();

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/metadata/")) {
      metadataReads++;
      const answer = json({
          slug: SLUG,
          dir: `data/${SLUG}`,
          stages: stages(),
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
          highPowerSince: serverSince,
        });
      if (!holdMetadata) return Promise.resolve(answer);
      return new Promise<Response>((go) => heldMetadata.push(() => go(answer)));
    }
    if (url.includes("/high-power")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { on: boolean };
      puts.push({ url: `${method} ${url}`, body });
      return Promise.resolve(putAnswer(body.on));
    }
    if (url === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
    /* The admin's cost section on the same page asks for its own figures. */
    if (url.endsWith("/cost")) {
      return Promise.resolve(json({ slug: SLUG, lines: [], silentLiveSessions: 0 }));
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

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

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

const box = (): HTMLInputElement | null =>
  host.querySelector<HTMLInputElement>('[data-high-power] input[type="checkbox"]');
const words = (): string =>
  host.querySelector<HTMLElement>("[data-high-power]")?.textContent ?? "";
const status = (): HTMLElement | null =>
  host.querySelector<HTMLElement>('[data-high-power] [aria-live="polite"]');

async function click(el: HTMLElement | null): Promise<void> {
  await act(async () => el?.click());
  await settle();
}

describe("the High-powered AI switch", () => {
  it("is drawn for a reader, pricing it in articles and never in money", async () => {
    session.user = { id: "5e1d6c0a-7b2f-4e39-9a4d-3c8f2b1e6a70" };
    await open();
    expect(box()).toBeTruthy();
    expect(words()).toContain("counts as one more article against your allowance");
    expect(words()).toContain("half of one while the article is shared publicly");
    expect(words()).toContain("doesn't give it back");
    expect(words()).not.toContain("Administrator: no charge");
    /* Greg, 2026-09-30: no regular user is told what AI processing costs. The
       v1 line compared token prices, which is that. */
    expect(words()).not.toMatch(/token|price|\$|£|€|cost/i);
  });

  it("sends a reader's press to the owner route, and shows a refusal beside the unticked box", async () => {
    session.user = { id: "5e1d6c0a-7b2f-4e39-9a4d-3c8f2b1e6a70" };
    putAnswer = () => json({ error: "Switching on High-powered AI counts as one more article against your allowance — half of one if the article is shared publicly — and there is not that much left. [pay-high-power]" }, 402);
    await open();
    await click(box());
    expect(puts).toEqual([{ url: `PUT /api/article/${SLUG}/high-power`, body: { on: true } }]);
    expect(box()?.checked).toBe(false);
    expect(words()).toContain("Not saved");
    expect(words()).toContain("there is not that much left");
  });

  it("is drawn for the administrator, off, once the metadata has answered", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    await open();
    expect(box()).toBeTruthy();
    expect(box()?.checked).toBe(false);
    expect(box()?.disabled).toBe(false);
    expect(words()).toContain("High-powered AI");
    expect(words()).toContain("Opus");
    expect(words()).toContain("Administrator: no charge.");
    expect(words()).toContain("Off.");
    expect(words()).not.toContain("On since");
    expect(box()?.labels?.[0]?.textContent).toContain("High-powered AI");
    expect(status()).toBeTruthy();
  });

  it("reads as on, with its date, when the column is already set", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    serverSince = SINCE;
    await open();
    expect(box()?.checked).toBe(true);
    expect(words()).toContain("On since");
  });

  it("sends PUT {on:true} to this article's route, shows the answer, and re-reads", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    await open();
    const readsBefore = metadataReads;
    await click(box());
    expect(puts).toEqual([
      { url: `PUT /api/article/${SLUG}/high-power`, body: { on: true } },
    ]);
    expect(box()?.checked).toBe(true);
    expect(words()).toContain("On since");
    expect(metadataReads).toBeGreaterThan(readsBefore);

    await click(box());
    expect(puts[1]?.body).toEqual({ on: false });
    expect(box()?.checked).toBe(false);
    expect(words()).not.toContain("On since");
  });

  /* Found in the browser, not by the tests above: the box was synced from the
     page's read whenever a save *finished*, so switching off put the old "on"
     back from the read that had not been refreshed yet — and it stayed until
     the refresh landed. Here the refresh is held so that window stays open. */
  it("shows the write's answer, not the older read, while the refresh is still out", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    serverSince = SINCE;
    await open();
    expect(box()?.checked).toBe(true);
    holdMetadata = true;
    await click(box());
    expect(puts[0]?.body).toEqual({ on: false });
    expect(heldMetadata.length).toBeGreaterThan(0);
    expect(box()?.checked).toBe(false);
    expect(words()).not.toContain("On since");
    await act(async () => {
      for (const go of heldMetadata.splice(0)) go();
    });
    await settle();
    expect(box()?.checked).toBe(false);
  });

  it("is disabled while the write is in flight", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    await open();
    let release: (() => void) | undefined;
    putAnswer = () =>
      new Promise<Response>((go) => {
        release = () => {
          serverSince = SINCE;
          go(json({ highPowerSince: SINCE }));
        };
      });
    await act(async () => box()?.click());
    expect(box()?.disabled).toBe(true);
    expect(status()?.textContent).toContain("Saving");
    await act(async () => box()?.click());
    expect(puts).toHaveLength(1);
    await act(async () => release?.());
    await settle();
    expect(box()?.disabled).toBe(false);
    expect(box()?.checked).toBe(true);
  });

  it("leaves the box as it was and says so when the write fails", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    await open();
    putAnswer = () => json({ error: "That article isn't one of yours." }, 404);
    await click(box());
    expect(puts).toHaveLength(1);
    expect(box()?.checked).toBe(false);
    expect(box()?.disabled).toBe(false);
    expect(words()).toContain("Not saved");
    expect(words()).toContain("That article isn't one of yours.");
    expect(words()).not.toContain("On since");
  });

  it("re-reads after a lost reply because the write may have landed", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    await open();
    const readsBefore = metadataReads;
    putAnswer = (on) => {
      serverSince = on ? SINCE : null;
      return Promise.reject(new TypeError("The reply was lost"));
    };
    await click(box());
    expect(puts).toHaveLength(1);
    expect(metadataReads).toBeGreaterThan(readsBefore);
    expect(box()?.checked).toBe(true);
    expect(words()).toContain("On since");
    expect(words()).not.toContain("Not saved");
  });
});
