The plan is not ready to build. I found four blockers and several smaller gaps.

One important mismatch first: the current plan no longer proposes a 600ms delay. It now removes arrow handling in Stage 0. That is an improvement, but it still incorrectly equates mounting a panel with an explicit activation.

## Ranked findings

1. **Cost/spend — blocker: mount is still treated as permission to spend**

The claim that “selection is always an explicit gesture” in [the plan](/home/greg/code/spideryarn2/docs/plans/260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it.md:141) is false. `useAutoRun` would fire from `status === "none"` after mount, with no evidence of how the mode was reached.

Non-Dock paths include:

- A pasted or bookmarked `?mode=ideas`, because [modeParam](/home/greg/code/spideryarn2/src/web/params.ts:262) restores it on load.
- Browser Back/Forward through pushed mode entries. The plan says those modes must already be running, but a fast second navigation can unmount the first panel before its GET resolves and before its auto-run effect fires.
- The metadata and thread pages’ Dock links, built with [withMode](/home/greg/code/spideryarn2/src/web/Dock.tsx:594).
- A direct `?mode=diagram&diagram=sketch`, including browser history through `diagramParam`.
- Historic mode entries created before this feature was deployed.

The other mode writers do not add hidden paid cases: chat handoff writes only Chat/Review, library hits write Search, touch/swipe does not change modes, and `openTermInGlossary` can only exist when a glossary already supplied the term.

The explicit-gesture design should be real data: a one-shot activation token set by Dock or Diagram click/Enter/Space, handed to the panel, then consumed after its own GET says `none`. The Dock still need not know which step backs the mode. Direct URL and Back/Forward should show the empty state and its manual button, not spend.

There is also a larger error in the plan’s Diagram accounting. Diagram is not free apart from Sketch:

- Force immediately POSTs through [useSimilar](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:700).
- Drift and Trail POST through [useProjection](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:725).
- [DIAGRAMS](/home/greg/code/spideryarn2/src/web/diagram.ts:126) contains four pictures and explicitly says all four cost a model call.

Therefore the old Diagram arrow handler could buy Similar, Projection, and Sketch while traversing, not only Sketch. Stage 0 should assert no POST to `/api/similar`, `/api/projection`, or `/api/jobs` after an arrow press.

2. **Correctness — blocker: the first-poll rule leaves both panel and dot permanently wrong**

[useJobs](/home/greg/code/spideryarn2/src/web/useJobs.ts:348) treats its first poll as a baseline and deliberately suppresses `onFinished`.

A concrete race:

1. The article payload says `ideas: false`.
2. The panel GET returns 404.
3. Another tab completes Ideas, or the automatic unforced job is deduped/skipped because the artefact appeared.
4. The job is already `done` before this hook’s first poll.
5. `onFinished` is suppressed.
6. The panel remains `status === "none"` and the bar remains hollow until reload.

This is especially likely for a no-op job: [useStepJob.start](/home/greg/code/spideryarn2/src/web/useStepJob.ts:214) remembers the returned ID but does not insert the returned job into `queue.jobs`. If it finishes before the poll, there is never a spinner, reload, or success transition. The reader sees “not generated” over an artefact that exists and may repeatedly start harmless no-op jobs.

Two fixes are needed:

- `useStepJob` must reconcile the specific ID returned by `start`, including a `done` job seen on the first poll, and invoke its reload exactly once.
- The bar cannot infer current existence from an arbitrary historical done job. It needs an actual readiness revalidation after an ambiguous first poll or completion. A small readiness endpoint used only for live revalidation would not undo the decision to avoid a second request on ordinary page load. An equivalent version/epoch in the payload and job records would also work.

3. **Correctness — blocker: required `Article.built` conflicts with the public structural seam**

[PublicArticle](/home/greg/code/spideryarn2/src/public-types.ts:157) is deliberately structurally assignable to [Article](/home/greg/code/spideryarn2/src/types.ts:1248). [ArticleAccess](/home/greg/code/spideryarn2/src/web/App.tsx:353) and [sanitizeArticle](/home/greg/code/spideryarn2/src/web/sanitize.ts:85) rely on that.

