// @vitest-environment jsdom
/**
 * **A dialog has to place itself inside the part of the screen the reader can
 * see, and on iOS that is not what CSS thinks it is.**
 *
 * Greg, from an installed iOS app, 2026-09-04: the soft keyboard covered Send
 * and there was no way to reach it. The first fix was
 * `interactive-widget=resizes-content` on the viewport meta, which asks the
 * browser to shrink the *layout* viewport so `dvh` and `position: fixed` are
 * right for free. Chromium does that. **WebKit does not reliably**
 * (bugs.webkit.org/show_bug.cgi?id=259770): it pans a smaller *visual* viewport
 * over a layout viewport that stays full height, so a `dvh`-sized dialog goes on
 * believing it has a whole screen and Send stays under the keys.
 *
 * So the dialogs measure `window.visualViewport` themselves
 * (src/web/useVisualViewport.ts), and this file is the part of that a test can
 * hold. It cannot tell you the panel looks right on a phone — nothing here can,
 * and docs/project/feedback.md says so. What it can tell you is that the numbers
 * the browser hands us reach the elements, keep up with the events, and are let
 * go of afterwards.
 *
 * **jsdom has no `visualViewport` at all**, which is the same thing an old
 * browser has, so the fake below is both the instrument and half the subject:
 * the no-`visualViewport` path is the fallback every one of these dialogs has to
 * survive on, and it is asserted first.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async () => new Response("{}", { status: 200 }),
  failure: async (res: Response) => new Error(await res.text()),
}));

vi.mock("../src/web/router.js", () => ({
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  parseRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
}));

/* The microphone opens a device and the strip reads a Floating UI tooltip.
   Neither is this file's subject; the same stand-ins tests/feedback-dialog.test.tsx
   uses, for the same reason. */
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false, toggle: () => {} },
    readOnly: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

const { FeedbackDialog } = await import("../src/web/FeedbackDialog.js");
const { AnnotateDialog } = await import("../src/web/AnnotateDialog.js");

/**
 * **A `visualViewport` we can move.**
 *
 * Counting listeners rather than merely recording them, because "does it clean
 * up" is one of the two things worth asserting here and a spy that only stores
 * calls answers it by inference.
 */
class FakeViewport extends EventTarget {
  height: number;
  offsetTop: number;
  /** Live count, by type — a leak shows up as a number that never goes back to 0. */
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

/** The layout viewport, which on iOS the keyboard does *not* change. */
const LAYOUT_HEIGHT = 800;

function fakeViewport(height: number, offsetTop: number): FakeViewport {
  const vv = new FakeViewport(height, offsetTop);
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return vv;
}

function noViewport(): void {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: LAYOUT_HEIGHT });
  /* jsdom implements neither, and `open` is a real attribute — the same
     stand-in tests/feedback-dialog.test.tsx uses. */
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  noViewport();
});

function showFeedback(open: boolean): void {
  act(() => {
    root.render(
      createElement(FeedbackDialog, {
        open,
        onClose: () => {},
        readerEmail: "reader@example.com",
        where: { url: "https://www.spideryarn.com/read/a-piece", slug: "a-piece" },
      }),
    );
  });
}

function showAnnotate(): void {
  act(() => {
    root.render(
      createElement(AnnotateDialog, {
        anchor: { blockId: "spya-aaaaaa", start: 0, end: 4, quote: "some words" } as never,
        placing: false,
        onSave: () => {},
        onCancel: () => {},
      }),
    );
  });
}

const dialog = (): HTMLDialogElement => {
  const el = host.querySelector<HTMLDialogElement>("dialog.fb-dialog");
  if (!el) throw new Error("no feedback dialog");
  return el;
};

const annotate = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>(".annotate-dialog");
  if (!el) throw new Error("no annotate dialog");
  return el;
};

