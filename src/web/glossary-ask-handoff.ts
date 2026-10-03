/**
 * **A term the command bar asked the glossary to look up, waiting for the band
 * to open.** The bar's *Look up “X” in this article* row (plan 261003f, Stage
 * 1.2) moves the reader to Glossary and leaves the term here; the band's
 * *Look up a term* box takes it once and asks — one `POST
 * /api/glossary/:slug/ask`, the same call its own Look up button makes.
 *
 * **Why not arm the band the way a mode press does** (activation.ts): that
 * token means *generate a glossary if there is none*, and this is a different
 * request. The row is offered only when the glossary read has settled to
 * ready, so generate-on-open has nothing to do — and arming it as well would
 * be the two paid runs for one press GPT Sol's F1 found in the first draft.
 *
 * **Why not the URL**: a parameter that spends is a link anyone can make a
 * reader click. This lives in the tab's memory and nowhere else.
 *
 * The shape is activation.ts's, smaller — `slug` so a hand-off cannot be spent
 * on another article, a `nonce` so the take is atomic and one-shot (StrictMode
 * runs an effect twice; two reads and a clear would ask twice), the session
 * epoch so the previous reader's press cannot be spent by the next one, and a
 * time so a hand-off nobody took — the band never mounted — does not ask
 * minutes later when the reader next opens Glossary on their own.
 */
import { jobEngine } from "./jobEngine.js";

interface HandOff {
  readonly slug: string;
  readonly term: string;
  readonly nonce: number;
  readonly epoch: number;
  readonly at: number;
}

/**
 * **How long a hand-off waits for its band.** The press moves the band on the
 * same tick, so a real one is taken within a frame or two; this is the
 * ceiling past which the press is no longer the reason the band opened.
 */
const STALE_AFTER_MS = 10_000;

let held: HandOff | null = null;
let nonces = 0;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function live(handOff: HandOff | null, slug: string): handOff is HandOff {
  return (
    handOff !== null &&
    handOff.slug === slug &&
    handOff.epoch === jobEngine.epoch() &&
    Date.now() - handOff.at < STALE_AFTER_MS
  );
}

/** Leave `term` for the glossary band of `slug`. Replaces any earlier one. */
export function handOffGlossaryAsk(slug: string, term: string): void {
  nonces += 1;
  held = { slug, term, nonce: nonces, epoch: jobEngine.epoch(), at: Date.now() };
  announce();
}

/**
 * **The nonce of the hand-off waiting for `slug`**, or `null` — a primitive,
 * so `useSyncExternalStore` can compare it, and so nothing reading it holds a
 * term it has not taken.
 */
export function pendingGlossaryAsk(slug: string): number | null {
  return live(held, slug) ? held.nonce : null;
}

/**
 * **Take it, once** — the term, if this nonce is still the one waiting for
 * `slug`, and removed in the same step, so a second take finds nothing.
 */
export function takeGlossaryAsk(slug: string, nonce: number): string | null {
  const handOff = held;
  if (!live(handOff, slug) || handOff.nonce !== nonce) return null;
  held = null;
  announce();
  return handOff.term;
}

export function subscribeGlossaryAsk(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Forget it, for a test — `resetActivations`'s twin. */
export function resetGlossaryAskForTests(): void {
  held = null;
  announce();
}
