/**
 * **The reader a component was mounted for**, for a write it makes late.
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2.
 *
 * When another tab signs in as somebody else, the tab's held session
 * ([`session.ts`](./session.ts)) changes first, then React unmounts the
 * signed-in page. So every write made from an effect cleanup, an idle timer or `pagehide` is
 * *made* when the tab already holds the next reader, and `apiFetch`'s own
 * binding cannot see it. Such a write names its reader instead (`apiFetch`'s
 * and `leavingFetch`'s third argument), and this is where it gets the name.
 *
 * **Read at mount and never again**, which is the point: at cleanup time every
 * lookup answers with the next reader, and so does a context read by a render
 * that came after the change.
 *
 * `null` outside the provider: a visitor's reading view, and any test that
 * mounts a component bare. `null` is unfenced, as it is in `apiFetch`.
 */
import { createContext, useContext, useRef } from "react";

/** The signed-in reader's id. Provided once, by `App`, around every signed-in page. */
export const SignedInReader = createContext<string | null>(null);

/** The reader this component was mounted for, or `null` for nobody. */
export function useMadeFor(): string | null {
  const now = useContext(SignedInReader);
  return useRef(now).current;
}
