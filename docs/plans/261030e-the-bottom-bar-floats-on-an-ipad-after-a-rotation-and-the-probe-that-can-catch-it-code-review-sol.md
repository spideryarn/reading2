Verdict: APPROVE after in-stage fixes. No remaining code findings.

1. **P1 — `docs/user-feedback/questions/q-th6h9q.md:11`:** The instructions took the screenshot after opening the command bar, whose keyboard may clear the fault, and overstated that the trace identifies one exact cause. Fixed: screenshot first; trace now “narrows” the causes.

2. **P2 — `src/web/ViewportProbe.tsx:544`:** Clear left previously booked `settled` timers alive, repopulating an empty trace. Reproduced red, then fixed by cancelling bookings on Clear and unmount.

3. **P2 — `src/web/ViewportProbe.tsx:514`:** `showing.current` was mutated during render, exposing uncommitted state during concurrent rendering. It now changes in a layout effect alongside the DOM/ref transition.

4. **P2 — documentation:** Several files claimed all readers were untouched despite the deliberate `?probe=1` route, or claimed stale geometry could always be separated. Corrected in the plan, postmortem, feedback note, switch documentation, and command copy.

Changed:

- Fixed timer and render-lifecycle handling.
- Added view-as, Clear/timer, and `settled` analysis coverage.
- Corrected the question’s sequence and certainty.
- Corrected reader-cost and diagnostic-limit wording.

Verification:

- Targeted tests: **100/100 passed**.
- Typecheck: all **4,115** source files covered and green. The exact npm entrypoint hit the sandbox’s `tsx` socket `EPERM`; the same wrapper passed via `node --import tsx`.
- Biome: no errors; three existing informational notices.

If `q-th6h9q` was already published, its production row now needs republishing.