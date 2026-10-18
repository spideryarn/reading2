# A guard that lives in a suite the change never touched

On 2026-10-18 the readiness loop ran the full suite on `c1d9a5a6`, the end of the Sources work
(plan 261017h, notes on cited works), and four files failed deterministically. That revision could
not pass the ordinary deploy test gate until they were fixed. One of the four was a security defence.
The local readiness record `001792295326361-39806096e0e3` records that clean revision and those
four failures; the run took about 81 minutes.

| File | What broke | Fix |
| --- | --- | --- |
| `tests/public-imports.test.ts` | A visitor's import graph reached `src/ai-call.ts`, `src/owner.ts`, `src/fetch.ts` and five more forbidden modules | Cut the import: the pure identifier code moved to a leaf, `src/work-id.ts` |
| `tests/messages.test.ts` | `[jb-no-bibliography]` had no row in `CODE_KINDS`, so it read back as no kind and offered a Retry that could not work | The row, `blocked` |
| `tests/cacheable-covers-artefact-routes.test.ts` | `citation-blurbs` is an artefact kind with no route of its own | Listed in `ROUTELESS_KINDS`: the notes reach a reader on the Bibliography's rows |
| `tests/command-pick-catalogue.test.ts` | The generated catalogue lacked the new *Notes on cited works › Run again* row | Regenerated |

`tests/matter.test.ts` also failed typecheck on the same dev, from another session (261018a); it
was a one-line test annotation and its fix is included in this worktree.

## The security one, specifically

`src/public/dto.ts` began importing `shownBlurb` from `src/citation-blurbs-identity.ts` in
`c288a99ff` (*261017h stage 3c*). That module was written as "the pure half" of the step, so that a
read could use it "without importing a model call", and its own functions are pure. But it took
`parseWorkId` from `src/bibliographic.ts` and `evidenceUrl` with `REGISTRY_NEGATIVE_TTL_MS` from
`src/citation-evidence.ts`, and those are the registry client and the evidence gatherer. Their
imports go on to `fetch.ts`, `citation-lookup.ts → models.ts → embeddings.ts → ai-call.ts`, and
`cited-in-spideryarn.ts → bibliography.ts → messages-stream.ts → ai-spend.ts → owner.ts`.

Nothing in the visitors' code path *called* a paid function, and the runtime gateway spy in
`tests/public-visibility-pg.test.ts` is the half that watches for that. What broke is the static
half, whose job is that a stranger's door cannot reach such a module, so no later edit can call one
by mistake. The cached `origin/main` at review time (`914965eda`) does not contain `c288a99ff`;
that is evidence about the recorded production branch, not a live deployment check. The ordinary
deploy test gate rejects this revision; an older green revision remains deployable with `--ready`
([deployment.md](../project/deployment.md#deploying-a-commit-already-known-green)).

**The fix shipped is also the long-term fix.** The identifier (`WorkId`, `parseWorkId`, `doiFor`),
the address parser (`identityOf`, `DOI_SHAPE`, `ARXIV_ID_SHAPE`), the address builder
(`evidenceUrl`) and the TTL now live in `src/work-id.ts`. It imports only `doi-url.ts` and
`paper-sources.ts`, which are pure strings too. `bibliographic.ts`, `cited-in-spideryarn.ts` and
`citation-evidence.ts` re-export the names they used to own. The test and its
`FORBIDDEN` list are unchanged.

Review caught **API surface drift hidden by a migrated test**: the definitions moved intact, but
four legacy exports were dropped, and moving the TTL test's import hid one removal. The red-first
`tests/work-id.test.ts` checks the original import paths against the leaf; the re-exports now
preserve them.

## The root cause

The session's gates, as its code-review commit message (`b1f486d33`) says, were: *"typecheck clean;
citation-evidence, citation-blurbs (unit and both PG), privacy-page and doc-links, 114 tests
passed."* Every one of those was a suite the work touched, and every one was green.

All four failing files are **guards**: tests that hold one fact true across the whole tree. They
are the import graph from the public entry points, the code table against every message, the
artefact kinds against the routes, and the catalogue against the command bar. A guard sits in a file
of its own, by design, away from the code it constrains. So a change that breaks one never edits
it. A gate defined as "the suites you touched" runs every test *except* the ones whose purpose is to
catch what you did not think to check.

CLAUDE.md says both things. "Run `npm test` and `npm run typecheck` when you finish a change" is
one rule; "commit on the fast gates (typecheck, the suites you touched, doc-links)" is another. The
second is easier to follow at 3am, and on any change that adds a code, a kind, an import or a
command, it is the wrong one.

## The class

**A far guard**: an invariant whose test lives in a file the change does not touch, so a gate
scoped to touched files can never fail on it. It is the same shape as
[silent-success.md](../reusable/silent-success.md), seen from the gate's side. Every check that ran
was green, and none of them was a check of the thing that was broken.

## What would have caught it, ranked by ease against value

1. **Run the guards at every commit, by name.** All four are static or unit tests, and together
   they run in about 15 seconds:
   `npx vitest run tests/public-imports.test.ts tests/messages.test.ts tests/cacheable-covers-artefact-routes.test.ts tests/command-pick-catalogue.test.ts`.
   The cheapest fix would be to add them to the fast gates in CLAUDE.md as "the suites you touched,
   *plus the guards*". That is a rule doc, so it is proposed here for Greg rather than made.
2. **Run a full `npm test` before pushing**, which CLAUDE.md already asks for. It costs minutes, not
   seconds, and it is the rule that was skipped, so restating it alone is not a fix.
3. **A pre-push hook that runs the guard set.** Rejected for now. Pushes to `dev` happen from many
   worktrees and machines, a hook is per-clone and easy to bypass, and readiness already catches
   these failures, though this run took about 81 minutes. The demonstrated cost was a red dev
   revision held out by the ordinary deploy gate, not evidence of a leak.
