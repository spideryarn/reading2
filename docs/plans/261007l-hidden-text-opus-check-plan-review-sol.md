The annotation-only design is sound for row membership, order, scan headline counts and the chip mark: I found no proposed path from Opus’s answer into those decisions. The plan needs fixes for model selection, input bounds and matching judgments to the evidence actually checked.

References to **plan** below mean [261007l](261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md).

1. **F1 — P1: `ALWAYS_HIGH_POWER` alone does not select Opus.**  
   Evidence: plan:113–117; [models.ts:1196](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/models.ts:1196), [models.ts:1626](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/models.ts:1626), [referee-mirror.ts:216](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/referee-mirror.ts:216).  
   `modelFor` does not apply `powerFor`; Mirror passes its supplied power straight through. Copying that default would send Sonnet on a standard-power article despite the new registry entry.  
   **Fix:** explicitly resolve with `modelFor(job, powerFor(job, articlePower))`. Test the actual outgoing model on a standard-power article. Environment overrides still win, so either document that exception or label results with the model actually used.

2. **F2 — P1: the claimed input ceiling is not enforced.**  
   Evidence: plan:74–81; [injection-scan.ts:1207](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/injection-scan.ts:1207).  
   Decoded Unicode-tag findings bypass `MAX_FINDING_TEXT`. A read-only probe with 5,000 tag characters produced one finding whose text was **5,022 characters**, against the stated cap of 400. Also, the listed maxima total about **2,200 characters per row**, before formatting, rather than 1,500.  
   **Fix:** cap every field independently in the prompt builder, including `text`, and enforce an aggregate input budget with disclosed omissions. Preserve scanner output unchanged. Specify output tokens sufficient for the maximum number of judgments plus reasoning; Mirror’s [2,000-token ceiling](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/referee-mirror.ts:1578) serves six remarks.

3. **F3 — P2: context computation is not bounded by `MAX_FINDINGS`.**  
   Evidence: plan:85–95; [injection-scan.ts:180](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/injection-scan.ts:180), [injection-scan.ts:193](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/injection-scan.ts:193).  
   All findings are collected before ordering and capping. Computing ancestor `textContent` at every push can repeatedly traverse a large shared block for thousands of findings that will subsequently be dropped. The added work therefore exceeds even `100 × block textContent`.  
   **Fix:** retain temporary node references, select the existing final findings first, then calculate context for survivors. Cache shared ancestor traversal and benchmark a 1.3 MB page with many findings. Assert that removing `context` from the new result gives the exact previous result, including order and truncation.

4. **F4 — P1: group keys do not establish evidence freshness.**  
   Evidence: plan:104–109; [SourceScanNotice.tsx:227](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/web/SourceScanNotice.tsx:227).  
   The key excludes paths, count and the proposed contexts. A server can judge a changed context while the client still displays the old scan, and the judgment will match the same key. The claim that differing scans “simply match nothing” is false.  
   **Fix:** bind results to a fingerprint of the complete scan or complete checked group inputs, and reject mismatches. Keep the existing group key for row identity.

5. **F5 — P2: three sampled contexts cannot support an unqualified judgment about every occurrence.**  
   Evidence: plan:70–77 and 28–33; [SourceScanNotice.tsx:208](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/web/SourceScanNotice.tsx:208), [source-scan-notice.test.tsx:474](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/tests/source-scan-notice.test.tsx:474).  
   Grouping deliberately permits different source occurrences to share a row. An attacker can put benign occurrences first and a hostile occurrence beyond the three contexts sent. “Probably harmless typography” would then appear beside the whole group.  
   **Fix:** disclose sampling beside that judgment—such as “3 of 39 occurrences checked”—and make the prompt and summary describe only those samples. Omitted occurrences must remain explicitly unchecked.

6. **F6 — P2: the proposed rendering helper does not fulfill the Unicode promise.**  
   Evidence: plan:64–66; [SourceScanNotice.tsx:184](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/web/SourceScanNotice.tsx:184), [SourceScanNotice.tsx:189](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/web/SourceScanNotice.tsx:189).  
   `visibleEvidence` replaces bidi controls only. Zero-width and tag characters remain invisible. A 200-character cap also does not prevent stacked combining marks from painting outside their line; existing [row styling](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/web/styles/referee.css:176) provides no clipping boundary. The residual path is **hostile fragment → valid `reason` → Unicode rendering**, rather than HTML injection.  
   **Fix:** explicitly handle invisible characters, isolate the reason’s direction and contain its visual overflow. Add adversarial rendering cases. Keep the verdict prefix application-written.

7. **F7 — P2: rejected entries are not unanswered rows.**  
   Evidence: plan:57–60.  
   Counting dropped judgments into “did not answer for N” gives incorrect totals for duplicates, unknown row numbers, or multiple invalid entries for one row.  
   **Fix:** calculate `unanswered = sentRows.length − acceptedUniqueRows.size`. Count rejected entries separately, and require a nonempty reason after normalization.

The shared grouping leaf is otherwise a good choice. Current server ordering and the client’s stable partition agree ([scanner](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/injection-scan.ts:187), [client](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/web/SourceScanNotice.tsx:276)). Share the ordering operation too, so future changes cannot separate the two.

Adding context can preserve detection behavior, but `textContent` is **source text**, not necessarily visible prose: it includes hidden descendants and script/style contents. Context also reaches the existing authenticated GET response ([routes.ts:11325](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/routes.ts:11325)). I found no new cross-owner disclosure path; nevertheless, filter unwanted descendants or keep contexts server-side if their only consumer is this call.

A cheaper v1 would send capped existing row fields without changing the scanner. Greg requested relevant fragments; the quoted request does not explicitly require surrounding context. If context remains, its positioning needs DOM-based anchors rather than searching for the displayed finding text, which can be decoded or normalized.

The listed job registries cover the principal tables. Also name a browser-safe result-types leaf and its client-import allowlist entry, any new test’s store/provider registry entries, and strict malformed-frame handling. Consider the shared streaming shells described in [comments.md:803](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/docs/project/comments.md:803); structured JSON still needs Mirror’s strict transport behavior.

**“Not stored” is reasonable for the opinion.** The gateway already records `ai_calls.started_at` and `finished_at` ([schema.ts:3507](/var/tmp/spideryarn-worktrees/hidden-text-opus-check/src/db/schema.ts:3507)), satisfying the timestamp concern without adding an opinion table. Say “opinions are transient; call metadata and timestamps are stored.”

No files changed.

**Verdict: ready after fixes.**