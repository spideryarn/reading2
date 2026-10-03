# GPT Sol on the plan for sweep clusters 2 and 3

Read-only review of [the plan](261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md) at base `aea9f8635`, 2026-10-03. Verbatim below; what was done about each finding is in the plan § Review status.

**REVISE:** stage 3 can remove legitimate bullets; stages 4 and 5 need stronger test specifications. I changed no files. Stage 1 was edited concurrently, so I checked its original behaviour at `aea9f8635`.

1. **Stage 1 — correct; no material finding.** The local `part()` catch is the simplest fix. The proposed exact-message assertions preserve the body-first/decode-first distinction; the pair’s inequality assertion alone would not. These tests cover the reported regression, although a route-specific hardcoded response could also satisfy them—code review should confirm the fix remains in `part()`.

2. **Stage 2 — correct for today’s acquisition paths.** [storedDocumentBytes](../../src/fetch.ts:273) always encodes HTML text as valid UTF-8. [acquireUpload](../../src/pipeline.ts:1679) decodes incoming bytes, passes the result through that helper, then stores the normalized bytes. Fetch uses the same helper through `writeRaw`.

   I reproduced the current Unicode blindness and the proposed correction: both no-meta and obsolete-windows-1252-meta pages changed from zero findings to the expected two. Adding an invalid byte before upload normalization still produced valid stored UTF-8 and preserved both findings. **A hostile page cannot force this fallback through today’s fetch/upload paths.**

   UTF-8 validity remains a heuristic for legacy encoding, not proof of provenance. Maintenance backfills can also store old bytes. I did not establish whether any such rows survive. Unconditional UTF-8 is simpler, but the conservative fallback is reasonable without that census.

   **PR-1 — P2, stage 2 test coverage.** [Plan lines 43–46](../../docs/plans/261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md:43) omit obsolete charset declarations and malformed input before normalization. An implementation that respects stored `<meta charset>` whenever present could pass the stated tests while retaining the defect. Add the obsolete-meta case and the malformed-input normalization case; assert both specific Unicode findings. For legacy bytes, assert decoded punctuation—such as `0x93 → “`—rather than merely finding an ASCII payload, which unconditional replacement decoding could also find.

3. **Stage 3 — revise the predicate.**

   **PR-2 — P1, legitimate bullets disappear.** [BandCard](../../src/web/Spine.tsx:1543) displays child labels, whereas [whereRows](../../src/web/where.ts:112) includes neighbouring sections with `onPath: false`. I reproduced an Introduction card whose legitimate paragraph label was “Methods”: the neighbouring Methods row caused the proposed filter to remove that bullet.

   Matching only text also removes ordinary paragraph labels that happen to equal the current section’s title. The planned tests all exercise removal, so this overbroad implementation passes them.

   Restrict suppression to **heading leaves matching a row on the current path**. `startsAtHeading` is useful in conjunction with that match; the rejected alternative was filtering every heading indiscriminately. Keep filtering before counting. Add retention cases for a paragraph matching a neighbouring row, a paragraph matching the current title, and a genuine unmatched subheading. This remains a small local fix.

4. **Stage 4 — the implementation approach is correct.** A `rem` scroll margin resolves to an absolute length; `getComputedStyle(el).scrollMarginTop` returns the pixel value, so parsing `120px` is appropriate. No manual rem conversion is needed. [CSS Scroll Snap specification](https://drafts.csswg.org/css-scroll-snap-1/#propdef-scroll-margin-top), [CSSOM resolved values](https://drafts.csswg.org/cssom/#resolved-values).

   **PR-3 — P2, the proposed test misses the required slack.** [Plan lines 68–69](../../docs/plans/261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md:68) use margin `120px` and heading top `118px`. A wrong implementation omitting `+4` passes.

   Assert that `122px` is reached and `125px` is not; also exercise another margin and the fallback. Use a later section and explicitly avoid the bottom-of-document condition: [PageContents](../../src/web/PageContents.tsx:310) can select an entry without consulting the threshold. The first-entry fallback can likewise mask a broken comparison. Reading the element’s computed margin is already the simplest reliable fix.

5. **Stage 5 — correct state model; missing validation.**

   **PR-4 — P2, no red-test cases are specified.** [Plan stage 5](../../docs/plans/261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md:71) promises red-first completion but names no tests. [CopyLink](../../src/web/AccessSharing.tsx:871) has two distinct failure paths: absent clipboard and rejected write. Fixing either alone leaves the other silent.

   Specify tests for both failures, visible manual-copy guidance and live-region feedback, plus successful copying of the exact link. Keep the local three-state change; the shared lifecycle hook can remain in cluster 20.

REVISE