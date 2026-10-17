# Plan review, round 2: 261017h Stage 3 design — a blurb per cited work

Read-only review. Worktree with uncommitted Stage 1 work (ignore it) and untracked docs.

Read: docs/plans/261017h-stage-3-design-citation-blurbs.md (THE DESIGN under review); the parent plan docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md; your own round-1 review docs/plans/261017h-sources-blurbs-plan-review-sol.md; the spike write-up docs/investigations/261017c-citation-blurbs-cost-and-quality.md and evals/citation-blurbs-spike.ts. Then check the design against the code it names: src/bibliographic.ts, src/store/pg-bibliographic.ts, src/citation-registry.ts, src/bibliography.ts, src/pipeline.ts, src/step-order.ts, src/store/pg-revisions.ts (publishRevisionIn, enqueueSuccessorIn, carry policy), src/store/artifacts.ts, src/store/pg.ts (loadBibliography, attachLookups), src/public/dto.ts (publicCitedWork), src/models.ts, src/ai-call.ts, src/chat-tools.ts, src/web/BibliographyPanel.tsx, docs/project/architecture.md § Conventions, docs/project/security-map.md, docs/project/privacy.md.

Focus:
- Does the successor trigger in publishRevisionIn really fire on every path that makes a Bibliography (import auto-mode, Metadata re-make, Find them again, MCP), and can it loop or double-queue? Is a successor driven by an open tab acceptable, or does import without a tab leave blurbs never made?
- The identity-fingerprint attach: can a blurb attach to the wrong work (entry ids reused across re-made lists? a row whose title changed but entryId and url didn't?). Is "attach by identity only, not prompt version" safe?
- Prompt injection and the quote check: is "quote ≥4 normalised words inside that work's own evidence" enough to stop an injected abstract, or an inverted-meaning blurb (the Searle case)? What else is cheap and worth it?
- The Crossref title-search exception: bounds, politeness, and the strict rule (the first-author surname requirement; book-looking entries).
- Public projection and privacy: anything a visitor could see that they should not; anything new sent to a third party for a private upload that the design misses.
- Transient vs terminal states: any failure that gets stored as terminal and never retried, or retried forever.
- Simpler options that keep most of the value.

Severity: P0 (wrong/harmful, blocks), P1 (fix before building), P2 (worth doing), P3 (nit). An ID on each (G1, G2…), file/line, concrete failure scenario. End with one line: "proceed", "proceed with changes", or "rethink".
