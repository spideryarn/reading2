/**
 * **Whose add visit this is, and whether it has been stopped** —
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 1.
 *
 * A visit is one stay at one `/add/` address. The add page starts an import
 * the moment it mounts, and holds one reader's words and choices while it
 * runs: what they typed into *Why are you reading this?*, their High-powered
 * tick, the job they are watching. So when the signed-in reader changes with
 * the address still open (another tab signs in as somebody else, or this one
 * signs out and somebody else signs in), two things must both be true: the
 * new reader sees none of it, and no import starts for them that they did not
 * ask for.
 *
 * A fresh page for the new reader would give the first and break the second,
 * because a fresh page posts on mount. So the visit is **stopped**, and stays
 * stopped until the address is left. The reader adds the article from the
 * shelf, which is their own gesture.
 *
 * **Kept by `App`, above its signed-out branch**, because that branch unmounts
 * every signed-in page: a rule kept inside the add page would forget reader A
 * the moment A signed out, and treat B as a first arrival.
 *
 * A pure function, so the rule can be read and tested without a session or a
 * router: tests/add-visit.test.ts.
 */
import type { Route } from "./router.js";

export type AddVisit =
  /** The add page, for `reader`. */
  | { kind: "running"; address: string; reader: string }
  /**
   * Another reader turned up at this address. No reader on it: the page that
   * says so is nobody's, and has nothing of anybody's to draw.
   */
  | { kind: "stopped"; address: string };

/**
 * The visit after this render.
 *
 * @param held the visit as it stood, or `null` for none.
 * @param address `addAddress(route)`: which add address this is, or `null`
 *   anywhere else.
 * @param reader `user.id`, or `null` when nobody is signed in.
 *
 * Asked twice with the same answers it gives the same visit back, which is
 * what lets `App` ask during render (StrictMode renders twice).
 */
export function nextAddVisit(
  held: AddVisit | null,
  address: string | null,
  reader: string | null,
): AddVisit | null {
  /* Leaving the address is the only thing that ends a visit, stopped or not. */
  if (address === null) return null;
  /* **Signed out is not a new reader.** The visit waits, so whoever signs in
     next is compared with who it was running for. With no visit to wait
     (a bookmarklet or a share sheet opened signed out) there is nothing to
     keep, and whoever signs in gets a visit of their own below. */
  if (reader === null) return held;
  if (held === null || held.address !== address) return { kind: "running", address, reader };
  /* Stopped is for good: the first reader coming back does not restart it. */
  if (held.kind === "stopped" || held.reader === reader) return held;
  return { kind: "stopped", address };
}

/**
 * Which add address a route is, or `null` when it is not one.
 *
 * The kind is in it, so an upload whose id happened to read like an address
 * could not be taken for that address's visit.
 */
export function addAddress(route: Route): string | null {
  if (route.kind === "add") return `url ${route.url}`;
  if (route.kind === "add-upload") return `upload ${route.uploadId}`;
  return null;
}
