# Fourth look at stage 2, and a first look at stage 3

You refused stage 2 three times. `DO NOT SHIP` and your three findings are in
`docs/plans/260828v-chat-operation-model-stage2-third-sol.md`, against `80e7190`. All three are addressed in
`c7adf8b`, with a comments-only follow-up in `d15f8cc`.

Review `git diff 80e7190..HEAD -- src/web/chat src/web/useChat.ts tests/chat-*.ts
tests/helpers/chat-reduce.ts` — 7 files, +1163 / −177.

## Your findings, verbatim, and what was done

> **P1 — the repair rule is narrowed again, not closed.** … `touched` describes row replacements, not
> the full class of later mutations: append, replace, truncate, and recreate-after-absence. The class
> remains open.

`touching()` and all four of its call sites are deleted. Nothing now models which rows moved.

A `RepairOperation` captures `saw: ChatThread | null` — the thread object as it stood in `base` at the
moment the request went out (`reduce.ts` ~line 869). When the response arrives, the check is one
reference comparison (`reduce.ts` ~line 1028):

```ts
if ((retired.base.find((t) => t.id === op.threadId) ?? null) !== op.saw) { /* drop the repair */ }
```

The reducer never mutates state, so any write into that conversation — append, replace, truncate,
delete-and-recreate, or a kind nobody has thought of yet — produces a different object, and the
repair is dropped. It covers your four shapes because it models none of them. There is no call site
to remember at when a sixth way to write a conversation is added.

The property the argument rests on — that the reducer never mutates — is now enforced rather than
assumed: `tests/helpers/chat-reduce.ts` wraps state in proxies that throw on any mutation, and
`twice()` runs every transition twice and requires the same result.

> **P1 — the single supersession rule over-applies to `turn.began`.** … So "superseded means does
> absolutely nothing" is too broad. A superseded turn's naming event may still be required by the
> operation that superseded it.

Agreed, and taken as narrowly as I could make it. A superseded operation still retires and still does
nothing — **except** that a `turn.began` first applies its renaming (`names(event)`), so `base`,
tombstones and every operation follow the server's real id, and then retires silently. Commands
already emitted with the provisional id cannot be recalled, so rename and delete commands whose
target has just been renamed are re-issued against the corrected id.

> **P2 — supersession does not always transfer tombstone ownership.**

Tombstone ownership transfers on supersession, not only on replacement. `Tombstone.by` carries the
owning operation, and the superseding operation takes it over whether or not the first was still
waiting, so a second failure can lift the first's tombstone.

## Evidence

26 chat suites, 344 tests, green. Typecheck's only error is a peer session's
`tests/glossary-ideas-baseline.test.ts`; nothing in chat.

I probed the identity check in both directions, because a rule that refuses everything also passes
every "does not put X back" test:

- **Disabling it** reddens four, one per shape you named: a retry's old answer restored, an edited
  question put back, a recovery undone, and a conversation the reader had added to removed outright.
- **Forcing every repair stale** reddens three, so it cannot pass by refusing everything.

My first attempt at that probe reached nothing — the test imports `twice` from
`tests/helpers/chat-reduce.ts`, and the helper still pulled in the real reducer, so 59/59 passed on a
sabotaged copy nothing imported. Third time today a probe of mine has silently missed. If you find a
guard here that looks untested, suspect my instrument before the test.

## Stage 3, which you have not seen

`tests/chat-invariants.test.ts` — seven invariants written as permutations rather than scripted
cases. Two are narrower than you wrote them and the file says which and why. One permutation found a
live bug: a stop and a cancel on the same row sent a `/stop` for a conversation being discarded,
whose failure would have written over a discard that worked.

Not in stage 3: the rename fence (`expectedTitle`, so the server can refuse a stale `PATCH`) needs a
server change and is recorded in the plan as out of scope.

## What I need judged

- **Finding 1: closed, or narrowed a fifth time?** This is the judgement I most need. If the identity
  rule is unsound, the failure should be a case where the same conversation object survives a change
  the repair must not undo, or a different object appears where nothing meaningful changed.
- Finding 2's exception: is `names(event)` the whole of what a superseded `turn.began` must still do?
- Finding 3: does ownership now transfer everywhere it must?
- **Is stage 2 done?** And are the seven invariants a fair reading of what you asked for?

Read-only. Change no file. Say plainly whether it ships.
