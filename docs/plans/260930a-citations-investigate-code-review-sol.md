Verdict: **approve with the fixes made**. Four defects were found and fixed; no wider issues found.

- **C-1 — P0 — unchecked plural-possessive quotation could reach SSE frames.** [investigate-quote-guard.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/investigate-quote-guard.ts:208) treated the first `’` in `‘the dogs’ owners fabricated…’` as a close. If “the dogs” was allowed, the unchecked continuation streamed through. The guard now holds the ambiguous `s’ ` form, handles chunk boundaries, replays suffixes through block-quote detection, and applies the cap while held. Mismatched straight/curly marks are also pinned.  
  Red → green: adversarial test failed with `received null` instead of `not-found`; the guard suite now passes **23/23**, including every split point through the attack string. Valid unambiguous curly quotes still stream. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/tests/investigate-quote-guard.test.ts:117)

- **C-2 — P1 — article-head changes did not invalidate stored answers.** The fingerprint covered only block ids/text even though the model also receives title, byline, site and URL. [citation-investigate-context.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/citation-investigate-context.ts:121) now hashes the rendered head, and [pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/store/pg.ts:3628) reconstructs the same title fallback and reader override at read time.  
  Red → green: new title/byline/site/URL cases all failed when the head was omitted; all now detach the stored answer as expected. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/tests/citation-investigate-context.test.ts:174)

- **C-3 — P1 — the current Look-it-up match was absent from the fingerprint.** A stored answer could survive a match appearing or its sent title/verified quotes changing. [citation-investigate-context.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/citation-investigate-context.ts:56) now owns the match projection, and its URL/title/quotes enter the hash at [line 136](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/citation-investigate-context.ts:136). Both call and read seams use it.  
  Red → green: omitting the match made the new attachment test fail; it now passes. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/tests/citation-investigate-context.test.ts:183)

- **C-4 — P1 — provenance equated different origins.** URL normalization discarded the scheme and non-default port, so an extract from `http://example.org/paper` or `https://example.org/paper` could falsely substantiate a match at another scheme or port. [citation-investigate.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/citation-investigate.ts:366) now retains both.  
  Red → green: both cases initially returned `example.org`; the provenance suite now passes **27/27**. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/tests/citation-investigate.test.ts:279)

The other declared deviations are acceptable: the retry tail preserves the required stop message; assessed/unreadable matching and assessed-only quotes are correct; straight inch marks fail safely; profile-read failure causes safe over-invalidation; and the production route immediately iterates the stream, with the timed lease covering abandonment before iteration.

Verification:

- Requested five unit files: **96 passed**
- Additional stream-runner/search-usage checks: **50 passed**
- All four TypeScript projects compiled directly
- `git diff --check` passed
- Biome exited 0 with advisory complexity notices
- The supplied Postgres run was **127 passed**, but predates the read-side fingerprint fix. I could not rerun it without loopback; that route test should be rerun in your environment.

Seven files are modified and uncommitted, as requested. No production DB, `.env.local`, or `infra/` changes were made.