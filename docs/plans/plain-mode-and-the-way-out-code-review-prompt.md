# Review: Plain mode, the way out, and the source download — **as built**

You are reviewing **built code**, not a plan. Be adversarial and concrete. For each finding, name
the file and line, say what input or sequence produces the wrong behaviour, and say what the fix is.
Rank by severity. Say plainly if something is fine — do not manufacture findings.

You reviewed the **plan** for this earlier today; that review is at
`docs/plans/plain-mode-and-the-way-out-review-sol.md` and its findings were acted on. Read it, then
read the plan (`docs/plans/plain-mode-and-the-way-out.md`, whose § What the review changed lists what
your findings altered), then read the actual code in the repo. **Weight this pass higher than the
plan pass**: a plan review cannot find a PATCH that writes one field and then rejects the request.

## The repo

Spideryarn: an AI-assisted reading app. TypeScript + ESM. React client under `src/web/`, a Node
server in `src/routes.ts`, two interchangeable stores (filesystem for a laptop, Postgres + Supabase
Storage in production, selected by `SPIDERYARN_STORE`). Standing rules from `AGENTS.md` that bear on
this: **a check you have never seen fail is not evidence**; the commonest bug class here is something
reporting success while doing nothing (`docs/reusable/silent-success.md`); view state lives in the
URL; never let one store fall back to the other.

## What shipped

Five changes, all 2026-08-31, all from one session with Greg:

1. **A tenth mode, `plain`** (`src/modes.ts`) — no band and no gist columns: spine + prose. It is now
   `DEFAULT_MODE`, replacing `hierarchy`. Greg explicitly accepted breaking old URLs
   (*"we're in alpha and have no users yet"*), so `?mode=toc` back-compat was deliberately retired
   rather than aliased, and its test deleted.
2. **`inMode` split into `inMode` / `bandOpen`** in `src/web/App.tsx`, plus `plainCols`.
3. **The controls bar's `back to contents` link became an `×`** that goes to `plain` by name.
4. **The bars stay while a `.mode-band` is open** on a small device — `.mode-band` added as an
   argument to the two existing `:root:has(…)` guards in `src/web/styles.css` § a small device.
5. **`GET /api/source/:slug` now serves through the store** instead of off the local filesystem:
   a new `rawSource` revision projection in `src/store/pg.ts`, `ArticleReader.loadSource`, and
   `readRawDocument` lifted from `src/store/export.ts` into the new `src/store/raw-document.ts`.
   Plus a new `TheOriginal` control in the controls bar (`src/web/SourceLink.tsx`).

## The specific questions

1. **The `inMode` / `bandOpen` split.** Read `src/web/App.tsx` — the two definitions, `plainCols`,
   the `fitView` call and its dependency array, the controls-bar branch, and every band-rendering
   branch near the bottom. Is every consumer reading the one it means? Is there a state — arriving in
   Plain from outline mode (`?text=0`), or with `?cols=` set, or with `?spine=0` — where the table
   comes out empty, or the prose disappears, or a stale `layoutKey` leaves a scroll spy measuring a
   page that no longer exists?

2. **`plainCols` and the memo.** `EMPTY_DEPTHS` is a module constant reused for two purposes. Check
   the `useMemo` dependency array on `fit` is now correct — it lists `plainCols`, not `cols`. Does
   anything else still read `cols` where it should read `plainCols`?

3. **The `rawSource` read.** `src/store/pg.ts`: the `RevisionReader` member, the policy grants, the
   projection, and `pgArticleReader.loadSource`. Is `currentRevision(slug, "rawSource")` genuinely
   owner-filtered, and does it 404 rather than throw for an article that is not the caller's? Is
   granting `rawBytes` to this read safe — can any *other* code path reach this projection? Is
   `blobStore()` (rather than `exportBlobStore()`) the right choice, and what happens on a laptop
   running `SPIDERYARN_STORE=postgres` with no Supabase credentials?

4. **The extraction.** `src/store/raw-document.ts` vs what was in `src/store/export.ts`. Confirm the
   move is behaviour-preserving and that `export.ts`'s re-export keeps every existing importer and
   `tests/store-export-raw.test.ts` working. Did the cycle actually go away, or move?

5. **`sendSource` in `src/routes.ts`.** The double authorisation (`shelfStore.read` then the
   owner-filtered read) — is either redundant in a way that would let somebody remove the wrong one?
   Are the four outcomes (no source → 404, dangling reference → 500, corrupt object → 500, store
   throws → 500) what the code actually produces once the error travels through this file's status
   plumbing near the bottom? Is `Content-Length` right for every path? Is there any way to get a
   partial or wrong-length body?

6. **`contentDisposition` in `src/routes.ts`.** It builds a header from reader-controlled text
   (`raw_filename`, whatever a browser sent on upload). Can it be made to emit a malformed header, or
   to inject a second header parameter? Is `inline` right rather than `attachment` for a PDF served
   from our own origin with `nosniff`? Is the RFC 5987 encoding correct — should anything more than
   `encodeURIComponent` be applied?

7. **`TheOriginal` in `src/web/SourceLink.tsx`.** `isWebUrl` gates the anchor and the masthead's
   `<h1>` anchor was fixed the same way. Is the gate in the right place — could a `meta.url` reach an
   `href` anywhere else in the client? Is the owner gate (`owner` prop, derived from `!!owner` in
   `App.tsx`) actually equivalent to *may this caller fetch `/api/source/`*? Does the `onError` hook
   leave any path where a failure is silent?

8. **The CSS.** `src/web/styles.css` § a small device. Read the two `:root:has(…)` guards and the
   `:root[data-bars="hidden"]` block, and the `:where()` on the install-hint rule. Is the specificity
   argument in those comments actually correct for the selectors as written? Is there a state where
   the bars stay hidden with a band open, or where they come back and the band's `bottom` does not
   follow? A browser pass measured the intended behaviour holding at 390×740 in Search and the old
   hiding still working in Hierarchy — is there a width or orientation where it breaks?

9. **The retired `toc` back-compat.** `tests/url-state.test.ts` and `tests/public-read-rewrite.test.ts`
   were changed to assert `DEFAULT_MODE` rather than the literal `"hierarchy"`, and the dedicated
   `toc` test was deleted. Is anything left in the codebase that still assumes the default has gist
   columns, or that `toc` resolves anywhere in particular? Sweep for it.

10. **Anything the change does not mention.** Tests that now pass for the wrong reason; docs that are
    still false (`docs/project/url-state.md`, `page-titles.md`, `web-client.md`, `performance.md`
    were updated — `reading-view-overview.md` deliberately was not yet); the dock's keyboard
    `nextModeIndex` walk with a tenth mode; `visitorGap` and `markedModes`; anything about a shared
    `/read/` link served by the serverless title composer.

## The diff

`docs/plans/plain-mode-and-the-way-out-code-review.diff` in this repo is the scoped diff of every
changed file — read it. `src/store/raw-document.ts`, `tests/source-download.test.ts` and
`tests/the-original-control.test.tsx` are new and are not in it; read them from the working tree.

Peers hold uncommitted work in this shared tree, so the working tree contains changes that are **not
part of this review**: hunks about `mark.chat`, `.diag-card`, `DiagramBand`'s `layoutKey`,
`BlockRef`, `comment-nav`, `citations.ts` and `src/db/schema.ts` belong to other agents. The diff
file has been scoped to the files this change touched, but a few of those files (notably
`src/web/styles.css` and `src/web/App.tsx`) contain peer hunks too. Ignore anything that is not one
of the five changes listed above.
