# A return-position snapshot outlives the excursion that made it valid

Stage 1 review reproduced obsolete scroll and focus restoration in the fleet dashboard.
The evidence is from local jsdom tests; this review establishes no production incident.

Up: [postmortems.md](../project/postmortems.md).

## Interaction state without an invalidation boundary

Commit `bcba3df08` captured `{ y, id }` when a one-pane session list opened a detail.
It kept that snapshot until selection cleared. The snapshot actually belongs to an
uninterrupted excursion from that list into that target. Checking only the layout at
close missed intermediate changes: one pane → two panes → one pane, an incoming
selection of another session, or an incoming link to another tmux world. Closing then
called `scrollTo(0, 800)` and focused the original row after that context had gone.

A changed width, ordering or removed row also makes the old pixel offset unreliable. That
does not imply a surviving opener has stopped being a useful keyboard focus target.

Attention cards bypassed the capture altogether: their callback in `App.tsx` wrote
selection directly, while the list used `SessionsPanel.openFromList`. Opening a card
and closing its detail made zero calls to the expected `scrollTo(0, 1200)`.

## Why the checks stayed green

All 20 original history tests passed. They covered direct returns and an excursion
that started at two panes, with no intermediate invalidating transition. They also
never opened a detail from Attention.

Separately, deleting the `hashchange` subscription left all 20 tests green: jsdom's
hash assignments delivered `popstate` too. A new isolated `hashchange` test failed
under that mutation, including after a refused local write.

## The fix and countermeasures, ranked by ease against value

1. **Test intermediate transitions and each input independently.** Added red-first
   tests for layout exposure, changed selection/world, vanished rows, changed ordering,
   and Attention opening. Independent incoming-event tests close the mutation gap.
2. **Bind saved interaction state to its excursion.** Discard scroll and focus targets
   when the list becomes visible or navigation changes target. At close, restore
   focus only to an existing row; restore pixels only for the original list ordering
   and membership at the same width. Temporary unknown tmux readings do not establish a changed world.
   Attention uses the same measured open handler through a React ref; it adds no DOM.
3. **Reject a global navigation/scroll manager here.** Layout knowledge already belongs
   to `SessionsPanel`; moving it adds coordination without supplying the missing
   validity boundary.

The lasting fix is the explicit validity boundary, rather than a special case for
one resize or one link. Browser-native restoration timing remains unverified by
jsdom; the comment no longer promises that the layout effect runs after every native
restoration attempt.
