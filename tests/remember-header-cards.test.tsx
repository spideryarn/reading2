// @vitest-environment jsdom
/**
 * **The top of the Remember band, after Greg's three reports of 2026-10-04**
 * (spya-pmjy40, spya-wbhrm7, spya-usyhwy;
 * docs/plans/261004f-remember-header-profile-icon-only-and-a-card-on-each-sub-mode-chip.md):
 *
 *  1. the profile badge is an icon with no words in every mode, and
 *     it has a card;
 *  2. each of Remember's four chips has a card of its own;
 *  3. Remember's (i) is short pieces and a list, not one paragraph.
 *
 * The cards are opened the way tests/referee-tooltips.test.tsx opens them: a
 * `mouseenter`, the open delay on a faked clock, and the card looked for in the
 * document because it is portalled out of `host`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODE_CATALOG } from "../src/mode-catalog.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
});

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async () => new Response(JSON.stringify({ profile: "p", purpose: "q" }), { status: 200 }),
    fetchOk: async () => new Response(null, { status: 204 }),
  };
});

const { RememberSubModeToggle, REMEMBER_VIEW_HOW } = await import("../src/web/QuizPanel.js");
const { RememberSubModesAbout } = await import("../src/web/RememberAbout.js");
const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { WrittenForYou } = await import("../src/web/WrittenForYou.js");
const { REMEMBER_SUB_MODES } = await import("../src/web/sub-modes.js");
const { REMEMBER_VIEWS } = await import("../src/web/params.js");

/** Past the grouped chips' 300ms and the lone tooltip's own delay. */
const PAST_THE_OPEN_DELAY = 400;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cards = () => [...document.querySelectorAll('[role="tooltip"]')];

async function hover(el: Element): Promise<void> {
  vi.useFakeTimers();
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    vi.advanceTimersByTime(PAST_THE_OPEN_DELAY);
  });
}

async function leave(el: Element): Promise<void> {
  el.dispatchEvent(new MouseEvent("mouseleave"));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  for (const _ of [0, 1]) {
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
  }
}

describe("the profile badge", () => {
  function badge(changed: boolean, regenerate = false): HTMLButtonElement {
    act(() => {
      root.render(
        createElement(WrittenForYou, {
          written: true,
          changed,
          slug: "some-article",
          regenerate: regenerate
            ? { run: () => {}, busy: false, refresh: async () => {} }
            : undefined,
        }),
      );
    });
    const found = host.querySelector<HTMLButtonElement>("button.prof-badge");
    if (!found) throw new Error("no badge");
    return found;
  }

  it("is an icon with no words, in either state", () => {
    for (const changed of [false, true]) {
      const b = badge(changed);
      expect(flat(b.textContent), `changed=${changed}`).toBe("");
      expect(b.querySelector("svg"), `changed=${changed}`).not.toBeNull();
      expect(b.classList.contains("icon-only")).toBe(true);
      expect(b.getAttribute("aria-label")).toMatch(/profile/i);
    }
  });

  it("says what it means in a card, differently for an older profile", async () => {
    const current = badge(false);
    await hover(current);
    expect(cards()).toHaveLength(1);
    const now = flat(cards()[0]?.textContent);
    expect(cards()[0]?.querySelector(".tip-soon-head")?.textContent).toBe("Written for your profile");
    expect(now).toContain("About you");
    expect(now).toContain("Why you're reading this one");
    expect(now).toContain("or both");
    await leave(current);
    expect(cards()).toHaveLength(0);

    const older = badge(true, true);
    await hover(older);
    expect(cards()[0]?.querySelector(".tip-soon-head")?.textContent).toBe("Written for an older profile");
    expect(flat(cards()[0]?.textContent)).toMatch(/earlier version/);
    expect(flat(cards()[0]?.textContent)).toMatch(/write this again/i);
    await leave(older);
  });

  it("offers to write it again only when the mode can", async () => {
    const older = badge(true, false);
    await hover(older);
    expect(flat(cards()[0]?.textContent)).not.toMatch(/write this again/i);
    await leave(older);
  });

  it("opens the panel on one click, and the card gives way to it", async () => {
    const b = badge(false);
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-haspopup")).toBe("dialog");
    await hover(b);
    expect(cards()).toHaveLength(1);
    expect(b.getAttribute("aria-expanded"), "the tooltip overwrote the panel's ARIA").toBe("false");
    expect(b.getAttribute("aria-haspopup"), "the tooltip overwrote the panel's ARIA").toBe("dialog");
    expect(b.getAttribute("aria-describedby")).toBe(cards()[0]?.id);
    await act(async () => {
      b.click();
    });
    for (const _ of [0, 1]) {
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    }
    const panel = document.querySelector<HTMLElement>(".prof-panel");
    expect(panel, "the panel did not open").not.toBeNull();
    expect(cards(), "the card stayed up over the panel").toHaveLength(0);
    expect(b.getAttribute("aria-describedby"), "the closed card left a dangling description").toBeNull();
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-haspopup")).toBe("dialog");
    expect(b.getAttribute("aria-controls")).toBe(panel?.id);
    /* Still hovering, and the card stays away while the panel is open. */
    b.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      vi.advanceTimersByTime(PAST_THE_OPEN_DELAY);
    });
    expect(cards()).toHaveLength(0);
    /* Escape still closes the panel. */
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    for (const _ of [0, 1]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
    }
    expect(document.querySelector(".prof-panel")).toBeNull();
    expect(document.activeElement, "the panel did not return focus to its trigger").toBe(b);
    expect(cards(), "returning focus reopened the card without a new focus or hover").toHaveLength(0);

    /* The suppression is only for the focus the panel itself restored. A real
       later keyboard visit still gets the same card as a hover. */
    act(() => b.blur());
    act(() => b.focus());
    expect(cards(), "a later keyboard focus no longer opened the card").toHaveLength(1);
  });

  it("a touch press opens only the panel", async () => {
    const b = badge(false);
    vi.useFakeTimers();
    const down = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    act(() => {
      b.dispatchEvent(down);
      b.dispatchEvent(new MouseEvent("mouseenter"));
    });
    await act(async () => {
      vi.advanceTimersByTime(PAST_THE_OPEN_DELAY);
    });
    expect(cards(), "the touch compatibility hover opened the card").toHaveLength(0);
    act(() => b.click());
    await act(async () => {
      vi.advanceTimersByTime(PAST_THE_OPEN_DELAY);
    });
    expect(document.querySelector(".prof-panel")).not.toBeNull();
    expect(cards()).toHaveLength(0);
  });
});

