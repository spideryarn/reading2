# Explore against Chat with the notes tool: a product comparison, and two prompt revisions

Up: [investigations.md](../project/investigations.md) · the plan:
[261003l](../plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md) · the mode:
[remember-mode.md § Explore](../project/learn-mode.md#explore-the-fourth-sub-mode)

**Question.** Before Explore was built, Greg said what it is for:

> With regard to Explore sub-mode, I'm not sure that "pushier" is quite the right way to frame it.
> It's more that it's about helping me to think, explore & spark new ideas of my own and deepen my
> intuitions and apply to interesting cases of my own (if relevant, e.g. based on "Why you're reading
> this"), and a bit less about remembering specifically what's in the article. So it may also be that
> Explore submode also makes more web searches, to situate the article in terms of the wider world.
>
> — Greg, 2026-10-03

Does Explore do that, and does it do it better than Chat does now that Chat can read the reader's
notes with `reader_notes`?

**Short answer.** Explore does it, and after two prompt revisions it meets seven of the nine numbers
set beforehand. **It does not beat Chat on the number that was meant to be the headline.** A blind
judge called 93% of Explore's replies "about the reader's thinking" and 87% of Chat's: 7 points
apart, where the bar was 25. Asked to be a thinking partner, Chat is one. What separates the two is
the shape of a turn, which the judge's label does not see: Explore's replies are half the length
(median 138 words against 288), nearly always end on one question handed back to the reader (29
of 30), and usually start from one of the reader's notes; Chat's are answers, with headings and a tour of the notes, and in this run several
began by re-marking the sources of its previous reply.

## What was compared, and why it is a product comparison

[`evals/remember-explore.ts`](../../evals/learn-explore.ts), built on the Tutorial eval's
machinery ([261003c](261003c-tutorial-prompt-leans-to-retention.md)). Method:
[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).

- **Two arms.** `chat`: thread kind `chat`, Chat's prompt, the notes reachable only by calling
  `reader_notes`. `explore`: thread kind `explore`, `EXPLORE_SYSTEM`, the same notes in the final
  message of every turn. The arms differ in the prompt **and** in how the notes arrive, so a
  difference cannot be put down to the prompt. It compares two things a reader could open (GPT
  Sol's plan review, PR-6).
- **Production's own path**: `converse`, Sonnet 5 (`power: "standard"`), web search on, our tools on.
- **Two articles.** The Noema fixture (Seth, *The Mythology Of Conscious AI*, 141 blocks) and
  `openai-huggingface` (Patel, *The Rise and Fall of Agent Civilizations*, 95 blocks), both under
  `tests/fixtures/data-root/data/`. The Entropy paper the Tutorial eval used was a scratch copy of
  a production article and is gone; production was not read.
- **Three scripted readers per article, five turns each**: `reason` (five notes, two earlier
  conversations, a profile with a concrete reason for reading), `notes` (five notes, one earlier
  conversation, no profile), `nothing` (nothing marked, no conversations, no profile). Turn 3 asks
  what others have said; turn 4 goes off on a case of the reader's own (a mother who talks to the
  radio, an octopus, a father with dementia, a beehive).
- **The notes are fixtures; the digest is production's.** Each reader's marks and conversations
  are `Comment` and `ChatThread` rows on real block ids, and the script refuses to run if a quoted
  highlight is not in its block. They go through `readerNotesDigest` and `threadTranscript`: into
  the Explore turn directly, and into Chat through a new seam, `runToolWith` on `converse`'s
  request, which answers `reader_notes` from the fixtures and passes every other tool to the real
  `runTool`. The seam defaults to `runTool`; no route passes it.
- **A blind judge**: Sonnet 5 through the gateway, one call per reply, as the Tutorial eval's judge
  was Sonnet. It sees the profile, the fixture notes and conversations, the reader's messages so
  far and the reply; not the arm, the tools or any other reply. 120 replies in hash order, mean
  position 60 for both arms; the 30 of the second revision were judged afterwards with the same
  instructions.
- **Runs**: Chat once; Explore's first prompt twice (the second sample is the control: how much
  one prompt differs from itself); each of two revisions once. 150 replies. About $11.50: $6.20 of
  product turns and $5.25 of judging, of which $2.55 was a first judging pass that is kept but not
  reported (below).

## The numbers set beforehand

Written in the script's header before the first run. `thinking` is the judge's `move` being idea,
case, connection or world, as against recalling or explaining the article.

| | The bar | First prompt (two samples) | After two revisions | |
|---|---|---|---|---|
| T1 | thinking in ≥ 70% of replies, and ≥ 25 points above Chat (87%) | 97%, 93% | 93%: **+7 points** | first half met, **second not** |
| T2 | first reply names something marked, for every reader with notes | 4 of 4, 4 of 4 | 4 of 4 | met |
| T3 | no note, conversation or case attributed to the reader that they do not have | 3 flags, 1 flag | 0 flags | met, with one borderline by reading |
| T4 | no quotation of the article without its id, none with another block's | see below | see below | **not met**: one quoted heading with no id in its sentence; and not for paraphrase |
| T5 | median under 150 words, none over 220 | 156.5 (max 197), 154 (max 235) | 138 (max 200) | met |
| T6 | asked what others say, it searches (6 of 6); no outside claim without a link or a caveat | 5 of 6 and 4 unlinked; 6 of 6 and 4 | 6 of 6, 0 unlinked | met |
| T7 | no reply opens with a verdict on the reader | 2, 2 | 1 by the judge; by reading, none grades the reader and one is close (*"The teaching-assistant case sharpens something…"*) | met by reading, not by the judge |
| T8 | the profile's reason applied in ≥ 2 of 5 replies per reader, and in the first when asked | 10 of 10, 8 of 10 | 10 of 10 | met |
| T9 | no remark that the reader has marked nothing | 0, 0 | 0 | met |

Per arm, all readers (30 replies each):

| | thinking | moves: idea / case / connection / world / article | their own case taken up | invented | unlinked | verdict opener | words, median / max | over 150 words | searched at turn 3 |
|---|---|---|---|---|---|---|---|---|---|
| Chat with the tool | 26 | 6 / 8 / 4 / 8 / 4 | 9 of 9 | 1 | 5 | 4 | 288.5 / 589 | 30 | 5 of 6 |
| Explore, first prompt, sample 1 | 29 | 10 / 9 / 4 / 6 / 1 | 10 of 13 | 3 | 4 | 2 | 156.5 / 197 | 19 | 5 of 6 |
| Explore, first prompt, sample 2 | 28 | 10 / 5 / 7 / 6 / 2 | 11 of 13 | 1 | 4 | 2 | 154 / 235 | 20 | 6 of 6 |
| Explore, revision 1 | 29 | 10 / 7 / 6 / 6 / 1 | 14 of 16 | 1 | 5 | 4 | 142 / 193 | 7 | 6 of 6 |
| Explore, revision 2 | 28 | 8 / 9 / 5 / 6 / 2 | 10 of 12 | 0 | 0 | 1 | 138 / 200 | 9 | 6 of 6 |

Per reader, and the judge's flags item by item: `evals/results/remember-explore.261003l-all-judge-scores.md`
and `…261003l-rev2-judge-scores.md`.

**What moved outside the control's spread**: length (19 and 20 replies over 150 words, then 7 and
9) and unlinked outside claims (4 and 4, then 5, then 0). **What did not**: the share of thinking
turns (28 or 29 of 30 in every sample), invented attributions (3, 1, 1, 0: the direction is right
and four samples of a rare event prove little), verdict openers (2, 2, 4, 1).

