# An unauthenticated diagnostic sentence became control flow

The readiness wrapper classified any output line beginning `NO TESTS RAN AND NOTHING WAS VERIFIED`
as an admission refusal and replaced the process outcome with `void`. Code review caught it before
the periodic loop started; nothing reached a reader. A test, fixture, or log could print the same
words during a genuine failure, and a real late Vitest refusal could erase an earlier typecheck or
build failure because `check.ts` continues through every step.

Introduced by `0dc023fb` as the repair for a real false red: Vitest's memory admission throws before
tests run, but the enclosing check exits 1. The mistake was treating a human diagnostic as proof of
which component emitted it and of what the rest of a multi-gate run had done.

## The class: unauthenticated output cannot authorise a semantic override

Process output is a shared, in-band channel. The wrapper sees bytes, not provenance. Exact wording,
a longer prefix, or a larger chunk bridge changes collision probability but cannot establish who
printed a sentence. And evidence about one nested gate cannot replace the aggregate outcome of gates
that ran before it.

## Why nothing went red

The original red-first test proved the intended conversion in isolation: exit 1 plus the refusal
sentence became void. It did not include ordinary output containing the sentence, or a full-check
table with an earlier failed gate. The test therefore defended the change while assuming the two
properties the code needed to prove.

The review first made both assumptions fail: an unmarked real refusal was accepted, and a check with
`typecheck FAILED` plus a later refusal became void. Both cases now stay red unless the refusal bears
the wrapper's one-run token, and the full-check path preserves the earlier failure.

## What would have caught it, ranked by ease against value

1. **Require provenance before an output string changes a record's meaning.** Done with a random
   per-run token inserted only by `vitest.config.ts` and consumed from the environment before test
   workers start.
2. **Test the composition, not only the local conversion.** Done: the fixture now carries an earlier
   failed gate and asserts that only the test row becomes `did-not-run`.
3. **Replace stdout with a dedicated IPC channel.** Rejected. Passing a private file descriptor
   through npm and its shell children is more moving machinery than this one event earns; the
   consumed nonce makes accidental impersonation unavailable while preserving ordinary logs.

## The long-term fix

The wrapper generates a fresh token for each child. Vitest inserts it beside the refusal and deletes
it before workers inherit their environment; the capture requires the exact adjacent sentence and
token. For a direct test the authenticated refusal yields `void`. For `check`, the parser changes the
test row from `failed` to `did-not-run`, keeps any other failed gate, and refuses to override an
aggregate failure when the summary table is missing.

## The thing I would tell myself

I saw a distinctive sentence and treated distinctiveness as identity. Before output is allowed to
change control flow, I need evidence of its emitter; before a nested fact replaces an aggregate
outcome, I need evidence about every sibling it would erase.

---

Up: [postmortems.md](../project/postmortems.md)
