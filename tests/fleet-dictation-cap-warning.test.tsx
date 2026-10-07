// @vitest-environment jsdom
/**
 * **The fleet dashboard's microphone also says when it is about to be stopped.**
 *
 * The dashboard borrows `useDictation` and draws its own chrome
 * (docs/project/dictation.md § The hook does not know which server it is
 * talking to), so the fifteen-minute cap and its chimes arrive with the hook
 * and the countdown does not. Greg, spya-n8cuqq, 2026-10-06: *"if you're ever
 * going to cut me off like that, you should give me some kind of feedback of
 * some kind."* The product's half is tests/dictation-cap-warning.test.tsx; plan
 * docs/plans/261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseDictation } from "../src/web/useDictation.js";
import { DictationControl } from "../tools/fleet/web/src/DictationControl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-10-07T10:00:00Z").getTime();

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** A listening dictation with `left` milliseconds before the cap stops it. */
function listening(left: number): UseDictation {
  return {
    supported: true,
    phase: "listening",
    armed: true,
    transcribing: false,
    liveText: true,
    interim: "",
    level: { current: 0 },
    meter: "none",
    quiet: false,
    toggle: () => {},
    error: null,
    startedAt: NOW - 1000,
    endsAt: NOW + left,
    deviceLabel: null,
    deviceId: null,
    deviceUnavailable: false,
    chooseDevice: () => {},
    recording: null,
    keptOnDevice: false,
    clearRecording: () => {},
    canRetry: false,
    retry: () => {},
    artifact: () => 0,
    dismiss: () => {},
  } satisfies UseDictation;
}

function render(d: UseDictation): void {
  act(() => {
    root.render(<DictationControl dictation={d} toggle={() => {}} />);
  });
}

describe("the fleet microphone, near its cap", () => {
  it("says nothing about a cap with minutes to go", () => {
    render(listening(5 * 60_000));
    expect(host.textContent).not.toContain("stops in");
  });

  it("counts down through the last minute", () => {
    render(listening(45_000));
    expect(host.textContent).toContain("Dictation stops in 0:45");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(host.textContent).toContain("Dictation stops in 0:40");
  });

  it("starts by itself when the last minute arrives", () => {
    render(listening(62_000));
    expect(host.textContent).not.toContain("stops in");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(host.textContent).toContain("Dictation stops in 0:59");
  });
});
