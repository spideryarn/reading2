# Asking Greg questions

How to put a decision to the person who owns it, so it can be answered in one read. Greg's words,
2026-10-01:

> explain clearly, make recommendations, with tradeoffs/concerns/risks, at most 3 at a time,
> clustering related issues together, prioritising by a combination of ease and value, only really
> ask me about the stuff that should be gated as needing my input in engineering-manager.md e.g.
> consequential/product-facing/hard-to-reverse/tradeoffs

And the older half, 2026-09-09: *"Often I get asked a question and I don't understand what the
question is asking, or the options, or how to choose between them."*

**A relayed question needs its background as much as a new one.** On 2026-10-07 the Overseer
passed on another agent's questions as one-line labels ("eight new sentences to veto"), and Greg
answered *"I don't really understand what you're asking me here."* Whoever passes on a question
rewrites it with the background, the options and the example, rather than forwarding the label it
arrived with.

## Whether to ask at all

Ask only what is gated on him: [engineering-manager.md § How far to run](engineering-manager.md#how-far-to-run).
That means consequential, product-facing, hard to reverse, a real trade-off, a security defence, a
destructive write to real data, or a product tweak that would take a lot of the engineering out.
Anything else is yours to settle with a second opinion (Sol, or Opus to arbitrate). Decide it, and
say in a line what you decided.

**That list is a reason to weigh the stakes, not by itself a reason to ask.** Keeping things as they
are is yours to decide when nothing about them gives a reader a bad time and it is cheap to revisit.
So is a change where the stakes are low, one option is plainly good, or there is no real trade-off,
unless it loosens a defence, changes a prompt or a privacy promise, or writes destructively to real
data: those still go to him. In doubt, ask GPT Sol, or have two Opus subagents argue from different
roles (a reader, and someone else with a stake), and judge between them. Greg, 2026-10-20: *"is it
important to ask me a question like this kind of question? […] All I'm trying to avoid is anything
that's going to be a bad user experience. […] But don't bug me for trivial stuff."*

**Before asking, check it is still open.** Answers often arrive in other places: a report note, a
plan, a later message. Re-reading the source also often shows that the request was specific enough
to build after all.

## How to ask

- **At most three at a time.** Then wait for the answers and send the next batch. Don't send a list
  of fifteen.
- **Cluster related issues** into one question, and **order by ease and value**: the answer that
  unblocks the most for the least of his time comes first.
- **For each question:**
  - **Background first:** what the work is for, and any jargon in plain words.
  - **Then each option:** what it would look like in use (an example, or an ASCII sketch where shape
    matters), what it costs, what it gives up, and its risks and concerns.
  - **Say roughly how big each option is to build**: an hour, a session, several days. Greg,
    2026-10-20: *"I can't tell how complicated this would be. If it's trivial, I'd be at least open
    to it."*
  - **Then what would decide between them**, and **your recommendation**, marked as such, with the
    reason.
- **Make it answerable briefly**: number the questions and letter the options, so "1A 2B" is a whole
  reply. Expect a fifth option anyway: often the answer is neither.
- **Say what you did not ask**: what you decided yourself, or queued because it needed no decision.
  He should not have to wonder whether something fell through.
- **Keep track for him.** If questions are still open after a few exchanges, restate the open ones in
  full rather than citing "question 4 above".
