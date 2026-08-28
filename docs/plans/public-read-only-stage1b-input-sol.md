## 1. `arc` is already in; `diagram` stays out

`arc` is not a mode. It is part of [`PublicArticle`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public-types.ts:107), selected by the public reader and rendered by `buildArcColumn()` as the L0/coarsest granularity column in [`App.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1078). There is correctly no `arc` member in [`MODES`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/params.ts:232).

Therefore:

- `arc` is already public through `/api/public/article/:slug`.
- It needs no endpoint and no 1b work.
- It should not appear in `PublicArtefacts`; its absence means “no L0 column”, not a closed mode.

Keep `diagram` marked `owners-only`. Its default tree picture is free, but [`DiagramPanel`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:437) mounts both private, spending hooks. Splitting a safe sub-panel out of that large component is real work with little added value: visitors already have the same structure through the ToC and granularity zoom.

## 2. Four endpoints

Use:

```text
GET /api/public/glossary/:slug
GET /api/public/summary/:slug
GET /api/public/ideas/:slug
GET /api/public/tweets/:slug
```

Do not add an aggregate endpoint.

Four endpoints preserve mode-level loading, isolate failures and avoid returning a potentially large glossary whenever somebody opens Summary or Tweets. The public glossary will still be fetched on the main reading page because the prose needs it for term marking, but Summary and Ideas can remain mode-lazy and Tweets page-lazy.

The cost is:

- Four route-inventory entries, projections, loaders and test cases.
- Up to four round trips if somebody opens everything.
- Repeating the public-revision lookup and block-fingerprint read for each artefact.

That is preferable to unconditional overfetch while caching and rate limiting are deliberately absent.

## 3. Exact DTO allowlists

Use explicit public interfaces and field-by-field constructors. Do not implement these as internal types minus forbidden fields.

Each endpoint should return a discriminated result:

```ts
type PublicArtefactResult<T> =
  | { status: "ready"; data: T }
  | { status: "not-generated" };
```

The `data` shapes should be as follows.

### Glossary

```ts
interface PublicGlossaryData {
  glossary: {
    entries: Array<{
      id: string;
      name: string;
      kind:
        | "person"
        | "place"
        | "organization"
        | "event"
        | "work"
        | "concept"
        | "term"
        | "other";
      aliases: string[];
      senseHere?: string;
      background?: string;
      gloss?: string;
      detail?: string;
      url?: string;
      difficulty?: number;
      centrality?: number;
      fromOutside?: boolean;
      blocks: BlockId[];
    }>;
  };
  stale: boolean;
  outdated: boolean;
  personalised: boolean;
}
```

Keep the three superseded fields—`gloss`, `detail`, `fromOutside`—because [`GlossaryEntry`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:234) still reads and renders old artefacts.

Do not include:

```text
version, generator, slug, sourceHash, profileHash,
passes, generatedAt, elapsedMs, profileChanged,
entry.lookup
```

Glossary IDs must cross. They provide:

- Stable `?term=` links.
- Prose-to-entry selection.
- Entry-to-block navigation.
- Stable UI identity across inherited glossary entries.

Removing them would force the client to invent an unstable identity. Carrying an ID does not carry its lookup: `glossary_lookups` remains unreachable.

### Summary

```ts
interface PublicSummaryData {
  summaries: {
    entries: Array<{
      range: [BlockId, BlockId];
      depth: number;
      short?: string;
      long?: string;
    }>;
    missing: number;
  };
  stale: boolean;
  personalised: boolean;
}
```

Do not include:

```text
version, generator, slug, sourceHash, profileHash,
guidance, generatedAt, elapsedMs, profileChanged
```

`missing` should cross. It is the reader’s only indication that an apparently complete summary is partial.

The summary text is necessarily derived from `guidance`. Dropping the raw field prevents direct disclosure, but it cannot make the generated text neutral: a model may follow, paraphrase or even echo the steer. Stage 1’s settled decision is to publish the selected artefact. If the stronger requirement were “nothing influenced by guidance may cross”, steered summaries would have to be withheld or regenerated; a DTO cannot provide that guarantee.

### Ideas

```ts
interface PublicIdeasData {
  ideas: {
    ideas: Array<{
      id: string;
      name: string;
      provenance: "assumed" | "introduced";
      statement: string;
      whyYouNeedIt?: string;
      analogy?: string;
      occurrences: Array<{
        blockId: BlockId;
        quote: string;
        reasoning: string;
        start?: number;
      }>;
    }>;
  };
  stale: boolean;
  outdated: boolean;
  personalised: boolean;
}
```

Do not include:

```text
version, generator, slug, sourceHash, profileHash,
generatedAt, elapsedMs, profileChanged
```

Keep both IDs and all occurrence anchors. Without them, the public panel becomes detached prose rather than something that can take the visitor back to the article.

### Tweets

```ts
interface PublicTweetsData {
  thread: {
    limit: number;
    tweets: Array<{
      text: string;
      chars: number;
    }>;
  };
  stale: boolean;
  personalised: boolean;
}
```

Do not include:

```text
version, generator, slug, sourceHash, profileHash,
generatedAt, elapsedMs, profileChanged
```

`limit` and `chars` should cross because they explain over-limit posts without the client recomputing a different count.

### Corrections to the plan table

The table missed:

- Glossary `version`, `generator` and `sourceHash` among the excluded fields.
- Summary `missing`.
- Tweets `limit` and `chars`.
- All the safe nested identity and navigation fields above.
- The legacy glossary fields that still exist.

None of the table’s forbidden names has disappeared. The qualification is that `profileChanged` is not stored inside an artefact: the owned response computes it through `withProfileChanged()`.

### Profile provenance

Drop `profileHash` and `profileChanged`. Add `personalised: boolean`, computed exactly as the owner metadata does:

```ts
artefact.profileHash != null
```

Render it as a provenance warning whose copy lives in `src/messages.ts`, for example “Generated with a reader profile.”

That helps a visitor weigh summaries, glossary selection and especially “assumed” ideas. It reveals neither the profile, its hash, its owner nor its contents. It reveals only that some reader profile influenced the already-published result. That epistemic value is worth the small disclosure.

## 4. No child-table expansion

Correct: 1b needs no additional table.

The artefacts themselves come from `article_revisions`. Freshness may additionally read `revision_blocks`; Ideas also needs the revision’s `tree`. Those are already inside the four-table public allowlist.

The dangerous temptation is [`loadGlossary()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1421). It joins `glossary_lookups` and attaches each owner lookup to its entry. Do not reuse it. Likewise, do not reuse `withProfileChanged()`, which reaches reader-profile state.

