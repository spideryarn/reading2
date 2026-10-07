# 261006g stage 1 — code review and fixes

Reviewed candidate `480d208a8` independently, including the dispatcher, store scrubber, adapters,
offline cache, three hooks and Quiz counts. Stage 2 is unchanged. No Git mutation was run.

## Findings

- **F1 — P1 — fixed.** `src/web/useQuiz.ts:446`, `src/web/useCitations.ts:326`.
  The new `!loaded` branch accepted `false`, `0` and `""` as the exact `null` sentinel.
  On opening it reported legitimate absence; on revalidation it discarded a usable artefact.
  Citations also published truthy malformed envelopes such as `{}` or `{ citations: null }`;
  that unchecked publication predates this stage. Both hooks now compare strictly with `null`
  and check the artefact container and collection before publishing. Failed revalidation keeps
  the earlier body and exposes the error. This is basic envelope validation, not a full schema
  validator for every nested item.

  Red: `npx vitest run tests/none-yet-is-not-a-404-hooks.test.tsx` reported
  `Tests 16 failed | 18 passed (34)` before the fix: twelve falsy-sentinel cases and four
  inherited Citations cases. Green: the four requested suites reported
  `Test Files 4 passed (4)` / `Tests 195 passed (195)` after the hook fix.
  [Root cause and history](../postmortems/261006k-a-null-sentinel-is-widened-by-a-truthiness-check.md).

- **F2 — P2 — fixed.** `docs/project/web-client.md:661`, plan Stage 1 scope paragraph.
  Both claimed that other artefacts read only when their modes open. `OwnedReader` unconditionally
  reads Glossary and Quotes (`src/web/article/ArticlePage.tsx:610`, `:624`); Marginalia mounts Ideas,
  FAQ, Timeline and Debate reads (`src/web/marginalia/MarginaliaColumn.tsx:722`). Corrected the
  scope claim in both docs. Changing those other endpoints is outside this stage and was not done.

  A temporary Node assertion checked the mode-only claim against the owner-view mounts:
  red, exit 1, `AssertionError: docs/project/web-client.md: mode-only claim contradicts the mounts`;
  green, exit 0, `PASS: doc scope agrees with the owner-view mounts`. Doc-links also passed all
  16 tests after the final correction. The Quiz doc paragraph agrees with the code.

## Request trace

`handleApi` opens the request scope; `requireUser` verifies the bearer token inside the API's
single catch; the authenticated dispatcher carries that owner's identity into the store.
`article: "first-capture"` is spend attribution, **not an article-existence or ownership guard**.
Those guarantees come from the loader's `currentRevisionQuery` / `ownedSlug` SQL predicate.

| Outcome | Without header | With header |
|---|---|---|
| Made artefact | 200 object | Same 200 object |
| Existing owned article, artefact absent | 404 error object | 200, JSON `null` |
| Unknown slug | 404 error object | Same 404 |
| Another reader's article, even if shared publicly | Owner-scoped 404 | Same 404 |
| Store fault inside load | Its error response, normally 500/503 | Same error response |
| Quiz kept-answer read fails | 200 quiz object with `attempts: null` | Same |
| Citations matching read fails | 200 list without matching attachments | Same |

`guardDbStore` preserves status-bearing domain errors, including both `ArtefactNotMadeYet` and
its citations subclass, so `instanceof` still works. Other store exceptions are scrubbed and
rethrow; the absence catch does not translate them. Quiz's profile read is inside
`withProfileChanged`: a successful artefact followed by an ordinary profile failure remains 500.
The answer-history and citations-matching calls are outside the absence catch and have their
own existing degradation policies. Exceptions from subsequent transformations still reach the
API catch; they cannot turn the whole answer into `null`.

The helper sets `private, no-store` before loading. The API catch's `send` sets status, JSON content
type and body, without clearing or replacing that cache header. This holds for loader 404s and
500s, as the injected-outcome dispatcher suite verifies. An authentication rejection precedes
the helper and does not get this helper's cache policy.

