Implemented three P1 fixes; no candidate findings remain open.

- C1 — P1 — [email-frame.test.ts](/var/tmp/spideryarn-worktrees/fonts-code-quality/tests/email-frame.test.ts:61): the test ignored shared heading, action-wrapper, and after rows, and could run zero template cases. Fixed: complete emails now use one `emailHtml` composer, templates are compared exactly, and the template list is pinned. Red: both templates accepted middle-row mutations. Green: mutations fail and gift HTML remains byte-for-byte pinned.

- C2 — P1 — [sketch-label-face.test.ts](/var/tmp/spideryarn-worktrees/fonts-code-quality/tests/sketch-label-face.test.ts:98): NAPI canvas silently used its fallback when font registration failed. Fixed: registration failure now throws. Red: a missing WOFF2 measured successfully; green: it is rejected.

- C3 — P1 — [sketch-scene.ts](/var/tmp/spideryarn-worktrees/fonts-code-quality/src/sketch-scene.ts:120): importing `src/web/voice.ts` violated the existing shared-module boundary. Fixed: the narrow `"ui" | "ai"` type stays local. Red→green: `tests/client-imports.test.ts`.

- C4 — P3 — reported, not fixed: broader lint still reports pre-existing accessibility diagnostics outside the candidate diff at [SketchView.tsx:1296](/var/tmp/spideryarn-worktrees/fonts-code-quality/src/web/SketchView.tsx:1296) and [SketchView.tsx:1317](/var/tmp/spideryarn-worktrees/fonts-code-quality/src/web/SketchView.tsx:1317).

Additional verification:

- Required Vitest command: 154/154 passed.
- Boundary and band/fullscreen SVG checks: 30/30 passed.
- `CHAR_W_BY_VOICE.ui` remains exactly `0.53`.
- Both band and fullscreen SVGs receive `voice-ui`; its global rule resolves to the same Geist stack.
- Standalone exports contain the selected literal stack.
- Keeping `FONT_STACK_BY_VOICE` as a tested mirror is reasonable: standalone SVG has no stylesheet, while deriving it would add filesystem/CSS parsing. Its equality with `tokens.css` is enforced.
- Auth template files remain unchanged from the base.
- `npm run typecheck` was blocked before execution by the sandbox’s Unix-socket restriction. The equivalent `node --import tsx scripts/typecheck.ts` passed, covering all 4,020 source files.
- Focused lint on the files edited during review passed.
- PostgreSQL billing-voucher tests were not run, as requested.
- No commit was made.