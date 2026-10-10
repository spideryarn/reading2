/**
 * **The live conversation, on whichever engine owns it.**
 *
 * Both hooks are mounted, always: hooks cannot be conditional, and an idle one
 * holds no device and no connection. This picks which `LiveApi` the page sees
 * and where `start` goes. The rules are `./engine.ts`'s three things, from
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md
 * § The engine is pinned to the call:
 *
 * - **`start` goes to the effective engine**, and is refused while either
 *   engine has a call. One call at a time, whichever engine.
 * - **While a call is in progress the page sees its owner**, whatever happens
 *   to the preference or to the Experimental switch meanwhile.
 * - **With no call, the page sees the effective engine's** api, with one
 *   exception: an engine whose last call left something to read (an error, or
 *   words that could not be saved) stays on screen until the next start, so
 *   switching engine or turning Experimental off does not make a failure
 *   vanish.
 * - **Turning Experimental off ends a call on the engine only Experimental
 *   offers** (Realtime, since 2026-10-10: anything but `DEFAULT_ENGINE`), by
 *   the ordinary hang-up, so the words are kept. The switch would otherwise
 *   say one thing while the call did another.
 * - **Reconnect asks again.** If the effective engine is still the owner, it is
 *   the hook's own reconnect. If not, the owner hangs up and the effective
 *   engine starts on the same conversation, with the same rule as the hook's:
 *   any other stop or start in between cancels the restart.
 *
 * When one engine is deleted, this file goes with `./engine.ts`, and the
 * surviving hook is mounted directly again.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveEngine } from "../../types.js";
import { useExperimental } from "../useExperimental.js";
import { DEFAULT_ENGINE, effectiveEngine, owningEngine, useEnginePreference } from "./engine.js";
import { useGptLive } from "./gpt-live/useGptLive.js";
import { useLiveConversation, type LiveApi, type LiveOptions } from "./useLiveConversation.js";

type StartOptions = Parameters<LiveApi["start"]>[0];

/** Did this engine's last call leave something the reader should still see? */
function lingers(api: LiveApi): boolean {
  return api.phase === "failed" || api.error !== null || api.hasUnsavedLines;
}

export function useLive(slug: string, opts: LiveOptions = {}): LiveApi {
  const realtime = useLiveConversation(slug, opts);
  const gptLive = useGptLive(slug, opts);
  const experimental = useExperimental();
  const preference = useEnginePreference();

  const apis: Record<LiveEngine, LiveApi> = { realtime, "gpt-live": gptLive };
  /* **While the setting is still being read, a remembered choice stands.** It
     reads as off until the fetch lands, and a reader who had chosen Realtime
     — which only Experimental can offer, so they had it on — would otherwise
     get GPT-Live for a press in that moment (GPT Sol, plan 261010a P2). If the
     fetch says off, a call already begun is ended by the effect below. */
  const effective = effectiveEngine(preference, experimental.on || !experimental.loaded);
  const owner = owningEngine({ realtime: realtime.phase, "gpt-live": gptLive.phase });
  /** The engine the most recent start went to. */
  const [last, setLast] = useState<LiveEngine | null>(null);
  const shown = owner ?? (last !== null && last !== effective && lingers(apis[last]) ? last : effective);

  /* Refs, because `start`, `stop` and `reconnect` are handed to effects and
     event handlers that must not be rebuilt on every render, and each has to
     read these as they are when it is called. */
  const now = useRef({ apis, effective, owner, shown });
  now.current = { apis, effective, owner, shown };
  /** The engine `start` was last sent to, readable before the render that shows it. */
  const started = useRef<LiveEngine | null>(null);
  const lastStart = useRef<StartOptions | null>(null);
  /** A cross-engine reconnect waiting for its hang-up, by token; 0 when none is. */
  const restarting = useRef(0);
  const restartSeq = useRef(0);
  /** The rendered half of `restarting`, so LiveStatus can offer Cancel reconnect. */
  const [crossReconnectPending, setCrossReconnectPending] = useState(false);

  const start = useCallback((o: StartOptions) => {
    if (restarting.current !== 0) {
      restarting.current = 0;
      setCrossReconnectPending(false);
    }
    if (now.current.owner) return;
    const engine = now.current.effective;
    started.current = engine;
    const opts = devSeam()?.noMicrophone ? { ...o, microphone: false } : o;
    lastStart.current = opts;
    setLast(engine);
    now.current.apis[engine].start(opts);
  }, []);

  const stop = useCallback((): Promise<void> => {
    if (restarting.current !== 0) {
      restarting.current = 0;
      setCrossReconnectPending(false);
    }
    const engine = now.current.owner ?? started.current ?? now.current.shown;
    return now.current.apis[engine].stop();
  }, []);

  const reconnect = useCallback(() => {
    const engine = now.current.owner;
    if (!engine) return;
    const api = now.current.apis[engine];
    if (now.current.effective === engine) {
      api.reconnect();
      return;
    }
    /* The choice has moved since this call began, so the fresh call is the
       other engine's. Same shape as the hooks' own reconnect. */
    const thread = api.threadId;
    if (api.phase !== "live" || !thread) return;
    restartSeq.current += 1;
    const mine = restartSeq.current;
    const microphone = lastStart.current?.microphone;
    restarting.current = mine;
    setCrossReconnectPending(true);
    void api
      .stop()
      /* One task, so the hang-up's last state has rendered and `now` is true. */
      .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
      .then(() => {
        if (restarting.current !== mine) return;
        restarting.current = 0;
        setCrossReconnectPending(false);
        if (now.current.apis[engine].phase === "failed") return;
        start({ threadId: thread, ...(microphone === undefined ? {} : { microphone }) });
      });
  }, [start]);

  /* Experimental switched off under a call on the engine only it offers.
     `loaded` as well as `on`: the setting reads as off for a moment while it is
     being fetched, and that must not hang up on anybody. */
  const experimentalOwner = owner !== null && owner !== DEFAULT_ENGINE ? owner : null;
  useEffect(() => {
    if (!experimentalOwner || !experimental.loaded || experimental.on) return;
    restarting.current = 0;
    setCrossReconnectPending(false);
    void now.current.apis[experimentalOwner].stop();
  }, [experimentalOwner, experimental.loaded, experimental.on]);

  const api = {
    ...apis[shown],
    start,
    stop,
    reconnect,
    reconnecting: apis[shown].reconnecting || crossReconnectPending,
  };
  const seam = devSeam();
  if (seam) seam.api = api;
  return api;
}

/**
 * **A way in for a browser check that has no microphone**, on the dev server
 * only. An automation tab cannot answer a permission prompt or speak, so a
 * check sets `window.__spideryarnLive = { noMicrophone: true }` before pressing
 * Live — the call then runs on the silent track both hooks already have — and
 * puts a question in with `window.__spideryarnLive.api.say(…)`. Absent unless
 * the page created it, and never read in a production build.
 */
interface LiveDevSeam {
  noMicrophone?: boolean;
  api?: LiveApi;
}

function devSeam(): LiveDevSeam | undefined {
  if (import.meta.env.PROD) return undefined;
  return (globalThis as { __spideryarnLive?: LiveDevSeam }).__spideryarnLive;
}
