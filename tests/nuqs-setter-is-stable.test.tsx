// @vitest-environment jsdom
/**
 * A nuqs setter keeps its identity across renders — which is load-bearing, and
 * is somebody else's implementation detail.
 *
 * `memo(TableView)` (TableView.tsx) is worth about twelve points of a core on a
 * long article, and takes the p95 frame from 50–67ms back to 16.8ms. It holds
 * only if every one of its 29 props is identity-stable on a render caused by
 * `?at=`.
 * One of them, `onJump`, is `jumpTo` — `useCallback(…, [setAt])` in App — and
 * `setAt` comes out of nuqs's `useQueryState`. **If nuqs ever returns a fresh
 * setter per render, the memo silently never matches and the whole change is
 * worth nothing**, with no error and no failing test anywhere else.
 *
 * It is true of the installed 2.10.0: `useQueryState` wraps the multi-key setter
 * in a `useCallback` (`nuqs/dist/index.js:715`), that setter is itself a
 * `useCallback` (`:572`) over memoised parsers (`:495`) and a memoised adapter
 * `updateUrl` (`adapters/react.js:52`). But `package.json` pins `^2.10.0`, so a
 * compatible upgrade may change it, and reading `node_modules` once is not a
 * guarantee — GPT Sol's point, 2026-09-04, reviewing
 * docs/plans/260904a-more-scroll-cpu-wins.md.
 *
 * So the assumption is asserted here rather than trusted. A test on a
 * dependency's behaviour, deliberately: this is the shape of thing that breaks
 * on an upgrade and shows up as a performance regression nobody attributes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryState } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/react";
import { atParam } from "../src/web/params.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, "", "/read/x");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Every setter and derived callback this component has ever been handed. */
const seen: { setters: unknown[]; jumps: unknown[] } = { setters: [], jumps: [] };

function Subject({ tick }: { tick: number }) {
  const [, setAt] = useQueryState("at", atParam);
  /* The shape App uses: a `useCallback` whose only dependency is the setter.
     This is the value that reaches `TableView` as `onJump`. */
  const jumpTo = useCallback((id: string) => void setAt(id), [setAt]);
  seen.setters.push(setAt);
  seen.jumps.push(jumpTo);
  return <span>{tick}</span>;
}

const render = (tick: number) =>
  act(() => {
    root.render(
      <NuqsAdapter>
        <Subject tick={tick} />
      </NuqsAdapter>,
    );
  });

describe("nuqs useQueryState", () => {
  it("hands back the same setter on a re-render, so a useCallback over it is stable", () => {
    seen.setters = [];
    seen.jumps = [];
    render(1);
    render(2);
    render(3);

    // Three renders happened at all — otherwise this test passes by doing nothing.
    expect(seen.setters.length).toBeGreaterThanOrEqual(3);

    const first = seen.setters[0];
    for (const s of seen.setters) expect(s).toBe(first);

    // And therefore the thing App actually passes down is stable too.
    const jump = seen.jumps[0];
    for (const j of seen.jumps) expect(j).toBe(jump);
  });
});
