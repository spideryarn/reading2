# Plan review: 261003a GPT-Live alongside Realtime

Read-only review. Do not change any file.

Review `docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md` at the current
HEAD of this worktree, before anything is built from it.

Read first: the plan; `docs/project/live-conversation.md`; `src/live.ts`;
`src/web/live/useLiveConversation.ts` (the `LiveApi` shape and lifecycle);
`src/chat.ts` `withSpokenTurn`; `src/converse.ts` `recentHistory`; the `realtime_sessions` and
`ai_calls` tables in `src/db/schema.ts`; `acceptRealtimeUsage` in `src/live.ts`;
`evals/live/gpt-live-spike/README.md` and the traces beside it (real GPT-Live events — the
evidence for Stage 0; `spike-out-allow.json` is the allowlisted shape, `spike-out-allowmin.json`
the run with no output transcript).

You gave a design consult on this earlier today. The plan follows most of it and passes over three
recommendations, each named in the plan with a reason: segment storage (your R5) in favour of the
existing question/answer pairs; server-side tool execution receipts (R2); and the acoustic part of
the spike (R8), which no automation tab can do. Say whether each of those is a mistake that will
cost a stage, not merely whether you would have chosen differently.

Severity scale: P0 = the plan will produce something wrong or unshippable; P1 = will cost real
rework inside a stage; P2 = worth noting. Give every finding an id (F1…), the plan section it is
about, and what you would change. You may run `node --import tsx <script>` on a script that needs
no network or database; nothing here needs that.

Look hardest at:
- The fragment → exchange segmentation: can it store an answer under the wrong question, lose
  words, or write an exchange twice, given `expectedTailId` and serial appends? What happens to a
  reader who interrupts with more than four words while the companion is speaking?
- Whether passages and tool runs attached by `session.delegation.created.offset_ms` land on the
  right exchange.
- The meter: the high-water-mark design, the order "journal the row, then create", and what a
  session created but never connected costs and records.
- Journalling before OpenAI's create versus after: is the reversed order right?
- Anything in the lifecycle table of `live-conversation.md` that the plan says is reused and is in
  fact Realtime-specific.
- The stage boundaries: can each land green on its own and be abandoned there?

My own suspicions, last so they do not steer you: the settle rule ("nothing for a few seconds and no
delegation outstanding") may write an exchange before a slow backend answer is spoken; and the
engine choice living in `localStorage` while the experimental switch lives on the server may leave
a reader on GPT-Live after turning the switch off.

End with a verdict line: build as written / build with the P0-P1 changes / do not build.
