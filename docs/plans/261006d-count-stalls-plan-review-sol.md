Change first: the plan misses two reachable deadline paths that would produce a misleading measured zero.

- **F15 — P1, established: two unnamed deadlines become `abort`.** [Structure’s per-call cap](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/src/structure-slices.ts:593) calls `own.abort()` and passes that signal directly to `streamMessage`. [The PDF figure budget](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/src/collect-pdf-figures.ts:427) aborts with a plain `Error`; its signal reaches `openRouterJson` through `openRouterFigureLocator`. Under the proposed mapping, both write classified `abort` rows. A group containing these timeouts would therefore display **timed out: 0**, without the plan’s stated exceptions explaining them. Structure also discards incoming reasons in its `onStop` forwarding.

  **Smallest correction:** recognise these clocks and preserve forwarded reasons. Alternatively, explicitly document both omissions and label the figures as counts of recognised clocks. The pipeline job deadline is already a declared exception; these two are not.

- **F16 — P2, reasoned: preserve the Messages retry decision independently of ledger failure fields.** [The retry loop](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/src/messages-stream.ts:705) determines cancellation using `recordFailure(err) === null`. Inside `recordFailure`, failure truthiness also selects `error` versus `aborted`. Making an abort’s failure object non-null must change neither decision accidentally.

  **Smallest correction:** explicitly retain the null return sentinel for aborts while recording their metadata, or return a discriminated end and test its outcome. Add a before-answer clock-abort test asserting one request, an `aborted` row, and no retry warning.

- **F17 — P2, reasoned: a later external reason need not have caused an SDK abort.** The SDK probe demonstrated: `stream.abort()` → SDK abort settles → external deadline fires → delayed `finalMessage()` rejects. At recording time, `stream.aborted` is true and the external reason says deadline, although that deadline did not stop the stream. Reading `options.signal.reason` then would misattribute it. I found no production caller exposing `stream.abort()` through `MeteredCall`, so this is not an established production failure.

  **Smallest correction:** capture external-signal attribution when the SDK reports its abort; an independent SDK abort remains `abort`. Test delayed settlement.

- **F18 — P3, established: null class does not necessarily mean an old row.** [Realtime maps cancelled and incomplete responses to `aborted`](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/src/live.ts:987) and [continues writing null failure fields](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/src/live.ts:1559). Thus “N earlier stops” can describe new responses.

  **Smallest correction:** say “N stops not classified,” and explain that null includes older rows and uninstrumented wires. The proposed arithmetic otherwise preserves the unknown portion rather than silently treating it as zero.

- **F19 — P3, established: the causes filter is described inaccurately.** [It currently filters only on non-null phase](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/src/cost-cube.ts:580), not `outcome === "error"`. A prospective `aborted / mid_answer / abort` row appeared in the causes table in my probe.

  **Smallest correction:** specify replacing that predicate with non-null phase **and** either an error outcome or an aborted outcome classified as `stall`/`deadline`. The plan’s intended exclusion is correct.

- **F20 — P3, established: the deployment premise is stale.** Against the available refs, `git merge-base --is-ancestor e5a9c07a7 origin/main` exits **0**; `origin/main` is `3ae7465c9`. Remove the assertion that this commit is absent from `origin/main` and the resulting assurance of gap-free data.

The runtime checks support the normal attribution path. On Node **26.8.1**, `AbortSignal.any` preserves the winning reason; `AbortSignal.timeout` supplies a `DOMException` named `TimeoutError`; native `fetch` rejected with that exact reason before headers and during body consumption. The Anthropic SDK instead rejected with `APIUserAbortError`, while the original external signal retained its reason, both before and after `message_start`. Cancellation during backoff correctly creates no additional attempt row.

I found no incompatible failure assumption in *died part-way*, give-up SQL, the eval budget, detail reads, or the two-read agreement check. Keeping the job deadline as a documented exception is defensible, though the counts remain incomplete.

**Validation:** 259 tests passed across five gateway and cost test files. No repository files changed.

VERDICT: change first