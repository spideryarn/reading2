1. **P1 — The plan has not established that every Tweets mount represents a fresh choice.** [260915e…md:43](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:43), [activation.ts:71](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/web/activation.ts:71)

   Concrete failure: an owner reloads another page, then goes Back to an old `/tweets` history entry. The reload created a fresh JS realm, so `autoAttempts` is empty; Back now starts a paid job although the owner did not choose Tweets in that navigation. Likewise, a signed-out reader can be looking at `/read/<slug>/tweets`, sign in while the address is preserved, and cause the owner `Tweets` component to mount and spend. Both are precisely the “later navigation causes the spend” class that `activation.ts` deliberately excludes.

   The report’s “when opened” does not distinguish “selected Tweets” from “React mounted Tweets because the address survived another transition.” I would either retain activation gating, or take these specific passive arrivals to Greg for an explicit override: Back/Forward, browser tab/session restoration, and sign-in/account changes. If Greg accepts all of them, the plan should say so rather than claiming the path proves intent.

2. **P1 — The claimed billing bound does not exist for Tweets generation.** [260915e…md:45](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:45), [billing.md:578](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/project/billing.md:578), [routes.ts:8580](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/routes.ts:8580)

   Concrete failure: an owner at their ingest limit—or with a lapsed subscription—can still start Tweets jobs from fresh tabs or repeated full reloads after failures. `POST /api/jobs {slug, steps}` is deliberately classified as a free re-run and bypasses `withIngestSlot`; the billing slot protects new ingests only. The queue provides authentication, ownership, deduplication of identical active work, and global concurrency, but not a per-owner re-run spend cap.

   This change does not bypass a defence; there was never such a defence on re-runs. Remove “per-owner slot limits” and “the owner’s slots” from the justification. Greg must decide whether passive mount-driven re-runs should remain quota-exempt or whether a new server-side spend limit is wanted. The latter is out of scope for this change.

3. **P1 — Replacing `useAutoRun` removes the only automatic recovery from a failed thread read.** [260915e…md:73](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:73), [useAutoRun.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/web/useAutoRun.ts:45), [Tweets.tsx:319](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/web/Tweets.tsx:319)

   Concrete failure: the owner explicitly presses Tweets, the first GET fails transiently, and the proposed effect returns because status is `error`. Today `useAutoRun` keeps the activation and re-reads exactly once; if the second read returns 404, it starts the job. Under the plan, the page shows only an error sentence and no retry button, so it is dead until a full reload.

   Preserve a once-per-mount/slug re-read for `error`, guarded against StrictMode with a ref, before deciding whether to generate. Alternatively add a visible read-retry button, but that is a product change beyond this report. Add a test where the first GET fails and the second returns 404, followed by exactly one job POST, plus a case where both GETs fail without looping.

4. **P2 — The proposed effect has an undeclared callback dependency and would add a touched-file lint finding.** [260915e…md:84](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:84), [useAutoRun.ts:132](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/web/useAutoRun.ts:132)

   `write` is omitted intentionally as a trigger, but the plan does not express that. Biome’s `useExhaustiveDependencies` rule treats the omission as an error. Adding `write` directly is poor too: `write` is recreated on renders, so queue updates continually re-run the effect, albeit with `beginAutoAttempt` refusing them.

   This is not presently a stale-closure failure: whenever `slug` or `loaded.status` actually triggers the effect, it receives that render’s `write`. Use the existing `useAutoRun` pattern—store the current callback in a ref and invoke `ref.current()`—or use a stable React effect event.

5. **P2 — Several lifecycle claims and the proposed evidence are inaccurate or untested.** [260915e…md:95](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:95), [260915e…md:118](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:118), [tweets-press-starts-it.test.tsx:249](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/tests/tweets-press-starts-it.test.tsx:249)

   StrictMode is safe because `beginAutoAttempt` inserts synchronously. A hypothetical `none → loading → none` transition is also safe. But that is not what a failed job currently does: `Tweets.load` never sets `loading` after initialization, and `useStepJob` calls `refresh` only for a completed job. A failed accepted job leaves status at `none`, and the effect does not re-run because its dependencies did not change.

   The proposed “failed job” test currently poses a refused POST, not an accepted job that later reaches `error`. Add coverage for:

   - an accepted job later failing, with no second POST;
   - the transient GET-error/re-read sequence above;
   - a first Back/Forward arrival with a fresh attempt set, documenting the chosen policy;
   - sign-out/sign-in or A→B reader changes, since `jobEngine.teardown()` clears `autoAttempts`;
   - a slug change through the real keyed article composition;
   - the existing visitor no-POST network trace.

   Production slug changes are safe today because `OwnedArticle` is keyed by slug at [ArticlePage.tsx:197](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/web/article/ArticlePage.tsx:197). That dependency should be stated: an unkeyed `Tweets` changing from slug A to B while holding A’s `none` state would run B before B’s GET settled.

6. **P2 — The reload statement is self-contradictory and its first half is false.** [260915e…md:73](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:73), [jobEngine.ts:278](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/src/web/jobEngine.ts:278)

   A normal full-page reload destroys the JS realm and recreates all module state, including the singleton `jobEngine` and its `autoAttempts` set. It therefore permits a fresh automatic attempt without closing the tab. A bfcache restoration is different: it preserves the existing page and module state. Replace the half-finished sentence with those two facts.

7. **P2 — “Collapses with a job already running for the same article” is too broad.** [260915e…md:99](/home/greg/code/spideryarn2/.claude/worktrees/fb-tweets-autostart/docs/plans/260915e-tweets-page-starts-writing-when-opened.md:99)

   Concrete failure: another tab or Metadata has already queued a forced Tweets rewrite. The mount submits an unforced request; `force` is part of the work key, so the requests do not collapse merely because they share an article. They are serialized by the per-article queue, and the later unforced step may skip if the first produced a current artefact.

   Say it collapses with an identical active unforced request, not with every Tweets job for that article.

Mount-path audit:

- History Back/Forward: real passive exposure when the attempt set is fresh; blocked only after this JS realm has already attempted that `(slug, target)`.
- Browser tab/session restoration: real passive exposure if it reloads the document; bfcache restoration preserves the old tree and set.
- Command bar and Dock: explicit Tweets choices, not exposures.
- Shelf and `last-view.ts`: not exposures. Shelf links target the article path, and last-view restores query state only.
- Metadata: no automatic transition to Tweets; its Dock link is an explicit choice.
- Router/App redirects: none redirect to Tweets. The legacy redirect goes to Metadata and signed-in `/login` goes to the shelf. Auth return or the signed-out gate can preserve an existing Tweets path, which is a real sign-in exposure.
- Prefetch: none exists; `Link` is a plain anchor with client navigation.
- Ordinary re-renders: do not remount Tweets. Access-footing changes and reader changes do unmount/remount it; same-realm remounts are guarded only if an attempt was already recorded.
- Sign-in/out and account changes: real exposure, and they reset the guard because `jobEngine.teardown()` clears `autoAttempts`.
- Admin pages: no admin view mounts `ArticlePage` or Tweets; no exposure.
- Removing arming: safe as scoped. Grep confirms `Link.onNavigate` has only the Dock pass-through, `DockLink.onNavigate` only Tweets, the command `onNavigate` field only Tweets, and `armActivationForTweets` only the Dock/command callers plus tests.
- Security: authentication, ownership, visitor separation, and queue admission remain intact; no security-map change is needed. The unresolved issue is the absent billing/spend cap, not an authorization bypass.

BLOCKED