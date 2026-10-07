# Cancelling an input method key to suppress application dismissal

K3 review on 2026-10-07 found that `ShelfTags` kept its popover open during composing Escape by
cancelling the native key. `3aad96ec5` introduced this guard. Its test proved the popover did not
close, but never checked whether the input method could still receive its default action. No
native input method was measured during this review.

## Suppressing an application handler by cancelling a browser-owned default

Radix's installed `DismissableLayer` handles Escape during document capture. It dismisses and
cancels the key unless `onEscapeKeyDown` has already cancelled it. That API makes cancellation
look like the only way to decline dismissal, but cancellation also claims a key whose default
belongs to the input method. The keyboard contract permits containment, and requires composing
Escape in this text input to retain its default.

## The fix and its evidence

Intercept only composing Escape targeted inside this open popover at window capture, before
Radix sees it. Stop propagation without cancelling the default. A React 19 callback ref attaches
the listener when the portal actually mounts and returns its cleanup. A parent effect was tried
during review and failed the same test because the portal content was not mounted yet.

`tests/shelf-tags-popover.test.tsx` now checks `defaultPrevented === false` for both the native
composition flag and the legacy 229 sentinel, alongside the existing open-popover and normal
Escape assertions. The added default assertion failed on the candidate, then passed with the
capture fix. This proves event cancellation and dismissal behaviour; native IME interaction
remains unmeasured.

## Countermeasures, ranked

1. Assert both the application's outcome and the native event's cancellation state for
   browser-owned keys. Added here; cheap, and exposes a successful UI guard with a harmful
   side effect.
2. Read third-party event ordering before choosing an interception point. The installed Radix
   listener establishes why containment must happen before document capture.
3. Patch Radix or replace the popover. Rejected: a scoped capture listener preserves the
   existing popover and its normal Escape behaviour without a dependency fork.

Up: [postmortems.md](../project/postmortems.md). Contract: [keyboard.md](../project/keyboard.md#a-key-an-input-method-is-using-is-not-ours).
