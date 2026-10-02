Verdict: Revise before build — no P0, but three P1 assumptions make the proposed client choreography unreliable.

## P1 findings

1. **`running` does not guarantee that the article row exists.**

The claim transaction first changes the job to `running` and commits ([src/store/pg-jobs.ts:872](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-jobs.ts:872), [src/store/pg-jobs.ts:907](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-jobs.ts:907)). Only afterwards does `walkClaim` open the session ([src/jobs.ts:2298](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:2298), [src/jobs.ts:2335](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:2335), [src/jobs.ts:2523](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:2523)); that session calls `openOrBeginJobDraft`, which creates the article row ([src/jobs.ts:2066](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:2066), [src/store/pg-revisions.ts:1254](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-revisions.ts:1254)).

Therefore both URL and upload jobs have a real window where polling reports `running` but the PUT returns 404 ([src/store/pg-billing.ts:1449](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-billing.ts:1449), [src/billing/admission.ts:524](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/billing/admission.ts:524)). Treating that as an ordinary refusal would wrongly untick the box.

Within the no-server-change budget, send once `job.slug` is known—even while queued—and treat 404 as transient while that owned job remains queued/running, retrying after subsequent job updates. This also switches an existing shelf article before its skip-fast job is claimed.

There is no inherent slug mismatch: allocation happens before the job is inserted ([src/jobs.ts:3967](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:3967)), and AddPage watches the returned job ID and ultimately uses `job.slug` ([src/web/AddPage.tsx:553](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:553), [src/web/AddPage.tsx:564](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:564)). The new component must likewise use `job.slug`, never derive one from the URL or filename.

2. **`structure` is not the first capable-tier call for PDFs.**

PDF `extract` runs `pdf-frontmatter` with `ctx.power` ([src/pipeline.ts:2388](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/pipeline.ts:2388)), and `pdf-frontmatter` is explicitly capable-tier ([src/models.ts:1051](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/models.ts:1051)). Thus uploaded PDFs and fetched PDF URLs can make a Sonnet call during `extract`, before `structure`.

The claim is true only for HTML ingests. The plan and copy must say that switching after PDF extraction starts may leave the PDF-reading/front-matter call on the standard model. Tests should cover switching before and during PDF extraction.

3. **Nothing orders auto-mode jobs after the high-power PUT.**

When the ingest completes, `openArticle` starts `queueAutoModes` without awaiting it and immediately navigates ([src/web/AddPage.tsx:163](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:163)); the completion effect invokes that path independently of any proposed switch state ([src/web/AddPage.tsx:584](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:584)). If the PUT is still in flight, a mode job can claim and read standard power first.

There is also an upload completion that returns `{article}` with no job after the retained job has gone ([src/routes.ts:5725](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/routes.ts:5725)); AddPage treats it immediately as completion ([src/web/AddPage.tsx:564](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:564)). An intent waiting only for `running` will never be sent there.

The completion path must wait for a pending high-power write to settle before queuing auto modes, and must send directly against the returned article slug for an `{article}` completion. A refusal or network-unknown result can then continue under explicitly standard/unknown semantics.

## P2 findings

4. **Exact “late” detection is not feasible from the polled job data.**

`runStep` reads power first ([src/jobs.ts:1029](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:1029)), then marks the step running and persists progress ([src/jobs.ts:1101](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:1101)). The switch can commit between those operations: `structure.startedAt` would then be later than `highPowerSince`, despite structure already having selected standard power. The client also sees one-second polling snapshots, not an atomic snapshot with the PUT ([src/web/useJobs.ts:13](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/useJobs.ts:13)).

The page can prove lateness if `extract`/`structure` had already visibly started before the click, but it cannot prove the opposite. Use cautious copy such as “Some earlier work may already have used the standard model,” or accept that exact detection needs a server-side ordering marker.

5. **Dismissing a failed card does not freeze the charge.**

The card’s X is “Dismiss” and calls `forget` ([src/web/AddArticle.tsx:666](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddArticle.tsx:666)). `forget` only stamps `jobs.dismissed_at`; it does not delete the article ([src/store/pg-jobs.ts:2074](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-jobs.ts:2074)). The charge therefore remains attached to the live private article row, rather than being frozen as an article-deletion charge. Rewrite that sentence.

Also, the existing auto-mode checkbox is rendered through the post-completion purpose-decision phase, not merely through `offerAutoModes` ([src/web/AddPage.tsx:689](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:689), [src/web/AddPage.tsx:950](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/web/AddPage.tsx:950)). “Same interval” should use the actual `(showAutoModes || deciding)` interval if that parity is intended.

## Confirmed claims

- A failed ingest leaves the article row in place: failure locks the article and marks only the draft revision failed ([src/store/pg-revisions.ts:2984](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-revisions.ts:2984), [src/store/pg-revisions.ts:2998](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-revisions.ts:2998)).
- Retry preserves the failed attempt’s slug for both URL and upload ingests ([src/jobs.ts:4087](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:4087), [src/jobs.ts:4379](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/jobs.ts:4379)).
- High-powered AI is charged only once for that article: the transaction checks for the existing `high_power` event before inserting ([src/store/pg-billing.ts:1490](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-billing.ts:1490)). Retrying or repeating the PUT does not charge it again.
- No new authorization or billing bypass was found. Charged switch-on performs both unlocked and locked owner-scoped reads ([src/store/pg-billing.ts:1449](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-billing.ts:1449), [src/store/pg-billing.ts:1456](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/store/pg-billing.ts:1456)); another owner gets 404. Minimal papers are refused before charging ([src/routes.ts:8244](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/routes.ts:8244)), and administrators still take the checked, uncharged path ([src/routes.ts:8256](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/src/routes.ts:8256)). An already-shelved owned article exposes no authority the Metadata page did not already have.