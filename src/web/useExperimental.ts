/**
 * **The experimental-features switch**, as a hook.
 *
 * There is almost nothing here, and that is the change: until 2026-09-03 this
 * file held the fetch, the retry, the generation counter and the
 * one-write-at-a-time guard, and every component that called it got **its own
 * copy of all of them**. That was fine while the only consumer was one settings
 * row on `/profile`, and wrong the moment a feature went behind the switch —
 * `App.tsx` is the router, and the reading view, metadata and tweets each mount
 * their own `Dock`, so two of them could disagree for the length of a toggle.
 *
 * All of it now lives in experimental-store.ts, **with the reasoning that shaped
 * each piece** — three states rather than two, a date in and a boolean out, one
 * write at a time, and why a signed-out reader is off because we decided rather
 * than because the request was refused. Two of GPT Sol's reviews are recorded
 * there; read that file before changing any of it.
 *
 * What is left is the subscription. `useSyncExternalStore` is React's own way
 * of reading a value that lives outside React, and it is what makes the store a
 * store rather than a global that components fail to notice changing. The
 * snapshot is referentially stable — see `same` in the store — because this
 * hook hands it straight back and React compares snapshots by identity.
 *
 * ```tsx
 * const { on } = useExperimental();
 * if (!on) return null;          // …or leave the button out of the row
 * ```
 *
 * docs/project/experimental-features.md is the operating manual.
 */
import { useSyncExternalStore } from "react";

import { type ExperimentalSetting, snapshot, subscribe } from "./experimental-store.js";

export type { ExperimentalSetting };

export function useExperimental(): ExperimentalSetting {
  /* The third argument is the server snapshot, and it is **the same one, which
     is only safe because nothing here is server-rendered**. The store does hold
     browser-only state — who is signed in, and what the server said about them —
     so on a React SSR path this would be the hydration mismatch that class of
     bug is famous for. This client is mounted by vite into an empty div
     (src/web/main.tsx); the day any of it is rendered on the server, this
     argument has to become a constant "we have not read it yet".
     (The earlier version of this comment claimed there was no browser-only
     state at all — GPT Sol, 2026-09-03.) */
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
