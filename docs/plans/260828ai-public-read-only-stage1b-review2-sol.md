BLOCKED. The three original fixes hold, but two visitor-mounted components still escape the intended request seam, and one settled privacy requirement is missing.

## Findings

1. **blocker — article HTML can automatically contact third parties on mount, scroll, and resize.** [TableView.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:760) injects article HTML. The sanitizer deliberately retains external `src`, `srcset`, `poster`, `background`, SVG URLs, and allowlisted iframes; it removes only our own API URLs in [sanitize-policy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize-policy.ts:236) and [sanitize-policy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize-policy.ts:388). A real fixture contains an external `imgix.net` image and `srcset` in [blocks.json](/Users/greg/Dropbox/dev/experim/spideryarn2/example/blocks.json:303). Images may load immediately or on scroll; resizing can select another `srcset` candidate. A retained YouTube/Vimeo iframe loads third-party code which can make further GETs, POSTs, and analytics requests. None of these passes through `fetch`, so the assertion that “every request in the client ends at fetch” in [public-network-trace.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-network-trace.test.tsx:12) is false.  
   **Change:** give public prose a network-free render policy: proxy/cache external images onto an approved origin or replace them with inert placeholders, remove external media URL attributes, and turn embeds into click-to-open placeholders. Add a real-browser network test with an external image and iframe as positive controls; a `fetch` spy cannot cover this.

2. **blocker — every visitor to a shared PDF mounts a private source control.** [Masthead.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Masthead.tsx:192) renders `SourceLink` without checking ownership. Clicking it—or pressing Enter while it is focused—issues authenticated `GET /api/source/:slug` in [SourceLink.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SourceLink.tsx:43). The plan explicitly says stage 1 does not publicly serve that route in [260827ai-public-read-only-access.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ai-public-read-only-access.md:959). A visitor therefore opens a blank tab, makes a private request, receives a failure, and loses the tab.  
   **Change:** structurally owner-gate `SourceLink`. Visitors can still see the PDF provenance sentence, but it must be plain text unless a separate public source route is deliberately approved. Add a public PDF fixture and exercise both click and keyboard activation.

3. **blocker — the settled `Referrer-Policy` requirement is not implemented.** The plan requires an explicit policy in [260827ai-public-read-only-access.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ai-public-read-only-access.md:820), but [vercel.json](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:16) sets only `X-Robots-Tag`. Article-supplied outbound links and subresources do not all carry their own policy.  
   **Change:** add `Referrer-Policy: no-referrer` site-wide, or at minimum to every `/read` document response, and assert the response header in a deployed-browser or response-level test.

4. **should-fix — the sharing card validates the write response but not the initial response that creates its “known” state.** [Metadata.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:296) casts `/api/metadata/:slug` with `readJson<ArticleMetadata>` and passes `provenance?.sharing` directly into the card at [Metadata.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:766). Any truthy malformed object is treated as known at [AccessSharing.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AccessSharing.tsx:152); for example, `sharing: {}` confidently renders “Only you can read this.” The write validator at [AccessSharing.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AccessSharing.tsx:94) also accepts contract-breaking combinations and non-date strings.  
   **Change:** share one runtime visibility parser between the metadata ingress and the PUT response. Invalid initial sharing data should become `undefined`/unknown while the rest of Metadata may still render. Test malformed metadata bodies and inconsistent `visibility`/`publicAt` pairs.

5. **should-fix — the public stand-in pages still call another reader’s comments “Your comments.”** `PublicMetadataPage` and `VisitorPage` mount `Dock` without a drawer in [PublicPages.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicPages.tsx:189). That selects the hard-coded tooltip “Your comments…” in [Dock.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Dock.tsx:529). The Reader visitor arm uses the corrected ownership-neutral wording, but these two pages do not.  
   **Change:** pass visitor footing independently of the drawer shape and use the same neutral title on all three visitor pages. Test the Comments link title on `/metadata` and `/tweets`.

## Visitor mount and request audit

| Reachable component/path | Mount or interaction behaviour |
|---|---|
| `App` → `useSession` | Subscribes to Supabase auth and resynchronises on `pageshow`. A signed-in or stale session can cause a third-party Supabase token-refresh POST. |
| `AppBoundary` | No normal request. In a production build with Sentry configured, render errors and unhandled errors cause a third-party Sentry POST. |
| `ArticlePage` | Anonymous visitor: `GET /api/public/article/:slug`, then `GET /api/public/metadata/:slug`. Signed-in non-owner: first `GET /api/article/:slug`; a 401 can cause Supabase refresh and one retry, then the two public GETs. |
| Loading/error/not-shared arms | Timers and local rendering only. `HomeLogo` and landing artwork cause ordinary same-origin asset GETs. |
| `Reader` → `Spine`, controls, `TableView`, context/column cells | Geometry, scroll, resize, keyboard, touch, and URL-state work is local. `TableView`’s injected HTML can make browser-native external requests as described in finding 1. |
| `Masthead` | No ordinary mount fetch. Its source-title link navigates to the third party on click and already uses `noreferrer`; a PDF mounts the private `SourceLink` from finding 2. |
| `ProseHoverCard` | Now clean for visitors: hover and focus wait 320 ms and open the card, but `WithLinkFacts` and `useLinkFacts` are not mounted. Clicking an outbound link still performs explicit third-party navigation. |
| `SharedNotice`, `ViewOnlyChip`, `VisitorBand` | Local copy and internal sign-in navigation only. No retry, polling, or model call. |
| Reader `Dock` and visitor comments drawer | Mode clicks and keyboard activation change local/URL state. Opening Comments makes no request. In-app navigation to Metadata or Tweets reuses the existing `ArticlePage` answer; a reload or new tab repeats the public pair. |
| `PublicMetadataPage` | `BackToArticle`, `SharedNotice`, `Artefact`, and `VisitorDock`; no component-owned fetch. It inherits the already-loaded public pair. |
| `VisitorPage` for Tweets | `BackToArticle`, `VisitorNotice`, and `VisitorDock`; no component-owned fetch. |
| Suspense/retry/error states | No visitor Suspense boundary or data retry path found. The conditional error-boundary Sentry report and `apiFetch`’s signed-in 401 refresh are the exceptions. |

There is no visitor-originated POST to a Spideryarn API in the reviewed graph. Conditional POSTs can still come from Supabase auth refresh, Sentry error reporting, and loaded third-party iframe code.

The fifth visitor state holds: `available === null` produces `availability-unknown`; a known `true` flag produces `not-yet-public`; a known `false` produces `not-built`. Tweets now uses `available.tweets`. Those conditions and claims remain distinct.

The sharing card’s slow-write and failed-write paths are fixed: pending replaces the confident card, and any thrown or unparseable write response becomes write-unknown. Finding 4 is a separate, earlier ingress.

The reader-identity fix also holds. The answer is keyed and synchronously checked by both slug and reader id, stale asynchronous responses are cancelled, and the offline cache is partitioned by user. I found no remaining render, cache, or route-transition path that shows one reader’s article to another.

Reviewed current HEAD `d29a2b0`; no files changed. I did not spend findings on the two explicitly in-flight items.