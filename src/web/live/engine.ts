/**
 * **Which of the two live-conversation engines a call uses.**
 *
 * GPT-Live (a voice with a second model behind it) is every reader's; Realtime
 * (one model listens and answers) is offered beside it only with Experimental
 * features on (Greg, 2026-10-09, report spya-t858ug; plan 261010a). They were
 * built side by side to be compared, and one will be deleted.
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md
 * § The engine is pinned to the call.
 *
 * Three things, kept apart, because folding any two together is a bug:
 *
 * 1. **The remembered preference**: what the reader last chose in the Live
 *    control, in this browser. `null` until they have chosen.
 * 2. **The effective engine**: what the next start would use. The preference
 *    (or the default) while Experimental features are on; the default while
 *    they are off, whatever was chosen. A reader with the switch off sees no
 *    choice and gets what every reader gets.
 * 3. **The owner**: the engine of the call in progress, from its start until
 *    its hang-up has finished. It does not move when the other two do.
 *    `./useLive.ts` holds the two hooks and applies these rules.
 *
 * The preference is per browser, like the microphone placement beside it: a
 * setting about this device's call, not about the account.
 */
import { useSyncExternalStore } from "react";

import type { LiveEngine } from "../../types.js";
import type { LivePhase } from "./useLiveConversation.js";

/**
 * **The engine every reader gets**: always with Experimental off, and with it
 * on until they choose the other one.
 *
 * Realtime until 2026-10-10, when Greg made GPT-Live the default: *"Let's make
 * Live the default and keep real-time only for Experimental Features"*
 * (spya-t858ug). That answered the question the 261002r spike had left open —
 * GPT-Live's article answers measured about two seconds slower — and the
 * trade-off is written down in plan 261010a.
 */
export const DEFAULT_ENGINE: LiveEngine = "gpt-live";

/** One key, holding the engine's name. */
export const ENGINE_KEY = "spya.live.engine";

/** What each engine is called in the control, and the one line that says what it is. */
export const ENGINE_COPY: Record<LiveEngine, { label: string; tip: string }> = {
  "gpt-live": {
    label: "GPT-Live",
    tip: "A voice that keeps listening while a second model checks the article",
  },
  realtime: { label: "Realtime", tip: "One model listens and answers" },
};

/** The order the control lists them in: the default first. */
export const ENGINE_ORDER: readonly LiveEngine[] = ["gpt-live", "realtime"];

/** A stored value as an engine, or `null` for anything that is not one. */
export function parseEngine(raw: string | null): LiveEngine | null {
  return raw === "realtime" || raw === "gpt-live" ? raw : null;
}

/** What the next start would use. */
export function effectiveEngine(preference: LiveEngine | null, experimentalOn: boolean): LiveEngine {
  if (!experimentalOn) return DEFAULT_ENGINE;
  return preference ?? DEFAULT_ENGINE;
}

/**
 * The engine that owns the call in progress, or `null` when there is none.
 *
 * Read off the two hooks' phases, not kept as state beside them: a hook is
 * `connecting`, `live` or `closing` from its `start` until its hang-up has
 * finished, which is exactly the span the plan pins the engine for. A separate
 * flag would have to be kept in step with a reconnect that restarts inside the
 * hook, and could say "nobody" about a call that is live.
 */
export function owningEngine(phases: Record<LiveEngine, LivePhase>): LiveEngine | null {
  const busy = (phase: LivePhase) => phase === "connecting" || phase === "live" || phase === "closing";
  if (busy(phases["gpt-live"])) return "gpt-live";
  if (busy(phases.realtime)) return "realtime";
  return null;
}

/* ---------- the remembered preference ---------- */

/** `undefined` until storage has been read once. Then the choice, which holds for the visit even if storage does not. */
let memory: LiveEngine | null | undefined;
const listeners = new Set<() => void>();

/**
 * Wrapped for the reasons shelf-hidden-columns.ts gives: Safari's private mode
 * throws, site data may be blocked, and under vitest with jsdom `localStorage`
 * can read `undefined`. Anything unreadable is "not chosen yet".
 */
export function rememberedEngine(): LiveEngine | null {
  if (memory !== undefined) return memory;
  try {
    memory = parseEngine(window.localStorage.getItem(ENGINE_KEY));
  } catch {
    memory = null;
  }
  return memory;
}

/** Remember a choice, and tell every mounted control. */
export function rememberEngine(engine: LiveEngine): void {
  memory = engine;
  try {
    window.localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* See `rememberedEngine`. The choice still holds for this visit. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The remembered preference, live: the Live control writes it and `useLive`
 * reads it, and they are in different components.
 */
export function useEnginePreference(): LiveEngine | null {
  return useSyncExternalStore(subscribe, rememberedEngine, rememberedEngine);
}

/** For tests: forget what was read, so the next read goes back to storage. Nothing in the app calls this. */
export function resetEngineForTests(): void {
  memory = undefined;
}
