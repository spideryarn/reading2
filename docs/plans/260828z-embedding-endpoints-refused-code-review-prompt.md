# Review the built code: typed embedding failures

Second review, of the code rather than the plan. You reviewed the plan an hour ago; your answer is
`docs/plans/260828z-embedding-endpoints-refused-sol.md` and the diagnosis is
`docs/plans/260828z-embedding-endpoints-refused.md`. Read-only, in `spideryarn2`. Read `CLAUDE.md` first.

The scoped diff is at
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/3b06dd3f-e4b5-46d0-945f-d5c68a83bb84/scratchpad/emb.diff`
— but **read the files in the working tree**, because several are being edited by other agents at
the same time and the diff carries their hunks too.

## What was built, from your findings

1. **`EmbeddingFailure` with a `reason`**, in `src/embeddings.ts`, replacing the string-prefix
   `isProviderFailure`. Three reasons: `config` (the account may not use the model, or no key —
   permanent), `provider` (refused, unreachable, or answered with something that is not vectors),
   `busy` (`MAX_INFLIGHT` in `src/article-vectors.ts`, our own admission control). Every throw
   inside the embedding boundary is typed, **including the bare `TypeError` from a `fetch` that
   never connected** — the gap you found.
2. **The union lives in `src/types.ts`, not `src/embeddings.ts`.** This was forced:
   `tests/client-imports.test.ts` fails a shared module importing a non-shared one *even
   type-only*, and `messages.ts` is shared. `embeddings.ts` re-exports it. Is that the right home,
   and is the re-export pulling its weight or is it a second name for one thing?
3. **Three sentences in `src/messages.ts`** (`PLACING_NOT_CONFIGURED`, `PLACING_UNREACHABLE`,
   `PLACING_BUSY`), registered in `CODE_KINDS` as `ai-embed-account` (ours), `ai-embed-down`
   (retry), `ai-embed-busy` (retry), with a total map `placingFailed(reason)`. `[emb1]` and
   `[emb2]` are gone rather than kept as legacy aliases — you advised keeping them; I dropped them
   because you also established nothing persists them, and grep agrees (they appear nowhere but
   `routes.ts` and old review logs). **Tell me if that reasoning is wrong.**
4. **One `embeddingHttpError(err, slug)` in `src/routes.ts`**, used by both the `similar` and
   `projection` routes, so they cannot diverge again. Non-`EmbeddingFailure` errors are returned
   untouched to reach the catch-all. `busy` → 503, the other two → 502.
5. **`src/web/DiagramPanel.tsx`**: both strips now put the consequence first and the server's
   sentence (ending in its code) last, and Force uses `similar.error` instead of a fixed sentence.

## What was verified, and how

- Two new tests in `tests/embeddings.test.ts` were **run red against the old code and green against
  the new** — I put the two old lines back, watched exactly those two fail, and restored.
- The real path was run against a local article with the working key: 34 blocks, k=3, 34 points,
  1.5s.
- Production's exact failure was reproduced locally by stubbing `fetch` with the guardrail 404 and
  calling `projectArticle`: `reason: config`, `kind: ours`, `worthRetrying: false`, and the reader
  sentence is the `[ai-embed-account]` one while the log keeps the operator detail.
- `npm run typecheck` clean across all three projects; `cycles` clean; the affected test files pass.
  The suite has unrelated failures from other agents' in-flight edits.

## What I want from you

1. **Anything actually wrong in the diff.** Particularly: is every throw inside the embedding
   boundary now typed, or did I miss one? Is there a path where an `EmbeddingFailure` is
   double-wrapped, or where one escapes with the wrong reason — an abort caused by the *caller*
   navigating away being filed as `provider`, for instance? `article-vectors.ts` passes no signal
   today; does that make the claim safe or merely currently true?
2. **The reason taxonomy.** Three, and `config` covers both "no key" and "account not allowed".
   Right call, or does the reader (or the operator) need those apart?
3. **The wording**, against `docs/project/copy.md`'s four rules. Especially `PLACING_BUSY`, which
   is ours and must not read as the AI service's fault, and `PLACING_NOT_CONFIGURED`, which must not
   read as something the reader can retry past.
4. **`embeddingHttpError` returns the error rather than throwing it**, and both call sites do
   `throw embeddingHttpError(...)`. Is that clearer than a `handle`-and-rethrow, or is it the kind
   of cleverness that reads wrong at the call site?
5. **The status codes.** 503 for `busy`, 502 for the other two. Is 502 right for `config`, given
   the fault is ours and not upstream's?
6. **What is still missing.** The deploy-time probe from your last review is *not* built — it needs
   a shared secret that only Greg can provision, so it is written up as the open item. Is there a
   smaller version of it worth landing now with no new secret? And is there anything else in the
   diff that should have been done and was not.

Be blunt about what is wrong. A shorter list of real findings beats a longer list.
