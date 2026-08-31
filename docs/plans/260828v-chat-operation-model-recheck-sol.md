## Verdict: do not start stage 1 yet

The controller is the right choice, and the three-stage sequence is sound. Four plan details still block implementation as written.

1. Define operation creation separately from result admission. The gate rejects an event whose operation does not yet exist, so it cannot create load, rename, or delete operations itself ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:35>)). Specify ungated input events that register operations, and gated result events that all pass through the single lookup.

   Also state where settled load status lives. The drawn state has no `loadPhase` ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:54>)), although `loaded` and `loadFailed` must remain distinguishable. Either retain a terminal load operation or add durable load status.

   The 409 refresh also needs an identity: either add `RepairOperation` or define `LoadOperation` as scoped to initial-list or one-thread repair. Dropping the turn and registering that repair must be one synchronous transition; its eventual response then uses the same gate.

2. Make the stage-1 compatibility boundary implementable. The plan says the controller alone fetches, streams, and times ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:46>)), while stage 1 leaves `run`, recovery, and repair operating through the hook ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:129>)). Treat “controller owns every effect” as the stage-2 end state and explicitly permit the stage-1 bridge.

   More concretely, `legacy.apply` only updates `base`, but stage 1 also removes `gone`. Today cancel adds a tombstone, its failure removes it, and every late patch consults it ([useChat.ts](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1009>), [useChat.ts](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1021>), [useChat.ts](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:822>)). Add explicit stage-1-only events for cancel tombstoning/rollback and legacy errors, or keep the relevant ref until stage 2. A base updater alone cannot replace it.

3. Define how operations retire, not merely how live operations project. “Creation order” only answers while both operations remain ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:217>)).

   Example: rename A, then rename B; B completes first. If B is committed and removed, A becomes the top projection and the title visibly regresses. Choose supersession or ordered folding, and test reverse completion order. This affects stage 1 immediately.

4. Move the early stop/cancel tests into stage 2. Stage 2 rewrites `turn.began`, removes `attempts`, and moves command delivery—the exact machinery that currently consumes those wishes ([useChat.ts](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1312>)). Yet the only direct tests are deferred to stage 3 ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:203>)); grep confirms none exist today.

   Stage 2 is a coherent release boundary precisely because turn, recovery, and 409 move together. I would not split that coupling again. Use internal checkpoints, but require before stage 2 can ship:

   - stop-before-`begin` and cancel-before-`begin`;
   - disconnected turn → exactly one recovery writer;
   - 409 drops the turn and gates the repair;
   - reverse completion of two operations in one conversation.

The controller itself is not over-engineering. It directly replaces `latest`/`onScreen`, keeps command emission outside React scheduling, and makes the early-intent window testable. With the four clarifications above, stage 1 is fit to start.

No files changed.