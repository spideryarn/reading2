# A shell substitution kept the links and lost their geometry

Up: [Postmortems](../project/postmortems.md)

Caught in review of `143fdb199bc6e995045ab8d02943c92b1907d87e`, which introduced
the shared signed-out document shell. Production exposure was not checked.
The [review](../plans/261007h-f4b-f5c-code-review-sol.md) holds the findings and
verification results. Root cause was independently checked in a subagent.

The old five document pages reserved `3.5rem + --safe-top` before drawing
their way home. Replacing that house with `SiteNav` preserved navigation but
lost the safe inset: its row began at y=0. With a 59px inset the whole 56px
row was inside the unsafe area. The floor and section offsets also assumed
that the bar was always 57px tall.

The class is **a shell substitution that preserves navigation but drops its
geometry contract**. The existing tests asked whether the expected links
were present. They did not ask which shell still owned safe-area clearance.
The signed-in source check correctly passed while the new signed-out branch
omitted it.

The fix is scoped to `DocumentPage`: its bar padding includes the inset,
its floor subtracts the full bar height, and its section anchor utility adds
the inset. Its box-less token wrapper and the signed-in shell stay intact.

Countermeasures, ranked by cost against value:

1. **Rendered-selector and markup guards** for all three quantities. Added;
   the bar guard failed against the candidate before the fix. These are
   source contracts, not proof of browser layout.
2. **A browser check with a forced nonzero inset**, comparing the bar row,
   footer and anchor rectangles. Stronger than a screenshot at a zero inset;
   unavailable in this review's sandbox.
3. **A general safe-area shell abstraction** was rejected: the document
   shell already owns the quantities, so a second framework would add
   machinery without resolving ownership any better.
