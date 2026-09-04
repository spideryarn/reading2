// @vitest-environment jsdom
/**
 * **A switch that says it is on had better be on.**
 *
 * The experimental-features control is one checkbox, and every way it can lie
 * is a way a reader ends up disagreeing with the app about what they should be
 * seeing:
 *
 *  - **It ticks itself before the server has answered.** Then a reader who is
 *    *on* opens `/profile`, sees "off", and the first thing they touch sends an
 *    "off" that was never their decision. So the box is disabled until the
 *    answer lands, and this file checks the disabled state rather than only the
 *    tick.
 *  - **A failed save leaves the tick where the reader put it.** Every gated
 *    feature then disagrees with the switch that claims to control them, and
 *    nothing on screen says so. docs/reusable/silent-success.md.
 *
 * docs/project/experimental-features.md. The store and the route are covered by
 * tests/store-reader-parity.test.ts and tests/routes.test.ts; this is the half
 * a reader touches. The client-side store the switch now reads — and what it
 * does across a sign-in, a sign-out and an account switch — is
 * tests/experimental-store.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What `readJson` answers with, and what each PATCH carried. */
let answer: () => Promise<unknown>;
let patched: unknown[] = [];
/** Headers the next `apiFetch` should answer with — the offline copy marker. */
let headers: Record<string, string> = {};
/**
 * Held PATCHes, when a test wants two of them in flight at once.
 *
 * `null` means "resolve immediately", which is what every other test wants.
 * When it is a list, each PATCH parks a resolver here and the test decides the
 * order they come back in — the only way to write the race that a real network
 * produces and a straight-line mock cannot.
 */
let held: (() => void)[] | null = null;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (_url: string, init?: RequestInit) => {
    const res = new Response(null, { status: 200, headers });
    if (init?.method !== "PATCH") return Promise.resolve(res);
    patched.push(JSON.parse(String(init.body)));
    if (!held) return Promise.resolve(res);
    return new Promise<Response>((resolve) => held?.push(() => resolve(res)));
  },
  readJson: () => answer(),
}));

/**
 * **The store's own auth listener**, so this file can be the SDK.
 *
 * Since 2026-09-03 the store subscribes to `onAuthStateChange` itself rather
 * than being told by an effect in `App.tsx` — the effect ran a frame after its
 * children had rendered, which on an account switch is one frame of the last
 * reader's setting drawn for the next one. tests/experimental-store.test.tsx is
 * where that lifecycle is covered; here it is only how a session gets posed.
 */
const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

const { SettingsSection } = await import("../src/web/SettingsSection.js");
const { resetForTests, snapshot, subscribe } = await import("../src/web/experimental-store.js");

/* The store starts listening on the first `subscribe()`, which in the app is
   the first component mounting. Standing in for it here means a session can be
   posed *before* anything renders, which `paint` below needs. */
subscribe(() => {});

let host: HTMLDivElement;
let root: Root;

const box = (): HTMLInputElement => host.querySelector("input[type=checkbox]") as HTMLInputElement;
const said = (): string => host.textContent ?? "";

/**
 * The retry button, **by the words on it rather than by a class name.**
 *
 * This was `host.querySelector("button.linky")` until 2026-09-04, and the class
 * it selected on was styling **nothing**: `.linky` is scoped in styles.css to
 * `.controls`, `.cmt-dialog`, `.chat-dialog` and `.annotate-dialog`, and this
 * page is in none of them, so the button rendered as bare text with no
 * underline (tests/linky-is-scoped.test.ts).
 *
 * That is worth a sentence, because this file is part of why nobody noticed:
 * the class had a second job as a **test hook**, so it looked used and load-
 * bearing while doing nothing a reader could see. A selector that names the
 * thing a reader looks for survives the styling changing underneath it.
 *
 * **`null` rather than a throw, and that is load-bearing**: one test below ends
 * by asserting the button is *gone* once a save lands, because a successful
 * save means there is nothing left to retry. A helper that threw on absence
 * would turn that assertion into an error.
 */
function tryAgain(): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll("button")].find((b) =>
      /Try again|Check again/.test(b.textContent ?? ""),
    ) ?? null
  );
}

function paint(): void {
  /* **The session starts the load, not the mount.** Since 2026-09-03 the answer
     lives in one module-level store and a component only subscribes to it
     (src/web/experimental-store.ts), so a test that never says who is reading
     gets a switch that is permanently un-loaded — which is correct, and is what
     a signed-out reader sees.

     Announced here rather than in `beforeEach` for a reason worth keeping: the
     GET resolves on a microtask, and vitest awaits between hooks and the test
     body. Announcing in `beforeEach` would let the answer land before the first
     render, and "cannot be touched until the server has said what it is" would
     pass without ever having been in the state it is about. */
  for (const fn of authListeners) fn("SIGNED_IN", { user: { id: "reader-under-test" } });
  act(() => {
    root.render(createElement(SettingsSection));
  });
}

/** Let the fetch and its `.then` chain settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  patched = [];
  headers = {};
  held = null;
  answer = () => Promise.resolve({ experimentalSince: null });
  /* The store is a module singleton, so it keeps whatever the last test
     announced. Without this, a test inherits the previous one's session and the
     failure looks like a bug in the code rather than in the harness. */
  resetForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetForTests();
});

