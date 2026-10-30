/**
 * **A finished job's result is still landing** — the interval between the
 * job leaving the queue and the read it sets off replacing the earlier
 * `none`. Shared by every paid artefact whose unforced run an automatic press
 * can start (`useSituate`, `useSourcesDigest`), so no hook copies only half.
 *
 * Two halves, because they guard two different moments:
 *
 *  - `landing`, state: what the screen draws (the working line, not the
 *    press), and the `loading` an auto-run status is held at on the next render.
 *  - `isLanding()`, a ref read at action time: the queue announces completion
 *    from a passive effect, and a later `useAutoRun` effect from the **same**
 *    commit still holds that render's `none`. State set in the first effect
 *    cannot reach the second's closure, so the unforced `ensure` asks this
 *    instead. docs/postmortems/261030c-a-state-update-in-one-passive-effect-cannot-guard-a-later-effect-from-the-same-render.md.
 *
 * Both are keyed to `refresh`'s identity, which changes when the read re-keys
 * (an in-place slug change, A -> B -> A included): an old read settling late
 * neither clears a newer landing nor belongs to the visit now on screen.
 */
import { useCallback, useRef, useState } from "react";

export interface CompletionLanding {
  /** Pass to `useStepJob` as its `onFinished`: marks landing and starts `refresh`. */
  finished(): void;
  /** The current read's completion is landing — for rendering. */
  landing: boolean;
  /** The same, read now rather than at render — for a paid action's guard. */
  isLanding(): boolean;
}

/** @param refresh the read's `refresh`, never its `reload` — useStepJob.ts § `useStepFinished`. */
export function useCompletionLanding(refresh: () => Promise<void>): CompletionLanding {
  const [landing, setLanding] = useState<{ read: () => Promise<void> } | null>(null);
  const landingNow = useRef<{ read: () => Promise<void> } | null>(null);
  const finished = useCallback(() => {
    const mine = { read: refresh };
    landingNow.current = mine;
    setLanding(mine);
    void refresh().finally(() => {
      if (landingNow.current === mine) landingNow.current = null;
      setLanding((current) => (current === mine ? null : current));
    });
  }, [refresh]);
  const isLanding = useCallback(() => landingNow.current?.read === refresh, [refresh]);
  return { finished, landing: landing?.read === refresh, isLanding };
}
