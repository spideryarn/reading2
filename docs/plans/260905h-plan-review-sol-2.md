Verdict: **refuse as written**, on one established P1. The F1/F3 revisions otherwise hold up.

### F9 — P1 — established

**(a) The F8 narrowing does not capture or compare a real request trace, contrary to the authoritative checklist.**

The revised plan claims the named tests “assert the exact requests” and therefore constitute a diff ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md:212)). They do not:

- Plain’s queue test accepts any positive number of `/api/jobs` requests.
- The private-hooks test uses `toContain`; additional requests pass unnoticed.
- Ideas checks that its GET occurred and counts `/api/jobs`, but rejects no additional GETs.
- The named Chat tests primarily assert DOM and URL behaviour, not a complete request sequence.

For example, an extraction that duplicated a Chat GET or added an Ideas GET to Plain could leave every named test green. The baseline records test names, not their captured traces ([baseline](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905h-baseline.md:65)).

That does not satisfy the authoritative requirement to “Capture the real request trace of Plain, Ideas and Chat” ([architecture review](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/plans/260905e-main-app-architecture-review.md:587)).

**(b) Smallest closure**

Replace the candidate’s before/after paragraph with:

> The named tests remain regression coverage, but they are not a before/after trace diff: most assert presence or UI state and do not reject additional requests. Before extraction, capture and retain the existing harness’s normalized `{url, method, auth}` trace for owner Plain arrival, Ideas arrival plus explicit activation, and Chat arrival on the fixture article. After extraction, run the same capture and diff the traces. Normalize only deliberately variable job-poll repetitions, documenting that normalization. The stage is not done until the diff is empty.

### F1-focused result

I found no new failure in the reset-on-fresh-press design.

A React 19.2.8 `<StrictMode>` probe matching the proposed `getDerivedStateFromProps` bookkeeping established that:

- a nonce observed while healthy is committed to `pressSeen`;
- when that same render throws, error recovery retains the updated `pressSeen`;
- `componentDidCatch` commits once;
- a later changed nonce clears `broken` once and remounts the child.

The different-target case is also sound: although activation notifications are global, `pendingActivation(slug, target)` is keyed by both slug and target. A Quotes press leaves the Ideas snapshot unchanged, so `useSyncExternalStore` does not update or reset the Ideas boundary.

The primitive F3 snapshot is sound. A stored token’s epoch cannot change after minting: the token remains private, only `owner` is mutated, and the job-engine epoch is monotonic. The implementation should make the plain identity reader accept the observed nonce and return `null` if the slot has since changed; it need not make an object the `useSyncExternalStore` snapshot.

No files were changed.