describe("the experimental-features switch", () => {
  it("cannot be touched until the server has said what it is", () => {
    paint();
    // Before `settle()`: the answer has not arrived.
    expect(box().disabled).toBe(true);
    expect(said()).toContain("Loading…");
  });

  it("is off, and says so, for a reader who has never switched it on", async () => {
    paint();
    await settle();
    expect(box().disabled).toBe(false);
    expect(box().checked).toBe(false);
    expect(said()).toContain("Off.");
  });

  it("is on when the server sends a date, and says since when", async () => {
    answer = () => Promise.resolve({ experimentalSince: new Date().toISOString() });
    paint();
    await settle();
    expect(box().checked).toBe(true);
    expect(said()).toContain("On");
  });

  it("sends a boolean, not the date it is displaying", async () => {
    paint();
    await settle();
    answer = () => Promise.resolve({ experimentalSince: "2026-08-31T10:00:00.000Z" });
    await act(async () => {
      box().click();
    });
    await settle();
    /* The wire takes `{ experimental: true }` — the client says what it wants,
       and the *server* decides what the date is. A client that could name the
       date could move a value whose whole job is to stay put. */
    expect(patched).toEqual([{ experimental: true }]);
    expect(box().checked).toBe(true);
  });

  it("will not start a second save while one is in flight", async () => {
    /* **The race this closes**, from GPT Sol's review of the built code,
       2026-08-31: two PATCHes are two requests, and the server applies them in
       whichever order they arrive. Ordering the *responses* cannot help — the
       damage is already stored. So the second click sends nothing, and the
       switch cannot end up showing the opposite of what is in the database.
       experimental-store.ts § one write at a time. */
    paint();
    await settle();
    held = [];
    await act(async () => {
      box().click();
    });
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);

    /* The click a reader can still make — a `disabled` attribute is a UI
       convention, and this asserts the guard underneath it. */
    await act(async () => {
      box().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(patched).toEqual([{ experimental: true }]);

    answer = () => Promise.resolve({ experimentalSince: "2026-08-31T10:00:00.000Z" });
    await act(async () => {
      held?.[0]?.();
    });
    await settle();
    expect(box().disabled).toBe(false);
    expect(patched).toEqual([{ experimental: true }]);
  });

  it("treats a reply that never mentions the switch as an error, not an off", async () => {
    /* `?? null` used to turn this into a confident "off" — the variable-shape
       defect the route refuses to commit, committed by the client instead. */
    paint();
    await settle();
    answer = () => Promise.resolve({ profile: "A physicist." });
    await act(async () => {
      box().click();
    });
    await settle();
    expect(said()).toContain("Not saved");
    expect(box().checked).toBe(false);
  });

  it("says a failed LOAD failed to load, and offers another go", async () => {
    /* Not "Not saved", which is a sentence about a save nobody attempted — and
       which left the reader with a dead control and nothing to press. */
    answer = () => Promise.reject(new Error("offline"));
    paint();
    await settle();
    expect(said()).toContain("Couldn't load");
    expect(box().disabled).toBe(true);

    answer = () => Promise.resolve({ experimentalSince: null });
    const retry = tryAgain();
    if (!retry) throw new Error(`No Try again button to press — the page reads: ${said()}`);
    await act(async () => {
      retry.click();
    });
    await settle();
    expect(box().disabled).toBe(false);
    expect(said()).toContain("Off.");
  });

  it("takes Try again away while a save is in flight, rather than ignoring it", async () => {
    /* **Both states at once is reachable**, and it is the one place the retry
       button can be pressed for nothing: a failed load leaves `loadError` set,
       and `set` is guarded by the store rather than by the `disabled`
       attribute, so a keyboard or a label click still starts a save. `reload()`
       refuses while a save is in flight — a read begun then carries the value
       the row held before the `PATCH` and can land after it — so an enabled
       button here would do nothing at all and say nothing about it.
       docs/reusable/silent-success.md. */
    answer = () => Promise.reject(new Error("offline"));
    paint();
    await settle();
    const retry = tryAgain;
    expect(said()).toContain("Couldn't load");
    expect(retry()?.disabled).toBe(false);

    held = [];
    answer = () => Promise.resolve({ experimentalSince: null });
    act(() => {
      /* The press a `disabled` checkbox does not stop. */
      box().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      snapshot().set(true);
    });
    expect(patched).toEqual([{ experimental: true }]);
    expect(retry()?.disabled).toBe(true);

    /* And once the save lands the button is **gone**, not merely enabled
       again: a successful save is a current answer from the server, so the load
       failure is over and there is nothing left to retry. It used to survive —
       `loaded` was set without clearing `loadError` — leaving the row
       apologising for a read nothing was waiting on, beside the value it had
       just been given. tests/experimental-store.test.tsx § a save that succeeds
       after a load that failed. */
    await act(async () => held?.[0]?.());
    await settle();
    expect(said()).not.toContain("Couldn't load");
    expect(retry(), "nothing left to try again").toBe(null);
  });

  it("will not let an offline copy be written over", async () => {
    /* The cached body is worth showing and must not be worth acting on: another
       device may have changed this since, and "off" next to a live-looking
       control is how a reader turns off something that was never on in front of
       them. lib/api.ts sets the header. */
    headers = { "x-spideryarn-offline": "copy" };
    answer = () => Promise.resolve({ experimentalSince: null });
    paint();
    await settle();
    expect(box().disabled).toBe(true);
    expect(said()).toContain("Offline");
  });

  it("springs back and says so when the save fails", async () => {
    paint();
    await settle();
    answer = () => Promise.reject(new Error("the server said no"));
    await act(async () => {
      box().click();
    });
    await settle();
    /* Back where it was, *and* a sentence — either one alone is a lie: a switch
       that stays put claims a save that never happened, and one that springs
       back without a word reads as the click having missed. */
    expect(box().checked).toBe(false);
    expect(said()).toContain("Not saved");
    expect(said()).toContain("the server said no");
  });
});
