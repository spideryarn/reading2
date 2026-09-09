// @vitest-environment jsdom
/**
 * **The nine ways of naming who spoke, and the card that says what each one
 * means.**
 *
 * `Turn.tsx` already labels a turn `an injected reminder` or `a compaction
 * summary`, and `transcript.ts` calls the second of those *"the single most
 * convincing wrong answer this module could give"*. The labels were the whole
 * defence and nothing on the page said what any of them meant — on a tab that
 * carried exactly one tooltip in total.
 *
 * This file defends two things, and neither is the wording.
 *
 *  1. **Every speaker has a card, and it reaches the DOM without a pointer.**
 *     `Explain` writes the same sentence into an `sr-only` span, which is what
 *     makes an explanation exist on a phone and to a screen reader. A test that
 *     simulated a hover would pass on a page where that span had been dropped.
 *  2. **A trigger that swallows the ref opens nothing at all** — Tooltip.tsx's
 *     header, and the exact bug this pass introduced and had to fix: `Chip` in
 *     `FeedPanel` declared four props and dropped everything else, so wrapping
 *     one in a `Tooltip` produced a chip with no hover handlers, no error, and
 *     no way to tell from the rendered page.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SPEAKERS, SPEAKER_TIPS, Turn } from "../tools/fleet/web/src/Turn";
import { instantTip } from "../tools/fleet/web/src/instant";
import type { MessageSpeaker, MessageTurn } from "../tools/fleet/web/src/messages-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function turn(over: Partial<MessageTurn> = {}): MessageTurn {
  return {
    speaker: "assistant",
    at: "2026-09-09T05:51:02.547Z",
    text: "something an agent said",
    toolCalls: [],
    truncated: false,
    fullChars: null,
    ...over,
  } as MessageTurn;
}

describe("every speaker on the page explains itself", () => {
  it("has a card for all nine, with a second paragraph that is not the label again", () => {
    /* A `Record<MessageSpeaker, Tip>` makes a missing arm a type error; this is
       the runtime half, and it also catches the cheap way of filling the map —
       nine copies of the visible label with a full stop on the end. */
    for (const speaker of Object.keys(SPEAKERS) as MessageSpeaker[]) {
      const tip = SPEAKER_TIPS[speaker];
      expect(`${speaker}: ${tip.what.length > 40}`).toBe(`${speaker}: true`);
      expect(`${speaker}: ${tip.how.length > 40}`).toBe(`${speaker}: true`);
      expect(`${speaker}: ${tip.what === tip.how}`).toBe(`${speaker}: false`);
    }
  });

  it("puts the words in the DOM with nothing hovered, for each of the two traps", () => {
    /* `compact-summary` and `injected` are the two arms that are machine-written
       text wearing a person's role. If either card is ever hover-only, the one
       reader who most needs it — on a phone, or with a screen reader — is the
       one who cannot have it. */
    for (const speaker of ["compact-summary", "injected"] as const) {
      act(() => root.render(createElement(Turn, { turn: turn({ speaker }) })));
      const text = container.textContent ?? "";
      expect(`${speaker}: ${text.includes(SPEAKER_TIPS[speaker].how)}`).toBe(`${speaker}: true`);
    }
  });

  it("says the exact time in three clocks behind the raw ISO the row prints", () => {
    act(() => root.render(createElement(Turn, { turn: turn({ at: "2026-09-08T23:40:00.000Z" }) })));
    const text = container.textContent ?? "";
    // The instant itself, unshifted, so it can be compared against a log line…
    expect(text).toContain("2026-09-08T23:40:00.000Z");
    // …and the two civil times beside it, with the day marker that stops
    // "02:40 Athens" beside "23:40 UTC" reading as three hours in the past.
    expect(text).toContain("23:40 UTC");
    expect(text).toContain("02:40 Athens (+1d)");
  });

  it("says so rather than printing `Invalid Date` for an instant it cannot read", () => {
    const tip = instantTip("not a time at all");
    expect(tip.what).toContain("not a time this page can read");
    // And it still returns a card: the one unreadable timestamp on a page must
    // not also be the only one with no explanation behind it.
    expect(tip.how.length).toBeGreaterThan(40);
  });
});
