// @vitest-environment jsdom
/**
 * **The panel that says what you are being written for.**
 *
 * The things a reader hits that no other test covers. Each was watched fail
 * first, against a mutation aimed at it.
 *
 * Opened through the real *written for you* badge (`WrittenForYou`), which has
 * been the only way into it from a reading view since 2026-09-13, when the
 * *Use your profile* row beside every paid button — checkbox, and a *Your
 * profile* button — was removed on Greg's request
 * (docs/plans/260913a-drop-the-use-your-profile-checkbox.md). Until then these
 * tests went in through that row's button, which also served a reader with no
 * profile; the badge appears only on text that was written for one.
 *
 * ## What this file deliberately does NOT test
 *
 * **That the two `Edit →` links can be clicked.** That is the whole reason the
 * panel exists, and jsdom cannot see it: it has no layout, so
 * `elementFromPoint` and `pointer-events` mean nothing here and every link
 * reports as reachable. That is not a gap in this file, it is *how the bug got
 * here* — the tooltip this replaces has carried an unreachable
 * "Edit your profile →" since it was written, and any jsdom assertion about it
 * would have passed on every day of that. docs/reusable/silent-success.md.
 *
 * The reachability check is a browser gate instead, run against a real Chrome
 * with real pointer events, and it has been seen to *fail* — against the
 * tooltip version, where `document.elementFromPoint` at the link's centre
 * returns the page behind it while a control link on the same page returns
 * itself. docs/plans/260830c-profile-panel.md § Tests.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What `GET /api/reader?slug=` will answer, and whether it answers at all. */
const server: {
  profile: string | null;
  purpose: string | null;
  /** The whole request falls over. */
  fails: boolean;
  /** A 200 whose shelf half fell over — a different thing, and the sharper one. */
  purposeFailed: boolean;
} = { profile: null, purpose: null, fails: false, purposeFailed: false };
/** Every URL the panel asked for, so "it fetches when opened" is checkable. */
const asked: string[] = [];

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string) => {
    asked.push(input);
    if (server.fails) throw new TypeError("Failed to fetch");
    return new Response(
      JSON.stringify({
        profile: server.profile,
        purpose: server.purpose,
        purposeFailed: server.purposeFailed,
        hasProfile: server.profile !== null || server.purpose !== null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },
  leavingFetch: async () => undefined,
  readJson: async (res: Response) => res.json(),
}));

const { WrittenForYou } = await import("../src/web/WrittenForYou.js");

let host: HTMLDivElement;
let root: Root;

/** The real badge, on text written for a profile — never the panel on its own,
 *  so every assertion below is about something a reader can get to. */
function render(opts: { changed?: boolean } = {}) {
  act(() => {
    root.render(
      createElement(WrittenForYou, {
        written: true,
        changed: opts.changed ?? false,
        slug: "some-article",
      }),
    );
  });
}

/** Open it the way a reader does, and let the fetch settle. */
async function open() {
  const trigger = host.querySelector<HTMLButtonElement>("button.prof-badge");
  if (!trigger) throw new Error("no way in to the profile panel");
  await act(async () => {
    trigger.click();
  });
  // The fetch resolves a microtask later; the panel is mounted by then but its
  // contents are still the loading state.
  await act(async () => {
    await Promise.resolve();
  });
  const panel = document.querySelector<HTMLElement>(".prof-panel");
  if (!panel) throw new Error("the panel did not open");
  return panel;
}

