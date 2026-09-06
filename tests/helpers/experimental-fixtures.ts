/**
 * **The answers the experimental switch can give a `Dock`.**
 *
 * `Dock` takes the answer as a required prop rather than subscribing to
 * `experimental-store.ts` itself (Dock.tsx § the modes it draws at all, and
 * docs/plans/260903c-… § `Dock` is told the answer), so every test that mounts
 * the bar has to say which reader it is drawing for. These are that sentence,
 * once, instead of nine hand-rolled fields scattered through six files.
 *
 * **They live here rather than in `Dock.tsx` on purpose.** A fixture exported
 * from a source module ships to production and is one import away from becoming
 * a default — and a hand-rolled answer at a fifth mount site is exactly the cost
 * the prop-rather-than-hook decision named and accepted.
 *
 * **There is a signed-out fixture now, and there deliberately was not before.**
 * While the prop was one field, a signed-out reader's answer *was*
 * `EXPERIMENTAL_OFF` — forcibly off, and nothing else about them showed. Since
 * the bar draws the switch itself (2026-09-03), signed-out and signed-in-and-off
 * are two different bars: one has seventeen buttons and the other eighteen. A
 * test that means the stranger has to say so.
 *
 * Failure states are built by `broken()` rather than kept as fixtures: there are
 * six appearances, they are one field apart, and a list of six near-identical
 * objects is the kind of thing that goes stale one field at a time.
 */
import type { DockExperimental } from "../../src/web/Dock.js";

/** The fields nothing in these fixtures varies, and a `set`/`reload` that record nothing. */
const BASE: DockExperimental = {
  on: false,
  signedIn: true,
  loaded: true,
  stale: false,
  saving: false,
  error: null,
  loadError: null,
  set: () => {},
  reload: () => {},
};

/** A signed-in reader who has turned experimental features on. */
export const EXPERIMENTAL_ON: DockExperimental = { ...BASE, on: true };

/** A signed-in reader who has not — the default, and what the switch offers. */
export const EXPERIMENTAL_OFF: DockExperimental = { ...BASE };

/**
 * Nobody signed in: off by decision rather than by a refused request
 * (experimental-store.ts), and no switch drawn, because there is no account to
 * save one to.
 */
export const EXPERIMENTAL_SIGNED_OUT: DockExperimental = { ...BASE, signedIn: false };

/**
 * A signed-in reader whose switch is in one of the states that are not simply
 * *on* or *off* — override whichever fields the case is about.
 *
 * Takes `set` and `reload` too, because the tests that care about a failure are
 * usually the tests that care about what a press does with it.
 */
export function experimental(over: Partial<DockExperimental>): DockExperimental {
  return { ...BASE, ...over };
}
