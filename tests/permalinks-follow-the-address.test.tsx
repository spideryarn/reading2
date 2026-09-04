// @vitest-environment jsdom
/**
 * A block permalink shows the address the reader is actually at — including
 * the parameters no component in the reading view is subscribed to.
 *
 * ## The bug this exists to stop, which never shipped
 *
 * `blockHref` (BlockRef.tsx) builds 551 permalinks a render by reading the
 * query string, and its docstring justified that with "every parameter in the
 * URL is `useQueryState` in App, so any change to the query string re-renders
 * this whole tree". That was half true. **nuqs subscriptions are key-isolated**
 * — the adapter filters `location.search` to the keys each hook watches and
 * returns the cached snapshot when those are unchanged — so a parameter owned
 * by a *child* wakes only that child. `deep`, `diagram`, `dx`, `dhue`,
 * `referee`, `remember`, `rank`, `bar`, `run` and `conf` are all like that.
 *
 * It never bit, because `?at=` re-rendered the reading view seventy-odd times a
 * scroll and refreshed every href on the way past. Wrapping `TableView` in
 * `memo` took that away and turned a self-healing staleness into a permanent
 * one: a reader changes the diagram's hue, copies a paragraph's link, and sends
 * somebody the view they had a minute ago. Found by GPT Sol, 2026-09-04,
 * reviewing the plan rather than the code.
 *
 * So the fix is `watchHistoryWrites` + `useAddressSearch` (router.ts), and this
 * is the test that would have caught the hole. **Watched red first**: with the
 * subscription removed and `location.search` read directly, the href keeps the
 * old `?dhue=`.
 *
 * Deliberately about the *mechanism* rather than about `TableView`: rendering
 * the real reading view here would need the whole fixture apparatus, and the
 * property that matters — "a history write anybody makes reaches a subscriber"
 * — is exactly what this checks, one layer down where it cannot be faked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { blockHref } from "../src/web/BlockRef.js";
import { addressWithout, useAddress, watchHistoryWrites } from "../src/web/router.js";
import type { BlockId } from "../src/types.js";

const ID = "spya-k3m9qt" as BlockId;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, "", "/read/x?cols=0,2&dhue=identity");
  watchHistoryWrites();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The gutter's link, as the reader would see it, for a component that subscribes. */
function Permalink() {
  const linkBase = addressWithout(useAddress(), "at");
  return (
    <a id="p" href={blockHref(ID, linkBase)}>
      link
    </a>
  );
}

const href = () => host.querySelector<HTMLAnchorElement>("#p")?.getAttribute("href") ?? "";

describe("a block permalink follows the address bar", () => {
  it("carries the view state, with its own at= on the end", () => {
    act(() => root.render(<Permalink />));
    expect(href()).toBe(`/read/x?cols=0,2&dhue=identity&at=${ID}`);
  });

  /**
   * The whole point. Nothing here is subscribed to `dhue` — in the real app it
   * belongs to the Diagram panel, well below the memo boundary — and the link
   * must still change.
   */
  it("follows a parameter no component here subscribes to", () => {
    act(() => root.render(<Permalink />));
    act(() => {
      history.replaceState(null, "", "/read/x?cols=0,2&dhue=valence");
    });
    expect(href()).toBe(`/read/x?cols=0,2&dhue=valence&at=${ID}`);
  });

  /**
   * `?at=` is the one parameter that must **not** invalidate anything: it is
   * overwritten below, and it is written on every scroll. If it changed the
   * carried string, `memo(TableView)` would never hold and the whole change
   * would be worthless.
   */
  it("is unchanged by a new ?at=, which is what lets the memo hold", () => {
    const before = addressWithout(location.pathname + location.search, "at");
    history.replaceState(null, "", "/read/x?cols=0,2&dhue=identity&at=spya-p7w2dn");
    expect(addressWithout(location.pathname + location.search, "at")).toBe(before);
  });

  /**
   * **The pathname counts too**, and the first version of this got it wrong: it
   * subscribed to `location.search` alone while `blockHref` also read
   * `location.pathname`, so a write that changed only the path left the
   * snapshot equal, the memo holding, and 551 links on the old spelling.
   * `/read/x` and `/read/x/` are the same route as far as router.ts is
   * concerned, so this is reachable rather than theoretical. GPT Sol
   * reproduced it before it could ship, 2026-09-04.
   */
  it("follows a change to the pathname alone", () => {
    act(() => root.render(<Permalink />));
    act(() => {
      history.replaceState(null, "", "/read/x/?cols=0,2&dhue=identity");
    });
    expect(href()).toBe(`/read/x/?cols=0,2&dhue=identity&at=${ID}`);
  });

  /** No query at all: the link has to open one rather than append to nothing. */
  it("writes its own ? when the address has no query", () => {
    act(() => {
      history.replaceState(null, "", "/read/x");
      root.render(<Permalink />);
    });
    expect(href()).toBe(`/read/x?at=${ID}`);
  });

  /**
   * `?%61t=` is `?at=`, and a textual filter for `at=` does not see it — the
   * ninth address bug in this codebase and the second of that exact shape
   * (router.ts § `hasKey`). Left both in the query, the reader gets the *stale*
   * one, because `get("at")` returns the first match.
   */
  it("drops a percent-encoded at= as well as a plain one", () => {
    expect(addressWithout("/read/x?%61t=spya-old&cols=1", "at")).toBe("/read/x?cols=1");
  });

  /**
   * The old implementation round-tripped through `URLSearchParams`, which
   * re-encodes `?cols=0,2` as `?cols=0%2C2` — still correct, still parses, and
   * no longer readable by the person you send it to. router.ts § `carriedSearch`
   * and params.ts both refuse that round trip; this one was quietly doing it.
   */
  it("does not re-encode a comma in the query it carries", () => {
    expect(blockHref(ID, "cols=0,2")).toContain("cols=0,2");
  });
});
