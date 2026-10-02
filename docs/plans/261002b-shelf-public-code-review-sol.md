Ready to land on `dev`. No unresolved P0/P1/P2 findings, and I did not commit.

Findings:

- P0: None.
- P1, fixed — a stale saved shelf, including an offline synthetic response, could let the public request run before current ownership was known. The reader’s own newly added article could therefore appear under “Shared by other readers.” Public results now wait for an authoritative owner response; offline copies do not qualify. [useShelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/useShelf.ts:252), [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/Library.tsx:830), [ShelfPublicSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/ShelfPublicSection.tsx:34).
- P2, fixed — the empty-shelf test proved focus but not the promised scroll. It now asserts `scrollIntoView({ block: "center" })`. [shelf-include-public.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/tests/shelf-include-public.test.tsx:309).
- P2, fixed — added executable coverage for pending debounced search state and Back/Forward restoration. [shelf-include-public.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/tests/shelf-include-public.test.tsx:241).

Exactly changed:

- Added `liveArticlesLoaded` to the shelf state, excluding marked offline copies.
- Gated the anonymous public read on current ownership data.
- Added an accessible status message while current ownership is unavailable.
- Added regressions for stale cache, offline cache, debounce/history, Back/Forward, and scrolling.

Verification:

- Required focused tests: 22 passed.
- Equivalent full typecheck passed for every project. The literal `npm run typecheck` wrapper was blocked by sandbox Unix-socket `EPERM`; `node --import tsx scripts/typecheck.ts` ran the same checker successfully.
- Tailwind resolver confirmed both orientation variants compile.
- Client/public import guards and public shelf tests: 37 passed.
- Lint: no errors; one informational existing `Library` complexity warning.
- Full `npm test` could not start because the sandbox cannot reach Docker/Postgres on port 54362.