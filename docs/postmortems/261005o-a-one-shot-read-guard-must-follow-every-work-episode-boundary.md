# A one-shot read guard must follow every work episode boundary

Code review of the [open-before-Structure change](../plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md) found three ways its live-tree check could stop telling the truth. No reader incident was established. The defects were introduced in **`ff4f19726`**, which first added `useLateStructure` to open an article early and replace its temporary tree without reloading the reader.

The hook used an `asked` ref to suppress duplicate GETs, including StrictMode's repeated effects. That ref was reset when a Structure job was observed queued or running. The request-generation counter rejected superseded GETs, article changes and sign-out. Those protections covered the ordinary sequence, but not all the transitions that end or begin a work episode:

- A failed article GET left `asked` armed and swallowed the failure. The band kept saying Structure was being built, with no way to read again until another job appeared.
- Observing a new active job cleared `asked` without invalidating the GET already in flight. An answer from the previous episode could replace the tree while the new job was running.
- After a stall, another tab could start and finish Structure between polls. The first observed snapshot was already `done`; the hook never saw an active job, never reset `asked`, and stayed stalled despite the finished tree.

## The class: request admission survives a lifecycle boundary it does not represent

The guard represented “a request was sent,” while its reset assumed “every new episode is observed running.” Neither says whether that request succeeded, remains current, or belongs to the latest completed work. Suppressing duplicate requests became a permanent refusal to reconcile. Separately, allowing another request did not invalidate the old request's right to update state.

The related once-per-slug guard in `useArc` has a different purpose: admitting an arrival-triggered generation. This review found no additional defect there. The lesson is to name the lifetime each guard actually protects, rather than treating every once-guard as the same mechanism.

## Why the existing checks passed

The original hook tests covered a job observed running and then done, plus article and authentication fencing. Those sequences all crossed the one boundary that cleared `asked`. They did not cover a failed read, a response crossing into a new work episode, or completion without an observed active snapshot.

## The fix and the checks, ranked by ease against value

1. **Test lifecycle transitions against the real hook and job engine.** Three focused cases in [late-structure.test.tsx](../../tests/late-structure.test.tsx) were seen red before correction: failed read instead of `unread`; old response accepted during new work; and `stalled` where `final` was expected after an already-completed job first appeared. These directly exercise admission and result acceptance together.
2. **Make each boundary explicit in the existing hook.** A failed GET produces an honest `unread` state with a read-only retry. Observing active work invalidates earlier requests. The existing jobs completion callback rearms reconciliation when completion occurs between polls. The level check remains necessary for work completed before mount.
3. **A separate polling service or a general lifecycle framework was rejected.** The jobs engine already supplies freshness and completion. Another service would duplicate that ownership without improving the missing transitions.

The long-term fix is the same as the review patch: keep request admission, result fencing and reader-visible failure state aligned at each lifecycle boundary. Retry reads the current article; it does not buy another Structure job. Focused hook tests provide the evidence; Postgres publication and queue tests could not execute in this review sandbox.

The final focused hook run passed **29/29**, including StrictMode, sign-out, slug changes and the
images' second draw. The typecheck script also passed for all four projects; its npm wrapper was
blocked by the sandbox's IPC restriction, so it was invoked through `node --import tsx`.

---

Up: [Postmortems](../project/postmortems.md)
