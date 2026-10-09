# Code review: the public-shelf topic cost eval

The only code in this change is evals/shelf-topic-clusters/public-shelf-cost.ts (a PAID eval, already run; its output is evals/shelf-topic-clusters/results/261008-public-shelf-cost.json). Everything else is docs: docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md, docs/investigations/261008a-public-shelf-topic-rethink-cost.md, docs/user-feedback/questions/q-p5h2a7.md, q-deh67j.md, docs/user-feedback/261004_1000-topic-pills-on-the-public-shelf.md, docs/project/public-shelf.md.

Review the script for correctness:
- Does it measure what the investigation says (spend per rethink/file run via collectSpend; production read is read-only inside begin read only ... rollback; the same conditions as src/store/public-library.ts publicLibraryQuery and its caps)?
- Does the per-run spend capture all calls (pooled workers, nested collectors, the sink)? Could totals be double counted or missed?
- The seeded shuffle, the newcomer choice for file-one, typing, ESM, lint-level issues, and that it never writes to production.
Also check the docs' numbers against the results JSON, and that no doc claims a measurement that the JSON does not contain.

Do NOT run the eval (it spends money). You may run `npx tsc --noEmit -p .` and `npx eslint <file>`.
Fix what you find directly in the files (keep changes small). Then end your final answer with: findings (P0/P1/P2), what you changed, and a one-line VERDICT.
