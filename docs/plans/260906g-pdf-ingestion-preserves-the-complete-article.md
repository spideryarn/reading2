# PDF ingestion preserves the complete article

Status: diagnosis established, implementation not started. The live public API and saved extracted
HTML contain the same out-of-order passages; the source-page mapping is below. Worktree:
`worktree-kuhn-pdf-integrity`, base `93b3aebe7fc180d8812e7c2e3293487564cea042`.

> Try and figure out why, and look for ways to improve that ingestion machinery (optimising correctness, then robustness, then latency, then cost efficiency). Then use GPT Sol for implementation (given a clear plan), and smaller models for token-intensive, low-level work (e.g. browser inspection/tests/etc).
>
> — Greg, 2026-09-06

## Evidence and ownership

The reported article is
[`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz`](https://www.spideryarn.com/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz).
Its public API contains 2,030 blocks. Array entries 42 and 43 are `spya-dwauwu` and
`spya-s5a7kx`: the first ends mid-sentence in Chalmers's discussion of qualia; the second
starts mid-sentence in a Tye quotation. The discontinuity exists in the served block data.
It is not caused by the reading view. The source has 142 file pages; the served article has
152,163 words. Sampling six distinctive, normalised 70-character passages per block maps 1,823
blocks unambiguously and finds text from every body page (1–130). That establishes page
representation, not word-perfect transcription. The large discontinuities are:

| Served boundary | PDF file pages | Consequence |
|---|---|---|
| `spya-dwauwu` → `spya-s5a7kx` | 2 → 50 | The reported jump |
| `spya-s9u3h7` → `spya-fg02e0` | 50 → 3 | Reading returns to the start |
| within `spya-fkm7qa` | 3 → 51 | Two unrelated paragraphs joined |
| `spya-fj799y` → `spya-aywpn8` | 51 → 4 | Reading returns again |
| within `spya-dzad4c` | 49 → 52 | The real neighbours of the moved pages joined |

Current published revision `f0cf4c6c-a431-4193-bb84-033a54585e49` records recall 0.981 and
140 pages checked. Its `extracted_html` already has the bad order, before block splitting.
Sixty-six saved passing PDF chunks remain; they have no records for pages 1–2, 44–45 or 50–51.
Failed chunk responses were not saved, so the precise bad labels are inferred from the final
order, not recovered from the historical raw answer. Pages 50–51 being labelled 2–3 (their
positions in a cut containing context page 49) exactly explains their placement.

The code makes this possible directly: after the two attempts, failed page-set checks are
nonfatal; the global sort uses the model's `record.page`; the renderer trusts `continues` even
across unrelated pages. The sorter dates to `f68a6016`; `1ed4407e` on 2026-08-30 removed the
refusal for all quality failures to unblock papers rejected over typography and figure noise.
This widened tolerance over page identity too. Saved bad-shaped/invalid readings also bypass
the retry loop once `usableChunkReading` sees an array, a sibling robustness gap.

Raw investigation exports remain outside git and are not sent to reviewing models. Review uses
code and invented fixtures. Machine-readable local mapping and its script retain the evidence;
the regression fixtures will encode the same ordering defect without reader data.

Parent owns evidence synthesis, this plan, review decisions and landing. GPT Sol investigates
the control flow and implements the reviewed plan. GPT Luna handles test inventory and mechanical
validation. The initial delegated investigators ran out of workspace credits after collecting
evidence; subsequent code-only reviews use the repository CLI and its configured key. No production article is overwritten by these
experiments; an eventual repair must preserve block identities and be previewed first.

## References

- [Content extraction](../project/content-extraction.md): the existing publish-with-notes decision,
  its false-refusal evidence, and the PDF entry point.
- `src/pdf-read.ts`: chunk planning, saved responses, retry, deduplication and final rendering.
- `src/pdf-score.ts`: independent PDF text baseline, coverage and omission detection.
- `src/pdf-frontmatter.ts`: bounded classification of publisher furniture.
- [Block IDs](../project/block-ids.md): repair must not remint existing anchors.
- [Long PDF ingestion](260904b-a-long-pdf-finishes-without-a-retry-click.md): earlier latency work
  on this paper. Increasing concurrency did not establish completeness.
- [Silent success](../reusable/silent-success.md): a check must witness the result it certifies.

## Reviewed implementation contract

GPT Sol's code-only review reproduced the failure on six invented pages: fresh wrong labels
published in order 1,5,2,6,3,4 after four calls; a corrupt checkpoint produced the same order
with no recovery. Its findings PDF-INT-001–004 are accepted: permissive publication,
model-controlled ordering/continuation, defective checkpoint replay and conflated verdicts.
The review said **REVISE, THEN READY**; the revisions below incorporate its contract and add
one explicit case it omitted: in-range but descending page labels must also trigger recovery.

1. Separate a typed structural verdict from existing content warnings; never parse diagnostic
   strings to choose an action. Structural defects include invalid record shape, impossible or
   out-of-chunk page claims, non-monotonic page order, and no substantive records for a requested
   page with an independent non-furniture text baseline. Evaluate the records actually emitted
   after the context/dedup filter too. Hidden transcribed records count as content presence.
2. Do not fail scans or truly blank/no-text-layer pages merely for no records or no rendered
   prose. Keep the existing nonfatal typography, maths, figure-content and partial-reference
   comparisons. This is a page integrity guard, not proof of verbatim completeness; scans still
   have no independent text witness and retain their unverified status.
3. Runtime-validate checkpoint records and required envelope fields. Rescore under today's
   structural contract. A defective checkpoint is a recoverable miss, and valid neighbours
   remain reusable. Do not change the primary prompt/fingerprint solely for this code fix.
4. Recover a structurally defective chunk with context-free single-page requests, at most two
   attempts per source page. Its single source page is assigned by code, regardless of the
   model's label. Feed all calls through the existing reader, concurrency gate, accounting and
   abort signal. Keep recovery bounded; persist a recovered chunk only after validating the
   assembled result, so a subsequent attempt does not buy that successful recovery again.
5. If recovery still leaves a structural defect, throw an authored, retryable failure naming
   only the affected page numbers. No HTML or later pipeline publication may escape the failure.
   Reject invalid cached finish/usage/record shapes safely; never treat a stale prior pass as
   permission to publish. Preserve valid paid checkpoints already saved by sibling tasks.
6. Assemble in authoritative chunk order and validated within-chunk page order, with no global
   sort on model labels. Enforce the same structural property after any content-removing fold.
7. Join a continuation only on the same or exactly next page; track the last page of the joined
   paragraph, including a paragraph that spans three pages. Do not join backwards or across a
   gap. Keep seam-hyphen handling aligned with those conditions.
8. Reproduce fresh wrong labels, bad cached labels, descending in-range labels, blank and
   hidden pages, retained good checkpoints, recovery exhaustion and aborts, and unsafe joins.
   Test the final returned HTML/order and the absence of a result after failed recovery. Run
   a negative control against the completed guard and retain its specific failure message.

Correctness comes first. The old decision to tolerate noisy typography, figure and maths checks
is evidence against restoring every old check as a fatal gate; it is not evidence that whole
missing sections are acceptable under this request. A small, explicit completeness policy must
distinguish catastrophic loss from the known non-prose exceptions and run on the final content.
The concrete threshold and exception choices will be based on the incident and held-out fixtures.

Preserve inexpensive successful work: use the existing article-scoped checkpoints, validate them
under the current rules, retry defective work rather than trusting a historical pass, and keep
recovery bounded. Prefer smaller requests for defective chunks over repeatedly buying the same
large failing request. Keep the existing transport backoff, cancellation and spending ledger.

The simpler option passed over is only exposing the current warning. That makes loss visible
but still hands later stages an incomplete article. Replacing the PDF reader or adding a second
OCR service is also premature: first locate the loss and make the present pipeline prove what
it keeps. A wider concurrency limit cannot repair dropped pages.

## Stages

### Establish the failure and review the fix

- [x] Map the reported transition and other large gaps to PDF file pages.
- [x] Compare source, stored chunk records, extracted HTML and blocks where available; distinguish
  confirmed facts from missing historical evidence and identify the introducing commits.
- [x] Write the [postmortem](../postmortems/260906g-a-tolerated-page-label-error-reordered-the-article.md)
  naming the general failure class and ranked countermeasures.
- [x] Finalise the implementation contract and get GPT Sol's plan review before code changes.
- [ ] Commit the diagnosis and reviewed plan.

### Make incomplete extraction recover or fail explicitly

- [ ] GPT Sol writes a regression test, observes the relevant failure, then implements the fix.
- [ ] Cover saved responses, final transformations, bounded recovery and non-prose exceptions.
- [ ] Run the recovered path against the incident evidence and held-out PDF fixtures, retaining
  the actual outputs and measuring requests, latency and cost if model calls are needed.
- [ ] Update the owning extraction doc; review the code and evidence independently with GPT Sol.
- [ ] Run `npm test`, `npm run typecheck`, touched-file lint and `npm run check`; commit the stage.

### Verify and land

- [ ] Confirm the expected missing content is either recovered or explicitly refused, never
  certified by an earlier intermediate score. Use a negative control for the final invariant.
- [ ] Fetch and merge current `origin/dev`, validate any integration changes, and push `HEAD:dev`.
- [ ] Report confirmed cause, measured improvements, limits and the status of the existing article.
- [ ] Run `worktree:check` before removal; preserve the tree if checks or repair work remain open.
