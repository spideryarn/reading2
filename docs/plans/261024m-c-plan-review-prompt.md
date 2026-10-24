# Plan review, round 2: 261024m revised for option C — resting on a citation starts *Does it say that?* and streams it into the card

You are reviewing a PLAN, read-only. Repository: this worktree (Spideryarn: TypeScript, Express server in `src/`, Postgres via Drizzle, React client in `src/web/`). Base commit: the worktree's HEAD. The candidate is the working-tree edits to `docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md` (tracked; `git diff HEAD -- <that file>` shows the change) plus these untracked files: `docs/investigations/261024d-does-it-say-that-cost-and-latency.md` (the cost measurement; read it as a reviewer of its conclusions too) — and `scripts/spikes/261024q-does-it-say-that-cost.ts` (the script that produced it).

Read the plan's new top half first (§ Greg's answer, § What we build: option C). The bottom half is the earlier plan and your own round-1 review (`docs/plans/261024m-plan-review-sol.md`), kept as history; Greg answered the question it led to with "C. Make it a main rather than experimental feature".

Read, at least:
- `src/routes.ts` § `streamChat` (around 3392–4292), `parseOrigin` / `parseItemOrigin` (~5370–5440), the chat routes (~13490–13700), `CHAT_ORPHAN_GRACE_MS` and the disconnect handling
- `src/chat.ts` (`withTurn`, the title), `src/thread-origin.ts`, `src/types.ts` § `ThreadOrigin`, `ORIGIN_MODES`, `sameOrigin`, `src/db/schema.ts` § `chatThreads` and its origin CHECKs
- `src/web/chat/effects.ts` (`runTurn`, `TurnSink`, `settledAnswer`), `src/web/useChatAnchors.ts` (`threadForOrigin`, summaries), `src/web/reader/Reader.tsx` § `checkCitedWorkInChat`, `askPassageInChat`, `reopenItemChat`, `handedItemChats`
- `src/web/ProseHoverCard.tsx` § `CiteCard` and its call site (~848), `src/web/useHoverCard.ts` (open delays, touch, keyboard)
- `src/help-chat-call.ts` § `HELP_CHAT_RATE_POLICY` / `admitHelpChat` (the allowance pattern), `src/store/contracts.ts` § `RateBucket`, `src/store/pg-rate-limit.ts`
- `docs/project/security-map.md`, `docs/project/cost-tracking.md`, `docs/project/block-ids.md`

Questions:
1. Does the design deliver what Greg chose (option C, for everyone) with the cost controls the brief lists, and is anything in "What the reader sees" wrong, missing, or likely to surprise a reader (touch, keyboard, warm swaps, leaving mid-stream, a second tab, a cap)?
2. The identity: a new `cite-check` origin mode plus a partial unique index, versus the alternatives in § Simpler options passed over. Is the key durable? What does the unique index do to the existing `begin` path (where would a unique violation surface, and inside which transaction/lock)? Deleting the thread, retry, edit, delete-from on such a thread — anything that breaks?
3. The route changes: are the checks in the right order (nothing spent before every refusal), is `auto: true` as the switch for the allowance sound, and is it acceptable that a press is never capped (chat turns have no limiter today)? Does anything here weaken a defence in security-map.md? (If it does, say so plainly: such a choice goes to Greg, not to me.)
4. The client loader: running the stream outside React so it survives the card closing; at most two in flight; reusing `runTurn`; telling chat summaries about the new thread. Races with Chat's own band/dialog if the reader opens Chat mid-stream (Chat would see a `pending` row and start its recovery poll — fine, or a conflict?).
5. The caps against the measured cost: are 10/hour, 25/day per reader, 150/day global, concurrency 2 sensible given the investigation's figures? Is the investigation's method sound (cold vs warm, what it does not show)?
6. Anything in the plan that is wrong about the codebase, and any smaller version that gets most of the value.

Severity scale: P0 (would ship broken or unsafe), P1 (must fix before building), P2 (should fix), P3 (nit). Give each finding an ID (C1, C2, …), a severity, the evidence (file:line), and the fix. End with a one-paragraph verdict.

## My own suspicions (already mine; spend most of the run elsewhere)

(a) The unique index may fight `chatStore.begin`'s existing id-overrule logic. (b) Running `runTurn` outside Chat may skip something Chat's controller does after a turn (gist refresh is server-side; but the summaries refresh, the `handedItemChats` entry, the thread title). (c) On touch, 2 s after a tap may be too eager — every tapped citation spends. The sentence I would least like to be wrong about: "Closing the card does not stop the chat: the server always finishes and saves a turn whose client went away."
