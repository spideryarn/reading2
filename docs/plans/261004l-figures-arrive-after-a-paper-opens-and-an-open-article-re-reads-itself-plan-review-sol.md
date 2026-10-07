Reviewed HEAD **`473941e1d041965c4726f6106014fb6e83ccd146`**, read-only. No files changed; no network, Postgres, or tests used.

The PDF-only deferral is worth building. The plan’s automatic re-read needs more care than its current description suggests.

**F1 — P1 — ESTABLISHED: a completion can be missed during the article’s initial load.**

The proposed listener mounts in the owner’s reading view, after `resolveAccess` finishes. Recovery can publish and its completion can be announced after the article payload was read as pending but before that view mounts. [`useJobs.ts:327`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/useJobs.ts:327) captures the completion cursor at the subscriber’s first render, so that completion becomes history. The pending article then stays on screen indefinitely.

This is separate from the acknowledged idle-tab limitation. [`ArticlePage.tsx:190`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/article/ArticlePage.tsx:190) renders no reader during loading, and [`jobEngine.ts:592`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/jobEngine.ts:592) also suppresses completions on the session’s first list.

Mount observation before starting the article read, and reconcile a pending answer against work that finished during that read. Test this window explicitly; the proposed already-mounted-reader test cannot catch it.

**F2 — P1 — ESTABLISHED: “on any failure keeps what is on screen” does not follow from catching `resolveAccess`.**

Figure delivery failures are swallowed by `Promise.allSettled`; [`rehost.ts:927`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/rehost.ts:927) returns only the figures that loaded. The resulting article resolves successfully with the others reduced to captions. Web-image failures similarly resolve with publisher URLs at [`rehost.ts:688`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/rehost.ts:688).

Therefore a labels re-read can remove a figure the reader already sees after one transient asset failure. Waiting for the “finished answer” does not prevent it. Preserve previously delivered copies when their asset identities still match, or expose delivery failure sufficiently to refuse a degrading replacement.

Also, PDF-only articles normally have **no second draw**: [`rehost.ts:682`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/rehost.ts:682). Refresh must use the first answer when `withImages` resolves `null`.

**F3 — P1 — ESTABLISHED: releasing the previous load breaks an open image lightbox.**

The article is not the only consumer of its blob URLs. [`TableView.tsx:795`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/TableView.tsx:795) retains a copied figure in component state. [`zoomable.ts:270`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/zoomable.ts:270) copies its HTML, including the old blob URL; [`Lightbox.tsx:147`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/Lightbox.tsx:147) renders that saved HTML.

Replacing the article leaves this state alive, while `ArticleLoad.release()` revokes every old URL. The overlay still references revoked resources and can blank on a subsequent render. This particularly affects the proposed labels refresh, which replaces image URLs despite no image change.

Keep matching image resources stable across refreshes, or explicitly transfer/update the overlay’s ownership before releasing them. Add an open-lightbox test.

**F4 — P1 — REASONED: the existing `live` guard is insufficient for competing refreshes, and calling `setAnswer` is not a committed swap.**

Assets and labels can trigger two loads close together. A slower assets response can replace a newer labels response unless refreshes have ordering or cancellation beyond slug/reader identity. The existing guard at [`access.ts:242`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/article/access.ts:242) belongs to one effect; it does not automatically protect separately started refreshes.

The plan also says to release old URLs after `setAnswer`. That setter schedules a render; the old DOM can still be using those URLs. Retirement must follow the committed replacement.

Reuse [`useOrderedRead.ts:115`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/useOrderedRead.ts:115) for request ordering where practical, and specify ownership of the displayed load and replacement load separately. Failed or discarded replacement loads must be released without releasing the displayed one.

The synchronous `(slug, readerId)` comparison at [`access.ts:287`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/article/access.ts:287) must remain. Preserving it gives no established cross-reader exposure; relying only on the asynchronous `live` cleanup would weaken that guarantee.

**F5 — P1 — ESTABLISHED: a forced re-import discards previously recovered figures unnecessarily.**

Drafts carry `assets` at [`pg-revisions.ts:305`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/store/pg-revisions.ts:305). Rebuild and Start again force `extract`, and [`jobs.ts:877`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/jobs.ts:877) cascades that force through assets.

Even with the same stored PDF and identical figure markers, the proposed deferred run replaces a complete manifest with `pdfFiguresPending: true` and **no `pdfFigures`**. Once published and re-read, recovered figures disappear until recovery finishes; stopping or failing recovery makes that disappearance persist.

