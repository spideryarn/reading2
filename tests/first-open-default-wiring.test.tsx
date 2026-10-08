// @vitest-environment jsdom
/**
 * **The first-open default, through the hook that applies it.**
 *
 * tests/last-view.test.ts pins the three pure functions; this is the part they
 * cannot see — `useLastView`'s two layout effects: that the claim and the
 * default meet, that the default does not wait for the settings store's
 * answer (since 2026-10-08), and that it is applied once. src/web/last-view.ts § The first-open default;
 * docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md.
 *
 * jsdom lays nothing out, so the window is its default 1024px wide: room for
 * Summary and for the notes. The widths themselves are the other file's.
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the experimental store says. Re-posed by each case. */
const setting = { on: false, loaded: false, signedIn: false };

vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({ ...setting }),
}));

const { lastViewKey, legacyLastViewKey, useLastView } = await import("../src/web/last-view.js");
const { navigate, parseRoute } = await import("../src/web/router.js");

/** Two readers who share one browser profile. */
const A = "1a1a1a1a-1111-4111-8111-000000000001";
const B = "2b2b2b2b-2222-4222-8222-000000000001";
const KEY = lastViewKey("x", A);

function Page({ slug, readerId = A }: { slug: string; readerId?: string | null }) {
  const route = parseRoute(location.pathname);
  useLastView(slug, route.kind === "read" ? route.view : "article", readerId);
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(setting, { on: false, loaded: false, signedIn: false });
  /* This suite's jsdom has no `localStorage` (which is also why the tests that
     boot the whole app never meet the default: an unreadable storage means
     none). A map is enough of one. */
  const held = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
    },
  });
  history.replaceState(null, "", "/read/x");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const open = () => act(() => root.render(<Page slug="x" />));

describe("opening an article this browser has no key for", () => {
  it("applies the default once under StrictMode and does not reapply on a switch change", () => {
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    act(() => root.render(<StrictMode><Page slug="x" /></StrictMode>));
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    history.replaceState(null, "", "/read/x");
    setting.on = false;
    act(() => root.render(<StrictMode><Page slug="x" /></StrictMode>));
    expect(location.search).toBe("");
  });

  it("claims each new slug, and leaves the previous one's key as that one left it", () => {
    open();
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    history.replaceState(null, "", "/read/y");
    act(() => root.render(<Page slug="y" />));
    expect(location.pathname + location.search).toBe("/read/y?mode=chat&guide=1&margin=1");
    expect(window.localStorage.getItem(KEY)).toBe("?margin=1");
  });

  it("arrives in the guide with the notes, for a reader whose switch is on", () => {
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.pathname + location.search).toBe("/read/x?mode=chat&guide=1&margin=1");
  });

  it("arrives in the guide with the notes when the switch is off too", () => {
    /* Summary alone until 2026-10-05, when Marginalia left the switch
       (docs/plans/261005d-marginalia-out-of-the-experimental-switch.md). */
    Object.assign(setting, { on: false, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("does not wait for the settings store: a read that never answers still lands in the default", () => {
    /* CR3 of docs/plans/261007p-code-review-sol.md: an unmarked first open
       waited for the store's `loaded`, so a failed or offline settings read
       left the arrival in Plain for good. Signed-in status is the reader id's
       (App hands this hook a null slug until the session is known). */
    Object.assign(setting, { loaded: false, signedIn: false });
    open();
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("is applied once: the settings store answering later does not apply it again", () => {
    open();
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    history.replaceState(null, "", "/read/x?at=spya-aaaaaa");
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("?at=spya-aaaaaa");
  });

  it("gives a signed-out reader the article alone", () => {
    Object.assign(setting, { loaded: true, signedIn: false });
    act(() => root.render(<Page slug="x" readerId={null} />));
    expect(location.search).toBe("");
  });

  it("leaves a link that says anything exactly as sent", () => {
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    history.replaceState(null, "", "/read/x?at=spya-aaaaaa");
    open();
    expect(location.search).toBe("?at=spya-aaaaaa");
  });
});

describe("opening one it has seen", () => {
  it.each([false, true])("a metadata visit does not use up the article's first open (remount: %s)", (remount) => {
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    history.replaceState(null, "", "/read/x/metadata");
    open();
    expect(location.search).toBe("");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    if (remount) {
      act(() => root.unmount());
      root = createRoot(host);
    }
    navigate("/read/x");
    open();
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("keeps the existing restoration on metadata and does not restore again on a view change", () => {
    window.localStorage.setItem(KEY, "?mode=quotes");
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    history.replaceState(null, "", "/read/x/metadata");
    open();
    expect(location.search).toBe("?mode=quotes");
    navigate("/read/x");
    open();
    expect(location.search).toBe("");
  });

  it("does not apply a pending article default after switching to metadata", () => {
    Object.assign(setting, { signedIn: true });
    open();
    navigate("/read/x/metadata");
    open();
    Object.assign(setting, { loaded: true, on: true });
    open();
    expect(location.search).toBe("");
    navigate("/read/x");
    open();
    // The initial article arrival already wrote its marker; this is a later open.
    expect(location.search).toBe("");
  });

  it("stays Plain when Plain is what was left", () => {
    window.localStorage.setItem(KEY, "");
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("");
  });

  it("puts a remembered view back, and no default over it", () => {
    window.localStorage.setItem(KEY, "?mode=quotes");
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("?mode=quotes");
  });

  it("a signed-out visit is nobody's: it does not use up the first open of the reader who then signs in", () => {
    /* Until 2026-10-06 it did, because the key had no reader in it. A place
       is its reader's now, and so is a first open (plan 261006h). */
    Object.assign(setting, { loaded: true, signedIn: false });
    act(() => root.render(<Page slug="x" readerId={null} />));
    expect(location.search).toBe("");
    expect(window.localStorage.getItem(lastViewKey("x", null)), "control: the visit was recorded").toBe("");
    act(() => root.unmount());
    root = createRoot(host);
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("and a second signed-out visit is not a first open again", () => {
    Object.assign(setting, { loaded: true, signedIn: false });
    act(() => root.render(<Page slug="x" readerId={null} />));
    act(() => root.unmount());
    root = createRoot(host);
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    act(() => root.render(<Page slug="x" readerId={null} />));
    expect(location.search).toBe("");
  });

  it("a key from before 2026-10-06 is the first signed-in reader's: restored, and then gone", () => {
    window.localStorage.setItem(legacyLastViewKey("x"), "?mode=quotes");
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("?mode=quotes");
    expect(window.localStorage.getItem(legacyLastViewKey("x"))).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe("?mode=quotes");
    act(() => root.unmount());
    root = createRoot(host);
    history.replaceState(null, "", "/read/x");
    act(() => root.render(<Page slug="x" readerId={B} />));
    expect(location.search, "the next reader gets the default, not the first one's view").toBe("?mode=chat&guide=1&margin=1");
  });
});
