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
 * - **Turning Experimental off ends a GPT-Live call first**, by the ordinary
 *   hang-up, so the words are kept.
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
import { effectiveEngine, owningEngine, useEnginePreference } from "./engine.js";
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
  const effective = effectiveEngine(preference, experimental.on);
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

  const start = useCallback((o: StartOptions) => {
    restarting.current = 0;
    if (now.current.owner) return;
    const engine = now.current.effective;
    started.current = engine;
    lastStart.current = o;
    setLast(engine);
    now.current.apis[engine].start(o);
  }, []);

  const stop = useCallback((): Promise<void> => {
    restarting.current = 0;
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
    void api
      .stop()
      /* One task, so the hang-up's last state has rendered and `now` is true. */
      .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
      .then(() => {
        if (restarting.current !== mine) return;
        restarting.current = 0;
        if (now.current.apis[engine].phase === "failed") return;
        start({ threadId: thread, ...(microphone === undefined ? {} : { microphone }) });
      });
    restarting.current = mine;
  }, [start]);

  /* Experimental switched off under a GPT-Live call. `loaded` as well as
     `on`: the setting reads as off for a moment while it is being fetched, and
     that must not hang up on anybody. */
  const gptLiveBusy = owner === "gpt-live";
  useEffect(() => {
    if (!gptLiveBusy || !experimental.loaded || experimental.on) return;
    restarting.current = 0;
    void now.current.apis["gpt-live"].stop();
  }, [gptLiveBusy, experimental.loaded, experimental.on]);

  return { ...apis[shown], start, stop, reconnect };
}
