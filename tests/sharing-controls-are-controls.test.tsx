// @vitest-environment jsdom
/**
 * **The Access & Sharing card's controls look and behave like controls.**
 *
 * Greg, 2026-09-04:
 *
 * > The Access & Sharing section of Metadata UI is not that great. […] the
 * > Share button should visibly be a button with rich tooltip
 *
 * Two failures sat behind that sentence, and they are opposite halves of one
 * shape: **the buttons did not look like buttons and the labels did.** The
 * Share control was a bare `<button className="linky">` with no border and no
 * padding, while every inventory chip was a bordered rounded rectangle that
 * could not be pressed. So the page's only irreversible control read as a line
 * of prose, next to two dozen things that read as controls and were not.
 *
 * ## The class of bug behind the first half, named
 *
 * **A class name that matches no rule looks exactly like one that works.**
 * `.linky` is scoped on purpose — `.cmt-dialog button.linky`,
 * `.chat-dialog button.linky`, `.annotate-dialog button.linky`, and styles.css
 * says so in as many words (*"a shape, not a shared class"*). (There was a
 * `.controls` one too until the controls bar was emptied on 2026-09-05.) This
 * card is in none of those ancestors, so the class styled nothing at all, from
 * the day the card was written. docs/reusable/silent-success.md.
 *
 * The assertion for that is a DOM *absence*, which is the shape that rots — so
 * it is paired below with the presence that would notice a "fix" consisting of
 * deleting the class and nothing else: the control has to be a real `<button>`
 * carrying `data-slot="button"`, which is what `components/ui/button.tsx` puts
 * on everything it draws.
 *
 * ## The second half: the chips' sentence, reachable without a mouse
 *
 * Each chip carries one sentence saying what the thing is. It lived in a
 * `title` attribute, which has no focus and no tap disclosure in any browser —
 * so a keyboard or touch reader got nothing, on the list whose whole job is to
 * say what a stranger is about to receive. Same family as
 * tests/sketch-caption-is-not-a-native-tooltip.test.tsx, from the other
 * direction: there a native tooltip appeared where it should not, here it was
 * the only disclosure where it could not.
 *
 * Both are checked — no `title` left behind, *and* the sentence reachable by
 * hover and by focus — because either alone passes while the feature is wrong.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArticleSharing, PublicArtefacts } from "../src/types.js";
import { sharedInventory } from "../src/web/shared-inventory.js";
import { SHARING_COPY_TIP, SHARING_OPEN_TIP, SHARING_STOP_TIP } from "../src/messages.js";

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

const { AccessSharing } = await import("../src/web/AccessSharing.js");

/* Something in all three lists: a glossary and quotes built, the rest not. */
const AVAILABLE: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: true,
  ideas: false,
  quotes: true,
  timeline: true,
  sketch: true,
};

const PRIVATE: ArticleSharing = {
  visibility: "private",
  publicAt: null,
  personalised: [],
  available: AVAILABLE,
};
const SHARED: ArticleSharing = {
  visibility: "public",
  publicAt: "2026-08-28T09:00:00.000Z",
  personalised: [],
  available: AVAILABLE,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* The card asks for nothing until a button is pressed, and no test here
     presses one — so a `fetch` reaching this stub is itself the failure. */
  vi.stubGlobal("fetch", () => Promise.reject(new Error("this card should have made no request")));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(sharing: ArticleSharing): Promise<void> {
  await act(async () => {
    root.render(createElement(AccessSharing, { slug: "a-piece", title: "A piece", sharing }));
  });
}

/** The one button whose visible text contains `text`. */
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`No button saying "${text}" — card reads: ${host.textContent}`);
  return found;
}

/**
 * **Open one card on `el` and read it**, then shut it again.
 *
 * The mechanics — and every one of them was found the hard way in
 * tests/referee-tooltips.test.tsx and tests/diagram-panel-hover.test.tsx:
 *
 *  - the panel is portalled to the end of `<body>`, so it is looked for in the
 *    document, and **exactly one** must be open — a neighbour's card left up
 *    would be read as this trigger's;
 *  - closing takes React's synthetic `onMouseLeave`, which it synthesises from
 *    a bubbling `mouseout`, so both events are sent;
 *  - and the close is two timers with a render between them, so it is waited
 *    out twice rather than once for longer.
 */
async function openOn(el: Element, how: "hover" | "focus"): Promise<string> {
  if (how === "hover") el.dispatchEvent(new MouseEvent("mouseenter"));
  else (el as HTMLElement).focus();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, `${how} on this control opened no card, or more than one`).toHaveLength(1);
  const card = cards[0];
  const said = (card?.textContent ?? "").replace(/\s+/g, " ").trim();

  /* **The panel is attached to this trigger, not merely on the screen beside
     it.** Without this the whole helper passes for a tooltip that renders and
     is invisible to assistive technology — which is the exact failure the
     chips' old `title` had in reverse, and it would have read as a green test
     of an accessibility fix that did nothing. GPT Sol, 2026-09-04. */
  expect(
    el.getAttribute("aria-describedby"),
    "the open panel is not wired to its trigger",
  ).toBe(card?.id ?? null);

  if (how === "hover") {
    el.dispatchEvent(new MouseEvent("mouseleave"));
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  } else {
    (el as HTMLElement).blur();
  }
  for (const _ of [0, 1]) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  expect(
    document.querySelectorAll('[role="tooltip"]'),
    "the card did not close, so the next one read here would be this one",
  ).toHaveLength(0);
  return said;
}

