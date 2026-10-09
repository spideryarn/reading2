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

  it("GPT-Live is the default (Greg, spya-t858ug)", () => {
    expect(engine.DEFAULT_ENGINE).toBe("gpt-live");
  });

  it("with Experimental off the engine is GPT-Live, whatever was chosen", () => {
    expect(engine.effectiveEngine("realtime", false)).toBe("gpt-live");
    expect(engine.effectiveEngine(null, false)).toBe("gpt-live");
  });

  it("with Experimental on it is the choice, or GPT-Live before there is one", () => {
    expect(engine.effectiveEngine("gpt-live", true)).toBe("gpt-live");
    expect(engine.effectiveEngine("realtime", true)).toBe("realtime");
    expect(engine.effectiveEngine(null, true)).toBe("gpt-live");
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
  it("GPT-Live while Experimental is off, even with Realtime remembered", () => {
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toEqual([{ threadId: "t1" }]);
    expect(h.fakes.realtime.starts).toEqual([]);
    expect(tagOf(live())).toBe("gpt-live");
    expect(live().phase).toBe("connecting");
  });

  it("Realtime when Experimental is on and it was chosen", () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1", microphone: false }));
    expect(h.fakes.realtime.starts).toEqual([{ threadId: "t1", microphone: false }]);
    expect(h.fakes["gpt-live"].starts).toEqual([]);
    expect(tagOf(live())).toBe("realtime");
  });

  it("GPT-Live while Experimental is on and nothing was chosen", () => {
    h.experimental.set({ on: true });
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toHaveLength(1);
    expect(h.fakes.realtime.starts).toEqual([]);
  });

  it("a remembered Realtime choice stands while the setting is still being read", () => {
    h.experimental.set({ on: false, loaded: false });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes.realtime.starts).toHaveLength(1);
    expect(h.fakes["gpt-live"].starts).toEqual([]);
  });

  it("while the setting is being read and nothing was chosen, GPT-Live", () => {
    h.experimental.set({ on: false, loaded: false });
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toHaveLength(1);
  });

  it("is refused while the other engine still has a call", () => {
    h.experimental.set({ on: true });
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toHaveLength(1);
    act(() => engine.rememberEngine("realtime"));
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes.realtime.starts).toEqual([]);
  });
});

describe("the engine is pinned to the call", () => {
  it("a change of preference mid-call changes neither what the page sees nor what Stop stops", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));

    act(() => engine.rememberEngine("gpt-live"));
    expect(tagOf(live())).toBe("realtime");
    expect(live().phase).toBe("live");

    await act(async () => { await live().stop(); });
    expect(h.fakes.realtime.stops).toBe(1);
    expect(h.fakes["gpt-live"].stops).toBe(0);
    /* The call is over, so the page now sees the engine the next start would use. */
    expect(tagOf(live())).toBe("gpt-live");
  });

  it("turning Experimental off ends a Realtime call, once, by the ordinary hang-up", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    expect(h.fakes.realtime.stops).toBe(0);

    await act(async () => { h.experimental.set({ on: false }); });
    expect(h.fakes.realtime.stops).toBe(1);
    expect(h.fakes["gpt-live"].starts).toEqual([]);
    expect(tagOf(live())).toBe("gpt-live");
    expect(live().phase).toBe("idle");
  });

  it("a Realtime call begun while the setting loaded is ended if it turns out off", async () => {
    h.experimental.set({ on: false, loaded: false });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    expect(h.fakes.realtime.stops).toBe(0);
    await act(async () => { h.experimental.set({ on: false, loaded: true }); });
    expect(h.fakes.realtime.stops).toBe(1);
  });

  it("asks nobody to hang up when there is no call", async () => {
    engine.rememberEngine("realtime");
    mountLive();
    await act(async () => { h.experimental.set({ on: true }); });
    await act(async () => { h.experimental.set({ on: false }); });
    expect(h.fakes.realtime.stops).toBe(0);
    expect(h.fakes["gpt-live"].stops).toBe(0);
  });

  it("keeps a Realtime call's failed hang-up on screen after Experimental is turned off", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    /* The automatic hang-up is the one that fails. */
    h.fakes.realtime.endsOn = "failed";
    await act(async () => { h.experimental.set({ on: false }); });
    expect(h.fakes.realtime.stops).toBe(1);
    expect(tagOf(live())).toBe("realtime");
    expect(live().phase).toBe("failed");

    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toHaveLength(1);
    expect(tagOf(live())).toBe("gpt-live");
  });

  it("does not hang up while the setting is only being re-read", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: false, loaded: false }); });
    expect(h.fakes.realtime.stops).toBe(0);
    /* Still the owner's api, though the next start would now be GPT-Live's. */
    expect(tagOf(live())).toBe("realtime");
  });

  it("leaves a GPT-Live call alone when Experimental changes", async () => {
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });
    await act(async () => { h.experimental.set({ on: false }); });
    expect(h.fakes["gpt-live"].stops).toBe(0);
    /* Nor is the idle Realtime hook asked to hang up a call it does not have. */
    expect(h.fakes.realtime.stops).toBe(0);
    expect(tagOf(live())).toBe("gpt-live");
  });

  it("keeps a failed call's engine on screen until the next start", async () => {
    h.experimental.set({ on: true });
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes.realtime.set({ phase: "failed", error: "The live connection was lost." }));

    await act(async () => { h.experimental.set({ on: false }); });
    expect(tagOf(live())).toBe("realtime");
    expect(live().error).toBe("The live connection was lost.");

    /* Retry goes to the engine the reader would now get, and the page follows. */
    act(() => live().start({ threadId: "t1" }));
    expect(h.fakes["gpt-live"].starts).toHaveLength(1);
    expect(tagOf(live())).toBe("gpt-live");
  });
});

