# Primitive validation loses a discriminated union's meaning

The C4 follow-up to [plan 261007l](../plans/261007l-hidden-text-opus-check-code-review-sol.md)
validated nested Mirror results but accepted either boolean for each known kind's trial badge.
A malformed coverage or placement remark could therefore claim trial evidence. No live reader
incident was established; this was found during review.

## The class: a primitive check discards the discriminator's contract

The shallow validation and cast originated in commit
`8577a6f0b829fb6d2831664ac7b8a675aac06453`. The uncommitted C4 validator replaced that check
with nested validation but retained this semantic gap: the union in
[`referee-mirror-types.ts`](../../src/referee-mirror-types.ts) requires literal evidence flags,
while [`MirrorPanel`](../../src/web/MirrorPanel.tsx) renders the received flag directly.

All five opposite-flag cases in
[referee-mirror-stream.test.tsx](../../tests/referee-mirror-stream.test.tsx) failed before the fix:
expected `failed`, received `done`. Earlier malformed-result tests changed primitive types,
never a correctly typed value that contradicted its kind.

## Fix and countermeasures, ranked

1. **Enforce the known kinds' literal evidence flags at the transport boundary.** Applied with
   five negative regressions. Unknown kinds retain the required boolean and common fields,
   preserving the requested compatibility; positive regressions also cover prototype-name kinds.
   This is the long-term fix: the renderer can keep trusting the validated field.
2. **Test discriminator-dependent values as well as primitive types.** A boolean check cannot
   establish a boolean literal contract.
3. **Recompute the flag in the panel** — rejected. It would conceal an invalid reply rather than
   reject it, and would guess the evidence behind unknown kinds.

Up: [Postmortems](../project/postmortems.md).
