## Findings

1. **Medium — blocker: the session warning and recovery action disappear on `/tweets` when no thread exists.**  
   [PublicPages.tsx:268](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/PublicPages.tsx:268) returns `VisitorPage` without passing `sessionUnconfirmed`. `VisitorPage` renders only the missing-thread notice at [PublicPages.tsx:218](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/PublicPages.tsx:218). Consequently, owned 401 + public 200 at `/read/:slug/tweets` silently loses both “sign-in unconfirmed” and *Continue signed out* whenever `tweets` is absent—the default test fixture and a normal article state.

   This directly contradicts `VisitorArticle`’s stated guarantee that all three views retain the explanation ([App.tsx:1037](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:1037)) and recreates C3’s original defect on one branch. The present C3 tests open only the article view ([public-network-trace.test.tsx:1409](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:1409)).

   Thread the state into `VisitorPage` and render the recovery chrome alongside the artefact-specific notice. Add 401 + public 200 cases for metadata, tweets-with-thread, and tweets-without-thread.

2. **Low — the interaction sweeps still have a signed-in-visitor blind spot.**  
   The exhaustive mode-button sweep runs inside the signed-out describe ([public-network-trace.test.tsx:1085](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:1085)). The signed-in visitor comparison covers page load and link hover, but never presses a mode ([public-network-trace.test.tsx:1299](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:1299), [public-network-trace.test.tsx:1314](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:1314)).

   A mutation that still passes: inside Reader’s `onMode` handler at [App.tsx:2829](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:2829), issue a private request or POST only when `signedIn` is true and `owner` is null. The signed-out button sweep never takes it, and the signed-in parity test never clicks. This is particularly plausible now that `signedIn` and `sessionUnconfirmed` legitimately cross the visitor seam for copy. I would add one signed-in-non-owner button sweep, clearing the initial owner probe and job reconciliation before pressing.

## Other requested attacks

- The state machine’s other edges are right. Public 500s go through `readJson` and throw; network failures throw from `publicFetch`; both land in the existing error arm through [App.tsx:607](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:607). Neither is misreported as `reauth-required`. Late answers are guarded by both slug and reader identity at [App.tsx:628](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:628).

- `sessionUnconfirmed` does not weaken the capability seam in the built code. It carries no verb, loader, hook result, or owner data; all owner machinery still requires the `owner` union arm. Keeping it beside the already-cosmetic `signedIn` is coherent. The missing tweets branch is a threading defect, not a capability leak.

- The narrow-width trade-off is acceptable for v1. The reader can continue reading, the persistent chip preserves the important fact, and selecting Plain/closing the band restores the action. A third persistent control is not justified by this recoverable state.

- Both labels are accurate. Signed-out shared reads still enter `ArticlePage` at [App.tsx:315](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:315); an unshared read reaches `LandingPage`, whose sign-in controls are visible at [LandingPage.tsx:205](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/LandingPage.tsx:205), without changing the address.

- `ClearDeadSessionButton` is sound. The installed Supabase implementation clears the local session even for ordinary revocation failures; `scope: "local"` is correct, and a reload is the cleanest way to discard reader-bound React and request state. The catch can at worst return the reader to the same warning if local cleanup itself was impossible.

- `REAUTH_REQUIRED` does not leak existence. It explicitly says the app cannot determine ownership, and missing/private slugs produce the same 401 + public 404 state and page.

- The child fixture is safe and materially better. Its IDs obey the restricted block-ID grammar, so identity is an adequate `CSS.escape` stand-in here. It activates section construction and reading-position effects without changing the article’s blocks. `VISITOR_BAND` is also a reasonable handle: its accessible label is a user-facing boundary, not an imported implementation constant.

- The `runInRequest` change in `e72aeec` is correctly placed at the transport boundary and preserves the closed public import graph.

The overloaded full run is not disqualifying given that the failures are unrelated and pass in isolation, though a quiet-box full run should still happen before the whole plan closes. I could not independently rerun Vitest in this read-only environment because Vite attempted to create its config cache under `node_modules`.

**Verdict: BLOCKED — the no-thread tweets branch drops the C3 session notice/action. Add its cross-view regression cases; I also want the signed-in visitor mode-interaction sweep before landing.**