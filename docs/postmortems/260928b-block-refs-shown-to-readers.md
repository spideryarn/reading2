# Block references shown to readers

Found by the plain-words session (report 44) while reading eval answers on 2026-09-28: an Explain
answer said *"you can see the contrast surface again later, in block 39"*. Plan, evidence and the
review: [260928c-block-refs-shown-to-readers.md](../plans/260928c-block-refs-shown-to-readers.md).

## What happened

Some model answers named a passage by our internal handle for it rather than by what it says:

- **a block number** — "in block 39", "in blocks 27–28", "the cell-biology material (blocks 52,
  58)". The number is one the reader has never seen anywhere.
- **a block id used as a name** — "Block [spya-dfqq59] gives the publication details", "block
  spya-f6sbgx defines mutual information". In chat the id becomes a link showing `dfqq59`; in
  Explain, and in most other panels, it is shown raw.

Counted over the 108 answers the plain-words eval had recorded: 4 of 72 Explain answers, none of
the 36 chat answers, plus chat's help-about-a-block and three local chat threads. Old and new
prompts alike, so the plain-words work did not cause it.

## The root cause

`articleWithIds` (`src/article-prompt.ts`) shows the model the article as `[39] spya-k3m9qt: text`.
The `[i]` came in with the very first prompt that sent blocks (`2287dca1`, 2026-08-24, the ToC
stage, where position helps), was copied into search, explain and chat, and was kept when those
copies were merged into one function (`5830c94a`, 2026-08-26). Nothing ever read it back: every
answer is keyed by id. So the prompt carried a number whose only possible use was to be quoted.

And **no prompt told the model who can see what**. Chat says to cite ids in brackets; Live says
never to *say* one aloud; sketch bans section numbers. None says the reader cannot see a `[39]`,
and Explain — whose answer is rendered as plain text, and whose own user message said "inside
block spya-…" — said nothing about ids at all. An id is an address for the software, and the model
was never told the audience of its words is a different one.

## The class: an internal handle in the prompt becomes a word in the answer

Anything a prompt shows the model to *work with* — an index, an id, a field name, a label like
`Q3` or `NOT-GISTABLE` — is also something it may *write*, because to the model the prompt and the
answer are one vocabulary. The failure is invisible from the code: the output parses, the ids
resolve, and the leak is in the prose. Each handle needs its audience said out loud, next to it.

## The fix

- `articleWithIds` no longer prints `[i]`; a number the model never sees it cannot quote.
- `BLOCK_ID_NOTE`, printed in the article just above the blocks, says the ids are for the
  instructions, not the reader, and gives the bad and good wording. It travels with the ids, so
  every `articleWithIds` prompt — seventeen today, and any added later — is told, and no prompt shown none is.
  The hierarchy prompts, which number their own blocks, are pinned to `toc/9` and are not told
  yet; the plan leaves the sentence for the next bump. Explain is told any id in its plain-text
  answer is a leak.
- Chat and Explain log `blockRefLeaks` (and Explain `rawIds`) on their finished-answer line, so
  whether the rule holds is a number, not a hope.

Version stamps were **not** bumped; the plan says why and leaves it to Greg.

## What would have caught it

A test cannot make a model obey. What catches the class is the counter: a detector for the
handle, run over real outputs, as a log field and as an eval screen. The plain-words eval found
this only because a person read the answers — the right instinct, and the one the counter now
backs up. For the next handle: when a prompt shows the model an internal token, write down in the
same place who may see it, and add the token's shape to what the logs count.
