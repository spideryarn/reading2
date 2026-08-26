# Chat told a reader the model said nothing, when the model had asked for a tool

**Found 2026-08-26**, chasing a bug that is still not diagnosed. Greg's turn came back as
`The AI service finished without saying anything at all. [ai-empty]` after eight `search_library`
calls, and this is what the chase turned up on the way: **a comment asserting a guarantee the code
did not provide**, and a failure line that could not tell any of the suspects apart.

Not a regression. The hole arrived with the feature, in
[`be59cf9`](https://github.com/spideryarn/reading2/commit/be59cf9) — *"Let chat use tools, and say
out loud what it did"* — earlier the same day.

## What was wrong

`converse` runs a bounded tool loop. Three rounds may ask for tools; the fourth is offered none of
ours, on the understanding that it would therefore write prose. The comment on that line said why,
and said one thing too many:

> A cap that simply stops after N rounds has to throw away whatever the model asked for on round N,
> which leaves an assistant message carrying tool calls that were never answered — malformed, as far
> as the provider is concerned. **Dropping the tools instead means the model *cannot* ask again, so
> the final round is always prose.**

The first half is right and is a good reason for the design. The second half is false.

Withholding the `tools` array removes the **schema**. It does not remove what the model is actually
looking at, which by that point is three of its own assistant turns full of `tool_calls`, each one
answered, and nothing anywhere saying to stop. A pattern repeated three times in the immediate
context is a far stronger cue than the absence of an entry in a list. The model can ask for a fourth
round of searching, and does.

When it did, `converse` went straight past it:

```ts
if (withTools && finishReason === "tool_calls" && wanted.length === 0) { /* … */ }  // skipped: !withTools
if (!withTools || wanted.length === 0) break;                                      // taken, calls discarded
```

`text` was empty, so the guard after the loop fired and the reader was told the service *"finished
without saying anything at all"*.

Which is not what happened. It did not finish saying nothing. **It asked for a ninth search, and
this app threw the question away and then blamed the model for the silence.**

A wrong sentence about a failure is worse than a blunt one, because it is the sentence somebody
debugs from. This one sends you to the provider — is the model broken, is it a content filter, did
the budget run out — when the answer was in our own `break`.

## How it stayed invisible

Chat writes a rich line when it succeeds: `rounds`, `tools`, four token counts, `finishReason`,
`citedBlocks`, and more. The line it writes when it fails to produce an answer said `model`, `ms`
and `finishReason`.

So every candidate explanation looked identical in the record. A turn that reached the tool cap and a
turn that gave up on its first request: the same line. Eight tool calls on the reader's screen:
absent. A model that spent its whole output budget thinking versus one that spent none — which is
the *specific* question this failure turns on, and the question
[the previous version of it turned on too](../project/chat-tools.md#the-bug-that-shaped-the-literal-search)
— not recorded either way.

Every one of those numbers was already computed and in scope. They were being written to the log on
the one path where nobody needs them.

It is worth being precise about what that cost. `finishReason` *was* on the failure line, and
`finishReason` is exactly what separates "the model asked for a tool" (`tool_calls`) from "the model
wrote nothing" (`stop`). The information existed; the turn it existed for was not kept, because
nothing about a `[ai-empty]` on a reader's screen tells anyone to go and look at a log before it
rolls off. A failure that is diagnosable only if you happen to catch it live is not diagnosable.

## The fix

**1. Say out loud that the tools are gone.** The final round now carries a pushed user message:

> That is all the looking things up you can do inside this app for this question — the article and
> library tools are finished. Write the answer now from what you have already found. If it is not as
> much as you wanted, say what you did find and what is still missing.

The last sentence is load-bearing. A model told only to stop searching can decline to answer instead,
which is the same empty turn reached by better manners.

*"Inside this app"*, not *"there are no tools left"*, which is what the first draft said. OpenRouter's
web search is a server tool and stays on for this round as well, so that version was contradicted by
the very request that carried it — a nudge the model has a reason to disregard. Caught by the Sol
review below.

It is one message on one request out of four, rather than a line in `SYSTEM`, because `SYSTEM` is the
part of the conversation that has to stay byte-identical for the prompt cache
([prompt-caching.md](../project/prompt-caching.md)).

**2. If it asks anyway, fail in words that are true.** `KEPT_ASKING_FOR_TOOLS` / `[ai-tool-loop]` —
*"spent this whole answer looking things up and never got to the answer itself … asking about one
thing at a time works better."* Only when **this round** wrote nothing: a model that wrote its answer
and then reached for one more search has answered, and that answer is kept untouched.

**3. The failure lines carry what the success line carries.** One `turnSoFar()` helper, spread into
all eight failure paths in [`src/converse.ts`](../../src/converse.ts) **and into the success line**.
Both halves matter: the first version left the success line maintained by hand, and two hand-kept
lists drift the moment somebody adds a number to one of them — which is precisely how this file
arrived at a failure line with three fields on it.

A fourth thing was considered and not done: answering the doomed tool calls with "there are no tools
left" and going round once more, so the reader gets an answer rather than an error. It is bounded and
it would work. It was not taken because the loop's guaranteed termination is the property this whole
design is protecting, and a retryable failure is a smaller thing to get wrong than a loop that can go
round again. Worth revisiting if `[ai-tool-loop]` ever shows up in real logs.

## What the review found afterwards, which is most of the value here

The change above went to GPT Sol before it was committed
([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)). It said **DO NOT SHIP** five
times running, and was right ten times. **Three of the ten were in the fixes for the other seven**,
which is the argument for re-reviewing built code rather than only the plan, in one line. The first
pass found four. Each was reproduced here before being fixed, and each now has a test that goes
red without its fix.

1. **The token totals could double-count.** `usage` is one variable, assigned from whatever chunk
   last carried it, and read once per round — and it was never cleared between rounds. A provider
   that sends no usage block on round two made round one's numbers be added twice. Which is the exact
   mirror of the bug the comment beside that accumulator describes (*"a three-round turn logged one
   round's tokens and read as a third of its real cost"*), arrived at from the other side. Not
   introduced by this change; **spread by it**, from one log line to nine.

2. **`!withTools` names two different situations.** The round that lost its tools *to the cap*, and a
   caller who never wanted them (`useTools: false`). The new guard used `!withTools` and so told a
   `useTools: false` reader that the service "spent this whole answer looking things up" when not one
   had run. There is now a `lastToolRound` that means only the first of those.

3. **The same wrong assumption was in the guard next door.** `TOOL_CALL_LOST` was scoped
   `withTools && …` with a comment saying `finish_reason: "tool_calls"` "cannot otherwise occur" —
   the same belief, in the same file, written the same day. So a *garbled* call on the withheld round
   fell through every check and reached the reader as `saidNothing` too. **A wrong belief in a
   comment does not stay in one place**: it gets copied into the next guard by whoever reads it.

4. **The nudge contradicted its own request.** It said "there are no tools left" while the request
   still carried OpenRouter's web search. Fixed above.

Then the fixes went back for a second pass, which said **DO NOT SHIP** again, and was right twice
more. Both were introduced *by the fixes*, which is the argument for the second review in one line.

5. **The new guard read the wrong accumulator.** `text.trim() === ""` is the turn's text, not the
   round's. So *"Let me look that up for you."* on round one would have made the guard stand down,
   the `break` be taken, and that half-sentence stored as a finished answer — which is precisely the
   silent success the `TOOL_CALL_LOST` guard twenty lines above exists to prevent, reintroduced
   underneath it. And the test I had written *pinned the wrong behaviour*, because the text it used
   looked like an answer rather than like a preamble. It reads `roundText` now, and the test asserts
   the opposite of what it used to. Nothing is lost by failing: the route stores whatever text
   arrived and marks the row `error`, so the reader sees the half-sentence and is told it is not an
   answer.

6. **A turn that died mid-round was logged as free.** The totals are banked when a round's stream
   closes, so a stream that reported its usage and *then* broke never reached that line — and the
   fields named for what a turn cost said `null`. I had proposed documenting that as "completed
   rounds only"; the review's answer was that a field named for total cost may not knowingly
   undercount when the provider has already told us the number. `turnSoFar()` now adds whatever the
   current round has reported and not yet banked, and the bank clears it so it cannot be counted
   twice.

A third pass found one more, and it is the most interesting of the seven because nothing in this
change touched the line it was on.

7. **A reader who stopped between rounds lost everything the turn had already bought.** The catch
   around the initial `fetch` had its own hard-coded ending — no text, no citations, no searches,
   four null token counts — under a comment saying *"nothing was asked, so there is nothing to
   report"*. That was true of a function that made **one** request. It stopped being true the day a
   turn became several: stop while round four is connecting and you have already paid for three, and
   this threw away the tokens, the citations, the searches and any words the earlier rounds had
   written. It breaks now, and the single ending after the loop does the reporting — which is also
   the only copy of that logic anyone maintains.

   The pattern is the same one as the headline bug, which is why it is worth its own line: **a
   sentence that was true when it was written, in a comment nobody re-read when the thing underneath
   it changed shape.** The tool loop turned one request into four, and every "nothing has happened
   yet" in this file quietly became "nothing has happened yet *this round*".

A fourth pass — asked to go hunting for *"every remaining assumption that a turn is one request"* —
found the eighth, and it is the plainest of them.

8. **A stop did not stop a tool batch.** A model can ask for three tools at once; they run one at a
   time; and the reader's signal was consulted only *after* all three. So pressing Stop during the
   first search waited for the third, which is the opposite of what the button is for. The same hole
   let a turn overrun its own deadline: `timeoutMs` was attached to the model requests and to
   nothing else, so a tool was measured still running at 88ms under a 20ms deadline, and only the
   *next* round noticed. The signal is checked before the batch and between tools now, and a tool
   carries the turn's deadline as well as the reader's signal. Not the stall clock, which is per
   round and about a silent stream — a tool taking eight seconds is not a stalled stream.

A fifth pass — a confirmation pass, on the fix for the fourth — found two more, both in the control
flow the fourth pass's fix had just added. Ten defects across five reviews.

9. **A stop could still end as a tool-call failure.** A reader who presses stop mid-stream lands in
   the catch around the chunk loop, which sets `stopped` and *falls through* rather than throwing —
   and the tool-call fragments they interrupted are, by definition, unassembled. The malformed-call
   guard was not looking at `stopped`, so it filed the interruption as *"the request for it arrived
   garbled"*: a red row and an apology for a button they had just pressed. Which is exactly the bug
   the empty-answer guard beside it already carries a stop branch to prevent — the same mistake, one
   guard along.

10. **The deadline did not stop a batch.** Both of the new between-tools checks called
    `readerAborted`, which answers *"was this the reader?"* and returns false the moment the deadline
    has fired. Correct for what it is asked; wrong for what it was being used for. A turn that had
    already run out of time worked through the rest of its tools. No further model request was ever
    paid for — the next `fetch` rejects on the composite signal — so the cost was wasted tool work
    and a reader told late. It throws `tookTooLong` from inside the batch now, which is what a
    deadline should say.

That test is deterministic despite involving a real clock, and the trick is worth stealing: the
generator is **suspended** at its `yield` while the consumer waits, so a `setTimeout` in the consumer
guarantees the deadline has fired by the time the generator resumes. No race.

Two smaller ones worth recording: the message promised that a retry "often works", which nobody has
measured — the same overclaim as `[ai-empty]`'s *"asking again usually gets an answer"*, which is the
sentence this whole change exists to stop being said; and the claim that success and failure lines
"cannot drift" was false while only the failure lines used the helper.

And one about a test rather than the code, which is the kind that matters most here: my
`useTools: false` test asserted only that the message was *not* `[ai-tool-loop]` — satisfied equally
by a success or by any unrelated error. It names `[ai-empty]` now.

One question the review answered without needing to be asked twice, and which was also checked live
against OpenRouter: a `role: "user"` message immediately after `role: "tool"` results is valid, both
in Anthropic's shape rules (text after tool-result blocks) and in OpenRouter's translation. A probe
against `anthropic/claude-sonnet-5` with exactly that shape returned 200 and answered from the tool
result.

## Three claims that had rotted, and one that was never written

The same pass turned up three comments that were true when written and are not now, in three
different files. None of them is a bug today; all three are the raw material of the next one.

- `src/converse.ts` described the generator's contract as *"zero or more `delta` events, then exactly
  one `done`"* — with no mention of `tool` events, which have existed for a day. **A contract that
  omits a case reads as forbidding it.**
- `src/messages.ts` still said withholding the tools makes the model *"have to write prose"* — the
  disproved claim, surviving in a third file after being corrected in two.
- `src/routes.ts` justified resolving the reader's profile once per turn with *"a turn is one call,
  so there is no window in which half an artefact could be written to each"*. The conclusion is
  still right — a turn resolves it once and hands the same string to every round — but the reason
  had rotted the day the tool loop landed.

Three more were left as notes in [chat-tools.md § Still open](../project/chat-tools.md#still-open)
rather than fixed here, because each wants thinking rather than patching: a stopped preamble comes
back to the model as a completed answer (`recentHistory` knows `done` and non-empty, and not
"stopped"); nothing watches the *total* size of a turn, only each tool result's own cap; and the
logged `model` is whichever one answered last, so a turn routed to two providers reports one.

## One live turn afterwards

Greg's question, run again against the real model with everything above in place —
`noema-mythology-of-conscious-ai`, the same five-article library:

```
TOOL 0 search_library      -> 8 passages in 1 article
TOOL 1 search_library      -> 2 passages in 2 articles
TOOL 2 read_library_passage-> 7 paragraphs
TOOL 3 search_library      -> 2 passages in 1 article
TOOL 4 search_library      -> nothing found
rounds:4 tools:5 chars:4157 inputTokens:107035 outputTokens:3560
cacheReadTokens:47744 cacheWriteTokens:46547 finishReason:"stop" citedBlocks:2
```

It used **all four rounds**, so the nudge went out, and it wrote a 4,157-character answer citing two
blocks. It also reached `read_library_passage`, which Greg's run never did.

What that establishes and what it does not. It establishes that the pushed user message does not
break a real request, that a turn reaching the cap can now come back with an answer, and that the log
line finally says what a turn did. It does **not** establish that the nudge is why it answered: one
run, no control, a different question shape from Greg's in only the library it had to search. A
control run would be one sample against one sample. The claim here is "does not break, and the
evidence is now collectable", not "fixed".

## What would have caught it

**The comment.** It made a claim about the model's behaviour — *cannot ask again* — in a file that
cannot check it. Every other guarantee in `converse` is structural: the `break` really does end the
loop, the `tool_call_id` really does have to match. This one was a prediction wearing the same
clothes. **A comment that asserts what a model will do is a hypothesis, and it should either say so
or be a test.** It is a test now.

**The class of it is broader than chat.** Anywhere we remove a capability and expect a behaviour to
follow, the removal and the expectation are two different things. Taking the tools away is a fact
about our request. "So it will write prose" is a guess about a language model, and the honest version
of that guess is a nudge plus a guard.

**And the logging habit.** *When a line is added to a success path, ask what the failure path says.*
The instinct runs the other way — the happy path is where you are looking when you write the numbers,
and an error already feels informative because it has an error in it. It usually is not: `err` says
what broke and nothing about what the request had already done, which is most of a diagnosis. Written
up as a rule in
[logging.md § The failure line carries what the success line carries](../project/logging.md#the-failure-line-carries-what-the-success-line-carries).

## What is still open

**The bug Greg actually reported is not solved.** This fixes a reachable cause and corrects a false
message; it does not establish that this is what happened to him. The other branch — the model
genuinely writing nothing, most plausibly because eight tool calls' worth of arguments and reasoning
spent the output budget — is still live, and it is the same shape as
[the capped-list bug](../project/chat-tools.md#the-bug-that-shaped-the-literal-search) from earlier
the same day. `finishReason` on the next occurrence separates them, and the log now carries enough
beside it to say which.

See [chat-tools.md § Still open](../project/chat-tools.md#still-open).

## Tests

- [`tests/chat-tools.test.ts`](../../tests/chat-tools.test.ts) § *the last round, where our tools are
  withheld* — the nudge lands on that round and no other; a model that asks anyway gets
  `[ai-tool-loop]` and not `[ai-empty]`; an answer that arrived alongside a stray call is kept.
- [`tests/chat-empty-answer-log.test.ts`](../../tests/chat-empty-answer-log.test.ts) — reproduces
  Greg's turn (three, three and two tool calls, then a round with nothing to say) in a child process
  and reads the fields back off the log, because the logger is `silent` under `NODE_ENV=test` and an
  in-process assertion would be satisfied by a logger emitting nothing at all.

Both were checked against the broken state — the fixes disabled in a scratch `git worktree` — rather
than only against the fixed one. A test that has never been red proves nothing.
