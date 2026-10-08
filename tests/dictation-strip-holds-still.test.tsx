// @vitest-environment jsdom
/**
 * **The strip keeps its height across Stop, so the button above it holds still.**
 *
 * Greg, spya-pd9fnc, 2026-10-08: *"I was hoping to double-click to save what I
 * just said and send in one go. But the button moves as soon as it gets
 * pressed"*. In Chat the composer grows upwards from a pinned bottom edge, so
 * a line removed from the strip under the button moves the button down. The
 * "Microphone: … Change" line was removed at Stop (the hook clears
 * `deviceLabel` then), dropping the button 28.7 px exactly when the second
 * press of 261005a's double press was due. Plan
 * docs/plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md.
 *
 * jsdom has no layout, so this pins the lines that are present; the plan's
 * browser check measures the button itself.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DictationStrip, TalkLabel } from "../src/web/DictationStrip.js";
import type { UseDictation } from "../src/web/useDictation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const LABEL = "iPhone Microphone";

function base(): UseDictation {
  return {
    supported: true,
    phase: "listening",
    armed: true,
    transcribing: false,
    liveText: false,
    interim: "",
    level: { current: 0 },
    meter: "measured",
    quiet: false,
    toggle: () => {},
    error: null,
    startedAt: Date.now(),
    endsAt: null,
    deviceLabel: LABEL,
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

/** What the hook really hands over after Stop: the label is already gone. */
function transcribing(from: UseDictation): UseDictation {
  return { ...from, phase: "transcribing", armed: false, transcribing: true, startedAt: null, deviceLabel: null };
}

function idle(from: UseDictation): UseDictation {
  return { ...from, phase: "idle", armed: false, transcribing: false, startedAt: null, deviceLabel: null };
}

const show = (d: UseDictation) => act(() => root.render(createElement(DictationStrip, { dictation: d })));
const micLine = () => host.querySelector(".prof-mic-line");
const warn = () => host.querySelector(".prof-mic-warn");

describe("the strip across Stop", () => {
  it("keeps the microphone line while the words are being made, with Change switched off", () => {
    const listening = base();
    show(listening);
    expect(micLine()?.textContent).toContain(LABEL);

    show(transcribing(listening));
    expect(micLine(), "the line went at Stop, so the button above it moved").not.toBeNull();
    expect(micLine()?.textContent).toContain(LABEL);
    const change = micLine()?.querySelector("button");
    expect(change?.disabled, "Change would restart a dictation that has ended").toBe(true);

    show(idle(listening));
    expect(micLine(), "the line outlived the dictation").toBeNull();
  });

  it("keeps the couldn't-use warning while the words are being made", () => {
    const listening: UseDictation = { ...base(), deviceUnavailable: { wanted: "AirPods" } };
    show(listening);
    expect(warn()).not.toBeNull();
    show(transcribing(listening));
    expect(warn(), "the warning went at Stop, so the button above it moved").not.toBeNull();
    show(idle(listening));
    expect(warn()).toBeNull();
  });

  it("does not invent a line for a dictation that never had a label", () => {
    const listening: UseDictation = { ...base(), deviceLabel: null };
    show(listening);
    show(transcribing(listening));
    expect(micLine()).toBeNull();
  });

  it("does not carry one dictation's microphone into the next one's transcribing", () => {
    const first = base();
    show(first);
    show(transcribing(first));
    show(idle(first));
    const second: UseDictation = { ...base(), deviceLabel: null };
    show(second);
    show(transcribing(second));
    expect(micLine(), "the first dictation's microphone was named for the second").toBeNull();
  });
});

describe("the microphone picker across Stop (GPT Sol's plan review, F2)", () => {
  it("stays drawn, switched off, until the words land, then closes for good", () => {
    const listening = base();
    show(listening);
    act(() => micLine()?.querySelector("button")?.click());
    const picker = () => host.querySelector(".prof-mic-picker");
    expect(picker()).not.toBeNull();

    show(transcribing(listening));
    expect(picker(), "the open picker went at Stop, so the button above it moved").not.toBeNull();
    expect(picker()?.querySelector("select")?.disabled).toBe(true);

    show(idle(listening));
    expect(picker()).toBeNull();
    show(base());
    expect(picker(), "the picker came back open on the next dictation").toBeNull();
  });
});

describe("the word beside a labelled microphone (GPT Sol's plan review, F1)", () => {
  const label = (d: UseDictation, readOnly: boolean) =>
    act(() => root.render(createElement(TalkLabel, { field: { dictation: d, readOnly }, className: "x" })));
  const visible = () =>
    [...host.querySelectorAll(".x > span")]
      .filter((s) => !s.classList.contains("talk-label-ghost"))
      .map((s) => s.textContent);

  it("holds both running words in one cell, so Stop cannot change its width", () => {
    label(base(), true);
    expect(host.querySelector(".x")?.classList.contains("talk-label")).toBe(true);
    expect(host.querySelector(".x")?.textContent).toBe("Listening…Writing it down…");
    expect(visible()).toEqual(["Listening…"]);

    label(transcribing(base()), true);
    expect(host.querySelector(".x")?.textContent).toBe("Listening…Writing it down…");
    expect(visible()).toEqual(["Writing it down…"]);
  });

  it("is plain Talk at rest", () => {
    label(idle(base()), false);
    expect(host.querySelector(".x")?.textContent).toBe("Talk");
    expect(host.querySelector(".x")?.classList.contains("talk-label")).toBe(false);
  });
});
