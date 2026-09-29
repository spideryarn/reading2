## Findings

### P-1 — P0 — The stated safety property does not cover the prose readers will treat as claims about the paper

The plan mechanically checks only quotations. `paperDoes` and `reason` can introduce facts absent from the retrieved text, while a single unrelated verified quote allows `supports` or `partly`; `does-not-support` needs no evidence at all. The UI then presents all three beside “found in the paper,” without distinguishing verified source text from model interpretation.

Evidence: `docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:34-43`, `:86-91`, `:115-117`; `src/quote-match.ts:419-420`.

Fix: narrow the guarantee and change the output contract.

- Present retrieval, coverage, and exact source slices as mechanically established facts.
- Label verdict and explanation explicitly as an AI assessment.
- Require visible verified evidence for every positive paper-content description, including `paperDoes`.
- Replace `does-not-support` with `no-support-found-in-checked-text`. Without evidence, or with partial coverage, it must never claim the paper does not support something.
- Prefer the article’s existing `why` and citing passages over a second model-written `claim`; otherwise label `claim` as an AI restatement of the citing article.

### P-2 — P0 — The title check can certify the wrong paper

`pageNamesTitle` is designed to judge search-result pages, not document identity. Its excerpt branch succeeds when the target title occurs anywhere as a run of words. An unrelated paper that cites the target in its references therefore passes. Its title matcher also needs only 60% of significant title words.

Evidence: plan `:44-47`; `src/citations.ts:612-624`, `:639-660`; the intended excerpt acceptance is pinned by `tests/citation-find.test.ts:252-259`.

Fix: use an identity ladder, reapplied after following `citation_pdf_url`:

1. Exact DOI/arXiv agreement where either side supplies one.
2. Otherwise, a strong normalized scholarly-title match plus first author or year.
3. For PDFs without metadata, title and author evidence from the first pages—not an occurrence anywhere in the body.
4. Any identifier disagreement is a refusal.

Never use the full document body or references section as title evidence.

### P-3 — P1 — The proposed quote verifier is deliberately too forgiving, and may search text the model never saw

`quoteAppears` calls default `findQuote`, whose second pass deletes all whitespace. The matcher’s own documentation explicitly says this is a drawing aid, not a verifier: `fall a part` can match `fall apart`. Quotes mode avoids that by calling the `"spaced"` pass and storing the source slice.

There is a second mismatch: the model sees the first ~60k characters, while the plan checks against `fetchedText`, apparently the complete extraction. A remembered or hallucinated phrase could be accepted because it happens to occur later in text the model never received.

Evidence: plan `:38-39`, `:83-84`; `src/quote-match.ts:38-48`, `:229-262`, `:419-420`; safe call-site precedent in `src/quotes.ts:450`.

Fix:

- Verify only within the exact chunks sent to the model.
- Require the model to return a page/chunk identifier with each quote.
- Use `findQuote(chunk, quote, undefined, "spaced")`.
- Store and display the exact source slice, never the model’s spelling.
- Enforce a meaningful minimum quote length and at most three quotes; “verbatim sentence” in the prompt is not validation.

### P-4 — P1 — The existing matcher will reject common real PDF quotations

Line breaks and curly quotes are handled: whitespace is collapsed, and curly quotes/dashes are folded. Compatibility ligatures such as `ﬁ`, however, deliberately are not folded, and line-end hyphenation is not repaired by `findQuote`. `pass0` preserves PDF line endings and their hyphens. Real model quotations will commonly write `findings` for `ﬁndings` and `generalization` for `gener-\nalization`, causing false rejection.

Evidence: `src/quote-match.ts:66-90`, `:135-147`; `src/pdf.ts:663-687`; the existing PDF-specific hyphen repair is `src/pdf.ts:791-845`.

Fix: construct one PDF-specific canonical text representation that is both sent to the model and searched, with a mapping back to page and source offsets. It should handle compatibility ligatures and named layout hyphenation without introducing general fuzzy matching. Add direct tests for ligatures, intra-page and page-boundary hyphens, line breaks, curly quotes, repeated text, and two-column extraction.

### P-5 — P1 — Coverage is both weak and overstated

Head-first clipping can miss the cited claim in later methods or results sections. More importantly, “Read 12,400 words” can describe the complete extraction even though the assessment saw only the first ~60k characters. That violates the requirement to say how much was actually used.

Evidence: plan `:27-29`, `:50-52`, `:83-84`, `:115-117`, `:145-149`.

Fix:

- Report two separate facts: “retrieved X pages/Y words” and “assessment examined Z pages/words.”
- Select chunks deterministically: abstract/overview plus chunks ranked against the citing passages and `why`, with page labels. Head-first alone should not be the assessment corpus.
- If only part was assessed, `no-support-found` must explicitly be limited to that part; categorical negative verdicts are unavailable.
- Record the selected pages/chunks so the result can be reproduced.

The simplest safe v1 is positive-evidence-first: `supports`, `partly`, or `cannot tell/no support found in checked text`, with visible passages. Defer categorical negative judgments.

### P-6 — P1 — Prompt fencing limits side effects but does not protect result integrity

The plan relies on `untrusted()`, but that function’s own contract says the delimiter mechanism does not survive a determined injection. PDFs are also the documented gap in hidden-instruction scanning. Having no tools is valuable—it prevents an injected paper from causing actions—but it can still manipulate verdict, reason, and `paperDoes`, which is the entire feature.

