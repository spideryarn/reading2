# A caught read exception does not roll back queued state updates

The 2026-10-04 review of sweep cluster 5 exposed a pre-existing malformed-success defect in the
Ideas, Quotes, Glossary and Quiz readers. A 200 whose artefact field is `null`, after a successful
read, clears the artefact before throwing. The catch preserves `ready`, so preserving the status
does not preserve what the reader was reading. No production incident was established.

The defect predates both candidate commits. The review repaired the setter ordering narrowly in
the edited read seam because stage 1 explicitly promises to preserve a loaded artefact through a
failed revalidation. Broader runtime validation of successful response shapes remains outside this
repair.

## The class: publication starts before the read has finished checking its result

Each reader calls `setArtefact(loaded.artefact)` before evaluating
`loaded.artefact.profileHash`. `readJson<T>` gives the caller a TypeScript type, not runtime proof of
the response shape. For a null artefact the setter is queued, then the property access throws.
React does not roll back state setters when the surrounding JavaScript throws. The catch keeps
the previous `ready` status, but the old artefact has already been replaced with null. Stale and
outdated flags can also be changed before the exception.

The protection was aimed at exceptions before publication, such as a failed fetch. It did not
consider an exception midway through publication. The sibling readers make this a repeated
publication-boundary error, rather than one mistaken property access.

## Which commits introduced it

| Reader | Introducing history |
| --- | --- |
| Ideas | `2ce519d6b`, *Draw the ideas the way search draws its hits, and let both step through them*, placed the setter before the dereference. `47a3959c73`, *A reload that failed took away the list the reader was already reading*, added the preserving catch, completing the misleading `ready` plus null state. |
| Glossary | `43a8285e15`, *The hook App.tsx has been importing for a day*, introduced the setter, dereference and preserving catch together. |
| Quotes | `e5fefee2b5`, *A tenth mode whose list is the article itself, and one function to prove it*, introduced the same sequence and catch. |
| Quiz | `b5b21cb565`, *261002f: Quiz has the written-for-your-profile badge, with Regenerate*, added the immediate profileHash dereference after the existing setters. The original read and preserving catch came from `478a63a0ae`. |

All are present before candidate base `ab8289e2a`. Stage 1's `64e947f0e` changes their catch copy and
adds retry, but does not introduce the publication sequence. Quiz's unbuilt stage 2c is not a repair
for this defect and was not examined here.

## Why the checks do not establish preservation

[The candidate matrix](../../tests/read-error-matrix.test.tsx) tests transport failures and throws
from response parsing, both before any setters are reached. Its valid success fixtures cannot
exercise partial publication. Typechecking accepts the generic response type without checking the
wire data. Neither establishes that every failed read leaves the previous artefact intact.

Four new rows, *reports PAGE_FAULT without committing the broken artefact, and retry keeps the
loaded one*, were red before the repair: expected the previous artefact object, received `null`.
They became green after deriving `profiled` before the first setter. The combined targeted run with
the two empty-picture revalidation rows went from six failures to six passes.

## What would have caught it, ranked by ease against value

1. **A successful read followed by a malformed 200** — a small hook test for each sibling. Assert
   artefact identity and associated flags survive, while a fault is disclosed. It must fail on the
   current setter-before-dereference shape, not just on a rejected fetch. Added for all four readers,
   seen red, then green with the ordering repair.
2. **Check and derive before publishing** — validate the response's required shape and calculate
   all fields that may throw in local variables before the first setter. This is the smallest
   repair that closes the partial-publication class for these readers.
3. **A single state object for atomic publication** — useful if state transitions grow, but more
   expensive and still requires a runtime boundary check. It is not required for this repair.
4. **Optional-chain profileHash or default a null artefact** — rejected. It removes this exception
   while treating a malformed 200 as a successful replacement; the old artefact still disappears.
5. **A generic artefact-read hook** — rejected within this sweep's scope and explicit contract.
   Sharing read policy would not itself validate the result before publication.

## The fix that is right for the long term

The review patch derives `profiled` before any setter. Null or missing artefacts now throw before
the previous accepted state is touched. It does not introduce a response validator or change
Quiz's unbuilt `readMark` work.

The broader design is to treat acceptance of a replacement as a boundary: validate and derive first,
then publish its state. Keep a failed result's reader sentence separate from the last accepted
artefact. A non-null artefact with invalid inner fields can still pass this limited dereference;
structural validation remains outside the sweep. Merely guarding `setStatus` cannot promise
preservation while the artefact and related fields have independent, already-queued setters.

Up: [Postmortems](../project/postmortems.md).
