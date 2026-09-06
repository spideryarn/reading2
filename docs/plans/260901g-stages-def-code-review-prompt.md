# Review: four callers migrated onto one shared stream-end classification (the built code)

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification`, branch
`worktree-stream-end-classification`. TypeScript + ESM, run with `tsx`, tests with vitest.

This is **round two** of a two-round review. Round one reviewed the *plan* before a line was written
(`docs/plans/260901g-stages-def-review-sol.md`, four findings, all four dealt with). This round
reviews the **code that was built from it**, which is the one that can find a `PATCH` that writes one
field and then rejects the request.

## The candidate

Committed: `359b4ec5`, `31830f73`, `6d813cd6`, then a merge of `origin/dev` at `935c8308`.

```
git diff 2f94ed1b..6d813cd6          # the three candidate commits, without the merge noise
git diff --name-only 2f94ed1b..6d813cd6   # the complete manifest
```

Changed paths (the complete manifest):

```
docs/plans/260901g-one-stream-end-classification-shared-by-five-callers.md
docs/plans/260901g-stages-def-review-sol.md
docs/project/ai-gateway.md
docs/project/comments.md
evals/referee-claims.ts
src/converse.ts
src/referee-claims-run.ts
src/referee-criteria-run.ts
src/referee-mirror.ts
tests/converse-stream-end.test.ts
tests/referee-claims-run.test.ts
tests/referee-criteria-run.test.ts
tests/referee-mirror-stream-end.test.ts
```

`935c8308` merges 265 commits of `origin/dev` on top, cleanly and with no conflicts. `origin/dev`
independently changed `src/converse.ts` (a `help` prompt section, and `searchCount` becoming
`whereSearchCountCameFrom`). **The merged working tree is what is deployed, so review that** —
`git show HEAD:src/converse.ts` — and treat the auto-merge itself as something to check rather than
trust.

Start with `src/converse.ts` (the round loop and everything after it) and `src/ai-call.ts`
(`classifyEnd` and `StreamOutcome`, which this change does not modify but does rely on). That is
where to begin, not the limit of scope — the manifest above is.

## What it is meant to do

`classifyEnd` in `src/ai-call.ts` turns one finished `openRouterStream` run into a `StreamOutcome`
discriminated union. Seven production callers stream a model call; before this change four of them
still re-derived that judgement locally, from three signals, a boolean and a string, in a
byte-identical sequence containing the guard

```ts
if (!stopped && !end.terminated && finishReason === null) { /* fail the stream */ }
```

which is a **conjunction a non-null finish reason can only ever make less likely to fire** — so no
value of `finish_reason` had ever failed a stream in any of them, while a comment beside it called
`finish_reason` "a second witness". That sentence was written once on 2026-08-26 and copied verbatim
into six more files over six days:
`docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md`.

This change moves the last four — `converse.ts` and the three `referee-*` runners — onto
`classifyEnd`, plus `evals/referee-claims.ts`.

**Two contracts the migration must not break, and they pull in opposite directions:**

1. **Classification is shared; policy is not.** Each caller legitimately means something different
   by `finish_reason: "length"` — fatal to a quiz mark, success-with-a-flag to chat, left to the
   strict parse by the four JSON callers, stored whole by explain. A shared classifier that threw on
   `length` would break six callers to fix one. So each caller `switch`es with a `never` default and
   keeps **its own** stop/persist policy. A finding that two callers should agree about a policy is
   a finding against the design, not a bug — say so explicitly if you make one.
2. **One classification per provider *round*, folded into a verdict per *turn*.** `converse` makes up
   to `MAX_TOOL_ROUNDS + 1` requests per turn and rebuilds `end` at the top of each. The last
   round's finish reason must not erase an earlier round's truncation.

**Deliberate behaviour changes** (there are exactly two kinds, and both are argued in the commit
messages):

- `finish_reason: "error"` now throws `providerFailedMidAnswer()` in all four. Each already threw
  exactly that for the same event arriving as `chunk.error` **data**.
- `truncated` in `converse` gains a second disjunct: the last round's verdict (today's reading,
  unchanged) **or** any round that ran out of room *having written prose*.

**Deliberately out of scope:** the transport half of the shared-gateway work (key, endpoint, headers,
clocks, accumulation); `explain`'s truncation *policy* (a truncated explanation is still stored as a
whole comment — that is a product decision about what a reader is shown and it is Greg's, not an
agent's); folding the spend ledger's own coarser end-of-stream verdict in `ai-call.ts` into
`classifyEnd`.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/converse-stream-end.test.ts`) and a script (`node --import tsx <script>`), and
you can build a throwaway harness under `/tmp`. You have no network, not even loopback, so anything
needing Postgres or a local service will skip.

