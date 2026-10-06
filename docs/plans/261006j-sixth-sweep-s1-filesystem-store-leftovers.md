# Sixth sweep, S1: delete what the filesystem store left behind

Cluster S1 of [the sixth codebase sweep](261006j-sixth-codebase-sweep-umbrella.md). The filesystem
article store was deleted on 2026-09-05. This cluster removes the instrument, the script and the
type arm that outlived it. Built 2026-10-06.

## What landed

**1. The store-migration witness instrument: six files deleted, 2,245 lines.**

| file | lines |
|---|---:|
| `vitest.witness.config.ts` | 163 |
| `scripts/store-migration-witness.ts` | 539 |
| `scripts/store-migration-candidates.ts` | 363 |
| `tests/setup/fs-store-witness.ts` | 71 |
| `tests/setup/fs-store-witness-setup.ts` | 31 |
| `tests/store-migration-witness.json` | 1,078 |

`tests/store-migration-registry.test.ts` read the JSON and ran the candidates script, so four of
its cases were retired first, with a comment in their place saying what each one checked:

- every file the instrumented run watched touch the filesystem store has an entry;
- `evidence: "dynamic"` names a file the run watched;
- no file the import graph can reach from a condemned module is unaccounted for (the
  fourteen-second subprocess);
- the instrument's two blind spots stay written down.

The test file went from 13 cases to 9 and from 1,166 lines to 996. What it still checks:
`STORE_MIGRATION` names only files that exist and carries real reasons; `STORE_CONVERSIONS` agrees
with the mutation markers, both ways, and its ratchet; and the four lane-map cases, untouched.

**Why retiring the third case is a gain and not only a deletion.** Its import walk had one target
left, `src/store/copy-artefacts.ts`, which the script's own comment called "a module nothing is
deleting". Every new test file that used `scratchArticleInPg` reached it, so the case asked each one
for a hand-written verdict in `STORE_MIGRATION` about a migration that finished a month ago. About
thirty such entries had been added since, most ending "Re-run witness 2 to confirm". Nothing asks
for one now. `docs/project/testing.md` § *What a brand-new test file owes the two registries* says
so.

**The files that named the instrument, one decision each:**

| file | what it was | what happened |
|---|---|---|
| `knip.jsonc` | an entry for the config | entry and comment removed |
| `tsconfig.json` | an `include` for the config | entry and comment removed |
| `tests/one-store-only.test.ts` | the config in its list of root files to scan | removed from the list; comment reworded |
| `tests/store-migration-registry.ts` | header links, four comments, eleven reason strings | header says the map is a closed record; names reworded to "the witness script" and "the witness JSON" |
| `tests/helpers/fixture-artefacts.ts` | a comment link | reworded |
| `evals/deepen/harness.ts`, `evals/deepen/run.ts` | comments saying the candidates script polices an import rule | reworded: nothing polices it now |
| `docs/project/static-analysis.md` | a sentence about the knip entry | removed |
| `docs/project/testing.md` | gate 3 of three | marked gone, with the reason |

**2. `scripts/migrate-fs-toc-to-hierarchy.ts` deleted (163 lines).** The link in
`docs/project/structure-step.md` became a sentence.

**3. `scripts/backfill-raw-manifests.ts` untouched**, as the review decided.

**4. The `{ kind: "off" }` arm of `ReaderPlan` deleted.** Every place a `ReaderPlan` is built in
`src/`, `scripts/`, `tools/`, `api/` and `evals/` is one of five `summary({ kind: … })` calls in
`src/billing/summary.ts`: `exempt`, `unknown`, `paid`, `lapsed`, `free`. The client does not build
one; `useBilling` casts the body and checks only `purchase`. `git log -S` shows the last server
constructor of `off` was removed by `1481e1969` (2026-09-05, "Stage F: the hinge"), so no deploy
since then has sent it, and a new client beside an old server, or the reverse, never meets the arm.
`BILLING_OFF` and `src/billing/config.ts` do not exist; the comment naming them is corrected.

Removed: the arm and its comment, `describePlan`'s `case "off"` and its copy, the two `case "off"`
fall-throughs in `planTip` and `planExplainer`, one test case in `tests/billing-plan.test.ts`, and
the value from the lists in `tests/free-allowance-box.test.tsx` and `tests/plan-help-copy.test.ts`.
Comments corrected in `src/billing/summary.ts`, `src/web/FreeAllowance.tsx` and
`src/web/PricingPage.tsx`.

## Claims that turned out to be false, or incomplete