Evidence: plan `:80-91`; `src/chat-tools.ts:414-430`; `docs/project/security-map.md:13-23`. The stronger existing pattern is `src/link-summary.ts:42-62`, `:393-428`, `:453-468`.

Fix:

- Add an explicit system rule that both the article passages and paper are evidence, never instructions, plus a reminder after the paper text.
- Defuse delimiters and keep tools absent.
- Parse a strict runtime schema: clean finish, exact verdict enum, bounded strings, at most three bounded quotes, no extra malformed shapes.
- Add adversarial HTML/PDF-text prompt-injection evals.
- Describe quotes as “found in the extracted text layer” unless visibility on the rendered page was established.

### P-7 — P1 — Fetching is guarded, but PDF parsing has no complete time or memory envelope

SSRF is sound if every application-level fetch—including the `citation_pdf_url` fetch—uses `fetchDocument`: it checks each redirect destination before dialling it. The plan should make that a tested invariant.

The larger gap is after fetching. `fetchDocument` defaults to 32 MB and three attempts; the plan says one attempt but gives no concrete byte or overall deadline. `pass0` has an optional page cap but no `AbortSignal`, walks every accepted page, and retains text plus positioned items for the whole file.

Evidence: plan `:64-72`; `src/fetch.ts:728-742`, `:2166-2171`, `:2289-2345`; `src/pdf.ts:594-597`, `:658-690`. The separate page counter documents why cooperative cancellation matters at `src/pdf.ts:526-545`.

Fix:

- State explicit fetch bytes, attempts, redirect count, page count, PDF-parse deadline, and whole-request deadline.
- Pass one composite abort signal through search, both fetches, parsing, and the model call.
- Extend `pass0` or add a bounded text-only PDF reader that can destroy its loading task on abort and need not retain every positioned item.
- Benchmark worst accepted PDFs for wall time and peak RSS.
- Test a `citation_pdf_url` pointing directly—and via redirect—to loopback, link-local, and private addresses. Resolve relative meta URLs against the fetched page’s final URL.

### P-8 — P1 — Stored checks can silently become stale

Citation IDs deliberately survive citation regeneration. That is correct for a found URL, but a support check depends on the current `why`, citing passages, work metadata, chosen source, extracted content, selection policy, and prompt. Keying only by `(article, entry id)` means a regenerated citation can display an old assessment against changed evidence.

Evidence: plan `:102-109`; `src/citations.ts:30-37`, `:854-869`. Input fingerprints are already the cache precedent in `src/link-summary.ts:91-112`, `:831-850`.

Fix: store and compare an input fingerprint covering the current citation context, source identity/content hash, normalization/selection version, prompt version, and model. Attach a stored check only when it matches; otherwise mark it stale or hide it pending “Check again.”

### P-9 — P1 — Duplicate presses can spend twice, and the allowance boundary is underspecified

`findWorkPage` intentionally contains no allowance; every caller must supply one. A check with no link may buy both a web search and an assessment. The plan says there is a bucket but does not specify a per-entry single-flight claim or unambiguously place the allowance before the first billed operation. Two tabs can therefore run the same check concurrently, and an older result can finish last and overwrite a newer one.

Evidence: plan `:104-109`; `src/citation-find.ts:363-377`; the established claim-before-spend pattern is `src/link-summary.ts:847-870`; web-search cost is not bounded by result count, `docs/project/ai-gateway.md:368-377`.

Fix:

- Claim `(article, entry id, input fingerprint)` before taking allowance.
- Take allowance before either `findWorkPage` or the assessment call, then release it in `finally`.
- Bound output tokens and model deadline through the existing budget/deadline machinery.
- Conditional-write by claim/run ID so an older run cannot overwrite a newer one.
- Log reported searches, tokens, cost, coverage, and outcome—never paper or article prose.

### P-10 — P2 — A separate table is right, but the proposed row is not yet a sufficient provenance record

A new owner-scoped table beside the citations artefact is the right design; `citation_finds` is not suitable because checks apply to already-linked works and have different staleness and provenance. However, `text[]` quotes cannot carry page/chunk/source offsets, and the plan does not name database constraints for its mutually exclusive outcomes.

Evidence: plan `:102-109`; `src/db/schema.ts:3615-3662`; `docs/project/sql.md:16-32`, `:110-120`.

Fix:

- Keep `citation_checks` separate.
- Add checks for outcome/verdict enums, non-negative counts, URL scheme, and the read/unreadable nullability rules; add the owner FK and article cascade.
- Store requested and final URL separately, plus retrieved and assessed counts, content hash, input fingerprint, and selection version.
- Store verified quote objects with page/chunk/span provenance. A bounded JSONB array is defensible here if documented as one opaque display value; otherwise use a child quote table.
- Update both export projections and their coverage tests.

The non-streaming model call is justified: no unverified partial answer should be shown. A spinner or streamed progress states are enough for v1, provided the full operation is bounded.

**Overall verdict: build with changes.** The reuse choices—`findWorkPage`, `fetchDocument`, PDF text extraction, an owner-only companion table, and one short non-streamed call—are sound. The two P0 issues must change first: the UI/output contract must stop presenting unchecked model prose as paper fact, and document identity cannot be established by finding the title anywhere in the fetched text.