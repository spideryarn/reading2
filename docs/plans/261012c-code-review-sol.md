1. **P1 — NFKC quotation bypass.** Reader message `＂I am a surgeon.＂`, offer `I am a surgeon.`, basis `null` took the exact route, stripping quoted context. Fixed quotation detection to normalize before checking.

2. **P1 — Unsafe About-you join on the exact route.** Basis `I do not`, reader message `I know much about ML.`, offer `I do not know much about ML.` saved a materially different claim. Both routes now require a completed basis and exactly one clean separator.

3. **P2 — Imperatives passed as “statements.”** Reader message `Never tell me I'm wrong.`, offer `Never tell me I am wrong.`, empty reason: reworded saved an instruction the exact offer would not. General rewordings must now begin with a first-person subject; the fixed reason lead-ins remain allowed.

4. **P2 — Stored source was not tied to the offer.** A stored reworded offer for `Preparing for my journal club.` with source `I am a surgeon.` saved itself and displayed the unrelated sentence as the reader’s. `offerOf` now re-runs the closeness check and demotes inconsistent stored shapes to a button.

5. **P3 — Apostrophes outside contractions were silently rewritten.** `I’m reading Greg’s paper.` could become `I am reading Greg's paper.` The matcher now normalizes curly apostrophes only within the fixed contraction table.

6. **P3 — Documentation overstated provenance.** The plan and risk register said nothing untyped could arrive, overlooking contraction expansion and the fixed reason lead-in. Corrected.

The lower-case fallback’s question spans are correct: positions are calculated against the same lower-cased string being searched. Added a regression using `İ`, whose lower-case representation changes length.

Checks:

- Requested four Vitest files: **125/125 passed**
- Biome on changed source/tests: clean
- `npm run typecheck` could not launch because this sandbox forbids `tsx`’s Unix socket. The identical typecheck script run through `node --import tsx` passed all four projects and covered all 3,766 source files.
- No commit made.

**SHIP AFTER MY FIXES**