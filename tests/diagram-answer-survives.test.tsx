// @vitest-environment jsdom
/**
 * **An answer that has landed is not thrown away by a request that fails.**
 *
 * `useSimilar` and `useProjection` each hold one paid answer per article, and
 * the guard beside them has always promised that stepping away from a picture
 * and back "must not throw away an answer already paid for". Only half of that
 * was true: the *spinner* was suppressed while an answer was held, and the
 * `catch` then replaced the answer itself with nothing — so one flaky repeat
 * emptied a complete picture and reported a failure about a picture the reader
 * already had. ⟨Sol⟩, 2026-08-30.
 *
 * **These are hook tests, and they used to be panel tests.** They drove the
 * failure by toggling Force → Drift → Force with the second request refused;
 * `bought` has since made a chip press buy nothing at all, so that path no
 * longer reaches the guard and the panel versions began failing on their own
 * "the second visit did not re-ask, so this proves nothing" assertion. That is
 * the assertion doing its job. The rule is the hook's rather than the panel's,
 * so it is tested where it lives, through the one caller that can still get
 * there: `retry` while an answer is held.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjection, type UseProjection } from "../src/web/useProjection.js";
import { useSimilar, type UseSimilar } from "../src/web/useSimilar.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/**
 * Mount a hook and keep the latest value where the test can reach it.
 *
 * A ref written from a render would be a lie about which render's value it is;
 * an effect runs after commit, so `seen` is always the value the component was
 * last rendered with.
 */
function drive<T>(use: () => T): { latest(): T; rerender(): void } {
  let latest: T;
  function Probe() {
    const value = use();
    useEffect(() => { latest = value; });
    return null;
  }
  const rerender = () => act(() => root.render(<Probe />));
  rerender();
  return { latest: () => latest, rerender };
}

describe("a repeat request that fails, over an answer that already landed", () => {
  it("keeps the embedding model's pairs", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async () => {
      asked += 1;
      return asked === 1
        ? new Response(
            JSON.stringify({ model: "m", blocks: 7, eligible: 7, omitted: 0, pairs: [{ a: "spya-x", b: "spya-y", score: 0.9 }] }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });

    const probe = drive<UseSimilar>(() => useSimilar("s", true));
    await settle();
    expect(probe.latest().status, "the first answer never landed").toBe("ready");
    expect(probe.latest().pairs).toHaveLength(1);

    await act(async () => {
      probe.latest().retry();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "retry did not ask again, so this proves nothing").toBe(2);

    expect(probe.latest().status, "a failed repeat took a good answer down with it").toBe("ready");
    expect(probe.latest().pairs, "the dotted lines were erased by a request about them").toHaveLength(1);
    expect(probe.latest().error, "a failure was reported about a picture that is fine").toBeNull();
  });

  it("keeps the projection's dots", async () => {
    const points = [{ id: "spya-b0", x: -0.4, y: 0.1, c: 0 }];
    let asked = 0;
    vi.stubGlobal("fetch", async () => {
      asked += 1;
      return asked === 1
        ? new Response(
            JSON.stringify({
              model: "m", blocks: 1, k: 1, variance: [0.2, 0.1],
              skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points,
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });

    const probe = drive<UseProjection>(() => useProjection("s", true));
    await settle();
    expect(probe.latest().status, "the first answer never landed").toBe("ready");
    expect(probe.latest().points).toHaveLength(1);

    await act(async () => {
      probe.latest().retry();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "retry did not ask again, so this proves nothing").toBe(2);

    expect(probe.latest().status, "a failed repeat emptied a picture that was drawn").toBe("ready");
    expect(probe.latest().points).toHaveLength(1);
  });

  /**
   * The other half of `bought`: one request per attempt, and a *failed* attempt
   * counts. Without this a picture that failed would re-buy itself on every
   * step away and back, which is the same waste the ready case had and on the
   * article least likely to succeed.
   */
  it("does not re-buy a picture that failed, until the reader asks", async () => {
    let asked = 0;
    let enabled = true;
    vi.stubGlobal("fetch", async () => {
      asked += 1;
      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });

    const probe = drive<UseSimilar>(() => useSimilar("s", enabled));
    await settle();
    expect(probe.latest().status).toBe("error");
    expect(asked).toBe(1);

    /* Away and back twice, which on the panel is two chip presses. The hook
       stays mounted throughout — `enabled` going false is what a chip press
       does to it, not an unmount. */
    for (const on of [false, true, false, true]) {
      enabled = on;
      probe.rerender();
      await settle();
    }
    expect(asked, "stepping away and back bought another failed request").toBe(1);

    await act(async () => {
      probe.latest().retry();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "Try again bought nothing").toBe(2);
  });
});
