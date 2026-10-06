/**
 * **Who this tab is signed in as: one answer, for the screen and for the
 * request fence alike.**
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 1.
 *
 * This is the only subscription to `supabase.auth.onAuthStateChange` that
 * decides identity. `useSession` draws the screen from it, `api.ts` binds
 * each request to the reader it holds, and the experimental-features store
 * asks it who is reading.
 *
 * ## Why one, and not one each
 *
 * Until 2026-10-06 each of those subscribed to the SDK for itself, and the
 * request fence was argued from the order they registered in. That argument
 * was wrong. **The SDK sends every new subscriber its own `INITIAL_SESSION`,
 * read from storage at that moment**, so two subscribers can hold different
 * readers: another tab writes B's session to shared storage, and before the
 * broadcast arrives a component that mounts and subscribes is told B while
 * a subscriber from page load still holds A. The screen was drawn for B and
 * B's own request, bound to A, was refused. GPT Sol reproduced it against
 * the installed SDK (docs/plans/261006f-plan-review-sol.md, F1). With one
 * subscription there is one answer, and a late subscriber is told what is
 * held here and not what storage says.
 *
 * ## The order inside one event
 *
 * What is held changes first; then the module-level stores are emptied if
 * the reader is a different one (`noteReader`, reader-change.ts); then the
 * subscribers hear. So nothing a subscriber draws or asks can see the last
 * reader's token or their words.
 *
 * ## For a sender that is not a component
 *
 * `heldReader()`, read synchronously where the work begins, is the reader to
 * pass as `madeFor` to every later attempt: chat/effects.ts § `appendSpoken`
 * is the pattern. A component uses `useMadeFor` (made-for.ts).
 *
 * `url-session-kind.ts` still subscribes to the SDK for itself. It needs the
 * event's *name* (a recovery link or a sign-in), keys on the token, and
 * gives no reader to any screen.
 */
import type { Session } from "@supabase/supabase-js";

import { noteReader } from "./reader-change.js";
import { supabase } from "./supabase.js";

/**
 * Whose token a session carries: the reader it names, when it has a token and
 * names one. `null` is *nobody can say*, never *nobody*.
 */
export function tokenOwnerOf(
  session: { access_token?: string; user?: { id?: string } | null } | null | undefined,
): string | null {
  return session?.access_token ? (session.user?.id ?? null) : null;
}

let held: Session | null = null;
/** False until the SDK has said anything at all. Not "signed out". */
let heard = false;
const subscribers = new Set<(session: Session | null) => void>();

function adopt(session: Session | null): void {
  held = session;
  heard = true;
  noteReader(session?.user?.id ?? null);
  for (const tell of [...subscribers]) {
    /* One subscriber that throws must not leave the others a reader behind. */
    try {
      tell(session);
    } catch (e) {
      console.error("[session] a subscriber failed", e);
    }
  }
}

supabase.auth.onAuthStateChange((_event, session) => adopt(session));

/** The token this tab last heard, for a request that cannot wait to ask (`leavingFetch`). */
export function heldToken(): string | undefined {
  return held?.access_token;
}

/**
 * The reader this tab holds, as far as a token can vouch for one
 * (`tokenOwnerOf`). `null` before anything is heard, signed out, and for a
 * session that names nobody.
 */
export function heldReader(): string | null {
  return tokenOwnerOf(held);
}

/**
 * Hear every session from now on. **A subscriber that arrives after something
 * was heard is told what is held, at once**: the SDK has nothing new to say
 * to it, and `useSession` would otherwise wait in `loading` for an event that
 * is not coming. Returns the unsubscribe.
 */
export function onSession(tell: (session: Session | null) => void): () => void {
  subscribers.add(tell);
  if (heard) tell(held);
  return () => {
    subscribers.delete(tell);
  };
}

/**
 * **A session seen somewhere other than an event, that names a different
 * reader from the one held.** `api.ts` calls this when a token lookup answers
 * as somebody else: storage has moved on and the broadcast has not arrived.
 * Adopted exactly as an event would be, so the screen redraws for the reader
 * the token belongs to; without it, every request the old screen made would
 * be refused until the SDK got round to saying so.
 *
 * Only known to different known. Never signs anybody out, which is the SDK's
 * to announce, and never replaces a session with an equal one.
 */
export function sessionObserved(session: Session): void {
  const theirs = tokenOwnerOf(session);
  const ours = heldReader();
  if (theirs === null || ours === null || theirs === ours) return;
  adopt(session);
}

/**
 * Back to a tab that has heard nothing. **For tests**, which share this
 * module between cases: the subscription is made once, at import, and what it
 * holds would otherwise be the last case's reader. Subscribers are kept.
 */
export function resetSessionForTests(): void {
  held = null;
  heard = false;
  noteReader(null);
}
