The overall design is sound, but the proposed “end the turn” shortcut is not safe as written. The surrounding accounting and persistence do not require a final model round; the completion test is the problem.

The worktree already contains an uncommitted partial implementation, so I used that to verify the plan’s assumptions. I made no edits.

### Findings

**F1 — P1: “answer so far is nonempty” can finish an incomplete answer**

The proposed break checks the whole turn’s accumulated `text`, not the prose written in the current round ([src/converse.ts:3605](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3605)). For example:

1. Round 1 writes “Let me check that…” and calls a search tool.
2. Round 2 writes nothing and calls `offer_next_steps`.
3. `text` is nonempty because of round 1, so the turn ends with only the preamble and buttons.

This contradicts the plan’s claim that the model has necessarily “written its answer” ([plan:144](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/plans/261009r-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md:144)). Using `roundText` would catch this particular bug, but even nonempty current-round prose could merely be “Here are some options:”; nonempty text is not proof of semantic completion.

Recommendation: remove the special terminal break for v1. Let the tool result tell the model not to repeat anything and allow the ordinary follow-up round. That technique already reduced duplicated `offer_to_save` answers from 9/14 to 0/14 ([precedent plan:225](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:225), [precedent plan:277](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:277)). It is the safer 80/20 design.

**F2 — P1: the shortcut ignores whether the offer succeeded, and mixed tools receive contradictory instructions**

The break is based only on requested tool names. If every proposed step is invalid, the tool correctly returns no `steps` and says no buttons were shown ([src/chat-tools.ts:2260](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/chat-tools.ts:2260)), but `converse` still ends without letting the model hear that refusal. The same happens if the tool unexpectedly throws: the run becomes an error at [src/converse.ts:3550](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3550), yet the name-based terminal check still succeeds.

`offer_to_save` is not skipped when it appears in the same batch because `wanted.every(...)` is then false. However, the next round receives conflicting results:

- `offer_next_steps`: “write nothing more” ([src/chat-tools.ts:2271](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/chat-tools.ts:2271))
- `offer_to_save`: mention the save button and continue if needed ([src/chat-tools.ts:2239](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/chat-tools.ts:2239))

That can suppress the save explanation or reproduce the duplication problem. The plan’s assertion that the next-step sentence also works when called alongside another tool is therefore wrong ([plan:148](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/plans/261009r-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md:148)).

Recommendation: remove the early end and give `offer_next_steps` the same conditional no-repeat wording as `offer_to_save`: everything before the call is already visible; do not repeat it; stop if complete, otherwise continue only where necessary. Also tell the model to call next steps only after other tools have resolved.

**F3 — P2: server-valid mode steps are not necessarily drawable**

`guideModeKeys()` accepts experimental modes ([src/guide.ts:115](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/guide.ts:115)), while the existing mode prompt explicitly says experimental modes have no button token and must only be named in words ([src/guide.ts:53](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/guide.ts:53), [src/guide.ts:81](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/guide.ts:81)). Thus the tool can report “the reader now sees N buttons” for a mode that `chipFor` subsequently refuses.

The partial renderer compounds this: `stepsIn` accepts the mode structurally, then `Step` returns `null` inside an already-created `<li>` ([src/web/GuideNextSteps.tsx:63](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/GuideNextSteps.tsx:63), [src/web/GuideNextSteps.tsx:139](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/GuideNextSteps.tsx:139)). All refused modes can therefore leave an empty “Next steps” group.

This is not a security bypass—`chipFor` still refuses the action—but it is silent success.

Recommendation: for v1, server-valid modes should be only the ordinary, token-bearing catalogue modes. On the page, resolve/filter drawable steps before producing `<li>` elements and return `null` if none remain. Tool-result wording should say “accepted” rather than claiming buttons are visible when availability is decided in the browser.

**F4 — P2: an `ask` press promotes model-authored text into trusted reader history**

An `ask` button sends its model-written words directly through `onAsk` ([src/web/GuideNextSteps.tsx:133](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/GuideNextSteps.tsx:133)). On the next turn it is replayed simply as a `user` message ([src/converse.ts:2334](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:2334)), while the prompt says only the reader’s messages may authorize save offers or next steps ([src/converse.ts:1756](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:1756), [src/converse.ts:1787](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:1787)).

A hostile article still cannot cause an unpressed action: the reader sees and presses the exact words, and later writes still require another press. But after that press, provenance has been flattened—the next model cannot distinguish words the reader typed from words the previous model suggested. That weakens the plan’s “reader’s own messages” security argument.

