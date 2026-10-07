# A null sentinel is widened by a truthiness check

Found during the 261006g stage 1 review, 2026-10-06. Parent:
[postmortems.md](../project/postmortems.md). Reader impact has not been established; the candidate
had not been checked in a real browser when this review began.

The three always-mounted reads gained an explicit `200 null` response for an article whose artefact
has not been made. In Quiz and Citations, `if (!loaded)` treated `false`, `0` and `""` as the same
absence. An opening read offered the generation button without an error; a revalidation discarded
the artefact already on screen. A malformed server reply therefore looked like a legitimate empty
state.

## The class: a sentinel's neighbours are accepted as the sentinel

The protocol named one JSON value, `null`. The implementation tested JavaScript truthiness, a
different and wider set. `readJson<T>` describes the expected response to TypeScript; it does not
validate a parsed JSON value. The hook's state transition used that unchecked value as evidence of
absence, and cleared good state before any error could be reported.

`git log -S 'if (!loaded'` and blame identify **`480d208a8`** as the introduction in both
[`useQuiz.ts`](../../src/web/useQuiz.ts) and [`useCitations.ts`](../../src/web/useCitations.ts).
Its intended change was replacing routine 404 replies with an opt-in null response while preserving
the old 404 compatibility branch.

There was also an inherited Citations validation gap: truthy malformed responses such as `{}` or
`{ citations: null }` were published as ready. Blame traces that publication to **`abde65f7c7`**, the
original Citations mode. This is distinct from the new falsy-to-absence regression. Crossrefs has
no generation-button state; its existing drawing guard returns no links for malformed bodies.

## Why the checks agreed

The original six hook tests covered the two permitted absence responses (`200 null` and 404) in
the three hooks. They tested inclusion in the new branch, without testing exclusion of neighbouring
JSON values or preservation of a previously loaded artefact. The type parameter could not detect
that omission. The wider candidate run supplied to the reviewer passed 701 tests, but that result
contained no malformed-body assertion for this branch.

The review added opening-read and revalidation cases for `false`, `0`, `""`, `{}` and an object
whose artefact field is null. The reviewer observed **16 failures before the fix** in
[`none-yet-is-not-a-404-hooks.test.tsx`](../../tests/none-yet-is-not-a-404-hooks.test.tsx): twelve
from the new truthiness regression and four from the inherited Citations publication gap. The
remaining malformed Quiz cases already failed safely before publishing state.

After the fix, the four requested local suites passed **195 tests**, including all 34 hook cases.
The final run added dispatcher-boundary and neighbouring hook suites and passed **299 tests in
10 files**. All four typecheck projects passed via `node --import tsx scripts/typecheck.ts`;
the npm entry point could not open its IPC socket in the review sandbox.

## What would have caught it, ranked by ease against value

1. **Test the values adjacent to a wire sentinel, on opening and revalidation** — added in this
   review. A small table distinguishes the permitted absence from malformed replies and observes
   whether good state survives.
2. **Use an exact sentinel predicate and validate before publishing** — implemented in both hooks.
   `loaded === null` expresses the protocol; basic artefact checks route malformed bodies through
   the existing error path before any state changes.
3. **Add schema validation to every API response** — rejected for this stage. It would widen a
   narrow protocol fix across unrelated readers. The present checks defend the artefact container
   and collection needed by these hooks; they do not claim to validate every nested item.

## The fix that is right for the long term

Keep explicit absence separate from failed decoding. For this nullable protocol, strict equality
plus validation before state publication is the appropriate local fix; a truthiness predicate can
never express the intended contract. The same regressions must remain green for both the first
reply and later replies, because preserving a good artefact is part of decoding failure, rather
than an optional error-message detail.

The related [failure-presence postmortem](261005i-failure-presence-inferred-from-message-contents.md)
shows the inverse shape: payload truthiness deciding whether failure exists. In both cases the
payload's incidental properties replaced the explicit state boundary.
