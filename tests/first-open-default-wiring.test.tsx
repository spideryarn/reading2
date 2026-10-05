// @vitest-environment jsdom
/**
 * **The first-open default, through the hook that applies it.**
 *
 * tests/last-view.test.ts pins the three pure functions; this is the part they
 * cannot see — `useLastView`'s two layout effects: that the claim and the
 * default meet, that the default waits for the settings store's answer,
 * and that it is applied once. src/web/last-view.ts § The first-open default;
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

const { useLastView } = await import("../src/web/last-view.js");
const { navigate, parseRoute } = await import("../src/web/router.js");

const KEY = "spya.lastView.x";

function Page({ slug }: { slug: string }) {
  const route = parseRoute(location.pathname);
  useLastView(slug, route.kind === "read" ? route.view : "article");
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
    expect(location.search).toBe("?mode=summary&margin=1");
    history.replaceState(null, "", "/read/x");
    setting.on = false;
    act(() => root.render(<StrictMode><Page slug="x" /></StrictMode>));
    expect(location.search).toBe("");
  });

  it("claims each new slug and does not apply a pending default to the previous one", () => {
    Object.assign(setting, { signedIn: true });
    open();
    history.replaceState(null, "", "/read/y");
    act(() => root.render(<Page slug="y" />));
    Object.assign(setting, { on: true, loaded: true });
    act(() => root.render(<Page slug="y" />));
    expect(location.pathname + location.search).toBe("/read/y?mode=summary&margin=1");
    expect(window.localStorage.getItem(KEY)).toBe("");
  });

  it("arrives in Summary with the notes, for a reader whose switch is on", () => {
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.pathname + location.search).toBe("/read/x?mode=summary&margin=1");
  });

  it("arrives in Summary with the notes when the switch is off too", () => {
    /* Summary alone until 2026-10-05, when Marginalia left the switch
       (docs/plans/261005d-marginalia-out-of-the-experimental-switch.md). */
    Object.assign(setting, { on: false, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("?mode=summary&margin=1");
  });

  it("waits for the switch's answer, then applies it", () => {
    Object.assign(setting, { signedIn: true });
    open();
    expect(location.search).toBe("");
    Object.assign(setting, { on: true, loaded: true });
    open();
    expect(location.search).toBe("?mode=summary&margin=1");
  });

  it("leaves a reader who moved while it was waiting alone", () => {
    Object.assign(setting, { signedIn: true });
    open();
    history.replaceState(null, "", "/read/x?at=spya-aaaaaa");
    Object.assign(setting, { on: true, loaded: true });
    open();
    expect(location.search).toBe("?at=spya-aaaaaa");
  });

  it("gives a signed-out reader the article alone", () => {
    Object.assign(setting, { loaded: true, signedIn: false });
    open();
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
    expect(location.search).toBe("?mode=summary&margin=1");
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

  it("counts a signed-out visit: the default is not held over for a later sign-in", () => {
    Object.assign(setting, { loaded: true, signedIn: false });
    open();
    act(() => root.unmount());
    root = createRoot(host);
    Object.assign(setting, { on: true, loaded: true, signedIn: true });
    open();
    expect(location.search).toBe("");
  });
});
