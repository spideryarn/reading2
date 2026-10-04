// @vitest-environment jsdom
/**
 * **On a phone, a passage link in a band steps the band aside — through the
 * real page.**
 *
 * > close the panel on link tap on phone for all modes
 * >
 * > — Greg, 2026-09-29
 *
 * On a narrow window the band lies over the whole article (`band-covers`), so a
 * link inside it used to scroll prose nobody could see. Reader now hands every
 * band `bandJump` — `jumpTo`, then `bandAway` while the band covers — and draws
 * a "↩ back to ⟨mode⟩" pill (BandBackChip.tsx) in the section chip's place.
 * docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md.
 *
 * **Why the whole App rather than the band.** Every piece here is wiring: which
 * callback Reader hands which consumer, which chip it draws, where focus goes.
 * A band mounted with a spy for `onJump` is green whether Reader hands it
 * `bandJump` or `jumpTo` — the composition-root half of
 * docs/reusable/silent-success.md. **The mutation this file was watched to
 * fail on:** Summary's arm of `modeBand()` in Reader.tsx put back to
 * `onJump={jumpTo}` — the first case goes red on `.band-away` (the band never
 * steps aside), and so do the focus and herald cases.
 *
 * Summary is the band because its one read is a stored artefact this file can
 * answer in a line (`SIMPLE_BODY`), and every plain-words paragraph carries
 * real `BlockRef` links. It was the gist outline's rows until that outline went
 * on 2026-10-01 (docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md).
 *
 * **How width is set.** jsdom lays nothing out, so the width `useWindowWidth`
 * reads (measure.ts § `layoutViewportWidth`: the larger of `innerWidth` and the
 * root's `clientWidth`) is stubbed before the App mounts, as
 * tests/layout-viewport-width.test.tsx does. The stylesheet is not loaded
 * either, so "the band is hidden" is asserted as the class the stylesheet keys
 * on (`.reader.band-covers.band-away .mode-band { display: none }`,
 * narrow-window.css), not as a computed style.
 *
 * The harness — the whole `App` under `NuqsAdapter`, a stubbed `fetch`, a
 * reactive `useSession` — is tests/mode-herald-wiring.test.tsx's.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicArticle } from "../src/public-types.js";
import { MODE_LABEL } from "../src/title-text.js";
import type { Article, BlockId, SimpleSummary } from "../src/types.js";

/** Who `useSession` says is here. Hoisted, because `vi.mock` is. */
const who = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

vi.mock("../src/web/useSession.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSession: () => ({
      session: null,
      user: useSyncExternalStore(who.subscribe, who.get, who.get),
      loading: false,
    }),
  };
});

const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

const SLUG = "a-band-link-piece";
const H1 = "spya-aaaaaa";
const FIRST = "spya-bbbbbb";
const SECOND = "spya-cccccc";
/* **Where each jump goes, and why not to the last block.** jsdom lays nothing
   out, so every row's top is 0, every row has "passed" the reading line, and
   `measureOrigin` (keynav.ts) puts the reader on the last row — a jump there is
   `alreadyThere` and pushes nothing, which would read as "the link did not
   jump". So the band link goes to the first paragraph and the prose link to the
   heading, and `?at=` changing is the proof each one jumped. */
const BAND_TARGET = FIRST;
const PROSE_TARGET = H1;

