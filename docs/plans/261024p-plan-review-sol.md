## Findings

### F1 — P1 — The composite raw document can corrupt metadata on a rerun

**Established reader and path; reasoned resulting wrong chapter.**

[`STEPS.metadata`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/pipeline.ts:3088) reads the entire stored HTML with `readRawBytes`, then [`htmlDocumentText`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/paper-text.ts:523) runs Readability once over that composite document. The plan and investigation already establish that one Readability pass over concatenated pages selects one “best” container rather than preserving all parts.

An administrator can rerun metadata independently through [`src/jobs.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/jobs.ts:3880). That run may therefore extract a later chapter’s title, abstract, author-like text, or date, and [`STEPS.metadata`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/pipeline.ts:2350) can replace article metadata with it.

“One document keeps every reader working unchanged” is false. At minimum, metadata must read only part 0. A per-page storage representation makes that natural; a composite representation requires every semantic raw reader to become multipart-aware.

### F2 — P1 — Stitching bodies loses page-local CSS from the security scan

**Established design/code interaction; reasoned exploit consequence.**

The plan preserves each continuation page’s body and title, but not its full head. [`scanSourceForPromptInjection`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/source-scan.ts:201) parses the stored raw source as one document, and [`findSuspiciousHiddenText`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/injection-scan.ts:167) uses its `<style>` rules to find hidden instructions.

Consequently:

- Inline CSS in a continuation page’s head that hides hostile text is discarded, producing a false negative.
- Page 1’s CSS is applied to every appended body, although it did not govern those source documents, producing false positives.

This weakens the security property described in [`security.md`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/docs/project/security.md:1029): inspecting raw HTML specifically because extraction can omit hidden material. Scan each original document separately, retaining its head and base URL.

### F3 — P1 — Synthetic part headings become falsely attributed author content

**Established from the proposed representation and downstream contracts.**

The proposed `h1` before each later part is ordinary extracted prose after stage 2. [`blocks.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/blocks.ts:330) turns it into an ordinary heading, while [`structure.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/structure.ts:114) treats headings as the article’s own headings and hard boundaries. The reserved marker does not survive in the block schema as provenance. The reading view also presents prose headings in the author’s voice.

There is a second asymmetry: only later parts get synthetic boundaries. In the deterministic/fallback tree, [`heading-tree.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/heading-tree.ts:178) can consequently label page 1’s opening range “Preamble,” even when page 1 is the first substantive chapter. Superdark does not expose this because its first page really is an abstract.

For the first version, concatenate extracted bodies without fabricated headings. If visible part boundaries are required, they need a typed, non-author block carried through Structure and the reading view.

### F4 — P1 — Moving only note containers leaves authored “Notes” headings behind

**Established mechanism; user-visible consequence follows directly.**

[`canonicaliseNotes`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/notes.ts:836) creates or moves the notes section and list, but an authored sibling heading such as “Notes” or “References” is not necessarily inside `section[data-spya-notes]`.

The proposed merge moves the containers’ items to the end, leaving such headings in the middle of the article. Stage 3 then treats those orphan headings as article structure. [`notes-view.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/web/notes-view.ts:292) may also create a separate tail title because it only recognizes the block immediately before the final notes.

The 68/68 marker/backlink measurement does not test this heading, Structure, or display behavior. The join needs to identify and relocate the entire note-introduction region, with an end-to-end Structure/notes-view test.

### F5 — P1 — Exact-text furniture deduplication can delete authored prose

**Reasoned from the plan’s explicit predicate.**

Dropping every later block of at least 60 characters that equals an earlier block has no evidence that the block is furniture. It can delete refrains, repeated quotations, legal text, deliberately repeated examples, or two distinct notes with identical wording. In the notes case, a later marker may remain while its target body has disappeared.

Omit deduplication from the first version. Repeated navigation is less damaging than silent deletion. A later implementation should require positive furniture evidence and measure false positives.

### F6 — P1 — The aggregate byte limit is undefined and checked too late

**Reasoned from established limits and proposed ordering.**

The plan says to stop after the stored bytes “pass `MAX_STITCHED_BYTES`,” but does not choose the limit. Each individual [`fetchDocument`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/fetch.ts:768) may fetch up to the existing per-document limit, while the source bucket has a 50 MiB object limit in [`supabase/config.toml`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/supabase/config.toml:131).

Checking after adding a page permits a composite to exceed the storage limit by almost one whole page. Concurrent fetches can also buffer several large pages before any aggregate decision. A hostile page can direct the model toward those candidates, creating bounded but substantial memory, bandwidth, and retry amplification.

Choose a concrete cap below the storage limit, reject a page when `current + incoming > cap`, and make concurrent reads share or reserve the remaining budget.

### F7 — P1 — The eval does not exercise the extraction input proposed for production

**Established measurement mismatch.**

The eval calls [`readArticle`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/evals/multi-page/run.ts:73). The plan proposes a single plain Readability pass in stage 1, explicitly avoiding `readArticle`’s treatment/control behavior and preparation steps. Those steps can change the selected article, title, text head/tail, length, and which links count as `inArticle`—all judge inputs.

Therefore 72/72 does not validate the proposed integration. The simplest correct version is to use the exact `readArticle` path in stage 1 and accept running it again in stage 2. The repetition is an optimization opportunity, not evidence that the judge belongs later: stage 1 must decide which documents to fetch and persist.

### F8 — P1 — “72/72” measures only continuation yes/no, not importing the whole article

**Established from the scoring code and recorded rows.**

[`run.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/evals/multi-page/run.ts:140) scores only the `continues` boolean. Selected-page membership is printed but not scored, and order is not scored.

