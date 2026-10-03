## P0

- None. No visitor path exposes relations: the route is authenticated and owner-scoped ([src/routes.ts:8788](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/routes.ts:8788)), the public DTO omits them, `OwnerMarginFeed` is owner-gated ([Reader.tsx:2674](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/web/reader/Reader.tsx:2674)), and the offline cache is partitioned by authenticated owner.

## P1

1. [src/relations.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/relations.ts:151), [src/store/pg.ts:1619](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/store/pg.ts:1619) — A same-text block changing `text → heading` kept the old fingerprint, so a carried `BUT` could remain “current” beside a heading forever; `heading → text` never gained a relation. Tree-only gist changes did the reverse and bought an unnecessary rewrite. **FIXED:** the stamp now hashes the exact rendered article/head and ordered eligible paragraph pairs; the PG read includes `kind`, `words`, and `treatment`; prompt version is `relations/2`.

2. [src/web/marginalia/notes.ts:324](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/web/marginalia/notes.ts:324) — For a visitor, “On 4 July Acme launched” changing to “On 4 July Beta launched” retained the date phrase but lost the event quote; the margin still displayed “Acme launched” anchored only to “4 July.” **FIXED:** dated events now require a surviving same-block occurrence quote.

3. [src/relations.ts:298](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/relations.ts:298), [src/paperwork.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/paperwork.ts:58) — The prompt said both “choose nothing” from paperwork and answer every listed paperwork paragraph. Enough omitted rows could fail the under-half check after a paid call. **FIXED:** added a relation-specific paperwork rule that classifies every listed paragraph without treating names in paperwork as claims.

## P2

1. [src/relations.ts:176](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/relations.ts:176), [src/store/pg.ts:3872](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/store/pg.ts:3872) — After a model-generation change, GET reported a relation artefact current while the pipeline stamp considered it outdated. A press was consumed without enqueueing the needed rerun. **FIXED:** GET now uses the same generation-aware comparison as the pipeline.

2. [tests/store-export-covers-tables.test.ts:655](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/tests/store-export-covers-tables.test.ts:655), [tests/store-artefact-manifest.test.ts:239](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/tests/store-artefact-manifest.test.ts:239) — Relations was absent from both independent export inventories. The schema coverage test would fail, and the manifest had no declared home. **FIXED:** registered it and added a fixture proving both bundle and rollback exports write the complete artefact ([store-export-bundle.test.ts:517](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/tests/store-export-bundle.test.ts:517)).

3. [tests/a-second-press-closes-the-mode.test.tsx:356](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/tests/a-second-press-closes-the-mode.test.tsx:356), [tests/every-mode-draws-its-surface.test.tsx:1448](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/tests/every-mode-draws-its-surface.test.tsx:1448) — Tests could pass while an off-press or command-bar selection posted a job, and Marginalia’s surface test proved only that an Idea rendered. **FIXED:** assertions now inspect POSTs; missing and outdated relations each produce exactly one job under StrictMode; the surface test requires the fetched `but` relation itself.

4. [src/web/marginalia/tips.ts:50](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/web/marginalia/tips.ts:50) — The tip claimed every event sits beside its first mention, although dated events intentionally sit beside the passage that dates them. **FIXED:** wording now distinguishes dated events from relative-word events.

5. [src/store/pg.ts:3648](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/src/store/pg.ts:3648) — The same model-generation mismatch remains on several older artefact GETs, including Ideas, Timeline, FAQ, and others. After a model change, their auto-run presses can likewise consume without enqueueing. **REPORTING:** wider than Relations; not changed.

6. [tests/store-artefact-manifest.test.ts:188](/home/greg/code/spideryarn2/.claude/worktrees/fbayajv6-marginalia-relations-timeline/tests/store-artefact-manifest.test.ts:188) — `HOMES` still omits several earlier modern files such as `faq.json`, `citations.json`, `skim.json`, `crossrefs.json`, and `simple-summary.json`. **REPORTING:** pre-existing wider inventory drift; only Relations was added.

## Checks

- Typecheck: all four projects passed; all 2,813 source files covered. The `npm run typecheck` wrapper itself hit a sandbox `tsx` IPC `EPERM`, so I ran the exact script as `node --import tsx scripts/typecheck.ts`.
- Vitest: 279/279 targeted assertions passed, plus 72/72 in `every-mode-draws-its-surface`.
- Manifest’s relevant inventory test: 1/1 passed.
- DB-backed export tests could not start because local Postgres was unavailable (`connect EPERM 127.0.0.1:54362`). The manifest evidence subtest was also blocked by sandboxed `git ls-files` (`spawnSync git EPERM`).
- Scoped lint: no errors; only existing complexity notices and one unrelated optional-chain warning.
- Migration was not edited. No commit was made.