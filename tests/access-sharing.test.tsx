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
import type { ArticleSharing, PublicArtefacts } from "../src/types.js";
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

const { AccessSharing, asArticleSharing } = await import("../src/web/AccessSharing.js");

const SLUG = "a-piece";

/** Every request the card made. */
const calls: { url: string; method: string; body: unknown }[] = [];
/** How the `PUT` is answered. */
let put: () => Response;
/**
 * Replies are **held** when a test asks, so that *in flight* is a state the
 * test can see.
 *
 * The suite resolved instantly until 2026-08-28, which made "a slow publish
 * goes on drawing 'Only you can read this' with a live Share button under it"
 * invisible: the request went out and came back inside one `act`, so the wrong
 * state was real and unobservable. docs/reusable/silent-success.md.
 */
let held: (() => void)[] = [];
let hold = false;

function release(): void {
  const waiting = held;
  held = [];
  for (const go of waiting) go();
}

/* An article with a glossary and quotes and nothing else, so that the inventory
   under the switch has something in all three of its lists. */
const AVAILABLE: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: true,
  ideas: false,
  quotes: true,
};

const PRIVATE: ArticleSharing = {
  visibility: "private",
  publicAt: null,
  personalised: [],
  available: AVAILABLE,
};
const SHARED: ArticleSharing = {
  visibility: "public",
  publicAt: "2026-08-28T09:00:00.000Z",
  personalised: [],
  available: AVAILABLE,
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
  held = [];
  hold = false;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    /* Anything that is not the `PUT` is a request this card should not be
       making at all, and the first test asserts exactly that — so the reply is
       deliberately useless rather than plausible. */
    const answer = () => (method === "PUT" ? put() : json({}, 500));
    if (!hold) return Promise.resolve(answer());
    return new Promise<Response>((go) => held.push(() => go(answer())));
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
    await openDialog(withKinds(["glossary", "ideas"]));

    expect(host.textContent).toContain("your glossary and your list of ideas");
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

/**
 * **The inventory under the switch** — what a shared link carries, what would go
 * out if it existed, and what stays.
 *
 * `sharedInventory` is swept exhaustively in tests/shared-inventory.test.ts;
 * what is checked here is only that this card draws it, and the one thing that
 * card must never do — invent it.
 */
describe("the list of what goes out", () => {
  async function openDialog(sharing: ArticleSharing | undefined): Promise<void> {
    await mount(sharing);
    press("Share with anyone");
  }

  it("names the artefacts this piece actually has, before the owner presses Share", async () => {
    await openDialog(PRIVATE);
    const text = host.textContent ?? "";

    expect(text).toContain("Anyone with the link gets these");
    /* The fixture has a glossary and quotes and nothing else, so the same
       dialog has to put those two on one side and the four missing ones on the
       other. A list that named everything, or nothing, would pass an assertion
       that only looked at one side. */
    expect(text).toContain("Not built yet");
    expect(text).toContain("These stay with you");
    expect(text).toContain("Building one later, while the article is still shared, publishes it");
  });

  it("shows it on the card of an article that is already shared", async () => {
    /* The owner who comes back to check what is out there needs the same list
       as the owner who is about to publish. It was in the confirmation only,
       for one draft. */
    await mount(SHARED);
    expect(host.textContent).toContain("Anyone with the link gets these");
  });

  /**
   * **A body without the flags is still a body**, and the card keeps everything
   * that does not depend on them.
   *
   * This is the regression that made the field optional, 2026-09-02. Requiring
   * `available` had `asArticleSharing` reject the whole body over one field, so
   * an owner who could perfectly well be told who can read their article got
   * *"we could not check"* and nothing else. Through the parser, not just the
   * component, because the parser is where that bug lived and a prop-level test
   * stays green over it.
   */
  it("still reads the visibility when the store said nothing about the artefacts", async () => {
    const parsed = asArticleSharing({ visibility: "private", publicAt: null, personalised: [] });
    expect(parsed).toEqual({ visibility: "private", publicAt: null, personalised: [] });
    expect(parsed && "available" in parsed).toBe(false);

    await mount(parsed);
    const text = host.textContent ?? "";

    expect(text).toContain("Only you can read this");
    expect(text).not.toContain("We could not check");
    // And no list, rather than a list of five invented falses.
    expect(text).not.toContain("Anyone with the link gets these");
  });

  /**
   * **…but it does not offer to publish.**
   *
   * GPT Sol, 2026-09-02: keeping the card usable was right, and letting an owner
   * go through the confirmation while the inventory is silently missing defeats
   * the feature at exactly the moment it is failing. The asymmetry is the point
   * — see the next case.
   */
  it.each([
    ["said nothing at all", undefined],
    ["sent flags it could not read", { glossary: "yes" }],
  ])("refuses to offer sharing when the store %s", async (_name, available) => {
    /* **Through `asArticleSharing`, not as a prop.** The prop is typed
       `PublicArtefacts`, so a malformed one is already a compile error and a
       prop-level test would be checking TypeScript. The parser is the only
       place a real body's garbage can arrive, and dropping the field there is
       what has to reach the card. GPT Sol, 2026-09-02. */
    const parsed = asArticleSharing({
      visibility: "private",
      publicAt: null,
      personalised: [],
      ...(available ? { available } : {}),
    });
    expect(parsed && "available" in parsed).toBe(false);

    await mount(parsed);
    const text = host.textContent ?? "";

    expect(text).toContain("We could not work out what a shared link would carry");
    expect(text).not.toContain("Share with anyone who has the link");
    expect(text).not.toContain("Anyone with the link gets these");
  });

  /* **Unsharing is never blocked.** Taking an article back is the safe
     direction, and a card that could not do it would strand an owner over a
     field with nothing to do with visibility. */
  it("still lets an owner stop sharing without the inventory", async () => {
    const { available: _dropped, ...noFlags } = SHARED;
    await mount(noFlags);
    expect(host.textContent).toContain("Stop sharing");
    expect(host.textContent).not.toContain("Anyone with the link gets these");
  });
});

/**
 * **The three ways a write can end badly**, which were one state until GPT Sol
 * took them apart on 2026-08-28.
 *
 * The card must never tell an owner their article is private when it may be
 * public. Every one of these is a route to exactly that.
 */
describe("when a write does not come back cleanly", () => {
  it("says nothing certain while the write is still out", async () => {
    hold = true;
    await mount(PRIVATE);
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await settle();

    /* **Not "Only you can read this" with a live Share button**, which is what
       it drew for the whole length of the request before there was a pending
       state. */
    expect(host.textContent).toContain("Sharing this article");
    expect(host.textContent).not.toContain("Only you can read this");
    expect([...host.querySelectorAll("button")]).toEqual([]);

    release();
    await settle();
    expect(host.textContent).toContain("Anyone with the link can read this");
  });

  /**
   * **A second press has nothing to land on**, because the buttons are gone
   * rather than disabled. Sol asked for a double-click test; this is it, and
   * the assertion is on the request count because that is what a duplicate
   * costs.
   */
  it("cannot be fired twice by a double click", async () => {
    hold = true;
    await mount(PRIVATE);
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await settle();

    expect(() => press("Share it")).toThrow(/No button/);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  /**
   * **The sentence that was false.** A publish can commit and its response be
   * lost — the route writes and *then* reads back to build its reply — so
   * "whatever it was before is unchanged" told an owner their public article
   * was private.
   *
   * The suite tested only a failed *unpublish* before, where the old sentence
   * happened to be harmless. Sol named that gap by file and line.
   */
  it("admits a failed publish may have taken effect", async () => {
    put = () => json({ error: "the connection went away" }, 500);
    await mount(PRIVATE);
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await settle();

    expect(host.textContent).toContain("may have");
    expect(host.textContent).not.toContain("Nothing has been changed");
    expect(host.textContent).not.toContain("Only you can read this");
  });

  /**
   * And the two uncertainties say different things. *We never asked* may
   * promise nothing changed; *we asked and lost the answer* may not.
   */
  it("tells a check that never happened from a write that went missing", async () => {
    await mount(undefined);
    expect(host.textContent).toContain("Nothing has been changed");
    expect(host.textContent).not.toContain("may have");
  });

  /**
   * **A 2xx we cannot parse is the absence of an answer, not a quiet
   * `private`.** `readJson` validates nothing and returns `{}` for a 204, so
   * `visibility === "public"` came out `false` and the card drew "Only you can
   * read this" about a database nobody had read.
   */
  it.each([
    ["a 204 with no body", () => new Response(null, { status: 204 })],
    ["a 200 that is not the shape", () => json({ ok: true })],
    ["a 200 with a bad visibility", () => json({ visibility: "world", publicAt: null })],
    ["a 200 with a bad timestamp", () => json({ visibility: "public", publicAt: 17 })],
  ])("treats %s as unknown rather than as private", async (_name, reply) => {
    put = reply;
    await mount(PRIVATE);
    press("Share with anyone");
    tickTheBox();
    press("Share it");
    await settle();

    expect(host.textContent).toContain("may have");
    expect(host.textContent).not.toContain("Only you can read this");
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

    expect(host.textContent).toContain("may have");
    expect(host.textContent).not.toContain("Anyone with the link can read this");
  });
});

/**
 * **What a shared link carries is a fact about a shared link**, and the card
 * stated it in the present indicative directly under *"Only you can read
 * this."*
 *
 * Greg, 2026-09-03, on a private article's Access & Sharing card:
 *
 * > That's a fair description of what would be true IF it was Public-readable.
 * > But it's not.
 *
 * Two paragraphs contradicting each other on a skim, on the one control in this
 * app where a state that looks wrong matters most. Where a private article's
 * owner is told what publishing would do is the confirmation box, and it says
 * it as a list rather than as a sentence — src/web/shared-inventory.ts.
 */
describe("what a shared link carries", () => {
  it("says it on a shared article, where it is true", async () => {
    await mount(SHARED);

    expect(host.textContent).toContain("A shared link carries the article");
    /* The owner's second person. The visitor's copy of this sentence says
       "whoever added it" instead, and tests/public-metadata-page.test.tsx is
       what holds the two apart. */
    expect(host.textContent).toContain("your comments");
  });

  it("does not say it on a private one, where it is not", async () => {
    await mount(PRIVATE);

    expect(host.textContent).toContain("Only you can read this");
    /* **The list of aids, which is the clause both wordings share.** Asserting
       on the new sentence alone would have passed against the old one — the
       first draft of this test did, and green on a bug is worth less than no
       test at all. docs/reusable/silent-success.md. */
    expect(host.textContent).not.toContain("the summaries, the glossary, the ideas, the quotes");
    /* Not reworded into a conditional and left where it was, either: it
       describes a state this article is not in, and the owner's route to that
       state is the button, which opens the box that itemises the whole thing. */
    expect(host.textContent).not.toContain("carries the article");
  });
});