- **"Do not edit anything under `docs/plans/`."** Could not be kept in full.
  `tests/doc-links.test.ts` checks links in plan docs, and seven markdown links in two plans pointed
  at files deleted here. Each was turned from a link into the same text in backticks, which is how
  `260903f` already names `artifacts-fs.ts`. No other word in either plan changed. Files:
  `260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md` (6),
  `260831ak-rename-the-toc-step-to-hierarchy-everywhere.md` (1).
- **The list of files naming the instrument was short by one.** `docs/project/testing.md` described
  the retired gates by name without naming a deleted file, so no basename grep finds it.
- **Two more comments named the `off` arm**: `src/web/FreeAllowance.tsx` and
  `src/web/PricingPage.tsx`. Three tests built the arm, not one.
- **"About 1,170 lines"** for the instrument: it is 2,245 with the JSON.

Everything else in the brief held when re-run.

## What was left, and why

- **`STORE_MIGRATION` itself**, about 2,150 lines of `tests/store-migration-registry.ts`. It is now
  a closed record that only two cases read. Deleting it means deciding what happens to
  `STORE_CONVERSIONS` and to the thirty-odd test comments that cite an entry, which is a bigger call
  than this cluster's. Worth its own item.
- **The file is still called `store-migration-registry`** while what is live in it is the lane map.
  A rename touches `vitest.config.ts` and about twenty comments.
- **The source guard's missing-file exception was removed in review**, as recorded below.

## Review fixes, 2026-10-06

The missing-file exception in `tests/one-store-only.test.ts` predates this cluster
(`1481e1969`). Its remaining root files are required, so review added a regression that
first failed because a scan with a missing required file resolved successfully, then removed
the swallowed read error. The earlier example of `vite.config.ts` was wrong: an explicit
assertion already requires it. `vitest.config.ts` and `package.json` had no such assertion.

Two comments in `src/web/PricingPage.tsx` counted the deleted plan arm; their numerical wording
was removed. No reader-facing copy changed. All four surviving lane cases were mutated to
fail for their intended reasons (missing assignment, invalid exemption, wrong shared lane,
missing owner verdict), then restored. The retired import walk checked `STORE_MIGRATION`
membership, not lane routing; today's lane map and poisoned unit environment remain independent.

An injected `off` plan falls through the copy functions to `undefined`. The client validates
only `purchase`, so an unexpected plan kind could still reach rendering; this broader boundary
weakness is reported without changing `useBilling.ts`. No current producer or persisted
`ReaderPlan` supplies `off`, and billing responses are served with `private, no-store`.

## Review

[GPT Sol's code review](261006j-sixth-sweep-s1-code-review-sol.md) of `e6a1cf04d`
([the prompt](261006j-sixth-sweep-s1-code-review-prompt.md)). Verdict: **ship with these fixes
(applied)**. The fixes are Sol's; the section above is its own record of them.

- **C1, fixed by Sol.** `tests/one-store-only.test.ts` swallowed read errors, so a missing required
  root file escaped the scan. A regression was added and the catch removed.
- **C2, fixed by Sol.** Two comments in `src/web/PricingPage.tsx` still counted the removed plan arm.
- **C3, reported, not fixed.** `src/web/useBilling.ts` § `checkedSummary` accepts an unknown plan
  kind, and the copy functions then return `undefined`. No server sends one today. It goes to the
  umbrella's list.

## Proof the surviving checks can fail

- Removed `tests/candidates-route.test.ts` from `TEST_LANES`: the lane case went red and named the
  file. Put back.
- Added `{ kind: "off" }` back to the list in `tests/plan-help-copy.test.ts`: `npm run typecheck`
  failed with two TS2345 errors. Put back.

## Gates

- `npm run typecheck`: clean, all four projects.
- `npm run knip`: no "Unused files" section; 538 unused exports, the umbrella's figure.
- `npx vitest run` on `store-migration-registry`, `one-store-only`, `unit-lane-has-no-database`,
  `billing-plan`, `free-allowance-box`, `plan-help-copy`, `doc-links`, `deepen-eval`, `db-ssl`: pass.
- `npx biome lint` on the touched files: one info, pre-existing (a complexity note).

## Final grep counts

Files containing each name, whole tree, outside `docs/plans/`, `docs/postmortems/`,
`docs/investigations/`, `drizzle/`, and the ignored `node_modules/`, `dist/`, `data/`, `output/`:

| name | files |
|---|---:|
| `vitest.witness.config` | 0 |
| `store-migration-witness` | 0 |
| `store-migration-candidates` | 0 |
| `fs-store-witness-setup` | 0 |
| `fs-store-witness` | 0 |
| `migrate-fs-toc-to-hierarchy` | 0 |
| `BILLING_OFF` | 0 in source; 1 in `api-dist/vercel.js`, a build output made before this change |
