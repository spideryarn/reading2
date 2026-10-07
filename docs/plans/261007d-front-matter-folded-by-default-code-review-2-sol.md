No findings in the four closed areas; no files were changed.

All four statements are accurate:

- Block 0 remains hidden without being treated as folded away; reading position, ↑/↓, Structure, spine geometry, and the `h1` masthead echo behave correctly.
- `reopenFor` is confined to the same component token. Article replacement and genuine unmount/remount use new tokens and remain shut.
- `visibleFrom` correctly maps folded content to its outermost visible folded heading. Key navigation skips real folded starts before mapping, and `?at=` stays on visible blocks.
- The overlapping-name union and text/heading-only guard are correctly implemented and pinned by tests.

Verification:

- Requested jsdom suite: 5 files, 165 tests passed.
- Additional fold, masthead, Structure, spine, marginalia, and reading-position suite: 8 files, 123 tests passed.
- Typecheck: all 3,371 source files covered and passed. The npm wrapper hit a sandbox IPC restriction; running the same script via Node’s `tsx` import passed.
- Biome and `git diff --check`: passed.
- Existing untracked review/feedback documents were untouched.

VERDICT: ready to push