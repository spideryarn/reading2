/**
 * **The three rules every passage producer follows, in one place.**
 *
 * Five components resolve passages and hand them up to `Reader`, which owns the
 * prose: `useIdeasMode`, `useTimelineMode`, `useSearchMode`, `CriteriaBand` and
 * `ClaimsBand`. (There were six until 2026-09-08 — see the table below for
 * where Quotes went.) Until 2026-09-06 each held its own copy of
 * the same three effects, and the copies said so — *"a fix to one of these
 * belongs in all three"*, written when there were two and left standing when
 * there were six. Every one of the three rules had been got wrong once in one
 * copy and right in another.
 *
 * The three, and nothing else:
 *
 * 1. **Publish, before paint.** A `useLayoutEffect`, not a `useEffect`. The
 *    panel renders the new list immediately; the prose is `Reader`'s and only
 *    changes once this setter has run and a second commit has happened. A
 *    passive effect runs after the browser may have painted, so there is a frame
 *    in which the panel shows the new passages and the article still marks the
 *    old ones — and *the panel and the prose agree* is the invariant this whole
 *    feature is built around (src/web/search-hits.ts).
 * 2. **An open key that names nothing cannot stay open.** Passive, and keyed on
 *    *absence from `found`* so an ordinary selection change is left alone.
 *    Regenerating mints new keys and a re-extraction can drop a passage; either
 *    way the row and its mark both go while the key survives and the stepper
 *    reads "– / 3" over a list the reader has not left.
 * 3. **Leaving the mode takes the marks with it.** Its own effect, depending on
 *    nothing but the parent's setters, so it runs on unmount and only on
 *    unmount.
 *
 * ## Rule 3 is a *layout* cleanup, and that is the part that was a bug
 *
 * The comments this hook replaces all warned against folding the clear into the
 * *publication* effect, whose data dependencies change on every keystroke —
 * that would clear every mark on the page and set it again on each change, which
 * is a visible flicker of the whole article. That argument is about
 * **dependencies, not phase**, and it was spelled *passive* only because that is
 * how it was first written.
 *
 * Phase turned out to matter. React destroys a deleted subtree's **passive**
 * effects in the passive phase of the commit that deleted it, which is *after*
 * the layout phase in which an incoming sibling published. Referee's two
 * sub-modes are siblings writing one slot (`CriteriaBand` and `ClaimsBand`
 * inside `RefereeSubMode`), so a passive clear ran *after* the incoming
 * producer's publication and overwrote it. A layout cleanup runs in the mutation
 * phase instead — before the incoming sibling's layout effect — so the outgoing
 * producer's goodbye always lands first.
 *
 * It is the right rule for the other five as well, and not only for the pair
 * that share a slot: it removes a field nobody could set correctly without
 * knowing how `Reader` composes bands, and it takes the outgoing marks out of
 * the prose *before* the next paint rather than after it.
 * docs/plans/260906c-plan-review-sol-2.md § F10, and
 * docs/postmortems/260906d-one-publication-slot-two-producers-two-commit-phases.md.
 *
 * ## Three shapes, because there really are three
 *
 * | `kind` | Producers | Inbound key | Rule 2 |
 * |---|---|---|---|
 * | `keyed` | Ideas, Timeline, Search, Criteria | yes, from `Reader` | yes |
 * | `unkeyed` | Claims | no | no |
 *
 * **There was a third, `derived`, and Quotes was its only caller.** It let one
 * producer publish `found` and `openKey` in the *same* layout effect, so no
 * paint could show the ring on one quote and the washes of another set. It went
 * on 2026-09-08, when the quotes stopped being published at all: `Reader`
 * computes them from state it already holds (reader/useQuoteMarks.ts), because
 * they are now marked in every mode and marks pushed up by a band live exactly
 * as long as the band. A memo has that atomicity by construction — one render
 * produces both values and a commit carries both or neither — so the shape had
 * nothing left to buy.
 * docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
 *
 * ## What this hook deliberately does not absorb
 *
 * All of it per-mode product policy with an argument written where it lives:
 * opening the first passage automatically (Ideas and Timeline do; `CriteriaBand`
 * refuses in a comment because several criteria can be on at once; Search has no
 * concept of it); the `wantsJump` intention (Ideas and
 * Timeline, and only on selecting, never on clearing); the *other* triggers that
 * clear a key (Search's matcher, find, solo and toggle-all);
 * Glossary's `termSelections`, which is a different currency with no push-up and
 * no cleanup; and the band-level prop names, `openHit`/`onOpenHit` included.
 *
 * ## The one constraint that is easy to break
 *
 * **Callback identity.** Rule 3 lists the parent's setters as its dependencies,
 * so a setter whose identity changed per render would turn a cleanup that runs
 * on the way out into one that runs on *every* render — and the suite would stay
 * green except for a single assertion, the second `.crit-jump` press in
 * tests/passage-mode-cleanup.test.tsx. This hook therefore passes the parent's
 * setters straight through and never wraps them in a fresh closure, and reads
 * its own dependencies off the input's **fields** rather than off the input
 * object, which is a fresh object on every render.
 */

