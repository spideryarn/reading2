// @vitest-environment jsdom
/**
 * **Which live engine a call uses, and who owns it once it has begun.**
 * src/web/live/engine.ts, src/web/live/useLive.ts and the choice in
 * src/web/live/LiveButton.tsx.
 *
 * The plan keeps three things apart (docs/plans/261003a-gpt-live-alongside-
 * realtime-for-live-conversation.md § The engine is pinned to the call): the
 * remembered preference, the engine the next start would use, and the engine
 * that owns the call in progress. Each test here is one way of folding two of
 * them together.
 *
 * Both hooks are replaced by small fakes that only keep a phase. What each
 * hook does with a call is tested in tests/live-session-flow.test.tsx and
 * tests/gpt-live-session-flow.test.tsx; this file is about which one is asked.
 */
import { type ReactNode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveEngine } from "../src/types.js";
import type { LiveApi, LiveOptions } from "../src/web/live/useLiveConversation.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Fake {
  starts: { threadId: string; microphone?: boolean }[];
  stops: number;
  reconnects: number;
  /** What the phase is after the next stop. */
  endsOn: "idle" | "failed";
  set: (patch: Record<string, unknown>) => void;
}

const h = vi.hoisted(() => {
  const fake = (): Fake => ({ starts: [], stops: 0, reconnects: 0, endsOn: "idle", set: () => {} });
  const listeners = new Set<() => void>();
  let setting = { on: false, since: null as string | null, loaded: true };
  return {
    fakes: { realtime: fake(), "gpt-live": fake() } as Record<"realtime" | "gpt-live", Fake>,
    fresh: fake,
    experimental: {
      get: () => setting,
      set: (next: { on: boolean; loaded?: boolean }) => {
        setting = { on: next.on, since: next.on ? "2026-10-03T00:00:00Z" : null, loaded: next.loaded ?? true };
        for (const listener of listeners) listener();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

async function fakeHook(name: "realtime" | "gpt-live") {
  const { useCallback, useState } = await import("react");
  return () => {
    const [state, setState] = useState<Record<string, unknown>>({
      phase: "idle",
      error: null,
      hasUnsavedLines: false,
      threadId: null,
    });
    h.fakes[name].set = (patch) => setState((s) => ({ ...s, ...patch }));
    const start = useCallback((o: { threadId: string; microphone?: boolean }) => {
      h.fakes[name].starts.push(o);
      setState((s) => ({ ...s, phase: "connecting", threadId: o.threadId, error: null }));
    }, []);
    const stop = useCallback(async () => {
      h.fakes[name].stops += 1;
      setState((s) => ({ ...s, phase: h.fakes[name].endsOn }));
    }, []);
    const reconnect = useCallback(() => {
      h.fakes[name].reconnects += 1;
    }, []);
    return { ...state, lines: [], placement: null, tag: name, start, stop, reconnect };
  };
}

vi.mock("../src/web/live/useLiveConversation.js", async () => ({ useLiveConversation: await fakeHook("realtime") }));
vi.mock("../src/web/live/gpt-live/useGptLive.js", async () => ({ useGptLive: await fakeHook("gpt-live") }));
vi.mock("../src/web/useExperimental.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useExperimental: () => useSyncExternalStore(h.experimental.subscribe, h.experimental.get) };
});

const engine = await import("../src/web/live/engine.js");
const { useLive } = await import("../src/web/live/useLive.js");
const { LiveButton } = await import("../src/web/live/LiveButton.js");

/** A `localStorage` that works, which jsdom under vitest does not reliably give. */
function storage(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  const fakeStorage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
  vi.stubGlobal("localStorage", fakeStorage);
  Object.defineProperty(window, "localStorage", { configurable: true, value: fakeStorage });
  return held;
}

let roots: Root[] = [];

beforeEach(() => {
  h.fakes.realtime = h.fresh();
  h.fakes["gpt-live"] = h.fresh();
  h.experimental.set({ on: false });
  storage();
  engine.resetEngineForTests();
});

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const tagOf = (api: LiveApi) => (api as unknown as { tag: LiveEngine }).tag;

function mountLive() {
  let api: LiveApi | null = null;
  const opts: LiveOptions = {};
  function Probe(): ReactNode {
    api = useLive("a-slug", opts);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    const root = createRoot(host);
    roots.push(root);
    root.render(createElement(Probe));
  });
  return () => {
    if (!api) throw new Error("the hook never rendered");
    return api as LiveApi;
  };
}

const tick = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

describe("the three things, as pure rules", () => {
  it("reads only the two names out of storage", () => {
    expect(engine.parseEngine("gpt-live")).toBe("gpt-live");
    expect(engine.parseEngine("realtime")).toBe("realtime");
    expect(engine.parseEngine("GPT-Live")).toBeNull();
    expect(engine.parseEngine("")).toBeNull();
    expect(engine.parseEngine(null)).toBeNull();
  });

  it("with Experimental off the engine is Realtime, whatever was chosen", () => {
    expect(engine.effectiveEngine("gpt-live", false)).toBe("realtime");
    expect(engine.effectiveEngine(null, false)).toBe("realtime");
  });

  it("with Experimental on it is the choice, or the default before there is one", () => {
    expect(engine.effectiveEngine("gpt-live", true)).toBe("gpt-live");
    expect(engine.effectiveEngine("realtime", true)).toBe("realtime");
    expect(engine.effectiveEngine(null, true)).toBe(engine.DEFAULT_EXPERIMENTAL_ENGINE);
  });

  it("a call is owned from connecting until its hang-up has finished", () => {
    expect(engine.owningEngine({ realtime: "idle", "gpt-live": "idle" })).toBeNull();
    expect(engine.owningEngine({ realtime: "failed", "gpt-live": "idle" })).toBeNull();
    expect(engine.owningEngine({ realtime: "connecting", "gpt-live": "idle" })).toBe("realtime");
    expect(engine.owningEngine({ realtime: "idle", "gpt-live": "live" })).toBe("gpt-live");
    expect(engine.owningEngine({ realtime: "failed", "gpt-live": "closing" })).toBe("gpt-live");
  });
});

describe("the remembered preference", () => {
  it("is read from this browser, and a choice is written back", () => {
    const held = storage({ [engine.ENGINE_KEY]: "gpt-live" });
    engine.resetEngineForTests();
    expect(engine.rememberedEngine()).toBe("gpt-live");
    engine.rememberEngine("realtime");
    expect(held.get(engine.ENGINE_KEY)).toBe("realtime");
    expect(engine.rememberedEngine()).toBe("realtime");
  });

  it("reads anything else in storage as not chosen yet", () => {
    storage({ [engine.ENGINE_KEY]: "gpt-live-2" });
    engine.resetEngineForTests();
    expect(engine.rememberedEngine()).toBeNull();
  });

  it("survives storage that throws, and the choice still holds for the visit", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: broken });
    engine.resetEngineForTests();
    expect(engine.rememberedEngine()).toBeNull();
    engine.rememberEngine("gpt-live");
    expect(engine.rememberedEngine()).toBe("gpt-live");
  });
});

