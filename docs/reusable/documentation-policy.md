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

- **Intent** — the goals, the constraints, the decisions and *why* they were made, in the words of
  whoever made them.
- **Signposts** — to the other docs, and out to the code, both directions, deep-linked to a section
  or a stable symbol.

The test for a paragraph here is: *would a competent reader recover this by reading the code?* If yes,
delete it and link to the code. If no — a rejected alternative, a constraint from outside the repo,
a decision that went against the recommendation at the time — it belongs here and nowhere else.

**Write down anything a future reader would otherwise have to reverse-engineer**, especially why a
design went one way rather than the obvious other way.

## One home per fact

**Cite, don't restate.** Give every fact exactly one home, and link to it from everywhere else. Two
copies of a fact is one fact and one liability, because they diverge silently and nothing goes red.

- **For a fact held in code, cite the defining file and a stable name** — `` `src/models.ts` §
  `STAGE_EFFORT` `` — rather than copying the value, or citing a line number. A line number is a fact
  about one commit.
- **For a number, record the command, the scope and the date**, and treat the output as a dated
  example rather than a fact.
- **Otherwise record the source, the date, and your confidence.** A doc that asserts something
  nobody checked is worse than no doc: prose cannot fail, so nobody checks it —
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
- **Enforce it with a test rather than a habit.** A relative link that no longer resolves, and above
  all a stale `#anchor` — which silently lands you at the top of the right page and never looks
  broken — is the kind of rot a grep can catch and a reader cannot.
- **File names are lower-case kebab-case**, everywhere, even when copied in from somewhere that
  shouted. Rename on sight and fix the links.

## Keeping it true

- **Update the docs in the same piece of work.** If you changed what something does, the doc is part
  of the change, not a follow-up.
- **A plan or a research doc is a record, not the documentation.** When a decision in one becomes how
  the thing works, that fact moves into the doc that owns it, and any open question it settles gets
  deleted; the plan keeps the history.
- **An agent's own auto-memory is not where knowledge lives.** It is for that agent's preferences,
  machine-local state, and a pointer to a thread left open. Anything a future reader would need — a
  trap, a decision, a rule — goes in the doc that owns it, where everyone can see it.
- **A doc whose wording is a rule changes differently** — one approved set of changes at a time, with
  the before and after shown: [edit-important-docs.md](edit-important-docs.md). Signposting is not a
  rule, so adding a line for a new doc, or tweaking a pointer, needs no approval.

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
