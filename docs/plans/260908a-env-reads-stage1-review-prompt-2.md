# Round 2: Stage 1 of the environment-read inventory, rebuilt on your refusal

The repo is at `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`, branch
`worktree-env-names-literal`, base commit `7981430a` (plan documents only — everything else is
uncommitted).

**This is round two of two.** Your round-1 review is
`docs/plans/260908a-stage1-review-sol-1.md` — read it first; it is the specification for what
changed. After this round I settle it myself and write down what I overruled and why, so a P1 you
believe in needs to be *demonstrated* rather than asserted.

## What you refused, and what was done about it

You returned **do not land** on three P1s. I reproduced P1-1 myself before acting on it — your three
fixtures swept to `names: []`, `refusals: []`, all parsed — so none of this is taken on trust.

**P1-3 (all five mechanism contracts bypassable) was not patched. The layer it lived in was
deleted.** Your own suggestion for `sanitize-policy.ts` — *"pin the complete normalized AST, or even
a checksum"* — became the treatment for all five. `usesOf`, all three per-file `FileRule` walkers,
`fnAt`, `describeContext`, `calleeName` and the `gitNames.size !== 4` block are **gone**, replaced by
a table of eleven checksum-pinned regions and a ~20-line hash over the AST with positional fields and
`extra` dropped. Any edit to a pinned function changes its checksum and goes red, telling the reader
to re-read the function by hand and update the pin and its declared names together.

**P1-1 (fail-open spellings)** — flat rules, no analysis:
- refuse computed member access on `globalThis`;
- refuse the strings `"process"`, `"node:process"` and `"env"` **anywhere at all** (this went beyond
  what I asked; it closes `Reflect.get(process, "env")`, where the string is a call argument rather
  than a computed key);
- an explicit `PROCESS_PROPERTIES` allowlist — `argv`, `exit`, `cwd`, `pid`, `version` — with every
  other property of `process` refused, so `getBuiltinModule` and any future Node API is a refusal
  rather than a miss;
- `ExportNamedDeclaration` / `ExportAllDeclaration` / dynamic `import()` specifiers go through the
  same check as `ImportDeclaration`.

**P1-2 (hidden directories)** — no directory is skipped, and `filesParsed.length > 400` is replaced
by **set equality** against an independent `readdirSync(recursive)` enumeration.

**Beyond your findings**, one residue was closed rather than recorded: the sweep's root was an
assumption, so a module outside `src/` re-exporting the process object and imported by `src/` was
invisible — your bridge attack across that line. Every **relative** import/export/dynamic-import
specifier in `src/` is now resolved by path arithmetic and refused if it escapes `src/`. Measured
first: 532 files, zero violations, so it went in with **no exemption list**.

**P2-2** — the helper shrank from 1,358 to 1,248 lines despite gaining the boundary rule. Biome is
clean on both files (nine errors including cognitive complexity 35, fixed by extracting a function,
not by raising a threshold).

**P3-1** — the prose corrections are mine and are done: three source comments claiming
`SPIDERYARN_ENV_PINNED` "hid for months" when git says `5aceccfe`, 2026-09-04 (four days); the plan
saying four mechanisms where there are five; the plan repeating your `DATABASE_URL` module-load
snapshot instruction, which the implementation deliberately **disobeyed** and was right to — a
module-load snapshot is by definition equal to `INHERITED` and would have silently broken the
file-wins path that `db:seed-dev` and `db:reown` need; `docs/project/worktrees.md` naming the deleted
`CONCURRENCY_ENV`; and a claim in the plan that the duplicated `*_ENV` spellings were already
guarded, which turned out to be false for two of four.

## The candidate

**Modified (tracked)** — `git diff 7981430a -- <path>`:
`src/env.ts`, `src/jobs.ts`, `src/hierarchy-deepen.ts`, `src/fetch.ts`, `src/web/lib/supabase.ts`,
`src/vercel-health.ts` (one comment), `tests/env.test.ts`, `tests/library-log-volume.test.ts`,
`docs/project/worktrees.md`, and the plan doc.

**Untracked — a pathspec cannot name these, read them directly:**
`tests/helpers/env-reads.ts`, `tests/env-reads-are-literal.test.ts`,
`docs/plans/260908a-stage1-review-sol-1.md`.

Start with `tests/helpers/env-reads.ts`. That is a reading order, not a scope limit.

## Run it yourself

- `npx vitest run tests/env-reads-are-literal.test.ts` — 35 assertions. **Attack them rather than
  trusting the green.**
- `npm run typecheck` clean; `npm run check` (820 test files) green apart from one doc anchor I have
  since fixed.
- Database-backed tests are mine and I ran them one file at a time; all green.

## What I want, in order

1. **Find a read this sweep still does not see.** Same game as round 1, and you won it. Write the
   file, sweep it, show me the output. A seventeenth spelling existed; is there a twentieth?
2. **Attack the checksum pins specifically.** Can a pinned region be edited without moving its hash?
   Can a region be *removed* — the function renamed or deleted — and the pin silently stop covering
   anything? Can the declared-names list drift from what the function actually yields? The pin is now
   the whole of the mechanism guarantee, so this is where a P1 lives if there is one.
3. **The forbidden-string rule is broad.** `"process"`, `"node:process"`, `"env"` anywhere. Is it
   *too* broad in a way that makes it fragile, or too narrow in a spelling I have missed?
4. **Which assertions would still pass if the thing were broken?** Especially the file-set equality
   and the constant table.
5. **Anything in the prose that is not true of the tree in front of you.**

## Known limits, stated so you can disagree with them rather than discover them

- **`PROCESS_PROPERTIES` rests on a claim about Node's API surface, not a syntactic fact.** If a
  future Node makes `argv`, `exit`, `cwd`, `pid` or `version` return the process object, this breaks
  — the same *kind* of claim that made `getBuiltinModule` a hole. The allowlist makes that a bounded,
  enumerable risk rather than an open one. Say if you think that trade is wrong.
- **Two of your five contract bypasses are controlled in halves, not end to end.** There is no
  control injecting `envVar = "HIDDEN_MODEL"` or a shadowed `name` into a mirror of `src/`. What is
  controlled is (a) that a body edit moves the checksum and (b) that a moved checksum goes red — and
  a live pin-flip showed the region correctly stops being covered, so the underlying refusal
  reappears rather than the pin merely reporting itself. I judged that adequate. Tell me if it is not.
- **Forbidding the string `"env"` has a real future maintenance cost** — a JSON key or a column name
  would need a pin. Cheap today, named rather than hidden.
- The gate is `src/` only. `tests/`, `scripts/`, `evals/` and `api/` are not swept; the boundary rule
  is what stops that mattering.

## Severity — an ID on every finding (`P0-1`, `P1-1`, …)

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Say plainly if it is fine. End with: land as is / land with these changes / do not land.

**Discovery closes after this round.** If you carry a round-1 P1 forward as still open, say so
explicitly and show the reproduction, because that is the one thing I must not settle by assuming I
fixed it.
