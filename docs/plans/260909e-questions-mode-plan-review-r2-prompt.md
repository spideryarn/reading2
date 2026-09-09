# Round two: the revised "Questions mode" plan

You reviewed the first draft of this plan and returned **not fit to build**. Your review is at
`docs/plans/260909e-questions-mode-plan-review-sol-r1.md` and is committed alongside the revision.

The plan has been rewritten. **Nine of your ten findings are accepted; one is split.** Please review
the revision.

Repository root: `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

Read:

1. `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md` —
   the revision. Its § What the review changed maps each of your findings to an outcome.
2. Your own round-one review, for what you said.
3. Whatever source you need to check the claims below.

## What I want from round two, in priority order

### 1. Did the revision actually fix what you found, or only describe fixing it?

Go finding by finding. In particular:

- **P0-1 (the join).** The revision joins on the question fingerprint, arguing that
  `AttentionItem.id` *is* `group.key` *is* `dialogFingerprint(q)`, and that `material.fingerprint` is
  minted by `tools/fleet/pane.ts` — our own side — so re-deriving the same string in `tools/fleet/`
  is safe, and drift fails safe (a mismatch withholds the ranking rather than misattaching it).
  **Is that argument sound?** Specifically: is `AttentionItem.id` really the fingerprint on every
  path, including the `prose` path and the no-material fallback? Is there an input to
  `dialogFingerprint` that a `tools/fleet/` re-derivation cannot see?
- **P0-3 (the empty list).** Is `complete` / `partial` (non-empty `gaps` tuple) / `not-observed`
  sufficient, and is the list of gap causes complete? Name any silence that still has no home.
- **P1-3 (permission dialogs).** The fix is to admit a row-only dialog only when
  `question.gate.kind === "conversation"`. Is that the right predicate, and does it match what
  `grantsPermission` actually excludes?

### 2. The one finding I overruled — argue back if you still disagree

Your P0-2 remedy was read-only prose cards, or a new guarded prose-answer operation with a tail
fingerprint re-checked at send time.

I accepted the diagnosis and built three of its consequences (draft-keying by session + question
identity, a local staleness refusal when the row's status moves, and the excerpt drawn at full size
above the box). I refused the remedy: read-only prose removes half of what the user asked for and ten
of the fifteen genuinely-waiting sessions, and the guarded operation is a `steer.ts` / `routes-steer.ts`
write path that this session is explicitly not allowed to touch.

**Two things I want from you here.** First: is the residual risk stated correctly in § Answering a
prose item, or is it worse than I have written it? Second — and this is the more useful one —
**is the local staleness refusal actually worth anything**, or is it security theatre? It compares the
row's status against the status the item was composed from, using only payload data. Say plainly if
it buys nothing.

### 3. What the revision introduced that was not there before

A rewrite is a good opportunity to add a new defect. Please look for:

- states the new five-arm `QuestionItem` union can express that cannot happen, or that can happen
  and it cannot express;
- anything in § The item arms that contradicts § What can actually be answered, and where;
- whether "publish a reconciliation, not a copy" (P2-1) is actually achievable given the panel needs
  the question text and options to draw buttons — or whether it will quietly become a copy again;
- whether Stage 1's test list, which is now yours, can be written against the fixtures that exist.

### 4. Is it fit to build now?

Say so explicitly, in those words, and if not, say what the smallest remaining change is. If it is
fit to build, say whether you would change the stage boundaries.

Do not re-litigate the detector decision — you agreed with it and so did the other model consulted.