Recommendation: explicitly define an `ask` press as reader approval of those exact visible words, label it unmistakably as “Ask: …”, and add adversarial evaluation cases where article text tries to manufacture ask/search/share/archive steps. Do not treat a suggested ask as evidence of personal facts suitable for `offer_to_save` unless those facts appeared in genuinely reader-authored text. If that distinction cannot be preserved cheaply, prefilling the composer is safer than immediately sending.

**F5 — P2: the fixed Archive wording is false on an already archived article**

The plan always labels the navigation step “Archive this article…” ([plan:133](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/plans/261009r-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md:133)). Existing command code deliberately switches between “Archive this article” and “Put this article back”, because the fixed wording would lie half the time ([src/web/article-commands.ts:166](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/article-commands.ts:166), [src/web/article-commands.ts:188](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/article-commands.ts:188)).

Recommendation: either omit `archive` from the 80/20 version or use a neutral navigation label such as “Open article options…”. Do not introduce a second archive-state/controller path merely to preserve the fixed label.

**F6 — P2: the planned tests do not protect the fragile turn invariants**

The plan currently asks only for “text versus no text” and “another tool” tests ([plan:214](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/plans/261009r-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md:214)). The partial mixed-tool test checks only that two HTTP requests occurred, not what answer or offers survived ([tests/guide-next-steps-tool.test.ts:149](/var/tmp/spideryarn-worktrees/guide-action-buttons/tests/guide-next-steps-tool.test.ts:149)).

Add regression cases for:

- Earlier-round prose plus an empty `offer_next_steps` round.
- An all-invalid offer and a thrown/error outcome.
- `offer_to_save` plus `offer_next_steps`: both runs survive, the save card survives, and prose is not duplicated.
- A terminal round reporting usage; totals include it.
- `max_tokens` on the tool-calling round remains `truncated`, with no actionable row.
- Stop before and during the tool batch.
- Stored `ToolRun.steps` surviving reload.
- Later history containing the flattened answer once, with no dependency on replaying tool protocol.
- An older row disappearing immediately when a new turn becomes pending.
- No auto-act when a mode step mounts.
- Edited search words, double press, failure status, and the existing “generates” marker.

**F7 — P3: important UI boundaries should be explicit acceptance criteria**

The partial implementation correctly places next steps outside `GuideActContext` and hides them while a newer answer is pending ([src/web/ChatPanel.tsx:2045](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/ChatPanel.tsx:2045), [src/web/ChatPanel.tsx:2092](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/ChatPanel.tsx:2092)). Those are correctness and security boundaries, not incidental layout.

It also correctly composes editable search with `CommandChip`, preserving its second `chipFor` check, single-flight guard, spinner/error handling, and generation marker ([src/web/CommandChip.tsx:141](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/CommandChip.tsx:141), [src/web/CommandChip.tsx:180](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/CommandChip.tsx:180)).

Recommendation: state both as plan acceptance criteria and test them. Do not implement a separate quick-search runner that merely calls `chipFor`; reuse `CommandChip` as the draft does.

### End-turn audit

Nothing appears to require a final no-tool model round mechanically:

- Each request records spend independently ([src/converse.ts:3022](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3022)).
- Usage is added before tools and before the proposed break ([src/converse.ts:3196](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3196)).
- Finished runs are yielded before the break ([src/converse.ts:3568](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3568)).
- Stops are checked before and after the batch ([src/converse.ts:3475](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3475), [src/converse.ts:3589](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3589)).
- Truncation is folded across every round ([src/converse.ts:3644](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3644)).
- The done event carries answer, runs, state, and usage ([src/converse.ts:3750](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:3750)); the route stores those runs ([src/routes.ts:3906](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/routes.ts:3906)).
- Later turns replay settled `role`/`text`, not provider tool-call messages ([src/converse.ts:2334](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:2334), [src/converse.ts:2519](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:2519)).

So the final-round removal is structurally compatible with accounting, storage, stopped states, truncation, and history. It is unsafe because it cannot reliably know the reply is complete or that the proposed controls exist.

**Verdict: build with changes.** Keep the guide-only typed tool, press-only controls, existing `runTool`/`chipFor` defences, and current component reuse. Remove the special end-turn shortcut for v1, resolve the mixed-tool wording, restrict/filter mode steps, and add the missing adversarial and multi-round tests.