const BLOCKS: PublicArticle["blocks"] = [
  { id: H1, tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
  {
    id: FIRST,
    tag: "p",
    kind: "text",
    text: "The first point, made plainly.",
    words: 5,
    html: "<p>The first point, made plainly.</p>",
    gistable: true,
  },
  {
    id: SECOND,
    tag: "p",
    kind: "text",
    text: "The second point, which refers back to the first.",
    words: 9,
    /* An in-article link, for the one non-band jump this file needs:
       TableView's own click handler hands it to Reader's raw `jumpTo`. */
    html: `<p>The second point, which refers back to <a href="#${PROSE_TARGET}">the top</a>.</p>`,
    gistable: true,
  },
];

const TREE: PublicArticle["tree"] = {
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1", "n2"],
      range: [H1, SECOND],
      title: "A piece",
      gist: "What the piece says.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: [FIRST, FIRST],
      title: "The opening claim",
      gist: "Where it starts.",
    },
    n2: {
      id: "n2",
      depth: 1,
      parent: "n0",
      children: [],
      range: [SECOND, SECOND],
      title: "The follow-through",
      gist: "Where it gets to.",
    },
  },
};

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
};

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  sourceGuess: undefined,
  navLabelStatus: "ready",
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* **A stored route, for the Skim case** — one stop, on the band link's
   paragraph, so opening the mode jumps somewhere `?at=` can see. The shapes are
   tests/skim-panel.test.tsx's, cut to one quote. */
const QUOTE_ID = "spya-tq2abc";
const QUOTES_BODY = {
  quotes: {
    version: "test",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    quotes: [{ id: QUOTE_ID, blockId: BAND_TARGET, text: "The first point, made plainly.", start: 0, importance: 80, striking: 60 }],
    discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    generatedAt: "2026-09-28T09:00:00.000Z",
    elapsedMs: 1,
  },
  stale: false,
  outdated: false,
  profileChanged: false,
};
const SKIM_BODY = {
  skim: {
    version: "test",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    profileHash: null,
    stops: [{ quoteId: QUOTE_ID, depth: 1, role: null, cue: "Look for the claim." }],
    visible: [1, 1, 1],
    offered: 1,
    dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
    generatedAt: "2026-09-28T09:00:00.000Z",
    elapsedMs: 1,
  },
  stale: false,
  outdated: false,
  profileChanged: false,
  notOnRoute: 0,
};

/* **Summary's stored plain-words levels**, each paragraph citing the band link's
   passage — what the owner's band reads on mount (`useSimple`). */
