// @vitest-environment jsdom
/**
 * **The Feedback button's hover card, and the `title` attribute it replaced.**
 *
 * Greg asked for the card on 2026-09-03. The reason it needs a test at all is
 * the one docs/project/tooltips.md § `ControlTip` gives about every card here:
 * a `title` attribute is not a small version of a tooltip, and the difference
 * is invisible on a laptop — a `title` still shows *something* after a second,
 * so a browser pass reports "the tooltip works" over the top of the regression.
 * `tests/diagram-panel-hover.test.tsx` and `tests/referee-tooltips.test.tsx`
 * assert the absence of `title` for exactly that reason; this is the third.
 *
 * **The `aria-label` is the other half and is the half that would rot quietly.**
 * Below the narrow breakpoint the word "Feedback" is `display: none`
 * (styles.css § feedback), which takes it out of the accessibility tree as well
 * as off the screen. Until this change the `title` was supplying the name; with
 * it gone, the `aria-label` is the only thing standing between a phone reader
 * and an unlabelled icon — and nothing on a wide screen, where the visible word
 * names the button perfectly well, would ever show that it had been deleted.
 *
 * This mounts the trigger directly, inside its host, which
 * tests/feedback-button-visibility.test.tsx deliberately does not: that file is
 * about *where* the triggers are mounted, which only the real `App` can answer.
 * This one is about what a trigger itself renders.
 *
 * **The host is not scenery.** `FeedbackTrigger` reads `open()` off a context
 * and renders **nothing** when there is none — that is how a signed-out reader
 * gets no button without every mount site carrying a gate (FeedbackButton.tsx
 * § Who sees it). So a version of this file that rendered the trigger bare
 * would find no element at all and fail on every line, which is the right
 * failure but not an informative one; the wrapper is here to make the subject
 * of the file the button rather than the context.
 *
 * ## Both shapes, because they are one component with a variant
 *
 * The corner button and the bar's button differ in three things — their
 * classes, which side their card opens on, and whether the card is allowed to
 * flip to the cross axis — and share the name, the icon and the word. Splitting
 * the assertions by variant is what stops a change to one silently taking the
 * other with it: the accessible name in particular is carried by `aria-label`
 * on both, and both hide their visible word at some width, by two entirely
 * different mechanisms (the 731px query, and § the bar's fit ladder).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FEEDBACK_SHAPE,
  FeedbackHost,
  FeedbackTrigger,
  type FeedbackVariant,
} from "../src/web/FeedbackButton.js";

/* The dialog is mounted for the life of the page whether or not it is open
   (FeedbackDialog.tsx), and it reaches for a Supabase session and a microphone
   on the way. Neither is anything to do with the button's label, and a real one
   would make this file about the environment instead. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

/* React only treats `act()` as authoritative when this is set, and without it
   every render below logs "The current testing environment is not configured to
   support act(...)" — noise that hides a real warning. The neighbouring suites
   set it the same way (tests/spine-card.test.tsx). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** Which shape is on screen, set by `mount` and read by `theButton`. */
let variant: FeedbackVariant = "corner";
/** The class the trigger wears in each shape. */
const SELECTOR: Record<FeedbackVariant, string> = {
  corner: ".fb-button",
  dock: ".dock-feedback",
};

/**
 * Render one shape, inside its host.
 *
 * Called by each case rather than done in `beforeEach`, because the variant is
 * a property of the case and an inner `beforeEach` would run *after* the outer
 * one — so the render would always have used whatever the previous case left
 * behind. Cheap to get wrong quietly: the corner shape is the default, so a
 * "dock" case would have gone green against a corner button.
 */
