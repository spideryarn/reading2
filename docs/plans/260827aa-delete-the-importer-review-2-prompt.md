# Review the plan again: progress, and the build order for landing C

You returned **NO-SHIP** on this document's first draft (eleven findings, ten folded in), and
NO-SHIP on two of three answers in a narrower round on the adapter's shape. Both are now part of the
document. This is a third read, of the plan **as it now stands plus five commits of work**, and
specifically of the part that did not exist before: § The build order for C, commit by commit.

Be adversarial. Every round so far has found something real; assume this one does too.

## Read, in this order

1. `docs/plans/260827aa-delete-the-importer.md` — the whole thing. § Where it stands, § What this has taught
   us, and § The build order for C are new.
2. `docs/plans/260827ac-artifacts-pg-shape-sol.md` — your own previous round, now folded in. Check I folded it
   in *correctly* rather than agreeably.
3. The five commits: `e18ac5f`, `fd30c5d`, `2a2cf7f`, `5d8ed19`, `9e28f8c`. `git show` each.
4. `tests/helpers/artefacts.ts` and `tests/artefact-copy.test.ts` — the importer's replacement, built.
5. `src/store/pg-revisions.ts` — `reasonsNotToPublish` (new), `recordStepRun`, `beginDraftIn`,
   `openOrBeginJobDraft`.
6. `src/store/artifacts.ts`, `src/store/artifacts-fs.ts`, `src/pipeline.ts` — the seam C implements.

## Attack these specifically

1. **The build order.** Seven commits, C1–C7, each meant to be green alone with nothing depending on
   an unproven piece. Is that true? Name any commit that cannot actually be green on its own, any
   dependency I have the wrong way round, and anything that has to happen *before* C1 that I have not
   listed.

2. **C1 — giving `toc` a stamp.** I claim this must come before the adapter, or the adapter grows a
   private freshness rule and becomes the third independent status-and-hash test. Is landing a stamp
   on `toc` actually safe on its own? What currently-passing behaviour changes the moment `toc` can
   report itself stale — consider `cascadeForce`, the metadata page, and any article whose stage-3
   blocks already differ from `data/<slug>/blocks.json` on disk today.

3. **C3 read-only checked against importer-written rows.** I call this "the last time that is
   possible and worth using". Is it sound, or is it circular — proving the adapter agrees with the
   thing being deleted, whose own shape may be what is wrong?

4. **C5 and empty blocks.** Delete-all is the decision. Walk the failure I have not: what happens to
   `block_identities`, to comments and chat anchored to those blocks, and to
   `articles.current_revision_id`, when a draft legitimately writes zero blocks and is then
   abandoned rather than published?

5. **C6 and the migration.** One migration adding `raw_filename`. `drizzle-kit generate` diffs the
   whole schema and other agents share `src/db/schema.ts`. Beyond "do it when the file is clean", is
   there anything about this particular column — the CHECK and composite FK already on
   `raw_source_sha256`/`raw_source_kind` — that makes the diff riskier than it looks?

6. **`tests/helpers/artefacts.ts` as built.** It is the load-bearing replacement for `db:import` in
   three suites. Read it adversarially: what does `copyArtefacts` fail to preserve that
   `importArticle` preserves, and does any of the three suites depend on that difference? Note it
   copies steps in `STEP_ORDER` and skips a step with no parts.

7. **§ What this has taught us.** Five lessons. Is any of them stated too strongly, or stated as a
   general rule when the evidence supports only a narrow one? I would rather cut one than keep a
   lesson that will mislead later.

8. **What the plan still has not thought about.** Each previous round found one. My guess at the
   likeliest candidates: what happens to `sweepAbandonedDrafts` once drafts are the normal write
   target; whether `interrupted()` has a coherent Postgres meaning at all; and the ordering between
   `beginStep` and `openOrBeginJobDraft` on the very first step of a fresh job.

## Format

Ranked findings, each with a confidence and a concrete `file:line` or reproduction. A verdict at the
top. Do not accept a claim because it is stated confidently — most of them are mine, and three
earlier rounds have caught me overclaiming.

**Markdown links must be repo-relative** or plain code spans — absolute paths break
`tests/doc-links.test.ts`, which has happened in every previous round.
