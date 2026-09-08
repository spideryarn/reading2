No P0 or P1. The twelve handlers still behave as a pure move, but I found two verification gaps and two small source defects.

## Findings

**F9 — P2: the claimed durable comment-corruption safeguard is not in the committed artifact.**

The plan says the fixed generator is inherited through the committed verifier ([plan](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md:470)). But the verifier has only `before`, `after`, and `diff` modes; it never generates or splices code. Its `blank()` function is used only by the return rail, while `normalise()` still removes comments ([verifier](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/docs/plans/260908a-verify-move.mjs.txt:120)).

Therefore, somebody repeating this recipe does not inherit the fix that prevented `chat` from being rewritten inside English and citations. The generator that contained that fix was ephemeral.

The cheap durable check is to extract comment tokens from before and after with the TypeScript scanner and compare their text after indentation/whitespace normalization. Do that even for refused handlers, and require an explicit exception for intentional rewrites. A whole-file comment comparison would also catch route-level comments outside handler bodies.

**F10 — P2: an expected refusal skips the entire body comparison, not merely the return conclusion.**

At [verifier line 238](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/docs/plans/260908a-verify-move.mjs.txt:238), `chat GET` reaches `continue` before its normalized bodies are compared. The expected-refusal map also checks only that the key exists, not that the refusal remains “two returns.”

Consequently, arbitrary changes elsewhere in `chat GET` would still print `refused, accounted`; a change to zero or three returns would also be accepted under the same explanation. The mutation proves the early exit matters, but it does not justify ignoring the rest of the body.

Compare normalized bodies for every guard first, then let the rail require additional behavioral evidence. The current before/after normalized `chat GET` bodies are identical, so this strengthening stays green.

The extractor has another reusable blind spot: `blockAt()` counts raw braces inside comments and strings, while `blank()` is not used for brace walking. That does not mis-extract these twelve, but an AST/scanner-based boundary would be safer.

**F11 — P3: the rewritten live-session comments now contain false spatial claims.**

The ticket comment says ticket and spoken “were declared next to each other in the chain” ([routes](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/src/routes.ts:6790)). They were not: the three accounting guards separated them in the parent, exactly as the three table rows do now.

The accounting comment then calls ticket and spoken “the two above” ([routes](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/src/routes.ts:6807)), although spoken is four rows below. “First of the three routes” should also specify “three `/api/chat` routes” if that is the intended count; the documented live surface contains six server endpoints.

Rewrite these references without relative positioning. The other three stale-comment corrections are accurate.

**F12 — P3: the contract edit fails `git diff --check`.**

[The sorted list](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/tests/authenticated-api-route-contract.test.ts:1913) contains trailing whitespace, followed by a misindented `// search` comment. `git diff --check b4bd19c8^ b4bd19c8` exits 2.

## What checked out

- The parent’s final twelve guards are exactly these twelve, contiguous and immediately above the existing table dispatch.
- The rows were prepended above search in the old guard order.
- `CHAT_PATTERN`, `ONE_THREAD_PATTERN`, and all eight inline matchers are byte-equivalent to their old regexes.
- Both pair-key lists contain the same twelve; the order-sensitive list matches the parent chain.
- `chatLive` is consistently classified under `/api/chat`; the three accounting endpoints are under `/api/live`.
- `query` is the same `URLSearchParams` instance created in `serveApi`, included in `request`, and passed unchanged to the table. Every handler destructures exactly what its body uses.
- No current handler-body corruption was found.

## Checks run

Database-free:

- Contract test: **326/326 passed**.
- Documentation links: **14/14 passed**.
- Verifier rerun against the exact parent and candidate blobs: reproduced eleven identical and one refused.
- All three TypeScript projects passed when invoked directly with `tsc`.
- Biome passed the four changed TypeScript files, with the three pre-existing complexity infos.

The database-free registry run reached **338/339** across it and the contract suite; its remaining case could not spawn `tsx` because this sandbox refused its IPC socket with `EPERM`. That was an environment failure before the assertion ran.

`npm run typecheck` hit the same `tsx` IPC refusal; its coverage guard therefore did not run. I did not run any Postgres-backed route tests.

Scope note: `b4bd19c8` also adds the Stage 1 review prompt and answer, although they are omitted from the supplied changed-path list. I inspected them and found nothing additional.

**Verdict: land it with these changes.**