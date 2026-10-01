# One policy row decided who may make a mode and who may see it

SPIDERYARN-READING2-56, Greg, 2026-09-29. A signed-out reader of a public article, on
`?mode=trajectory`, was told *"Trajectory is for whoever added this article — asking costs a model
call, and a shared link spends nobody's money"* — about a route that had already been planned and
paid for. Nothing was spent and nothing leaked; a reader was refused something that was theirs to
read. The fix is [260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md).

## The root cause

[`src/web/visitor.ts`](../../src/web/visitor.ts) § `POLICY` gives each mode one answer to *what may
a visitor have here?* — `available`, `owners-only`, or `artefact` (shown when the public payload
carries it). There are really two questions under that one answer: **may a visitor start this
mode's model call**, and **may a visitor see what the call already produced**. For every mode that
generates something, the honest answer to the first is *no* and to the second is *yes, once the
public payload carries it*. `owners-only` answers both with *no*.

It was the natural choice each time, for a good reason and a cheap one:

- **The good reason:** the `owners-only` band is fail-closed. It mounts no hook and sends nothing, so
  a mode that has not built its public projection yet cannot leak or spend by mistake.
- **The cheap one:** `artefact` costs nine steps (a type, a projection column, a DTO, a flag, a
  visitor band, and their tests — [260904c § What every stage owes](../plans/260904c-more-modes-on-a-shared-link.md)),
  and [mode.md](../project/mode.md) lists the public projection as optional (*"if a visitor
  may read it"*). So a new mode's first commit took `owners-only`, wrote *"a staging decision"* in the
  comment, and moved on.

The sentence a visitor reads, `ownersOnly()`, says why: *"asking costs a model call"*. That is true of
Chat, where every turn is a call. It is false of a stored route, which costs one read of a column
the public query was already fetching. **The explanation was written for the first question and
shown in answer to the second.**

## The class: one switch for two permissions

**A permission that should be two — *may do* and *may see* — collapsed into one switch, which then
fails closed on the one that was safe to allow.** Fail-closed is the right default for the dangerous
half, and applied to both halves it quietly withholds the harmless one. Nobody notices, because
withholding produces no error, no leak and no bill: the page works, it just shows the wrong band.

The same shape elsewhere: a read-only share link that is refused because the role check asks *"can
edit?"*; an API that 403s a GET because the route's guard was written for the POST beside it.

## Which commits introduced it

Four modes, the same decision each time:

| Mode | Commit | Date |
|---|---|---|
| Debate | `cb4eb8c3` *The Debate band, with three empty states…* | 2026-09-05 |
| Citations | `abde65f7` *Citations stage 2: the mode, behind the experimental switch* | 2026-09-12 |
| FAQ | `0e947eb4` *FAQ stage 2: the mode, behind the experimental switch* | 2026-09-16 |
| Trajectory | `64595ca9` *Trajectory stage 2: the mode, behind the experimental switch* | 2026-09-28 |

It became visible with `28e1f15f` (*Trajectory 5f: out of Experimental, still owners-only*),
2026-09-28, which put the button in every bar. Its message is the tell: the tests it names prove
*"a visitor … issues no POST"* — Sol even mutated `POLICY` to `available` and watched five of them go
red. **Every check asked whether a visitor could spend; none asked whether a visitor with a stored
route could see it.** That is [a check answering a weaker question](../reusable/silent-success.md):
the safety property was tested thoroughly and the product property not at all.

## The fix, and the fix that is right for the long term

**Shipped:** Trajectory, then FAQ, Citations and Debate, become `{ kind: "artefact" }` by the
260904c recipe — the stored output rides the public payload and a second, hook-free visitor band
draws it. The owner's band, the only one that can spend, is never mounted for a visitor.

**Right for the long term:** make the default for a generating mode *artefact, from the first
commit*, so there is nothing to catch up later — and make `owners-only` something a mode has to
justify. The three that remain after this (Chat, Remember, Referee) each have a reason that is not
cost-of-generation: the stored thing is the owner's own writing or private working. That is a
different sentence from *"asking costs a model call"*, and arguably a different `VisitorPolicy`
member; this fix does not split it, because nothing a visitor reads today is wrong for those three.

## What would have caught it, ranked by ease against value

1. **A test that names every `owners-only` mode and the reason it is not an artefact** —
   `tests/visitor-gaps.test.ts`, alongside `ALWAYS_FREE`. A fifth `owners-only` row then fails until
   somebody writes down *why a visitor may not see what it stored*, which is the question nobody was
   asked four times. Cheap, and done in this fix.
2. **New-mode.md says it outright**: a mode that stores what it generates is shown to a visitor from
   the payload, and `owners-only` is for a mode whose stored output is the reader's own. One line in
   the checklist, done in this fix.
3. **A browser pass signed out on a public article, for every mode, at every release** — rejected as a
   gate. It would have caught this, and it costs a subagent run per release to catch a class that
   item 1 catches at `npm test`.
