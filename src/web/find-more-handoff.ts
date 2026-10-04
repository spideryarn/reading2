/**
 * **A *Find more* the command bar asked a band for, waiting for the band to
 * open.** The bar's *Glossary › Find more* and *Quotes › Find more* rows (plan
 * 261004k, Stage 2) move the reader to the band and leave the press here; the
 * band takes it once and presses the function its own Find more button calls
 * (useFindMoreHandOff.ts).
 *
 * **glossary-ask-handoff.ts's sibling, with the same four guards**, and its
 * header has the reasons: not the activation token (that means *generate if
 * there is none*, and arming it as well would be two paid runs for one press),
 * not the URL (a parameter that spends is a link anyone can make a reader
 * click). `slug` so a press cannot be spent on another article, a `nonce` so
 * the take is atomic and one-shot under `<StrictMode>`, the session epoch so
 * the last reader's press is not the next one's, and a ceiling so a press no
 * band took does not fire when the reader opens the band minutes later.
 *
 * **A sibling rather than that file made general**: the ask carries a term and
 * is named for it in three callers and two test files; this carries only which
 * band. One slot here for both bands — a second press replaces the first, and
 * the reader can be in one band at a time.
 */
import type { FindMoreMode } from "./find-more.js";
import { jobEngine } from "./jobEngine.js";

interface HandOff {
  readonly slug: string;
  readonly mode: FindMoreMode;
  readonly nonce: number;
  readonly epoch: number;
  readonly at: number;
}

/** How long a press waits for its band — glossary-ask-handoff.ts § `STALE_AFTER_MS`. */
const STALE_AFTER_MS = 10_000;

let held: HandOff | null = null;
let nonces = 0;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function live(handOff: HandOff | null, slug: string, mode: FindMoreMode): handOff is HandOff {
  return (
    handOff !== null &&
    handOff.slug === slug &&
    handOff.mode === mode &&
    handOff.epoch === jobEngine.epoch() &&
    Date.now() - handOff.at < STALE_AFTER_MS
  );
}

/** Leave a Find more for `mode`'s band on `slug`. Replaces any earlier one. */
export function handOffFindMore(slug: string, mode: FindMoreMode): void {
  nonces += 1;
  held = { slug, mode, nonce: nonces, epoch: jobEngine.epoch(), at: Date.now() };
  announce();
}

/** The nonce of the press waiting for this band, or `null` — a primitive, for `useSyncExternalStore`. */
export function pendingFindMore(slug: string, mode: FindMoreMode): number | null {
  return live(held, slug, mode) ? held.nonce : null;
}

/**
 * **Take it, once** — `true` if this nonce is still the press waiting for this
 * band, and removed in the same step, so a second take finds nothing. Whoever
 * takes it decides whether to press; a press not made is gone all the same.
 */
export function takeFindMore(slug: string, mode: FindMoreMode, nonce: number): boolean {
  const handOff = held;
  if (!live(handOff, slug, mode) || handOff.nonce !== nonce) return false;
  held = null;
  announce();
  return true;
}

export function subscribeFindMore(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Forget it, for a test. */
export function resetFindMoreForTests(): void {
  held = null;
  announce();
}