Keep valid carried entries while recovery is pending. [`assetsInputHash`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/collect-assets.ts:531), the version, and marker references provide the relevant identity checks. Test an unchanged forced Rebuild, rather than only a first import.

**F6 — P1 — REASONED: the ordering prescription omits reset regenerations and must explicitly handle deduplicated holders.**

There are two mode-successor paths. [`queueMainModesIn`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/store/pg-revisions.ts:2516) handles initial imports, while [`pg-revisions.ts:2421`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/store/pg-revisions.ts:2421) separately queues reset regenerations using transaction-relative offsets. Updating only the named main-mode path does not establish the promised order for Start again.

Nor does requesting `after` alone move an existing holder: [`pg-successor.ts:239`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/store/pg-successor.ts:239) retimes an unclaimed deduplicated job only when `notBefore` is supplied.

The intended order **is expressible with existing machinery**:

- Queue or join assets.
- Queue or join labels with `notBefore: assets.jobId`.
- Queue both automatic modes and reset regenerations after the last existing predecessor.

Use the returned holder IDs, not assumed timestamps. Cover deduplicated assets, deduplicated labels, and reset Illustrated regeneration. Decide explicitly how to report `boundToOlderBase`, which cannot finish the newly published revision.

**F7 — P1 — REASONED: interpreting “the publishing job ran assets” as fenced-row `status === "done"` suppresses the normal successor.**

The fenced row currently returns only reset and name-reservation fields at [`pg-revisions.ts:939`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/store/pg-revisions.ts:939). Adding `steps` would expose the declared list, but not necessarily completed statuses.

The final step becomes done in memory before commit; publication occurs at [`pg-session.ts:519`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/store/pg-session.ts:519), while the ending step list is persisted later by `finishIn` at line 586. Thus the fenced job row can still describe the final assets step as running.

Define this predicate precisely. The declared full step list plus a pending draft manifest can identify the deferred-import case; an actual completion check should use the draft’s finished step receipt. Test the real final-assets publication path, not a fixture whose job row already says done.

**F8 — P1 — ESTABLISHED: CLI imports leave figures undriven, and the existing labels instruction then stalls.**

[`scripts/stage.ts:212`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/scripts/stage.ts:212) drives only its own job and exits once that job is terminal. Publication-created successors receive no pump. Deferring figures therefore changes a successful CLI import from recovered figures to an undriven assets job.

Worse, the CLI currently instructs the operator to run labels at [`scripts/stage.ts:282`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/scripts/stage.ts:282). With assets ordered first and exclusive, that labels command waits behind undriven assets and eventually hits the ten-minute busy limit.

Either preserve synchronous recovery for CLI imports, or explicitly provide the assets-first continuation. Leaving successors for a later browser session is a possible policy, but the current command and its instruction would be misleading.

**F9 — P1 — ESTABLISHED: refreshing the article does not refresh an open Illustrated band’s freshness claim.**

The server fingerprint correctly changes when stored figures arrive: [`illustrated-figures.ts:129`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/illustrated-figures.ts:129). The open band, however, re-reads only when its slug/block-ID order changes or an Illustrated job completes: [`useIllustrated.ts:222`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/useIllustrated.ts:222) and line 304.

Assets arriving preserve block IDs. A painting made while recovery was unavailable can therefore remain presented without the stale warning after recovery succeeds. The server’s correct stamp does not update this client state. Revalidate Illustrated on assets completion when that band is mounted.

The basic server approach otherwise holds: passing the **full declared step list**, rather than remaining steps, survives claim hand-back; making pending manifests fail both freshness checks causes the standalone successor to run; and excluding standalone assets and ordinary mode publications prevents a recovery loop. An active owner’s browser already drives queued successors at [`jobEngine.ts:634`](/home/greg/code/spideryarn2/.claude/worktrees/open-early-spike/src/web/jobEngine.ts:634). Successors reserve no ingest slot.

Export serializes the manifest without needing a new format or database column. Public pages will receive the pending field, but their automatic update remains expressly unsupported: they require another load. That narrows the no-refresh promise to the owner’s observed reading view.

I would keep PDF-only deferral, preserve matching recovered figures, and postpone the optional labels refresh. Labels preserve node IDs and article fingerprints, but applying a whole-article image reload to every web article expands this change considerably. The existing queue and ordered-read machinery are enough; no new worker or general revision subscription is justified here.

**Verdict: build with changes.**