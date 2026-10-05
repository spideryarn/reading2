/**
 * **The command bar's sub-mode rows** — Greg, 2026-10-01 (SPIDERYARN-READING2-77):
 * *"In the Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram,
 * etc."* docs/plans/261001d-command-bar-lists-sub-modes.md.
 *
 * Its own file rather than more of tests/command-bar.test.tsx, which is long
 * already; the helpers are the same shape as that file's.
 */
// @vitest-environment jsdom
import { isBandMode } from "../src/modes.js";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryState, useQueryStates } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODES } from "../src/modes.js";
import {
  bandTarget,
  pendingActivation,
  resetActivations,
  subModeGenerates,
  subModeTarget,
} from "../src/web/activation.js";
import { GENERATES_MARKER } from "../src/web/CommandBar.js";
import { Dock } from "../src/web/Dock.js";
import {
  debateParam,
  diagramParam,
  modeParam,
  refereeParam,
  rememberParam,
  structureParam,
  summaryParam,
  threadParam,
} from "../src/web/params.js";
import { returnToSubMode, subModeParams, subModesOf, withSubMode, type SubMode } from "../src/web/sub-modes.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/read/a-piece");
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  resetActivations();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function reading(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_ON,
        ...props,
      }),
    );
  });
}

/**
 * The production seam below `Dock`: the Reader's separate mode setter and its
 * one multi-key setter, rather than a spy that stops at `onMode`.
 */
function ReaderNavHarness(): ReturnType<typeof createElement> {
  const [mode, setMode] = useQueryState("mode", modeParam);
  const [subNav, setSubNav] = useQueryStates({
    mode: modeParam,
    remember: rememberParam,
    thread: threadParam,
    diagram: diagramParam,
    referee: refereeParam,
    summary: summaryParam,
    structure: structureParam,
    debate: debateParam,
  });
  return createElement(Dock, {
    slug: "a-piece",
    view: "article",
    mode,
    experimental: EXPERIMENTAL_ON,
    onMode(next, sub) {
      /* Marginalia is a switch, not a band (`BandMode`); not under test here. */
      if (sub === undefined) {
        if (isBandMode(next) && next !== mode) {
          const back = returnToSubMode(next, { remember: subNav.remember });
          if (back === null) void setMode(next);
          else void setSubNav(back, { history: "push" });
        }
      } else void setSubNav(subModeParams(sub), { history: "push" });
    },
  });
}

function readingThroughReader(search = ""): void {
  history.replaceState(null, "", `/read/a-piece${search}`);
  act(() => {
    root.render(createElement(NuqsAdapter, null, createElement(ReaderNavHarness)));
  });
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(check(), "the query-state write never settled").toBe(true);
}

function metadataPage(props: Record<string, unknown> = {}, search = "?at=spya-k3m9qt"): void {
  history.replaceState(null, "", `/read/a-piece/metadata${search}`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the metadata page's Dock is missing the reading view's props on purpose
      createElement(Dock as any, {
        slug: "a-piece",
        view: "metadata",
        experimental: EXPERIMENTAL_ON,
        ...props,
      }),
    );
  });
}

const dialog = (): HTMLDialogElement => {
  const el = host.querySelector<HTMLDialogElement>("dialog.cmdbar");
  expect(el, "no command bar in the tree").not.toBeNull();
  return el as HTMLDialogElement;
};
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const subRows = (): HTMLElement[] => rows().filter((r) => r.dataset.kind === "submode");
/** A sub-mode row's whole visible name, parent and all: `Remember › Quiz`. */
const fullName = (row: HTMLElement): string =>
  [row.querySelector(".cmdbar-parent")?.textContent, row.querySelector(".cmdbar-name")?.textContent]
    .filter(Boolean)
    .join(" ");

