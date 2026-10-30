// @vitest-environment jsdom
/**
 * **A browser with no memory of an article asks the server where you were** —
 * last-view.ts § The server's place; plan
 * docs/plans/261029f-your-place-in-an-article-follows-you-to-another-device.md
 * (Greg's report spya-e23tee, postmortem 261029a).
 *
 * The first case is the report: a reader half way through on another device,
 * opening the article in a browser with no key for it, arrived at the guide at
 * the top. It must arrive at the server's paragraph.
 */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedPlace } from "../src/types.js";

vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({ on: false, loaded: true, signedIn: true }),
}));

const { lastViewKey, settleSavedPlace, useLastView } = await import("../src/web/last-view.js");
const { parseRoute } = await import("../src/web/router.js");

const A = "5f5f5f5f-5555-4555-8555-000000000001";
const B = "6a6a6a6a-6666-4666-8666-000000000001";
const KEY = lastViewKey("x", A);
const MIDWAY = "spya-m5keyt";

/** The reading view's arrival, and — when `answer` is given — the article read answering, as ArticlePage does before it draws. */
function Page({ answer, readerId = A }: { answer?: SavedPlace; readerId?: string }) {
  const route = parseRoute(location.pathname);
  useLastView("x", route.kind === "read" ? route.view : "article", readerId);
  useLayoutEffect(() => {
    if (answer !== undefined) settleSavedPlace("x", readerId, answer);
  }, [answer, readerId]);
  return null;
}

let host: HTMLDivElement;
let root: Root;
let held: Map<string, string>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  held = new Map();
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
  /* Each case is a fresh tab: drop the module's kept answer. */
  history.replaceState(null, "", "/");
  act(() => {
    createRoot(document.createElement("div")).render(<NoArticle />);
  });
});

function NoArticle() {
  useLastView(null, "article", null);
  return null;
}

const render = (node: React.ReactNode) => act(() => root.render(node));

describe("a browser with no key for the article", () => {
  it("arrives at the paragraph the server has from another device, not at the guide", () => {
    render(<Page answer={{ block: MIDWAY }} />);
    expect(location.search).toBe(`?at=${MIDWAY}`);
    expect(held.get(KEY)).toBe(`?at=${MIDWAY}`);
  });

  it("opens plain at the top for an article opened before at the top, and is not a first open", () => {
    render(<Page answer={{ block: null }} />);
    expect(location.search).toBe("");
    expect(held.get(KEY)).toBe("");
  });

  it("gets the first open when the server has never seen it opened either", () => {
    render(<Page answer={null} />);
    expect(location.search).toBe("?mode=chat&guide=1");
    expect(held.get(KEY)).toBe("");
  });

  it("writes nothing while it waits, so a reload in that moment asks again", () => {
    render(<Page />);
    expect(location.search).toBe("");
    expect(held.has(KEY)).toBe(false);
    act(() => settleSavedPlace("x", A, { block: MIDWAY }));
    expect(location.search).toBe(`?at=${MIDWAY}`);
  });

  it("ignores an answer fetched for another reader", () => {
    render(<Page />);
    act(() => settleSavedPlace("x", B, { block: MIDWAY }));
    expect(location.search).toBe("");
    expect(held.has(KEY)).toBe(false);
  });

  it("uses an answer that came first, on Metadata, when the reader steps into the article", () => {
    history.replaceState(null, "", "/read/x/metadata");
    render(<Page answer={{ block: MIDWAY }} />);
    expect(location.search).toBe("");
    history.replaceState(null, "", "/read/x");
    render(<Page answer={{ block: MIDWAY }} />);
    expect(location.pathname + location.search).toBe(`/read/x?at=${MIDWAY}`);
  });

  it("leaves a link that says anything as sent", () => {
    history.replaceState(null, "", "/read/x?at=spya-aaaaaa");
    render(<Page answer={{ block: MIDWAY }} />);
    expect(location.search).toBe("?at=spya-aaaaaa");
  });

  it("defers to a key another tab wrote while it waited", () => {
    render(<Page />);
    held.set(KEY, "?at=spya-bbbbbb");
    act(() => settleSavedPlace("x", A, { block: MIDWAY }));
    expect(location.search).toBe("");
    expect(held.get(KEY)).toBe("?at=spya-bbbbbb");
  });

  it("does not save a late answer under this article after the address has already left it", () => {
    render(<Page />);
    /* Navigation writes history before React can render the next route. The
       article answer can settle in that gap, while `arrivedFor` still says x. */
    history.replaceState(null, "", "/read/y?at=spya-bbbbbb");
    act(() => settleSavedPlace("x", A, { block: MIDWAY }));
    expect(location.pathname + location.search).toBe("/read/y?at=spya-bbbbbb");
    expect(held.has(KEY)).toBe(false);
  });
});

describe("a browser with a key of its own", () => {
  it("trusts its own copy, whatever the server says", () => {
    held.set(KEY, "?at=spya-cccccc");
    render(<Page answer={{ block: MIDWAY }} />);
    expect(location.search).toBe("?at=spya-cccccc");
  });
});