/** Every chip in the inventory, in the order they are drawn. */
function chips(): HTMLLIElement[] {
  return [...host.querySelectorAll("li")];
}

/** The one chip whose visible label is exactly `label`. */
function chip(label: string): HTMLLIElement {
  /* `firstChild`, not `textContent`: the chip carries an `sr-only` span with
     the whole sentence in it, so a `textContent` match would find "Glossary"
     inside three other rows' prose. */
  const found = chips().find((c) => (c.firstChild?.textContent ?? "").trim() === label);
  if (!found) throw new Error(`No chip labelled "${label}" — card reads: ${host.textContent}`);
  return found;
}

describe("the buttons are buttons", () => {
  it("draws Share as a real button, not a class that styles nothing", async () => {
    await mount(PRIVATE);
    const share = button("Share with anyone");

    /* The presence half. `data-slot="button"` is what components/ui/button.tsx
       stamps on everything it draws, so this is "the shared Button component
       rendered this" rather than "some element exists". */
    expect(share.tagName).toBe("BUTTON");
    expect(share.dataset.slot).toBe("button");

    /* The absence half — and not only on this button. `.linky` is scoped to
       three ancestors this card is inside none of, so anywhere in here it is a
       class that quietly does nothing. */
    expect(
      host.querySelectorAll(".linky"),
      "`.linky` styles nothing outside .controls / .cmt-dialog / .chat-dialog",
    ).toHaveLength(0);
  });

  it("gives Share a tooltip saying that pressing it shares nothing yet", async () => {
    await mount(PRIVATE);
    /* The one question an owner has with the pointer over that button, on the
       one control here whose act cannot be un-rung. */
    expect(await openOn(button("Share with anyone"), "hover")).toBe(SHARING_OPEN_TIP);
  });

  it("draws Stop sharing and Copy as buttons, each saying what it does", async () => {
    await mount(SHARED);
    /* The tooltips as well as the tag, because the copy is the whole point of
       them: both of these buttons act on a page that is already out, and each
       sentence says which of them changes that and which does not. Checking
       `data-slot` alone left the new copy untested. GPT Sol, 2026-09-04. */
    for (const [text, tip] of [
      ["Stop sharing", SHARING_STOP_TIP],
      ["Copy", SHARING_COPY_TIP],
    ] as const) {
      expect(button(text).dataset.slot, `${text} is not the shared Button`).toBe("button");
      expect(await openOn(button(text), "hover"), `${text} says the wrong thing`).toBe(tip);
    }
  });
});

/**
 * **One row from each of the three lists, named rather than indexed.**
 *
 * The first draft took chips 0, middle and last, which with this fixture is
 * 8 shared + 3 if-built + 12 withheld — so it read shared, withheld, withheld,
 * and never touched `ifBuilt` at all while claiming to cover all three. The
 * three lists are three separate `InventoryList` calls and a wiring mistake
 * would live in exactly one of them. GPT Sol, 2026-09-04.
 *
 * Derived from `sharedInventory` rather than hard-coded, so it cannot drift
 * from the data the card is actually drawing.
 */
function oneFromEachList(): { label: string; detail: string }[] {
  const { shared, ifBuilt, withheld } = sharedInventory(AVAILABLE);
  return [shared, ifBuilt, withheld].map((list) => {
    const first = list[0];
    if (!first) throw new Error("an inventory list came back empty — the fixture no longer works");
    return { label: first.label, detail: first.detail };
  });
}

describe("the chips say what they are, without a mouse", () => {
  it("puts no sentence in a `title`, where only a pointer could reach it", async () => {
    await mount(SHARED);
    expect(chips().length).toBeGreaterThan(10);
    for (const c of chips()) {
      /* The chip *and everything in it* — the sentence lived on the `<li>` and
         a later draft could as easily put it on a span inside. Checking only
         the element the current code happens to use is how an absence
         assertion rots. */
      for (const node of [c, ...c.querySelectorAll("*")]) {
        expect(
          node.getAttribute("title"),
          `"${c.firstChild?.textContent}" still carries a native tooltip`,
        ).toBe(null);
      }
    }
  });

  it("keeps each chip's sentence permanently in the accessibility tree", async () => {
    await mount(SHARED);
    /* **Not the tooltip.** `useRole` supplies `aria-describedby` only while the
       panel is open, and a screen-reader user moving by virtual cursor never
       opens it — so without this span the sentence could never be announced at
       all, which is what `InventoryItem.detail`'s contract promises it is. */
    for (const { label, detail } of oneFromEachList()) {
      expect(chip(label).textContent, `"${label}" has lost its sentence`).toContain(detail);
    }
  });

  it("is not a control, because pressing it does nothing", async () => {
    await mount(SHARED);
    for (const { label } of oneFromEachList()) {
      const c = chip(label);
      /* A `<button>` promises Enter and Space do something. Twenty-three inert
         ones in front of the rights checkbox is worse than the gap they were
         meant to close — see `Inventory` in AccessSharing.tsx. */
      expect(c.querySelector("button"), `"${label}" is a button that does nothing`).toBe(null);
      expect(c.tabIndex, `"${label}" is in the tab order and cannot be operated`).toBe(-1);
    }
  });

  it("opens each chip's own sentence on hover", async () => {
    await mount(SHARED);
    for (const { label, detail } of oneFromEachList()) {
      expect(await openOn(chip(label), "hover")).toBe(detail);
    }
  });
});
