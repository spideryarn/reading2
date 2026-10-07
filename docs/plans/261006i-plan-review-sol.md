The column is a reasonable place for the original address, but the plan does **not close G1 for every path**. Two established charging gaps need fixing.

I reviewed commit `1f7731bac` against the current code. No repository files were changed. I also ran injected-fetch assertions without network or database access.

**Factual audit**

| Plan claim | What the code establishes |
|---|---|
| `urlKey` gives recognised paper addresses one key | Correct. It preserves paper versions; other addresses retain ordinary URL matching. |
| `slugForUrlKey` reads owner-scoped published `final_url` values | Correct. Its left join includes unpublished articles, but their null URL prevents matching. |
| `freeSlug` and `slugForRetry` use that lookup | Correct. `freeSlug` subsequently scans active jobs; `slugForRetry` adopts only from the shelf. |
| Revision `requested_url` is the derived candidate for papers | Correct: `fetchDocument` receives the candidate, and `writeRaw` preserves its `requestedUrl`. |
| Refresh obtains `final_url` through `urlForSlug` | Correct. More generally, any request without its own URL receives that address, except uploads. |
| `STEPS.fetch` resolves the job URL before fetching | Correct. Unknown addresses currently use one unrestricted-kind candidate. |
| `lockOrCreateArticle` is the sole article insertion point and ignores `birth` for existing rows | Correct. Its three direct callers do not currently pass a URL; see K5. |
| A nullable column requires neither revision carry-policy changes nor a lookup index | Correct. Apply the migration before deploying schema-dependent reads. |
| Nothing else automatically reads the new column | Incorrect for the owner’s export; see K7. |

**K1 — P0, established: a pre-column failed import can successfully import the paper while permanently retaining null `asked_url`.**

Concrete sequence:

1. Before Stage 1, a short-link job creates article row A, then fails before publication.
2. Stage 1 adds the nullable column without backfilling A.
3. After Stage 2, Retry copies the failed job’s short URL. `slugForRetry` finds no published match and keeps A’s slug.
4. `lockOrCreateArticle` finds A, so the proposed birth-only write does nothing.
5. The retry imports and publishes the paper, with `asked_url = null`.
6. Another paste of that same short link finds neither a matching shelf address nor an active job. It creates another article and reads the paper again.

This follows directly from `retryJob`, `slugForRetry`, and `lockOrCreateArticle`. It also covers an old unpublished row whose next claim runs the new fetch code.

**Smallest repair:** specify how legacy unpublished rows obtain a proven original address before paper promotion. A narrowly fenced, write-once initialization of null values from the original ingest’s provenance is one option; do not initialize them indiscriminately from refresh jobs. Add a test starting with an existing unpublished row and null `asked_url`, then retry, publish and paste again.

The sentence you least wanted to be wrong about is accurate **as an immutability statement**: an existing row’s value remains unchanged. That is precisely why this null survives. Also, not every retry finds an existing row—a first attempt can fail before creating one.

**K2 — P0, established; inherited defect: shelf adoption still spends another import slot.**

The ordinary sequential case remains incorrectly charged:

1. Import the short link successfully.
2. Paste it again after the original job becomes terminal.
3. The proposed lookup finds the article; `freeSlug` adopts its slug.
4. The URL route still calls `withIngestSlot`.
5. `enqueue` inserts a new job carrying the reservation.
6. Every step skips, but settlement charges the reservation.

The decisive sites are `src/routes.ts:11173`, the ticket construction in `enqueue`, and `src/store/pg-session.ts:587`: an all-skipped successful job is charged.

This exists today for ordinary shelf matches. The proposed column prevents another article and another PDF extraction in this sequence, **but does not prevent another quota charge**. A reader with exhausted quota can also be refused before adoption.

**Smallest repair:** distinguish an ordinary paste adopting an already published article from a new ingest before quota admission. Return the existing article, or otherwise ensure this adoption creates no charge. Preserve the article-existence race protection. The acceptance test must assert the ledger count, not merely that the browser opens the original slug.

**K3 — P1, established: Refresh cannot recover the new destination of a moving redirect.**

The plan correctly identifies the `/latest` behaviour change, but its mitigation is false.