describe("Remember's chips", () => {
  it("each has its own card without adding a layout wrapper or changing the toggle buttons", async () => {
    const changed: string[] = [];
    act(() => {
      root.render(
        createElement(RememberSubModeToggle, {
          slug: "a-paper",
          value: "recall",
          onChange: (next) => changed.push(next),
        }),
      );
    });
    const chips = [...host.querySelectorAll<HTMLElement>(".remember-submode-btn")];
    const row = host.querySelector(".remember-submode");
    expect([...(row?.children ?? [])]).toEqual(chips);
    expect(chips.map((c) => c.textContent)).toEqual(REMEMBER_VIEWS.map((v) => REMEMBER_SUB_MODES[v].label));
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    act(() => chips[1]?.click());
    expect(changed).toEqual(["tutorial"]);
    for (const [i, view] of REMEMBER_VIEWS.entries()) {
      const chip = chips[i] as HTMLElement;
      await hover(chip);
      expect(cards(), view).toHaveLength(1);
      const card = cards()[0];
      expect(card?.querySelector(".tip-soon-head")?.textContent, view).toBe(REMEMBER_SUB_MODES[view].label);
      const paras = [...(card?.querySelectorAll("p") ?? [])].map((p) => flat(p.textContent));
      expect(paras[0], view).toBe(`${REMEMBER_SUB_MODES[view].description}.`);
      expect(paras[1], view).toBe(REMEMBER_VIEW_HOW[view]);
      await leave(chip);
      expect(cards(), view).toHaveLength(0);
      vi.useRealTimers();
    }
  });

  it("opens the same card from keyboard focus", () => {
    act(() => {
      root.render(createElement(RememberSubModeToggle, { slug: "a-paper", value: "recall", onChange: () => {} }));
    });
    const tutorial = host.querySelector<HTMLButtonElement>(".remember-submode-btn:nth-of-type(2)");
    if (!tutorial) throw new Error("no Tutorial chip");
    act(() => tutorial.focus());
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.querySelector(".tip-soon-head")?.textContent).toBe("Tutorial");
    expect(tutorial.getAttribute("aria-describedby")).toBe(cards()[0]?.id);
  });

  it("keep the claims the catalog used to carry about Recall's one voice", () => {
    expect(REMEMBER_VIEW_HOW.recall).toContain("One adaptive voice");
    expect(REMEMBER_VIEW_HOW.recall).toContain("fills the gap");
    expect(Object.values(REMEMBER_VIEW_HOW).join(" ")).not.toMatch(
      /four stances|Balanced|Respond|Socratic|Signposts/i,
    );
  });
});

describe("Remember's (i)", () => {
  it("lists the four sub-modes, one line each", () => {
    act(() => {
      root.render(createElement(RememberSubModesAbout));
    });
    const items = [...host.querySelectorAll("li")].map((li) => flat(li.textContent));
    expect(items).toHaveLength(REMEMBER_VIEWS.length);
    for (const [i, view] of REMEMBER_VIEWS.entries()) {
      expect(items[i]).toContain(REMEMBER_SUB_MODES[view].label);
      expect(items[i]).toContain(REMEMBER_SUB_MODES[view].description);
    }
  });

  it("opens with a short paragraph, not the walk through every sub-mode", () => {
    const words = MODE_CATALOG.remember.how.split(/\s+/).length;
    expect(words, MODE_CATALOG.remember.how).toBeLessThanOrEqual(45);
  });

  it("is added to each Remember conversation band, and not to Chat", () => {
    const props = (kind: "chat" | "remember" | "tutorial" | "explore") => ({
      slug: "a-paper",
      kind,
      loaded: true,
      loadFailed: false,
      threads: [],
      threadId: null,
      onThread: () => {},
      onSend: () => {},
      onNew: () => {},
      onSendNew: () => {},
      onDiscard: () => {},
      onRename: () => {},
      onDelete: () => {},
      canStartOver: true,
      onRetry: () => {},
      onEdit: () => {},
      onStop: () => {},
      onJump: () => {},
      recovering: new Set<string>(),
      blocks: new Map<string, string>(),
      focusNonce: 0,
      error: null,
    });

    act(() => root.render(createElement(ChatPanel, props("remember"))));
    const about = host.querySelector<HTMLButtonElement>('.band-about[aria-label="About this mode"]');
    if (!about) throw new Error("no Remember (i)");
    act(() => about.click());
    for (const kind of ["remember", "tutorial", "explore"] as const) {
      act(() => root.render(createElement(ChatPanel, props(kind))));
      expect(document.querySelectorAll(".band-about-list li"), kind).toHaveLength(REMEMBER_VIEWS.length);
    }
    act(() => root.render(createElement(ChatPanel, props("chat"))));
    expect(document.querySelectorAll(".band-about-list li")).toHaveLength(0);
  });
});
