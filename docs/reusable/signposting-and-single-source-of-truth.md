# Signposting and single source of truth

Not project-specific. How to give each fact one canonical home, and point to it from everywhere else
instead of copying it. [documentation-policy.md](documentation-policy.md) is the wider policy this
sits inside.

> create docs/reusable doc (if we don't already have one) re signposting and single source of truth
> to prefer everything to be in one canonical place, with other places signposting to that, rather
> than reproducing the same information in multiple places.
>
> — Greg, 2026-10-01

Two copies of a fact are one fact and one liability. They drift apart without anything failing, and
the reader cannot tell which one is current. A pointer's address can be checked mechanically, so
it fails loudly when it breaks. Its blurb can still go stale, but a blurb that only says *when* to
open the target has much less in it to go wrong.

## Choosing the home

Put the fact where it is enforced or where it is decided, in roughly this order:

- **Code, if the fact is executable.** A value, a list, a set of steps, a limit: the constant or the
  module that defines it is the home. Prose that repeats it is a copy that cannot fail.
- **A test, if the fact is an invariant.** "Every X has a Y" belongs in an assertion. The doc says why
  and names the test.
- **The doc that owns the area, if the fact is intent, a decision, a trap or a reason.** Code cannot
  say why, so this is the one kind of fact that belongs in prose.
- **Never** a plan, a research note, a chat, an agent's memory or an index line. Those record that a
  fact was decided or point to where it lives. Once a decision in a plan becomes how things work, it
  moves to the owning doc and the plan keeps the history.

If two homes seem equally right, the one a person would edit when the fact changes wins.

## Signposting to it

A signpost has two parts: an address that stays valid, and a reason to follow it.

- **The address.** Use a deep link to the section (`doc.md#section`), not the top of a long page.
  For code, use the file plus a stable name, such as `` `src/models.ts` § `STAGE_EFFORT` ``. Never
  use a line number, because it is only true for one commit.
- **The blurb says when to open it**, and what goes wrong if you don't. Don't use it to state a fact
  from inside the doc. "Before trusting a skip: which steps decide freshness without a hash" gets
  opened. "Twelve steps cache on a hash" gets believed, and it becomes the second copy.
- **Put the signpost where the mistake happens.** That is the doc or file the reader has open when
  they are about to repeat the mistake, not where it was written up. A pointer below the first
  screen of a long doc is often never read.
- **For code, signpost the shared helper as well as the fact.** The most expensive duplicate is a
  second implementation, written by someone who looked and did not find the first. The module that
  is canonical says so in its header and names its owning doc. That doc keeps a short list of its
  shared code (`file` § `symbol`, and "reach for it when …"). Keep that list to what is reused or has
  been copied before, not an inventory of every file.

## Finding a duplicate

1. **Pick the home** by the order above.
2. **Merge.** Read both copies, and put whatever is true and missing from the home into it. The copy
   you are about to delete often has the better sentence.
3. **Turn every other copy into a pointer** with a when-to-open blurb. Then search for fragments of
   the fact (the number, a distinctive phrase, the symbol) to find the copies you didn't know about.
4. **For duplicated code you aren't consolidating yet**, name the canonical one in the owning doc
   and say the other is older. Otherwise the next person copies whichever they found first.

## The exceptions

- **A quote is deliberately copied.** The person's exact words, attributed and dated, may appear
  wherever they explain a decision. A quote is a record of what someone said on a date, so it cannot
  go stale. It isn't a claim about what is true now.
- **A count or a measurement can be repeated if it carries its source**: the command, what it
  covered, and the date — [written-down-is-not-checked.md § What to actually do](written-down-is-not-checked.md#what-to-actually-do).
  A bare number is a copy of the code that will go stale. Prefer naming the list and letting the
  reader count it.
- **A signpost may name its subject in a few words.** "The streaming helpers are
  `stream-run.ts` § `runStream` and `sse.ts` § `readAnswerStream`" counts as an address. Once it
  starts explaining the contract, it is a second home.
- **A file loaded into every session** (an agent's top-level instructions) keeps the *trigger*, such
  as "before writing a helper, look here". Facts belong behind the link, because the file is read
  every time and the facts are needed only sometimes.

## Enforce it mechanically

A habit decays and a test doesn't. The checks worth having, roughly in order of payoff:

- **Every link resolves, anchor included.** A stale `#anchor` silently lands the reader at the top
  of the right page and never looks broken. Check source comments as well as markdown.
- **Every `file` § `symbol` citation names a symbol the file still has.** Also refuse line-number
  citations.
- **Every doc has exactly one owner that links to it**, and it links back up.
- **A count in prose is derived, or there isn't one.** If a number must appear, a test computes it
  from the code and fails when the prose disagrees. Usually it's cheaper to delete the number.
- **When a fact can't be checked mechanically, test whether the signposts work.** Give a fresh agent
  only the top-level docs and a realistic task, and see where it gets lost
  ([documentation-policy.md § Checking that the signposts work](documentation-policy.md#checking-that-the-signposts-work)).

Related: [written-down-is-not-checked.md](written-down-is-not-checked.md), on why a confident copy
gets believed, and [rename-or-move.md](rename-or-move.md), on finding every place a name appears.
