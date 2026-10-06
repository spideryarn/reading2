# Documentation policy

What a doc is *for*, and what therefore does not belong in one. The how-to-write-each-kind docs are
listed at the bottom; this is the policy they all sit under.

## Who is reading

Two audiences, and they need different documents.

> Human-readable docs are mainly `README.md` and `docs/tutorials/` — most of the rest is aimed at
> agents, who are happy to read code, and should be directed to that rather than provided with
> detailed descriptions of how things work that can get out of date.
>
> — Greg, 2026-09-06

So: **`README.md` and the tutorials are written for a person**, and may explain a mechanism at
length. **Most of the rest is written for an agent that can read the code**, and should send it
there rather than paraphrase it — an agent does not need a prose rendering of a function it can open
in a second; it needs to know the function exists, where it is, and why it was written that way.

The exceptions are the other documents a person reads: a contributor guide, a licence note, a
runbook somebody follows while building a machine. **Classify by reader, not by directory.**

## What an agent-facing reference doc holds

**Intent and signposts. Not descriptions of code, which the code already provides.**

> The main principle is that docs should emphasise intent (supplied from me) and signposting (to
> other docs, code, etc etc).
>
> — Greg, 2026-10-01

- **Intent** — the goals, the constraints, the decisions and *why* they were made, in the words of
  whoever made them.
- **Signposts** — to the other docs, and out to the code, both directions, deep-linked to a section
  or a stable symbol. *Up* to the doc that owns this one, *down* to the files that implement it, and
  *across* to the doc that owns anything it mentions.

The test for a paragraph here is: *would a competent reader recover this by reading the code?* If yes,
delete it and link to the code. If no — a rejected alternative, a constraint from outside the repo,
a decision that went against the recommendation at the time — it belongs here and nowhere else.

**Write down anything a future reader would otherwise have to reverse-engineer**, especially why a
design went one way rather than the obvious other way.

**A reference doc says what is true now.** How it came to be true is a plan's job: keep the decision
and its reason, link the plan, and leave the story there. "Since 2026-09-12 … until … then …"
narration is what an over-long reference doc is mostly made of, and it is the part that goes stale
first — the reader cannot tell which of the dated sentences still holds.

### Shared code is part of the signposting

