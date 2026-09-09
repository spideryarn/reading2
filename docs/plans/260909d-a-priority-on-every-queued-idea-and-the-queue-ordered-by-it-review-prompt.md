# Review this plan before it is built

You are GPT Sol, doing a cross-family review for a repo where you have already reviewed the module
this plan extends — twice, and both rounds found real authorisation bypasses. Please be at least as
adversarial here.

## What to read, in this order

1. `docs/plans/260909d-a-priority-on-every-queued-idea-and-the-queue-ordered-by-it.md` — **the plan
   under review.**
2. `tools/overseer/idea-queue.ts` — the module it extends. Its header is long on purpose; the two
   sections that matter most here are *"AN AUTHORISATION NAMES THE REVISION IT AUTHORISES"* and
   *"GATE 3, MADE MECHANICAL"*. Read `foldQueue`, `place`, `changesContent`, `parseEvent`,
   `isDispatchable` and `waitingAhead`.
3. `tools/overseer/idea-queue-wait.ts` — `queueDepth` and `itemWait`, both of which iterate
   `view.items` and would silently change meaning if that array's order changed.
4. `scripts/overseer-queue.ts` — the CLI that will gain the flags.
5. `docs/plans/260909b-queued-ideas-mode-the-overseer-queue-as-ndjson.md` — the plan this continues,
   including your own two rounds of findings and what was and was not taken.
6. `docs/project/overseer-queue.md` and `docs/project/overseer.md` § gate 3 — what the queue is *for*.

## Context you need

The queue is an append-only NDJSON event log that serves as the Overseer's (an autonomous
coordinator agent's) **authorisation record**. Gate 3 of its runbook says *"nothing dispatched that
Greg did not queue"*. Greg is the human owner and the only actor who can authorise. The Overseer can
write to the same file. Everything defensive in that module follows from those two facts.

Greg has now asked for a `priority` field, 0–1, so that important work jumps to the top, and for the
Spideryarn product ideas to be banded low so the fleet focuses on Overseer tooling then the web
dashboard. His exact words are quoted at the top of the plan.

Nothing has been built yet. This is the design review.

## The three questions the plan makes calls on, and where I most want you to push

1. **Does a priority change by the Overseer lapse Greg's authorisation?** The plan says **no**, on
   the grounds that priority is the same axis as the existing `moved` event (which does not lapse),
   that the Overseer already chooses what to take next and can already `move` anything to the front,
   and that priority cannot promote an item past `authority` because `isDispatchable` is unchanged.
   The plan names the residual risk as *salience* — an Overseer proposal at 0.9 sits at the top of
   the list Greg reads on his phone. **Is there an authorisation bypass I have not seen?** In
   particular: is there any path by which a priority write changes what `isDispatchable`,
   `queueDepth`, `itemWait` or the dispatch fold-arm decides, rather than only what order things
   appear in?

2. **A new event kind `prioritized` versus a `priority?` key inside `edited`.** The plan takes the
   new kind, arguing that a key inside `edited` that `changesContent` deliberately does not count is
   the exact shape of the `needsGreg` bypass you found in round two. Is that the right reading of
   your own finding, or is the actor asymmetry the real lesson and the new kind an over-reaction?

3. **`priority: number | null`, with `null` sorting below every stated priority.** The plan rejects
   defaulting to 0.5 (an opinion nobody expressed) and to 0 (a judgement nobody made). The cost it
   accepts is that `add --front` without `--priority` no longer reaches the front, mitigated only by
   the CLI saying so. Is that mitigation enough, or does `--front` now mean something misleading
   enough that the flag should refuse, warn harder, or change?

## Also specifically

- **Sorting inside `foldQueue`.** `view.items` becomes priority-ordered, so `waitingAhead`,
  `itemWait`'s *"N items ahead of it"* and `currentOrder` all change meaning without their call sites
  changing. The plan argues this is right — one implementation of the ordering — and cites your own
  reasoning for computing `ready` server-side. Is anything relying on `view.items` being **placement**
  order, such that this silently breaks it? The internal `order` array (which `place` mutates) stays
  placement order; only the frozen output is sorted.
- **`moved` and `priority` interacting.** After this, `move --before X` where X is in another band is
  a legal write with no visible effect. The plan has the CLI say so. Is there a worse case — e.g. an
  ordering intent that now cannot be expressed at all, or one that can be expressed two ways that
  disagree?
- **Not bumping `IDEA_QUEUE_SCHEMA`.** The plan argues an older reader fails loudly (unknown event
  kind → `unreadable-line` problem → whole queue undispatchable) rather than wrongly, and that
  bumping would reject the entire existing live file. Agree?
- **Out-of-range priority rejects the line at parse time** rather than clamping or ignoring. Any
  reason that is worse than a named problem kind?
- **`set-priorities --from <file>`**, a one-shot bulk write: a strict line format, a dry-run plan by
  default, `--apply` to write, one batch under one lock against one version, and no event for an
  unchanged item. Is the dry-run/apply split safe here, given the queue's version can move between
  the dry run and the apply? Should the dry run emit the version it saw and `--apply` require it?
- Anything in the plan that is **stated as certain but not actually checked**, and anything a green
  test suite would not catch.

## What I want back

Findings as **P0 / P1 / P2**, each with: the concrete failure (inputs → wrong outcome), where it
lives, and what you would do instead. Then a one-line verdict: build it as specified, build it with
the changes named, or do not build it as specified.

Say plainly where you think the plan is right, too — I need to know which of the three calls above
you are endorsing rather than merely not objecting to.
