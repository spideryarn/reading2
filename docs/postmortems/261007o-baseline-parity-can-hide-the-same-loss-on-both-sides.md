# Baseline parity can hide the same loss on both sides

Code review of [261007k](../plans/261007k-readers-comments-left-out-of-a-blog-import-on-every-pass.md)
caught a pre-Readability rule deleting RFC 9110's authored “Comments” section. Nothing reached a
reader: the defect was in the uncommitted stage and has no introducing commit.

## What happened

The new rule treated exact `id="comments"` as a reader-thread container unless one of six markers
appeared below it. The corpus already held the counterexample:
`rfc9110.html` uses `<div id="comments">` for section 5.6.5, ordinary authored prose, and none of
those markers. The guard was trying to prove “not a thread” from a short list; absence from that list
could not prove “thread”. Four red-first tests reproduced the wider boundary before the fix: the RFC
fixture, unmarked post prose sharing a `#comments` wrapper with a real comment list, authored prose
under `#respond`, and a generic `.comment-thread` whose discussion is the page.

## A parity check against a correlated oracle preserves shared mistakes

The reported result was 66/66 identical against `dev`. It was true and did not establish selector
precision. Readability's own broad unlikely-candidate rule also deletes `id="comments"`, so the
baseline and treatment independently lost the same RFC section. The comparison also omitted the
whole `removed` audit, which was the only returned field that exposed the new pass taking that node.

The sibling failure was in the instruments' process contract: all three accepted zero inputs,
`comments-arms` printed `0/0 identical`, and a printed `DIFF` also exited 0. The short-post probe
also labelled a cut as `n=400` when the selected element had only 56 characters, while the leakage
probe could report zero leaks after recognising zero comments. A person reading the intended runs
could notice each problem, but automation could not distinguish them from success.

## What would have caught it, ranked by ease against value

1. **Test the recogniser directly on authored collisions.** Done. The corpus's RFC node must remain
   connected, a mixed wrapper must lose only its inner list, and `#respond` prose and a generic
   discussion thread must remain.
2. **Make each instrument's process result carry its claim.** Done. They refuse empty and degenerate
   inputs; the arms comparison exits non-zero on any difference and compares every old `removed`
   entry while excluding only this pass's one deliberate new key.
3. **Use an independently judged article-region manifest for every selector change.** Rejected for
   this small pass: most fixtures have no semantic manifest, and building them would cost far more
   than the conservative selector boundary. The direct adversaries cover the licence being spent.

## The long-term fix

Do not delete generic outer landmarks such as `#comments` or `#respond`, or a generic
`.comment-thread` without the second token measured on Blogger. Delete the engine-specific inner
list or thread root instead, so a wrapper can contain both an unmarked post and a removable thread.
If support for a page with only `#comments` is added later, positive evidence should identify and
remove the thread descendants; a finite list of absent article markers must not license removal of
the wrapper.

## The thing I would tell myself

“Identical to the baseline” is compatibility evidence, not preservation evidence. When both arms
delegate to the same heuristic, I need one adversary judged independently of that heuristic, and I
need to inspect the audit field that says which new rule acted.
