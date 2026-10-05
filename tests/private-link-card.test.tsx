// @vitest-environment jsdom
/**
 * **The owner's private-link control**, above the public switch on the Access
 * & Sharing card.
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 *
 * What is held here is what can be wrong without looking wrong:
 *
 *  1. The state comes **from the server each time the card opens**, never from
 *     the page's own fetch and never from a copy. A link that was turned off
 *     in another tab must not be drawn as on.
 *  2. A read that failed, or an answer that does not parse, is drawn as *we
 *     could not check*, with no link and nothing to press.
 *  3. Making a link sends exactly `{"rightsConfirmed": true}`, only after the
 *     box is ticked, and the card then draws **the server's key**.
 *  4. Turning it off sends no body, and making one again draws the new key and
 *     not the old one.
 *  5. When the article is also public the card says the link is not what
 *     keeps it readable.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOT_READ_YET_SHARE,
  PRIVATE_LINK_ALSO_PUBLIC,
  PRIVATE_LINK_UNKNOWN,
  PRIVATE_LINK_WHAT,
  PRIVATE_LINK_WRITE_UNCERTAIN,
  SHARING_INVENTORY_UNKNOWN,
  SHARING_RIGHTS_CONFIRM,
  privateLinkConfirmBody,
} from "../src/messages.js";
import type { ArticleSharing, PublicArtefacts } from "../src/types.js";

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

const { PrivateLink, asShareLinkState } = await import("../src/web/PrivateLink.js");

const SLUG = "a-piece";
const ROUTE = `/api/article/${SLUG}/share-link`;
const KEY = "AbCdEfGhIjKlMnOpQrStUv";
const NEW_KEY = "ZyXwVuTsRqPoNmLkJiHgFe";
const SINCE = "2026-10-05T10:00:00.000Z";
const linkFor = (key: string) => `${location.origin}/read/${SLUG}?key=${key}`;

const AVAILABLE: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: true,
  ideas: false,
  quotes: true,
  timeline: true,
  sketch: true,
  skim: true,
  faq: true,
  simpleSummary: true,
  citations: true,
  debate: true,
};
const SHARING: ArticleSharing = {
  visibility: "private",
  publicAt: null,
  personalised: [],
  available: AVAILABLE,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Every request the control made. */
const calls: { url: string; method: string; body: string | undefined }[] = [];
let onGet: () => Response;
let onPost: () => Response;
let onDelete: () => Response;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  onGet = () => json({ on: false });
  onPost = () => json({ on: true, key: KEY, since: SINCE });
  onDelete = () => json({ on: false });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body === undefined ? undefined : String(init.body) });
    if (url !== ROUTE) return Promise.resolve(json({}, 500));
    if (method === "GET") return Promise.resolve(onGet());
    if (method === "POST") return Promise.resolve(onPost());
    if (method === "DELETE") return Promise.resolve(onDelete());
    return Promise.resolve(json({}, 500));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function mount(
  props: { sharing?: ArticleSharing | undefined; isPublic?: boolean | null } = {},
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(PrivateLink, {
        slug: SLUG,
        title: "A piece",
        sharing: "sharing" in props ? props.sharing : SHARING,
        isPublic: "isPublic" in props ? (props.isPublic ?? null) : false,
      }),
    );
  });
  await settle();
}

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text) ?? null;

async function press(text: string): Promise<void> {
  const found = button(text);
  if (!found) throw new Error(`No button saying "${text}". The card reads: ${host.textContent}`);
  await act(async () => found.click());
  await settle();
}

function tickTheBox(): void {
  const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) throw new Error("No rights checkbox on the card");
  act(() => box.click());
}

const shownLink = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="The private link"]')?.value ?? null;
const sent = (method: string) => calls.filter((c) => c.method === method);

