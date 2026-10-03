/**
 * **Which of the two live-conversation engines a call uses.**
 *
 * Realtime (one model listens and answers) and GPT-Live (a voice with a second
 * model behind it) are built side by side to be compared, and one will be
 * deleted. docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md
 * § The engine is pinned to the call.
 *
 * Three things, kept apart, because folding any two together is a bug:
 *
 * 1. **The remembered preference**: what the reader last chose in the Live
 *    control, in this browser. `null` until they have chosen.
 * 2. **The effective engine**: what the next start would use. The preference
 *    (or the default) while Experimental features are on; Realtime while they
 *    are off, whatever was chosen. A reader with the switch off sees no choice
 *    and gets what every reader gets.
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
 * **The engine a reader with Experimental on gets before they have chosen.**
 *
 * Realtime until GPT-Live has passed its real-browser check; then this one
 * constant flips to `"gpt-live"`, so the comparison happens without anybody
 * hunting for a setting (the plan's Stage 4, Sol F9).
 */
export const DEFAULT_EXPERIMENTAL_ENGINE: LiveEngine = "realtime";

/** One key, holding the engine's name. */
export const ENGINE_KEY = "spya.live.engine";

/** What each engine is called in the control, and the one line that says what it is. */
export const ENGINE_COPY: Record<LiveEngine, { label: string; tip: string }> = {
  realtime: { label: "Realtime", tip: "One model listens and answers" },
  "gpt-live": {
    label: "GPT-Live (new)",
    tip: "A voice that keeps listening while a second model checks the article",
  },
};

/** A stored value as an engine, or `null` for anything that is not one. */
export function parseEngine(raw: string | null): LiveEngine | null {
  return raw === "realtime" || raw === "gpt-live" ? raw : null;
}

/** What the next start would use. */
export function effectiveEngine(preference: LiveEngine | null, experimentalOn: boolean): LiveEngine {
  if (!experimentalOn) return "realtime";
  return preference ?? DEFAULT_EXPERIMENTAL_ENGINE;
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
