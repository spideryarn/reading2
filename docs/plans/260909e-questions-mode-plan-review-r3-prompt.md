# Round three: the "Questions mode" plan, with the join deleted

You have reviewed this plan twice and returned **not fit to build** both times. Both verdicts were
right. Your reviews are at `docs/plans/260909e-questions-mode-plan-review-sol-r1.md` and `-sol-r2.md`,
committed alongside.

**Round two's P0-1 was accepted in full, and confirmed independently in the source.**
`AttentionItem.id` is `attentionQuestionKey(o)` — a SHA over `[evidence.kind, normalised topic]`,
where `topic` is the classifying model's output — not `dialogFingerprint`. The plan's author had
asserted the equality from `id: group.key` plus a nearby comment without tracing the middle hop. Your
second point, that `dialogFingerprint` omits option consequences and keys and so permits false
matches, is also accepted; the "drift fails safe" argument was wrong in the dangerous direction.

**Your proposed repair — a producer-published per-observation identity — is not taken**, because it
is a `tools/overseer/` change that this session is forbidden to make, and because it turned out not
to be needed. **The join is deleted instead.**

Repository root: `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

Read `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`,
especially § The rule that replaces the join, § The item arms, § Where the composition happens, and
the rewritten Stage 1. § What the reviews changed maps every finding from both rounds to an outcome.

## The new shape, in one sentence

> The pane is the authority on dialogs. The inbox is the authority on prose.

- **Dialog cards** are composed from collector rows alone, admitted only on
  `gate.kind === "conversation"`, and grouped by a key this tab computes in `tools/fleet/` over
  exactly `sameQuestion`'s fields (prompt, material, and every option's label, consequence and key —
  all of which `FleetQuestion`/`FleetOption` carry).
- **Prose cards** are composed from inbox items alone. The only cross-source lookup is
  `sessionId → row`, and it supplies the **address** (`paneId`, `panePid`, `claudeSessionId`) and
  nothing else.
- **The inbox's own `dialog` items are discarded** as a staler second reading of what the pane shows.
- **A prose item whose row is now showing a dialog is dropped from the prose list**, the dialog card
  standing in its place.

## What I want from round three

### 1. Does deleting the join actually remove the problem, or relocate it?

This is the question that matters. Specifically:

- Is the `sessionId → row` address lookup genuinely free of the identity hazard, or is there a way
  for it to attach one session's prose to another session's address?
- Is "a prose item whose row now shows a dialog is dropped" correct, or does it lose a real waiting
  item? Consider a session that asked in prose, then opened an unrelated dialog.
- Is `questionGroupKey` over `sameQuestion`'s fields sound as a **grouping** key (as opposed to a
  safety check)? Note it groups rows within one payload, not across time or across producers. Can two
  genuinely different questions collide, or one question split into two cards?
- **Does discarding the inbox's dialog items lose anything?** The plan claims they are strictly a
  staler reading. Is that true — does the producer's dialog observation carry anything the row does
  not?

### 2. Is the four-arm union now settled and complete?

`dialog`, `dialog-unaddressable`, `prose`, `prose-unaddressable`. Round two found the previous
five-arm set had contradictions and missing states. Name any state that can occur and has no arm, or
any arm that can express something impossible. In particular check the plan's claim that a
`conversation` dialog can never have unreadable material (because `classifyGate` makes such a pane
`unknown`) — is that true on every path?

### 3. Are the gaps now complete, and is the client's downgrade-only rule right?

You supplied the gap list in round two and the plan adopted it verbatim. Please check it against your
own list and against the code, and say whether the client-as-final-authority-on-`complete` rule is
correctly stated. Is there a gap the **server** can see that the client cannot, and vice versa?

### 4. The still-overruled finding

Read-only prose cards remains refused; everything else from your P0-2 is taken (execution-identity
draft key, the status check demoted to a labelled convenience, the risk restated in your words).
**Is the refusal defensible given what the plan now says**, or would you escalate it? Be blunt — this
goes to a coordinator either way, and I would rather carry your objection than my summary of it.

### 5. Stage 1's tests

They are now routed per your round-two correction. Can each one be written against fixtures that
exist? Name any that still cannot, and any dangerous case still missing.

### 6. Is it fit to build now?

Say so explicitly in those words. If not, name the **smallest** remaining change — this plan has had
two full rewrites and I want to build, not to keep polishing. If your remaining objections are
things that could be fixed during Stage 1 rather than before it, say that too.

Do not re-litigate the detector decision or the rewrite chip; both are settled and you agreed.
