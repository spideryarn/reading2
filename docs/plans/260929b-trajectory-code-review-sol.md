Verdict: **accept after fixes**

- **F10 — P3, fixed:** removed dangling “going round again” wording from tests, controller comments, and current docs.
- **F11 — P3, fixed:** added regression assertions for tooltip Escape and outside-press dismissal. Keyboard focus and tap behavior were already covered.
- No P0–P2 findings.

List-follow correctly uses only `.tl-scroll`, reruns for stop/depth/card/`away` changes, and inherits `useFollow`’s wheel/touch cancellation. The 420px head safely wraps; the info control is non-shrinking and the tooltip width is viewport-capped.

Checks:

- Focused Vitest: **109 passed**
- Typecheck: **passed**
- `git diff --check`: **passed**
- No commit made.