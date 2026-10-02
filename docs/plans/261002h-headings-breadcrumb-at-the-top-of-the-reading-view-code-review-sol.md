No P0 or P1 findings remain. I fixed three P2s.

- P2 — [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/Reader.tsx:512): `buildSummaryTree` ran for every reader, including visitors and readers with Experimental off. It is now gated by `experimental.on`.
- P2 — [headings-crumbs-wiring.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/tests/headings-crumbs-wiring.test.tsx:282): the fixture contained only one structural level, so it could pass without rendering a real breadcrumb path. It now covers part → section, leaf-only `aria-current`, and signed-out visitors retaining their existing bar without crumbs.
- P2 — [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/Reader.tsx:2656) and [shell.css](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/shell.css:585): comments still cited the removed `barHasContent` helper. Updated to the actual `showBar` owner.

The `showBar` layout-key addition is correct. When the preference arrives asynchronously, `useReadingPosition` re-anchors the unchanged `?at=` section before paint using the new bar geometry; omitting the key would leave the samplers stale. Visitors already have a bar, so adding their crumbs does not unnecessarily re-key layout.

I accept the documented `bandAway` exception and the second sampler: both are bounded, deliberate trade-offs rather than correctness defects. The CSS truncation/specificity and the `nav`/`ol`/`aria-current`/tooltip semantics look sound.

Checks:

- Focused tests: 10 passed.
- Typecheck: green via `node --import tsx scripts/typecheck.ts`.
- Biome: no touched-file errors; only the existing Reader complexity notices.
- `git diff --check`: green.
- Full `npm test` could not start because Postgres/Docker is inaccessible in this sandbox; the broader unit project also hit unrelated sandbox/process tests.

Files changed:

- `src/web/reader/Reader.tsx`
- `src/web/styles/shell.css`
- `tests/headings-crumbs-wiring.test.tsx`

No commit or push performed.