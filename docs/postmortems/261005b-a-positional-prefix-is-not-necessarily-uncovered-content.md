# A positional prefix is not necessarily uncovered content

Up: [postmortems.md](../project/postmortems.md).

Introduced in `805e394c4`, caught in the four-fix code review and root-caused in a
separate agent. `headBlock` selected the first ordinary part and reassigned every
earlier indexed block to that part. This mistook an ordering fact for a coverage
fact: an earlier block could already belong to a supplement, with a title of its
own. Today's producer appends Notes, but the tree invariants allow Notes before
the argument.

The class is **a positional prefix is mistaken for uncovered content**. The
long-term fix checks an existing tree path before borrowing the first part.
[`tests/marginalia-notes.test.ts`](../../tests/marginalia-notes.test.ts) reproduced
the wrong block red first; its Notes-first fixture now also passes `checkTree`.
Both title and arc receive the preserved block through Reader's existing caller.

The same review found that the new helper threw when a root lacked `children`.
Its local regression was red first and the helper now treats that as no first
part. A rendered probe still crashed earlier in preexisting `buildChains`; the
broader malformed-tree behaviour is outside these four fixes and remains a
finding. The candidate did not introduce that full-reader failure.

Countermeasures, ranked by ease against value:

1. Preserve existing membership before applying positional fallback: implemented.
2. Test a valid ordering beyond the current producer's usual output: implemented.
3. Tightening the tree invariant to require trailing supplements is rejected:
   it would change the stored-tree contract to justify one presentation helper.
