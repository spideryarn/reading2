# Derived tree identity mistaken for stored tree replacement

The code review of [open before Structure](../plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md)
found that an article's image redraw cleared a real Diagram hover and Structure's held keyboard row.
This was reproduced in component tests; whether it reached a reader was not established.

The regression entered in `ff4f19726`: both panels began clearing transient node state on a change to
their derived `SummaryNode` root. That correctly clears positional ids during a real tree swap, but
`buildSummaryTree` also runs again when image hosting replaces block HTML. The stored tree is unchanged
then; only its rendering inputs have changed. Derived object allocation was mistaken for semantic
replacement, so the reset discarded choices the reader had just made.

The existing Outline replacement test shared that assumption: its supposed new tree was another
`buildSummaryTree` call over the same stored tree. It therefore endorsed the reset on an image redraw.
The Diagram replacement test used a genuinely new stored tree, but had no same-tree redraw control.

The fix keys each reset on `root?.node`, the stored root node retained by `buildSummaryTree`, rather
than its newly allocated wrapper. Images retain that stored node; fetching and installing a new tree
replaces it. No second identity prop or tree fingerprint is needed.

Both redraw assertions were observed red before the fix: Diagram's card reverted from `Section n3`
to `you are here`; Outline's active descendant changed from `outln-n-p` to `outln-n-s-3`. Both complete
test files then passed (29 and 30 tests). The Outline fixture now clones the stored tree for the real
replacement. Mutating its reset to run only at mount made the final replacement assertion fail while
the redraw assertion still passed, establishing the two cases separately.

Countermeasures, ranked by cost and value:

1. **Pair each replacement test with a same-source redraw.** Added here. It exercises the distinction
   the reset must make, rather than agreeing with the dependency the implementation chose.
2. **Use source identity for state invalidation.** Applied to both panels. Computed view objects can
   be rebuilt for layout or assets without invalidating the objects the reader chose.
3. **Introduce a revision token through every component.** Rejected for this change: these panels
   already retain the stored node, so another prop would duplicate available identity.

Up: [postmortems](../project/postmortems.md)
