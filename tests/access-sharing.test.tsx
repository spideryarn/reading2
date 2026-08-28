// @vitest-environment jsdom
/**
 * **The switch that puts somebody else's article on the open web.**
 *
 * Four things about this control are load-bearing, and three of them are about
 * what it does when it is *not sure*:
 *
 *  1. It finds out the current state from `ArticleMetadata.sharing`, which the
 *     page has already fetched, and so **makes no request at all** until the
 *     owner presses something. Until 2026-08-28 it probed the public endpoint
 *     anonymously, because there was no owner-side field; that worked and was
 *     the wrong shape, and could not see `publicAt`.
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
import type { ArticleSharing } from "../src/types.js";
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
/** How the `PUT` is answered. */
let put: () => Response;

const PRIVATE: ArticleSharing = { visibility: "private", publicAt: null, personalised: [] };
const SHARED: ArticleSharing = {
  visibility: "public",
  publicAt: "2026-08-28T09:00:00.000Z",
  personalised: [],
};

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
  put = () => json({ visibility: "public", publicAt: "2026-08-28T11:00:00.000Z" });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    /* Anything that is not the `PUT` is a request this card should not be
       making at all, and the first test asserts exactly that — so the reply is
       deliberately useless rather than plausible. */
    return Promise.resolve(method === "PUT" ? put() : json({}, 500));
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

/**
 * **No default parameter, and that is the point of this comment.**
 *
 * It had `= PRIVATE`, and JavaScript applies a default for an *explicitly
 * passed* `undefined` — so `mount(undefined)`, which is the whole of the "this
 * store cannot say" case, quietly mounted a **private** article instead. The
 * test then failed against a state it had never rendered, and the obvious next
 * move would have been to go looking in the component. A default that swallows
 * the exact value a test is about is worse than no default; every caller says
 * what it means.
 */
async function mount(sharing: ArticleSharing | undefined): Promise<void> {
  await act(async () => {
    root.render(createElement(AccessSharing, { slug: SLUG, title: "A piece", sharing }));
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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((go) => setTimeout(go, 0));
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
  it("reads the field the page already fetched, and asks for nothing", async () => {
    await mount(PRIVATE);

    expect(calls).toEqual([]);
    expect(host.textContent).toContain("Only you can read this");
  });

  it("says so when the article is already shared", async () => {
    await mount(SHARED);

    expect(host.textContent).toContain("Anyone with the link can read this");
    expect(host.querySelector<HTMLInputElement>("input[readonly]")?.value).toContain(
      `/read/${SLUG}`,
    );
    expect(host.textContent).toContain("cannot take back a page");
    /* **"Shared since" survives a page load**, which the old probe could not
       manage: a 200 said *somebody can read this* and nothing about when. This
       is the visible half of moving to the owned field. */
    expect(host.textContent).toContain("Shared since");
  });

  /**
   * **The absence that must not be drawn as an answer.**
   *
   * `sharing` is optional and absent means *this store cannot say* — the
   * filesystem store has no column. Drawing that as "not shared" would tell an
   * owner their public document is private, and offer them a Share button for a
   * document that is already shared. It is also the state while the page's
   * fetch is in flight, and the card draws the same thing for both because
   * neither is a state in which it is safe to offer a switch.
   */
  it("refuses to guess when the store cannot say", async () => {
    await mount(undefined);

    expect(host.textContent).toContain("could not check");
    expect(host.textContent).not.toContain("Only you can read this");
    expect(host.querySelector("button")).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("turning it on", () => {
  it("will not publish until the owner confirms the rights", async () => {
    await mount(PRIVATE);
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
    await mount(PRIVATE);
    press("Share with anyone");

    expect(host.textContent).toContain("A piece");
    expect(host.textContent).toContain("anyone with the link can read it");
    expect(host.textContent).toContain("cannot take back a page");
  });

  it("sends rightsConfirmed: true, and believes the answer rather than the request", async () => {
    put = () => json({ visibility: "public", publicAt: "2026-08-28T11:00:00.000Z" });
    await mount(PRIVATE);
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await settle();

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
    await mount(PRIVATE);
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await settle();

    expect(host.textContent).toContain("Only you can read this");
  });
});

/**
 * **Three answers, and the middle one is a much stronger claim than the first.**
 *
 * *We could not tell*, *none were*, and *these were* are different facts, and
 * the only thing separating the first two is an absent field from an empty
 * array — the distinction `?? []` silently erases. That is why `personalised`
 * lives inside the `sharing` block: `[]` can only come from a store that
 * answered.
 */
describe("what the dialog says about the reader's profile", () => {
  const withKinds = (personalised: ArticleSharing["personalised"]): ArticleSharing => ({
    ...PRIVATE,
    personalised,
  });

  async function openDialog(sharing: ArticleSharing | undefined): Promise<void> {
    await mount(sharing);
    press("Share with anyone");
  }

  it("hedges when the store cannot say", async () => {
    /* The card shows "could not check" and offers no Share button when the
       whole block is absent, so the hedge is reached through a block that
       exists with the field somehow missing — defensive, and the branch has to
       be total. */
    await openDialog(withKinds(undefined as unknown as ArticleSharing["personalised"]));
    expect(host.textContent).toContain("may have been written for your reader profile");
  });

  it("says plainly when none were", async () => {
    await openDialog(withKinds([]));

    expect(host.textContent).toContain("Nothing here was written for your reader profile");
    // And NOT the hedge, which would leave the owner assuming the general case.
    expect(host.textContent).not.toContain("may have been written");
  });

  it("names them when some were", async () => {
    await openDialog(withKinds(["glossary", "summary"]));

    expect(host.textContent).toContain("your glossary and your summary");
    expect(host.textContent).not.toContain("may have been written");
    expect(host.textContent).not.toContain("Nothing here was written");
  });

  /**
   * One artefact and three need the same sentence, and the obvious construction
   * needs `was`/`were` and `it`/`them` picked apart by count. The phrasing makes
   * *the model* the subject of the second half so no agreement is needed — this
   * is the case that would have caught a version that did.
   */
  it("reads correctly for a single artefact", async () => {
    await openDialog(withKinds(["glossary"]));

    const text = host.textContent ?? "";
    expect(text).toContain("your glossary — written for your reader profile");
    expect(text).not.toContain("and your");
    // The half that survives in every state: the leak is what was left out.
    expect(text).toContain("leave out");
  });
});

describe("turning it off", () => {
  it("sends no rightsConfirmed at all", async () => {
    put = () => json({ visibility: "private", publicAt: null });
    await mount(SHARED);
    press("Stop sharing");
    await settle();

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
   *
   * **It has to beat the prop, not just the local state.** `sharing` still holds
   * what the page load said, which after a failed write is exactly the stale
   * answer that must not be drawn — so this would pass on a version that merely
   * cleared its own state and fell back.
   */
  it("stops claiming to know when the write fails", async () => {
    put = () => json({ error: "the database went away" }, 500);
    await mount(SHARED);
    press("Stop sharing");
    await settle();

    expect(host.textContent).toContain("could not check");
    expect(host.textContent).not.toContain("Anyone with the link can read this");
  });
});