`send(res, 200, null)` writes `JSON.stringify(null)`, exactly four bytes, with
`Content-Type: application/json`. The dev middleware and Vercel source adapter forward the same
response object and return when handled. No repository middleware rewrites/compresses this body.
The dispatcher tests observe the bytes and content type; a real socket, platform compression and
deployed proxy behavior were not exercised in this sandbox.

## Client and cache trace

Quiz and Citations: 200 null and 404 both clear the artefact and stale/profile facts as applicable,
clear errors, and enter `none`. A proper object enters `ready`; malformed tested envelopes now
fail the opening read or retain a ready body on revalidation with an error. Crossrefs draws no
links for null, 404, a malformed envelope, a stale artefact or the wrong slug; a fresh valid object
draws its response links. Its silent error behavior is unchanged.

Offline with a saved real copy, `apiFetch` replays a synthetic JSON 200 with
`x-spideryarn-offline: copy`; the hooks consume the ordinary object. Without a copy the transport
error propagates: Quiz/Citations expose an opening error, or retain earlier ready state on a
failed revalidation; Crossrefs draws no links. The added cache tests exercise all three URLs
through an opted-in null followed by an old-tab request offline, and the no-copy failure.

Only the outer response `null` is skipped by `saving`; `attempts: null` is still an object and
uses Quiz's separate existing policy for incomplete answer-history reads. These handlers have no
other source path that returns a successful outer null. JSON parse failure rejects instead of
inventing null; an empty success body becomes `{}` in `readJson`, which the fixed hooks reject.
Current callers all use relative URLs ending at the encoded slug, with no query. `apiFetch`
rejects absolute URLs. A future query-bearing caller would bypass the anchored null exclusion;
there is no such caller in this stage, so no generalized URL change was made.

`apiFetch` preserves the header using `Headers(init.headers)`, also on its authentication retry.
All three requests are same-origin, so the custom header adds no CORS preflight. No service-worker
registration was found. External proxy stripping remains a deployed/browser verification matter.

## Quiz counts

The (i) card counts the entire artefact's questions. The walk's position and total are indices
among `includedAt`; `hiddenCount` is the whole length minus that included length. The explanation
therefore remains correct on the second or later included question. Show all lists only included
questions, so selecting from it preserves the filter and its count. An arrival from the prose
that names an excluded question turns the filter off, restoring the whole total and removing
the hidden-count sentence. Added assertions verify both a later included question and an unread
prose arrival. The doc's list-open/list-closed and whole-batch wording matches this behavior.

## Mutation evidence and checks

All temporary mutations were restored by editing the files back:

| Mutation | Tests that noticed |
|---|---|
| Remove Quiz's opt-in header | 2 hook failures |
| Allow caching the outer null | 3 offline-cache failures |
| Remove the hidden-count explanation | 3 Quiz-panel failures |
| Catch every status-404 error instead of the typed absence | 3 dispatcher-boundary failures |
| Remove the helper's cache policy | 21 dispatcher-boundary failures |

The new `tests/none-yet-catch-boundary.test.ts` drives the real dispatcher and real
`guardDbStore` with injected store outcomes. Its 27 cases pass; it does not substitute for the
real Postgres route suite. No final route or store code changed.

Final local command:

```sh
npx vitest run tests/none-yet-is-not-a-404-hooks.test.tsx tests/api-fetch-offline.test.ts tests/quiz-panel.test.tsx tests/xref-prose.test.tsx tests/none-yet-catch-boundary.test.ts tests/quiz-kept-answers.test.tsx tests/quiz-regenerate-revalidation.test.tsx tests/citations-find-late-reply.test.tsx tests/crossrefs-revalidate.test.tsx tests/doc-links.test.ts
```

Result: exit 0, **10 files / 299 tests passed**. The separate final doc-links rerun also passes.
`npm run typecheck` was blocked by `tsx` trying to listen on an IPC socket (`EPERM`).
`node --import tsx scripts/typecheck.ts` passed all four projects and source-coverage checks.
Targeted Biome lint passed on all six changed code/test files. `git diff --check` passed.

The supplied 701-test Postgres result belongs to the candidate commit, not a run made here.
The full database-dependent suite and real browser checks remain external. Stage 2, commits,
the index and branches are unchanged.

VERDICT: land it with my fixes
