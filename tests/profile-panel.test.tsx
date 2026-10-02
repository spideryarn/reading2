// @vitest-environment jsdom
/**
 * **The panel that says what you are being written for — and, since
 * 2026-10-02, lets you change it where you are.**
 *
 * > And if possible, allow them to edit the text inline (rather than having to
 * > click out to separate pages.
 * >
 * > — Greg, 2026-10-01, `[SPIDERYARN-READING2-7S]`
 *
 * The things a reader hits that no other test covers. Each was watched fail
 * first, against a mutation aimed at it or against the read-only panel this
 * replaced.
 *
 * Opened through the real *written for you* badge (`WrittenForYou`), which has
 * been the only way into it from a reading view since 2026-09-13, when the
 * *Use your profile* row beside every paid button — checkbox, and a *Your
 * profile* button — was removed on Greg's request
 * (docs/plans/260913a-drop-the-use-your-profile-checkbox.md). Until then these
 * tests went in through that row's button, which also served a reader with no
 * profile; the badge appears only on text that was written for one.
 *
 * Most of what follows is about **words not being lost**. The panel was kept
 * read-only on 2026-08-30 for exactly that reason — a popover can be dismissed
 * from under a box mid-sentence — and Greg's request reverses that decision on
 * the condition that the holes are closed rather than reopened.
 * docs/plans/261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md.
 *
 * ## What this file deliberately does NOT test
 *
 * **That the panel can be reached with a real pointer.** That is the whole
 * reason it is a popover, and jsdom cannot see it: it has no layout, so
 * `elementFromPoint` and `pointer-events` mean nothing here and every control
 * reports as reachable. That is not a gap in this file, it is *how the bug got
 * here* — the tooltip this replaces carried an unreachable "Edit your profile
 * →" since it was written, and any jsdom assertion about it would have passed
 * on every day of that. docs/reusable/silent-success.md. The reachability check
 * is a browser gate instead, at desktop width and at 390px
 * (docs/plans/261002b § Tests).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What `GET /api/reader?slug=` will answer, and whether it answers at all. */
const server: {
  profile: string | null;
  purpose: string | null;
  /** The whole request falls over. */
  fails: boolean;
  /** A 200 whose shelf half fell over — a different thing, and the sharper one. */
  purposeFailed: boolean;
  /** `apiFetch`'s offline answer: the cached body, as a 200 marked a copy. */
  offline: boolean;
} = { profile: null, purpose: null, fails: false, purposeFailed: false, offline: false };
/** Every GET the panel made, so "it fetches when opened" is checkable. */
const asked: string[] = [];

/**
 * Every PATCH, held until the test answers it — the whole of what "closes only
 * once the save has landed" can be tested against.
 */
const patches: Array<{
  url: string;
  body: Record<string, unknown>;
  answer(res: Response): void;
}> = [];
/** Each last-chance (`keepalive`) save, as `leavingFetch` was asked for it. */
const left: Array<{ url: string; body: unknown }> = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Promise<Response>((resolve) => {
          patches.push({ url: input, body, answer: resolve });
        });
      }
      asked.push(input);
      if (server.fails) throw new TypeError("Failed to fetch");
      return new Response(
        JSON.stringify({
          profile: server.profile,
          purpose: server.purpose,
          purposeFailed: server.purposeFailed,
          hasProfile: server.profile !== null || server.purpose !== null,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            ...(server.offline ? { "x-spideryarn-offline": "copy" } : {}),
          },
        },
      );
    },
    leavingFetch: (input: string, init?: RequestInit) => {
      left.push({ url: input, body: JSON.parse(String(init?.body)) });
    },
  };
});

/** The microphone, as far as the panel can see it: on, or not. */
const mic = { armed: false };
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: mic.armed, transcribing: false },
    readOnly: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

const { WrittenForYou } = await import("../src/web/WrittenForYou.js");

let host: HTMLDivElement;
let root: Root;