function openBar(): void {
  const button = host.querySelector<HTMLButtonElement>(".dock-commands");
  expect(button, "the bar draws no command-bar button").not.toBeNull();
  act(() => button?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const QUIZ: SubMode = { mode: "remember", view: "quiz" };
const ILLUSTRATED: SubMode = { mode: "diagram", view: "illustrated" };
const THREAD: SubMode = { mode: "summary", view: "thread" };

describe("which sub-mode rows the bar offers", () => {
  it("offers Quiz first when the reader types `quiz`", () => {
    reading();
    openBar();
    type("quiz");
    const first = rows()[0];
    expect(first?.dataset.kind).toBe("submode");
    expect(fullName(first as HTMLElement)).toBe("Remember › Quiz");
  });

  it("offers Tutorial first when the reader types `tutorial`", () => {
    reading();
    openBar();
    type("tutorial");
    const first = rows()[0];
    expect(first?.dataset.kind).toBe("submode");
    expect(fullName(first as HTMLElement)).toBe("Remember › Tutorial");
  });

  it("offers Explore first when the reader types `explore`", () => {
    reading();
    openBar();
    type("explore");
    const first = rows()[0];
    expect(first?.dataset.kind).toBe("submode");
    expect(fullName(first as HTMLElement)).toBe("Remember › Explore");
  });

  it("offers Illustrated when the reader types `illus`", () => {
    reading();
    openBar();
    type("illus");
    expect(rows().map(fullName)).toContain("Diagram › Illustrated");
  });

  it("lists a mode's sub-modes under the mode row when the mode's name is typed", () => {
    reading();
    openBar();
    type("diagram");
    const names = rows().map(fullName);
    expect(names[0]).toBe("Diagram");
    expect(names).toEqual(
      expect.arrayContaining(["Diagram › Sketch", "Diagram › Illustrated", "Diagram › Force"]),
    );
  });

  it("draws every sub-mode row after every mode row and before every page", () => {
    reading();
    openBar();
    const kinds = rows().map((r) => r.dataset.kind);
    const firstSub = kinds.indexOf("submode");
    const lastSub = kinds.lastIndexOf("submode");
    expect(firstSub).toBeGreaterThan(0);
    expect(kinds.slice(0, firstSub).every((k) => k === "mode")).toBe(true);
    expect(kinds.slice(firstSub, lastSub + 1).every((k) => k === "submode")).toBe(true);
    expect(kinds.slice(lastSub + 1).some((k) => k === "mode" || k === "submode")).toBe(false);
  });

  it("with the switch on, offers every sub-mode of every mode that has them", () => {
    reading();
    openBar();
    const expected = MODES.flatMap((m) => subModesOf(m)).length;
    expect(subRows()).toHaveLength(expected);
  });

  it("with the switch off, offers no sub-mode of a mode the Dock does not draw, and no experimental picture", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    openBar();
    const modeRows = rows()
      .filter((r) => r.dataset.kind === "mode")
      .map((r) => r.querySelector(".cmdbar-name")?.textContent);
    expect(modeRows).not.toContain("Referee");
    const names = subRows().map(fullName);
    expect(names.some((n) => n.startsWith("Referee"))).toBe(false);
    /* Remember is in every reader's bar since 2026-10-05 (spya-cnqcjf), with
       three of its four parts; Explore is still behind the switch. */
    expect(modeRows).toContain("Remember");
    expect(names.filter((n) => n.startsWith("Remember"))).toEqual([
      "Remember › Recall",
      "Remember › Tutorial",
      "Remember › Quiz",
    ]);
    expect(names).not.toContain("Diagram › Illustrated");
    expect(names).not.toContain("Diagram › Force");
    /* And not nothing: Summary's levels are for everybody. */
    expect(names).toContain("Summary › Fuller");
    expect(names).toContain("Summary › Thread");
  });

  it("finds a sub-mode by the compound name a reader would say", () => {
    reading();
    openBar();
    for (const [query, name] of [
      ["illustrated diagram", "Diagram › Illustrated"],
      ["quiz mode", "Remember › Quiz"],
      ["remember quiz", "Remember › Quiz"],
    ] as const) {
      type(query);
      expect(rows().map(fullName)[0], query).toBe(name);
    }
  });

  it("with the switch off, still offers the experimental picture the address is on, as the chips do", () => {
    history.replaceState(null, "", "/read/a-piece?mode=diagram&diagram=trail");
    reading({ experimental: EXPERIMENTAL_OFF, mode: "diagram" });
    openBar();
    const names = subRows().map(fullName);
    expect(names).toContain("Diagram › Trail");
    expect(names).toContain("Diagram › Sketch");
    expect(names).not.toContain("Diagram › Drift");
  });

  it("does the same on the metadata page, from the carried address", () => {
    metadataPage({ experimental: EXPERIMENTAL_OFF }, "?mode=diagram&diagram=trail");
    openBar();
    const names = subRows().map(fullName);
    expect(names).toContain("Diagram › Trail");
    expect(names).not.toContain("Diagram › Drift");
  });

  it("gives every row a distinct id", () => {
    reading();
    openBar();
    const ids = rows().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the `generates` marker on a sub-mode row", () => {
  const marked = (name: string): boolean => {
    const row = subRows().find((r) => fullName(r) === name);
    expect(row, `no row called ${name}`).toBeDefined();
    return row?.querySelector(".cmdbar-generates")?.textContent === GENERATES_MARKER;
  };

  it("is on Quiz and Illustrated and Claims, and off Recall, Criteria and Mirror", () => {
    reading();
    openBar();
    expect(marked("Remember › Quiz")).toBe(true);
    expect(marked("Diagram › Illustrated")).toBe(true);
    expect(marked("Referee › Claims")).toBe(true);
    /* Thread arms nothing and still says it: its band writes on arrival. */
    expect(marked("Summary › Thread")).toBe(true);
    expect(subModeTarget(THREAD)).toBeNull();
    expect(marked("Summary › Brief")).toBe(true);
    expect(marked("Remember › Recall")).toBe(false);
    expect(marked("Referee › Criteria")).toBe(false);
    expect(marked("Referee › Mirror")).toBe(false);
  });

  it("is what `subModeGenerates` says, for every sub-mode", () => {
    reading();
    openBar();
    for (const sub of MODES.flatMap((m) => subModesOf(m))) {
      const row = subRows().find((r) => r.id.endsWith(`submode:${sub.mode}:${sub.view}`));
      expect(row, `${sub.mode}:${sub.view}`).toBeDefined();
      expect(row?.querySelector(".cmdbar-generates") !== null, `${sub.mode}:${sub.view}`).toBe(
        subModeGenerates(sub),
      );
    }
  });
});

describe("Enter on a sub-mode row, on the reading view", () => {
  it("opens the mode with the sub-mode named, and arms what its chip arms", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("quiz");
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("remember", QUIZ);
    expect(pendingActivation("a-piece", "quiz")).not.toBeNull();
    expect(dialog().open).toBe(false);
  });

  it("arms the picture the row names, not the one `?diagram=` said", () => {
    history.replaceState(null, "", "/read/a-piece?mode=plain&diagram=sketch");
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("illustrated");
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("diagram", ILLUSTRATED);
    expect(pendingActivation("a-piece", "illustrated")).not.toBeNull();
    expect(pendingActivation("a-piece", "sketch")).toBeNull();
  });

  it("opens Summary at the level named and arms its one plain-words job", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("fuller");
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("summary", { mode: "summary", view: "fuller" });
    expect(pendingActivation("a-piece", "simple")).not.toBeNull();
  });

  /* **The Tweets mode's words open Summary's Thread** — GPT Sol's F3 on plan
     261003l. As aliases of the Summary *mode* they would select the mode row,
     which opens whatever `?summary=` names — Brief by default — and arms
     `simple`: the wrong view, and a paid run nobody asked for. Offering the
     Thread row lower down is not enough; Enter takes the first row. Watched
     red with the aliases moved to `MODE_CATALOG.summary`. */
  it.each(["tweets", "tweet", "thread", "twitter", "tweet thread"])(
    "`%s` + Enter opens Summary's Thread, and arms nothing",
    (typed) => {
      const onMode = vi.fn();
      reading({ onMode });
      openBar();
      type(typed);
      expect(fullName(rows()[0] as HTMLElement), `first row for "${typed}"`).toBe("Summary › Thread");
      press("Enter");
      expect(onMode).toHaveBeenCalledTimes(1);
      expect(onMode).toHaveBeenCalledWith("summary", THREAD);
      /* The thread writes on arrival and claims no token (activation.ts §
         `activationForSummary`); a `simple` token here would wait for Back. */
      expect(pendingActivation("a-piece", "simple")).toBeNull();
      expect(pendingActivation("a-piece", "tweets")).toBeNull();
    },
  );

  it("`summary` + Enter still opens the mode's own row, which arms the plain-words job", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("summary");
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("summary", undefined, false);
    expect(pendingActivation("a-piece", "simple")).not.toBeNull();
  });

  it("the Summary mode row arms nothing while the reading view says the thread is showing", () => {
    /* The view is the `summary` prop — the Reader's parsed state — and not the
       address, which here still says Brief, as it does for ~50ms after a
       press on the Thread segment (GPT Sol's F1, P0). */
    const onMode = vi.fn();
    reading({ onMode, mode: "summary", summary: "thread" });
    expect(new URLSearchParams(location.search).get("summary")).toBeNull();
    openBar();
    type("summary");
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("summary", undefined, false);
    expect(pendingActivation("a-piece", "simple")).toBeNull();
  });

  it("arms nothing for Recall", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("recall");
    const recall = subRows().find((r) => fullName(r) === "Remember › Recall");
    act(() => recall?.click());
    expect(onMode).toHaveBeenCalledWith("remember", { mode: "remember", view: "recall" });
    expect(pendingActivation("a-piece", "quiz")).toBeNull();
  });

  it("writes mode and sub-mode as one pushed Reader navigation, undone by one Back", async () => {
    readingThroughReader("?mode=diagram&diagram=trail&thread=spya-k3m9qt");
    const push = vi.spyOn(history, "pushState");
    openBar();
    type("quiz");
    press("Enter");
    await until(() => {
      const params = new URLSearchParams(location.search);
      return (
        params.get("mode") === "remember" &&
        params.get("remember") === "quiz" &&
        params.get("thread") === null
      );
    });
    expect(push).toHaveBeenCalledTimes(1);

    act(() => history.back());
    await until(() => {
      const params = new URLSearchParams(location.search);
      return (
        params.get("mode") === "diagram" &&
        params.get("diagram") === "trail" &&
        params.get("thread") === "spya-k3m9qt"
      );
    });
  });

  it("the Reader harness also clears a Chat thread on a plain return to retained Quiz", async () => {
    readingThroughReader("?mode=chat&remember=quiz&thread=spya-k3m9qt");
    const push = vi.spyOn(history, "pushState");
    const remember = host.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Remember"]');
    expect(remember).not.toBeNull();
    act(() => remember?.click());
    await until(() => new URLSearchParams(location.search).get("mode") === "remember");
    expect(push).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(location.search).get("thread")).toBeNull();
  });
});

