/**
 * **The command bar's sub-mode rows** — Greg, 2026-10-01 (SPIDERYARN-READING2-77):
 * *"In the Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram,
 * etc."* docs/plans/261001d-command-bar-lists-sub-modes.md.
 *
 * Its own file rather than more of tests/command-bar.test.tsx, which is long
 * already; the helpers are the same shape as that file's.
 */
// @vitest-environment jsdom
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
  diagramParam,
  modeParam,
  refereeParam,
  rememberParam,
  summaryParam,
  threadParam,
} from "../src/web/params.js";
import { subModeParams, subModesOf, withSubMode, type SubMode } from "../src/web/sub-modes.js";
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
  const [, setSubNav] = useQueryStates({
    mode: modeParam,
    remember: rememberParam,
    thread: threadParam,
    diagram: diagramParam,
    referee: refereeParam,
    summary: summaryParam,
  });
  return createElement(Dock, {
    slug: "a-piece",
    view: "article",
    mode,
    experimental: EXPERIMENTAL_ON,
    onMode(next, sub) {
      if (sub === undefined) void setMode(next);
      else void setSubNav(subModeParams(sub), { history: "push" });
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

describe("which sub-mode rows the bar offers", () => {
  it("offers Quiz first when the reader types `quiz`", () => {
    reading();
    openBar();
    type("quiz");
    const first = rows()[0];
    expect(first?.dataset.kind).toBe("submode");
    expect(fullName(first as HTMLElement)).toBe("Remember › Quiz");
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
    expect(modeRows).not.toContain("Remember");
    const names = subRows().map(fullName);
    expect(names.some((n) => n.startsWith("Remember"))).toBe(false);
    expect(names.some((n) => n.startsWith("Referee"))).toBe(false);
    expect(names).not.toContain("Diagram › Illustrated");
    expect(names).not.toContain("Diagram › Force");
    /* And not nothing: Summary's levels are for everybody. */
    expect(names).toContain("Summary › Simple");
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
});

describe("the registry's two answers agree", () => {
  const DEFAULTS = {
    diagram: "sketch",
    referee: "criteria",
    remember: "recall",
    summary: "gists",
  } as const;

  it("a sub-mode row arms exactly the target the band that mounts would claim", () => {
    for (const sub of MODES.flatMap((m) => subModesOf(m))) {
      const band = bandTarget(sub.mode, { ...DEFAULTS, [sub.mode]: sub.view });
      expect(subModeTarget(sub), `${sub.mode}:${sub.view}`).toBe(band);
    }
  });

  it("Quiz clears the thread, in the same write", () => {
    expect(subModeParams(QUIZ)).toEqual({ mode: "remember", remember: "quiz", thread: null });
    expect(withSubMode("?mode=chat&thread=spya-k3m9qt&at=spya-aaaaaa", QUIZ)).toBe(
      "?mode=remember&at=spya-aaaaaa&remember=quiz",
    );
  });

  it("omits parser defaults from both navigation paths", () => {
    for (const sub of [
      { mode: "remember", view: "recall" },
      { mode: "diagram", view: "sketch" },
      { mode: "referee", view: "criteria" },
    ] as const satisfies readonly SubMode[]) {
      const key = sub.mode;
      expect(subModeParams(sub)).toEqual({ mode: sub.mode, [key]: null });
      expect(withSubMode(`?mode=plain&${key}=not-the-default&at=spya-aaaaaa`, sub)).toBe(
        `?mode=${sub.mode}&at=spya-aaaaaa`,
      );
    }
  });
});
