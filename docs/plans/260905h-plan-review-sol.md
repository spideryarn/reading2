Verdict: **refuse as written.** F1 and F2 are established P0s: both permit a Back navigation to cause an unintended paid request.

### F1 — P0 — established

**(a) A fresh press made while the fallback is visible remains ownerless.**

Sequence:

1. Press Ideas; token `N1` is armed.
2. Ideas throws; `componentDidCatch` retires `N1`; fallback appears.
3. Press the already-active Ideas Dock button. The existing control always arms `N2`, including for the active mode ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/Dock.tsx:1474)); that behaviour is deliberately tested today.
4. The boundary is already broken, so it renders no controller and catches no new error. Nothing claims or retires `N2`.
5. Press Plain, then Back to Ideas.
6. The new controller claims `N2` and can POST the paid Ideas job.

This survives the plan’s final design, not merely an intermediate stage.

**(b) Smallest closure**

Add:

> While the fallback is showing, a changed exact press identity is a fresh Dock activation. It resets the boundary once so the controller can claim that press immediately. If that render fails, `componentDidCatch` retires that same identity; if it succeeds, normal `useAutoRun` semantics apply. Merely changing boundary props must never leave the new press parked behind the fallback.

Test both outcomes:

- fallback → press active Ideas → throws again → Plain → Back: zero POSTs;
- fallback → press active Ideas → succeeds: exactly one POST attributable to that click.

### F2 — P0 — established

**(a) Stage 1 commits the exact charging bug Stage 2 is meant to prevent.**

Stage 1 installs a usable local fallback without retirement; Stage 2 adds retirement later ([plan](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md:126)). After the Stage 1 commit:

1. Dock press arms a token.
2. Initial Ideas render throws before `useAutoRun` claims it.
3. The new fallback makes Plain usable.
4. Back remounts Ideas and spends the ownerless token.

Before the local boundary, the root fallback removed navigation, so this particular route to the charge did not exist. Stage 1 therefore introduces an incorrect-charging regression while claiming to end green.

**(b) Smallest closure**

Merge Stages 1 and 2 at the commit boundary:

> The local boundary and exact-token retirement land in the same stage and commit. There is no green stopping point with the boundary usable and retirement absent. The Dock-press → throw → Plain → Back test is red before either change and green before the stage is committed.

### F3 — P1 — established

**(a) The proposed retirement identity omits `sessionEpoch`.**

The authoritative contract requires `(sessionEpoch, slug, target, nonce)` ([parent plan](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905e-main-app-architecture-review.md:247)). The candidate proposes only `(slug, target, nonce)` and a prop without the epoch ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md:46)). The store already records the epoch because it is load-bearing ([activation.ts](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/activation.ts:167)).

Nonce monotonicity makes a present production collision unlikely, but that does not satisfy the authoritative exact-identity contract.

**(b) Smallest closure**

Store and expose a stable identity object:

```ts
export interface ActivationIdentity {
  readonly sessionEpoch: number;
  readonly nonce: number;
}

export function retireActivation(
  slug: string,
  target: AutoRunTarget,
  identity: ActivationIdentity,
): boolean {
  const held = pending.get(keyOf(slug, target));
  if (
    !held ||
    held.nonce !== identity.nonce ||
    held.sessionEpoch !== identity.sessionEpoch
  ) return false;

  pending.delete(keyOf(slug, target));
  emit();
  return true;
}
```

The snapshot object must retain stable reference identity while the token is unchanged, as required by `useSyncExternalStore`.

### F4 — P1 — established

**(a) The plan explicitly accepts stale Ideas marks, contrary to A2’s cleanup requirement.**

The plan says a failed controller leaves `ideaFound` and `openOccurrence` “at their last value” ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md:74)). While `mode === "ideas"`, those values continue feeding the prose marks and selected ring ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/App.tsx:2308)). That is misleading state, not merely reduced functionality.

The current controller has unmount cleanup, and A2 explicitly requires a failed controller to follow it. Merely asserting that prose exists does not prove this.

