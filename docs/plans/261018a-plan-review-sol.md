The separate `matter` artefact is the right direction, but the current plan has several P1 gaps around freshness, classifier admission, and stub semantics.

### Findings

**F1 — P1 — `hashBlocks` does not fingerprint the classifier’s actual input**

Evidence: the classifier reads `kind`, `words`, heading `level`, and section boundaries (`docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md:147-155`), but `hashBlocks` hashes only ordered `id`, `text`, `role`, and `treatment` (`src/source-hash.ts:83-86`, `src/source-hash.ts:115-153`). A re-extraction can preserve IDs and text while changing paragraph→heading, H2→H3, or `words`; the carried `matter` would then report itself current although the window or resolved section has changed.

Concrete fix: introduce a versioned `matterInputHash` over every fact the classifier and resolver read—at least ordered `[id, text, kind, level, words]`. Use it both in `MatterFile.sourceHash` and the step stamp. Do not widen global `hashBlocks`, which would invalidate unrelated artefacts.

---

**F2 — P1 — A copied stale `matter` value can survive a failed reclassification and be trusted**

Evidence: the plan says a failed/refused call “stores nothing” and import continues (`plan:212-215`), then the view uses stored `matter` whenever one exists (`plan:254-256`). New drafts copy the published revision and its step receipts (`src/store/pg-revisions.ts:26-35`, `src/store/pg-revisions.ts:1257-1272`). Therefore a re-extraction can change the prose, copy old matter, fail the new call, publish anyway, and fold according to the old ranges.

Concrete fix:

- Classify the new column as `carry` in `REVISION_CARRY_POLICY`, so unrelated drafts retain a valid result.
- At the owner article-read boundary, return stored matter only when its runtime shape is valid, every ID resolves, and `sourceHash === matterInputHash(currentBlocks)`. Otherwise return `undefined` and use the conservative fallback.
- Represent a tolerated failure explicitly, for example `{status:"unavailable", sourceHash, version}`, rather than returning no artefact from a step that claims to produce one. Never leave a carried stale value underneath a successful step.
- Old articles with `NULL` naturally take the fallback. Unchanged copied drafts may reuse the carried result and receipt.

---

**F3 — P1 — The admission checks still allow the model to fold ordinary prose**

Evidence: a direct span need only lie inside the opening or close (`plan:175-185`). On a short article, the “opening” can contain most or all of the article. Each block’s evidence is truncated to 200 characters (`plan:147-150`), so prose-indicating text later in a block is unseen. More seriously, a `section` may come from any heading in the article, while `references` and `contents` exempt the answer from the strongest caps (`plan:181-185`). The model controls those kind labels itself.

“Wholly in the opening or wholly in the close” is therefore too loose as a safety check. It is acceptably strict as a coverage rule: missing mid-body furniture is preferable to hiding prose.

Concrete fix:

- Use a discriminated answer union, such as `type: "range" | "section"`, with `additionalProperties: false`.
- Require deterministic positive evidence compatible with each kind: exact normalized labels, title equality, author/byline evidence, DOI/date prefixes, etc., checked against full stored text.
- Admit section answers only when the actual heading text matches a closed label set for that kind, plus a positional rule: contents near the opening; references/acknowledgements/funding/declarations in a trailing region or ending at a known next peer heading.
- Make absolute word/block caps independent of model-supplied `kinds`; adding `"references"` must not bypass a safety limit.
- Add adversarial eval cases: short articles whose windows overlap, headings such as “Funding the Future,” prose after character 200, and injected instructions.

The eval’s zero-prose score is useful evidence, but it cannot replace these runtime gates for future articles.

---

**F4 — P1 — The untrusted-model protocol is not bounded on every axis**

Evidence: the plan includes every heading without a heading count or character cap (`plan:149`), and the answer is an uncapped list of stretches (`plan:152`). The copied authors protocol explicitly caps record count, characters, completion tokens, and time, and tells the model the page is untrusted data (`src/front-matter-authors.ts:58-69`, `src/front-matter-authors.ts:276-283`).

Concrete fix: specify caps for heading count, per-heading length, total heading characters, output tokens, and maximum stretches. Prefer headings near the edges plus exact-label candidates if all headings do not fit. Copy the authors pass’s explicit untrusted-data instruction, use no tools, and reject malformed/extra output at runtime.

With those controls, rendering is safe: labels should come only from the closed `kinds` enum and fixed application copy; counts come from blocks; IDs must be verified real block IDs. Render heading text as React text, never HTML. Omitting `matter` from the public DTO is fail-closed, consistent with `security-map.md:553-570`.

---

**F5 — P1 — A stub makes “row visible” and “block content visible” different facts, but `isFolded` currently means both**

Evidence: the plan keeps the first block row visible as a stub while hiding that block’s authored content (`plan:237-248`). Today `isFolded` means the row is hidden (`src/web/fold.ts:424-430`) and is consumed by marginalia (`src/web/marginalia/MarginaliaColumn.tsx:932-947`), reading/on-screen sampling (`src/web/on-screen.ts:58-68`), spine geometry and hit targets (`src/web/Spine.tsx:209-215`, `src/web/Spine.tsx:252-261`), scroll visibility (`src/web/scroll.ts:1182-1195`), and the block-chat host (`src/web/reader/Reader.tsx:2214-2223`).

If the stub ID is “not folded,” hidden authored words accrue reading time, search/on-screen state, marginalia and chat UI. If it is “folded,” geometry treats the visible stub as absent.

Concrete fix: model at least two predicates:

- `isRowHidden(id)`: true for every shut-stretch row except its stub.
- `isContentHidden(id)`: true for every authored block in a shut stretch, including the stub’s block.