const SIMPLE_BODY: { simpleSummary: SimpleSummary; stale: false; outdated: false; profileChanged: false } = {
  simpleSummary: {
    version: "simple/2",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    generatedAt: "2026-09-28T09:00:00.000Z",
    elapsedMs: 1,
    profileHash: null,
    levels: {
      brief: [{ text: "It starts with a plain point.", ids: [BAND_TARGET as BlockId] }],
      simple: [{ text: "It starts with a plain point, then builds on it.", ids: [BAND_TARGET as BlockId] }],
      fuller: [{ text: "It starts with a plain point, and the rest follows from it.", ids: [BAND_TARGET as BlockId] }],
    },
  },
  stale: false,
  outdated: false,
  profileChanged: false,
};

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/simple/${SLUG}`) return json(SIMPLE_BODY);
  if (url === `/api/quotes/${SLUG}`) return json(QUOTES_BODY);
  if (url === `/api/skim/${SLUG}`) return json(SKIM_BODY);
  if (url.startsWith("/api/ideas/")) return new Response(null, { status: 404 });
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: null });
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

/** A phone, where the band covers the article; and a desktop, where it sits beside it. */
const PHONE = 390;
const DESKTOP = 1440;

function setWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true });
  Object.defineProperty(document.documentElement, "clientWidth", { value: px, configurable: true });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  who.set({ id: "band-link-owner", email: "owner@example.com" });
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init?.method ?? "GET")),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  /* jsdom's own answers: `innerWidth` 1024, `clientWidth` 0. */
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(document.documentElement, "clientWidth", { value: 0, configurable: true });
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function until(ok: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 40 && !ok(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(ok(), what).toBe(true);
  await settle();
}

/** The whole app, exactly as `main.tsx` mounts it, at a given window width. */
async function open(width: number, search = ""): Promise<void> {
  setWidth(width);
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(AppBoundary, null, createElement(App, null))),
      ),
    );
  });
  await act(async () => {
    const user = who.get();
    for (const fn of [...authListeners]) fn(user === null ? "SIGNED_OUT" : "SIGNED_IN", user && { user });
  });
  await settle();
}

const param = (key: string): string | null => new URLSearchParams(location.search).get(key);
const reader = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>(".reader");
  if (!el) throw new Error("no .reader on the page");
  return el;
};
const band = (): HTMLElement | null => host.querySelector('.mode-band[aria-label="Summary"]');
/** The band is drawn and not stepped aside — what a reader would see. */
const bandShowing = (): boolean => band() !== null && !reader().classList.contains("band-away");
const pill = (): HTMLButtonElement | null => host.querySelector(".band-back-chip button");
/** `ReturnChip`'s "back to ⟨section⟩" — the one that is *not* the band pill. */
const sectionChip = (): Element | null => host.querySelector(".return-chip:not(.band-back-chip)");

/** A passage link in the Summary band — the first paragraph's, a `BlockRef`. */
function bandLink(): HTMLAnchorElement {
  const link = band()?.querySelector<HTMLAnchorElement>(`a.block-ref[data-block-link="${BAND_TARGET}"]`);
  if (!link) throw new Error(`the Summary band drew no link to ${BAND_TARGET}`);
  return link;
}

/** Press a band link the way a keyboard or a tap does: focus it, then click. */
async function pressBandLink(): Promise<HTMLAnchorElement> {
  const link = bandLink();
  await act(async () => link.focus());
  await act(async () => link.click());
  await until(() => param("at") === BAND_TARGET, "the band link never jumped the article");
  return link;
}

describe("a passage link in a band, on a phone", () => {
  it("jumps, steps the band aside, and offers the pill in place of the section chip", async () => {
    await open(PHONE, "?mode=summary");
    expect(reader().classList.contains("band-covers"), "390px must be a covering width").toBe(true);
    expect(bandShowing(), "the band opened over the article").toBe(true);

    await pressBandLink();

    expect(reader().classList.contains("band-away"), "the band did not step aside").toBe(true);
    expect(band(), "stepping aside keeps the band mounted, so nothing in it is lost").not.toBeNull();
    expect(pill()?.textContent).toContain(`back to ${MODE_LABEL.summary}`);
    expect(sectionChip(), "two pills saying back to two places").toBeNull();
    expect(param("mode"), "stepping aside is not closing the mode").toBe("summary");

    await act(async () => pill()?.click());
    await settle();

    expect(bandShowing(), "the pill did not bring the band back").toBe(true);
    expect(pill()).toBeNull();
    expect(param("at"), "bringing the band back is not a jump").toBe(BAND_TARGET);
  });

  it("the current mode button brings the band back without adding a history step", async () => {
    await open(PHONE, "?mode=summary");
    await pressBandLink();
    const pushed = vi.spyOn(history, "pushState");
    const dock = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (button) => button.getAttribute("aria-label") === MODE_LABEL.summary,
    );
    expect(dock, "the bar must draw Summary").toBeDefined();

    await act(async () => dock?.click());
    await settle();

    expect(bandShowing(), "the mode button did not bring its band back").toBe(true);
    expect(
      pushed,
      "bringing the same mode back added an empty history step",
    ).not.toHaveBeenCalled();
  });

  it("moves focus to the pill, and back to the link the reader pressed", async () => {
    /* The band goes `display: none`, which would take a keyboard or
       screen-reader user's focus with it. GPT Sol, plan review, F2. */
    await open(PHONE, "?mode=summary");
    const link = await pressBandLink();

    expect(document.activeElement, "focus was left inside the hidden band").toBe(pill());

    await act(async () => pill()?.click());
    await settle();

    expect(document.activeElement, "focus did not come back to the link").toBe(link);
  });

  it("restores focus when a resize makes the stepped-aside band visible again", async () => {
    /* `bandAway` is retained across width changes, but `band-away` is only
       painted while the band covers the prose. Growing the window therefore
       returns the band just as surely as pressing the pill does, and must not
       strand focus on the pill that the resize unmounts. */
    await open(PHONE, "?mode=summary");
    const link = await pressBandLink();
    expect(document.activeElement).toBe(pill());

    await act(async () => {
      setWidth(DESKTOP);
      window.dispatchEvent(new Event("resize"));
    });
    await until(() => !reader().classList.contains("band-covers"), "the wider layout never appeared");

    expect(pill(), "the phone-only way back survived beside a visible band").toBeNull();
    expect(document.activeElement, "focus was lost when the resize returned the band").toBe(link);
  });

  it("draws no herald while the band is away, even one still pending from the press", async () => {
    /* A Dock press names the mode for three seconds (ModeHerald.tsx); a link
       pressed inside those three seconds hides the band the herald stands
       over. Sol F5: `press` is null while `bandAway`. Watched red with
       `!bandAway &&` taken out of Reader's `<ModeHerald press=…>`. */
    await open(PHONE);
    const dock = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (b) => b.getAttribute("aria-label") === MODE_LABEL.summary,
    );
    expect(dock, "the bar must draw Summary").toBeDefined();
    await act(async () => dock?.click());
    await until(() => band() !== null, "the Dock press never opened Summary");
    const herald = () => host.querySelector(".mode-herald")?.textContent ?? "";
    expect(herald(), "the premise: a herald is up after the press").toContain(MODE_LABEL.summary);

    await pressBandLink();

    expect(reader().classList.contains("band-away")).toBe(true);
    expect(herald(), "a herald was left over the prose").toBe("");
  });
});

describe("where the band does not cover the article", () => {
  it("jumps from the same link on a wide window without stepping aside, and draws no pill", async () => {
    await open(DESKTOP, "?mode=summary");
    expect(reader().classList.contains("band-covers"), "1440px must leave room beside the band").toBe(false);

    await pressBandLink();

    expect(bandShowing(), "the band stepped aside where it covered nothing").toBe(true);
    expect(pill()).toBeNull();
  });
});

describe("a jump that does not start in the band", () => {
  it("leaves a covering band where it is", async () => {
    /* **The prose's own in-article link**, TableView's click handler → Reader's
       raw `jumpTo`. The simplest of the four non-band consumers to reach (the
       Spine is off at 390px, the chat dialog and the hover card need a
       selection or a hover); it stands for them all, since what is under test
       is that `bandJump` went to the bands only. Under a real covering band the
       prose is not tappable, but a keyboard can still reach it, and the rule
       is about who called, not about what can be seen. Watched red with
       Reader handing `<TableView onJump={bandJump}>`. */
    await open(PHONE, "?mode=summary");
    const prose = host.querySelector<HTMLAnchorElement>(`tr[data-block="${SECOND}"] a[href="#${PROSE_TARGET}"]`);
    expect(prose, "the prose drew its in-article link").not.toBeNull();

    await act(async () => prose?.click());
    await until(() => param("at") === PROSE_TARGET, "the prose link never jumped the article");

    expect(bandShowing(), "a non-band jump stepped the band aside").toBe(true);
    expect(pill()).toBeNull();
  });
});

describe("Skim, which jumps on opening", () => {
  it("opens over the article on a phone and stays there after its opening jump", async () => {
    /* **The one band Reader hands raw `jumpTo`.** Skim's `onJump` is
       also called by its own arrival effect when the mode is opened
       (SkimMode.tsx § arriving in the mode), not only by a press inside
       it — so `bandJump` would open the band and hide it in the same breath.
       It steps aside itself, through `onAway`, where a press warrants it.
       GPT Sol, plan review, F1.

       tests/skim-panel.test.tsx § "leaves the band open over a deep link
       on a narrow window" is the band's half and cannot see this: its harness
       hands the band a spy for `onJump`, so it is green whichever callback
       Reader passes. Watched red with Reader's owner arm handed
       `onJump={bandJump}`. */
    await open(PHONE);
    const dock = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (b) => b.getAttribute("aria-label") === MODE_LABEL.skim,
    );
    expect(dock, "the bar must draw Skim").toBeDefined();
    await act(async () => dock?.click());
    await until(() => param("at") === BAND_TARGET, "opening Skim never made its opening jump");

    expect(host.querySelector(`.mode-band[aria-label="${MODE_LABEL.skim}"]`), "the band opened").not.toBeNull();
    expect(reader().classList.contains("band-covers"), "390px must be a covering width").toBe(true);
    expect(reader().classList.contains("band-away"), "the opening jump hid the band it opened").toBe(false);
    expect(pill()).toBeNull();
  });

  it("moves focus to the pill and back when a focused stop steps the band aside", async () => {
    /* Skim keeps raw `jumpTo` because it jumps on opening, then uses its
       separate `onAway` callback for deliberate route movement. That callback
       must share `bandJump`'s focus handoff: otherwise `display: none` leaves
       focus inside the hidden band and the return pill is skipped entirely. */
    await open(PHONE);
    const dock = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (b) => b.getAttribute("aria-label") === MODE_LABEL.skim,
    );
    expect(dock, "the bar must draw Skim").toBeDefined();
    await act(async () => dock?.click());
    await until(() => param("at") === BAND_TARGET, "opening Skim never made its opening jump");

    const stop = host.querySelector<HTMLButtonElement>(".skim-go");
    expect(stop, "Skim drew no stop to press").not.toBeNull();
    await act(async () => stop?.focus());
    await act(async () => stop?.click());
    await until(() => reader().classList.contains("band-away"), "the stop did not step the band aside");

    expect(document.activeElement, "focus was left inside the hidden Skim band").toBe(pill());

    await act(async () => pill()?.click());
    await settle();

    expect(document.activeElement, "focus did not come back to the Skim stop").toBe(stop);
  });
});


/* Plan 261004b: a card can start another dig while its own mode is already
   open but stepped aside. Changing the URL to the same mode must reveal it. */
describe("the citation card brings its band back", () => {
  it.each([PHONE, 600])("reveals a stepped-aside Citations band at %ipx", async (width) => {
    const id = "spya-c2qmbg";
    const citation = {
      id, key: "work:plain", title: "The plain point", why: "Where the point comes from.",
      mentions: [{ blockId: FIRST, quote: "The first point", start: 0 }],
      citedAt: [FIRST], firstCited: FIRST, citedInBody: true,
      url: "https://example.com/point", linkFrom: "article", relevance: 0.8,
    };
    let digs = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/citations/${SLUG}`) return Promise.resolve(json({
        citations: { version: "test", generator: "test", slug: SLUG, sourceHash: "hash",
          generatedAt: "2026-10-04T00:00:00.000Z", elapsedMs: 1, capped: false,
          citations: [citation] }, stale: false, outdated: false,
      }));
      if (url === `/api/citations/${SLUG}/${id}/investigate`) {
        digs += 1;
        return Promise.resolve(json({ error: "Test refusal" }, 429));
      }
      return Promise.resolve(reply(url, init?.method ?? "GET"));
    });
    await open(width, "?mode=citations");
    expect(reader().classList.contains("band-covers")).toBe(true);
    const link = host.querySelector<HTMLAnchorElement>(`.cite-item a.block-ref[data-block-link="${FIRST}"]`);
    expect(link, "the citation row must provide its passage jump").not.toBeNull();
    await act(async () => link?.click());
    await until(() => reader().classList.contains("band-away"), "the citation jump did not step aside");

    const mark = host.querySelector("mark.cite");
    expect(mark, "the prose must carry the citation mark").not.toBeNull();
    await act(async () => {
      const event = new MouseEvent("pointerover", { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      mark?.dispatchEvent(event);
    });
    await until(() => document.querySelector(".prose-card-cite-dig") !== null, "the citation card did not open");
    await act(async () => document.querySelector<HTMLButtonElement>(".prose-card-cite-dig")?.click());
    await settle();
    expect(digs, "the card must start the same row verb").toBe(1);
    expect(document.querySelector(".prose-card")).toBeNull();
    expect(param("mode")).toBe("citations");
    expect(reader().classList.contains("band-away"), "Dig deeper left the answer in a hidden band").toBe(false);
  });
});
