import { useLayoutEffect, useRef } from "react";
import type { Mode } from "../params.js";
import { dropPendingFlash } from "../flash.js";

/** A held flash belongs to the mode that made it, not the next covering band. */
export function useModeFlashOwnership(mode: Mode, bandOverProse: boolean): void {
  const flashMode = useRef(mode);
  useLayoutEffect(() => {
    if (flashMode.current === mode) return;
    flashMode.current = mode;
    if (bandOverProse) dropPendingFlash();
  }, [mode, bandOverProse]);
}