/** A mode's regenerate, recorded. */
interface Spy {
  run: Mock<() => void>;
  refresh: Mock<() => Promise<void>>;
  busy: boolean;
  consequence?: string;
}
const spy = (busy = false): Spy => ({
  run: vi.fn<() => void>(),
  refresh: vi.fn(async () => {}),
  busy,
});

/** The real badge, on text written for a profile — never the panel on its own,
 *  so every assertion below is about something a reader can get to. */
function render(opts: { changed?: boolean; regenerate?: Spy } = {}) {
  act(() => {
    root.render(
      createElement(WrittenForYou, {
        written: true,
        changed: opts.changed ?? false,
        slug: "some-article",
        regenerate: opts.regenerate,
      }),
    );
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open it the way a reader does, and let the fetch settle. */
async function open() {
  const trigger = host.querySelector<HTMLButtonElement>("button.prof-badge");
  if (!trigger) throw new Error("no way in to the profile panel");
  await act(async () => {
    trigger.click();
  });
  await settle();
  const panel = document.querySelector<HTMLElement>(".prof-panel");
  if (!panel) throw new Error("the panel did not open");
  return panel;
}

const panel = () => document.querySelector<HTMLElement>(".prof-panel");
const boxes = () => [...document.querySelectorAll<HTMLTextAreaElement>(".prof-panel textarea")];
function box(n: 0 | 1): HTMLTextAreaElement {
  const el = boxes()[n];
  if (!el) throw new Error(`no box ${n} in the panel`);
  return el;
}
function type(el: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** React listens for `focusout`, which is what a real blur sends up the tree. */
function blur(el: HTMLTextAreaElement): void {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}
async function pressOutside(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}
function button(name: RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(".prof-panel button")].find((b) =>
    name.test(b.textContent ?? ""),
  );
}
const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  server.profile = null;
  server.purpose = null;
  server.fails = false;
  server.purposeFailed = false;
  server.offline = false;
  asked.length = 0;
  patches.length = 0;
  left.length = 0;
  mic.armed = false;
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
     panel must offer two empty boxes to write in, not two empty headings and
     not a box seeded from something it failed to read. */
  it("offers both boxes empty when the reader has cleared them since", async () => {
    render({ changed: true });
    await open();
    expect(boxes().map((b) => b.value)).toEqual(["", ""]);
    expect(boxes().every((b) => !b.disabled)).toBe(true);
  });

  /* **The editors are here, and the ways out are not** (Sol). Each `Edit →`
     link was a way out of the panel that skipped the save, and the editing it
     led to is now in the panel itself. This replaces the test that the two
     links were there; it was watched fail against the read-only panel. */
  it("edits both halves in place, seeded with what the server holds, and links nowhere", async () => {
    server.profile = "A physicist.";
    server.purpose = "For the evidence.";
    render();
    const p = await open();
    expect(boxes().map((b) => b.value)).toEqual(["A physicist.", "For the evidence."]);
    expect(p.querySelectorAll("a")).toHaveLength(0);
  });

  /* Each half goes to its own owner: "about you" to `/api/reader`, the
     article's half to that article's shelf record. Crossing them would write
     one article's purpose into the reader's whole profile. */
  it("saves each half to its own endpoint when the reader leaves the box", async () => {
    server.profile = "A physicist.";
    render();
    await open();
    type(box(0), "A physicist, rusty on biology.");
    blur(box(0));
    type(box(1), "How big brains would think.");
    blur(box(1));
    expect(patches.map((x) => [x.url, x.body])).toEqual([
      ["/api/reader", { profile: "A physicist, rusty on biology." }],
      ["/api/library/some-article", { purpose: "How big brains would think." }],
    ]);
  });

  /* Three states, not two. A profile that could not be READ must never render
     as one that was never WRITTEN — and now that the panel edits, it must not
     be an empty box either: saving it would erase the paragraph we failed to
     read. */
  it("says it could not read a profile, and offers nothing to save over it", async () => {
    server.fails = true;
    render();
    const p = await open();
    expect(p.textContent).toContain("We couldn't read this just now");
    expect(p.textContent).not.toContain("haven't said anything about yourself");
    expect(boxes()).toHaveLength(0);
  });

  /* **And the sharper half of the same rule**, which the test above cannot
     see: the request succeeds, the global profile comes back intact, and only
     the shelf read behind "why you're reading this one" fell over. The server
     swallows that failure when it is building a prompt — right, because a job
     must not die over a purpose nobody may have written — so without a flag on
     the response the panel would offer an empty box over a sentence the reader
     wrote. GPT Sol's review of the built code, 2026-08-30. */
  it("tells the two halves apart when only the article's half could not be read", async () => {
    server.profile = "A physicist.";
    server.purposeFailed = true;
    render();
    const p = await open();
    // The half that worked can be edited…
    expect(boxes().map((b) => b.value)).toEqual(["A physicist."]);
    // …and the half that did not is not reported as empty, nor offered as a box.
    expect(p.textContent).toContain("We couldn't read this just now");
    expect(p.textContent).not.toContain("You haven't said why you're reading this one");
  });

  /* **An offline copy is not a read** (Sol). `apiFetch` answers a failed GET
     with the cached body as a 200 marked `x-spideryarn-offline: copy`. Edited,
     that copy would be PATCHed over whatever the reader has written since on
     another device, the moment the network came back. So it is shown, and
     said to be a copy, and not offered for editing. */
  it("shows an offline copy read-only, and says it is one", async () => {
    server.profile = "Last week's paragraph.";
    server.offline = true;
    render();
    const p = await open();
    expect(boxes()).toHaveLength(0);
    expect(p.textContent).toContain("Last week's paragraph.");
    expect(p.textContent).toMatch(/offline/i);
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
    expect(panel()).toBeNull();
    await open();
    expect(asked).toHaveLength(2);
  });

  /* **The dismissal this file was not watching.** `useDismiss(context)` is
     passed no options, and its defaults — read out of
     node_modules/@floating-ui/react on 2026-09-07, where they are written
     `outsidePress = true` and `outsidePressEvent = 'pointerdown'` — are what
     close this panel for a reader who has finished with it. Taking `useDismiss`
     out of `useInteractions` once left every other test in this file green.

     `pointerdown` rather than `click`, so the panel is gone before the press
     lands on whatever is underneath it — otherwise the paragraph behind it
     needs two presses. Same reason, same shape, as
     tests/block-gutter.test.tsx § "closes on a press anywhere else". */
  it("closes when the reader presses somewhere else on the page", async () => {
    render();
    await open();
    await pressOutside();
    expect(panel()).toBeNull();
  });

  /* The other half of that default, and the half that would make the panel
     pointless if it went the wrong way: this is a popover rather than a tooltip
     precisely so a reader can put a pointer *into* it and type. A press that
     lands inside must therefore not dismiss it. Floating UI answers this twice
     over — a React capture handler on the floating element and a native
     containment check — and what is pinned here is the behaviour, not either
     mechanism. */
  it("stays open when the press lands inside the panel itself", async () => {
    render();
    const p = await open();
    const inside = p.querySelector(".prof-panel-lede");
    if (!inside) throw new Error("the panel rendered without its lede");
    await act(async () => {
      inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(panel()).not.toBeNull();
  });
});

describe("dismissing it with words unsaved", () => {
  /* **Hazard 1 of the 2026-08-30 decision**: an outside press unmounts the
     box, so save-on-blur never fires and the sentence goes with it. Here the
     press saves instead, and the panel waits for the save to land — the *Done*
     latch PurposePrompt.tsx already uses. */
  it("saves on an outside press, and closes only once the save has landed", async () => {
    render();
    await open();
    type(box(0), "A physicist.");
    await pressOutside();
    expect(patches.map((x) => x.body)).toEqual([{ profile: "A physicist." }]);
    expect(panel(), "closed before the save had landed").not.toBeNull();
    await act(async () => patches[0]?.answer(ok({ profile: "A physicist." })));
    await settle();
    expect(panel()).toBeNull();
  });

  /* The latch lets go on a refusal rather than closing over it, so the reader
     sees the server's reason in the box's own status line with their words
     still in the box. */
  it("stays open over a refused save, and says why", async () => {
    render();
    await open();
    type(box(1), "Too long, say.");
    await pressOutside();
    await act(async () =>
      patches[0]?.answer(
        new Response(JSON.stringify({ error: "That is longer than 600 characters." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await settle();
    expect(panel(), "a refused save was closed over").not.toBeNull();
    expect(panel()?.textContent).toContain("longer than 600 characters");
    expect(box(1).value).toBe("Too long, say.");
  });

  it("does not retry a refused save on every outside press, and offers an explicit escape", async () => {
    render();
    await open();
    type(box(1), "Words the server cannot save.");
    await pressOutside();
    await act(async () =>
      patches[0]?.answer(
        new Response(JSON.stringify({ error: "The server is unavailable." }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await settle();

    await pressOutside();
    expect(patches, "outside press retried a persistent failure").toHaveLength(1);
    expect(box(1).value).toBe("Words the server cannot save.");

    const close = button(/close without saving/i);
    if (!close) throw new Error("no explicit way out after a refused save");
    await act(async () => close.click());
    expect(panel()).toBeNull();
    expect(left, "the explicit escape retried through the unmount flush").toEqual([]);
  });

  /* The explicit way out, with the same promise. */
  it("Done saves and closes once both halves are clean", async () => {
    render();
    await open();
    type(box(0), "A physicist.");
    const done = button(/^Done$/);
    if (!done) throw new Error("no Done button");
    await act(async () => done.click());
    expect(panel()).not.toBeNull();
    await act(async () => patches[0]?.answer(ok({ profile: "A physicist." })));
    await settle();
    expect(panel()).toBeNull();
  });

  /* **Hazard 2**: dictation's unmount aborts, so dismissing the panel
     mid-dictation would throw the spoken words away. While the microphone is
     on, or its words are still on their way, the panel does not dismiss. */
  it("does not dismiss while a dictation is running", async () => {
    render();
    await open();
    mic.armed = true;
    // Any render lets the box tell the panel it is busy.
    render();
    await pressOutside();
    expect(panel(), "dismissed mid-dictation").not.toBeNull();
    mic.armed = false;
    render();
    await pressOutside();
    expect(panel()).toBeNull();
  });

  /* **Hazard 3** (Sol): the band can unmount the panel whatever it thinks —
     a mode switch from the dock, a different article. That fires neither
     `visibilitychange` nor `pagehide`, so the words go out as the last-chance
     `keepalive` PATCH instead. tests/autosaved-text.test.tsx pins the hook's
     half; this pins that the panel's boxes are wired to it. */
  it("sends the unsaved words when the whole thing is unmounted under it", async () => {
    render();
    await open();
    type(box(1), "Half a sentence");
    act(() => root.render(null));
    expect(left).toEqual([{ url: "/api/library/some-article", body: { purpose: "Half a sentence" } }]);
  });
});

describe("Regenerate", () => {
  /* **Only when the server says the profile changed** (Sol). Not on "a save
     happened here": an edit reverted, or whitespace the server trims, would
     offer a paid call for text that is still current. */
  it("is not offered when the text is current", async () => {
    const r = spy();
    render({ changed: false, regenerate: r });
    await open();
    expect(button(/regenerate/i)).toBeUndefined();
  });

  it("is offered when the profile has changed, and pressing it runs and closes", async () => {
    const r = spy();
    render({ changed: true, regenerate: r });
    await open();
    const b = button(/regenerate/i);
    if (!b) throw new Error("no Regenerate for a changed profile");
    expect(b.disabled).toBe(false);
    await act(async () => b.click());
    expect(r.run).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  /* Plan 261002f: Quiz's regenerate throws away the answers given so far, and
     the reader is told before pressing — in words on the panel, not a native
     tooltip a touch screen never shows. */
  it("says what pressing it costs, when the mode says there is a cost", async () => {
    const r = { ...spy(), consequence: "Your answers so far are cleared." };
    render({ changed: true, regenerate: r });
    await open();
    expect(panel()?.textContent).toContain("Your answers so far are cleared.");
  });

  it("says nothing extra when the mode names no cost", async () => {
    render({ changed: true, regenerate: spy() });
    await open();
    expect(panel()?.textContent).not.toMatch(/cleared/);
  });

  /* A regenerate started before the new profile has landed would be written
     for the old one and then stamped as current — the badge would stop saying
     *changed* about text that was never written for the new words. */
  it("is held while a save is in flight", async () => {
    const r = spy();
    render({ changed: true, regenerate: r });
    await open();
    type(box(0), "A physicist.");
    blur(box(0));
    expect(button(/regenerate/i)?.disabled).toBe(true);
    await act(async () => patches[0]?.answer(ok({ profile: "A physicist." })));
    await settle();
    expect(button(/regenerate/i)?.disabled).toBe(false);
  });

  /* A job already running is the mode's own progress row's business; a second
     press would queue a second paid call. */
  it("is held while the mode's own job is running", async () => {
    render({ changed: true, regenerate: spy(true) });
    await open();
    expect(button(/regenerate/i)?.disabled).toBe(true);
  });

  /* **How it learns the profile changed**: the mode re-reads and the server's
     hash comparison decides. No client-side hashing — so after a save from
     the panel has settled, the panel asks the mode to read again, once. */
  it("asks the mode to read again once a save from the panel has landed", async () => {
    const r = spy();
    render({ changed: false, regenerate: r });
    await open();
    type(box(0), "A physicist.");
    blur(box(0));
    expect(r.refresh).not.toHaveBeenCalled();
    await act(async () => patches[0]?.answer(ok({ profile: "A physicist." })));
    await settle();
    expect(r.refresh).toHaveBeenCalledTimes(1);
  });

  it("holds Regenerate until the post-save profile verdict has arrived", async () => {
    let finishRefresh: (() => void) | undefined;
    const r = spy();
    r.refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    render({ changed: true, regenerate: r });
    await open();
    type(box(0), "A changed profile.");
    blur(box(0));
    await act(async () => patches[0]?.answer(ok({ profile: "A changed profile." })));
    await settle();

    expect(r.refresh).toHaveBeenCalledTimes(1);
    expect(button(/regenerate/i)?.disabled, "enabled against the pre-refresh verdict").toBe(true);

    await act(async () => finishRefresh?.());
    await settle();
    expect(button(/regenerate/i)?.disabled).toBe(false);
  });

  /* The shared staleness rule deliberately says that clearing a profile is not
     a reason to spend money removing personalisation from old text. The old
     `changed` prop must not leave a pressable button in the gap before that
     refreshed verdict replaces it. */
  it("removes Regenerate when clearing the profile makes the refreshed verdict current", async () => {
    server.profile = "A physicist.";
    const r = spy();
    r.refresh = vi.fn(async () => {
      render({ changed: false, regenerate: r });
    });
    render({ changed: true, regenerate: r });
    await open();
    type(box(0), "");
    blur(box(0));
    await act(async () => patches[0]?.answer(ok({ profile: null })));
    await settle();

    expect(r.refresh).toHaveBeenCalledTimes(1);
    expect(button(/regenerate/i)).toBeUndefined();
    expect(r.run).not.toHaveBeenCalled();
  });
});

describe("more than one personalised badge on a page", () => {
  it("never leaves two profile panels open at once", async () => {
    act(() => {
      root.render(
        createElement(
          "div",
          null,
          createElement(WrittenForYou, { written: true, changed: false, slug: "first" }),
          createElement(WrittenForYou, { written: true, changed: false, slug: "second" }),
        ),
      );
    });
    const triggers = [...host.querySelectorAll<HTMLButtonElement>("button.prof-badge")];
    await act(async () => triggers[0]?.click());
    await settle();
    expect(document.querySelectorAll(".prof-panel")).toHaveLength(1);

    await act(async () => triggers[1]?.click());
    await settle();
    expect(document.querySelectorAll(".prof-panel")).toHaveLength(1);
  });
});
