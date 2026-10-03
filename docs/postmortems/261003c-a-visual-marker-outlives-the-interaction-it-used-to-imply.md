# A visual marker outlives the interaction it used to imply

Found reviewing [261003i stage B](../plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md),
with the root cause independently checked in a subagent.

[`TableView.tsx`](../../src/web/TableView.tsx)'s touch exclusion
`mark.hit:not([data-quote])` originated in `cf2f7f739`. It was redundant while
all non-quote hits wore `data-wash`. `bddc97fbc` removed quick hits' wash but
deliberately retained that exclusion: a whole paragraph now looked like plain
prose while its invisible mark still refused the tap that reveals the gutter.
Keeping `data-hit` for navigation had been mistaken for keeping an interaction
contract. No handler consumes a bare search hit's tap.

The real TableView regression in
[`block-selection-by-tap.test.tsx`](../../tests/block-selection-by-tap.test.tsx),
“selects an invisible quick hit on touch”, failed with
`the invisible quick hit blocked the gutter: expected [] to deeply equal ['spya-rg493b']`.
Existing tests covered plain prose, quotes and visible washes; annotation tests
proved the absence of paint without testing the new tap target.

The fix removes the generic non-quote exclusion. Concrete wash and interactive
comment/chat/term/citation/cross-reference selectors still retain their taps;
a bare hit alone allows paragraph selection. This is the long-term policy too:
exclude a target for the action or visible treatment it actually carries,
rather than for an identity marker shared with unrelated features.

Countermeasures, ranked by ease against value:

1. **Test an appearance change through interaction as well.** Added a real
   rendered bare paragraph tap with touch compatibility hover disabled, plus
   a comment overlap that must still refuse selection. Existing quote/wash
   tests remain positive controls for the exclusions that survive.
2. **Audit consumers of retained marker classes when rendering changes.**
   Cheap searches for `mark.hit` would have exposed this touch policy beside
   the navigation and flash consumers that motivated retaining the mark.
3. **Rewrite selection around nearest generated mark and DOM ancestry** —
   rejected here. It addresses a separate older source-authored nested-mark
   limitation and adds no protection needed for this regression.

Up: [Postmortems](../project/postmortems.md).
