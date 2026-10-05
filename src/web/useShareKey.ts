/**
 * **The private link's key in the page's address, as a value a component can
 * hold.** Plan 261005e.
 *
 * `/read/<slug>?key=<key>` is how somebody who is not the owner is let into an
 * article that is not public. The key stays in the address for as long as the
 * reader is on that article: a mode change, a scroll and a trip to the details
 * page all keep query parameters they do not own (router.ts § `carriedSearch`,
 * and nuqs for the rest). This hook is the one place the client reads it.
 *
 * ## Only a parsed key comes out
 *
 * `shareKeyIn` (src/share-key.ts) answers `null` for anything that is not 22
 * base64url characters, so a mistyped or cut-short value is never put on a
 * request. The page then asks what a page with no key asks.
 *
 * ## It is kept nowhere else
 *
 * Not in `localStorage`, not in `sessionStorage`, not in component state that
 * outlives the address. The remembered-view store writes an allowlist of
 * parameters and `key` is not on it (last-view.ts § `REMEMBERED`), and the
 * Feedback button takes it off the address it records (FeedbackButton.tsx).
 * Nothing here logs it.
 *
 * ## A narrow subscription
 *
 * `useSyncExternalStore` with the key itself as the snapshot, so the component
 * re-renders when the key changes and not on the `?at=` rewrite that happens
 * about once a second while anybody scrolls (router.ts § `onAddressChange`).
 */
import { useSyncExternalStore } from "react";

import { type ShareKey, shareKeyIn } from "../share-key.js";
import { onAddressChange } from "./router.js";

const current = (): ShareKey | null => shareKeyIn(location.search);
const none = (): ShareKey | null => null;

export function useShareKey(): ShareKey | null {
  return useSyncExternalStore(onAddressChange, current, none);
}
