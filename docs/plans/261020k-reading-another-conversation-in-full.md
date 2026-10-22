# Reading another conversation in full

Up: [chat-tools.md § The reader's notes](../project/chat-tools.md#the-readers-notes-the-one-tool-not-every-conversation-gets)

From the admin report `spya-sfpcmm` (#640, SPIDERYARN-READING2-M6), queue item `qi-edmt2dy3`:

> In a recent Explore chat, Adrian tried to ask it to have a look at the contents of his most recent
> Recall chat because he wanted to resume from it in Explore mode.
>
> The response was that it couldn't quite read the full chat... chats should have a tool that allows
> them to get the full contents of other chats.
>
> — Greg, 2026-10-19

## What is wrong

The tool already exists. `reader_notes({ thread })` (built 2026-10-03, plan
[261003l](261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md)) reads one of the
reader's other conversations on the same article, and Chat and Explore both have it. What it returns
is not the conversation, though, it is a sample of it:

- each question and each answer cut to **700 characters** (`TRANSCRIPT_TURN_CHARS`);
- only the **newest 10 exchanges** (`MAX_TRANSCRIPT_EXCHANGES`);
- **8,000 characters** in all (`TRANSCRIPT_CHARS`), and anything older than that is unreachable:
  no argument asks for the earlier part.

Measured on production on 2026-10-20 (lengths only, inside `begin read only`; finished messages):

| kind | answers | median answer | 90th pct | longest | answers over 700 |
|---|---|---|---|---|---|
| chat | 103 | 1,934 | 2,912 | 4,452 | 79% |
| explore | 20 | 993 | 1,228 | 1,281 | 100% |
| learn (Recall) | 27 | 698 | 1,247 | 1,954 | 48% |

The longest whole conversation is 27,831 characters (an Explore one), the longest chat 25,447. So
the 700 cut took the tail off most answers, and the 8,000 total cut a long conversation to its last
few exchanges.

**Adrian's case, checked** (GPT Sol's F1; counts and lengths only, no prose read): the Explore
thread opened at 20:28 UTC on 2026-10-19 called `reader_notes` with a thread twice, each strip
reading *8 exchanges*. The only 8-exchange conversation on that article is his Recall conversation
of 20:17, and **all 8 of its answers are longer than 700 characters** (the longest 1,279; 11,693
characters in all). So every answer reached the model clipped, and the model said so. Nothing else
on the path cuts a transcript: `chatStore.load` has no row limit, `HISTORY_TURNS` is the current
thread's, and `converse` passes a tool result through unchanged (Sol checked each).

The 700 and 8,000 were set when the tool's main job was listing notes and the transcript was a
"what was this about" read. Since 261008e (the other conversations come with every question, with
a gist each), the *gist* does the "what was this about" job, and opening a conversation means the
model wants what was actually said.

## What changes

1. **A turn is shown whole up to 6,000 characters** (`TRANSCRIPT_TURN_CHARS` 700 → 6,000). Above
   the longest stored message on production (4,452), and a turn over it still says `[clipped from N
   characters]`, as now.
2. **One call carries up to 32,000 characters** (`TRANSCRIPT_CHARS` 8,000 → 32,000) **and up to 40
   exchanges** (`MAX_TRANSCRIPT_EXCHANGES` 10 → 40). Every conversation now on production fits in
   one call: the longest is 27,831 characters of stored text over 17 exchanges, and the rendering
   adds about 65 characters an exchange (number, two times, two labels) plus some 900 for the
   heading and fence, so about 29,800, inside 32,000 unless its text is full of fence delimiters,
   which escaping lengthens. About 8,000 tokens for ordinary English, paid only when the model
   chooses to open a conversation; nothing on the every-turn path changes. There is no cap on the
   sum of tool results across a turn's rounds, as there was not before: three pages is about
   96,000 characters, far inside the model's window, and an over-long request fails rather than
   being trimmed (Sol's F5).
3. **The earlier part can be asked for.** Exchanges are numbered from 1, oldest first, and the
   tool takes an optional `before: n`, which shows the newest exchanges numbered below `n` that
   fit. When a call does not reach exchange 1, its heading says so and says exactly what to call
   for the rest (`reader_notes({ thread: "<id>", before: <first shown> })`), and every page that
   stops short of the newest names the newer range it left out, so a page asked for by hand is
   never taken for the end. One turn has at most three tool rounds (`MAX_TOOL_ROUNDS`), so a
   conversation past about three pages (some 90,000 characters, three times the longest there
   is) takes more than one turn to read through; each page says where it got to.
4. **The tool's description and the two prompts** (Chat's BUILD ON THEIR EARLIER CONVERSATIONS
   and Explore's "To read one of their other conversations") say a long conversation comes back
   as its newest part, saying so and naming the `before` for the rest, and that when the reader
   asks to read all of it or pick up from it, the model keeps calling until exchange 1. They do
   not promise "whole": a turn over 6,000 characters is still cut, and says so (Sol's F3).

Rules unchanged: whole pairs only, oldest first, unfinished exchanges left out and counted, a
Recall answer shown as the reader saw it, stored text fenced on one line per field, the current
thread and Candidates threads refused with the same sentences, the owner check in the store, the
strip row and the log counts carrying no titles or text.

`before` edge cases, each a sentence and not an error, and none of them a quiet fall back to the
newest page (Sol's F2: a typo while paging would hand back a plausible page already read):
`before` ≤ 1 → "there is nothing before exchange 1"; total+1 → the newest, as absent is; more than
total+1 → "there is no exchange N", nothing read; not a whole number (or a string that is not one)
→ "has to be a whole number", nothing read; `before` without `thread` → "needs that conversation's
id", nothing read. The strip's detail stays *N exchanges*.

## Who gets it

Unchanged: typed Chat and Explore. Greg's words are "chats should have a tool", and Adrian's
case was Explore reading a Recall conversation, which Explore already could. Recall and Tutorial
were left without the tool on purpose (chat-tools.md, PR-3: they are about the article, and their
prompts say not to guess how far the reader has got) and that reason still holds. Live and the
guide are unchanged.

## Risk, said plainly

The owner boundary and the outbound URL caps are unchanged: it is still only the signed-in
reader's own conversations on this article, through the same store loads and the same kind gate.
**What an injected model can see, and how far back, does increase** (Sol's F4): up to 32,000
characters a call instead of 8,000, and the oldest exchanges, which no call could reach before.
The old caps were not an ownership defence, but they did bound that. The exfiltration path is the
one chat-tools.md already names (a hostile page persuades the model to read private text and put
it in a URL); the URL caps bound bulk, and a single sentence could leave before and can now. No new
mechanism, so no new row in security-map.md; chat-tools.md's risk paragraph now says the larger
figure. The fix for that path is still the allowlist in chat-tools.md § Still open.

## Passed over

- **Just raising the caps, no `before`.** Simpler by a parameter and a sentence, and enough for
  every conversation on production today. But the report is literally "could not read the full
  chat", and a cap with no way past it is the same report again once an Explore conversation
  grows past the budget. Paging is a dozen lines and keeps the per-call bound.
- **No cap at all.** A conversation can be any length, and the result goes back into the model's
  context for every later round of the turn.
- **Keeping markdown line breaks.** One line per field is what stops stored text forging a row;
  flattened prose reads fine to a model.
- **A separate `read_conversation` tool.** Same data, same owner, same exclusions; a second tool
  would duplicate `reader_notes`' gate and its tests for nothing.
- **Giving Recall and Tutorial the tool.** A product call already made the other way; not reopened
  by this report.

## Tests

In `tests/reader-notes-tool.test.ts`. The first three were written first and watched fail against
the old code; the plumbing ones came after Sol's F6, and the forwarding one was watched go red with
`before` dropped in `readReaderNotes`:

- a 3,000-character answer comes back whole;
- a 30-exchange conversation over the budget, paged with the `before` each answer names, returns
  every exchange exactly once, numbered, oldest first within a page;
- `before` of 1, total+1, more than total+1, a fraction and `NaN` each give their sentence or the
  newest;
- a page asked for by hand names the newer range it left out;
- `runTool` forwards `before` as a number or a numeric string, refuses one that is not, and refuses
  `before` without `thread` without reading anything; the schema offers `before` as an integer;
- the existing budget, whole-pair and per-line tests go on holding at the new constants.

The prompt change is checked with `evals/chat-other-threads.ts`, since the new sentence sits in the
bullet that decides when Chat opens an earlier conversation: [§ Measured](#measured).

## Measured

`npx tsx evals/chat-other-threads.ts --repeats=3`, 2026-10-20, with the new prompt sentence and
the new transcript, about $1:

| question | with gists | with latest question | no list |
|---|---|---|---|
| "Where is his argument weakest?" (should open A) | A 3/3 | A 3/3 | nothing 3/3 |
| "Remind me what computational functionalism means?" (should open B) | B 3/3 | B 3/3 | nothing 3/3 |
| "Who is Blake Lemoine?" (should open nothing) | nothing 3/3 | nothing 3/3 | nothing 3/3 |

The same as 261008e's figures: the added sentence did not widen when Chat opens an earlier
conversation. Each answer that opened one still built on it ("Here are different ones…"). The
fixtures are short, so no answer here needed `before`; the paging is covered by the tests, not
by this eval.

## Code review

GPT Sol ([findings](261020k-code-review-findings-sol.md), [answer](261020k-code-review-sol.md))
found no off-by-one, budget breach or leak, and fixed two things: an explicit `before: null` now
gets the same sentence as any other unusable cursor, rather than reading as absent; and the prompts
no longer say "keep calling until exchange 1" when a turn has only three tool rounds. Its prompt
wording had the model put the raw `before` number in its reply for the next turn; that was cut back
to *tell them you have not read the start of it*, because the number is our jargon in front of a
reader and no conversation on production needs a second page yet.

## Deferred

Nothing from this report.