In the recorded Haiku results, the compendium selected only two of its three continuation pages in two of three runs, omitting `/summary`. Thus the evaluated implementation would import an incomplete article despite receiving a correct scored decision.

There is also a gold defect: [`gold.json`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/evals/multi-page/gold.json:22) marks the AI Safety Dance example complete but omits `/conclusion`, while the investigation identifies the conclusion as a real part and the model selects it. The parsed `complete` field is not used in scoring.

Report separate metrics for:

- continuation classification;
- exact ordered page selection;
- per-page precision and recall.

The current evidence supports 72/72 classification decisions, not 72/72 complete imports.

### F9 — P2 — The manifest column does not itself make the split trusted

**Reasoned design gap, grounded in the current manifest validation.**

A database column is trusted metadata only because trusted code writes it and because it is cryptographically bound to the stored bytes. The actual boundary is the combination of:

- scrubbing attacker-supplied reserved attributes;
- minting wrappers after scrubbing;
- binding the composite bytes with `storedSha256`;
- exact validation when the source is read.

“Sections match the list” is underspecified. The invariant should require direct, non-nested wrappers in document order, ordinals exactly `1..N`, one URL per wrapper, no duplicates or extras, valid absolute URLs, and exact URL/ordinal association. A count check alone can associate a body with the wrong base URL and misresolve links and images.

Persistence tests should cover [`artifacts-pg.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/store/artifacts-pg.ts:374), revision copying, export/import, and forced re-extraction.

### F10 — P2 — “Same site” currently means hostname only, including scheme and port changes

**Established boundary; impact is reasoned.**

[`sameSite`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/multi-page.ts:64) compares hostnames after stripping `www.`. It ignores scheme and port. [`pageKey`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/multi-page.ts:71) also collapses those variants, and the test explicitly treats HTTP and HTTPS as equivalent.

This is not arbitrary SSRF: the model selects IDs, unknown IDs are rejected, and every selected URL still goes through `fetchDocument`. But a hostile page can induce requests to public alternate ports or an HTTP downgrade on its hostname. Host-only matching also does not isolate tenants on shared hosts such as publishing platforms.

Use normalized origin as the default boundary, with a deliberate exception for safe `www` equivalence and possibly HTTP→HTTPS upgrade—not downgrade or arbitrary ports. Shared-host contamination should be described as an accepted heuristic limitation rather than a trust guarantee.

### F11 — P2 — The final prompt result is resubstitution evidence, not generalization evidence

**Established methodology issue.**

The investigation records a Cold Takes failure, then adds two prompt sentences aimed specifically at distinguishing a blog-series index, and reruns the same corpus. Repeated successful stochastic runs demonstrate stability on that corpus, but not generalization beyond it.

Before enabling the judge for every web import, hold out fresh examples covering:

- forum/query-string pagination;
- chapter chains not fully linked from page 1;
- shared-host publications;
- tables of contents mixed with unrelated recommended links;
- path and scheme variants.

The prompt may be good; the current experiment cannot establish that it is not overfit.

### F12 — P3 — `/api/source` is not an HTML reader supporting the design

**Established prose error.**

The plan says `/api/source` will show stitched HTML pages stacked. [`routes.ts`](/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import/src/routes.ts:777) intentionally serves only PDF sources; stored HTML is not exposed because doing so would create stored-XSS risk. Remove this claimed benefit from the storage rationale.

## Overall recommendation

I would not build stages 2–4 exactly as planned.

The clean storage model is one immutable stored source per fetched page, plus an ordered relational list for the article revision containing ordinal, original/final URL, object reference, and hash. That preserves each document’s head, CSS, base URL, security scan, and provenance. If one object is retained, it must be treated as a multipart container: metadata, scanning, extraction, debugging, and future raw readers must split it first. It cannot safely masquerade as an ordinary HTML document.

A smaller first version that captures most of the value would:

1. Use the exact existing `readArticle` path for the judge input.
2. Select only direct page-1 links; defer chained discovery.
3. Require normalized same-origin URLs with explicit `www` handling.
4. Fetch through `fetchDocument` under a concrete shared byte budget.
5. Store and scan each source page separately.
6. Run `readArticle` per page and concatenate authored content without synthetic headings or text deduplication.
7. Namespace anchors through one shared helper.
8. Merge whole notes regions rather than only their list containers.
9. Measure exact selected-page recall and order, not only yes/no classification.

The link-ID indirection and guarded fetching are sound foundations: I found no route by which the model can invent an arbitrary URL or bypass `fetchDocument`. The block-ID carry-forward mechanism also appears compatible with newly appended blocks. The principal downstream problems are fabricated heading provenance, note-region movement, and destructive deduplication—not ordinary stage-3 ID minting.

The quoted cost figures reproduce for the judge call: median about $0.00048 and maximum about $0.00170. The latency figures likewise match the stored rows. They do not include continuation downloading, scanning, storage, or extraction, so they support the model-call budget rather than total import latency or resource cost.

`npx vitest run tests/multi-page.test.ts` passed: 11/11 tests.