beforeEach(() => {
  server.profile = null;
  server.purpose = null;
  server.fails = false;
  server.purposeFailed = false;
  asked.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the profile panel", () => {
  /* The badge is provenance about the text, and it goes on describing an
     artefact written for a profile the reader has since cleared — so the
     panel must say plainly that there is nothing in either box now, rather than
     showing two empty headings. */
  it("says both boxes are empty when the reader has cleared them since", async () => {
    render({ changed: true });
    const panel = await open();
    expect(panel.textContent).toContain("You haven't said anything about yourself yet");
    expect(panel.textContent).toContain("You haven't said why you're reading this one");
  });

  /* Two links, to the two pages that own the two boxes. The per-article one
     must carry the slug: a link to somebody else's metadata page, or to none,
     is worse than no link. */
  it("links to both halves, and the article's link names the article", async () => {
    render();
    const panel = await open();
    const hrefs = [...panel.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/profile");
    expect(hrefs.some((h) => h?.startsWith("/read/some-article/metadata"))).toBe(true);
  });

  /* Three states, not two. A profile that could not be READ must never render
     as one that was never WRITTEN: a reader told "you haven't said anything
     about yourself yet" about the paragraph they wrote last week will go and
     write it again, and nothing on screen will have looked wrong. */
  it("says it could not read a profile, rather than that there is none", async () => {
    server.fails = true;
    render();
    const panel = await open();
    expect(panel.textContent).toContain("We couldn't read this just now");
    expect(panel.textContent).not.toContain("haven't said anything about yourself");
  });

  /* **And the sharper half of the same rule**, which the test above cannot
     see: the request succeeds, the global profile comes back intact, and only
     the shelf read behind "why you're reading this one" fell over. The server
     swallows that failure when it is building a prompt — right, because a job
     must not die over a purpose nobody may have written — so without a flag on
     the response the panel says "you haven't said why you're reading this one"
     to somebody who has. GPT Sol's review of the built code, 2026-08-30. */
  it("tells the two halves apart when only the article's half could not be read", async () => {
    server.profile = "A physicist.";
    server.purposeFailed = true;
    render();
    const panel = await open();
    // The half that worked still says what it says…
    expect(panel.textContent).toContain("A physicist.");
    // …and the half that did not is not reported as empty.
    expect(panel.textContent).toContain("We couldn't read this just now");
    expect(panel.textContent).not.toContain("You haven't said why you're reading this one");
  });

  /* Not a cache and not a page-load fetch: the text is wanted by one component
     that is usually closed. Asking on open is also what keeps it fresh — a
     reader who edits their profile on /profile and comes back must not be
     shown the old words by the panel whose job is to say what the current ones
     are. */
  it("asks for nothing until it is opened, and asks again next time", async () => {
    server.profile = "A physicist.";
    render();
    expect(asked).toEqual([]);

    await open();
    expect(asked).toEqual(["/api/reader?slug=some-article"]);

    // Escape, then open again: a second request, not a remembered answer.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".prof-panel")).toBeNull();
    await open();
    expect(asked).toHaveLength(2);
  });

  /* **The dismissal this file was not watching.** `useDismiss(context)` is
     passed no options, and its defaults — read out of
     node_modules/@floating-ui/react on 2026-09-07, where they are written
     `outsidePress = true` and `outsidePressEvent = 'pointerdown'` — are what
     close this panel for a reader who has finished with it. Until now the only
     dismissal any test here dispatched was Escape, so the whole outside-press
     default was unpinned: taking `useDismiss` out of `useInteractions` left
     every other test in this file green.

     `pointerdown` rather than `click`, so the panel is gone before the press
     lands on whatever is underneath it — otherwise the paragraph behind it
     needs two presses. Same reason, same shape, as
     tests/block-gutter.test.tsx § "closes on a press anywhere else". */
  it("closes when the reader presses somewhere else on the page", async () => {
    render();
    await open();
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector(".prof-panel")).toBeNull();
  });

  /* The other half of that default, and the half that would make the panel
     pointless if it went the wrong way: this is a popover rather than a tooltip
     precisely so a reader can put a pointer *into* it and press one of the two
     `Edit →` links. A press that lands inside must therefore not dismiss it.
     Floating UI answers this twice over — a React capture handler on the
     floating element and a native containment check — and what is pinned here
     is the behaviour, not either mechanism. */
  it("stays open when the press lands inside the panel itself", async () => {
    render();
    const panel = await open();
    const inside = panel.querySelector(".prof-panel-lede");
    if (!inside) throw new Error("the panel rendered without its lede");
    await act(async () => {
      inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector(".prof-panel")).not.toBeNull();
  });
});
