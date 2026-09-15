# The "?" asks "Help me understand."

Report [SPIDERYARN-READING2-3W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3W), from an
admin, 2026-09-12. Greg, verbatim:

> Re "I don't get this, or maybe what's around it. What am I missing — here, or somewhere
> earlier?". Make this prompt more general and minimal. Eg help me understand

## What the sentence is and where it lives

Pressing the "?" in the gutter beside a paragraph sends one question, with no typing, and it sits in
the transcript **in the reader's voice**, above the answer. That question is `HELP_QUESTION` in
[`src/web/chat-handoff.ts`](../../src/web/chat-handoff.ts). `ChatDialog` sends it on mount; the
visible message is `About block k3m9qt ("opening words…"):` followed by it. Nothing parses it: no
migration, route or client code matches on its text (grepped — the only hits are the constant, one
test, one source comment in `BlockGutter.tsx`, historical plans and eval result files).

## Why it had grown long

It was carrying two instructions to the model, on two of Greg's asks:

- 2026-09-04, the far half, *"somewhere earlier"*: "often the confusion is wider in scope than just
  that block, so the LLM is going to have to use its judgment on that."
- 2026-09-05, the near half, *"what's around it"*: "the prompt for the chat should leave room
  implicitly for the question/explanation to cover nearby blocks too."

At the time the sentence was **the whole** of the help-specific instruction — the server did not
know a "?" had been pressed. That stopped being true on 2026-09-05 (commit `078bf436`): the press is
now `help: true` on the message row, and the server adds `helpSection()` in
[`src/converse.ts`](../../src/converse.ts) to the final user message. The comment above
`HELP_QUESTION` still says no such addendum exists; it is stale.

## The change

1. **`HELP_QUESTION = "Help me understand."`** — Greg's example, taken literally. No "this": the
   heading line already names the block, and leaving the object off is what makes it *general* —
   the passage, the thing around it, or something earlier.
2. **The two reaches move into `helpSection`**, where instructions to the model belong and the
   reader never has to read them. One new bullet:
   *"Treat this passage as the starting point, not a boundary: the needed context may be around it,
   somewhere earlier, or left unstated."* It sets no **bounded** window (it does name a vicinity,
   as "around it" always did), and `left unstated` keeps those two article locations from reading as
   the whole answer space. It deliberately names no source: `SYSTEM` owns the rule about reaching
   for the web (`tests/help-prompt.test.ts § says nothing at all about where the answer comes from`).
   This keeps both of Greg's earlier asks rather than dropping them for brevity.
3. **Tests.** `tests/help-sends-once.test.tsx § keeps both directions…` pinned the reach in the
   reader's sentence (`"around it"`, `"somewhere earlier"`, `/^I /`). It is rewritten to pin the new
   division: the reader's sentence is exactly `"Help me understand."`, and
   `tests/help-prompt.test.ts § what the addendum says` gains the assertion that the addendum
   carries both reaches, leaves room for context the passage does not state, and does not say
   "surrounding". Both written first and seen red (a first draft of the sentence test checked only
   shape — five words, no dash — and was tightened to the exact words on review; code review added
   the non-exhaustive-context assertion and saw it red too).
4. **The web-reach eval** (`evals/chat-web-reach.ts`) imports `HELP_QUESTION` for its `help` case,
   so its stimulus changes with this: a comparison against the 2026-09-13 results now moves two
   variables at once, the reader's words and the addendum. Recorded here as a baseline
   discontinuity; the old JSON is left alone.
5. **Docs and comments in step.** The `HELP_QUESTION` comment rewritten to say what the sentence is
   now and where the reach went (and to drop the stale "there is no addendum"); `BlockGutter.tsx`'s
   quoted *"I don't get this"*; [chat-tools.md § The "?" says so](../project/chat-tools.md) gains
   one sentence saying the reader's words are minimal and the reach lives in `helpSection`.
   Historical plans and eval results are left as records.

## What this deliberately does not do

- **No change to old conversations.** Threads started before today keep the old sentence in their
  transcript; it was what the reader sent. No migration.
- **No change to the button's own copy** ("Ask the AI for help with this paragraph") — it already
  says the minimal thing.

## The simpler option passed over

**Only change the constant**, leaving `helpSection` alone. One line, and it matches the words of the
report. Passed over because it silently drops two things Greg asked for on 09-04 and 09-05: the model
would get no nudge beyond the passage except the existing "the earlier move this passage is
answering". The extra bullet costs one line and no cache (it sits below the breakpoint;
`tests/help-prompt.test.ts` pins the byte-identical prefix).

## Risks

- **A shorter sentence could make the answer narrower.** The addendum now does that job, and it is
  sent on exactly the turns the sentence is (`help: true` is enforced to be the thread-creating
  whole-block `chat` turn). A turn edited or retried keeps `help` from storage, so it keeps the
  addendum — **for help turns created since 2026-09-05**, when the column arrived. Rows from before
  that default to `false` and were deliberately not backfilled, so a retry of one of those gets no
  addendum; it still carries both reaches in its old sentence. A retry of a 09-05-to-today help turn
  gets the old sentence *and* the new bullet, both reaches twice. Neither is worth a migration (GPT
  Sol, plan review).
- **"Help me understand." as the reader's words.** It is first person and something a person would
  say, which was the original bar for it.

## Ending

**Shipped.** GPT Sol reviewed the plan (proceed with changes, all taken) and the code (two fixes,
applied by it and checked here). One full suite on `e79a802b`, started 19:52: 1122 files passed,
8 failed. Seven are the seven recorded on dev the same day in the 260915c plan (no `api-dist`, no
fleet client build, the two overseer usage files) and import nothing this touches. The eighth was
`tests/help-prompt.test.ts`, red because the code reviewer added the `left unstated` assertion while
the suite was running, before its fix to `helpSection` landed. That was its red-first step, caught
mid-run. On the committed code it passes alone, 10/10.
