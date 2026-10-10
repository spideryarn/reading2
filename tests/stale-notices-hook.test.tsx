// @vitest-environment jsdom
/**
 * **The × on an "older version of the article" notice, and the races around
 * it** — src/web/useStaleNotices.ts, drawn through src/web/StaleNotice.tsx.
 * docs/plans/261010a-dismiss-older-version-notices.md § After GPT Sol's plan
 * review, finding 6.
 *
 * The real hook, the real component and **the real `apiFetch`**; what is posed
 * is `fetch`, one request at a time, each answered when the test says so —
 * which is the only way to put a read and a write in the order a race needs.
 *
 *  1. Ten panels make one GET between them; nothing is asked while nothing is stale,
 *     and no banner flashes before that read settles.
 *  2. The × hides at once and POSTs the mode's whole list.
 *  3. A GET that began before the press, landing after it, does not bring it back.
 *  4. Two presses in a row (Search): the second waits for the first and sends both.
 *  5. A slug change: a write for the article left lands where nobody is looking.
 *  6. A sign-out: the last reader's dismissals are not the next one's.
 *  7. Old-epoch queued writes and reconciliation reads are never sent.
 *  8. A failed POST whose read shows it landed: hidden, nothing said.
 *  9. A failed POST whose read shows it did not: back, with the reason, only
 *     on the artefact whose dismissal failed.
 * 10. One mode's read-back cannot undo another mode's successful write.
 * 11. A visitor: hidden, and nothing is sent.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaleNoticeMode } from "../src/stale-notice.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => undefined,
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => "owner-1",
  forgetUser: () => {},
}));

const { StaleNotice } = await import("../src/web/StaleNotice.js");
const { useStaleNotice, forgetStaleNotices } = await import("../src/web/useStaleNotices.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

/* ------------------------------------------------------------ the network -- */

interface Pending {
  url: string;
  method: string;
  body: unknown;
  answer(res: Response | Error): Promise<void>;
}
let pending: Pending[] = [];

function stubFetch(): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return new Promise<Response>((resolve, reject) => {
      pending.push({
        url,
        method,
        body,
        answer: async (res) => {
          await act(async () => {
            if (res instanceof Error) reject(res);
            else resolve(res);
            await new Promise((go) => setTimeout(go, 0));
          });
          await flush();
        },
      });
    });
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });
const dismissedBody = (dismissed: Record<string, string[]>) => json({ dismissed });

/** The one request in the air that matches, removed from the queue. */
function take(method: string, url?: string): Pending {
  const at = pending.findIndex((p) => p.method === method && (url === undefined || p.url === url));
  if (at < 0) throw new Error(`no ${method} ${url ?? ""} in the air: ${pending.map((p) => `${p.method} ${p.url}`).join(", ")}`);
  const [found] = pending.splice(at, 1);
  return found as Pending;
}

