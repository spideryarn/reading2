// @vitest-environment jsdom
/**
 * **The reader changes while the article stays on screen.**
 *
 * `ArticlePage` is not remounted when one signed-in reader becomes another
 * (another tab signed in as somebody else): only what is under its access gate
 * is. So `useLastView` lives through the change, and this file keeps it
 * mounted through one. A test that mounted the hook afresh for B would miss
 * the whole case (GPT Sol's plan review of 261006h, F1).
 *
 * What must hold, for readers A and B sharing one browser profile:
 *
 * - B is not left looking at A's view, and A's query string is never saved
 *   under B's key as if B had chosen it;
 * - B's movements are written under B's key;
 * - A's entry is untouched, including by A's own listener, which is still
 *   subscribed while the address is rewritten for B;
 * - A, back again, finds A's place.
 *
 * src/web/last-view.ts § A change of reader, with the article still on screen;
 * docs/plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the experimental store says. Re-posed by each case. */
const setting = { on: false, loaded: false, signedIn: true };

vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({ ...setting }),
}));

const { lastViewKey, useLastView } = await import("../src/web/last-view.js");
const { navigate, parseRoute, watchHistoryWrites } = await import("../src/web/router.js");

/* As the app does (src/web/main.tsx): every write to the address is heard,
   the hook's own `replaceState` included. That is what makes A's listener run
   during B's arrival, which is the case the guard in `save` is for. */
watchHistoryWrites();

const A = "1a1a1a1a-1111-4111-8111-000000000002";
const B = "2b2b2b2b-2222-4222-8222-000000000002";
const A_KEY = lastViewKey("x", A);
const B_KEY = lastViewKey("x", B);
const A_VIEW = "?mode=quotes&at=spya-far";

function Page({ readerId }: { readerId: string | null }) {
  const route = parseRoute(location.pathname);
  useLastView("x", route.kind === "read" ? route.view : "article", readerId);
  return null;
}

let host: HTMLDivElement;
let root: Root;
let held: Map<string, string>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(setting, { on: false, loaded: false, signedIn: true });
  held = new Map<string, string>();
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

const as = (readerId: string | null) => act(() => root.render(<Page readerId={readerId} />));
const move = (search: string) => act(() => navigate(`/read/x${search}`, { replace: true, scroll: false }));

describe("A is reading, and the tab becomes B's without the page being remounted", () => {
  beforeEach(() => {
    as(A);
    move(A_VIEW);
    expect(held.get(A_KEY), "control: A's place was saved as A moved").toBe(A_VIEW);
  });

  it("B arrives at a bare address, not at A's view", () => {
    as(B);
    expect(location.pathname + location.search).toBe("/read/x");
  });

  it("A's query string is not saved under B's key", () => {
    as(B);
    expect(held.get(B_KEY)).toBe("");
  });

  it("A's entry is untouched by the rewrite made for B", () => {
    as(B);
    expect(held.get(A_KEY)).toBe(A_VIEW);
  });

  it("B's movements are written under B's key, and A's entry stays as A left it", () => {
    as(B);
    move("?mode=glossary");
    expect(held.get(B_KEY)).toBe("?mode=glossary");
    expect(held.get(A_KEY)).toBe(A_VIEW);
  });

  it("B is put at B's own remembered view, when this browser has one", () => {
    held.set(B_KEY, "?mode=timeline");
    as(B);
    expect(location.search).toBe("?mode=timeline");
    expect(held.get(B_KEY)).toBe("?mode=timeline");
    expect(held.get(A_KEY)).toBe(A_VIEW);
  });

  it("B's first open gets the first-open default, as any first open does", () => {
    Object.assign(setting, { loaded: true });
    as(B);
    expect(location.search).toBe("?mode=summary&margin=1");
  });

  it("A, back again, finds A's place, and B's is kept", () => {
    as(B);
    move("?mode=glossary");
    as(A);
    expect(location.search).toBe(A_VIEW);
    expect(held.get(A_KEY)).toBe(A_VIEW);
    expect(held.get(B_KEY)).toBe("?mode=glossary");
  });

  it("takes A's dialog and conversation off the address too, and keeps what is not the article's", () => {
    move("?key=k&mode=quotes&note=spya-a&thread=t1");
    as(B);
    expect(location.search).toBe("?key=k");
  });

  it("leaves the address alone when it has already moved on to somewhere else", () => {
    act(() => navigate("/read/y?mode=quotes", { replace: true, scroll: false }));
    as(B);
    expect(location.pathname + location.search).toBe("/read/y?mode=quotes");
    expect(held.get(A_KEY)).toBe(A_VIEW);
  });
});

describe("a fresh mount as B, in a browser A has read in", () => {
  it("is not rewritten to A's view at a bare address", () => {
    held.set(A_KEY, A_VIEW);
    as(B);
    expect(location.pathname + location.search).toBe("/read/x");
    expect(held.get(A_KEY)).toBe(A_VIEW);
  });

  it("the control: A, mounted afresh at a bare address, is", () => {
    held.set(A_KEY, A_VIEW);
    as(A);
    expect(location.search).toBe(A_VIEW);
  });

  it("a link B opened is B's from the start, and A's entry is not written", () => {
    held.set(A_KEY, A_VIEW);
    history.replaceState(null, "", "/read/x?at=spya-sent");
    as(B);
    expect(location.search).toBe("?at=spya-sent");
    expect(held.get(B_KEY)).toBe("?at=spya-sent");
    expect(held.get(A_KEY)).toBe(A_VIEW);
  });
});
