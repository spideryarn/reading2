/**
 * The tab's one transfer, as a component sees it.
 *
 * The thinnest possible wrapper over [`uploadEngine`](uploadEngine.ts) — one
 * `useSyncExternalStore` and nothing else — for the reason
 * [`useExperimental.ts`](useExperimental.ts) gives about its own store: React's
 * own subscription primitive already does the whole job, and anything else here
 * would be state that can disagree with the engine's.
 *
 * Two components read it and they are on different pages: the shelf's add box,
 * so a reader who comes back finds the bar still moving, and `/add/upload/<id>`,
 * which is where they were sent the moment they pressed Add.
 */
import { useSyncExternalStore } from "react";

import { type Transfer, uploadEngine } from "./uploadEngine.js";

const subscribe = (onChange: () => void): (() => void) => uploadEngine.subscribe(onChange);
const snapshot = (): { transfer: Transfer | null } => uploadEngine.getSnapshot();

/** The transfer in flight, or `null` when there is none. */
export function useUpload(): Transfer | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot).transfer;
}