describe("where a start goes", () => {
  it("Realtime while Experimental is off, even with GPT-Live remembered", () => {
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes.realtime.starts).toEqual([{ threadId: "t1" }]);
    expect(h.fakes["gpt-live"].starts).toEqual([]);
    expect(tagOf(live())).toBe("realtime");
    expect(live().phase).toBe("connecting");
  });

  it("GPT-Live when Experimental is on and it was chosen", () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1", microphone: false }));
    expect(h.fakes["gpt-live"].starts).toEqual([{ threadId: "t1", microphone: false }]);
    expect(h.fakes.realtime.starts).toEqual([]);
    expect(tagOf(live())).toBe("gpt-live");
  });

  it("the default while Experimental is on and nothing was chosen", () => {
    h.experimental.set({ on: true });
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes[engine.DEFAULT_EXPERIMENTAL_ENGINE].starts).toHaveLength(1);
  });

  it("is refused while the other engine still has a call", () => {
    h.experimental.set({ on: true });
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes.realtime.starts).toHaveLength(1);
    act(() => engine.rememberEngine("gpt-live"));
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toEqual([]);
  });
});

describe("the engine is pinned to the call", () => {
  it("a change of preference mid-call changes neither what the page sees nor what Stop stops", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));

    act(() => engine.rememberEngine("realtime"));
    expect(tagOf(live())).toBe("gpt-live");
    expect(live().phase).toBe("live");

    await act(async () => { await live().stop(); });
    expect(h.fakes["gpt-live"].stops).toBe(1);
    expect(h.fakes.realtime.stops).toBe(0);
    /* The call is over, so the page now sees the engine the next start would use. */
    expect(tagOf(live())).toBe("realtime");
  });

  it("turning Experimental off ends a GPT-Live call, once, by the ordinary hang-up", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    expect(h.fakes["gpt-live"].stops).toBe(0);

    await act(async () => { h.experimental.set({ on: false }); });
    expect(h.fakes["gpt-live"].stops).toBe(1);
    expect(h.fakes.realtime.starts).toEqual([]);
    expect(tagOf(live())).toBe("realtime");
    expect(live().phase).toBe("idle");
  });

  it("does not hang up while the setting is only being re-read", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: false, loaded: false }); });
    expect(h.fakes["gpt-live"].stops).toBe(0);
    /* Still the owner's api, though the next start would now be Realtime's. */
    expect(tagOf(live())).toBe("gpt-live");
  });

  it("leaves a Realtime call alone when Experimental changes", async () => {
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });
    await act(async () => { h.experimental.set({ on: false }); });
    expect(h.fakes.realtime.stops).toBe(0);
    /* Nor is the idle GPT-Live hook asked to hang up a call it does not have. */
    expect(h.fakes["gpt-live"].stops).toBe(0);
    expect(tagOf(live())).toBe("realtime");
  });

  it("keeps a failed call's engine on screen until the next start", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "failed", error: "The live connection was lost." }));

    await act(async () => { h.experimental.set({ on: false }); });
    expect(tagOf(live())).toBe("gpt-live");
    expect(live().error).toBe("The live connection was lost.");

    /* Retry goes to the engine the reader would now get, and the page follows. */
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes.realtime.starts).toHaveLength(1);
    expect(tagOf(live())).toBe("realtime");
  });
});

