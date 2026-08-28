// @vitest-environment jsdom
/**
 * **A `<Tooltip>` whose trigger is our own `<Link>` has to reach the `<a>`.**
 *
 * Every other tooltip in the app hangs off a host element — a `<button>`, an
 * `<li>`, a `<span>` — and `Tooltip.tsx` says so: *"A single element that can
 * take a ref and event handlers."* The homepage masthead broke that pattern on
 * 2026-08-28: its Profile, Admin and Design links moved from a plain `title=`
 * attribute to the Floating UI card, and those triggers are `Link`, a function
 * component (Link.tsx).
 *
 * That works because React 19 hands a function component its `ref` as an
 * ordinary prop and `Link` spreads its rest props straight onto the anchor.
 * Nothing enforced it until now: `AnchorHTMLAttributes` does not include `ref`,
 * and `Tooltip` clones its child as `Record<string, unknown>`, so the compiler
 * had no opinion either way, and replacing that spread with a list of named
 * props would have left the masthead's three cards unable to open.
 *
 * **Unable, and silent about it.** `useHover` binds a native `mouseenter`
 * listener to `elements.domReference` — the node the ref gave it — so a
 * swallowed ref means no listener, no card, no error, and a page that looks
 * exactly as it did before the tooltips were added. The third test is that
 * failing case, and it is what makes the second one evidence about the ref
 * rather than about the content.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link } from "../src/web/Link.js";
import { Tooltip } from "../src/web/Tooltip.js";

/* Floating UI's `autoUpdate` observes the trigger for resizes, and jsdom has no
   ResizeObserver at all — without this the first render throws. It only has to
   exist; nothing here measures anything, since every rectangle in jsdom is zero
   in any case. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/* React only flushes inside `act` when it is told it is under test; without it
   the effects that mount the card run after the assertion has read the DOM. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Past `DELAY.open` in Tooltip.tsx, with room to spare. */
const AFTER_THE_DELAY = 500;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Hover the one link on the page, and let the open delay run out. */
async function hoverTheLink() {
  /* A native `mouseenter`, dispatched on the element itself, because that is
     what `useHover` listens for: it adds the listener to the reference node
     rather than going through React, so a bubbling `mouseover` at the root
     would never reach it. */
  host.querySelector("a")?.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

it("hands a ref straight through to the anchor it renders", () => {
  /* A callback ref rather than an object one, so this records what React
     actually attached rather than what we hoped it would. */
  let node: Element | null = null;

  act(() =>
    root.render(
      <Link
        href="/profile"
        ref={(el) => {
          if (el) node = el;
        }}
        onClick={(e) => e.preventDefault()}
      >
        Profile
      </Link>,
    ),
  );

  expect(node).not.toBeNull();
  expect((node as unknown as Element).tagName).toBe("A");
});

it("opens the card when the pointer rests on the link", async () => {
  act(() =>
    root.render(
      <Tooltip content="Signed in as reader@example.com" placement="bottom">
        <Link href="/profile" onClick={(e) => e.preventDefault()}>
          Profile
        </Link>
      </Tooltip>,
    ),
  );

  /* Nothing there before the pointer arrives: a card that were always in the
     DOM would pass the assertion below without the hover doing anything. */
  expect(document.querySelector(".tooltip")).toBeNull();

  await hoverTheLink();

  expect(document.querySelector(".tooltip")?.textContent).toContain("reader@example.com");
});

/**
 * The control for the test above: the same card around a trigger that drops the
 * ref instead of passing it on — `Link` with the one line that matters removed.
 * It must be the failing case, or the test above is about the content and not
 * about the ref at all.
 */
it("cannot open when the trigger swallows the ref", async () => {
  const Swallow = ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  );

  act(() =>
    root.render(
      <Tooltip content="Signed in as reader@example.com" placement="bottom">
        <Swallow href="/profile">Profile</Swallow>
      </Tooltip>,
    ),
  );

  await hoverTheLink();

  expect(document.querySelector(".tooltip")).toBeNull();
});
