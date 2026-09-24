Verdict: changes requested. I would not approve the plan as written because F1 is an established P1.

### F1 — P1, established: the button’s promised operation is not part of the job

The plan says the stage can infer append versus replace when it eventually runs ([plan:24](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924d-choose-them-again-on-an-outdated-quote-list.md:24)). That does not preserve what the reader pressed:

- `regenerate()` sends only `force: true` ([useQuotes.ts:305](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/useQuotes.ts:305)).
- `work_key` includes steps, force, profile, upload and URL—but neither quote action nor prompt version ([jobs.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/store/jobs.ts:81)).
- The durable, cross-instance queue reads the baseline only when the stage executes ([pipeline.ts:3186](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/pipeline.ts:3186)).

Concrete scenario: a reader presses **Find more** on a current `quotes/6` list. Before execution, a deploy bumps the prompt. The new worker sees the same list as outdated and replaces it. The inverse is also possible during a rolling deploy: new UI offers **Choose them again**, but an old worker regards the list as current and appends. An identical forced request can also deduplicate onto an already-active job from the other build.

Therefore the claim that sharing `isOutdated` means the banner and stage “cannot disagree” is false across time and deployment instances. This can discard the existing list and orphan most quote links after the reader explicitly pressed an append action.

Smallest change: carry the intended quote operation through `POST /api/jobs`, the persisted job and `work_key`, even though the UI still shows only one action in each state. Include the baseline version/source hash as a precondition; if it changed before execution, fail safely and ask the client to reload rather than changing verbs. Metadata reruns and retries must explicitly choose or preserve their intended behavior. Add a test that changes the baseline/prompt between enqueue and execution.

### F2 — P1, established: text-only inheritance can move a bookmark to another occurrence

The plan explicitly accepts transferring an ID between identical passages in different blocks ([plan:52](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924d-choose-them-again-on-an-outdated-quote-list.md:52)). That preserves words but not the bookmarked occurrence.

Concrete scenario: the same sentence appears in blocks A and B; the old quote points to B. `idsByText` records only normalized text, while `locate` chooses the first acceptable occurrence in document order. On rewrite, the old ID can therefore be attached to A. The deep link now selects, rings and jumps to a different part of the article.

Smallest change: inherit using occurrence identity—at least normalized text plus `blockId`, and `start` where repeated text occurs within one block. For legacy records without `start`, recover it safely or decline inheritance. Add a two-block duplicate-passage regression test.

### F3 — P1, reasoned: “outdated” must not mean merely “different”

The plan repeatedly says “older prompt”, but the existing read path uses version inequality. During rollback or overlapping deployments, an old `quotes/6` worker can encounter a `quotes/7` artefact and classify the newer list as outdated, then replace it using the older prompt.

Smallest change: make version comparison directional or tri-state: current, older, and newer/unknown. Only “older” is eligible for this rewrite; newer/unknown must refuse rather than downgrade. An explicit expected-version precondition from F1 largely closes this as well.

On the two suspected product questions:

- Hiding **Find more** on an outdated list is justified; appending cannot repair the short overlapping quotes. A request flag is still needed for correctness, but it does not require showing both buttons.
- A deploy changing a queued **Find more** into a replacement is not acceptable because it reverses the reader-visible verb and loses their list silently.

I found the metadata forced rerun and forced-job retry paths in addition to the Quotes panel; the shelf’s forced fetch does not sweep Quotes because Quotes is force-only-when-named.

No tests were run: this was a plan review, and the shared worktree acquired in-progress edits to the target files during the review. I made no changes.