function mount(v: FeedbackVariant): void {
  variant = v;
  act(() =>
    root.render(
      <FeedbackHost>
        <FeedbackTrigger variant={v} />
      </FeedbackHost>,
    ),
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mount("corner");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const theButton = () => {
  const el = host.querySelector(SELECTOR[variant]);
  /* Not an optional chain onto `null`: `FeedbackTrigger` renders nothing when
     it cannot find a host, so a broken context would otherwise show up as
     `undefined` assertions failing one by one rather than as the one fact. */
  expect(el, `no ${variant} trigger on screen`).not.toBeNull();
  return el as HTMLElement;
};

/**
 * Open the card the way a pointer does.
 *
 * A **native** `mouseenter` dispatched on the trigger, because `useHover` binds
 * that listener to the reference node rather than going through React, so a
 * bubbling `mouseover` never reaches it — tests/tooltip-on-link.test.tsx has
 * the measurement. Then the open delay waited out for real: this button is not
 * inside a `TooltipGroup`, so the delay is `Tooltip.tsx`'s own 240ms.
 */
async function openCard(): Promise<Element> {
  /* **Nothing open before the pointer arrives**, and this line is the control
     for every assertion below it. Without it a card that was mounted
     unconditionally — or one left up by the previous test — would satisfy the
     "exactly one" check underneath, and every word assertion would be reading a
     panel this test never opened. GPT Sol asked for it, 2026-09-03. */
  expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0);
  theButton().dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering the button opened no card, or more than one").toHaveLength(1);
  return cards[0] as Element;
}

describe("the Feedback button", () => {
  it("opens a card on hover, headed with the control's own name", async () => {
    const card = await openCard();
    expect(card.querySelector(".tip-soon-head")?.textContent).toBe("Feedback");
  });

  it("says what the report carries, which is the half a press would not tell you", async () => {
    const card = await openCard();
    const paras = [...card.querySelectorAll("p")].map((p) => p.textContent ?? "");
    expect(paras).toHaveLength(2);
    /* Not the wording — that is copy and will change. What is pinned is that
       the second paragraph is about the thing a reader hesitates over before
       pressing Send: what rides along with their words, and which part of it is
       theirs to withhold. docs/project/privacy.md § What a bug report carries.

       **Four facts, because there are three different conditions and the first
       draft of this card collapsed them into two.** The address and the email
       go unconditionally; the diagnostics blob is the tick-box's; the
       screenshot is sent whenever one is attached, tick-box or not. The card
       said the box covered the screenshot as well, which was false, and GPT Sol
       caught it (2026-09-03). Hence the last two assertions: they are what
       stops that particular over-promise coming back. */
    const how = paras[1] ?? "";
    expect(how).toMatch(/address/i);
    expect(how).toMatch(/email address/i);
    expect(how).toMatch(/diagnostics[^.]*tick the box/i);
    expect(how).toMatch(/screenshot[^.]*attach/i);
    /* **And the tick-box clause must not mention the screenshot**, which is the
       actual failure rather than a proxy for it. The four assertions above all
       pass on "diagnostics and a screenshot go only if you tick the box; a
       screenshot only if attached" — a sentence that is both self-contradictory
       and wrong in exactly the old way. GPT Sol, second pass, 2026-09-03. */
    const tickClause = how.split(/[,;.]/).find((c) => /tick the box/i.test(c)) ?? "";
    expect(tickClause).not.toMatch(/screenshot/i);
  });

  it("does not fall back on a title attribute", () => {
    // The regression this whole file exists for, and the one a screenshot
    // review cannot see. docs/project/tooltips.md § ControlTip.
    expect(theButton().getAttribute("title")).toBeNull();
  });

  it("still has an accessible name once the word is hidden", () => {
    // At narrow widths `.fb-button-text` is `display: none`, so the visible
    // word is not available to name it and the `aria-label` is all there is.
    expect(theButton().getAttribute("aria-label")).toBe("Feedback");
  });
});

/**
 * **The same button in the bottom bar**, since 2026-09-06.
 *
 * Three of these are about the trap Fable and GPT Sol both named: the corner
 * button is `position: fixed` in the top-right with a `--feedback-w` width, so
 * a version that reused `.fb-button` in the bar would **paint in the corner**
 * while a "one trigger per route" test went green over a visibly wrong bar.
 * Nothing in jsdom can see paint, so what is asserted instead is the three
 * things the paint follows from: the classes it wears, the class it does not,
 * and the class its word wears — which is what decides whether § the bar's fit
 * ladder can take it or whether the 731px query does.
 */
describe("the Feedback button, in the bar", () => {
  it("wears the bar's own classes and none of the corner's", () => {
    mount("dock");
    const btn = theButton();
    expect(btn.classList.contains("dock-btn")).toBe(true);
    /* The corner class is the failure mode, not a stylistic preference: it
       carries `position: fixed; top; right; width: var(--feedback-w)`. */
    expect(btn.classList.contains("fb-button")).toBe(false);
    expect(host.querySelector(".fb-button")).toBeNull();
  });

  it("puts its word under the fit ladder rather than under the 731px query", () => {
    mount("dock");
    const word = theButton().querySelector("span");
    expect(word?.textContent).toBe("Feedback");
    /* `.dock-btn-label` is what every rung's selector is written against;
       `.fb-button-text` is what the narrow-window query hides. GPT Sol, G7. */
    expect(word?.className).toBe("dock-btn-label");
  });

  /**
   * **The one thing here jsdom cannot see, asserted against the table
   * instead.**
   *
   * A `bottom` card on this button would be drawn *under* the bar it belongs
   * to, and a `keepSide` one would refuse to flip out of the way. Neither is
   * visible without layout: floating-ui resolves both against rects that are
   * all zeroes here, and nothing it renders records which side it chose. So
   * what is checked is `FEEDBACK_SHAPE`, which is the value the component
   * passes — and the classes asserted above are what prove the component reads
   * the row it is being checked against. A browser pass is still the only thing
   * that can say the card lands where it should.
   */
  it("is declared to open upwards, and to be free to flip", () => {
    expect(FEEDBACK_SHAPE.dock.placement).toBe("top");
    expect(FEEDBACK_SHAPE.dock.keepSide).toBe(false);
    /* The corner beside it, so this is a difference rather than a coincidence:
       it opens downwards, and it may not flip, because it is hard against the
       right edge with the article's title to its left. */
    expect(FEEDBACK_SHAPE.corner.placement).toBe("bottom");
    expect(FEEDBACK_SHAPE.corner.keepSide).toBe(true);
  });

  it("carries the same name and no title, exactly as the corner does", () => {
    mount("dock");
    expect(theButton().getAttribute("aria-label")).toBe("Feedback");
    expect(theButton().getAttribute("title")).toBeNull();
  });
});
