## Ranked review

1. **Blocker — C3 needs a new actionable state.**

`apiFetch` returns the final 401 after one refresh attempt (`src/web/lib/api.ts:415-444`), and `readJson` turns it into an `HttpError` (`src/web/lib/api.ts:329-332`). `useArticleAccess` catches that as the generic `{ kind: "error" }` (`src/web/App.tsx:547-558`), whose entire UI is a logo and `<pre>` (`src/web/App.tsx:728-734`).

That preserves the server’s “Sign in again” sentence, but offers no action. A link to `/login` is insufficient: signed-in users are redirected from it to the shelf (`src/web/App.tsx:413-420`).

Add a distinct `reauth-required` access state for a final owned-route 401, with an explicit user-initiated reauthentication action. Do not automatically sign out. The red test should prove the action exists and that neither public fallback nor `View only` renders.

Also correct C3’s symptom: the owner does **not** see “Make a free account”; `SharedNotice` hides that CTA while `signedIn` is true (`src/web/PublicChrome.tsx:84-106`).

2. **Blocker — Cluster D cannot yet be built “as written.”**

The C → D → E order remains right: delivery routes, reading-view wiring, then browser proof/docs (`260829b:537-546,597-605`). Exact manifest membership, current visibility, `no-store`, and the positive-control browser test are already correctly specified in 260829b (`:316-338,607-619`); the audit adds no correction there.

But Stage C is underspecified against today’s public dispatcher:

- `PublicRouteName` represents one slug capture only (`src/public/route-names.ts:44-60`).
- Every public reader has `(slug) => Promise<unknown>` (`src/public/routes.ts:148-160`).
- The dispatcher extracts one slug and serialises every result as JSON (`src/public/routes.ts:291-313`, `:104-117`).

An asset route needs at least slug plus asset identity and a binary response with sniffed `Content-Type`, `nosniff`, truthful HEAD behaviour, and no JSON wrapper. Amend Stage C to say how the inventory, method sweep, client-path agreement, and binary sending generalise without creating a second ad-hoc dispatcher.

The DTO rebuild belongs with Stage D, whose client consumes the manifest—not with the binary route. Keeping the pass-through until D is benign, but call that accurately. Its fixture must cover `Required<Assets>`, `Required<StoredAsset>`, **and the failed union arm**; the proposed pair does not prevent a future optional field on failed entries.

Also soften “closes the one request … outside our origin”: missing, failed, unsupported and timed-out entries deliberately continue hot-linking (`260829b:175-179,352-354,514-521`).

3. **Required factual/evidence corrections.**

- **S4 is wrong:** there is a database statement timeout—two minutes for the application role unless overridden (`docs/project/database.md:927-932`). State “no route-specific/application timeout”; keep the concern that two minutes is too loose. Also say pool max 5 is **per function instance** (`src/db/client.ts:95-124`), not a global five-connection ceiling.
- **S9 mixes proof with hypothesis:** Vercel’s 4.5 MB response limit is proved by [official documentation](https://vercel.com/docs/functions/limitations); “buffers at 4.5 MB” is an unsupported mechanism claim. What remains hypothetical is whether any stored article crosses it and the exact deployed failure. `loadHead` checking only tree/blocks, not payload size, is proved (`src/store/public-reader.ts:551-580`).
- **S3 overclaims “IP and nothing else.”** `no-referrer` proves only that the Spideryarn URL is withheld (`index.html:53-69`). The publisher still receives ordinary request metadata and may receive its own applicable cookies. Say “IP and ordinary browser request metadata, but not the Spideryarn URL.”
- **S1 understates today’s manifest:** it also carries version, `sourceHash`, `fetchedAt`, status, content type and failure timestamp (`src/assets.ts:84-121`). None is personal, but the inventory should be accurate.

The other findings I checked are correctly stated.

4. **Public-metadata deletion needs an explicit counted checklist.**

Beyond the plan’s current names:

- Server: `READS.metadata` (`src/public/routes.ts:158-161`); the `publicMetadata` DTO builder (`src/public/dto.ts:475-499`); interface imports/contracts and explanatory comments throughout `src/store/public-reader.ts:53,106,280-316,504-540`.
- Types/client: `src/public-types.ts:47,351-357`; `src/web/public-api.ts:32,108-110`; stale route explanations in `src/web/public-artefacts.ts:8-24`, `src/web/App.tsx:470-479,632-638`, `src/web/PublicPages.tsx:14,67-71,133`, `src/web/reader-capability.ts:94`, and `src/types.ts:1628-1645`. Keep `PublicMetadataPage`; it is the `/read/:slug/metadata` UI, not the deleted API.
- Tests: loader and client-path cases in `tests/public-client-fetch.test.ts:137-193,233-250`; direct HTTP and store cases in `tests/public-visibility-pg.test.ts:477-500,698,1439-1508`; the disagreement in `tests/public-reads.test.ts:246-259`; obsolete type fixture/mock/comment in `tests/public-network-trace.test.tsx:75,294-307,361-364,460-467`.
- `tests/public-dispatch.test.ts:355-425` should remain: it is inventory-driven and should shrink automatically. Confirm it still fails for a semantically bad remaining route.
- Canonical plan: mark `260827ai:1007,1031,1403,2218-2226` superseded. No `docs/project/` reference was found.

Historical review documents should remain historical.

5. **Tiering: A and B are two stages.**

Cluster A contains reachable UI defects; classify C1–C3 as Tier 0, with C4 travelling as their defence. Build it first after C3’s state is designed.

Cluster B is a separate Tier 1 server/deletion stage. Combining unrelated client state work, a broad deletion, request scoping and project-doc edits weakens reviewability.

Cluster C can proceed independently in log mode; NAT/unfurler false positives prevent immediate enforcement, not logging. Keep D in Tier 2 and F in Tier 3. E is small but is a product addition, not a confirmed defect, so it need not move up. G is better labelled an unmeasured validation task than a Tier 3 rearchitecture.

6. **Cluster F’s boundary is right, with four requirements for its later plan.**

The bookmark should grant nothing and comments/chat must wait. Its first plan must require:

- unique/composite identity on `(owner_id, article_id)` plus appropriate FKs;
- every save/list/open query owner-scoped, with the article resolved through `publicSlug`;
- a discriminated `owned | saved-public` shelf DTO so a saved card cannot mount `OwnedArticle`, owner routes, mutations or private hooks;
- no child table may reference the bookmark interim.

Decide explicitly whether an unshared bookmark stays hidden and may reappear on reshare, or is deleted. Either can work; accidental behaviour cannot.

7. **Umbrella-plan bar.**

The scope line is good, and the “one level up” verdict is clear and supported. Evidence states are present, but S4 and S9 conflate distinct evidence strengths. The counts requirement is short: the incomplete deletion inventory demonstrates that. Add a compact count ledger for route consumers/tests/comments and the asset projection arms.

The slice-2 deletion note and the two closed open questions in 260827ai are accurate.

**Verdict: BLOCKED — on the missing actionable C3 reauthentication state, the unspecified multi-parameter/binary public asset-route seam, and the incomplete counted metadata-deletion inventory.**