Adding required `built` to `Article` while refusing to add it to `PublicArticle` breaks that assignment. Adding it publicly would contradict the plan and duplicate `PublicArtefactSet`.

It also puts the cost at the wrong server seam. `ArticleReader.loadArticle()` is a core method used by comments, chat, live conversation, tools, and other routes—not just `GET /api/article/:slug`. Adding filesystem checks there makes every one of those loads inspect the optional artefacts.

Keep the initial readiness fact on the existing owner GET, but use an owner-only wire type such as:

```ts
interface OwnedReadingArticle extends Article {
  built: BuiltModeArtefacts;
}
```

Give the browser route a route-specific reader/projection, or a dedicated store method. Preserve `built` through a generic sanitizer or lift it aside before sanitising.

Postgres can add computed shape/presence expressions to that projection without transferring any JSONB documents. The current `article` projection does not read those five columns. Filesystem `loadArticle` currently reads blocks, tree, metadata, shelf, arc, and assets; its extra artefact checks should likewise occur only for the browser response.

`GET /api/metadata/:slug` is not a better source: its `done` means current, whereas stale must count as ready, and its calculation is substantially more expensive.

4. **Cost/spend — blocker: queue idempotency does not cover the CLI**

Two browser tabs asking for identical work are safe. `enqueueOrGet` atomically enforces one active job per owner/slug, returns the identical job, and a later unforced job skips after `stepIsDone` sees the artefact.

StrictMode is also safe if the helper copies `useArc` exactly: set the ref before calling `start`. The test must actually render once under `<StrictMode>`; physically unmounting and mounting twice resets the ref and is not the same test.

The direct CLIs bypass all of that:

- [glossary main](/home/greg/code/spideryarn2/src/glossary.ts:1382)
- [ideas main](/home/greg/code/spideryarn2/src/ideas.ts:1037)
- [quotes main](/home/greg/code/spideryarn2/src/quotes.ts:1126)
- [timeline main](/home/greg/code/spideryarn2/src/timeline.ts:1350)
- [sketch main](/home/greg/code/spideryarn2/src/sketch.ts:662)

They call the generators and write files directly. They create no job record or running marker. Therefore:

- `useJobs` cannot show their progress, despite comments claiming it can.
- A panel that sees the artefact absent can enqueue a second paid call while the CLI call is running.
- Both writers can race, with the last one winning; for identity-bearing artefacts that can also change IDs unexpectedly.

Either those CLIs must acquire the same per-article exclusion mechanism/queue, or the plan must stop claiming CLI concurrency is covered.

5. **Correctness — high: a different active job makes auto-run fail once and never retry**

[enqueue](/home/greg/code/spideryarn2/src/jobs.ts:1614) permits one active job per article. Identical work is deduped, but different work receives 409.

`useStepJob.job` only reports jobs containing this particular step. Therefore, if Glossary is running and the reader clicks empty Ideas:

- Ideas sees `job === null`.
- Auto-run POSTs.
- The server returns “That article already has a job running.”
- The per-slug guard prevents another automatic attempt.
- The reader must manually retry after Glossary finishes.

The same happens for the same step under a different profile/work key. Clicking four empty modes quickly starts at most one; the rest fail.

The plan needs a deliberate policy: keep the activation intent pending and retry when the article’s active slot becomes free, or show a genuine queued-behind-another-job state. Treating the 409 as an ordinary failed start does not deliver “clicking starts it.”

6. **Correctness — high: raw presence is not an acceptable readiness definition**

The filesystem branch must use parsed, shape-checked presence—not `stat`. Otherwise truncated JSON produces a ready dot while the panel cannot read it.