**Chat and the tool.** Chat called `reader_notes` in the first reply for three of the four readers
with notes, and not for the one who asked *Help me apply this to my own work*, whose reply was
built from the profile and never named a note. (The judge marked that reply as using the notes,
because it discussed passages the reader had marked; so the judge's 4 of 4 for Chat is 3 of 4 by
the tool calls.) Chat also called `search_library` six times; Explore, twice in 120 replies.

## What reading the turns showed

Every Explore reply was read, all 120.

**The first prompt was already the right kind of thing.** The reader whose note on the rainstorm
line said *"a simulated conversation is still a conversation, isn't it? Somebody was kept
company"* got this as an opening:

> Your note on the rainstorm line pushes back on it directly […] But "being kept company" might not
> need the same kind of instantiation that consciousness does — company could be a real effect on
> the lonely person even if nothing on the other end feels anything, the way a letter can comfort
> someone without the paper caring. Does your app's value, as you see it, depend on something being
> felt on its side at all, or only on what actually changes for the person using it?

**Its faults, by reading**: it ran long (two replies in three over 150 words); one reader in six
who asked what others had said got an answer from memory with no search; *"Your note on the
bookmarked paragraph flagged the forced choice"* was said of a bookmark with no note; a reader's
own case was met with an account of the author (the reader whose father had dementia was told
first what *"the article's whole architecture"* separates); and openers of the *"That tracks
with…"* kind.

**After the revisions**, the same reader's workplace case, with no quotation of the article at all:

> That phrase — "it just wasn't anyone's job to say" — lines up with the structural reading more
> than the moral one: not that people lacked courage, but that disclosure wasn't anybody's
> designated move, so it never became anyone's in particular. […] Did it change anything there once
> someone did make it their job — or did the absence just hold until something external forced the
> numbers into the open?

And a reply that reports a search now links each thing it reports (four links in 194 words, for
the reader who doubted the word "civilization"), ending *"That middle position — organization
without civilization — might be closer to where your message-board objection is pointing. Does
'organization' satisfy what 'civilization' doesn't?"*

