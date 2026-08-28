1. **The server/client cut is safe as a deployment sequence, but wrong as two independently shippable product slices.** The proposed 1a exposes publishing without the confirmation UI and gives the user no usable shared link. It is infrastructure, not a feature.

   I would cut vertically:

   - **1a — core sharing:** migration and audit log; visibility endpoint; public `article` and `metadata` endpoints; the owner/public client fetch; enough capability separation to render prose, ToC and zoom without private hooks; read-only bar; sharing card; network-trace test.
   - **1b — generated artefacts:** public tweets, glossary, summaries and ideas endpoints; their DTOs; unavailable/generated states and marked controls.

   That makes 1a genuinely useful: send a link and read the article. It also lets each endpoint land with its projection and tests. Do not land six DTOs behind an unused namespace merely for symmetry.

   If you retain the horizontal split, it is technically safe only if publishing requires explicit rights confirmation in the request and all rows default private. I would still call it a dark deployment, not a shippable slice.

2. **Use a branded, runtime-verifiable `VerifiedUser`, not merely a required `AuthedUser`.** A required parameter prevents omission but accepts any `{ id, email }` object. That does not encode “came from `requireUser`.”

   In [auth.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/auth.ts:59), have `requireUser()` return a branded object whose private symbol is added only after verification:

   ```ts
   export type VerifiedUser = AuthedUser & {
     readonly [VERIFIED_USER]: true;
   };
   ```

   Also export `assertVerifiedUser(value)` so the boundary fails at runtime when JavaScript or `as never` bypasses the type.

   Keep the shared envelope in [routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3016):

   ```ts
   interface ApiRequest {
     req: IncomingMessage;
     res: ServerResponse;
     url: string;
     path: string;
     method: string;
   }

   async function serveAuthenticatedApi(
     user: VerifiedUser,
     request: ApiRequest,
   ): Promise<void> {
     assertVerifiedUser(user);
     setRequestOwner(user.id);

     // Existing regex declarations and if chain, mechanically moved here.
   }
   ```

   `serveApi()` should retain the prefix check, clock, one `try`, one `catch`, one `finally`, and become:

   ```ts
   try {
     if (isPublicNamespace(path)) {
       res.setHeader("Cache-Control", "no-store");
       await servePublicApi(request);
       return true;
     }

     const user = await requireUser(req, verify);
     await serveAuthenticatedApi(user, request);
     return true;
   } catch (err) {
     // Existing catch unchanged.
   } finally {
     // Existing request log unchanged.
   }
   ```

   Move the authenticated regex declarations and branch chain into the authenticated function without redesigning them into a route table. That is a large textual move but a minimal behavioural change. Leaving the branches as a closure passed into a wrapper would be cosmetic.

   The test should prove three things:

   - An ordinary `AuthedUser` is not assignable to `VerifiedUser` using `@ts-expect-error`.
   - `serveAuthenticatedApi(undefined as never, request)` throws before any handler/store spy runs.
   - A `VerifiedUser` obtained through `requireUser(req, testVerifier)` reaches a positive-control route.

   Keep the existing anonymous `/api/library` integration test too. The type test proves the capability; the integration test proves production control flow still uses it.

3. **Do not split `src/api.ts` first. Build a separate Postgres public reader.** Splitting [api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:145) would turn this feature into a broad filesystem/read/write refactor, while [pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1089) already contains the deployed read implementation.

   I would use:

   - `src/public/routes.ts` — closed public dispatcher.
   - `src/public/dto.ts` — explicit allowlist projections.
   - `src/public-types.ts` — pure client/server wire types.
   - `src/store/public-reader.ts` — hardwired Postgres public reads.
   - `src/store/public-slug.ts` — visibility predicate.

   Do not create one kitchen-sink `src/public.ts`.

   Some duplication is desirable here because the policies differ. In particular, public article mapping must not call `titleFor()`, public blocks must not select `note`, and public glossary reads must never join `glossary_lookups`—which the owner reader deliberately does at [pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1367).

   Keep it honest with two checks:

   - A transitive-import test, modelled on `tests/client-imports.test.ts`, starting at `src/public/routes.ts`. It must not reach `src/api.ts`, `src/store/index.ts`, `src/store/pg.ts`, writer modules, or any AI/gateway root.
   - A runtime gateway spy over every public endpoint asserting zero calls.

   Share only pure transformations that are literally identical. If public staleness needs logic currently embedded in a writer module, extract that small pure calculation; do not import the writer.

