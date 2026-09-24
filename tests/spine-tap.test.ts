/**
 * What a press on a spine band does — Spine.tsx § bandPress.
 *
 * Here rather than in a browser for the same reason `stepBar` is
 * (tests/bar-visibility.test.ts): the branch that matters only runs under a
 * finger, and the harness is a desktop Chrome. A broken touch path and a
 * working one look identical from the only browser we can drive.
 *
 * **And this file is not enough on its own**, which is worth knowing before
 * trusting it. GPT Sol found a blocker that lives entirely in the *event
 * sequence* rather than in this decision: a tap synthesises `mouseleave` before
 * `click`, so Floating UI's hover handling was closing the card and clearing
 * `armed` a moment before the click that was meant to commit it — every
 * assertion below passed throughout. The fix is `mouseOnly` in Tooltip.tsx.
 * A pure function can only promise that the rule is right, never that the
 * inputs reach it.
 */
import { describe, expect, it } from "vitest";
import { bandClick, bandPress } from "../src/web/Spine.js";

const A = "spya-k3m9qt";
const B = "spya-p7w2dn";

describe("a mouse click or a keypress jumps, as it always did", () => {
  it("jumps on the first press, whatever is open", () => {
    expect(bandPress(false, null, A)).toBe("jump");
    expect(bandPress(false, B, A)).toBe("jump");
    expect(bandPress(false, A, A)).toBe("jump");
  });
});

describe("a tap reveals, then commits", () => {
  it("opens the card on the first tap rather than moving the article", () => {
    expect(bandPress(true, null, A)).toBe("reveal");
  });

  /**
   * The argument is a fact about *this press*, not about the device. A
   * touchscreen laptop reports `hover: hover` and a tablet with a mouse reports
   * `hover: none`, so a device-wide predicate gets both hybrids backwards —
   * which is what the first version of this did.
   */
  it("lets a mouse and a finger disagree on the same device", () => {
    expect(bandPress(false, null, A)).toBe("jump"); // mouse: one click
    expect(bandPress(true, null, A)).toBe("reveal"); // finger: two taps
  });

  it("goes there on a second tap of the same band", () => {
    expect(bandPress(true, A, A)).toBe("jump");
  });

  /**
   * The reason the test is `armed !== id` and not `armed === null`. A finger
   * walking down the rail should read it, not fire it: moving from one band to
   * another re-reveals. Getting this wrong would send the reader to whatever
   * they touched second, which on a rail of two-pixel bands is somewhere they
   * did not choose.
   */
  it("re-reveals rather than jumping when the finger moves to another band", () => {
    expect(bandPress(true, B, A)).toBe("reveal");
  });

  it("takes exactly two presses on a band, and no more", () => {
    let armed: string | null = null;
    const press = (id: string) => {
      const action = bandPress(true, armed, id);
      armed = action === "reveal" ? id : null;
      return action;
    };
    expect([press(A), press(A)]).toEqual(["reveal", "jump"]);
    // And the next band starts over rather than inheriting the last one's arm.
    expect([press(B), press(B)]).toEqual(["reveal", "jump"]);
  });
});

/**
 * Spine.tsx § bandClick — finger or not is read off the press recorded at
 * `pointerdown`, because on iOS 18.2+ a finger's click says `mouse` (WebKit
 * bug 282988). tests/spine-hover.test.tsx drives the same rules through the
 * real rail, including the queue that supplies `press`.
 */
describe("a click, decided from its own press", () => {
  const touch = (armed: string | null) => ({ type: "touch", armed });

  it("reveals on an iPad's first tap, whose click says mouse", () => {
    expect(bandClick("mouse", 1, touch(null), null, A)).toBe("reveal");
  });

  it("jumps on the second, whose press began with this card open", () => {
    expect(bandClick("mouse", 1, touch(A), A, A)).toBe("jump");
  });

  it("does not jump when the card opened after the press began — grouped clicks", () => {
    /* Two taps on A, both clicks arriving after both lifts: the first click
       revealed A, but the second press began with nothing open. */
    expect(bandClick("mouse", 1, touch(null), A, A)).toBe("reveal");
  });

  it("jumps for a real mouse on the first click", () => {
    expect(bandClick("mouse", 1, { type: "mouse", armed: null }, null, A)).toBe("jump");
  });

  it("keeps a pen jumping on the first press, as it did", () => {
    expect(bandClick("mouse", 1, { type: "pen", armed: null }, null, A)).toBe("jump");
    expect(bandClick("pen", 1, null, null, A)).toBe("jump");
  });

  it("jumps for a keyboard, whatever was recorded", () => {
    expect(bandClick("", 0, touch(null), null, A)).toBe("jump");
    expect(bandClick(undefined, 0, null, null, A)).toBe("jump");
  });

  it("reveals, never jumps blind, for a pointer click with no press on the rail", () => {
    /* A finger that landed beside the rail, or a click after a cancel. */
    expect(bandClick("mouse", 1, null, null, A)).toBe("reveal");
    expect(bandClick(undefined, 1, null, null, A)).toBe("reveal");
    expect(bandClick("touch", 1, null, null, A)).toBe("reveal");
    // Even an open card cannot lend authority to a click with no own press.
    expect(bandClick("mouse", 1, null, A, A)).toBe("reveal");
  });
});