If `/latest` initially redirects to `/posts/old`, `asked_url` makes another paste adopt the old article after `/latest` moves to `/posts/new`. Refresh then obtains `/posts/old` through `urlForSlug`, because it reads `final_url`. It never revisits `/latest`.

Today a second paste can import the new destination. The proposed behaviour silently keeps the old article, and the stated recovery action cannot recover it.

**Smallest repair:** narrow alias adoption to the intended paper case, or explicitly decide and implement how a reader follows a moving original address. Replace “Refresh is the answer in both cases” with the actual behaviour. The column approval alone does not settle this separately flagged product decision.

**K4 — P1, reasoned: separately deploying Stage 1 can leave abstract pages cached under the new identity.**

Between Stages 1 and 2, a short link to an arXiv abstract page can publish that abstract with `asked_url` populated. After Stage 2, another paste adopts that article and skips `fetch`, so the redirect look never runs.

The reachable sequence is established; what remains uncertain is whether the plan intends existing abstract imports to be upgraded. If preserving them is intentional, state that exception to the goal. Otherwise, add a rollout test and an explicit repair path for these revisions.

Merely enabling the lookup and redirect look together later is insufficient if Stage 1 has already recorded these aliases. Landing the nullable migration alone is safe; activating the lookup is the consequential step.

**K5 — P2, reasoned: the URL-writing path needs an explicit caller chain.**

The job’s URL is available in `claimSession(job, attempt)`. It is **not currently available as an argument at the first creation call**:

`claimSession` → `openPgStoreSession` → `openOrBeginJobDraft` → `lockOrCreateArticle`

The Stage 1 checklist names the latter writer but omits the upstream wiring in `src/jobs.ts` and `src/store/pg-session.ts`. `openOrBeginJobDraft` creates the article before locking and reading the job row; its subsequent projection does not select `jobs.url`.

**Repair:** name and thread the birth URL through that chain, preserving article-before-job lock order. Test through `claimSession`, including upload and refresh cases. A direct test supplying `birth.askedUrl` to the writer would miss broken production wiring. The other creation callers should have an explicit null/no-original-address policy.

For fresh imports correctly wired this way, I found no ordinary path where Refresh or a late-stage job replaces a populated original address.

**K6 — P2, reasoned: define held-document equality using request identity, not paper identity.**

Use the existing `sameTarget` helper, then retain the candidate’s kind and marker checks.

Raw string equality needlessly refetches a PDF when its final URL carries a fragment. My injected fetch ended at:

`https://arxiv.org/abs/1706.03762#p`

The fragment survives in `doc.url`. Conversely, `urlKey` is too loose: arXiv HTML and PDF candidates have the **same key**, despite being different requests and renderings.

**Repair:** specify `sameTarget(candidate.url, doc.url)`. Add tests for fragment-only differences and for HTML/PDF candidates remaining distinct. Do not discard query parameters merely because the registry ignores them when identifying a paper.

**K7 — P3, established: the export description names the wrong location.**

`articleJson` serializes the article row with a short omission list, so `askedUrl` would automatically appear in `article.json`. `requestedUrl` is exported in `content/revision.json`.

**Repair:** describe that existing behaviour and verify it, rather than promising both fields “in the same place.”

The redirect design itself preserves the security boundaries I checked. `doc.url` is the last non-redirect HTTP request address, not an intermediate hop or an HTML canonical URL. Meta refreshes are not followed. Credentials and non-default ports prevent source recognition; URL parsing removes explicit default ports. Fresh candidates still pass through the fetch envelope, and reused bytes have already passed through it. Sanitization and PDF processing remain downstream.

For charging, distinguish **quota slots** from **paid PDF extraction**. K2 demonstrates duplicate slots even when no model runs. K1 demonstrates repeated paper extraction after a legacy-row retry. The plan’s acknowledged “canonical paper first, unseen short link second” sequence also repeats PDF extraction after Stage 2; today the second import reads the abstract page. The column cannot discover that alias before fetching.

Active identical pastes normally share work through the active-job scan and partial indexes. Those indexes cease protecting terminal jobs; neither `articles.asked_url` nor its JavaScript lookup creates a durable unique claim on an address. A fresh paste after a failed unpublished import still mints a new slug, as explicitly intended today.

*build it after fixing K1, K2 and K3*