describe("Reconnect asks again", () => {
  it("is the hook's own reconnect when the engine has not changed", () => {
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    act(() => live().reconnect());
    expect(h.fakes["gpt-live"].reconnects).toBe(1);
    expect(h.fakes["gpt-live"].stops).toBe(0);
  });

  it("hangs up the owner and starts the engine now in effect, on the same conversation", async () => {
    /* A GPT-Live call, begun before Experimental was switched on with Realtime chosen. */
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1", microphone: false }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });
    expect(tagOf(live())).toBe("gpt-live");

    act(() => live().reconnect());
    await tick();
    expect(h.fakes["gpt-live"].reconnects).toBe(0);
    expect(h.fakes["gpt-live"].stops).toBe(1);
    expect(h.fakes.realtime.starts).toEqual([{ threadId: "t1", microphone: false }]);
    expect(tagOf(live())).toBe("realtime");
  });

  it("does not restart if the reader hangs up in between", async () => {
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });

    act(() => {
      live().reconnect();
      void live().stop();
    });
    await tick();
    expect(h.fakes.realtime.starts).toEqual([]);
  });

  it("does not restart after a hang-up that failed", async () => {
    engine.rememberEngine("realtime");
    const live = mountLive();
    act(() => live().start({ threadId: "t1" }));
    act(() => h.fakes["gpt-live"].set({ phase: "live" }));
    await act(async () => { h.experimental.set({ on: true }); });
    h.fakes["gpt-live"].endsOn = "failed";
    act(() => live().reconnect());
    await tick();
    expect(h.fakes.realtime.starts).toEqual([]);
  });
});

describe("the arrow on the Live button", () => {
  function mountButton(phase: LiveApi["phase"] = "idle") {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const live = { phase, placement: null, stop: async () => {} } as unknown as LiveApi;
    act(() => {
      const root = createRoot(host);
      roots.push(root);
      root.render(createElement(LiveButton, { live, onStart: () => {} }));
    });
    return () => host.querySelector<HTMLButtonElement>("button.chat-live-arrow");
  }

  /** Radix opens a menu on a mouse's primary `pointerdown`. */
  function press(el: Element) {
    const ev = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(ev, "pointerType", { value: "mouse" });
    act(() => { el.dispatchEvent(ev); });
  }

  const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

  it("is not there with Experimental off, and nor is any other choice", () => {
    engine.rememberEngine("realtime");
    const arrow = mountButton();
    expect(arrow()).toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Realtime|GPT-Live/);
  });

  it("with Experimental on, opens a menu of the two engines with the one in effect checked", () => {
    h.experimental.set({ on: true });
    const arrow = mountButton();
    const el = arrow();
    if (!el) throw new Error("no arrow rendered");
    expect(el.getAttribute("aria-label")).toBe("Voice engine: GPT-Live");
    expect(el.disabled).toBe(false);
    press(el);
    expect(menu()).not.toBeNull();
    expect(items().map((i) => [i.textContent?.includes("GPT-Live"), i.textContent?.includes("Realtime"), i.getAttribute("aria-checked")]))
      .toEqual([[true, false, "true"], [false, true, "false"]]);
  });

  it("remembers a choice, and shows it", () => {
    h.experimental.set({ on: true });
    const arrow = mountButton();
    const el = arrow();
    if (!el) throw new Error("no arrow rendered");
    press(el);
    const realtime = items()[1];
    if (!realtime) throw new Error("no Realtime item");
    act(() => { realtime.click(); });
    expect(engine.rememberedEngine()).toBe("realtime");
    expect(arrow()?.getAttribute("aria-label")).toBe("Voice engine: Realtime");
  });

  it("keeps its keys from the reading view's shortcuts", () => {
    h.experimental.set({ on: true });
    const arrow = mountButton();
    const el = arrow();
    if (!el) throw new Error("no arrow rendered");
    const heard: string[] = [];
    const listen = (e: KeyboardEvent) => heard.push(e.key);
    document.addEventListener("keydown", listen);
    try {
      act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true })); });
      press(el);
      const first = items()[0];
      if (!first) throw new Error("menu did not open");
      act(() => { first.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true })); });
    } finally {
      document.removeEventListener("keydown", listen);
    }
    expect(heard).toEqual([]);
  });

  it.each(["connecting", "live", "closing"] as const)("cannot be opened while a call is %s", (phase) => {
    h.experimental.set({ on: true });
    const arrow = mountButton(phase);
    expect(arrow()?.disabled).toBe(true);
  });

  it("appears and disappears with the switch, without a reload", async () => {
    const arrow = mountButton();
    expect(arrow()).toBeNull();
    await act(async () => { h.experimental.set({ on: true }); });
    expect(arrow()).not.toBeNull();
    await act(async () => { h.experimental.set({ on: false }); });
    expect(arrow()).toBeNull();
  });
});
