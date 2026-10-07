Not ready for unattended stages 1–2 as written.

1. **High — The unlabelled-only dot breaks the forgeable-label rule.**  
   Evidence: the plan suppresses both the dot and announcement for labelled-only findings (`docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md:69`, `:93`). But `ordinary` is attacker-controlled and may never hide a finding (`docs/project/security.md:1030`, `src/injection-scan.ts:1423`); today even labelled-only results open (`src/web/SourceScanNotice.tsx:290`, `tests/source-scan-notice.test.tsx:276`). A hostile paragraph named `sr-only` could therefore leave no visible or announced signal outside an unvisited sub-mode.  
   Fix: give **every** non-empty result a neutral dot and status announcement. Unlabelled findings may additionally receive a stronger marker, but cannot be the only sign.

2. **Medium — The grouping key is incomplete and can merge distinct source occurrences.**  
   Evidence: the proposed key omits `caveat` despite claiming to include every readable field (`plan:107`; `src/injection-scan-types.ts:104`). More importantly, `text` is already capped (`src/injection-scan.ts:133`, `:706`, `:1207`, `:1356`), so distinct source text can produce identical `kind/text/detail/ordinary`. Excluding `where` then merges them. Also, `where` is only a four-level hint without sibling indices, not a unique location (`src/injection-scan-types.ts:75`, `src/injection-scan.ts:1475`), so “in 3 places” is not justified.  
   Fix: include `caveat`; retain every distinct `where`; call them “source paths,” not places. Add a collision test with identical capped fields but different locations. Prefer a collision-safe tuple/serialization.

3. **Medium — The proposed place words assert semantics the scan result does not contain.**  
   Evidence: stage 2 infers “inside a maths formula,” “in a figure,” etc. from `where` (`plan:119`), but that string consists of attacker-chosen tag, id, and class names (`src/injection-scan.ts:1464`) and carries no namespace or semantic-location field. A custom `<mo>` or `.figure` can manufacture those descriptions.  
   Fix: hedge them as “the source path includes `<mo>`/`figure`,” or defer semantic locations until the scanner returns a structured, DOM-derived field—which would correctly count as a defence edit.

4. **Medium — The sub-mode inventory misses deliberate tripwires and the governing security text.**  
   Evidence: `tests/referee-band-fits.test.ts:132` requires the scan inside `.ref-brief` and `:150` requires Notices to follow `sourceScanOpens`; `tests/referee-mode.test.ts:98` requires Candidates last; `tests/referee-tooltips.test.tsx:356` and `tests/referee-notices.test.tsx:437` require four chips. The security deep dive explicitly says the scan is mode-level, not a sub-mode (`docs/project/security.md:1004`). `src/web/params.ts:1273` also documents four views.  
   Fix: name these files in stage 1 and revise their assertions deliberately. The help-page edit is already covered, and command-bar production wiring is derived from `REFEREE_VIEWS`; add an explicit Hidden-text navigation assertion anyway.

5. **Medium — `REFEREE_TARGET.hidden = null` is not supported by the current table.**  
   Evidence: the plan promises a typed `null` row (`plan:73`), but `REFEREE_TARGET` is `Partial<Record<RefereeView, AutoRunTarget>>` (`src/web/activation.ts:404`, `:433`). It accepts silent omission and rejects `null`; therefore the compiler does not enforce the promised fifth answer.  
   Fix: make it `Record<RefereeView, AutoRunTarget | null>`, name all five rows, and test both the real chip and command-bar row arm nothing (`tests/pressing-a-chip-arms-it.test.tsx:135`, `tests/command-bar-sub-modes.test.tsx:627`).

6. **Medium — Preserve the live region as an existing node.**  
   Evidence: the plan says the status “moves with” the chip (`plan:69`) but does not preserve the important invariant: the empty live region must exist before the asynchronous result arrives (`src/web/modes/referee/RefereeMode.tsx:209`; `tests/referee-notices.test.tsx:140`). Conditionally mounting it with the dot may not announce anything.  
   Fix: keep one permanently mounted, empty `role="status"` node and update only its text. Keep the visual dot `aria-hidden`; test node identity across loading → ready, including labelled-only findings.

7. **Medium — The deferred comparison is mostly fair, but two claims need correction.**  
   Evidence: Option A’s filter critique is correct. Its proposed “safe sorter” is still attacker-controlled ordering and can bury its own row below the capped, scrolling list (`src/web/SourceScanNotice.tsx:178`); annotation without reordering is safer. Option B is reasonable if implemented literally, but “Notices-era auto-opening would have stayed shut” is false: every labelled finding currently opens it (`plan:151`, `src/web/SourceScanNotice.tsx:290`).  
   Fix: for A, allow only an annotation beside the unchanged deterministic ordering. For B, delete the auto-opening claim and define the predicate from the DOM namespace: inside MathML, the complete text node contains only whitespace plus U+200B/U+2061–U+2064, with at least one such character; explicitly exclude tag characters, bidi controls, visible text, and non-MathML nodes.

8. **Low — A simpler presentation avoids the risky grouping altogether.**  
   Evidence: the current component already separates the headline from the exact raw list (`src/web/SourceScanNotice.tsx:274`, `:379`).  
   Fix: show a plain summary such as “39 findings involve invisible characters,” then put the unchanged raw rows behind a **Source details** disclosure. This answers Greg’s gibberish complaint, preserves every finding and location, and needs no security-sensitive equivalence key.