**(b) Smallest closure**

Replace the paragraph with:

> `ideaFound` and `openOccurrence` remain reader-owned, but a previously committed Ideas controller that fails must be unmounted and its existing cleanup must clear both. Once the fallback settles, the prose remains readable with no stale Ideas marks or selected ring.

Add an update-failure test: first publish and select a real occurrence, then make the panel throw on a later render, and assert the fallback, prose and Dock remain while all Ideas marks and the ring disappear.

### F5 — P1 — established

**(a) The Dock correction omits focus on opening.**

The stacking conclusion is correct: scrim, drawer and Dock are sibling fixed elements, with the Dock above both. But the drawer appears before the Dock in DOM order, and `DockTab` only calls `onPanel`; nothing moves focus into the newly opened dialog ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/Dock.tsx:1573)).

After opening with Enter, focus remains on Comments. Tab proceeds to later Dock controls, not into the preceding drawer. Asking “does Tab leave the drawer?” is vacuous if focus never entered it.

**(b) Smallest closure**

Replace the expected correction with:

> Drop `aria-modal`, keep the labelled `role="dialog"`, record the opener, move focus to the close button or first usable drawer control on open, leave focus untrapped, and restore the opener on Escape, scrim, close-button and toggle closure.

The interaction test should cover Enter-to-open, initial focus inside, untrapped Tab, and focus restoration on every close path.

### F6 — P2 — established

**(a) The reset key does not contain what its prose claims.**

`slug|owner-or-visitor|mode` contains an access class, not access identity, and no sub-mode ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md:63)). Current `ArticlePage` unmounting probably masks same-slug account changes, and Ideas has no true sub-mode, so this is not a demonstrated current failure. It does invalidate the claim that this key makes the boundary reusable for later modes.

**(b) Smallest closure**

Either pass the actual reader/access identity and a feature-specific sub-mode into the reset identity, or state explicitly that `(slug, readerId)` changes reset structurally by unmounting `Reader` and test owner A → owner B on the same slug. Do not call `owner|visitor` an access identity.

### F7 — P2 — established

**(a) The `componentDidCatch` spike overclaims what it measured.**

A boundary given a constant `press={41}` cannot distinguish “props from the failed render” from “current props at catch time”; both are 41. It establishes the once-only StrictMode commit, not the load-bearing prop association.

My React 19 harness found:

- failing child renders: 3;
- `getDerivedStateFromError`: 4;
- `componentDidCatch`: 1;
- caught constant prop: correct.

A concurrent distinguishable-prop stress run caused React to restart against the newer props before committing, so I did not reproduce deletion of a newer token. But the plan’s constant-prop experiment does not prove its stated conclusion.

**(b) Smallest closure**

Rename the spike conclusion to:

> `componentDidCatch` commits once under StrictMode when props remain unchanged.

Then add a harness with distinct `N1`/`N2` identities and errors tagged with the identity whose render threw. Assert the caught error identity and retired identity agree.

### F8 — P2 — established

**(a) Two proposed checks can report success without proving their claims.**

- The containment test asserts prose, Dock and Plain, but not that the throwing mock ran or that the local fallback appeared. A disconnected mock would make all three assertions pass.
- The “real request trace” is captured before extraction but is not repeated and diffed afterwards, so “baseline captured” is a record, not a falsifiable preservation check.

If written after the extraction as ordered, the correctly connected containment test should go red on the unbounded tree; I found no evidence otherwise. The issue is its missing positive control.

**(b) Smallest closure**

Require:

- a throw invocation count;
- the Ideas fallback’s bracketed code;
- the expected sanitized report;
- absence of the root `[render]` fallback;
- before/after request traces diffed by URL, method and POST count for Plain, Ideas and Chat.

The existing `tests/modes-that-start-themselves.test.tsx` passed all 21 tests, confirming that pressing an already-active Ideas mode is intentional supported behaviour. No files were changed.