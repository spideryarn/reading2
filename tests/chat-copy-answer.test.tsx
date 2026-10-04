// @vitest-environment jsdom
/**
 * **The copy button under a chat answer reports the newest press.**
 *
 * `ChatPanel`'s `CopyAnswer` wrote to the clipboard by hand until 2026-10-04,
 * with no per-press token and a timer hung off an effect keyed on its state.
 * Two things followed, and the last two tests below were red against it:
 *
 * - press twice, the second write succeeds and the first is refused a moment
 *   later: the button drew an X and said "Copy refused by the browser." over a
 *   clipboard that held the answer;
 * - a second copy while the tick was showing got only what was left of the
 *   first tick's time.
 *
 * Both are `useCopy`'s now. tests/use-copy.test.tsx tests the hook; this tests
 * that the button a reader presses is on it.
 * docs/plans/261004e-fifth-sweep-cluster-20-one-copy-hook-for-the-nine-clipboard-writers.md
 * § Stage 3.
 *
 * Rendered through `Turn`, the smallest exported thing that draws the button.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Turn } from "../src/web/ChatPanel.js";
import type { ChatMessage } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANSWER = "The map is not the territory [spya-k3m9qt].";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
  vi.useRealTimers();
});

function paint(): void {
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    text: ANSWER,
    createdAt: "2026-10-04T12:00:00.000Z",
    status: "done",
  };
  act(() => {
    root.render(
      createElement(Turn, {
        message,
        onJump: () => {},
        recovering: false,
        blocks: new Map<string, string>(),
        onEdit: () => {},
        canEdit: false,
        editing: false,
        onEditing: () => {},
        discards: 0,
      }),
    );
  });
}

/** A writable clipboard whose promise this test controls. */
function clipboard(writeText: (t: string) => Promise<void>): string[] {
  const wrote: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        wrote.push(t);
        return writeText(t);
      },
    },
  });
  return wrote;
}

function copy(): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button.chat-icon")].find((b) =>
    /Copy this answer|would not allow the copy/.test(b.getAttribute("title") ?? ""),
  );
  if (!found) throw new Error(`No copy button. The turn reads: ${host.innerHTML}`);
  return found;
}
/** Which lucide glyph the button is drawing. */
const icon = () => copy().querySelector("svg")?.getAttribute("class") ?? "";
/** What the live region would say out loud. */
const said = () => copy().querySelector("[aria-live]")?.textContent ?? "";

async function press(): Promise<void> {
  await act(async () => {
    copy().click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the copy button under an answer", () => {
  /* Three characterisations, green before and after the move. Without them the
     two tests after could pass over a button drawn some other way. */
  it("copies the answer, block ids and all, and ticks once the write resolves", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    expect(icon()).toContain("lucide-copy");
    expect(said()).toBe("");
    expect(copy().getAttribute("title")).toBe("Copy this answer");
    await press();
    expect(wrote).toEqual([ANSWER]);
    expect(icon()).toContain("clipboard-check");
    expect(said()).toBe("Answer copied.");
    // Not before its time, and not long after it.
    act(() => vi.advanceTimersByTime(1500));
    expect(icon()).toContain("clipboard-check");
    act(() => vi.advanceTimersByTime(200));
    expect(icon()).toContain("lucide-copy");
    expect(said()).toBe("");
  });

  it("says so when the write is refused, and goes quiet again", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    paint();
    await press();
    expect(icon()).toContain("lucide-triangle-alert");
    expect(said()).toBe("Copy refused by the browser.");
    expect(copy().getAttribute("title")).toBe(
      "Your browser would not allow the copy — an insecure connection is the usual reason",
    );
    act(() => vi.advanceTimersByTime(1500));
    expect(icon()).toContain("lucide-triangle-alert");
    act(() => vi.advanceTimersByTime(200));
    expect(icon()).toContain("lucide-copy");
    expect(said()).toBe("");
    expect(copy().getAttribute("title")).toBe("Copy this answer");
  });

  it("says so, without throwing, where there is no clipboard object", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    paint();
    await press();
    expect(icon()).toContain("lucide-triangle-alert");
    expect(said()).toBe("Copy refused by the browser.");
  });

  it("lets the newest press win when an older one is refused afterwards", async () => {
    const settlers: Array<{ ok(): void; no(): void }> = [];
    clipboard(
      () =>
        new Promise<void>((ok, no) => {
          settlers.push({ ok, no: () => no(new Error("denied")) });
        }),
    );
    paint();
    await press();
    await press();
    expect(settlers).toHaveLength(2);
    // Mid-flight it claims nothing.
    expect(icon()).toContain("lucide-copy");

    await act(async () => {
      settlers[1]?.ok();
      await Promise.resolve();
    });
    expect(icon()).toContain("clipboard-check");
    await act(async () => {
      settlers[0]?.no();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(icon()).toContain("clipboard-check");
    expect(said()).toBe("Answer copied.");
    expect(copy().getAttribute("title")).toBe("Copy this answer");
  });

  it("gives a second copy its own full 1.6 seconds", async () => {
    clipboard(() => Promise.resolve());
    paint();
    await press();
    expect(icon()).toContain("clipboard-check");

    // 1000 ms into the tick, copy again.
    act(() => vi.advanceTimersByTime(1000));
    await press();
    // 1000 ms later the first tick's timer has run out. The second copy is
    // 1000 ms old and still has 600 ms to show.
    act(() => vi.advanceTimersByTime(1000));
    expect(icon()).toContain("clipboard-check");
    expect(said()).toBe("Answer copied.");
    // And it does go: 1700 ms after the second copy.
    act(() => vi.advanceTimersByTime(700));
    expect(icon()).toContain("lucide-copy");
    expect(said()).toBe("");
  });
});
