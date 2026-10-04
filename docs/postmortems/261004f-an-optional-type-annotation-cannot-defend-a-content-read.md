# An optional type annotation cannot defend a content read

Up: [postmortems.md](../project/postmortems.md) ·
change: [261004d](../plans/261004d-fifth-sweep-cluster-19-one-helper-for-reading-a-messages-result.md)

Caught in code review on 2026-10-04; no reader failure was demonstrated. Commit `5b63cdd8f`
added a source guard intended to stop stages bypassing `finishedText`. It looked for
`Anthropic.TextBlock`, an optional annotation copied by the old stages, rather than the content
read itself. An inferred filter, conditional map, indexed read, destructuring or loop passed.

The class is **a syntactic proxy mistaken for a semantic invariant**. The positive control used
the helper's same annotation, proving the detector saw that spelling while leaving ordinary
alternative implementations invisible. The guard's zero-offender assertion was useful; the
predicate deciding what counted as an offender was wrong. Independent subagent review reproduced
the inferred filter against both original regexes: neither detected it.

Six regression cases failed first with `expected false to be true`. The corrected guard parses
literal content access and object binding in modules importing the Messages gateway or SDK.
Request object keys, strings and unrelated modules are allowed. A mutation replacing Arc's
`finishedText` call with an inferred filter/join then failed the real source scan with
`expected [ 'src/arc.ts' ] to deeply equal []`.

Countermeasures, ranked by cost against value:

1. **Adversarial examples of the operation, not its usual spelling** — implemented in the same
   test as the source guard, so a broken detector cannot report a clean census.
2. **Parse the ownership boundary and literal accesses** — implemented using existing Babel
   dependencies. It catches different result variable names and bracket/destructuring reads.
3. **Resolve every result's type and follow aliases across modules** — rejected for this guard.
   That would be a much larger analysis system than the helper change warrants. Indirect imports,
   dynamic property keys and implicit reads through spreads remain outside this guard's claim;
   unrelated content reads inside a Messages consumer also need a deliberate design decision.

The long-term fix here is the bounded parser guard plus behavioral refusal tests, rather than a
growing list of filter spellings. The principle already lives in
[silent-success.md](../reusable/silent-success.md): calibrate a detector against the ways the
forbidden operation can actually be written.

Verification in the review sandbox used a temporary `node --import tsx` launcher for the existing
behavioral child, because the `tsx` CLI's IPC socket was denied. That launcher change was reverted;
the guard and its fixtures do not depend on it.