async function flush(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/* -------------------------------------------------------------- the panel -- */

function Panel({
  slug,
  mode,
  identities,
  owner = true,
}: {
  slug: string;
  mode: StaleNoticeMode;
  identities: string[];
  owner?: boolean;
}) {
  const notice = useStaleNotice({ slug, mode, identities, owner });
  return createElement(
    "section",
    { "data-mode": mode },
    // biome-ignore lint/correctness/noChildrenProp: `createElement`'s typing requires the props object to carry the required `children`.
    createElement(StaleNotice, { notice, children: `${notice.showing.length} stale` }),
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  forgetStaleNotices();
  pending = [];
  stubFetch();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(...panels: Parameters<typeof Panel>[0][]): Promise<void> {
  await act(async () => {
    root.render(createElement("div", null, ...panels.map((p, i) => createElement(Panel, { key: i, ...p }))));
  });
  await flush();
}

const banner = (mode: StaleNoticeMode) => host.querySelector(`[data-mode="${mode}"] [data-stale-notice]`);
const press = async (mode: StaleNoticeMode) => {
  const close = host.querySelector<HTMLButtonElement>(`[data-mode="${mode}"] .notice-close`);
  if (!close) throw new Error(`no × on ${mode}`);
  await act(async () => close.click());
  await flush();
};

const A = "2026-10-10T08:00:00.000Z";
const B = "2026-10-10T09:00:00.000Z";
const URL_ONE = "/api/stale-notices/one";

describe("useStaleNotice", () => {
  it("asks nothing while nothing is stale, and once for every panel when something is", async () => {
    await render({ slug: "one", mode: "glossary", identities: [] });
    expect(pending).toEqual([]);
    await render(
      { slug: "one", mode: "glossary", identities: [A] },
      { slug: "one", mode: "ideas", identities: [A] },
      { slug: "one", mode: "faq", identities: [B] },
    );
    expect(pending.map((p) => `${p.method} ${p.url}`)).toEqual([`GET ${URL_ONE}`]);
    /* Nothing flashes while the dismissal read is unresolved. */
    expect(banner("ideas")).toBeNull();
    await take("GET").answer(dismissedBody({ ideas: [A] }));
    expect(banner("ideas")).toBeNull();
    expect(banner("glossary")).toBeTruthy();
    expect(banner("faq")).toBeTruthy();
  });

  it("shows the notice once the first dismissal read fails", async () => {
    await render({ slug: "one", mode: "glossary", identities: [A] });
    expect(banner("glossary")).toBeNull();
    await take("GET").answer(new TypeError("Failed to fetch"));
    expect(banner("glossary")).toBeTruthy();
  });

  it("hides at once on ×, and POSTs the mode's list", async () => {
    await render({ slug: "one", mode: "glossary", identities: [A] });
    await take("GET").answer(dismissedBody({}));
    await press("glossary");
    expect(banner("glossary")).toBeNull();
    const post = take("POST", URL_ONE);
    expect(post.body).toEqual({ mode: "glossary", identities: [A] });
    await post.answer(noContent());
    expect(banner("glossary")).toBeNull();
  });

  it("is not brought back by another mode's read-back begun before the press", async () => {
    await render(
      { slug: "one", mode: "glossary", identities: [A] },
      { slug: "one", mode: "timeline", identities: [B] },
    );
    await take("GET").answer(dismissedBody({}));
    await press("timeline");
    await take("POST").answer(new TypeError("Failed to fetch"));
    const early = take("GET");
    await press("glossary");
    await take("POST").answer(noContent());
    await early.answer(dismissedBody({}));
    expect(banner("glossary")).toBeNull();
  });

  it("sends both of two quick presses, in order, the second after the first (Search)", async () => {
    await render({ slug: "one", mode: "search", identities: [`r1@${A}`] });
    await take("GET").answer(dismissedBody({}));
    await press("search");
    const first = take("POST");
    /* A second run goes stale while the first write is out. */
    await render({ slug: "one", mode: "search", identities: [`r1@${A}`, `r2@${B}`] });
    expect(host.textContent).toContain("1 stale");
    await press("search");
    expect(banner("search")).toBeNull();
    expect(pending.filter((p) => p.method === "POST")).toEqual([]);
    await first.answer(noContent());
    const second = take("POST");
    expect(first.body).toEqual({ mode: "search", identities: [`r1@${A}`] });
    expect(second.body).toEqual({ mode: "search", identities: [`r1@${A}`, `r2@${B}`] });
    await second.answer(noContent());
    expect(banner("search")).toBeNull();
  });

  it("does not let another mode's failed-write read-back overtake a successful dismissal", async () => {
    await render(
      { slug: "one", mode: "glossary", identities: [A] },
      { slug: "one", mode: "timeline", identities: [B] },
    );
    await take("GET").answer(dismissedBody({}));

    await press("glossary");
    const glossaryPost = take("POST");
    await press("timeline");
    const timelinePost = take("POST");

    /* Glossary's failure starts a read while Timeline's write is still out. */
    await glossaryPost.answer(new TypeError("Failed to fetch"));
    const readBack = take("GET");
    await timelinePost.answer(noContent());
    await readBack.answer(dismissedBody({}));

    expect(banner("timeline"), "an older read undid Timeline's successful write").toBeNull();
  });

  it("drops a write for the article the reader has left onto that article only", async () => {
    await render({ slug: "one", mode: "glossary", identities: [A] });
    await take("GET").answer(dismissedBody({}));
    await press("glossary");
    const post = take("POST", URL_ONE);
    await render({ slug: "two", mode: "glossary", identities: [A] });
    await take("GET", "/api/stale-notices/two").answer(dismissedBody({}));
    await post.answer(noContent());
    expect(banner("glossary"), "article two's notice was hidden by article one's write").toBeTruthy();
    await render({ slug: "one", mode: "glossary", identities: [A] });
    expect(banner("glossary")).toBeNull();
  });

  it("forgets the last reader's dismissals on a sign-out, and their late answers too", async () => {
    await render({ slug: "one", mode: "glossary", identities: [A] });
    await take("GET").answer(dismissedBody({}));
    await press("glossary");
    const post = take("POST");
    await act(async () => jobEngine.reset());
    await flush();
    expect(banner("glossary"), "the next reader flashed before its read").toBeNull();
    const read = take("GET");
    await post.answer(noContent());
    await read.answer(dismissedBody({}));
    expect(banner("glossary")).toBeTruthy();
  });

  it("does not send queued or reconciliation work after the reader epoch changes", async () => {
    await render({ slug: "one", mode: "search", identities: [`r1@${A}`] });
    await take("GET").answer(dismissedBody({}));
    await press("search");
    const first = take("POST");
    await render({ slug: "one", mode: "search", identities: [`r1@${A}`, `r2@${B}`] });
    await press("search");

    await act(async () => jobEngine.reset());
    await flush();
    const nextReader = take("GET");
    await first.answer(new TypeError("Failed to fetch"));
    expect(pending.filter((p) => p.method === "POST" || p.method === "GET")).toEqual([]);
    await nextReader.answer(dismissedBody({}));
  });

  it("stays hidden, and says nothing, when a failed POST's read shows it landed", async () => {
    await render({ slug: "one", mode: "timeline", identities: [A] });
    await take("GET").answer(dismissedBody({}));
    await press("timeline");
    await take("POST").answer(new TypeError("Failed to fetch"));
    expect(banner("timeline"), "hidden while the server is asked").toBeNull();
    await take("GET").answer(dismissedBody({ timeline: [A] }));
    expect(banner("timeline")).toBeNull();
    expect(host.textContent).not.toContain("Could not hide this");
  });

  it("comes back with the reason when a failed POST's read shows it did not land", async () => {
    await render({ slug: "one", mode: "timeline", identities: [A] });
    await take("GET").answer(dismissedBody({}));
    await press("timeline");
    await take("POST").answer(json({ error: "The database is having a moment." }, 500));
    await take("GET").answer(dismissedBody({}));
    expect(banner("timeline")).toBeTruthy();
    expect(host.querySelector(".notice-failed")?.textContent).toContain("Could not hide this");
  });

  it("does not carry a failed dismissal's sentence onto a regenerated artefact", async () => {
    await render({ slug: "one", mode: "timeline", identities: [A] });
    await take("GET").answer(dismissedBody({}));
    await press("timeline");
    await take("POST").answer(new TypeError("Failed to fetch"));
    await take("GET").answer(dismissedBody({}));
    expect(host.querySelector(".notice-failed")).toBeTruthy();

    await render({ slug: "one", mode: "timeline", identities: [B] });
    expect(banner("timeline")).toBeTruthy();
    expect(host.querySelector(".notice-failed")).toBeNull();
  });

  it("holds a visitor's dismissal for the page view, and sends nothing", async () => {
    await render({ slug: "one", mode: "search", identities: [`r1@${A}`], owner: false });
    expect(pending).toEqual([]);
    await press("search");
    expect(banner("search")).toBeNull();
    expect(pending).toEqual([]);
  });
});
