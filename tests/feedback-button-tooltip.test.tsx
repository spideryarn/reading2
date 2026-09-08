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
  FEEDBACK_TRIGGER_SELECTOR,
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
/**
 * The class the trigger wears in each shape.
 *
 * **Read off `FEEDBACK_SHAPE.hook` rather than typed out again**, since the
 * third shape arrived on 2026-09-08. A hand-written map was exhaustive by type
 * — the compiler did refuse a missing row — but the *values* were a second copy
 * of the class names, and nothing would have caught one that had drifted from
 * the `button` string it is supposed to be part of. Now the source of both is
 * one field, and § the shapes below asserts that the hook really is in the
 * class list.
 */
const SELECTOR: Record<FeedbackVariant, string> = Object.fromEntries(
  Object.entries(FEEDBACK_SHAPE).map(([v, shape]) => [v, `.${shape.hook}`]),
) as Record<FeedbackVariant, string>;

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

/**
 * **The same button in the shelf's masthead row**, since 2026-09-08.
 *
 * Greg reported the corner button as missing from the logged-in homepage while
 * it was drawn there at every width with nothing painted over it
 * (SPIDERYARN-READING2-2C). What it was not was *findable*: a bare grey glyph
 * fixed to the **window**, while the shelf's own `Profile`/`Admin` links sat in
 * a cluster a hand's width away. This shape puts it in that cluster.
 *
 * So the assertions are about **belonging to the row**, and the failure they
 * are aimed at is the one the bar's block above names: a variant that reused
 * `.fb-button` would keep `position: fixed; top; right; width:
 * var(--feedback-w)` and paint in the corner again — and inside a right-aligned
 * row that is the *least* obvious place for it to be wrong, because the corner
 * is roughly where the row ends anyway.
 *
 * The one thing this shape does that neither other one does is **keep its word
 * at every width**, and that is not decoration: losing the label below 731px is
 * half of what made the corner button unfindable on the phone Greg was holding.
 */