Postgres `IS NOT NULL` has the same shallow failure. For example, [loadSketch](/home/greg/code/spideryarn2/src/store/pg.ts:2364) correctly rejects `{"scenes":[]}`, but `sketch IS NOT NULL` would report it ready. A scalar or malformed object can likewise be non-null and unreadable.

Use the rules already centralised in [SHAPE](/home/greg/code/spideryarn2/src/store/artifacts.ts:232). Postgres can mirror them with `jsonb_typeof`, field checks, and array-length checks; the JSONB still does not cross the wire.

“Stale counts as ready” is cleanly implementable in both stores:

- Filesystem shape checks do not compare stamps.
- Postgres can inspect the current revision’s document independently of `articleMetadata.done`.

So this decision is sound. The plan should explicitly choose usable presence and reject `stat`/bare `IS NOT NULL`.

Also, `built.sketch` should be cut from the article payload. The plan draws dots for four Dock modes only, and `useSketch` performs its own GET when Sketch mounts. No proposed consumer reads that fifth boolean, yet it is the largest filesystem artefact to parse.

7. **Design — medium: auto-run silently removes the first-run profile choice**

The current empty states let the reader change `UseProfile` before pressing the paid button. Automatic calls use the default `useProfile: true`, and the control becomes disabled once the job appears.

That means a reader who wanted an unprofiled first artefact must stop or regenerate, paying again. The plan should state this choice explicitly. During an automatic run, a disabled checkbox that looks like a choice is misleading; show provenance such as “Using your profile” instead, or preserve a real pre-run choice.

8. **Correctness/nits: copy and test coverage need more specificity**

The panels need an explicit `starting` state. Until `/api/jobs` sees the returned job, [JobProgress](/home/greg/code/spideryarn2/src/web/JobProgress.tsx:91) renders its ordinary run button, so merely changing its label to “Try again” will briefly offer a retry before anything has failed.

Suggested states:

- Starting: “Starting…” with no button.
- Running: the existing job progress, plus “This uses one model call and usually takes tens of seconds.”
- Sketch running: “Drawing the argument. This usually takes about two minutes and costs about $0.20.”
- Retryable failure: the existing classified failure plus “Try again.”
- Permanent failure: no retry button, per [copy.md](/home/greg/code/spideryarn2/docs/project/copy.md:40).
- Waiting behind another job: say that, rather than presenting a failed start.

Replace “kept—you will not be asked again unless the article changes” with “kept until you choose to replace it”; the former implies an article change triggers regeneration, contrary to the stale-ready decision.

Because this is a batch rewrite of empty-state copy, [copy.md](/home/greg/code/spideryarn2/docs/project/copy.md:214) says the new strings should move to `src/messages.ts`. Failure strings still need their stable bracketed codes and retry classification.

For visitors, the component boundary is safe: `DiagramPanel`, the five owner hooks, and auto-run never mount. The public DTO is assembled field by field, so nothing leaks at runtime. The required-`Article` type problem above is the danger.

The actual no-POST test belongs in [public-network-trace.test.tsx](/home/greg/code/spideryarn2/tests/public-network-trace.test.tsx:472), not `visitor-gaps.test.ts`. Add direct cases for Quotes, Timeline, and `?mode=diagram&diagram=sketch`, for signed-out and signed-in non-owners.

Finally, Stage 0 names three radiogroups, but Diagram also has the axis and hue `Choice` radiogroups; their handlers intercept the article arrows too. The current stylesheet comment at [styles.css](/home/greg/code/spideryarn2/src/web/styles.css:5365) also still claims `.dock-modes` is one tab stop.

## Recommended stage changes

Keep Stage 0 first, but enumerate all five radiogroups and test all three paid Diagram endpoints.

Then insert two foundations before dots or auto-run:

1. Explicit activation intent, active-slot waiting, and first-poll reconciliation.
2. An owner-only reading payload with four usable-presence flags and an honest live-revalidation seam.

After those, the existing Dot → four modes → Sketch order is reasonable. Cut the unused Sketch payload boolean.