describe("Reconnect asks again", () => {
  it("is the hook's own reconnect when the engine has not changed", () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    act(() => live().reconnect());
    expect(h.fakes["gpt-live"].reconnects).toBe(1);
    expect(h.fakes["gpt-live"].stops).toBe(0);
  });

  it("hangs up the owner and starts the engine now in effect, on the same conversation", async () => {
    /* A Realtime call, begun before Experimental was switched on with GPT-Live chosen. */
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1", microphone: false }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });
    expect(tagOf(live())).toBe("realtime");

    act(() => live().reconnect());
    await tick();
    expect(h.fakes.realtime.reconnects).toBe(0);
    expect(h.fakes.realtime.stops).toBe(1);
    expect(h.fakes["gpt-live"].starts).toEqual([{ threadId: "t1", microphone: false }]);
    expect(tagOf(live())).toBe("gpt-live");
  });

  it("does not restart if the reader hangs up in between", async () => {
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });

    act(() => {
      live().reconnect();
      void live().stop();
    });
    await tick();
    expect(h.fakes["gpt-live"].starts).toEqual([]);
  });

  it("does not restart after a hang-up that failed", async () => {
    engine.rememberEngine("gpt-live");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });
    h.fakes.realtime.endsOn = "failed";
    act(() => live().reconnect());
    await tick();
    expect(h.fakes["gpt-live"].starts).toEqual([]);
  });
});

describe("the choice in the Live control", () => {
  function mountButton(phase: LiveApi["phase"] = "idle") {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const live = { phase, placement: null, stop: async () => {} } as unknown as LiveApi;
    act(() => {
      const root = createRoot(host);
      roots.push(root);
      root.render(createElement(LiveButton, { live, onStart: () => {} }));
    });
    return () => host.querySelector<HTMLSelectElement>(".chat-live-engine select");
  }

  it("is not there with Experimental off", () => {
    engine.rememberEngine("gpt-live");
    const select = mountButton();
    expect(select()).toBeNull();
    expect(document.body.textContent).not.toMatch(/GPT-Live/);
  });

  it("offers the two engines with Experimental on, showing the one in effect", () => {
    h.experimental.set({ on: true });
    const select = mountButton();
    expect([...(select()?.options ?? [])].map((o) => [o.value, o.textContent, o.title])).toEqual([
      ["realtime", "Realtime", "One model listens and answers"],
      ["gpt-live", "GPT-Live (new)", "A voice that keeps listening while a second model checks the article"],
    ]);
    expect(select()?.value).toBe(engine.DEFAULT_EXPERIMENTAL_ENGINE);
    expect(select()?.disabled).toBe(false);
  });

  it("remembers a choice, and shows it", () => {
    h.experimental.set({ on: true });
    const select = mountButton();
    const el = select();
    if (!el) throw new Error("no engine choice rendered");
    act(() => {
      el.value = "gpt-live";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(engine.rememberedEngine()).toBe("gpt-live");
    expect(select()?.value).toBe("gpt-live");
  });

  it.each(["connecting", "live", "closing"] as const)("cannot be changed while a call is %s", (phase) => {
    h.experimental.set({ on: true });
    const select = mountButton(phase);
    expect(select()?.disabled).toBe(true);
  });

  it("appears and disappears with the switch, without a reload", async () => {
    const select = mountButton();
    expect(select()).toBeNull();
    await act(async () => { h.experimental.set({ on: true }); });
    expect(select()).not.toBeNull();
    await act(async () => { h.experimental.set({ on: false }); });
    expect(select()).toBeNull();
  });
});
