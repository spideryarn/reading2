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
import { act, StrictMode, type ReactNode } from "react";
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
     actually attached rather than what we hoped it would — and it takes
     whatever it is given, `null` included, so that a ref which was attached and
     then detached reads as detached rather than as the node it used to be.
     ⟨Sol, 2026-08-28⟩. */
  let node: Element | null = null;

  act(() =>
    root.render(
      <Link href="/profile" ref={(el) => { node = el; }} onClick={(e) => e.preventDefault()}>
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

/** Everything a trigger is handed, with `ref` named so it can be dropped. */
type SwallowProps = { ref?: unknown; href: string; children?: ReactNode } & Record<string, unknown>;

/**
 * **Both refs, not one.** `Tooltip` merges its own reference ref with whatever
 * ref the trigger already had (`useMergeRefs`), and the two tests above only
 * ever exercise one of them at a time: the first has no tooltip, the second
 * gives the link no ref of its own. This is the case the masthead would hit the
 * day a link wants its own ref, and it runs under `<StrictMode>`, whose
 * attach-detach-reattach cycle is where a merged ref goes wrong if it is going
 * to. ⟨Sol, 2026-08-28⟩.
 */
it("keeps the trigger's own ref as well as its own", async () => {
  let mine: Element | null = null;

  act(() =>
    root.render(
      <StrictMode>
        <Tooltip content="Signed in as reader@example.com" placement="bottom">
          <Link href="/profile" ref={(el) => { mine = el; }} onClick={(e) => e.preventDefault()}>
            Profile
          </Link>
        </Tooltip>
      </StrictMode>,
    ),
  );

  expect((mine as unknown as Element | null)?.tagName).toBe("A");

  await hoverTheLink();

  expect(document.querySelector(".tooltip")?.textContent).toContain("reader@example.com");
});

/**
 * The control for the test above: the same card around a trigger that drops the
 * ref instead of passing it on. It must be the failing case, or the test above
 * is about the content and not about the ref at all.
 *
 * It forwards **everything else** — the handlers, the ARIA — and pulls `ref`
 * out of the spread and drops it on the floor, so the ref is the only
 * difference between this and the test above. An earlier version rendered a
 * bare `<a href>` and dropped every injected prop at once, which would have gone
 * red for any of half a dozen reasons. ⟨Sol, 2026-08-28⟩.
 */
it("cannot open when the trigger swallows the ref", async () => {
  const Swallow = ({ ref: _dropped, href, children, ...rest }: SwallowProps) => (
    <a href={href} {...rest}>
      {children}
    </a>
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
