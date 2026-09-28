# Block references shown to readers — "in block 39"

Bug mode. Found by the plain-words session (report 44, plan
[260926a](260926a-plainer-summaries-and-glossary.md)) on 2026-09-28: model answers sometimes name a
passage by our internal handle for it — *"you can see the contrast surface again later, in block
39"* — under both the old prompts and the new. The postmortem is
[260928b](../postmortems/260928b-block-refs-shown-to-readers.md).

## The evidence

**Where the number comes from.** `articleWithIds` (`src/article-prompt.ts`) prints every block as
`[39] spya-k3m9qt: text`. The reader never sees either handle: the `[39]` exists only in the
prompt, and an id becomes a chip showing six random characters in the three panels that render
through `Cited.tsx` (chat, candidates, quiz marking), and shows **raw** everywhere else.

**What leaked, counted** with the detector below over every answer the plain-words eval recorded
(`evals/results/plain-words/answers/`, six arms, 108 answers: 36 chat, 72 Explain):

| answer | leak | rendered as |
|---|---|---|
| Explain, term *monosemantic* (before-2) | "in block 39" | plain text, `CommentDialog.tsx` |
| Explain, term *synergistic* (after-4) | "in blocks 27–28" | plain text |
| Explain, sentence *transfer entropy* (before, after-3) | "block spya-f6sbgx defines mutual information, and spya-p4pyuy defines…" | plain text: raw ids |
| chat help-about-block (artefacts/after) | "the cell-biology material (blocks 52, 58)", "the hinge before block spya-da9tvt" | chat: the number raw, the id a chip |
| local chat threads (3 messages) | "Block [spya-dfqq59] gives the publication details" | chat: "Block dfqq59 gives…" |

So: **4 of 72 Explain answers (~6%)**, 0 of 36 eval chat answers, and a handful of chat answers
elsewhere. Explain is the worst path: it is the one answer that sees the numbered article, the
reader's position line *and* "inside block spya-…", has no word in its prompt about ids, and is
rendered as plain paragraphs, so an id arrives as `spya-f6sbgx`.

**Who else could.** An audit of every prompt that is shown block ids or indices (20 of them:
search, explain, chat, remember, candidates, faq, ideas, debate, citations, sketch, illustrated,
live, quiz, quiz-mark, timeline, referee claims and criteria, mirror, hierarchy, expand, labels)
found **none** that tells the model the reader cannot see these handles. Live says never to *say*
an id aloud; sketch bans section numbers; FAQ, ideas and quiz ban "in the third section"-style
locating. No prompt covers `[39]` or an id used as a passage's name, and most of those outputs are
rendered as plain text. **Nothing reads the `[i]` back**: every answer is keyed by id, and
`hierarchy-expand` already calls its numbers "only a reading aid".

## The fix, in three layers

*Revised after GPT Sol's plan review (below): the rule moved out of the plain-words core.*

1. **Take the number away where nothing needs it.** `articleWithIds` prints `spya-k3m9qt: text`,
   without the `[i]`. A number the model never sees is one it cannot quote. The ids stay: they are
   what every citing stage answers with. `renderBlocks` (hierarchy, expand) keeps its `[i]`,
   because the tree is where position does the most work and a change there is measured against a
   much bigger eval.
2. **Say it next to the ids.** `BLOCK_ID_NOTE`, in `src/article-prompt.ts`, is printed in the
   article just above the blocks: the ids are for these instructions, not for the reader; put one
   only where asked for an id or a citation; never name a passage as "block 12" or
   "block spya-k3m9qt"; say what it says. It travels with the ids, so every prompt shown them, now
   and later, is told, and no prompt shown none is. The hierarchy and expansion prompts, which render their own numbered blocks, are **not** told
   yet: see *Hierarchy: left for the next `toc` bump* below. **Explain**, whose answer is shown
   as plain text, is told a block id there reaches the reader as a meaningless code, and its user
   message no longer says "inside block spya-…" a second time after the position line.
3. **Count it in production.** `blockRefLeaks(text)` (`src/block-ref-leak.ts`): the word *block*
   followed by a number or (with a little punctuation between) an id. Chat logs its count beside
   `unknownIds`; Explain logs it and `rawIds`, every id-shaped string, because there any id is a
   leak. It over-counts an article whose own subject has numbered blocks ("block 3 of the trial"),
   so it is a screen for a log line, never a guard.

## GPT Sol's plan review — approve with changes

- **P1, detector too narrow and too broad.** It missed "the next block, spya-f6sbgx" (punctuation
  between), and a genomics paper's "Blocks 1-4" would count. *Taken*: punctuation allowed;
  Explain counts every raw id separately; the over-count is named in the module and the detector
  is only ever a log field.
