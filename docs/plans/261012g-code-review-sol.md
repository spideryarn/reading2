All code defects I found are fixed, but the stage’s acceptance evidence still fails.

1. **Blocker — the Stage 1 bar was missed.** I do not agree that the bar was wrong: the two runs searched only 3/6 and 4/6 targets, and all seven searching replies were 71–93 words against the under-60 rule. I tightened the prompt and removed contradictory guidance in [converse.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/src/converse.ts:1713), strengthened the tool description in [chat-tools.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/src/chat-tools.ts:772), added visible word measurements in [chat-web-reach.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/evals/chat-web-reach.ts:288), and corrected the plan’s claim in [261012g-web-search-through-a-subagent-for-chat-and-the-guide.md](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/docs/plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md:120). The revised prompt still needs a repeat eval before landing.

2. **Should-fix — realistic result lines were discarded.** Numbered/bold lists, punctuation after links, and harmless trailing-slash/tracking-parameter differences could all force the weaker fallback. Fixed with conservative URL normalization, ambiguity rejection, and annotation-URL output in [web-search-subagent.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/src/web-search-subagent.ts:114), with red-first coverage in [web-search-subagent.test.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/tests/web-search-subagent.test.ts:97).

3. **Should-fix — a malformed successful provider response could throw.** Invalid annotations or non-text content escaped the failure boundary. Fixed by validating response processing and returning the ordinary failed-search result in [web-search-subagent.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/src/web-search-subagent.ts:280).

4. **Should-fix — failure logging could expose the query.** `errorFields(err)` could log an upstream error message containing the reader’s query. Replaced it with fixed error classes in [web-search-subagent.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/src/web-search-subagent.ts:227), with a regression test that throws the query verbatim.

5. **Should-fix — several tests allowed silent success.** The billing-job test did not observe the job argument, the fence test did not try an injected closing delimiter, and Live’s exclusion was only indirect. Tests now verify the actual `web-search-subagent` job, hostile fence content, every thread-kind gate, and `LIVE_SERVER_TOOLS` exclusion in [web-search-subagent.test.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/tests/web-search-subagent.test.ts:114).

6. **Should-fix — documentation contained stale or inaccurate claims.** Corrected the fallback contents, tool count, 60-word rule, Chat comparison outcome, worktree status, forced-call terminology, feedback note, and q-madusw wording. The generated feedback file was regenerated and verified.

7. **Nit — stale comment outside scope.** [live.ts](/var/tmp/spideryarn-worktrees/fbvc6uzm-web-search-subagent/src/live.ts:452) calls `GUIDE_TOOLS` “the typed guide’s own tools (`toolsFor`)”; typed guide now has additional tools. Runtime behavior is correct. I left this out-of-scope file unchanged.

Verified without changes: `converse` creates one context per typed turn and reuses it across rounds; new turns get new contexts. Live creates fresh contexts per endpoint call, but both its offered and server-side lists exclude `search_web`. Query length, fixed stored labels, tool-kind gates, stop handling, and route-level spend attribution are sound.

Checks:

- Four available unit suites: 148 passed.
- Documentation/feedback suites: 76 passed; generated reports/questions current.
- Typecheck: all 3,738 source files passed via `node --import tsx scripts/typecheck.ts`. The npm wrapper itself was blocked by sandbox IPC permissions.
- The exact five-file Vitest command could not initialize `guide-route.test.ts`: private Postgres/Docker probing was sandbox-blocked with `EPERM`, so that route test remains unrun here.
- Scoped lint passed with two existing complexity notices.

**DO NOT LAND.**