// @vitest-environment jsdom
/**
 * **The instrument, not the measurement.**
 *
 * `ViewportProbe` exists because nothing on this box can tell us what an iPhone
 * does to the mode band when the keyboard opens — stage 4 of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md.
 * So this file cannot check a single number the probe records: jsdom has no
 * layout, `getBoundingClientRect` is all zeros, and custom properties resolve
 * to nothing. Asserting on the values would be asserting on jsdom.
 *
 * What a test *can* hold is the part that would silently ruin the trace:
 *
 *  - samples **accumulate** rather than replacing one another, on `resize` and
 *    on `scroll` alike — the transient frames while the keyboard slides are the
 *    whole point, and a probe that kept only the latest would look identical
 *    from the outside and be worthless;
 *  - the listeners **go** on unmount;
 *  - with the flag off it registers nothing and renders nothing, because it
 *    ships on the reading view every reader loads.
 *
 * The `FakeViewport` below is tests/visual-viewport-dialogs.test.tsx's, kept in
 * the same shape for the same reason: counting listeners rather than recording
 * them, so a leak is a number that never returns to zero.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { ViewportProbe } = await import("../src/web/ViewportProbe.js");

class FakeViewport extends EventTarget {
  width = 390;
  height: number;
  offsetTop: number;
  offsetLeft = 0;
  scale = 1;
  readonly listening = new Map<string, number>();

  constructor(height: number, offsetTop: number) {
    super();
    this.height = height;
    this.offsetTop = offsetTop;
  }

  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    this.listening.set(type, (this.listening.get(type) ?? 0) + 1);
    super.addEventListener(type, fn);
  }

  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    this.listening.set(type, (this.listening.get(type) ?? 0) - 1);
    super.removeEventListener(type, fn);
  }

  /** Move it the way a keyboard does, and tell the page the way a browser does. */
  move(height: number, offsetTop: number, type: "resize" | "scroll"): void {
    this.height = height;
    this.offsetTop = offsetTop;
    act(() => {
      this.dispatchEvent(new Event(type));
    });
  }

  get open(): number {
    return (this.listening.get("resize") ?? 0) + (this.listening.get("scroll") ?? 0);
  }
}

const LAYOUT_HEIGHT = 844;

function fakeViewport(): FakeViewport {
  const vv = new FakeViewport(LAYOUT_HEIGHT, 0);
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return vv;
}

function noViewport(): void {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
}

/** The flag is read from `location` at mount, so the address is the switch. */
function address(search: string): void {
  history.replaceState(null, "", `/read/a-piece${search}`);
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: LAYOUT_HEIGHT });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  noViewport();
  address("");
});

function show(): void {
  act(() => {
    root.render(createElement(ViewportProbe));
  });
}

