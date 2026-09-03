// @vitest-environment jsdom
/**
 * **The experimental-features switch, at the end of the bottom bar.**
 *
 * Greg, mid-run on 2026-09-03, having just had five modes put behind the switch:
 *
 * > And also show a button at the end of the bar to enable "Experimental
 * > Features" for logged-in users with tooltip to explain what this does.
 *
 * Stage 3 of
 * docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md.
 * `Dock.tsx § DockExperimentalSwitch` is the component and carries the design;
 * this file is the table of what it draws, because a switch has six appearances
 * and five of them are states a reader only meets when something has gone wrong.
 *
 * ## What this file is really for
 *
 * **The failure states.** A control that reports a save it never made, or sits
 * dead with nothing to say, is the failure this whole design is arranged
 * against — and none of those states appear on a working laptop, so nothing but
 * a test ever visits them. docs/reusable/silent-success.md is the argument;
 * `toggleVariant` is where the rule lives, and the first three describes below
 * check the rule, the drawing, and what a press does, separately, because those
 * are three different ways to get it wrong.
 *
 * **And `aria-pressed`, which is not decoration.** Two of the six states have no
 * value to report — we have not read one, or the read failed — and
 * `aria-pressed={false}` in either is the button telling a screen reader the
 * setting is off. That is the silent default in its most direct form, and it is
 * invisible to everybody testing with their eyes.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Dock,
  type ExperimentalVariant,
  fitSignature,
  toggleVariant,
  visibleModes,
} from "../src/web/Dock.js";
import {
  EXPERIMENTAL_OFF,
  EXPERIMENTAL_ON,
  EXPERIMENTAL_SIGNED_OUT,
  experimental,
} from "./helpers/experimental-fixtures.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The bar on the reading view, told whatever this case is about. */
function reading(props: Record<string, unknown>): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the bar's two arms differ by which props are present
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        ...props,
      }),
    );
  });
}

/** The switch, or `null` when the bar did not draw one. */
function sw(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(".dock-experimental");
}

/** The switch, insisted upon — every test below the first two needs it there. */
function theSwitch(): HTMLButtonElement {
  const el = sw();
  if (!el) throw new Error("the bar drew no experimental switch");
  return el;
}

/**
 * **What a screen reader is told about the state.**
 *
 * Not the accessible name, and that is the invariant rather than an
 * implementation detail: the APG allows a moving name *or* a fixed one plus
 * `aria-pressed`, never both (DictationStrip.tsx § *The button is an action, not
 * a toggle*). So the name is always "Experimental features" and the state is
 * whatever `aria-describedby` points at.
 */
function described(): string {
  const id = theSwitch().getAttribute("aria-describedby");
  if (!id) throw new Error("the switch describes itself with nothing");
  return document.getElementById(id)?.textContent ?? "";
}

function press(): void {
  act(() => {
    theSwitch().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("who sees it at all", () => {
  /**
   * **The whole reason it is keyed on `experimental.signedIn`.** A signed-out
   * reader is forcibly off by decision (experimental-store.ts), and a control
   * they cannot use would be an advertisement for an account in a bar that is
   * about this article.
   */
  it("no switch for a signed-out reader", () => {
    reading({ experimental: EXPERIMENTAL_SIGNED_OUT, visitor: true });
    expect(sw()).toBeNull();
  });

  it("a switch for a signed-in reader", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(sw()).not.toBeNull();
  });

  /**
   * **The trap this design was chosen to avoid**, and it is worth a test of its
   * own. `Dock`'s `signedIn` prop is optional visitor-copy input that
   * `Metadata.tsx` and `Tweets.tsx` do not pass, so a switch keyed on it would
   * be present on the reading view and gone the moment the owner pressed
   * Metadata. Keyed on the store's answer, it survives the page change.
   * (GPT Sol, finding 2; Fable independently.)
   */
  it("survives a page with no signedIn prop", () => {
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: the metadata arm passes neither mode nor onMode
        createElement(Dock as any, {
          slug: "a-piece",
          view: "metadata",
          experimental: EXPERIMENTAL_OFF,
        }),
      );
    });
    expect(sw()).not.toBeNull();
  });

  /**
   * It is a toggle, not a mode: `aria-pressed`, and outside the radiogroup. A
   * seventeenth `role="radio"` in there would break the group's one promise.
   */
  it("is not one of the modes", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    expect(theSwitch().closest(".dock-modes")).toBeNull();
    expect(theSwitch().getAttribute("role")).toBeNull();
    expect(theSwitch().getAttribute("aria-checked")).toBeNull();
    expect(host.querySelectorAll('.dock-modes [role="radio"]')).toHaveLength(13);
  });
});

