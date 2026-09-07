# Stage E review — GPT Sol, 2026-09-06

`gpt-5.6-sol`, effort high, given the scoped diff and the repo. The brief asked it to rank silent
failures first, to walk the two-draw lifecycle specifically, and to say plainly whether the
sanitiser guard had been weakened. Sibling of
[260906a-stageD-review-sol.md](260906a-stageD-review-sol.md); the plan it reviews is
[260906a](260906a-figures-from-a-pdf-are-placeholders-with-no-image.md) § Stage E.

**Every finding below was acted on.** The two P1s became `ArticleLoad`; P2 #3 became an early
return in `imageSources`; P2 #4 became a `catch` that falls back to the sanitised article; P2 #5
tightened the exemption to `Article` followed by `)` or `,` and rewrote the comment to say what the
scan does not prove. Four of the five "theatre" tests were strengthened and watched red; the fifth —
the hard-coded owned-route regex — is stage D's and is left, noted here.

---

I would not land stage E yet. The HTML rewriting itself is sound, but the load/resource lifecycle has two serious silent-failure paths.

## Findings

1. **P1 — A stale article response can revoke the current article’s live blobs.**  
   [`resolveAccess`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/App.tsx:873>) starts fetching before the `live` check, while [`beginLoad`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:239>) runs only after `findArticle` returns.

   Sequence:

   1. A starts loading slowly.
   2. Navigate to B; B’s article response returns first, mints blobs, and draws.
   3. A’s stale article response then returns and calls `beginLoad`.
   4. A aborts B and revokes B’s object URLs.
   5. A’s `live === false` prevents stale React state, but it is already too late.

   B can therefore retain revoked `blob:` URLs, lose PDF figures, or fall back to publisher URLs. This is especially plausible under React Strict Mode’s effect replay.

   Resource ownership must be established synchronously when the effect starts, not according to which article request finishes last. Each load needs its own controller and URL set; a stale load must be unable to cancel or revoke a newer one.

2. **P1 — Effect cleanup neither aborts fetches nor revokes URLs.**  
   The cleanup at [`App.tsx:894`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/App.tsx:894>) only sets `live = false`. URLs are released only if another successful article reaches `rehostImages`.

   Consequently, URLs/fetches survive when the reader:

   - leaves `/read/` for the shelf or another page;
   - navigates to `not-shared` or `reauth-required`, which return before `rehostImages` at [`App.tsx:935`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/App.tsx:935>);
   - navigates somewhere whose article request hangs or throws;
   - unmounts while the second draw is pending.

   A late response can then mint blobs after its load has been superseded, and the final displayed article’s blobs can remain allocated indefinitely. The hook’s cleanup needs an actual per-load disposer.

3. **P2 — An already-aborted parent signal does not stop `imageSources`.**  
   `rehostImages` awaits PDF figures at [`rehost.ts:526`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:526>). If the load is aborted during that await, it can later enter `imageSources`, where [`addEventListener`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:755>) does not replay an abort that already happened.

   The new `stop` controller remains live, so a mixed figure/web-image article starts its web fetches and can mint stale URLs. Check `signal.aborted` before launching anything, although the per-load ownership fix above should make this structurally harder.

4. **P2 — An unexpected second-draw rejection leaves all stored images permanently blank.**  
   [`withImages.catch(() => null)`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/App.tsx:1003>) preserves the first draw, but that draw deliberately has every stored image’s `src` removed. It does not “lose the pictures and nothing else,” as the comment claims: it also loses the publisher fallback.

   Individual fetch failures are handled, but an exception in rebuilding, future code, or public-access reconstruction silently leaves blank boxes forever. The catch should restore the original sanitized article, and ideally record the unexpected failure.

5. **P2 — Yes, the sanitiser wiring guard was weakened.**  
   A TypeScript annotation is genuinely not a value source. However, the regex does not know it is looking at an annotation. The new exemption at [`sanitize-client.test.ts:224`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/sanitize-client.test.ts:224>) also allows value expressions such as:

   ```ts
   { article: Article }
   { article: Article as Article }
   ```

   The existing guard can already be bypassed by:

   ```ts
   { article : found.article }
   const article = found.article;
   return { kind: "owned", article };
   ```

   Therefore: there is no current XSS introduced by the implementation, but the regression check is materially weaker than its comment claims. An AST-based check, or a structure that avoids requiring this textual exemption, would be honest.

## `IMAGE_WAIT_MS`

The timeout is in the right conceptual place: it governs the second draw, not first paint. A single article-wide deadline is preferable here because all requests start together and there is one final state transition. A per-fetch timer started at invocation would be effectively the same deadline; one based on actual network service time could extend the blank interval unpredictably.

Aborting outstanding requests at the deadline is correct:

- their publisher fallbacks are about to be rendered;
- continuing would waste bandwidth;
- late successful responses must not mint unused blobs.

What is not proven is the value `15 s`. At 4 Mbit/s, 7.04 MB alone takes about 14.1 seconds, leaving under a second for 102 request round trips, server work, and contention. That supports “plausible starting point,” not the comment’s claim that 15 seconds “covers” the worst article.

## Tests that are still theatre or incomplete

The strongest tests are the entity-decoded lookup, failed/absent manifest states, fake-timer no-wait test, text preservation fixtures, and final removal of `srcset`/`sizes`.

The important gaps are:

- There is no mounted `App` test with stored images. Deleting the `withImages.then` state update would leave every real image blank while all `rehost.test.ts` tests remained green.
- The supersession test calls `rehostImages` in completion order. It cannot catch A-starts/B-finishes/A-finishes, unmount cleanup, or terminal `not-shared`/error paths.
- The timeout test at [`rehost.test.ts:698`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/rehost.test.ts:698>) does not assert that the fetch signal was aborted, release a late response and prove it mints nothing, or prove that one completed image is retained when another hangs. Removing `stop.abort()` would still pass it.
- The `<picture><source>` assertion is only on the final draw at [`rehost.test.ts:542`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/rehost.test.ts:542>). A mutation that removes `<source>` only for `ours`, but leaves it during `waiting`, would hot-link on first paint and still pass.
- “Has an owned twin the authenticated table matches” at [`rehost.test.ts:872`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/tests/rehost.test.ts:872>) hard-codes a duplicate regex; it never reads the authenticated route table. Changing the real route can leave this green.
- The sanitiser source test overclaims data-flow coverage, as described above.

## False or misleading comments

- [`rehost.ts:201`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:201>) says the effect clears state “synchronously in the render.” It does not; the keyed return hides stale state synchronously, while `setAnswer(null)` runs later in the effect.
- [`rehost.ts:482`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:482>) says every non-PDF article returns the same object. Web articles with stored images now do not.
- [`rehost.ts:489`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:489>) says article images are awaited on the load path. Their bytes deliberately are not.
- [`rehost.ts:563`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/src/web/rehost.ts:563>) calls the transition cancellable. The state update is suppressible; the fetches, mints and revocations are not tied to React cancellation.
- [`article-images.md:56`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/docs/project/article-images.md:56>) says the publisher URL “must not reach the DOM at all,” but failed, absent and timed-out images deliberately restore it. It should say “for a stored image while our fetch is active.”
- The claim at [`260906a…md:629`](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figures/docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md:629>) that the capital-`Article` exemption is narrowly confined to type annotations is false.

Verification: the two targeted suites passed, 81/81. All three TypeScript projects also passed via `node --import tsx scripts/typecheck.ts`; the normal npm wrapper could not create its IPC socket under the sandbox.