/** The panel's own controls, by their labels. */
function press(label: string): void {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`no ${label} button: ${host.innerHTML.slice(0, 200)}`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Expand the panel if it is not already open — the chip is a toggle. */
function expand(): void {
  if (host.querySelector("textarea")) return;
  const chip = host.querySelector("button");
  if (!chip) throw new Error("no probe chip");
  act(() => {
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Expand the panel, ask it for the trace, and parse what it put in the box. */
function trace(): { head: Record<string, unknown>; samples: { ev: string; t: number }[] } {
  expand();
  press("show");
  const box = host.querySelector("textarea");
  if (!box) throw new Error("no trace box");
  return JSON.parse(box.value);
}

describe("the probe is off unless the address asks for it", () => {
  /**
   * **The one that matters for every reader who is not Greg on a phone.** This
   * renders on the reading view unconditionally, so "off" has to mean off: no
   * element, and — the half that would not show up in a snapshot — no
   * subscription to a viewport that fires continuously while anything moves.
   */
  it("renders nothing and registers nothing with no ?probe", () => {
    const vv = fakeViewport();
    address("");
    show();

    expect(host.innerHTML).toBe("");
    expect(vv.open).toBe(0);
  });

  it("stays off for ?probe=0, which is a reader turning it off rather than a stray value", () => {
    const vv = fakeViewport();
    address("?probe=0");
    show();

    expect(host.innerHTML).toBe("");
    expect(vv.open).toBe(0);
  });

  it("comes up for ?probe=1, listening to both events", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();

    expect(host.querySelector("textarea")).toBe(null); // collapsed until asked
    expect(vv.listening.get("resize")).toBe(1);
    expect(vv.listening.get("scroll")).toBe(1);
  });
});

describe("samples accumulate", () => {
  /**
   * **The whole reason this is a recorder and not a readout.** iOS pans the
   * visual viewport in a stream of `scroll` events while the keyboard slides;
   * every one of those frames is a row of the measurement we are trying to get,
   * and a probe that overwrote the previous one would hand back the *settled*
   * state — which is the one state we could already reason about.
   */
  it("keeps a row per event rather than replacing the last one", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();

    vv.move(500, 0, "resize");
    vv.move(500, 30, "scroll");
    vv.move(500, 60, "scroll");

    const out = trace();
    expect(out.samples.map((s) => s.ev)).toEqual(["start", "resize", "scroll", "scroll"]);
  });

  /** `scroll` alone, because it is the event WebKit actually fires while panning. */
  it("counts scrolls as well as resizes", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();

    for (let i = 0; i < 5; i += 1) vv.move(500, i * 10, "scroll");

    expect(trace().samples.filter((s) => s.ev === "scroll").length).toBe(5);
  });

  /** Timestamps, because "when did it settle" is a question the trace has to answer. */
  it("timestamps each sample from the first one", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();
    vv.move(500, 0, "resize");

    const out = trace();
    expect(out.samples[0]?.t).toBe(0);
    expect(out.samples[1]?.t).toBeGreaterThanOrEqual(0);
    expect(typeof out.head.ua).toBe("string");
  });

  it("clears back to nothing, so a second condition is a clean trace", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();
    vv.move(500, 0, "resize");
    vv.move(500, 20, "scroll");

    expect(trace().samples.length).toBe(3);
    press("clear");
    expect(trace().samples.length).toBe(0);
  });

  /**
   * **The cap stops recording; it does not start forgetting.**
   *
   * A ring buffer is the obvious shape and it is the wrong one here: the rows
   * worth having are the first second after the composer is tapped, and iOS
   * fires `scroll` continuously for as long as anybody pans afterwards. A
   * buffer that dropped the front to make room would hand back a trace of the
   * settled state — which is the one state we could already reason about
   * without a phone. So the front is what survives, and the panel says FULL.
   */
  it("keeps the oldest samples when it fills, rather than the newest", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();

    /* One past the cap in ViewportProbe.tsx, plus the opening sample. */
    for (let i = 0; i < 700; i += 1) vv.move(500, i, "scroll");

    const out = trace();
    expect(out.samples.length).toBe(600);
    expect(out.samples[0]?.ev).toBe("start");
    expect(host.textContent).toContain("FULL");
  });

  /**
   * A hand-taken row, so a trace can say "this is the keyboard closed" without
   * anybody counting frames backwards from the end afterwards.
   */
  it("takes a labelled sample on demand", () => {
    fakeViewport();
    address("?probe=1");
    show();

    expand();
    press("mark");
    press("show");
    const box = host.querySelector("textarea");
    expect(JSON.parse(box?.value ?? "{}").samples.map((s: { ev: string }) => s.ev)).toEqual([
      "start",
      "mark",
    ]);
  });
});

describe("what it survives", () => {
  /**
   * **jsdom is the no-`visualViewport` browser**, which is also an old phone
   * and every server render. The probe still has to take its opening sample and
   * still has to not throw — a diagnostic that dies on the machine you are
   * testing it on is one you find out about on the phone.
   */
  it("still records with no visualViewport at all", () => {
    noViewport();
    address("?probe=1");
    show();

    const out = trace();
    expect(out.samples.length).toBe(1);
    expect(out.samples[0]?.ev).toBe("start");
  });

  /**
   * **A rotation is the window's news**, so it is recorded where there is no
   * visual viewport too — the listeners must not sit behind the early return
   * for a missing one (GPT Sol F4). Then the `laid-out` row: the width the
   * reader re-rendered with, the half of a rotation trace nothing else in it
   * can reconstruct. The window's rows carry the width from *before* the
   * reader re-rendered, which is the pair the question needs.
   * docs/plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md.
   */
  it("records a rotation, and the width the reader laid out for after it", () => {
    noViewport();
    address("?probe=1");
    act(() => {
      root.render(createElement(ViewportProbe, { laidOutWidth: 820 }));
    });
    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
      window.dispatchEvent(new Event("resize"));
    });
    act(() => {
      root.render(createElement(ViewportProbe, { laidOutWidth: 1180 }));
    });

    const out = trace() as unknown as {
      samples: { ev: string; lay: [number, number | null] }[];
    };
    expect(out.samples.map((s) => s.ev)).toEqual([
      "start",
      "orientationchange",
      "window-resize",
      "laid-out",
    ]);
    expect(out.samples.map((s) => s.lay[1])).toEqual([820, 820, 820, 1180]);
  });

  /** Zeros everywhere and no computed lengths — the shape has to survive both. */
  it("records a rectangle key for every element even when nothing is there", () => {
    fakeViewport();
    address("?probe=1");
    show();

    const first = trace().samples[0] as unknown as { rect: Record<string, unknown> };
    expect(Object.keys(first.rect).sort()).toEqual([
      "band",
      "body",
      "composer",
      "controls",
      "dock",
      "focus",
      "head",
      "hint",
    ]);
  });

  /**
   * **The listeners go.** A leak here is worse than a leak anywhere else in the
   * app: these fire on every visual-viewport movement for the rest of the
   * session, on the device least able to afford it.
   */
  it("removes both listeners on unmount", () => {
    const vv = fakeViewport();
    address("?probe=1");
    show();
    expect(vv.open).toBe(2);

    act(() => root.unmount());
    expect(vv.open).toBe(0);

    /* A fresh root so `afterEach`'s unmount has something to unmount. */
    root = createRoot(host);
  });
});