/**
 * **`toggleVariant` is the rule, and its order is the whole of it.**
 *
 * A failed load and an offline copy both leave `loaded` false
 * (experimental-store.ts), so a `!loaded` test at the top would swallow them
 * both and leave the reader a permanently dead button with no way to ask again.
 * That is the mistake these rows exist to keep out.
 */
describe("which appearance each state gets", () => {
  const cases: [string, Parameters<typeof experimental>[0], ExperimentalVariant | null][] = [
    ["signed out", { signedIn: false }, null],
    ["signed out, and somehow on", { signedIn: false, on: true }, null],
    ["a working switch, off", {}, "ready"],
    ["a working switch, on", { on: true }, "ready"],
    ["no answer yet", { loaded: false }, "waiting"],
    ["a write in flight", { saving: true }, "saving"],
    ["a load that failed", { loaded: false, loadError: "no" }, "load-failed"],
    ["a save that failed", { error: "no" }, "save-failed"],
    ["an offline copy", { loaded: false, stale: true }, "stale"],
    /* Both at once is reachable — a save started from /profile while this bar's
       load had failed. The write wins, because a press during one is the race
       the store's one-write-at-a-time rule exists to prevent. */
    ["a write in flight over a failed load", { loadError: "no", saving: true }, "saving"],
  ];

  for (const [what, over, want] of cases) {
    it(`${what} → ${want ?? "no switch"}`, () => {
      expect(toggleVariant(experimental(over))).toBe(want);
    });
  }
});