describe("the Feedback button, in the shelf masthead", () => {
  it("wears its neighbours' classes and none of the corner's", () => {
    mount("masthead");
    const btn = theButton();
    /* The `Profile` and `Admin` links' own class string (Library.tsx).
       Asserted rather than left to the eye because the whole point of this
       shape is to be indistinguishable from them: this control should not be
       able to drift into looking like its own kind of thing. */
    for (const cls of [
      "tw:inline-flex",
      "tw:items-center",
      "tw:gap-1.5",
      "tw:text-xs",
      "tw:text-ink-faint",
    ])
      expect(btn.classList.contains(cls), `missing ${cls}`).toBe(true);
    /* **`p-0` is the one that is not copied from the neighbours**, and the one
       most likely to be dropped as redundant. It is not: the global button
       reset in tailwind.css takes a `<button>`'s border, background and font
       and leaves the UA's `padding: 1px 6px`, which the `<a>`s beside this have
       none of. Measured in Chrome on 2026-09-08 — without it the button is 18px
       tall against their 16 and carries 6px of dead space at each end, so the
       last gap in a `gap-4` row reads as 22px. jsdom has no layout and cannot
       see any of that, which is exactly why the class is pinned here. */
    expect(btn.classList.contains("tw:p-0"), "the UA button padding is back").toBe(true);
    /* **What `p-0` then owes a finger.** The corner trigger this replaces was
       38x44 on a phone; the row's natural height is 16, so without a floor the
       move would have answered a report filed *from* a phone with a smaller
       target than the one being complained about. 2.5rem is the dock's floor
       since 2026-08-28, and `pointer-coarse` rather than `any-pointer-coarse`
       is narrow-window.css § a coarse pointer's convention: sizes follow the
       primary pointer, so a trackpad-equipped iPad is not given 40px of chrome
       it will never touch. Verified at 40px in Chrome with `hasTouch`,
       `isMobile` and a 3x scale factor set together, where `(pointer: coarse)`
       genuinely matches; docs/project/browser-testing-playwright.md says
       `hasTouch` on its own is enough, which was not separately tested here.
       GPT Sol, P2. */
    expect(
      btn.classList.contains("tw:pointer-coarse:min-h-10"),
      "a phone control back under the touch floor",
    ).toBe(true);
    /* The failure mode, exactly as in the bar: `.fb-button` carries
       `position: fixed` and the top-right corner of the window with it. */
    expect(btn.classList.contains("fb-button")).toBe(false);
    expect(host.querySelector(".fb-button")).toBeNull();
    expect(btn.classList.contains("dock-btn")).toBe(false);
  });

  it("keeps its word at every width, unlike both other shapes", () => {
    mount("masthead");
    const word = theButton().querySelector("span");
    expect(word?.textContent).toBe("Feedback");
    /* **An empty class is the assertion**, not an oversight. `.fb-button-text`
       is hidden by the 731px query and `.dock-btn-label` by the bar's fit
       ladder; wearing neither is what makes this label survive. A refactor that
       "tidied" this into one of those would take the word away on a phone,
       which is the defect this shape exists to fix. */
    expect(word?.className).toBe("");
  });

  /** Its card's geometry, against the table — see the bar's block for why. */
  it("is declared to open downwards, and not to flip", () => {
    expect(FEEDBACK_SHAPE.masthead.placement).toBe("bottom");
    /* The row is right-aligned and this is its last control, so a 22rem card
       that cannot centre would flip onto the cross axis and land over the
       shelf's own heading — the corner button's reason, one page over. */
    expect(FEEDBACK_SHAPE.masthead.keepSide).toBe(true);
  });

  it("carries the same name and no title, exactly as the other two do", () => {
    mount("masthead");
    expect(theButton().getAttribute("aria-label")).toBe("Feedback");
    expect(theButton().getAttribute("title")).toBeNull();
  });

  it("matches its neighbours' glyph size rather than the chrome shapes'", () => {
    /* `Profile` and `Admin` draw at 13; the corner and the bar at 15. Same
       argument as the classes: this glyph belongs to the row, not to the
       feature. The other two are here so this is a difference rather than a
       number somebody once typed. */
    expect(FEEDBACK_SHAPE.masthead.icon).toBe(13);
    expect(FEEDBACK_SHAPE.corner.icon).toBe(15);
    expect(FEEDBACK_SHAPE.dock.icon).toBe(15);
  });
});

/**
 * **`hook` is what a count of triggers is written against, so it has to be true
 * of the rendered element** — and that is not something the compiler can say,
 * because `hook` and `button` are two independent strings.
 *
 * The rule it protects is *never two Feedback buttons on one screen*, counted
 * in tests/dock-corner-controls.test.tsx through `FEEDBACK_TRIGGER_SELECTOR`. A
 * shape whose `hook` was not actually in its own `button` class list would be
 * **uncountable**: the count would come back one lower than the truth, and the
 * assertion it feeds would go *green* on a page with two buttons on it. That is
 * the shape docs/reusable/silent-success.md is about, so it is checked by
 * rendering every variant rather than by reading the table.
 */
describe("every shape is countable", () => {
  it("renders an element carrying its own hook class", () => {
    for (const v of Object.keys(FEEDBACK_SHAPE) as FeedbackVariant[]) {
      mount(v);
      const el = host.querySelector(`.${FEEDBACK_SHAPE[v].hook}`);
      expect(el, `${v} renders nothing matching its own hook`).not.toBeNull();
      expect(el?.tagName).toBe("BUTTON");
    }
  });

  it("is named by FEEDBACK_TRIGGER_SELECTOR, whatever shapes exist", () => {
    for (const v of Object.keys(FEEDBACK_SHAPE) as FeedbackVariant[]) {
      mount(v);
      /* The selector the route walk counts with, asked of one shape at a time.
         Adding a fourth variant and forgetting that file makes *this* go red,
         which is the point — the alternative was a hand-listed selector that
         went on passing while silently covering one page fewer. */
      expect(
        host.querySelectorAll(FEEDBACK_TRIGGER_SELECTOR),
        `${v} is invisible to the one-trigger-per-page count`,
      ).toHaveLength(1);
    }
  });
});