4. **Put `publicSlug()` in its own `src/store/public-slug.ts`. Do not rename `owned-slug.ts`.** Renaming creates a repo-wide hunt for no functional gain. More importantly, putting both predicates together would make the public leaf import `currentOwnerId`, which is exactly the dependency public reads should lack.

   ```ts
   export function publicSlug(slug: string) {
     return and(
       eq(articles.slug, slug),
       eq(articles.visibility, "public"),
     );
   }
   ```

   Extend the guard to three exemptions, but do not trust three whole files. Positively inspect:

   - `ownedSlug` contains both `articles.slug` and `articles.ownerId`.
   - `publicSlug` contains both `articles.slug` and `articles.visibility === "public"` and does not import `owner.ts`.
   - `slugIsTaken` selects only an id and returns only a boolean.

   The current two-file exemption is visible at [owner-isolation.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/owner-isolation.test.ts:176).

   The type system cannot cheaply prevent every ownerless request from reaching ambient-owner code without threading an owned-access capability through dozens of store calls. Do not attempt that in stage 1. Use four reinforcing boundaries instead:

   - branded `VerifiedUser` for authenticated dispatch;
   - a public import graph with no owner module;
   - a public reader that never accepts a predicate;
   - `currentOwnerId()` continuing to throw as the runtime tripwire.

   Separately, tighten `ownedSlug(slug, ownerId?: string)` to `ownerId?: OwnerId`; its new explicit argument currently accepts any string.

5. **Give public access its own reader, but do not implement `ArticleReader`.** That contract describes private response shapes and owner behaviour. Making a public implementation “compatible” invites precisely the fields being removed.

   ```ts
   export interface PublicArticleReader {
     loadArticle(slug: string): Promise<PublicArticle>;
     loadMetadata(slug: string): Promise<PublicMetadata>;
     loadTweets(slug: string): Promise<PublicTweets>;
     loadGlossary(slug: string): Promise<PublicGlossary>;
     loadSummaries(slug: string): Promise<PublicSummaries>;
     loadIdeas(slug: string): Promise<PublicIdeas>;
   }
   ```

   Its internal query must hardwire `publicSlug`:

   ```ts
   function publicCurrentRevisionQuery(
     db: PublicDb,
     slug: string,
     projection: PublicRevisionProjection,
   ) {
     return db
       .select(projection)
       .from(articles)
       .innerJoin(articleRevisions, ...)
       .where(publicSlug(slug))
       .limit(1);
   }
   ```

   Do not accept `where`, `predicate`, `scope`, or `{ kind: "owned" | "public" }`.

   Risks:

   - **Same `ArticleReader`:** private response shapes and joins become reusable by accident.
   - **Predicate parameter:** owned and public predicates have the same Drizzle SQL type; swapping them compiles and leaks or hides data.
   - **Separate reader:** mappings and staleness rules can drift. Control that with narrow shared pure helpers, generated-SQL tests, and deep DTO key tests.

   The separate reader has the only failure mode that fails locally rather than turning one careless argument into an authorization decision.

6. **Use `PUT /api/article/:slug/visibility`.** Visibility is a singleton subresource whose complete state is being replaced; `PUT` makes the idempotency obvious.

   Publish body:

   ```json
   {
     "visibility": "public",
     "rightsConfirmed": true
   }
   ```

   Unpublish body:

   ```json
   {
     "visibility": "private"
   }
   ```

   Response, always `200` for an owned article:

   ```json
   {
     "visibility": "public",
     "publicAt": "2026-08-28T08:42:13.000Z"
   }
   ```

   Rules:

   - Unknown or another owner’s article: `404`.
   - Unknown visibility, extra keys, or public transition without `rightsConfirmed: true`: `400`.
   - Already in the requested state: return the current representation, do not change `public_at`, and do not append another event.
   - Private → public: set `public_at = now()`.
   - Public → private: clear `public_at`.
   - Lock/read, update and event insertion occur in one transaction.

   **Land the append-only visibility log in 1a.** It is not worth deferring while the migration and transaction are already being written. Use a small `article_visibility_changes` table containing article identity/slug, actor owner id, from/to values, rights confirmation, and timestamp. Log actual transitions only.

   If it were deferred, `visibility_changed_at` plus `visibility_changed_by` would preserve only the latest act. That is useful operational evidence but not history, so I would not call it an audit substitute.