describe("what it says, and what a press does", () => {
  it("off: pressed false, and a press turns it on", () => {
    const set = vi.fn();
    reading({ experimental: experimental({ on: false, set }) });
    expect(theSwitch().getAttribute("aria-pressed")).toBe("false");
    expect(theSwitch().getAttribute("aria-disabled")).toBeNull();
    press();
    expect(set).toHaveBeenCalledWith(true);
  });

  it("on: pressed true, and a press turns it off", () => {
    const set = vi.fn();
    reading({ experimental: experimental({ on: true, set }) });
    expect(theSwitch().getAttribute("aria-pressed")).toBe("true");
    press();
    expect(set).toHaveBeenCalledWith(false);
  });

  /**
   * **A switch drawn from a default is a value nobody chose.** Pressing before
   * the answer arrives would send *off* over an *on* we had not read — a setting
   * silently reset by looking at the page it lives on.
   */
  it("waiting: inert, no reported value, and a press does nothing", () => {
    const set = vi.fn();
    const reload = vi.fn();
    reading({ experimental: experimental({ loaded: false, set, reload }) });
    expect(theSwitch().getAttribute("aria-disabled")).toBe("true");
    expect(theSwitch().getAttribute("aria-pressed")).toBeNull();
    expect(theSwitch().className).toContain("soon");
    press();
    expect(set).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("saving: inert, and a press does not start a second write", () => {
    const set = vi.fn();
    reading({ experimental: experimental({ on: true, saving: true, set }) });
    expect(theSwitch().getAttribute("aria-disabled")).toBe("true");
    expect(described()).toContain("Saving");
    press();
    expect(set).not.toHaveBeenCalled();
  });

  /**
   * **The dead end this switch had for one round, and the reason it mattered.**
   *
   * `stale` was inert, and nothing anywhere asks the server again when the
   * network comes back — `offline.ts` listens for *going* offline only. So a
   * reader whose page loaded from the cache got a disabled switch that stayed
   * disabled through every navigation until a full page reload. GPT Sol found it
   * by writing exactly this test and watching `reload` be called zero times.
   *
   * The value itself must still not move: another device may have changed it
   * since, and a live-looking control over a copy is how a reader turns off
   * something that was never on in front of them. So the press is a **retry**,
   * and `aria-pressed` is absent because this is not a toggle in this state.
   */
  it("stale: a press asks again rather than moving a cached value", () => {
    const set = vi.fn();
    const reload = vi.fn();
    reading({
      experimental: experimental({ on: true, loaded: false, stale: true, set, reload }),
    });
    expect(theSwitch().getAttribute("aria-disabled")).toBeNull();
    expect(theSwitch().getAttribute("aria-pressed")).toBeNull();
    /* The whole phrase, because `"on"` alone hides inside other words — an
       assertion that would have held whatever the copy said about the value. */
    expect(described()).toContain("we last knew: on");
    expect(described()).toContain("check again");
    press();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  /**
   * **The press means something else here.** There is nothing to toggle, so the
   * useful act is asking again — and the button must not report a value it does
   * not have.
   */
  it("a failed load: enabled, marked, no reported value, and a press retries the read", () => {
    const set = vi.fn();
    const reload = vi.fn();
    reading({ experimental: experimental({ loaded: false, loadError: "network", set, reload }) });
    expect(theSwitch().getAttribute("aria-disabled")).toBeNull();
    expect(theSwitch().getAttribute("aria-pressed")).toBeNull();
    expect(described()).toContain("try again");
    press();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  /**
   * The store has already put the value back, so the button's position is
   * honest; what it must not do is let the failure pass quietly.
   */
  it("a failed save: says so, aria-invalid, and a press tries again", () => {
    const set = vi.fn();
    reading({ experimental: experimental({ on: false, error: "network", set }) });
    expect(theSwitch().getAttribute("aria-invalid")).toBe("true");
    expect(described()).toContain("Not saved");
    press();
    expect(set).toHaveBeenCalledWith(true);
  });

  /**
   * **No state is a dead end.** Every appearance either takes a press that does
   * something or is one the store is about to resolve on its own. `stale` failed
   * this for one round and looked completely fine.
   */
  it("every state either acts on a press or is about to resolve itself", () => {
    const cases: [ExperimentalVariant, Partial<Parameters<typeof experimental>[0]>][] = [
      ["ready", {}],
      ["waiting", { loaded: false }],
      ["saving", { saving: true }],
      ["load-failed", { loaded: false, loadError: "no" }],
      ["save-failed", { error: "no" }],
      ["stale", { loaded: false, stale: true }],
    ];
    for (const [variant, over] of cases) {
      const set = vi.fn();
      const reload = vi.fn();
      reading({ experimental: experimental({ ...over, set, reload }) });
      press();
      const acted = set.mock.calls.length + reload.mock.calls.length > 0;
      const resolving = variant === "saving" || variant === "waiting";
      expect(acted || resolving, `${variant} is a dead end`).toBe(true);
      /* And the two that take no press say why, so the reader is not left
         guessing at a button that will not move. */
      if (!acted) expect(described().length, variant).toBeGreaterThan(0);
    }
  });

  /**
   * **The name is fixed; the state is a description.** The APG allows a moving
   * accessible name *or* a fixed name with `aria-pressed`, and not both — a name
   * that moves beside `aria-pressed` announces the state twice and changes the
   * control's identity as it goes. It was both for one round.
   * DictationStrip.tsx § *The button is an action, not a toggle*.
   */
  it("the accessible name never moves, in any state", () => {
    for (const over of [
      {},
      { on: true },
      { loaded: false },
      { saving: true },
      { loaded: false, loadError: "no" },
      { error: "no" },
      { loaded: false, stale: true },
    ]) {
      reading({ experimental: experimental(over) });
      expect(theSwitch().getAttribute("aria-label")).toBe("Experimental features");
    }
  });

  /**
   * **Not on hover only.** A failure a sighted reader can only find by hovering
   * is a failure most readers never find — NN/G's rule, and the same one the
   * `marked` modes are drawn around. So the two broken states draw a second
   * icon, and the working ones do not.
   */
  it("only the broken states draw a marker, and it is why the row gets wider", () => {
    const icons = () => theSwitch().querySelectorAll("svg").length;
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(icons()).toBe(1);
    reading({ experimental: experimental({ loadError: "no", loaded: false }) });
    expect(icons()).toBe(2);
    reading({ experimental: experimental({ error: "no" }) });
    expect(icons()).toBe(2);
    reading({ experimental: experimental({ saving: true }) });
    expect(icons()).toBe(1);
  });

  /**
   * Every state says something, and no two say the same thing. A `Record` keyed
   * on the variant cannot miss one — the compiler sees to that — but it can
   * repeat one, and a state that reads as another state is a state nobody can
   * report.
   */
  it("every appearance has its own sentence, in the description", () => {
    const said = new Set<string>();
    for (const over of [
      {},
      { loaded: false },
      { saving: true },
      { loaded: false, loadError: "no" },
      { error: "no" },
      { loaded: false, stale: true },
    ]) {
      reading({ experimental: experimental(over) });
      expect(described().length).toBeGreaterThan(0);
      said.add(described());
    }
    expect(said.size).toBe(6);
  });
});

/**
 * **The tooltip, which is the whole reason the inert states are `aria-disabled`
 * rather than `disabled`.**
 *
 * That trade buys one thing — a button the pointer can still reach, so the card
 * can explain why it will not move — and nothing checked that the card said
 * anything about the state. GPT Sol found the hole by mutation: changing
 * `state={state}` to `state={undefined}` in `DockExperimentalSwitch` left all
 * twenty-six of these tests green while removing the justification for the
 * design. So the card is opened here for real.
 *
 * The hover mechanics are `tests/referee-tooltips.test.tsx`'s, borrowed whole:
 * a native `mouseenter` on the trigger, the grouped open delay waited out, and
 * the card looked for in the *document*, because it is portalled to the end of
 * `<body>` rather than rendered into `host`.
 */
describe("the tooltip", () => {
  /** Open the switch's card and read its paragraphs. */
  async function card(): Promise<{ head: string; paras: string[] }> {
    theSwitch().dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const cards = document.querySelectorAll('[role="tooltip"]');
    expect(cards, "hovering the switch opened no card, or more than one").toHaveLength(1);
    const el = cards[0];
    return {
      head: el?.querySelector(".tip-soon-head")?.textContent ?? "",
      paras: [...(el?.querySelectorAll("p") ?? [])].map((n) => n.textContent ?? ""),
    };
  }

  it("says what the switch is, what it does, and what it does not promise", async () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    const { head, paras } = await card();
    expect(head).toBe("Experimental features");
    /* Three, and in this order: where the control is now, what turning it on
       does, and the warning that nothing behind it is finished. */
    expect(paras).toHaveLength(3);
    expect(paras[0]).toBe(described());
    expect(paras[1]).toContain("still being built");
    expect(paras[2]).toContain("Nothing here is finished");
  });

  /**
   * **The inert case, which is the one the design is for.** A reader who presses
   * a switch that does not move has to be able to find out why, and hover is the
   * route `disabled` would have taken away.
   */
  it("an inert switch explains itself", async () => {
    reading({ experimental: experimental({ saving: true }) });
    expect(theSwitch().getAttribute("aria-disabled")).toBe("true");
    const { paras } = await card();
    expect(paras[0]).toContain("Saving");
  });
});

/**
 * **The fit key carries which switch is drawn, not merely that one is.**
 *
 * GPT Sol, reviewing stage 2 and looking ahead to this one: a signature that
 * said only *there is a toggle* would leave the bar mis-measured for as long as
 * a warning marker was up, because the marker is a second icon and the row got
 * wider without the string moving. `useDockFit` re-measures on the string and
 * nothing else — the `ResizeObserver` watches the bar's own `100vw` box, which
 * does not move when the row inside it grows (Dock.tsx § fitSignature).
 */
describe("the fit signature", () => {
  const noop = () => {};
  const sig = (variant: ExperimentalVariant | null) =>
    fitSignature(visibleModes(false, "plain"), "plain", noop, undefined, null, variant);

  it("no switch is a different bar from a switch", () => {
    expect(sig(null)).not.toBe(sig("ready"));
  });

  it("every appearance is its own string", () => {
    const all: (ExperimentalVariant | null)[] = [
      null,
      "ready",
      "waiting",
      "saving",
      "stale",
      "load-failed",
      "save-failed",
    ];
    expect(new Set(all.map(sig)).size).toBe(all.length);
  });

  it("is the same string for the same bar", () => {
    expect(sig("ready")).toBe(sig("ready"));
  });
});
