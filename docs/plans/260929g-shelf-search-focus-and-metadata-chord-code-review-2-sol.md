No P0–P3 findings. No files changed.

- Unavailable Send activation is safely refused: clicks—including SVG-child clicks—are cancelled, while the form’s `submit()` guard independently covers empty, busy, dictation-armed, read-only/transcribing, and programmatic submission states.
- Stop remains an enabled `type="button"` and correctly replaces Send.
- Tooltip cloning preserves form membership and layout.
- The focusable `aria-disabled` button is appropriate here: screen readers announce its state while keyboard users can open the tooltip.
- CSS covers unavailable Send, enabled Send, spinner, hover, focus, and Stop without missed `:disabled` remnants.

Checks:

- Focused Vitest: 43/43 passed.
- Typecheck: passed, all 2,344 source files covered.
- Targeted Biome: no errors; one pre-existing `ChatPanel` complexity advisory.
- Full `npm test`: environment-blocked because the sandbox cannot reach local Postgres.

Verdict: APPROVE — Part C matches the specification and preserves disabled-state safety.