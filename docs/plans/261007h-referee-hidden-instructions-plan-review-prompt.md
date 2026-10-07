You are reviewing a plan before it is built, in the repo you are sitting in (read-only).

Plan: docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md

Read it, then read the code and docs it touches:
- src/web/SourceScanNotice.tsx, src/injection-scan-types.ts, src/injection-scan.ts (§ invisibleCharacters)
- src/web/modes/referee/RefereeMode.tsx, src/web/referee-views.ts, src/web/sub-modes.ts, src/web/activation.ts
- docs/project/referee-mode.md § rule 5 (the five rules for the notice) and § What the band looks like
- docs/project/security-map.md, tests/referee-notices.test.tsx, tests/source-scan-notice.test.tsx

Constraint the author is under: stages 1 and 2 (sub-mode move, plain-words grouping) may be built
unattended only if they edit no defence and keep the five rules; anything that changes what the
scanner finds or flags is deferred to Greg.

Questions:
1. Do stages 1 and 2 really keep all five rules? Is any part of stage 2 (grouping, place words, the
   per-kind sentences, the dot only for unlabelled findings) a defence edit in disguise, or a way
   a hostile document could hide a finding from the referee?
2. Is the grouping key right? Could a payload be merged into a benign group?
3. Anything in the sub-mode move the plan misses (other tables, URL params, tests, help page,
   command bar, the sr-only live region, the chip arming)?
4. Is the deferred analysis (Option A LLM pre-filter vs Option B MathML label) fair and correct?
   Is Option B's rule safe as written?
5. Anything simpler that answers Greg's complaint as well?

Answer with numbered findings, each with severity (high/medium/low), the evidence (file:line), and
the fix you suggest. Be concrete and brief.