/* Structure's Expanded, since 2026-10-01 (spya-gxyhcc). Through Reader's
   batched setter, which enumerates its keys — a sub-mode missing from it would
   open the mode and drop the view without a word. GPT Sol's plan review of
   261001q, finding 4. */
describe("Enter on Structure › Expanded, on the reading view", () => {
  it("opens Structure on Expanded, arming nothing", async () => {
    readingThroughReader("?mode=plain");
    openBar();
    type("expanded");
    press("Enter");
    await until(() => {
      const params = new URLSearchParams(location.search);
      return params.get("mode") === "structure" && params.get("structure") === "expanded";
    });
  });
});

/* Debate's Reception | Claims, since 2026-10-03 (plan 261003o; GPT Sol's F6):
   the bar gets its sub-mode rows from `subModesOf`, so a sub-mode that lives
   only in the panel is one the bar never offers; and Reader's batched setter
   enumerates its keys, so one missing from it opens the mode and drops the
   view. */
describe("Debate's two sub-modes", () => {
  const CLAIMS: SubMode = { mode: "debate", view: "claims" };
  const RECEPTION: SubMode = { mode: "debate", view: "reception" };

  it("lists both under Debate, in the control's order", () => {
    reading();
    openBar();
    type("debate");
    expect(fullName(rows()[0] as HTMLElement)).toBe("Debate");
    /* The sub-mode rows only: *Debate › Run again* is a different kind of row. */
    expect(subRows().map(fullName).filter((n) => n.startsWith("Debate ›"))).toEqual([
      "Debate › Reception",
      "Debate › Claims",
    ]);
  });

  it("finds Debate's Claims by the compound a reader would say, beside Referee's", () => {
    reading();
    openBar();
    type("debate claims");
    expect(fullName(rows()[0] as HTMLElement)).toBe("Debate › Claims");
    type("claims");
    expect(rows().map(fullName)).toEqual(expect.arrayContaining(["Debate › Claims", "Referee › Claims"]));
  });

  /* **One search, never a second.** Either row arms the one `debate` run — the
     mode row's own target — under one key, and the band that mounts claims
     that one token. Two keys, or a second arm, would be two metered searches. */
  it("arms the one `debate` run for either sub-mode, as the mode row does", () => {
    for (const sub of [RECEPTION, CLAIMS]) {
      expect(subModeTarget(sub), sub.view).toBe("debate");
      expect(subModeGenerates(sub), sub.view).toBe(true);
    }
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("debate claims");
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("debate", CLAIMS);
    expect(pendingActivation("a-piece", "debate")).not.toBeNull();
  });

  it("opens Debate on Claims through the Reader's setter, in one pushed entry", async () => {
    readingThroughReader("?mode=plain&at=spya-k3m9qt");
    const push = vi.spyOn(history, "pushState");
    openBar();
    type("debate claims");
    press("Enter");
    await until(() => {
      const params = new URLSearchParams(location.search);
      return params.get("mode") === "debate" && params.get("debate") === "claims";
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(location.search).get("at")).toBe("spya-k3m9qt");
  });

  it("leaves Reception, the default, out of the address", () => {
    expect(subModeParams(RECEPTION)).toEqual({ mode: "debate", debate: null });
    expect(subModeParams(CLAIMS)).toEqual({ mode: "debate", debate: "claims" });
    expect(withSubMode("?mode=debate&debate=claims&at=spya-aaaaaa", RECEPTION)).toBe("?mode=debate&at=spya-aaaaaa");
    expect(withSubMode("?mode=plain", CLAIMS)).toBe("?mode=debate&debate=claims");
  });
});

describe("Enter on a sub-mode row, on the metadata page", () => {
  it("goes to the article in that sub-mode and arms nothing, as the mode rows there do", () => {
    metadataPage();
    openBar();
    type("quiz");
    press("Enter");
    expect(location.pathname).toBe("/read/a-piece");
    const params = new URLSearchParams(location.search);
    expect(params.get("mode")).toBe("remember");
    expect(params.get("remember")).toBe("quiz");
    expect(pendingActivation("a-piece", "quiz")).toBeNull();
  });

  it("carries Structure's Expanded view into the article href", () => {
    metadataPage();
    openBar();
    type("expanded");
    press("Enter");
    expect(location.pathname).toBe("/read/a-piece");
    const params = new URLSearchParams(location.search);
    expect(params.get("mode")).toBe("structure");
    expect(params.get("structure")).toBe("expanded");
  });
});

describe("the registry's two answers agree", () => {
  const DEFAULTS = {
    diagram: "sketch",
    referee: "criteria",
    remember: "recall",
    summary: "brief",
  } as const;

  it("a sub-mode row arms exactly the target the band that mounts would claim", () => {
    for (const sub of MODES.flatMap((m) => subModesOf(m))) {
      const band = bandTarget(sub.mode, { ...DEFAULTS, [sub.mode]: sub.view });
      expect(subModeTarget(sub), `${sub.mode}:${sub.view}`).toBe(band);
    }
  });

  it("Candidates arms nothing and is not marked as generating", () => {
    /* Literal, because the agreement test above passes when both answers are
       wrong together. Candidates reaches a search engine, so it waits for its
       own button — src/web/activation.ts § REFEREE_TARGET. */
    const candidates: SubMode = { mode: "referee", view: "candidates" };
    expect(subModeTarget(candidates)).toBeNull();
    expect(bandTarget("referee", { ...DEFAULTS, referee: "candidates" })).toBeNull();
    expect(subModeGenerates(candidates)).toBe(false);
    /* And Claims still does, so the row above is not passing on an empty table. */
    expect(subModeTarget({ mode: "referee", view: "claims" })).toBe("claims");
  });

  it("Quiz clears the thread, in the same write", () => {
    expect(subModeParams(QUIZ)).toEqual({ mode: "remember", remember: "quiz", thread: null });
    expect(withSubMode("?mode=chat&thread=spya-k3m9qt&at=spya-aaaaaa", QUIZ)).toBe(
      "?mode=remember&at=spya-aaaaaa&remember=quiz",
    );
  });

  it("writes Fuller and Thread out now that Brief is Summary's default (8N)", () => {
    expect(subModeParams({ mode: "summary", view: "fuller" })).toEqual({ mode: "summary", summary: "fuller" });
    expect(withSubMode("?mode=plain", { mode: "summary", view: "fuller" })).toBe("?mode=summary&summary=fuller");
    expect(withSubMode("?mode=plain&summary=fuller", THREAD)).toBe("?mode=summary&summary=thread");
  });

  it("omits parser defaults from both navigation paths", () => {
    for (const sub of [
      { mode: "remember", view: "recall" },
      { mode: "diagram", view: "sketch" },
      { mode: "referee", view: "criteria" },
      /* Brief, Summary's default since 8N (plan 261002c); Simple was until then. */
      { mode: "summary", view: "brief" },
      { mode: "structure", view: "fisheye" },
      { mode: "debate", view: "reception" },
    ] as const satisfies readonly SubMode[]) {
      const key = sub.mode;
      expect(subModeParams(sub)).toEqual({ mode: sub.mode, [key]: null });
      expect(withSubMode(`?mode=plain&${key}=not-the-default&at=spya-aaaaaa`, sub)).toBe(
        `?mode=${sub.mode}&at=spya-aaaaaa`,
      );
    }
  });
});