Round one could not start vitest at all (`node_modules/.vite-temp` absent, filesystem refused to
create it), so every finding it made was reasoned rather than reproduced. **Try again** — the
worktree's `node_modules` is freshly installed. If it still refuses, say so, and the finding stays
reasoned.

**What I ran, and the raw results.** Full output at
`/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/docs/plans/260901g-stages-def-test-evidence.md`.
It includes the five red-first mutations I performed myself against the built code — turning each
`throw providerFailedMidAnswer()` in the switch back into a `break`, dropping the second `truncated`
disjunct, and dropping the prose guard — with the exact assertion each turned red.

## Attack it

Independently, before you read my questions below.

**The invariant to break:** *no ending a provider or our own clocks can produce reaches a caller's
success path unless that caller wrote a case saying it should.* Find an input — a frame sequence, a
signal ordering, a round ordering — where a truncated, filtered, errored, abandoned, timed-out,
stalled or unterminated stream is still delivered as a finished answer, or where the reverse happens
and a whole answer is thrown away.

Second target: **the fold**. `converse`'s two round-scoped variables (`lastRoundRanOutOfRoom`,
`aRoundRanOutOfRoomMidProse`) claim to be strictly additive over the old reading. Find a turn where
they are not — where the new `truncated` is `true` and the stored answer did not stop mid-sentence,
or `false` where it did.

Third target: **the auto-merge at `935c8308`**. `origin/dev` moved code inside `converse`'s round
loop (the `searchesFrom` bookkeeping) while this branch moved the code immediately after it. Git
merged both without a conflict. Check the result reads correctly as a whole.

For each finding give:
  - an ID (**F5, F6, …** — F1–F4 are round one's and are listed below; number new ones above F4),
    a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
  - (a) what shows it fails its own claim — the input or mutation I can run
  - (b) the smallest change that closes it — a code block, or exact replacement wording

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it.

## Previous findings (round one, on the plan)

Treat the fixes as unreviewed code written by someone else, and spend most of the run on what has
changed since.

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | "`stopped` cannot be derived only from the round's `StreamOutcome`. A reader can stop after a round has classified as `wants-tools`, while its tool batch is running." | fixed | The two `stopped` assignments inside the tool batch stay; only the `catch` and the post-stream signal-only test became one reading of the round's outcome. `src/converse.ts` § `case "abandoned"` and the two `readerAborted` checks in the tool loop. |
| F2 | "the sticky `truncated` fold is reachable, but 'any truncated round' is not the right public policy as written… A sticky fold yields `truncated: true`, while the stored answer itself did not stop mid-sentence." | fixed | The fold became two disjuncts, the second guarded on `roundText.trim() !== ""`, both under `!stopped`. A control test pins the over-reach and goes red if the guard is removed. |
| F3 | "`StreamOutcome` still cannot express an in-band `chunk.error`… A parseable claims payload, followed by a truthy `chunk.error`, followed by `[DONE]`, would classify `finished` and still pass the proposed check." | fixed | `evals/referee-claims.ts` throws on `chunk.error` inside its loop as well as classifying after it. The limitation is written into `docs/project/ai-gateway.md` § How a stream ends. |
| F4 | "changing `evals/referee-claims.ts` is scope expansion, not mechanical unforking." | disagreed, done anyway | Six lines, and the hole is the exact class this plan exists for. Recorded in the plan. |

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself. Spend
most of the run elsewhere.

- The `case "abandoned"` log line in `converse` moved from the `catch` (which ran *before* the round's
  usage was banked into the turn totals) to the switch (which runs *after*, and after `usage =
  undefined`). I convinced myself `turnSoFar()` reports the same numbers either side, because it adds
  the pending `usage` when it has not been banked and `sawUsage` is set at banking time. Check that.
- `noteRound()` now reads `end.finishReason` rather than a local copy, and it is called from both the
  `catch` and the `finally`. `end` is a fresh object per round, so a stale reason should be
  impossible — but `openRouterStream` writes onto the object it is handed, and I have not checked
  what happens if a round throws before `openRouterStream` writes anything.
- The three referee files moved their clean-abort log line out of the `catch` and into
  `case "abandoned"`, which means a clean abort can now emit that line **and** one of the specific
  abandonment lines below it. I believe that pairing is not new (it is what the throwing path always
  did) but I have not traced every path.
- `converse` treats `filtered` (`content_filter`) as an ordinary answer, unchanged from before. I
  think that is right to leave alone — it is a product decision — but if you think a reader is being
  misled today, say so and I will put it to Greg rather than decide it.
- `unknown-finish-reason` is accepted as a clean stop in all four, on quiz-mark's deny-list
  reasoning. That is a real trade and I would like it pressure-tested once.

Do not change any file.
