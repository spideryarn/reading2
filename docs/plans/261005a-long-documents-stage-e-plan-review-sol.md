**Verdict: build with changes.** The slicing approach is credible, but the plan needs explicit rules for preserving slice coverage, stopping before the queue aborts, and checkpointing all paid answers.

Reviewed commit `92301378981b093848a669a7376dd38a949e52d4`. No files changed, network calls or Postgres access. The permitted test file passed all 11 tests; the offline script reproduced F15.

**F15 — P1, established: a locally valid slice can disappear during stitching.**

The parser accepts a root without children, and the builder makes it a sound tree of leaves. The spike then promotes `r.children ?? []`, contributing nothing for that slice. See `structure-starts.ts:122` and `spike-parts.ts:211`.

Reproduced with two 80-block slices: both local trees passed `assertTreeSound`; the stitched tree also passed, with zero unaskable label batches. But a section from the second slice absorbed all 80 blocks of the first and applied its gist to text its model had never seen. The final builder’s repairs conceal the omission. The wire schema requires children, but the runtime parser and checkpoint gate accept this shape.

Add:

> Before accepting a slice or refill for stitching, require nonempty promoted children whose ranges exactly partition its supplied blocks. A missing or empty list is a failed answer, eligible for the bounded re-ask; otherwise return D. The final builder must not repair missing slice coverage by extending a neighbouring slice. Test a root-only answer between successful slices.

**F16 — P1, reasoned: waiting for the queue’s deadline defeats the successful fallback.**

`STEP_BUDGET_MS` controls handback between steps; it does not impose a running step’s timeout. The queue aborts its controller at `deadlineAt`. Even if E catches that abort and returns D successfully, the queue’s success-path transition ends the job as interrupted. See `jobs.ts:2520`, `jobs.ts:2542`, and `jobs.ts:2701`.

The current ordinary request has no local time cap: `structure.ts:2815`. A start-time estimate alone cannot bound an already running call. The “about 45 slices” statement is therefore an estimate, not an enforced ceiling.

Add:

> E has its own deadline: the earlier of started + STEP_BUDGET_MS.structure and the supplied queue deadline, less a finish reserve. Configure explicit time caps for slice, re-ask, refill and root calls. Admit a call only when its cap and remaining required work fit; check admission inside each worker when it actually starts. Abort E’s calls with a local signal before the queue signal fires, settle them, and finish D within the reserve. Preserve a reader’s Stop as cancellation. Test this through the queue as well as generateStructure.

The reserve must include checkpoint settlement and fallback finalisation, with time left for the caller’s commit.

**F17 — P1, reasoned: an early failure can leave paid peers outside the reported spend.**

Concrete scenario: eight slices are running; one fails twice; the coordinator immediately returns D while seven peers continue. `collectSpend` closes when its callback returns. Later completions are explicitly excluded from its ledger/report: `ai-spend.ts:954`, `ai-spend.ts:1005`. The spike avoids this by returning individual failure results and awaiting the batch; production must preserve that property.

There is a second accounting trap when reusing today’s helper: `finishedText` can reject a paid refusal or truncation before the helper returns usage to its caller (`structure.ts:2842`).

Add:

> On failure, stop admitting new calls and await every started worker before returning D. Checkpoint each successful peer independently, even when another fails. Capture returned usage before interpreting the answer, and include slice re-asks, refills and the root in fallback totals. An aborted call’s unavailable usage remains unknown in the spend ledger, not reported as free.

**F18 — P1, reasoned: slice checkpoints alone cannot make the second run buy nothing.**

The plan promises per-slice checkpoints and a second run making zero calls. The spike always buys the root, and refills are additional requests: `spike-parts.ts:418`, `spike-followups.ts:169`.

Add:

> Checkpoint successful initial slices, refill answers and root answers independently. Compute each key from its actual canonical request after adding any note. Validate slices and refills against their supplied blocks, and root answers with their own runtime gate. An unchanged run reuses every usable checkpoint and makes zero model calls.

The shared namespace itself is safe under that rule. The canonical request includes the full messages, schema, model routing and prompt version. A shortened ordinary article cannot read a noted slice’s answer: its request differs. The offline script confirmed that adding the note changes the key.

**F19 — P2, established: the prose overstates the tested note and its result.**

The actual hint is **four sentences**, with instructions about whole chapters, afterwords and scenes—not merely two sentences announcing a longer document (`spike-followups.ts:61`).

The 19-part result is correct, but “exactly the stories” is not: *Human Readable* remains three top-level pieces. Only slices 2 and 3 received the hint. Also, that tree reuses a root answer generated from the separate 29-part refilled proposal (`spike-followups.ts:177`, `spike-followups.ts:205`).

Replace the relevant claim with:

> A four-sentence, book-specific prefix on slices 2 and 3 reduced the stitched tree from 27 parts to 19; it did not produce exactly one part per story. Ordinary articles retain their byte-identical requests because the prefix is confined to E. The slice request is a new prompt variant. The hinted tree reused a root written from the separate refilled proposal; the complete production recipe remains to be checked end to end.

The cheapest further quality measurement is a paired note/no-note comparison on one paper slice and one headingless slice. Neither has been measured here.

**F20 — P2, established: the cascade comparison still uses different units.**

The historical $2.5355 and 516.2 seconds describe a **whole hierarchy run**, including ordinary structure, expansion and labels—not the expansion wave alone. The historical document says this explicitly at `260904d:1639`, with costs and timings at `260904d:1937`. E’s measured $0.810924 and 99.874 seconds exclude labels.

Replace:

> The historical cascade measurements cover the whole hierarchy step, including structure, expansion and labels. They cannot be compared directly with this structure-only spike. We choose slices for their structural fit and simpler implementation; comparative cost and deadline performance remain unmeasured.

The architectural argument is fair: the existing cascade divides downwards and leaves existing parent gists unwritten. The numerical superiority is not established.

**F21 — P2, reasoned: copying the spike into the proposed module creates a value-import cycle.**

The plan makes `structure.ts` call `structure-slices.ts`; the spike imports the request, parser and builder from `structure.ts` (`spike-parts.ts:28`). Copying that boundary produces `structure → structure-slices → structure`, the same class already documented at `structure.ts:799`.

Add:

> structure-slices imports no values from structure.ts. Pass the request/parser helpers into it or move them into an acyclic shared module. Keep the final build and finish in generateStructure. The cycles gate remains zero.

The remaining checks and decisions:

- **Numbers:** correct—$1.261722 total; four initial slices of 805/716/628/904 blocks; 38.473–96.455 seconds; 99.874 seconds including root. Refill: 18.015 seconds, $0.047312, three children. Baseline/refilled/hinted trees have 27/29/19 parts.
- **One final whole-body build:** supported. Keep it unchanged, with the additional coverage gate in F15.
- **D fallback:** costs no model call and is already finished through the shared path. Prebuild and retain it for E; replace the entire candidate on fallback.
- **Re-asks:** one per slice is reasonable, restricted to today’s parse/build/invariant failures and subject to F16. A step-wide allowance of one would make unrelated slice defects compete unnecessarily.
- **Refills:** make them optional when time is short. After one refill, retain a still-sectionless model chapter if the final soundness and labels checks pass. Sixty is a refinement trigger, not the labels refusal threshold. Do not insert D windows into the model tree.
- **Counters:** `wholeDocumentCalls` is consumed by pipeline logging; widen both run/spend types and the local counter. Updating `source` also requires the pipeline’s detail branch and `finishStructureRun`’s generator selection, including a high-powered slices run.