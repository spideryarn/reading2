# Plan review: rename the `hierarchy` step to `structure`

You are reviewing a plan, read-only. Repo root is the current directory. The plan is
`docs/plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md`. Read it in full first.

Then check it against the code. The two precedents, and the migration it copies, are evidence:
`docs/plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md`,
`docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md`,
`drizzle/20261001224759_skim.sql`, `drizzle/0041_rename_toc_step_to_hierarchy.sql`.

What I most want from you, in order:

1. **Persisted or boundary-crossing spellings of "hierarchy" the plan misses** — anything a
   TypeScript compiler will not catch: stored values (Postgres rows, jsonb, Storage paths), CHECK
   constraints and their TS twins, checkpoint keys (does a checkpoint key or hash include the
   namespace string? `src/store/checkpoints.ts`, `src/hierarchy.ts`, `src/labels.ts`,
   `src/hierarchy-deepen.ts`), hashes whose input includes the step name (`src/source-hash.ts`,
   freshness stamps, `work_key`), cost/ledger classification, feedback payloads, URLs, env vars,
   string-keyed Records, test fixtures that would fail a migrated CHECK.
2. **The order of stages and whether each really leaves `dev` green and deployable.** In particular
   stage 1 renames code while the stored literal stays `"hierarchy"` — is there anything in stage 1
   that silently changes a stored value or a hash?
3. **The migration steps** in stage 2, including the checkpoint namespace UPDATE and the deploy
   window. Should anything refuse rather than proceed?
4. **The inner pass rename** ("structure" pass → `sections`): is that what the pass actually does
   (read `src/hierarchy.ts`, `src/hierarchy-prompt.ts`, `src/hierarchy-starts.ts`), and is the name
   good? My one-sentence description of the step's passes in § The name collision may be wrong —
   check it against the code and say.
5. Anything simpler that gets the same result.

Note: another session is about to change `src/hierarchy.ts`, the prompt and the eval
(plan `docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md`); you are reviewing
against the tree before that lands, which is fine.

Answer as numbered findings, each with a severity (P0–P3), file:line evidence, and a concrete
change to the plan. Say plainly if something is fine. Also give a one-paragraph verdict at the top:
build as planned, build with changes, or rethink.
