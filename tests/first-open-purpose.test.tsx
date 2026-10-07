// @vitest-environment jsdom
/**
 * **The first open of an article the add page marked: one decision, whoever
 * answers first** — src/web/first-open-purpose.ts, plan 261007j F4.
 *
 * `useLastView` (the first-open default, in `App`) and `PurposePrompt` (the
 * purpose read, in `OwnedReader`) used to decide independently. Here the real
 * hook meets a stand-in for the prompt's one call, `settleFirstOpen`, so each
 * row of the coordinator's table and both race orders are watched through the
 * address the reader would arrive at. PurposePrompt's own half (the modal, the
 * mark) is tests/purpose-prompt.test.tsx.
 */
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setting = { on: false, loaded: false, signedIn: false };
vi.mock("../src/web/useExperimental.js", () => ({
  useExperimental: () => ({ ...setting }),
}));

const { useLastView } = await import("../src/web/last-view.js");
const { firstOpenWithPurpose, settleFirstOpen, holdFirstOpen, releaseWhenDecided } = await import("../src/web/first-open-purpose.js");
const { parseRoute } = await import("../src/web/router.js");

const A = "3c3c3c3c-3333-4333-8333-000000000001";
const B = "4d4d4d4d-4444-4444-8444-000000000001";
const MARK = "spideryarn.ask-purpose";

describe("firstOpenWithPurpose: the table", () => {
  /* Since 2026-10-07 (plan 261007o) the ordinary default is the guide, so
     the purpose read no longer says where a first open lands, only whether
     the modal shows: where no band fits and no reason is stored. */
  const wide = "?mode=chat&guide=1&margin=1";
  const medium = "?mode=chat&guide=1";
  it.each([
    [wide, "stored", wide, false],
    [medium, "stored", medium, false],
    ["", "stored", "", false],
    [wide, "unknown", wide, false],
    ["", "unknown", "", false],
    [wide, "none", wide, false],
    [medium, "none", medium, false],
    ["", "none", "", true],
  ] as const)("ordinary %j, purpose %s → %j, modal %s", (ordinary, outcome, search, modal) => {
    expect(firstOpenWithPurpose(ordinary, outcome)).toEqual({ search, modal });
  });
});

/* ------------------------------------------------------------- the hook -- */

let modals: boolean[] = [];
/** Stands in for PurposePrompt's one call once its read has answered. */
function Prompt({ outcome }: { outcome: "stored" | "none" | "unknown" | null }) {
  useEffect(() => {
    if (outcome !== null) modals.push(settleFirstOpen("x", A, outcome).modal);
  }, [outcome]);
  return null;
}
function Page({ outcome }: { outcome: "stored" | "none" | "unknown" | null }) {
  const route = parseRoute(location.pathname);
  useLastView("x", route.kind === "read" ? route.view : "article", A);
  return <Prompt outcome={outcome} />;
}

const session = new Map<string, string>();
let host: HTMLDivElement;
let root: Root;

function setWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(setting, { on: false, loaded: false, signedIn: false });
  modals = [];
  holdFirstOpen(null);
  const held = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
    },
  });
  session.clear();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => void session.set(key, value),
      removeItem: (key: string) => void session.delete(key),
    },
  });
  setWidth(1400);
  history.replaceState(null, "", "/read/x");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (outcome: "stored" | "none" | "unknown" | null, strict = false) =>
  act(() => root.render(strict ? <StrictMode><Page outcome={outcome} /></StrictMode> : <Page outcome={outcome} />));

describe("a marked first open", () => {
  beforeEach(() => session.set(MARK, "x"));

  it("does not wait for the purpose read: the guide at once, since it is the answer either way", () => {
    Object.assign(setting, { signedIn: true });
    render(null);
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("no reason, room for a band: settings first, then the read → the guide, and no modal", () => {
    Object.assign(setting, { loaded: true, signedIn: true });
    render(null);
    render("none");
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    expect(modals).toEqual([false]);
  });

  it("no reason, room for a band: the purpose read need not wait for settings", () => {
    Object.assign(setting, { signedIn: true });
    render("none");
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    expect(modals).toEqual([false]);
    Object.assign(setting, { loaded: true });
    render("none");
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("does not strand the guide when the unrelated settings read never settles", () => {
    Object.assign(setting, { signedIn: true });
    render("none");
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    expect(modals).toEqual([false]);
  });

  it("no reason, room for a band but not the notes → the guide alone", () => {
    setWidth(800);
    Object.assign(setting, { loaded: true, signedIn: true });
    render("none");
    expect(location.search).toBe("?mode=chat&guide=1");
  });

  it("no reason, a phone → the article alone, and the modal", () => {
    setWidth(400);
    Object.assign(setting, { loaded: true, signedIn: true });
    render("none");
    expect(location.search).toBe("");
    expect(modals).toEqual([true]);
  });

  it("a reason stored → the guide too, and no modal", () => {
    Object.assign(setting, { loaded: true, signedIn: true });
    render("stored");
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    expect(modals).toEqual([false]);
  });

  it("a failed read → the ordinary default, either order", () => {
    Object.assign(setting, { signedIn: true });
    render("unknown");
    Object.assign(setting, { loaded: true });
    render("unknown");
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    expect(modals).toEqual([false]);
  });

  it("under StrictMode: applied once, one answer per effect run, all the same", () => {
    Object.assign(setting, { loaded: true, signedIn: true });
    render(null, true);
    render("none", true);
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
    expect(new Set(modals)).toEqual(new Set([false]));
    /* A reader who then moves is not moved back by a replayed decision. */
    history.replaceState(null, "", "/read/x?mode=summary");
    render("stored", true);
    expect(location.search).toBe("?mode=summary");
  });

  it("a reader who has moved is not moved back when the read answers", () => {
    Object.assign(setting, { loaded: true, signedIn: true });
    render(null);
    history.replaceState(null, "", "/read/x?at=spya-aaaaaa");
    render("none");
    expect(location.search).toBe("?at=spya-aaaaaa");
  });

  it("a link that carries state holds nothing: the modal, as before", () => {
    history.replaceState(null, "", "/read/x?mode=quotes");
    Object.assign(setting, { loaded: true, signedIn: true });
    render("none");
    expect(location.search).toBe("?mode=quotes");
    expect(modals).toEqual([true]);
  });
});

describe("no mark", () => {
  it("the ordinary default, without waiting for anything", () => {
    Object.assign(setting, { loaded: true, signedIn: true });
    render(null);
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });

  it("a mark for another article does not hold this one", () => {
    session.set(MARK, "y");
    Object.assign(setting, { loaded: true, signedIn: true });
    render(null);
    expect(location.search).toBe("?mode=chat&guide=1&margin=1");
  });
});

describe("the module hold belongs to one arrival", () => {
  it("does not let the previous reader's late answer settle this reader's hold for the same article", () => {
    /* A phone, where B's own "none" would be the modal: A's late answer must
       neither put A's modal over B's page nor use up B's decision. */
    const applied: string[] = [];
    holdFirstOpen({ slug: "x", readerId: B, ordinary: "" });
    releaseWhenDecided("x", B, (search) => applied.push(search));
    expect(settleFirstOpen("x", A, "none")).toEqual({ modal: false });
    expect(settleFirstOpen("x", B, "none")).toEqual({ modal: true });
    expect(applied).toEqual([""]);
  });
});