7. **My five 1a test scenarios would be these:**

   1. **Dispatch boundary and closed namespace.** Direct authenticated dispatch without `VerifiedUser` throws; anonymous private routes remain `401`; unknown public paths and every non-GET method end inside the public namespace. Positive control: a verified user reaches `/api/library`, and a real public GET reaches its handler. Watch it fail by removing the brand assertion or public-namespace return.

   2. **Real-Postgres visibility lifecycle.** Default is private; `NULL` and `"world"` fail; owner publishes; public read becomes `200`; repeated publish is a no-op; unpublish makes the next read `404`; one event per transition. Positive control: the same fixture is observed as both `404` and `200` in one run. Watch it fail with a bare slug predicate.

   3. **Owner authorization and anonymous equivalence.** Bob cannot change Alice’s visibility; Alice can. An anonymous response and signed-in Bob’s response are byte-identical, while Alice’s owned response deliberately differs through a private title/lookup canary. That differing owner response is the positive control.

   4. **Deep DTO allowlists over all landed endpoints.** Seed every forbidden field, including nested block `note`, summary `guidance`, glossary `lookup`, title override and metadata internals. Assert exact keys recursively and also assert expected safe prose/artefact keys are present. Watch it fail by adding `guidance` to one projection.

   5. **Ownerless and zero-spend public execution.** Run the complete public surface inside an empty request-owner scope; every GET succeeds or gives its intended artefact `404`; `currentOwnerId()` remains unusable; gateway and cost-ledger spies remain zero. Positive control: temporarily invoke the gateway from one public handler and watch the spy fail.

   Each is a scenario rather than a one-assertion test. That is how five cover the real failures without becoming thirteen shallow checks.

8. **The client capability seam will take three times as long as it looks.** Specifically, splitting `Reader` so public mode does not mount `useComments`, `useChatAnchors`, `useGlossaryRead`’s private source, or any `useJobs` consumer.

   The difficulty is not passing a fetch function. Hooks cannot be conditionally skipped inside one component, so this needs component boundaries and a discriminated capability object. Current `ArticlePage` hardcodes both the private GET and record-open POST at [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:323), while `Reader` mounts private comments and chat state at [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:658). The network trace will find more implicit work than a visual pass will.

9. **Remaining corrections and current-repo changes:**

   - The plan’s proposed `src/public.ts` and “beside `ownedSlug` in `pg.ts`” placement are stale. Use the separate modules above.
   - Apply `Cache-Control: no-store` before public dispatch, not only on successful handlers. Public 404s must not outlive publishing, and error responses must not be cached.
   - `Referrer-Policy` belongs on the `/read/...` document response. Adding it only to `/api/public/...` JSON does not control links, images or navigation initiated by the page. I would use `Referrer-Policy: no-referrer` in [vercel.json](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:16), probably site-wide because owned and public documents share the same path shape.
   - `handleApi` now wraps the entire request—including the future pre-auth public dispatch—in a spend collector at [routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2997). An ownerless model call is currently warned and omitted from the ledger, not made impossible. That makes the zero-gateway runtime test mandatory.
   - Today’s comment work has made the client seam larger: selecting prose now mounts annotation/comment creation and optional chat handoff. Public mode must prevent that component and those hooks from mounting, not merely disable its Save button.
   - The migration lane is active: an untracked [0023_ai_calls_cost_provenance.sql](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0023_ai_calls_cost_provenance.sql:1) already exists while the Drizzle journal currently ends at 0022. Do not generate the visibility migration under a guessed next number until that work settles.
   - Public article blocks need their own selected-column policy. The current owner `blocksQuery` includes per-block `note`; projecting it away after selecting it is weaker than never fetching it.

No settled product decision needs changing. The main corrections are the vertical slice, the branded dispatch capability, a hardwired public reader, and putting the two response policies at the boundary where they actually take effect.