## Verdict

The architecture is sound and is the design I endorsed after the original BLOCKED review: a second predicate, a hardwired public reader, a closed namespace, narrow SQL projections, allowlist DTOs, and a capability union. It does not need Tier 3 rearchitecture.

There are several patches to make, plus one deletion opportunity. Stage 3 is where a separate schema redesign becomes mandatory; it should not distort Stage 1 now.

## Ranked findings

### Tier 1 — do before promoting public sharing

1. **Delete the unused public metadata API.** All four audits missed this.

`loadPublicMetadata` has no production caller (`src/web/public-api.ts:108-110`); the client derives flags from the article (`src/web/App.tsx:632-637`). The comment saying metadata remains for link previews is false: previews use `pgPublicReader.loadHead` (`src/public/page.ts:308`, `src/store/public-reader.ts:551-580`).

Delete the route at `src/public/route-names.ts:74-77`, its reader at `src/store/public-reader.ts:504-531`, `PublicMetadata`, the client loader, and route-specific tests.

That also deletes a correctness inconsistency: metadata accepts a tree with no blocks (`public-reader.ts:513-517`), while article and head refuse it (`:438-443`, `:555-557`). The tests explicitly preserve that disagreement (`tests/public-reads.test.ts:246-259`). Do not patch the disagreement; delete its only consumer.

2. **C3 is a real live bug, but the reported symptom is slightly overstated.**

`findArticle` falls back on both 404 and final 401 (`src/web/App.tsx:621-640`). Yet `apiFetch` explicitly says a final 401 is not proof the session is gone and must be reported without signing out (`src/web/lib/api.ts:381-387`).

Fix: fall back only on 404. Let the existing error path report the 401, ideally with a sign-in-again action. Do not automatically sign out.

The owner does see “View only,” but not “Make a free account”: `signedIn` remains true (`App.tsx:683-684`), and the CTA is conditional at `PublicChrome.tsx:84-106`.

3. **C1, C2 and C4 should be fixed together.**

- Hide the paragraph-chat button for visitors. It is always rendered at `BlockGutter.tsx:303-324` and deliberately discarded at `App.tsx:2301-2312`. This is a dead control, unlike marked modes that open an explanation.
- Add `referee: "Referee"` to `COSTS` (`visitor.ts:125-166`). The fallback at `:215-219` is safe but produces visibly broken copy.
- Make both network sweeps exhaustive. The literal lists at `tests/public-network-trace.test.tsx:484-490,802-819` omit six modes. Drive URL cases from `MODES`; for presses, enumerate the rendered `role="radio"` buttons rather than exporting another label list.

4. **S1 is stronger than “latent,” and deletion is the right fix.**

`assets` passes by reference (`src/public/dto.ts:450-461`). It already exposes internal `sourceHash`, `fetchedAt`, manifest version and failure timestamps (`src/assets.ts:84-121`), although none is personal. The DTO test pins today’s keys (`tests/public-dto.test.ts:301-336`) but does not force a newly added optional field into its fixture, so the promised future-field defence is absent.

More importantly, no client consumes the manifest, while comments at `src/store/public-reader.ts:224-230` falsely claim it prevents hot-linking.

Stop selecting it (`public-reader.ts:231`) and set the structural `Article.assets` field to `undefined` at the client seam. Restore a deliberately projected public manifest when image delivery stages C/D are built. Do not build the asset route merely to justify this field.

5. **S4 should be split into three claims.**