Hide the stub row’s original content and marginalia inside a wrapper while rendering a separate interactive stub in that row. Audit every current `isFolded` consumer and choose deliberately. Keep `isFoldedAway` for real heading-fold coverage; matter alone should not claim its visible stub is folded away.

---

**F6 — P1 — Returning the stub ID from `visibleFrom` reopens the stretch on URL restoration and key navigation**

Evidence: the plan proposes that `visibleFrom` return the stub ID (`plan:250-252`). But `scrollToBlock` always calls `revealBlock` because a block jump means “show its content” (`src/web/scroll.ts:1011-1023`). Reading position deliberately stores `visibleFrom(...)` in `?at=` (`src/web/reader/useReadingPosition.ts:183-229`). Thus a passive position written as the stub ID will open the stretch after reload or rotation—the exact bug the prior implementation fixed.

Key navigation has the same conflict: it maps through `visibleFrom` (`src/web/keynav.ts:211-239`) and eventually jumps to that ID, which reveals it.

Concrete fix: do not use one block ID for both “land on the closed stub” and “explicitly reveal this block.”

The simplest version is:

- Keep reading-position canonicalisation mapping to the first non-matter block after the stretch, as today.
- Give key navigation a separate non-revealing stub target if landing on stubs is important.
- Preserve explicit `?at=<blockId>`, search, comment, and Structure jumps as revealing operations.

---

**F7 — P1 — Stored title ranges conflict with the permanent masthead echo**

Evidence: `title` is a classifier kind and the mockup shows a “Title and authors” stub (`plan:108`, `plan:159`). Existing front-matter detection explicitly skips echo IDs (`src/web/front-matter.ts:330-348`), and `revealBlock` refuses to reveal an echo block before checking front matter (`src/web/fold.ts:337-347`). If a stored stretch begins on the echoed title, its proposed stub is either permanently hidden or cannot open.

Concrete fix: define precedence explicitly. Recommended: subtract masthead-echo IDs from matter intervals before choosing stub IDs; never reveal the duplicate title; anchor the stub on the first non-echo block. Drop an echo-only stretch. Remove the masthead control only after every fallback and stored stretch has a reachable keyboard-accessible stub.

---

**F8 — P2 — The proposed section resolver is currently private to a browser-heavy module**

Evidence: the plan names the fold store’s `sectionEnds` as the resolver (`plan:153-155`), but it is unexported (`src/web/fold.ts:79-91`) and its module imports React and browser helpers (`src/web/fold.ts:59-62`). Server-side `src/matter.ts` should not depend on that module.

Concrete fix: extract a pure, dependency-light `sectionRanges` helper shared by `matter.ts` and `fold.ts`. It should return numeric indices and be tested for missing levels, final sections, and repeated headings. This avoids two section-boundary implementations drifting.

---

**F9 — P2 — Structure decoration needs index containment and measurement parity spelled out**

Evidence: Structure already carries numeric `startRow`/`endRow` (`src/web/structure.ts:156-188`) and jumps through the row’s first block (`src/web/structure.ts:294-299`, `src/web/StructurePanel.tsx:353-363`). Its hidden measuring copies must have the same box as visible rows (`src/web/StructurePanel.tsx:281-314`).

Concrete fix:

- Mark a Structure row as matter only when its numeric range lies wholly within one accepted interval—not by comparing block IDs and not merely within the union of several stretches.
- Carry that flag on `StructureRow`.
- Render the info mark in the shared `Row` markup so measuring and visible copies wrap identically.
- A click on such a row may keep using the explicit jump, which should reveal its containing stretch.
- Test partial overlap, adjacent stretches, a row wholly inside one stretch, and a row spanning two stretches.

---

**F10 — P2 — The separate column is right, but the argument against `Block.role` is overstated**

Evidence: the plan says writing role after stage 3 makes every later step stale “on every import” and implies the alternative is putting the model inside stage 3 (`plan:217-222`). `hashBlocks` does include role (`src/source-hash.ts:48-57`), but a separate post-blocks step could write roles before downstream steps. On a fresh import, downstream work would simply use the final hash; on later runs, a changed classification would invalidate it once, which is normally correct.

The model call inside the ID-minting step would indeed be wrong. It is not the only role-based design.

Concrete fix: retain the separate JSONB artefact, but justify it on the stronger grounds:

- Matter is a range-level, possibly multi-kind model judgement; `Block.role` is one intrinsic classification per block.
- The feature deliberately does not change automatic-model policy; that policy is controlled by `treatment`, not merely `role` (`src/block-policy.ts:105-127`).
- A separate artefact avoids a circular matter stamp over a hash containing matter’s own output.
- Failure and staleness can fall back without rewriting core block data.

### Simpler version

Before committing to the full classifier-plus-multiple-stub UI, run the planned eval against a conservative deterministic candidate:

- Keep today’s proven author/byline rule.
- Recognise only exact authored labels such as Abstract, Keywords, Contents, Acknowledgements, Funding, References and Bibliography.
- Require full-text, kind and positional evidence around each label.
- Use existing heading folds as the stub wherever the label is a real heading.
- Add at most one new in-row stub mechanism for non-heading opening matter.

That avoids an automatic model call, new freshness semantics for most cases, and much of the multi-stretch fold-state work. If the model materially beats it without false positives, keep the `matter` artefact—but consider running it as a non-blocking successor rather than adding it to the critical ingest path. `DEFAULT_INGEST_STEPS` explicitly says to ask whether the reader must wait (`src/pipeline.ts:349-361`), and the plan already has a safe fallback.

VERDICT: revise before build