- **P1, stamps.** A change to the plain-words core reaches seventeen stamped prompts, and the guide
  says to bump them all. *Taken by moving the rule*: it no longer touches `plainWords()`, so arc,
  glossary, link summaries, quotes, trajectory and tweets do not change by a byte. The stamps of the
  eight id-bearing stamped stages are still not bumped — see below.
- **P2, wording.** "The reader sees no id" is false in chat, where an id is a link, and would fight
  chat's citation rule. *Taken*: the note says where an id may go rather than that none is seen.
  And Explain's duplicate "inside block …" is gone.
- **P3.** Confirmed nothing reads `[i]` back and the fingerprint hashes blocks, not bytes; the
  function's own comment promised an index, and now does not.

## What I passed over

- **The plain-words core as the rule's home** — the first version of this plan. It reaches every
  prompt, including the many shown no ids, and moves seventeen stamps for a rule that concerns
  eight. The note beside the ids reaches exactly the prompts that need it.
- **A guard that rewrites the answer** (strip "block 39", or turn it into a link by mapping the
  index back to an id). Stripping leaves a broken sentence ("you can see it again later, in ,
  where…"); mapping trusts the model to have counted with our index. Both would run in twenty
  renderers or writers. The prompt fix removes the cause; the counter says if it did not.
- **Rendering Explain through `Cited.tsx`**, so its ids become links. Prettier symptom, and an
  invitation to more ids in a prompt that never asked for any.

## Stamps: not bumped, deliberately

The id-bearing stamped stages that now send different bytes — faq, ideas, debate, citations,
sketch, illustrated, quiz, timeline (toc and expand do not; see below). A bump regenerates each of them for every article on every
shelf the next time it is opened: a real paid run in production, to fix a leak seen in a few per
cent of answers and in none of the stored artefacts the local scan could find (every hit was in
chat). New generations get the note; old ones keep what they had, which is the same output
contract. **For Greg:** if you would rather pay for a clean sweep, it is one commit of version
bumps. The fingerprints do not move either way: `articleWithIdsFingerprint` hashes the blocks, not
the rendered string, so the change retires warm prompt caches once and stales nothing.

## Hierarchy: left for the next `toc` bump

The first build gave the hierarchy and expansion SYSTEMs a sentence too. The full suite went red on
two pins that exist for exactly this — `tests/hierarchy-structure-request-parity.test.ts` pins the
bytes, and `tests/hierarchy-prompt-hoist.test.ts` pins the checkpoint key — and every earlier
SYSTEM change there has gone out with a `toc/N` bump, which regenerates every tree. No hierarchy
output has been seen to leak (the gists and questions of the local corpus have none), so the
sentence came out again. **For Greg, or whoever next bumps `toc`**: add "The numbers and ids are
for you, not for the reader: a title, gist or question never names a passage as "block 12" or by
its id." to both SYSTEMs in the same bump.

## Tests

- `tests/block-ref-leak.test.ts` — the detector finds every leak in the table above, verbatim, and
  passes "Section 4", "[10]", "building blocks" and a bracketed citation. `articleWithIds` has no
  `[n]` ordinal and carries `BLOCK_ID_NOTE`; Explain's SYSTEM carries its sentence. Red before the fix.
- `tests/block-ref-leak-log.test.ts` — chat and Explain, with a stubbed model answering "in block
  39" or "Block spya-… then defines", log `blockRefLeaks: 1`, and `0` for a clean answer. Red
  before the fix (the field did not exist).
- The golden string in `tests/article-prompt.test.ts` is updated, with its note saying why.

## Measuring

The guide's method at dev scale: `evals/plain-words/answers.ts generate` twice on the fixed tree,
as arms `after-12` and `after-13` (36 answers, 18 each; the harness only accepts `before|after-N`
names), counted with the detector — an answer leaks if it has a block number, an id named as a
block, or, in Explain, any id at all:

| arms | prompts | answers | leaking |
|---|---|---|---|
| before, before-2 | old | 36 | 2 ("block, spya-f6sbgx…", "block 39") |
| after … after-4 | plain-words | 72 | 2 ("block spya-f6sbgx…", "blocks 27–28") |
| **after-12, after-13** | **this fix** | **36** | **0** |

36 answers cannot prove a 4% rate went to zero, and this does not claim to. What it shows: the
case that leaked twice before — Explain on the sentence naming *mutual information* and *transfer
entropy* — now says "the article defines it formally right after this" and "spelled out in the
paragraphs right after this one", which is the behaviour the note asks for. I read those two answers; the rest I checked by the
detector and by length (mean 1,922 and 1,859 characters, against 1,844–2,056 for the earlier arms). The log counter carries the rest.