describe("reading the link's state", () => {
  it("asks the server when it opens, and draws the off state", async () => {
    await mount();
    expect(calls).toEqual([{ url: ROUTE, method: "GET", body: undefined }]);
    expect(host.textContent).toContain("Private link");
    expect(host.textContent).toContain(PRIVATE_LINK_WHAT);
    expect(button("Create a link")).not.toBeNull();
    expect(shownLink()).toBeNull();
    expect(button("Turn off")).toBeNull();
  });

  it("draws the whole link, Copy, Turn off and since when, when one is on", async () => {
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mount();
    expect(shownLink()).toBe(linkFor(KEY));
    expect(button("Copy")).not.toBeNull();
    expect(button("Turn off")).not.toBeNull();
    expect(host.textContent).toMatch(/On since .*2026/);
    expect(host.textContent).toContain(PRIVATE_LINK_WHAT);
    expect(button("Create a link")).toBeNull();
  });

  it("asks again each time the card opens", async () => {
    await mount();
    await act(async () => root.unmount());
    root = createRoot(host);
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mount();
    expect(sent("GET")).toHaveLength(2);
    expect(shownLink()).toBe(linkFor(KEY));
  });

  it("says it could not check when the read fails, and offers nothing", async () => {
    onGet = () => json({ error: "The database did not answer. [db-down]" }, 503);
    await mount();
    expect(host.textContent).toContain(PRIVATE_LINK_UNKNOWN);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(shownLink()).toBeNull();
  });

  it.each([
    ["an empty object", {}],
    ["on with no key", { on: true, since: SINCE }],
    ["a key that is not a key", { on: true, key: "short", since: SINCE }],
    ["a date that is not a date", { on: true, key: KEY, since: "soon" }],
    ["on that is not a boolean", { on: "yes" }],
  ])("does not draw an answer it cannot read: %s", async (_name, body) => {
    onGet = () => json(body);
    await mount();
    expect(asShareLinkState(body)).toBeNull();
    expect(host.textContent).toContain(PRIVATE_LINK_UNKNOWN);
    expect(shownLink()).toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("reads the two answers the server gives", () => {
    expect(asShareLinkState({ on: false })).toEqual({ on: false });
    expect(asShareLinkState({ on: true, key: KEY, since: SINCE })).toEqual({ on: true, key: KEY, since: SINCE });
  });
});

describe("making a link", () => {
  it("does not promise to unlist an article that is already public", async () => {
    await mount({ isPublic: true });
    await press("Create a link");
    expect(host.textContent).toContain(PRIVATE_LINK_ALSO_PUBLIC);
    expect(host.textContent).not.toContain("It is not listed anywhere");
  });

  it("shows what goes out and asks for the rights tick before anything is sent", async () => {
    await mount();
    await press("Create a link");

    expect(host.textContent).toContain(privateLinkConfirmBody("A piece"));
    /* The same derived inventory the public confirmation draws. */
    expect(host.textContent).toContain("Anyone who opens it gets these");
    expect(host.textContent).toContain("These stay with you");
    expect(host.textContent).toContain(SHARING_RIGHTS_CONFIRM);
    expect(button("Create the link")?.disabled).toBe(true);
    await act(async () => button("Create the link")?.click());
    await settle();
    expect(sent("POST")).toEqual([]);
  });

  it("sends exactly the rights confirmation, and draws the server's key", async () => {
    await mount();
    await press("Create a link");
    tickTheBox();
    await press("Create the link");

    expect(sent("POST")).toEqual([{ url: ROUTE, method: "POST", body: '{"rightsConfirmed":true}' }]);
    expect(shownLink()).toBe(linkFor(KEY));
    expect(button("Turn off")).not.toBeNull();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("lets the owner back out, and forgets the tick", async () => {
    await mount();
    await press("Create a link");
    tickTheBox();
    await press("Cancel");
    expect(sent("POST")).toEqual([]);
    await press("Create a link");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  });

  it("does not offer one while it cannot say what a link would carry", async () => {
    await mount({ sharing: { visibility: "private", publicAt: null, personalised: [] } });
    expect(button("Create a link")).toBeNull();
    expect(host.textContent).toContain(SHARING_INVENTORY_UNKNOWN);
  });

  /* A paper with only its title and abstract read. The server refuses, and a
     refusal changes nothing, so the card says why and is still off. */
  it("shows the server's sentence when a paper has not been read through, and stays off", async () => {
    onPost = () => json({ error: NOT_READ_YET_SHARE.message, code: "not-processed" }, 409);
    await mount();
    await press("Create a link");
    tickTheBox();
    await press("Create the link");

    expect(host.textContent).toContain(NOT_READ_YET_SHARE.message);
    expect(shownLink()).toBeNull();
    expect(host.textContent).not.toContain(PRIVATE_LINK_WRITE_UNCERTAIN);
    expect(button("Create a link")).not.toBeNull();
  });

  it("admits it cannot say when the request did not come back", async () => {
    onPost = () => json({ error: "Something broke. [x-y]" }, 500);
    await mount();
    await press("Create a link");
    tickTheBox();
    await press("Create the link");

    expect(host.textContent).toContain(PRIVATE_LINK_WRITE_UNCERTAIN);
    expect(shownLink()).toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("does not draw a success it cannot read", async () => {
    onPost = () => json({ on: true, key: "not-a-key", since: SINCE });
    await mount();
    await press("Create a link");
    tickTheBox();
    await press("Create the link");
    expect(host.textContent).toContain(PRIVATE_LINK_WRITE_UNCERTAIN);
    expect(shownLink()).toBeNull();
  });
});

describe("turning it off, and making one again", () => {
  beforeEach(() => {
    onGet = () => json({ on: true, key: KEY, since: SINCE });
  });

  it("sends a DELETE with no body, and draws the off state", async () => {
    await mount();
    await press("Turn off");
    expect(sent("DELETE")).toEqual([{ url: ROUTE, method: "DELETE", body: undefined }]);
    expect(shownLink()).toBeNull();
    expect(host.textContent).not.toContain(KEY);
    expect(button("Create a link")).not.toBeNull();
  });

  it("draws the new key after making one again, and the old one nowhere", async () => {
    await mount();
    await press("Turn off");
    onPost = () => json({ on: true, key: NEW_KEY, since: "2026-10-06T09:00:00.000Z" });
    await press("Create a link");
    tickTheBox();
    await press("Create the link");

    expect(shownLink()).toBe(linkFor(NEW_KEY));
    expect(host.innerHTML).not.toContain(KEY);
  });

  it("can still be turned off when the inventory could not be read", async () => {
    await mount({ sharing: undefined });
    expect(shownLink()).toBe(linkFor(KEY));
    await press("Turn off");
    expect(sent("DELETE")).toHaveLength(1);
  });

  it("admits it cannot say when turning off did not come back, and stops showing the link", async () => {
    onDelete = () => json({ error: "Something broke. [x-y]" }, 500);
    await mount();
    await press("Turn off");
    expect(host.textContent).toContain(PRIVATE_LINK_WRITE_UNCERTAIN);
    expect(shownLink()).toBeNull();
  });
});

describe("copying the link", () => {
  it("puts the exact link on the clipboard", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void written.push(text) },
      configurable: true,
    });
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mount();
    await press("Copy");
    expect(written).toEqual([linkFor(KEY)]);
    expect(button("Copied")).not.toBeNull();
  });

  /* A long address in a narrow card: an input scrolls inside its own box, and
     `min-w-0` lets the row shrink round it, so it cannot widen the page. */
  it("draws the link in a box that can shrink, so a phone's page is not widened", async () => {
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mount();
    const box = host.querySelector<HTMLInputElement>('input[aria-label="The private link"]');
    expect(box?.readOnly).toBe(true);
    expect(box?.className).toContain("tw:min-w-0");
    expect(box?.className).toContain("tw:flex-1");
  });
});

/**
 * The public switch under this control draws *"Only you can read this"* for a
 * private article, which is false while a link is on. So this control says
 * upwards what it knows, and `null` whenever it does not.
 */
describe("telling the rest of the card whether a link is on", () => {
  const told: (boolean | null)[] = [];
  async function mountTelling(): Promise<void> {
    told.length = 0;
    await act(async () => {
      root.render(
        createElement(PrivateLink, {
          slug: SLUG,
          title: "A piece",
          sharing: SHARING,
          isPublic: false,
          onLink: (on: boolean | null) => void told.push(on),
        }),
      );
    });
    await settle();
  }

  it("says it does not know until the read lands, then what the server said", async () => {
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mountTelling();
    expect(told[0]).toBeNull();
    expect(told.at(-1)).toBe(true);
  });

  it("says it does not know when the read fails", async () => {
    onGet = () => json({ error: "no" }, 500);
    await mountTelling();
    expect(new Set(told)).toEqual(new Set([null]));
  });

  it("follows a link being made and turned off, by the server's answers", async () => {
    await mountTelling();
    expect(told.at(-1)).toBe(false);
    await press("Create a link");
    tickTheBox();
    await press("Create the link");
    expect(told.at(-1)).toBe(true);
    await press("Turn off");
    expect(told.at(-1)).toBe(false);
    /* And not a claim in between: each write went through "not known". */
    expect(told.join(",")).toContain("false,,true,,false");
  });

  it("says it does not know after a write that did not come back", async () => {
    onPost = () => json({ error: "Something broke. [x-y]" }, 500);
    await mountTelling();
    await press("Create a link");
    tickTheBox();
    await press("Create the link");
    expect(told.at(-1)).toBeNull();
  });
});

describe("an article that is also public", () => {
  it("says the public address works without the link, and that turning it off does not make it private", async () => {
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mount({ isPublic: true });
    expect(host.textContent).toContain(PRIVATE_LINK_ALSO_PUBLIC);
    expect(PRIVATE_LINK_ALSO_PUBLIC).toMatch(/without the link/);
    expect(PRIVATE_LINK_ALSO_PUBLIC).toMatch(/not make (it|the article) private/);
  });

  it("says nothing of the kind about a private article, or one it cannot vouch for", async () => {
    onGet = () => json({ on: true, key: KEY, since: SINCE });
    await mount({ isPublic: false });
    expect(host.textContent).not.toContain(PRIVATE_LINK_ALSO_PUBLIC);
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({ isPublic: null });
    expect(host.textContent).not.toContain(PRIVATE_LINK_ALSO_PUBLIC);
  });

  it("says nothing about public while there is no link to be confused about", async () => {
    await mount({ isPublic: true });
    expect(host.textContent).not.toContain(PRIVATE_LINK_ALSO_PUBLIC);
  });
});
