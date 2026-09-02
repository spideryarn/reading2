My calls: delete and repoint for Fork 1; choose B for Fork 2, but fold the warning into the existing read-only chrome.

## Fork 1 — delete the metadata route

1. **The article route is at least as independent as the metadata route—and for title fallback, more independent.**

All three reads share `publicCurrentRevisionQuery`, its revision join, and `publicSlug(slug)` ([public-reader.ts:368](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:368)). Therefore neither endpoint can detect a bug in that shared query.

Beyond that:

- Metadata and head both use the exact same `PUBLIC_HEADING_TITLE` SQL expression in their projections ([public-reader.ts:269](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:269), [public-reader.ts:334](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:334)).
- Article instead fetches and sanitises the blocks, then derives `headingTitleOf(blocks)` ([public-reader.ts:438](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:438), [public-reader.ts:483](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:483)).
- Head composes its title directly from its projection ([public-reader.ts:551](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:551)); article hands its independently assembled value through `publicMeta` ([dto.ts:96](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/public/dto.ts:96)).

Both ultimately use `title ?? headingTitle ?? slug`, but that is the intended value rule, not the same assembly path. The article route still catches a head built from the wrong article or a stale head. The blank-string downgrade also survives because `??` preserves `""`.

2. **Keeping and aligning metadata is coherent, but inferior.**

If retained, metadata should check `hasBlocks` as head does; its current “same bar” comment is false because it checks only `hasTree` ([public-reader.ts:504](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:504), [public-reader.ts:557](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/public-reader.ts:557)). But that leaves an unauthenticated production route whose only caller is a deployment checker.

Fetching the article also strengthens the check: if the head advertises an article whose actual DTO is too large or otherwise cannot be delivered, the verification fails. That is useful evidence, not merely a 200KB cost.

3. **The ledger is incomplete but the omission is bounded.**

Under the ledger’s five stated needles, `check-public-shell.ts` adds eight references, so the corrected count is **17 files and 61 references**. The rewrite is broader because names and self-tests such as `judgeTitleAgainstMetadata` also change ([check-public-shell.ts:313](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/scripts/check-public-shell.ts:313), [check-public-shell.ts:666](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/scripts/check-public-shell.ts:666), [check-public-shell.ts:848](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/scripts/check-public-shell.ts:848)).

A broad `scripts/` sweep found no other `/api/public/*` caller. Other scripts mention `/read/` generically; `client-shell.ts` is the build-time structural guard for the public page, not an API consumer ([client-shell.ts:1](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/scripts/client-shell.ts:1)).

If the route were kept, S2 still deserves its own stage: `runInRequest` repairs a security tripwire at the transport boundary ([vercel.ts:304](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/vercel.ts:304)), and should be reviewed separately from client state work.

## Fork 2 — choose B

1. **A 401 says nothing about entitlement to the public DTO.**

After `apiFetch` has refreshed and retried ([api.ts:415](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/lib/api.ts:415)), ownership is unknown—but an anonymous public GET can still establish public access. If it returns 200, rendering it through the visitor capability is both safe and truthful. Blocking it would couple world-readable access to an unrelated broken session.

The decision table should be:

- owned 401 + public 200 → public article, session-unconfirmed warning;
- owned 401 + public 404 → `reauth-required`;
- never mount owner capabilities in either case.

2. **B need not add a second band.**

There is already a persistent `SharedNotice` for public reading ([PublicChrome.tsx:84](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/PublicChrome.tsx:84)). Extend the read-only chrome with the warning/action. Account for narrow screens, where that notice is deliberately hidden and only the sticky “View only” chip survives ([PublicChrome.tsx:95](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/PublicChrome.tsx:95)).

3. **The proposed “sign in again” action is misdescribed.**

`signOut({ scope: "local" })` is the correct non-global cleanup, and the installed SDK removes the local session even when revocation answers 401/403. But reloading the current public article does **not** show sign-in: signed-out `/read/:slug` deliberately goes straight back through `ArticlePage` ([App.tsx:301](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:301)). It will simply reopen the shared version.

Therefore either label that action **“Continue signed out”**, or add a one-shot reauthentication path that preserves the current address and actually renders sign-in. Do not call local sign-out plus reload “Sign in again”.

**Final calls:** Fork 1 — delete the metadata route and make the deployed checker read `article.meta.title`. Fork 2 — B: preserve public readability, visibly mark the session as unconfirmed, and reserve `reauth-required` for 401 plus public 404.