- No route-specific rate limit: true and worth fixing before a widely shared link exists.
- No statement timeout: not quite true. The database has a two-minute default (`docs/project/database.md:927-932`), though that is far too loose to protect a five-connection pool from public reads.
- No response cap: the platform imposes a hard 4.5 MB buffered response limit. An oversized article therefore fails as a platform error, while `loadHead` can still advertise it as readable. [Vercel documents that limit here.](https://vercel.com/docs/functions/limitations)

A base visit performs one head query (`src/public/page.ts:308-312`) followed by the article authorization and blocks queries (`src/store/public-reader.ts:435-438`): three database queries across two requests. A `HEAD` to the JSON article endpoint also performs the full reads and serializes the complete payload (`src/public/routes.ts:104-114,306-313`). That makes the amplification concern more concrete.

Use Vercel WAF rate limiting for `/read/*` and `/api/public/*`, initially in log mode. It runs before the function and pool; an in-process IP map does not survive serverless instances. Vercel’s current guidance supports path-based WAF rate limits, including IP/JA4 keys. [Official WAF guidance.](https://vercel.com/kb/guide/add-rate-limiting-vercel)

Treat the 4.5 MB case as a separate bounded task: reproduce it on a deployment, then stream the article response or refuse sharing cleanly. Do not invent a guessed cap without testing the actual transport.

### Tier 2 — structural defence

6. **S2 is valid, but it is defence-in-depth rather than a reachable leak.**

The page enters at `src/vercel.ts:309` outside `runInRequest`, so `currentOwnerId()` would use the environment owner (`src/owner.ts:224-240`). The import/table guards currently prevent that path from reaching owner data.

Fix at the transport:

```ts
await runInRequest(() => servePublicReadPage(...))
```

Putting the wrapper in `vercel.ts`, not `public/page.ts`, preserves the public import graph. No rearchitecture is warranted.

7. **C7 is not a bug I would fix.**

`onRenamed !== undefined` at `Masthead.tsx:156-168,248-256` is itself a function capability, not merely an unrelated boolean. Adding `visitor` or `owner` as another prop would create two facts that can disagree. The construction is correct at `App.tsx:924-930,979-984`.

### Not findings requiring code

- **S5:** an audit table need not have an application reader. The retained slug, actor, confirmation and timestamp make it queryable after deletion (`src/db/schema.ts:285-324`). An admin UI now fails YAGNI.
- **C5:** the server stops serving on subsequent requests. Bytes already downloaded cannot be revoked.
- **C6:** both copy issues are real but below the bar while the filesystem store is transitional and clipboard-less browsers can select the visible input.

## Deletion and YAGNI calls

| Proposed change | Decision |
|---|---|
| Rebuild `assets` field by field | **Reject now.** Delete it from the public projection until delivery consumes it. |
| Build the public asset route now | **Defer.** It belongs to the existing delivery stage, with the browser acceptance test. |
| Delete public metadata API | **Do it.** Best deletion-test result in the audit. |
| Wrap `/read/:slug` in request scope | **Do it.** Tiny, durable defence. |
| WAF rate limiting | **Do it.** Platform machinery already exists. |
| Application per-IP counter | **Reject.** Wrong persistence boundary. |
| CDN `s-maxage` plus purge | **Defer.** It couples sharing writes to cache invalidation and weakens revocation. |
| Public-specific database pool/role/timeouts | **Defer** until WAF and measurements show need. |
| Oversize-response handling | **Keep as a separate tested task.** The platform boundary is real, but choose streaming versus refusal from a deployed reproduction. |
| Audit admin page/script | **Reject now.** Use SQL if a complaint arrives; write a script only if that workflow repeats. |
| C1/C2/C3/C4 fixes | **Do them.** Small live correctness fixes with no speculative machinery. |
| Revocation polling/focus listener | **Reject now.** It cannot retract downloaded data and adds lifecycle machinery. |
| C6 polishing | **Defer.** |
| Explicit Masthead visitor flag | **Reject.** The callback already is the capability. |

## Product recommendations

- **P1 — Save CTA:** yes, once the bookmark exists. `saved_public_articles(owner_id, article_id)` is a safe first cut if it means only “save this link,” always re-checks `publicSlug`, and never grants ownership or mutation rights. It does not recreate the child-table trap. Comments/chat must wait for `shelf_entries`, with children keyed by `shelf_entry_id` or protected by a composite owner/article FK.

- **P2 — Indexing:** delete slice 2. Canonical-to-origin removes most ranking value; reproduction and rights exposure remain. Link previews and word-of-mouth—the useful marketing surfaces—already work under `noindex`.

- **P3 — Images:** stop sending `assets`; keep hot-linking with `no-referrer` for now. Finish the asset route only as the planned end-to-end delivery slice.

- **P4 — Rate limiting:** Vercel WAF is the boring answer. No application counter and no cache until purge-on-unshare is an atomic, tested part of the visibility write.

- **P5 — Unlisted:** demand is plausible, but do not silently turn this marketing feature into private sharing. Make current copy explicit that the URL is public and not secret. Add capability-token sharing later if actual users ask for “send privately”; it needs random tokens, rotation and separate revocation semantics.

- **P6 — Revocation:** do nothing in v1. New requests and reloads stop immediately; already delivered bytes do not. If Greg wants the UI to disappear opportunistically, a focus-time `HEAD /read/:slug` is the least machinery, but it is cosmetic rather than stronger authorization.

- **P7 — Attribution/comments:** attribution is intentionally difficult because the public table guard excludes profiles; that is healthy. Add an explicit public-name projection later, never auth email. Shared comments require an opt-in DTO and owner-filtered relation; stage 3’s schema must land first.

- **P8 — Audit table:** direct SQL when needed. No admin page or permanent script yet.

- **P9 — Shelf:** add a small public globe badge, not a filter. Visibility is already present in the whole article row selected by `listArticlesQuery` (`src/store/pg.ts:1489-1496`), so this costs DTO/UI work but no extra query. A badge helps owners remember exposure; a filter needs volume that does not exist yet.

Overall: the built feature is the design I endorsed. The deviations are local—dead metadata, premature assets, missing page request scope, and client edge cases. The only Tier 3 work is the already-known multi-reader ownership model before Stage 3, not a rewrite of public reading itself. No files were changed.