Before adding or documenting a helper that more than one area should reuse, follow
[signposting-and-single-source-of-truth.md § Signposting to it](signposting-and-single-source-of-truth.md#signposting-to-it).

## One home per fact

**Cite, don't restate.** Give every fact exactly one home, and link to it from everywhere else; two
copies diverge silently and nothing goes red. How to choose the home, how to point at it, what to do
with a duplicate, and the exceptions are in
[signposting-and-single-source-of-truth.md](signposting-and-single-source-of-truth.md).

**Record the source, the date and your confidence** for anything that is not cited from code. A doc
that asserts something nobody checked is worse than no doc: prose cannot fail, so nobody checks it —
[written-down-is-not-checked.md](written-down-is-not-checked.md).

## Quote the human

**Use their exact wording, in a blockquote, attributed and dated.** The phrasing carries intent that
a paraphrase loses, and it is the one part of a doc nobody else could have written. If you find you
have flattened a quote into your own voice, put theirs back.
[capture-sounding-board-conversation.md](capture-sounding-board-conversation.md) is how to turn a
conversation into a document without losing that.

## Less is more

Say each thing once, briefly, and leave the next reader room to use their judgment. Where the human
gave an instruction, follow it rather than embroidering it. A doc that has grown past what anyone
will read is not doing its job, however true it is.

## Keep it navigable

- **Every evergreen doc is reachable from exactly one deliberate parent**, and that parent links to
  it. If nothing wants to own it, that is a signal about the doc. Dated collections — plans,
  research, postmortems — are owned at directory level instead, and are not indexed item by item;
  follow whatever indexing convention the repo already has.
- **A doc may be linked from many places.** That is fine — one *owner*, many links.
- **Every evergreen doc links back up to its owner**, near the top, so a reader who arrived mid-tree
  can find the rest of the area. Dated collections keep the directory-level convention above.
- **Before writing an index line or cross-reference**, follow
  [signposting-and-single-source-of-truth.md § Signposting to it](signposting-and-single-source-of-truth.md#signposting-to-it).
- **An area with code gets a doc that owns it**, even a short one. Without one, its intent ends up
  as dated paragraphs in a parent index, and its code is signposted from nowhere.
- **Enforce it with a test rather than a habit** — which checks are worth having is in
  [signposting-and-single-source-of-truth.md § Enforce it mechanically](signposting-and-single-source-of-truth.md#enforce-it-mechanically).
- **File names are lower-case kebab-case**, everywhere, even when copied in from somewhere that
  shouted. Rename on sight and fix the links.

## Keeping it true

- **Fix a doc you find out of date, even one your change did not touch** — the standing permission
  and how to land it are in [engineering-manager.md § Along the way](engineering-manager.md#along-the-way).
- **Update the docs in the same piece of work.** If you changed what something does, the doc is part
  of the change, not a follow-up. **Removing a feature most of all**: grep the docs for its names and
  fix every hit in the same change. A removal done as "a line here and there" leaves the reference
  docs describing the thing that is gone, in the present tense, for weeks.
- **Found a lesson in a postmortem or review that should stop the next repetition?** Use
  [signposting-and-single-source-of-truth.md § Signposting to it](signposting-and-single-source-of-truth.md#signposting-to-it)
  before placing it.
- **Moving a decision out of a plan or research note, or knowledge out of auto-memory?** Choose its
  shared home with
  [signposting-and-single-source-of-truth.md § Choosing the home](signposting-and-single-source-of-truth.md#choosing-the-home).
- **A doc whose wording is a rule changes differently** — one approved set of changes at a time, with
  the before and after shown: [edit-important-docs.md](edit-important-docs.md). Signposting is not a
  rule, so adding a line for a new doc, or tweaking a pointer, needs no approval.
- **Never pass prose through a shell string.** Backticks inside a double-quoted shell argument are
  command substitution, so each code span is run and removed: a plan section appended that way on
  2026-09-08 landed with four spans missing, the script printed its success line, and the result
  read as clumsy writing, not as damage. `$`, `!` and `\` are the same family. Write prose with the
  Write tool, or have a script read it from a file; a heredoc with a quoted delimiter is safe. Then
  read what landed.
- **Edit a doc with the Edit tool.** If it must be a script, write `assert old and s.count(old) == 1`
  before every replace, and never pass `-q` to `git commit`: a replace whose target came out empty
  succeeds everywhere and silently grew one plan to 22 MB
  ([the postmortem](../postmortems/261005r-a-slice-between-two-markers-can-be-empty-and-replace-with-an-empty-needle-succeeds-everywhere.md)).

## Checking that the signposts work

Reading the docs yourself cannot tell you whether they lead anywhere: you already know where
everything is. **Send a fresh agent instead**, with only the top-level signpost file, a realistic
task, and an instruction to plan the work without doing it. Have it report the docs it opened, the
existing code it would reuse, the rules it would follow, and where it got lost — then compare that
with what the task really needed. Where it got lost is the list of signposts to write. Keep some
tasks back, unseen, to measure the result: an agent fixing the docs for the tasks it has read is
writing the answers down. And run each task more than once: two runs of the same agent on the same
docs can disagree by more than the docs changed, so a single before and a single after measure
mostly which way each agent happened to read the task.

## The kinds of doc, and how to write each

| Kind | Reader | How |
|---|---|---|
| `README.md` | a person arriving cold | the shortest true account of what this is and how to run it |
| tutorial | a person who has never read the code | [write-tutorial.md](write-tutorial.md) |
| reference doc (the `docs/project/` tree) | an agent that can read the code | intent and signposts — this page |
| plan | whoever asks "why is it like this?" | [write-planning-doc.md](write-planning-doc.md) |
| research | whoever reopens a settled question | [write-deep-dive-as-doc.md](write-deep-dive-as-doc.md) |
| postmortem | whoever meets the same class of bug | the root cause, the class *named*, the commit, the long-term fix, and what would have caught the class |
| reusable note (this directory) | you, in a different repo | no project specifics; a project-side stub carries those |