describe("the Feedback dialog and the keyboard", () => {
  /**
   * **The fallback first**, because it is the state every browser without a
   * `visualViewport` is permanently in, and because a test suite that only ever
   * ran with the fake installed would not notice the day the hook started
   * writing `NaNpx` into the style of every dialog in the app.
   */
  it("leaves the stylesheet alone where there is no visualViewport", () => {
    noViewport();
    showFeedback(true);

    expect(dialog().style.height).toBe("");
    expect(dialog().style.top).toBe("");
    expect(dialog().style.bottom).toBe("");
  });

  /**
   * **The whole of the iOS case in one assertion.** The layout viewport is 800
   * and unchanged; the keyboard has left a 340px strip starting 60px down. A
   * dialog sized in `dvh` would be 800 tall and centred on a screen half of
   * which is under the keys.
   *
   * `bottom: auto` is not decoration: the stylesheet's `inset: 0` sets it, and
   * `top` + `bottom` + `height` all given is over-constrained — which of the
   * three the browser drops is not a thing to leave to a rule of precedence.
   */
  it("takes its top and height from the part the reader can see", () => {
    fakeViewport(340, 60);
    showFeedback(true);

    expect(dialog().style.top).toBe("60px");
    expect(dialog().style.height).toBe("340px");
    expect(dialog().style.bottom).toBe("auto");
  });

  /**
   * **Both events, and they are not the same event.** `resize` is the keyboard
   * arriving or the phone rotating; `scroll` is iOS *panning* the visual
   * viewport, which moves `offsetTop` without changing anything's size. Listen
   * to only the first and the dialog is the right height in the wrong place.
   */
  it("keeps up when the keyboard arrives, when it goes, and when iOS pans", () => {
    const vv = fakeViewport(LAYOUT_HEIGHT, 0);
    showFeedback(true);
    expect(dialog().style.height).toBe("800px");

    vv.move(340, 0, "resize");
    expect(dialog().style.height).toBe("340px");

    /* Panning: same height, further down. */
    vv.move(340, 120, "scroll");
    expect(dialog().style.top).toBe("120px");
    expect(dialog().style.height).toBe("340px");

    /* Rotated — a shorter, wider screen with the keyboard still up. */
    vv.move(180, 0, "resize");
    expect(dialog().style.height).toBe("180px");

    /* And the keyboard dismissed. */
    vv.move(LAYOUT_HEIGHT, 0, "resize");
    expect(dialog().style.top).toBe("0px");
    expect(dialog().style.height).toBe("800px");
  });

  /**
   * **Shut is not merely hidden.** The dialog stays mounted for the life of the
   * page — FeedbackButton renders it open or shut — so nothing unmounts when the
   * reader closes it, and without the `open` flag the listeners would run for
   * ever on every page of the app. And the numbers have to go with them: a
   * dialog closed with the keyboard up and reopened on a desk would otherwise be
   * placed from measurements taken in another world.
   */
  it("stops listening when it is closed, and measures again when it reopens", () => {
    const vv = fakeViewport(340, 60);
    showFeedback(true);
    expect(vv.open).toBe(2);

    showFeedback(false);
    expect(vv.open, "still listening behind a closed dialog").toBe(0);
    expect(dialog().style.height, "kept a height measured while it was open").toBe("");

    vv.height = LAYOUT_HEIGHT;
    vv.offsetTop = 0;
    showFeedback(true);
    expect(vv.open).toBe(2);
    expect(dialog().style.height).toBe("800px");
  });

  it("leaves no listeners behind when it unmounts", () => {
    const vv = fakeViewport(340, 60);
    showFeedback(true);
    expect(vv.open).toBe(2);

    act(() => root.unmount());
    expect(vv.open).toBe(0);

    /* afterEach unmounts too, and a second unmount is fine — but the root is
       gone, so put one back for it to find. */
    root = createRoot(host);
  });
});

/**
 * **The three panels pinned to the bottom corner** — `.cmt-dialog`,
 * `.chat-dialog` and `.annotate-dialog` — have the opposite problem to the
 * Feedback dialog and the same cause. They are `position: fixed` against the
 * *bottom* of the layout viewport, which on iOS is underneath the keyboard, so
 * what they need is not a top but an inset: how much of the layout viewport is
 * hidden. The stylesheet adds `--kb-inset` into both `bottom` and `max-height`.
 *
 * One of the three stands for all three here — they take the same value from the
 * same helper — and it is the annotate box because it is the one whose whole
 * purpose is to be typed into.
 */
describe("the panels in the bottom corner", () => {
  it("are lifted by however much of the screen is hidden", () => {
    fakeViewport(340, 60);
    showAnnotate();

    /* 800 − 340 − 60: the keyboard, and whatever is under it. */
    expect(annotate().style.getPropertyValue("--kb-inset")).toBe("400px");
  });

  it("carry no inset where there is no visualViewport", () => {
    noViewport();
    showAnnotate();

    /* Not `0px`: the property is absent, and the stylesheet's own
       `var(--kb-inset, 0px)` fallback is what stands. */
    expect(annotate().style.getPropertyValue("--kb-inset")).toBe("");
  });

  /**
   * **Never negative.** Pinch-zooming out makes the visible box *taller* than
   * the layout viewport, and an unclamped inset would then push a bottom-pinned
   * dialog off the bottom of the screen to solve a problem nobody had.
   */
  it("do not go negative when the visible box is taller than the layout", () => {
    fakeViewport(1200, 0);
    showAnnotate();

    expect(annotate().style.getPropertyValue("--kb-inset")).toBe("0px");
  });
});