import { useEffect, useLayoutEffect } from "react";

import type { Found } from "./search-hits.js";

/**
 * What a producer is, from the slot's point of view.
 *
 * A discriminated union rather than a bag of optionals, so that "unkeyed
 * producer that passes an `openKey`" is a state the compiler refuses rather than
 * one a reader has to reason about.
 */
export type PassageLifecycle =
  | {
      /** Ideas, Timeline, Search, Criteria — `Reader` holds the key. */
      kind: "keyed";
      found: Found[];
      openKey: string | null;
      onFound(next: Found[]): void;
      onOpenKey(key: string | null): void;
    }
  | {
      /** Claims — no key at all; the unmount clears `found` and nothing else. */
      kind: "unkeyed";
      found: Found[];
      onFound(next: Found[]): void;
    };

/**
 * A stable no-op for the `unkeyed` shape, so every effect below can list
 * `onOpenKey` as a dependency whatever the kind — a module constant, because an
 * inline `() => {}` would be a new identity on every render and rule 3 would
 * then run on every render. See "the one constraint that is easy to break".
 */
const NO_KEY_TO_SET = (_key: string | null): void => {};

/** The three rules. See this file's header for why each is the way it is. */
export function usePassageLifecycle(input: PassageLifecycle): void {
  /* Read off the fields, never off `input`, which is a fresh object each render. */
  const kind = input.kind;
  const found = input.found;
  const onFound = input.onFound;
  const openKey = input.kind === "unkeyed" ? null : input.openKey;
  const onOpenKey = input.kind === "unkeyed" ? NO_KEY_TO_SET : input.onOpenKey;
  /* Rule 1. No producer publishes a key any more — a `keyed` producer that
     republished its marks every time the reader pressed a different row would be
     doing work for nothing, and `derived`, which did, is gone. */
  useLayoutEffect(() => {
    onFound(found);
  }, [found, onFound]);

  /* Rule 2. Passive, and keyed on absence from `found`. */
  useEffect(() => {
    if (kind !== "keyed") return;
    if (openKey !== null && !found.some((f) => f.key === openKey)) onOpenKey(null);
  }, [kind, found, openKey, onOpenKey]);

  /* Rule 3, and its dependencies are the whole of its correctness: the parent's
     setters and nothing else, so it cannot run on an ordinary update. A
     **layout** cleanup, which React destroys in the mutation phase — before an
     incoming sibling's layout effect, which is what makes the referee's two
     sub-modes able to share one slot. See the header. */
  useLayoutEffect(
    () => () => {
      onFound([]);
      onOpenKey(null);
    },
    [onFound, onOpenKey],
  );
}
