# Debrief the Overseer

> How are things going? How are resources/usage constraints? Any surprises/issues? What have we
> done in the last 24h, and what's next? … And are we making progress on the feedback reports? …
> Explain more about product-facing changes that have landed and impact/value to the user. …
> This all sounds good - anything you noticed that we could improve?
>
> — Greg, 2026-09-12, sitting back down after a night away

For a long-running orchestrator (an Overseer, a fleet coordinator, a loop that dispatches agents)
when the person who owns it sits back down and asks how it is going. It is the sibling of
[debrief-progress.md](debrief-progress.md), which is for one piece of work; this is for a whole
operation, where the person has been away for hours and wants the state of things in one read.

Run it by asking the orchestrator to answer the questions below, in this order.

## Principles

- **Read the live numbers before answering, not the cache.** A usage figure two days old and a
  live one look identical in prose. Say when a reading is stale and why it could not be refreshed.
- **Lead with the one-line verdict**: healthy, degraded, or blocked, and on what. Everything
  after it is detail.
- **Say what reached the user, not what was committed.** A reader does not see a sha. For every
  product change: what they can now do, or what no longer goes wrong, in one sentence; and whether
  it is **live**, **on the trunk waiting for a deploy**, or **behind a switch**. Check production's
  build stamp rather than assuming.
- **Numbers in a table, one row per account or resource**, with the reset time. A number in a
  sentence gets skimmed past.
- **A surprise is anything that moved without you moving it**: a limit that reset early, a token
  that expired, a session that died. Say what you verified before believing it.
- **Separate the three kinds of pending**: what is running now, what is queued for you, and what
  waits on the person. The last list is the one they will act on, so it comes with enough context to
  answer without opening anything ([overseer.md § 2](../project/overseer.md#2-answer-facts-route-judgement-default-the-product-call)).
- **Name the improvements you have noticed**, ranked by value, each with what it would remove.
  The person asked because the orchestrator sees patterns they cannot; a debrief with none is
  usually a debrief that did not look.
- **Plain and brief, as everywhere** — [CLAUDE.md § Explain plainly and briefly](../../CLAUDE.md).

## The questions, in order

1. **Verdict.** One line: how it is going, and the single biggest thing shaping that.
2. **Resources.** A table: each account or subscription, its short and long windows, when each
   resets; box load and memory. Which one is the constraint right now.
3. **Surprises and issues.** What moved on its own, what broke, what you did about it, what is
   still unexplained.
4. **Inbound work.** For a product with a feedback channel: how many reports are open, how many
   shipped since last time, whether anything awaits approval.
5. **What landed, for the user.** Grouped by what the user gains, not by cluster or plan. Live or
   not. Two or three sentences each on the ones that matter most; one line on the rest.
6. **What is running now, and what is next.** In order, with what each waits on.
7. **What needs the person.** Only things they can actually decide, each explained enough to
   decide on the spot.
8. **What could improve.** Ranked; what it would remove; whether it is already queued.

## See also

- [debrief-progress.md](debrief-progress.md) — the same shape for one piece of work.
- [overseer.md](../project/overseer.md) — this project's Overseer runbook: what it may decide
  alone, what it logs, what waits for Greg.