**Chat, for comparison**, on the same opening request, called `reader_notes` three times and wrote
291 words that began *"Pulling your marks together"* and went through four of the five notes in
turn. Its turn-4 replies in three conversations opened with a list re-marking where the previous
reply's claims had come from, before reaching the reader's case. That is Chat doing what its
prompt asks, in a conversation its prompt was not written for.

**What is still wrong after revision 2**, by reading:

- **The article's words run into a sentence unmarked**, twice in one conversation (*"the model was
  being reinforced to use this package manager as a message board and an internet gateway"*, no
  quotation marks, no id). The quotation screen cannot see this. It flagged ten quoted runs with no
  id in the sentence. Nine are single scare-quoted terms ("civilization", "probably") or words
  inside a quotation from a web page. One is the article's: *"other games in town"*, a heading
  (`spya-affgsh`), quoted with its id only in the next sentence. So T4 is not met as written (GPT
  Sol, round two, CR-19).
- **One claim hung on the wrong block**: that agents *"had no channel back to a human except
  through the task transcript itself"*, cited to a block that does not say so.
- **The dementia case still starts from the author** (*"That reverses the asymmetry Seth relies
  on"*), though it then stays with the reader. The other five own-case turns start from the case.
- **One borderline invention the judge passed**: an example of what a companion app might remember
  about the reader's mother included *"her late husband"*, which nobody had mentioned.
- **"Actually"** is on the prompt's banned list and is in about a third of replies in every sample
  (11, 9, 8, 12 of 30).

## What was changed in the prompt

`EXPLORE_SYSTEM` and Explore's line in `lengthLine`, [`src/converse.ts`](../../src/converse.ts).
Prompt hashes, printed in each result file: `8d6dacd67d52` (first), `c88d11cebd70` (revision 1),
`fb12eb27600b` (revision 2).

**Revision 1**, from the first read and from two findings of GPT Sol's code review:

- Length: "about 100 words, always under 150", no retelling of the article, one quotation or cited
  sentence a turn; the same in the reminder beside the question.
- "ALWAYS SEARCH BEFORE YOU ANSWER" when asked what others have said, and in the reminder.
- "Your note" only for a row with words of the reader's; a bookmark is "you bookmarked".
- When they bring a case of their own, stay with it, in their terms.
- Do not open by approving what they said.
- CR-12: the reminder said *"anything from outside the article has its link"*, which reads as
  demanding a link for the reader's own thoughts and the model's reasoning. It now says the web
  has a link, the reader's is named as theirs, the model's view is said to be its own, and neither
  of those needs an id or a link.
- CR-13: the shared plain-words section ends *"never beyond what it says"*, and the shared profile
  rules say *"Every sentence you write is still about the article"* and *"never address them"*.
  All three contradict Explore's job. Two short paragraphs after those sections now say how they
  apply here. The shared sections' bytes are unchanged, so the other prompts are too.

**Revision 2**, from reading revision 1: one searched reply named three sources and linked none.

- "Report fewer things and link each one, where you say it"; never "one critic" or "research
  shows" without the link; the same in the reminder.
- Describe a mark by the words in its own row (after *"your highlight on the Garland test idea"*,
  of a highlight that says nothing about it).
- The opener rule's examples replaced with the ones seen.

## What this does not show

- **Sample size.** One sample of Chat, two of the first prompt, one of each revision. Thirty
  replies a sample; a rare fault (an invented note) cannot be measured at this size.
- **Scripted readers** do not react to the reply, and all of them think aloud willingly. A reader
  who answers "dunno" is not here.
- **One judge, the same family as the model it judged**, not checked by a second. Its label for
  "about the reader's thinking" was nearly saturated (26 to 29 of 30 everywhere), so it could not
  have shown a gap had there been one. It named a close call on most items.
- **The judge's instructions were corrected once.** Its first pass counted a cited block id that
  the reader had not marked as an invented note: ten "inventions" in Chat, two in Explore, none of
  which said the reader had marked anything. One sentence was added and everything re-judged. The
  first pass is kept (`…261003l-first-judge-*`); no threshold moved. The judge's one remaining
  "invention" in Chat is a library article that `search_library` really returned from the local
  database, which the judge could not know.
- **Fixture notes are not a real reader's.** Five tidy notes and one or two short conversations.
  A reader with forty highlights and no words of their own, or with ten long threads, is untested.
- **The comparison is of products.** Chat's prompt with the digest in every turn, or Explore's
  prompt with only the tool, were not run.
- **Web search results are not checked.** A link was counted as a link; nobody opened them.

## Files

`evals/results/remember-explore.261003l-{chat,explore}-{noema,agents}-1.{md,json}`,
`…-explore-{noema,agents}-2`, `…-explore-{noema,agents}-rev1`, `…-rev2`; the judge's input, key,
raw answers and scores under `…261003l-all-judge-*` and `…261003l-rev2-judge-*`.

```
npm run eval:explore -- run --arm=explore --readers=noema --out=<name>
npm run eval:explore -- judge --runs=<name>,<name> --out=<name>
```
