# Narrow final review: race stage/postmortem and new audit evidence

Reviewed the following working-tree documents against baseline
`4adcdfd62703b6565a27a03c50f20f8a215f1bd8`:

- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md`, section A (and the newly
  requested section D wording only)
- `docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md`
- `docs/postmortems/260908d-build-only-config-work-runs-during-static-analysis.md`
- `docs/plans/260908f-prioritised-spideryarn-codebase-improvements-evidence.md`

## Verdict

**Section A and its postmortem have the right root cause, reachable UI census, client-only impact,
history and preferred product shape. They still need three small clarifications before an
implementation agent follows them.** The main safety invariant is present: a timeout must make the
old GET unable to commit before it enables a write, and a suppressed opening GET must not discard
pre-existing row A.

**The new Knip postmortem, section D and evidence interpretation contain a material factual error.**
Their own captured output proves Knip continued into unused-file/export/dependency analysis after
the Vite-config load error. The degraded analysis boundary is real, but “exits/aborted before
analysis” is false. The postmortem also gives a nonexistent 41-character commit id.

## Findings to correct

### 1. Knip did not abort before analysis (material factual error)

- Plan D says “`npm run knip` exits before analysis” at plan lines 290–292.
- The Knip postmortem says it “never reaches unused-file/export/dependency analysis” at lines 10–15
  and calls this “its abort” at lines 39–42.
- The evidence interpretation repeats “Knip aborted before analysis” at evidence lines 444–448.
- But the captured output immediately continues from the config error into `Unused files (13)` at
  evidence lines 17–22, then reports unlisted dependencies/binaries, unresolved imports, unused
  exports/types and duplicate exports through line 376.

The defensible statement is narrower: Knip reports an error while evaluating
`vite.api.config.ts`, continues to produce findings, and exits nonzero; the error can make the
Vite/API-derived graph incomplete, so those findings are not yet safe deletion evidence. Plan D’s
missing/stale-dist experiment and positive unused-module witness remain useful, but their expected
result should be “no config-load error and complete intended graph coverage,” not “analysis now
runs for the first time.” A completed advisory run may still exit nonzero because it found issues,
as section D already correctly says.

### 2. The later diagnostic commit id is malformed (factual error)

The Knip postmortem line 34 names
`453f37845205f3a37017ff555fdef2890083791d8`, which Git cannot resolve and is 41 characters. The
actual commit is `453f37845205f3a37017ff555fdef2890083791d` (“The gate that could never pass, the
promotion nobody made, and 36 citations of a deleted file,” 2026-09-03). Its diff only improves the
missing/stale-shell diagnostic, so the surrounding conclusion is correct.

### 3. The alleged explicit product choice is not recorded (process/factual mismatch)

The review brief says Greg explicitly selected the mounted/editable composer plus gated action.
The documents still describe it as a recommendation awaiting his decision:

- plan lines 166–174: “recommend,” “Show Greg,” “if selected”;
- race postmortem lines 57–61: “recommends” and “Greg should see ... before implementation.”

If Greg has selected it, record that decision directly and make the submit-gate stage unconditional.
If he has not, the current language is honest, but the implementation is intentionally blocked on
the product choice. Do not let an implementer infer authorization from the review brief.

### 4. State the timeout/retry ordering as a state transition (implementation safety)

The plan correctly requires abort/invalidation before enabling actions (plan lines 183–185), but
“inspect the existing API timeout” is easy to misread. There is no response deadline in `apiFetch`:
the actual `fetch` at `src/web/lib/api.ts:423–430` has no timeout. `SESSION_DEADLINE_MS` at
`src/web/lib/api.ts:1038–1047` only bounds the wait for an auth credential.

Pin the required transition:

1. abort the opening fetch or invalidate its commit generation;
2. only after that, mark opening load settled/failed (`loaded=true`, retaining the load error);
3. only then enable Run/Find/Save.

The timeout regression should hold GET A past the deadline, let the timeout settle, successfully
create B through the mounted UI, then release the old GET and require B remains. This proves the
deadline is an ordering fence rather than just a visual timeout.

The current UI’s error copy asks for a page reload (`SearchPanel.tsx:715–718` and
`Dock.tsx:3320–3323`); there is no in-place retry of these opening list reads. If this stage adds an
in-place load retry, it must gate writes again until that retry settles or reconcile it with later
writes. Otherwise retry recreates the same old-snapshot/new-write race.

### 5. Do not implement hook-level refusal as a silent no-op (implementation safety)

Plan line 182 says client state methods should not bypass readiness. The mounted handler and button
must both enforce the gate, as the preceding sentence says. If defence is also added inside the
hooks, it cannot silently refuse while preserving today’s return type:

- `SearchApi.ask` promises a minted id at `src/web/useSearch.ts:89–91` and returns it at 395–400;
  `SearchMode` immediately installs that id in active URL state at
  `src/web/modes/search/SearchMode.tsx:108–117`.
- `CriteriaApi.ask` has the same contract at `src/web/useCriteria.ts:50–51` and 287–292;
  `CriteriaPanel` immediately passes the returned id to `onShow` at line 380.

A silent guarded `ask` would therefore activate an id for a row that was never created. The
smallest selected fix is to gate the real event handlers/readiness predicates. If hook-level
defence is desired, change its type to represent refusal and update callers deliberately.

## Findings that are sound

- All three listed races are reachable through mounted owner UI. The excluded ordinary
  new-comment legacy stream is correctly classified as false; free annotation create is the real
  Comments path.
- The loss is browser state only after a successful server write; reload restores the persisted
  row.
- `useOrderedRead` orders reads only. It is not a drop-in repair for writes, and invalidating the
  sole opening GET alone can leave B while permanently hiding pre-existing A.
- The named race class and introducing commits resolve and match the feature history:
  `3060972aa...` / `5fc174317...` for Comments, `cb1f269d...` for Search and `b9f1d2a5...` for
  Criteria.
- The mounted A+B red witnesses, non-StrictMode first reproduction, failure cases, tombstone/remint
  checks and later StrictMode regression are discriminating tests rather than implementation
  mirrors.
- The Knip root-cause class is still accurate: eager evaluation of a required build artifact at a
  static-analysis config boundary. Preserving the API-build stale-shell guard while making source
  inspection independent is the right constraint. The introducing commit `f1f381282...` is valid.
- The evidence note is otherwise candid about sandbox-blocked checks and does not claim the whole
  suite passed. Its `Baseline` label would be more reproducible if it said the command ran at that
  HEAD in a dirty shared working tree: the logged `.tmp-smoke.mts` finding is currently untracked,
  so the output is not from a clean checkout of the named commit.



## Author's landing record

The plan, evidence and review artifacts were committed together in
`2d12f5fda18b284e27238ec280b294503d3db0d4`. This identifies the resulting candidate,
including author corrections after review; it does not imply this reviewer independently
checked every final byte. The plan's review ledger records the findings and their disposition.
