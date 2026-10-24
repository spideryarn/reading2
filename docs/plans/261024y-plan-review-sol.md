The server route’s owner scoping is real: `requireUser` gates it, `setRequestOwner(user.id)` installs the request owner, and `slugForUrlKey` queries through `ownedByReader()`. Omitting `viewAs` also fails closed as intended. The client design still has two security blockers.

1. **Blocker — captured HTML is not inert when parsed with `DOMParser`.**  
   [Plan:45](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md:45>), [AddFromExtension.tsx:126](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/src/web/AddFromExtension.tsx:126>)

   The claim that `DOMParser` loads nothing is false: scripts do not execute, but parsed documents can fetch resources named by `img` and `iframe` elements. Thus parsing an untrusted head introduces publisher-controlled network requests from the Spideryarn page and does touch the security map’s untrusted-content boundary. [MDN documents this explicitly.](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString)

   The two parsers also need not disagree only by missing the claim: a browser-only positive could suppress the upload and offer an article that the server parser would not associate with this capture.

   **Fix:** have `capturePage` return the validated `savedFrom.href` alongside its HTML, persist it in `Waiting`, and include it in `TakeReply`. Derive it inside the captured page—not from the earlier `tab.url`, which can race navigation. Validate it again with `savedSource` in the client/server. The extension has not entered the Web Store yet, so the stated extra-review cost does not apply.

2. **Blocker — the lookup can be sent as a different reader.**  
   [Plan:52](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md:52>), [AddFromExtension.tsx:132](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/src/web/AddFromExtension.tsx:132>), [api.ts:438](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/src/web/lib/api.ts:438>)

   Checking `stillFor` before and after `have()` protects use of the answer, but not the request itself. `alreadyOnShelf` awaits `file.text()` before calling `apiFetch`; if A changes to B during that await, `apiFetch` binds the request to B and sends A’s captured address under B’s account. The server then correctly scopes the lookup—to the wrong reader.

   **Fix:** pass the mounted `readerId` into `alreadyOnShelf` and call `apiFetch(path, {}, readerId)`. Retain the post-await `stillFor` check. Test by delaying the pre-fetch work, changing readers, then proving no HTTP request and no upload occur.

3. **Should — lookup failure must not silently become a charged duplicate.**  
   [Plan:24](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md:24>), [Plan:55](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md:55>)

   Treating every exception as “not found” reintroduces the reported bug whenever this new route has a transient failure: a duplicate is uploaded and a slot may be spent. The existing repeat-paste path does not convert a failed database lookup into a new ingest.

   **Fix:** distinguish `missing` from `failed`. Only `missing` proceeds to upload; `failed` retains the cached capture unspent and shows a retryable refusal.

4. **Should — the proposed tests bypass the risky code and do not cover the once-guard.**  
   [Plan:87](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md:87>), [extension-handoff.test.ts:535](</var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/tests/extension-handoff.test.ts:535>)

   Injecting `have` into `receive` does not exercise the browser parser, URL validation, `apiFetch`, `askOnce`, `spendAsk`, `releaseAsk`, or React’s StrictMode lifecycle.

   **Fix:** add tests proving:

   - reader change before the lookup is sent produces no request;
   - StrictMode’s deferred `take` and deferred `have` yield one terminal action;
   - a miss followed by `ONE_UPLOAD_AT_A_TIME` releases the guard, retries after the engine settles, and uploads once;
   - a found result followed by remount/Back can never upload;
   - route failure does not upload;
   - the owner-isolation test calls the actual route as A and B, rather than only calling `slugForUrlKey`.

**Verdict: REWORK**