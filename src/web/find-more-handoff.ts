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
 * ## And a fifth, which the ask does not need: a job list newer than the press
 *
 * The band makes the press only if no run of its step is out, and it reads
 * that off the tab's job list — which may have been fetched eight seconds ago,
 * or longer on a tab that was hidden. A run started since, in another tab or
 * by Metadata's *Run again* in a different profile (which the server does not
 * collapse into this one: the profile is part of the work key), is in no
 * snapshot yet, and a press made beside it is a second paid run (GPT Sol's F11
 * on the code).
 *
 * So leaving a press **asks the engine for a list now** (`poke`), and the
 * press is `ready` only once a list *asked for after it was left* has been
 * applied (jobEngine.ts § `afterFreshList`) — not one already on the wire,
 * whose silence is about an earlier moment. Nothing waits on a clock: with no
 * such list inside the ten seconds — the server down, the engine paused on a
 * 401 — the press is nobody's, and the reader is on the band with its button.
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
  /** A job list asked for after `at` has been applied — see the header. */
  readonly fresh: boolean;
}

/** How long a press waits for its band — glossary-ask-handoff.ts § `STALE_AFTER_MS`. */
const STALE_AFTER_MS = 10_000;

let held: HandOff | null = null;
/** Stop waiting for the held press's list. */
let unwait: (() => void) | null = null;
/** Remove an unanswered press and its engine waiter at the ceiling. */
let expiry: ReturnType<typeof setTimeout> | null = null;
let nonces = 0;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function stopWaiting(): void {
  unwait?.();
  unwait = null;
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;
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

/**
 * Leave a Find more for `mode`'s band on `slug`, and ask for the job list it
 * will be judged on. Replaces any earlier one.
 */
export function handOffFindMore(slug: string, mode: FindMoreMode): void {
  nonces += 1;
  const nonce = nonces;
  stopWaiting();
  held = { slug, mode, nonce, epoch: jobEngine.epoch(), at: Date.now(), fresh: false };
  /* Registered before the poke, so the list the poke starts is the first that
     counts; one already in flight is followed by another (jobEngine.ts §
     `poll`, `again`). */
  unwait = jobEngine.afterFreshList(() => {
    unwait = null;
    if (held?.nonce !== nonce) return;
    held = { ...held, fresh: true };
    announce();
  });
  expiry = setTimeout(() => {
    if (held?.nonce !== nonce) return;
    stopWaiting();
    held = null;
    announce();
  }, STALE_AFTER_MS);
  jobEngine.poke();
  announce();
}

/** The nonce of the press waiting for this band, or `null` — a primitive, for `useSyncExternalStore`. */
export function pendingFindMore(slug: string, mode: FindMoreMode): number | null {
  return live(held, slug, mode) ? held.nonce : null;
}

/**
 * The nonce of the press this band may take **now**, or `null`: waiting for it,
 * and a job list asked for after it was left has been applied.
 */
export function readyFindMore(slug: string, mode: FindMoreMode): number | null {
  return live(held, slug, mode) && held.fresh ? held.nonce : null;
}

/**
 * **Take it, once** — `true` if this nonce is still the press waiting for this
 * band and is `ready`, and removed in the same step, so a second take finds
 * nothing. Whoever takes it decides whether to press; a press not made is gone
 * all the same.
 */
export function takeFindMore(slug: string, mode: FindMoreMode, nonce: number): boolean {
  const handOff = held;
  if (!live(handOff, slug, mode) || !handOff.fresh || handOff.nonce !== nonce) return false;
  stopWaiting();
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
  stopWaiting();
  held = null;
  announce();
}
