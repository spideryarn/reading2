# Code review: the permalink and sharing during import

Up: [the plan](261005l-permalink-and-share-while-an-article-is-importing.md).

Candidate: `4c6f2cc5b5804bef0acfdd2748e58bb6569c44e4`. Reviewed the commit independently before
checking the [nine plan-review findings](261005l-permalink-and-share-plan-review-sol.md).
The small fixes below are uncommitted in this worktree. No Git writes or server edits were made.

**Verdict: REQUEST CHANGES.** Two browser bugs were fixed and their regression tests passed;
three established P1 visibility defects remain. A request being sent is not evidence its
compensating change committed.

## Findings

### F10 — P1: reload presents an unpublished public article as unticked

[add-share.ts:290](../../src/web/add-share.ts#L290),
[AddShare.tsx:78](../../src/web/AddShare.tsx#L78).

Share successfully before publication, reload `/add/…`, and the new metadata probe still gets
404. `probed("none")` initializes `off`; the box is unchecked and cannot take back the existing
public state. Re-ticking is idempotent, but that does not repair the false state or provide an
unshare action. When the import later publishes, it becomes public despite the unticked box.

**Evidence:** a temporary component probe maintained visibility independently of the component:
the real publish call set the fake server public, the root was unmounted and recreated, and
the metadata read stayed 404. `expect(shareBox()?.checked).toBe(publicOn)` failed: **false vs true**.
The store's metadata read starts with `currentRevision(slug, "metadata")`
(`src/store/pg.ts:3077`); the visibility route is PUT-only (`src/routes.ts:9080`). Publication
absence therefore cannot read visibility.

**Left for Greg.** Authoritative visibility before publication needs a server read contract;
per the review instruction I stopped at identifying that requirement. A browser-only alternative
is to separate this visit's consent from visibility, explicitly show that visibility is unknown,
and offer a private write. That changes the agreed checkbox/state design. Automatically making
the slug private on reload would withdraw consent without the owner asking. Item **7 is a defect**.

### F11 — P1: a failed take-back loses its owner and its error

[add-share.ts:360](../../src/web/add-share.ts#L360),
[AddPage.tsx:783](../../src/web/AddPage.tsx#L783).

Share A, fail its import, then Retry onto B. Disposal sends private for A, but ignores a refusal,
transport failure, unreadable success, or an answer still saying public. The page drops A's
controller and draws B's unchecked box with no notice that A remains public. Disposal during an
already pending private request also ignores that request's refusal.

**Evidence:** a temporary component probe returned public for A's publish and HTTP 503 with
`Unshare refused` for its compensating private request. Both requests were observed, but the
assertion that the refusal was visible failed; B's box was off. The surviving server state is
also established by the refusal path: no private update occurred in the fake transport.

**Left for Greg.** This needs the retired slug's pending/failed state retained, an observable
private outcome, and recovery until that outcome is confirmed. Logging or retrying once would
still violate the rollback contract. I left this coupled controller/UI redesign for the
implementer rather than inventing a second retirement mechanism in a review patch. This is
inside the candidate's scope and blocks approval.

### F12 — P1: two controllers for the same slug can reverse a newer confirmation

[AddPage.tsx:249](../../src/web/AddPage.tsx#L249),
[add-share.ts:360](../../src/web/add-share.ts#L360).

`shareFor` is keyed by source address as well as slug. An in-place change from an add URL to an
equivalent address can therefore replace the controller even when the resulting job names the
same slug. The old private compensation and the new confirmed public write are independent.
If the new public write commits first and the old private write commits last, the new page
continues saying Public while the database is private.

**Evidence:** a temporary component probe changed the source to the same URL with a trailing
slash, returned a new job with the same slug, held the old private response, and confirmed the
new public request. Releasing the private response made the independently tracked server state
private while the new checkbox remained checked: **true vs false**.

**Left for Greg, together with F11.** Serialize writes for an owner/slug across retiring and
replacement controllers, or retain that slug's controller when only its source address changes.
The unknown-slug interval during an address change must also be handled; only changing the
equality check is insufficient. This is inside the candidate's scope and blocks approval.

### F13 — P1: pending publication retries continued after unmount — fixed

[AddPage.tsx:787](../../src/web/AddPage.tsx#L787),
[add-share.ts:152](../../src/web/add-share.ts#L152).

The candidate preserved confirmed public state on unmount by leaving the whole controller alive.
That preserved unsent work too. Leaving after a pre-row 404 continued public retries from an
ownerless controller; a 404 answering after unmount could create another timer. A later mounted
page could show off while the old controller published.

Added reversible `pause`/`resume` lifecycle attachment. Cleanup clears pending timers; both
`kick` and late-404 timer creation respect the attachment. A confirmed public write is not undone,
and a request already sent may finish. StrictMode effect replay resumes the same controller.

**Evidence:** before the fix, the unmount tests observed **four requests instead of one**, and
an unanswered request's late 404 produced a second public request. After the fix they pass.
Removing the cleanup reintroduced exactly those failures. A controller test also proves pause
and resume preserve already confirmed consent, and a page test proves successful sharing
survives unmount.

### F14 — P1: first fresh job list could miss completion — fixed

[StillBeingAdded.tsx:109](../../src/web/article/StillBeingAdded.tsx#L109),
[ArticlePage.tsx:116](../../src/web/article/ArticlePage.tsx#L116).

If the access request gets 404 and the import completes before the fresh jobs response, the first
list contains only a done job. The candidate accepted only queued/running imports and never
re-read the now-published article. Its test intentionally expected Not shared for this case.

Allow one check of a completed import after reconciliation. The owner/slug guard lives in
`ArticlePage`, above the loading branch that unmounts `OwnerNotShared`, so a second 404 cannot
loop. A new address can have its own check. Live imports remain followed through their terminal
outcome as before.

**Evidence:** the revised test first failed with **attempt 0 instead of 1**, then passed after
the fix. Tests cover a still-unreadable result under StrictMode and an in-place slug change.
Disabling the completed-job branch makes all three fail. The read-only subagent independently
approved these two fixes; it did not approve the remaining visibility defects.

## The nine plan-review findings

All mutations below were temporary edits, restored before final validation. Failures were
inspected at the relevant assertion, not treated as findings merely because a process exited 1.

| Original finding | Closure and regression evidence |
|---|---|
| 1 / P1: slug-bound sharing | **Partial.** Existing success and unanswered-request slug-change tests fail if old disposal is removed. Consent and request targets stay bound to their constructor slug. F10–F12 show that the stronger visibility/rollback guarantee is not closed. |
| 2 / P2: actual sharing inventory | **Closed for the adopted published article.** Unit and page tests cover metadata 200, 404, failures and offline copies. Mutating an `article` probe to offer `off` fails the adopted-article test. The 404 probe's inability to establish private visibility is F10, not an inventory reading. |
| 3 / P2: import jobs only | **Closed.** Both copy-button and owner-page mode-job exclusions were mutated separately; each failed its exclusion assertion. Added minimal-paper cases for `fetch, metadata`. No recovery path posts an import. |
| 4 / P2: fresh absence and list failure | **Closed, with the completion race repaired by F14.** Bypassing freshness fails the held-response test, which sees Not shared too early. Existing tests cover failure and an eight-second fallback when no list arrives. |
| 5 / P2: hold navigation | **Closed.** Disabling `sharingUnsettled` causes the confirmation, refusal, uncertain-answer and pending-share completion tests to fail on unexpected navigation. Ready remaining latched after success is intentional and keeps the result available to read. |
| 6 / P2: link stability wording | **Code was correct, test incomplete.** Replacing “this import's article” with “for good” initially passed every copy-link test. Added the explicit wording regression; the same mutation now fails. Existing tests cover changing the copied slug and hiding failed/cancelled jobs. |
| 7 / P2: queued-job retry cap | **Closed.** Disabling the `gave-up` revival in `settle()` fails the cap test: **301 vs 302 calls**. A page test proves completion sends a waiting intent and retains its result. The no-argument settle is safe because the controller is immutable and the completion call checks the slug. |
| 8 / P2: unsharing allowance | **Closed.** Removing the allowance sentence from the public state fails the component assertion. Tests also verify no money inside confirmation and no second confirmation when unsharing. |
| 9 / P3: misleading built status | **Closed manually.** The plan now says “being built” and there is an implementation commit. No executable status test exists; none is claimed. The empty landing record is not a claim that validation or shipping happened. |

The controller's rights guard was also mutated: dropping `!this.state.rights` fails its no-send
test. The page tests separately prove that ticking the outer box, ticking rights alone, and
pressing the disabled button send nothing. I found **no public request without a rights tick and
explicit press for that same slug**. The failures above concern visibility agreement and competing
writes after valid consent.

## The implementer's departures and React checks

Items 1–6 are sensible implementation choices on their ordinary success paths, with the F11/F12
limits on take-back. One share remains drawn after a failed import if the owner acted on it, so
there is still somewhere to unshare. Holding Ready until Open the article avoids taking the
result away when it changes to on. Following an import by job id preserves its failure and Retry.
Signed-out access remains the landing page and performs no jobs request. Existing mode-job,
unrelated-slug, failed-list and missing-list cases pass. F14 closes the newly observed completion
race without a reread loop.

Item **7 is a defect** (F10), not an acceptable idempotency limitation. Item **8 is acceptable for
v1**: import failure and navigation do not withdraw the owner's consent, and an unpublished
public draft remains unreadable. The changed lifecycle preserves this successful state.
Items **9 and 10 are correct**: minimal papers are imports, and the metadata probe uses only a
fresh status while treating an offline cache answer as unknown.

The new share constructors are inert during render. Their probe, disposal and observation start
in committed effects; delayed answers to a disposed controller do not update its displayed state.
F13 fixes the unsent timers that outlived a page.

**Wider observation, F15 / P2:** the existing HighPowerIntent replacement calls
`dispose()` during render at `AddPage.tsx:505`. The same call is present in the candidate's
parent, so I left it for Greg as outside this change. An abandoned render can stop an intent's
timer; no runtime user-visible failure was established here. No wider code was changed.

There is no useful smaller rewrite of the repaired lifecycle or completed-import check. For
sharing, one owner/slug operation owner and separate consent/visibility information would be
simpler than disposing by add address and compensating through independent writers; F11/F12 are
the concrete reasons to consider it. Keep the existing JobCard and shared confirmation pieces.

## Validation and limitations

Ran each file with `npx vitest run tests/<file>` after restoring mutations:

| File | Result |
|---|---|
| `add-share.test.ts` | 28 passed |
| `add-page-share.test.tsx` | 26 passed |
| `still-being-added.test.tsx` | 15 passed |
| `job-card-copy-link.test.tsx` | 12 passed |
| `add-page-purpose.test.tsx` | 86 passed |
| `use-copy.test.tsx` | 49 passed |
| `doc-links.test.ts` | 16 passed |

**232 tests passed in seven files.** The separate temporary visibility probe file reproduced
F10–F12 with three assertion failures and was then removed; those failures are not included in
the passing count. These are component/transport simulations backed by the inspected route/store
contracts, not live production/database experiments.

`job-failure.test.ts` **could not run**: private database global setup was blocked by
`connect EPERM 127.0.0.1:54362` and Docker access. This was an infrastructure failure, not a
candidate test failure. No full-suite or real-browser result is claimed.

`npm run typecheck` was blocked by tsx's IPC `listen EPERM`. Running the same script using
`node --import tsx scripts/typecheck.ts` passed all four projects and its source-coverage guard.
An earlier run included the temporary probe's overly narrow URL type; removing that scratch
probe and rerunning produced the final clean result. Scoped Biome lint passed with one existing
AddPage complexity advisory. No server changes, commit, staging, push or other Git write occurred.

Root-cause record:
[A publication 404 does not establish sharing state](../postmortems/261005r-a-publication-404-does-not-establish-sharing-state.md).

## Files changed by this review

- `src/web/add-share.ts`
- `src/web/AddPage.tsx`
- `src/web/article/ArticlePage.tsx`
- `src/web/article/StillBeingAdded.tsx`
- `tests/add-share.test.ts`
- `tests/add-page-share.test.tsx`
- `tests/still-being-added.test.tsx`
- `tests/job-card-copy-link.test.tsx`
- `docs/plans/261005l-permalink-and-share-code-review-sol.md`
- `docs/postmortems/261005r-a-publication-404-does-not-establish-sharing-state.md`

Other concurrent edits to sharing/ingest reference docs and help text were observed and left alone.

**Verdict: REQUEST CHANGES — F10, F11 and F12 remain; F13 and F14 are fixed and tested.**
