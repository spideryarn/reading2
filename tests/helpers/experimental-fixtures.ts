/**
 * **The two answers the experimental switch can give a `Dock`.**
 *
 * `Dock` takes the answer as a required prop rather than subscribing to
 * `experimental-store.ts` itself (Dock.tsx § the modes it draws at all, and
 * docs/plans/260903c-… § `Dock` is told the answer), so every test that mounts
 * the bar has to say which reader it is drawing for. These are that sentence,
 * once, instead of `{ on: false }` scattered through six files.
 *
 * **They live here rather than in `Dock.tsx` on purpose.** A fixture exported
 * from a source module ships to production and is one import away from becoming
 * a default — and a hand-rolled `{ on: true }` at a fifth mount site is exactly
 * the cost the prop-rather-than-hook decision named and accepted.
 *
 * There is no `EXPERIMENTAL_SIGNED_OUT`: a signed-out reader is forcibly off
 * (experimental-store.ts), so their answer *is* `EXPERIMENTAL_OFF`. Where a test
 * is about the signed-out case, say so in the test's name.
 */
import type { DockExperimental } from "../../src/web/Dock.js";

/** A reader who has turned experimental features on. */
export const EXPERIMENTAL_ON: DockExperimental = { on: true };

/** Everybody else — including every signed-out reader. */
export const EXPERIMENTAL_OFF: DockExperimental = { on: false };
