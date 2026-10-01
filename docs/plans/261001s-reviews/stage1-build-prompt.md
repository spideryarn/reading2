# Build: 261001s stage 1

You are the **builder** for this stage; Claude (Opus) is the reviewer and will read every hunk you
write. Repo: the current directory, a git worktree of Spideryarn. Read first:

- `docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md` — the whole plan, then
  **§ Stage 1** closely. It cites your own reviews (r1–r3 in `docs/plans/261001s-reviews/`).
- `CLAUDE.md`, `docs/project/block-ids.md`, `docs/project/typechecking.md` § The flags.
- Code: `src/messages-stream.ts` (`messagesWireBody`, the high-power effort merge ~line 477),
  `src/hierarchy.ts` (`SYSTEM`, `ModelNode`, `parseJson`, `treeFrom`, `planChildRanges`,
  `buildTree`), `src/hierarchy-cascade.ts` (`normaliseExpansion`), `src/hierarchy-expand.ts`,
  `src/heading-snap.ts`, and the six chat-wire schema users for reference only (`src/pdf-read.ts`
  etc. — do not change them).

## Scope (exactly stage 1)

1. **Schema validator + Messages-wire adapter**, in a new module beside `src/messages-stream.ts`
   (name it well). Pure, non-mutating validator over Anthropic's supported structured-output subset,
   run whenever a format is built; refusals as listed in the plan. A typed Messages-wire adapter
   that puts `{type: "json_schema", schema}` on `output_config.format` and composes with `effort`,
   including through `messagesWireBody`'s high-power merge. A documented contract that no schema
   field carrying a block id may use `enum`, plus a helper or test hook stage 2 can use to assert it.
   Header comment in the house style: why it exists, what it guarantees, what it does not (a
   schema does not make an id right; ids are still resolved).
2. **Structure's starts-only answer type and converter**, per the plan and your r2 G1 / r3 H7:
   `ModelNode.range` stays `[string, string]`. Extract the start-to-ranges kernel from
   `normaliseExpansion` so both callers share it, with the whole-document policy explicit where it
   differs (clamp vs refuse an outside-parent start; collapse vs refuse a one-child set). The
   converter turns a starts-only answer into ordinary `ModelNode`s; `normaliseExpansion` keeps its
   current behaviour exactly (its tests must stay green unchanged).
   **Do not wire the converter into the live path.** `toc/10`'s request, parse and build stay byte
   for byte as they are; `PROMPT_VERSION` does not move; `SYSTEM` does not change.
3. **The offline replay script** (`evals/paperwork/` is a fine home): for every retained `toc/10`
   structure answer — the raw files under `evals/results/paperwork/structure-parse/` labelled
   `before-*` that parse, plus the `hierarchy-structure` checkpoints in the local database — build
   the tree as today, and again with every end deleted via the converter, and report per answer and
   in total: newly unbuildable, dropped children, lost authored headings, identical flattened
   `(depth, title, range)` or not, and for non-identical ones a readable diff. Exit non-zero if the
   plan's gate fails. You cannot reach the database (no network, not even loopback), so **write it
   and unit-test its pure parts; Claude runs it.**

## Out of scope

The prompt change and `toc/11` (stage 2), any other stage's calls (stage 3), the chat wire, docs
beyond the module headers and a short note in the plan's ledger if you want to record a decision.
If you notice something wider, report it; do not fix it.

## Tests — red first

Write each test before the code it covers and confirm it fails first. Cover at least the plan's
lists: validator refusals (cycles direct and indirect, external refs, allowed local refs, nested
`additionalProperties` under every container keyword, each unsupported keyword, regex, ceilings),
adapter composition (explicit effort + format; high-power adaptive gains `effort: "high"` keeping
format; standard power keeps format, gains no effort), and the converter (nested derivation;
outside-parent first and later starts; duplicate and non-increasing starts; heading snap; one-child
and collapse-to-one; root/body bounds; no mutation; an invented start refuses with today's message;
starts-only equals an agreeing ranged answer). Also: the existing parity and hoist pin tests must
stay green untouched.

## Gates

- `npm run typecheck` — must pass.
- `npx vitest run <each test file you touched or added>` plus `tests/hierarchy-cascade.test.ts`,
  `tests/hierarchy-expand.test.ts`, `tests/hierarchy-build.test.ts`,
  `tests/hierarchy-structure-request-parity.test.ts`, `tests/hierarchy-prompt-hoist.test.ts`.
  Some tests need Postgres, which you cannot reach; list any you could not run and why, rather than
  skipping silently.
- `npx biome lint <files you touched>` as advice.

## House rules

- **No git commands that change anything**: no commit, add, checkout, restore, stash, reset, clean,
  merge, rebase, switch. Read-only `git diff`, `git log`, `git show`, `git status` are fine. Claude
  commits.
- Match the surrounding code's style and comment density; strict types, discriminated unions over
  bags of optionals, no `any`.
- Never log article prose or model text.

## Report back

A short summary: files changed and why, each test file and whether you saw it red first, gate
results verbatim (pass/fail counts), anything you could not run, and anything wider you noticed.