Build public reader methods through the existing hardwired `publicCurrentRevisionQuery()`. Do not turn that into a generic “predicate parameter” helper.

Freshness code needs pure leaves:

- Put the Ideas blocks-plus-tree fingerprint in an import-free module rather than importing `ideas.ts`.
- Put current artefact versions in an import-free constants module, with writer modules re-exporting them, if public `outdated` verdicts are retained.

The positive control for the table guard remains concrete: add a `glossaryLookups` import, raw SQL reference, or `getDb().query.glossaryLookups` call to `public-reader.ts`; each spelling must make `public-imports.test.ts` fail.

## 5. Use a tagged 200 for “not generated”

Use:

```json
{ "status": "not-generated" }
```

with HTTP 200 when the article remains public but that revision column is `null`.

Use the ordinary closed-room 404 only when `publicSlug(slug)` finds no readable public article: nonexistent, private, revoked or otherwise unavailable.

This preserves two distinct facts without weakening non-enumeration:

- “This public article currently has no glossary.”
- “This public URL cannot be read.”

The client behavior should be:

- Metadata says false: make no artefact request; render `notBuiltYet(...)`.
- Metadata says true, endpoint returns `not-generated`: render the same `notBuiltYet(...)`.
- Endpoint returns 404/500 or fetching fails: render `availabilityUnknown(...)`, never “nobody built it”.
- Present object with an empty array: render a ready-but-empty artefact. Do not turn it into `not-generated`.
- Malformed present JSON: unavailable/error, not an empty artefact.

After 1b, metadata is only an optimization. If metadata is unavailable, the public modes should remain pressable and attempt their endpoint.

## 6. Client seam and regression proofs

Extend the capability with a genuinely public glossary read:

```ts
type PublicArtefactRead<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "not-generated" }
  | { state: "unavailable" };

type ReaderCapability =
  | {
      kind: "owner";
      comments: CommentsApi;
      chatAnchors: ChatAnchorsApi;
      glossary: GlossaryRead;
    }
  | {
      kind: "visitor";
      available: PublicArtefacts | null;
      signedIn: boolean;
      glossary: PublicArtefactRead<PublicGlossaryData>;
    };
```

The visitor glossary has data and status only. It has no:

```text
job, refresh, clear, patch, lookup, find-more, reset,
looking, hasProfile, profileChanged
```

A public `?term=` still selects an existing entry; “no lookup” means no web-check action.

Use separate hook-owning components:

```text
OwnedReader
  useGlossaryRead, comments, chat anchors

VisitorReader
  usePublicGlossaryRead only

OwnedSummaryBand / PublicSummaryBand
OwnedGlossaryBand / PublicGlossaryBand
OwnedIdeasBand / PublicIdeasBand
OwnedTweetsPage / PublicTweetsPage
```

Extract shared render-only bodies where useful. Do not manufacture internal artefacts with dummy private fields or pass visitor capability into an owned shell.

The public glossary hook belongs in `VisitorReader` because term markings are article-wide. Public Summary and Ideas hooks belong inside their visitor bands so they mount only when opened. Tweets remains page-local.

The acceptance proof needs both network and rendered-state assertions:

| Assertion | Mutation that must make it red |
|---|---|
| Each visitor mode requests only its expected `/api/public/...` GET; no POST and no `/api/jobs`. | Replace its public band with the owned band. Open that exact mode; `/api/jobs` or the private artefact route must appear. |
| A unique canary from the public response appears, and the visitor-gap body does not. | Replace the public band with `VisitorBand`. The network trace may remain clean, but the canary disappears. |
| Owner-only controls are absent. | Wrap the public DTO in the owner shell or render its regenerate/lookup control. The visitor assertion fails; the owner fixture proves the control is real. |
| Known-false metadata makes no artefact request; known-true makes exactly one. | Remove the false short-circuit. The false case issues a request. Remove the loader. The true case issues none. |
| `not-generated` and failed fetch render different sentences. | Map both states to `not-built`; the failed-fetch case must fail. |
| Every public loader uses `credentials: "omit"`. | Change one loader to bare `fetch(...)`; its loader test must fail on `credentials === undefined`. |

This directly guards the failure 1a exposed: a clean trace with the wrong component mounted.

## 7. Delete `not-yet-public`—after the final vertical slice

Once all four endpoints are live, nothing uses that cause:

- `arc` is already public.
- `diagram`, Search, Chat and Review are `owners-only`.
- Comments are `readers-own`.
- Missing artefacts are `not-built`.
- Failed reads are `availability-unknown`.

Delete:

- The `not-yet-public` union member.
- Its message.
- Its `FIXED_BY_AN_ACCOUNT` entry.
- Its rendering branch.

During incremental 1b deployments, keep it for artefacts whose vertical slice has not landed yet.

The final visitor-gap tests should assert policy, not member count:

- ToC is always available.
- For each public artefact mode: known true and metadata unknown return `null`; known false returns `not-built`.
- Cost modes always return `owners-only`.
- Comments remain `readers-own`.
- Tweets follows the same true/unknown/false matrix.
- `markedModes()` excludes available public artefacts and includes known-missing ones.
- Only knowing states make claims about existence.

Specific red controls:

- Change Summary’s flag key to `ideas`; the one-hot fixture fails.
- Revert metadata-null to `availability-unknown`; the unknown-is-reachable case fails.
- Make an available artefact return a gap; the `markedModes()` case fails.
- Give two causes the same sentence; the sentence-distinction case fails.

An exhaustive `Record<Mode, Policy>` would be stronger than the current partial maps plus fallback: adding a new mode then creates a compile error requiring an explicit public policy.

## 8. Four vertical slices

Treat 1b as four independently deployable slices:

1. **Summary.** Establishes the tagged wire result, public hook, visitor band and missing/error distinction with the simplest artefact.
2. **Glossary.** Adds the article-wide public read, stable term IDs, underlines and deep links while stripping lookups.
3. **Ideas.** Adds occurrence anchors, passage navigation and public provenance rendering.
4. **Tweets.** Replaces the separate page’s stand-in and then removes `not-yet-public`.

Each cut includes its server projection, public reader method, client rendering and tests. Do not build all four server DTOs first.

## 9. Likely bites

- **Freshness imports.** Importing `glossary.ts`, `summarise.ts`, `ideas.ts` or `tweets.ts` from the public reader pulls in writer/model code. Extract fingerprints and version constants into pure leaves. Positive control: import a writer from `src/public/`; the closed import test must fail.

- **Null versus empty.** SQL `NULL` means `not-generated`; `{ entries: [] }`, `{ ideas: [] }` and `{ tweets: [] }` are ready artefacts. Positive control: replace the null check with a truthiness/length check; the empty-ready fixture must fail.

- **DTO drift.** Querying a JSONB column necessarily reads its whole stored object. The DTO constructor is therefore the security boundary. Test deep exact keys over deliberately over-full fixtures. Positive control: spread an internal glossary entry or add `guidance`; the test must fail. A separate positive-content assertion prevents `{}` from passing as “safe”.

- **Predicate drift.** Exercise every new endpoint against the real Postgres visibility fixture. Positive control: replace one method’s `publicSlug(slug)` with a slug-only predicate; that endpoint must expose the private fixture and fail.

- **Glossary size.** Four endpoints prevent unrelated overfetch, but the main reading page still downloads the glossary for term markings. Do not silently truncate or cap it. If Vercel limits become a problem, return an explicit unavailable state; partial vocabulary would silently change the article.

- **HEAD.** Add each route through `PUBLIC_ROUTE_NAMES` so the existing GET/HEAD and method sweeps cover it. Do not create separate HEAD logic. Positive control: make the read-method gate accept GET only; the per-route HEAD sweep must fail.

- **`%2F`.** Reuse the existing route builder, namespace dispatch and slug parser. Do not decode the whole pathname or invent an artefact-specific regex. The passing `%2F` case should automatically cover all new inventory entries. Positive control: decode the pathname before namespace dispatch; the existing encoded-slash case must fail.

- **`Vary`.** Do not add `Vary: Authorization`. Public responses deliberately ignore authorization and clients omit credentials; there is only one representation. Keep `Cache-Control: no-store`.

- **Store parity.** Do not add a filesystem public implementation or default an unknown filesystem visibility to private. Public access remains the Postgres public reader. Share only pure DTO/fingerprint helpers with owned code.

- **Error copy.** Never display the public endpoint’s raw error body. Map typed states to strings in `src/messages.ts`.

No code or files were changed.