// @vitest-environment jsdom
/**
 * **The switch that puts somebody else's article on the open web.**
 *
 * Four things about this control are load-bearing, and three of them are about
 * what it does when it is *not sure*:
 *
 *  1. It finds out the current state by **asking the public endpoint**, which
 *     is the only non-mutating way to ask — there is no visibility field on
 *     `GET /api/metadata/:slug`, and the `PUT` is not a thing you may call to
 *     find out. Asking anonymously is also the honest version of the question:
 *     *can somebody with this link read it*, asked from where a stranger asks
 *     it.
 *  2. A check that **failed** must not be drawn as "not shared". That is the
 *     one control where being confidently wrong publishes an article, or tells
 *     somebody a public document is private. docs/reusable/silent-success.md.
 *  3. Publishing carries `rightsConfirmed: true` and unpublishing carries **no
 *     `rightsConfirmed` at all** — the server 400s on both mistakes, and the
 *     second is not symmetry: nobody confirms anything to take a document
 *     *down*, so a `true` there would write a confirmation nobody gave into the
 *     column a rights complaint would ask about.
 *  4. The card believes the **server's answer**, not the value it sent. A 200
 *     is not evidence a field was honoured.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { AccessSharing } = await import("../src/web/AccessSharing.js");

const SLUG = "a-piece";

/** Every request the card made. */
const calls: { url: string; method: string; body: unknown }[] = [];
/** How the probe of the public endpoint is answered. Posed by each test. */
let probe: () => Response;
/** How the `PUT` is answered. */
let put: () => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  probe = () => json({ error: "not shared" }, 404);
  put = () => json({ visibility: "public", publicAt: "2026-08-28T11:00:00.000Z" });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Promise.resolve(method === "PUT" ? put() : probe());
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(AccessSharing, { slug: SLUG, title: "A piece" }));
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The one button whose visible text contains `text`. */
function press(text: string): void {
  const button = [...host.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!button) throw new Error(`No button saying "${text}" — page reads: ${host.textContent}`);
  act(() => {
    button.click();
  });
}

function tickTheBox(): void {
  const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) throw new Error("No rights checkbox on the page");
  act(() => {
    box.click();
  });
}

describe("finding out who can read this", () => {
  it("asks the public endpoint, and never the PUT", async () => {
    await mount();

    expect(calls).toEqual([
      { url: `/api/public/metadata/${SLUG}`, method: "GET", body: undefined },
    ]);
    expect(host.textContent).toContain("Only you can read this");
  });

  it("says so when the article is already shared", async () => {
    probe = () => json({ slug: SLUG, title: "A piece", available: {} });
    await mount();

    expect(host.textContent).toContain("Anyone with the link can read this");
    // The link, ready to copy, and the honest limit beside it.
    expect(host.querySelector<HTMLInputElement>("input[readonly]")?.value).toContain(
      `/read/${SLUG}`,
    );
    expect(host.textContent).toContain("cannot take back a page");
  });

  /**
   * **The failure that must not look like an answer.**
   *
   * A 501 is what the filesystem store answers with, and a 500 is anything
   * else. Drawing either as "not shared" would tell an owner their public
   * document is private — and would offer them a Share button for a document
   * that is already shared.
   */
  it("refuses to guess when the check fails", async () => {
    for (const status of [500, 501]) {
      calls.length = 0;
      probe = () => json({ error: "no" }, status);
      await mount();

      expect(host.textContent).toContain("could not check");
      expect(host.textContent).not.toContain("Only you can read this");
      expect(host.querySelector("button")).toBeNull();

      await act(async () => root.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
    }
  });
});

describe("turning it on", () => {
  it("will not publish until the owner confirms the rights", async () => {
    await mount();
    press("Share with anyone");

    const share = [...host.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Share it"),
    );
    expect(share?.disabled).toBe(true);
    // And the reason is on the page rather than in a tooltip.
    expect(host.textContent).toContain("I have the right to share this article's text");
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("names the article and says what sharing does, before it does it", async () => {
    await mount();
    press("Share with anyone");

    expect(host.textContent).toContain("A piece");
    expect(host.textContent).toContain("anyone with the link can read it");
    expect(host.textContent).toContain("reader profile");
  });

  it("sends rightsConfirmed: true, and believes the answer rather than the request", async () => {
    put = () => json({ visibility: "public", publicAt: "2026-08-28T11:00:00.000Z" });
    await mount();
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });

    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      {
        url: `/api/article/${SLUG}/visibility`,
        method: "PUT",
        body: { visibility: "public", rightsConfirmed: true },
      },
    ]);
    expect(host.textContent).toContain("Anyone with the link can read this");
  });

  /**
   * The server's answer wins even when it disagrees with the request — which is
   * not hypothetical: asking for a state the article is already in returns the
   * current representation and changes nothing, and a card that trusted its own
   * request would then be drawing a state the database does not hold.
   */
  it("draws what the server said, not what it asked for", async () => {
    put = () => json({ visibility: "private", publicAt: null });
    await mount();
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });

    expect(host.textContent).toContain("Only you can read this");
  });
});

describe("turning it off", () => {
  it("sends no rightsConfirmed at all", async () => {
    probe = () => json({ slug: SLUG, title: "A piece", available: {} });
    put = () => json({ visibility: "private", publicAt: null });
    await mount();
    press("Stop sharing");
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });

    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      { url: `/api/article/${SLUG}/visibility`, method: "PUT", body: { visibility: "private" } },
    ]);
    expect(host.textContent).toContain("Only you can read this");
  });

  /**
   * A failed request is not proof that nothing was written. The route writes and
   * then reads back, and a response can be lost on the way home — so the card
   * goes to "we do not know" rather than back to where it was. The same lesson
   * Delete on this page learned on 2026-08-27.
   */
  it("stops claiming to know when the write fails", async () => {
    probe = () => json({ slug: SLUG, title: "A piece", available: {} });
    put = () => json({ error: "the database went away" }, 500);
    await mount();
    press("Stop sharing");
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });

    expect(host.textContent).toContain("could not check");
    expect(host.textContent).not.toContain("Anyone with the link can read this");
  });
});
