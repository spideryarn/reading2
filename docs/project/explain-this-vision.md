# Vision: "explain this", from a glossary term to a hard sentence

Up: [reading-view-overview.md](reading-view-overview.md) · the evidence:
[261022b-explain-this-evidence.md](../research/261022b-explain-this-evidence.md) · what was built
first: [261022f](../plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md)

> **Not decided.** A direction of travel, written up at Greg's request on 2026-10-22, the same kind
> of doc as [interface-vision.md](interface-vision.md). Nothing here is built except what
> § Where we are says. When a piece of this is decided, it moves into the doc that owns it and comes
> out of here.

## What Greg asked for

He was reading Rovelli's *The Order of Time* and met a name he did not know (`spya-e5t77w`,
2026-10-21; the whole report is in
[the note](../user-feedback/261021_2311-torricelli-explain-names-the-glossary-missed.md)):

> In this paragraph […] it makes reference to Torricelli. I don't know who that is. I was hoping
> that the sources mode would notice it. […] I can open up a chat, but the whole point is to make
> it just a click away.

> there's almost a continuum from the glossary to ideas to citations. They're all stuff that happens
> where you might want an inline way to find out more. […] Let's just focus on the glossary and the
> citations and the things that are referred to that aren't cited. […] In the case of something like
> Torricelli, whoever that is, maybe that requires a web search. […] I'd quite like to give a bit of
> discretion to the LLM that, you know, if it doesn't know the answer, if it's not sure, or if it
> needs disambiguation or whatever, that it has the option to run web searches for stuff.

> maybe by default, we just highlight a crapload of things that might deserve further explanation.
> And then maybe you click on them to find out more. I think the downside is then there's a delay,
> which sucks. […] one option would be to say that we generate a big list of things that might
> deserve a, you know, a hover, you know, an underline or whatever for further explanation. But then
> we only generate them for the first portion of the article. And then if the reader gets sort of
> towards the end of that portion, then we generate the rest.

> I've increasingly been thinking that it'd be useful to have an explanations underlined, where we
> just be like, This sentence or this idea or this phrase is complicated. Help me understand it or
> unpack it or whatever. […] often when I click on a citation, what I'm really asking is, you know,
> what does it say? Help me understand why it's referenced. What should I know?
>
> — Greg, 2026-10-21

## The continuum

One question sits underneath all of these: *what do I need to know to read past this?* The thing
pointed at gets wider as you go down the list:

```
  what the reader points at          what they want to know                where it lives today
  ─────────────────────────────      ────────────────────────────────      ───────────────────────────
  a term the author bends            what it means HERE                     Glossary (senseHere)
  a term, name or work, borrowed     what it ordinarily is                  Glossary (background)
    e.g. "Torricelli"
  a cited work                       what it says, and why it is cited      Bibliography card (blurb)
  a claim, an idea                   what the piece takes for granted       Ideas, Marginalia
  a hard sentence or passage         help me unpack it                      select → Ask AI
                                                                            ("Explain this passage.")
```

The first three rows are **referents**: something outside the sentence that the author assumed you
would bring. Explaining one is a footnote in a good edition. It supplies what you lack and leaves the
reading to you, which is squarely what [vision.md](vision.md) means by augmenting. The last row is
different in kind. An explanation of a sentence can become the thing read *instead of* the sentence.
That is where "explain this" stops augmenting and starts replacing, so it is the row to be most
careful with.

**One kind of card, not one kind of entry.** The rows already have different owners for good
reasons. *A cited work is not a term* (Greg, 2026-10-03,
[glossary.md](glossary.md#a-cited-work-is-not-a-term)), and Torricelli does not need that line
moved: he is told about, not cited, so he is already the glossary's. Where the continuum can be one
thing is the **hover card**. Whatever the reader points at, the card answers the question in the
second column, in the same place and the same shape. A citation's card already carries a blurb
([sources.md](sources.md)); *why is it cited here* is the natural next line for it.

## What the evidence says, in five lines

From [261022b](../research/261022b-explain-this-evidence.md):

1. **Background knowledge matters, and most for what the argument rests on.** Missing knowledge
   costs little until a threshold, and then a lot. A name that is only an example costs less.
2. **An underline is a claim that something matters.** It pulls a skimming eye, and it makes the
   text without one look less important. So how many things get underlined is a design decision. It
   should not be a by-product of how cheap finding them is.
3. **Every reader needs different things explained**, even experts in one subfield. No list is
   complete for every reader, and a list that looks complete gets trusted as complete. Letting the
   reader point at *anything* is the only full answer.
4. **A card that is already there and a card that has to be written are different interactions.**
   Help that arrives after the hard passage is worth much less than help during it.
5. **Models are least reliable on obscure names, and retrieval fixes that end.** Search-backed
   answers are still often unsupported by what they cite, so show the source.

## Where we are (2026-10-22)

- **The glossary of a long piece grows with its length, and takes in names met once** (built,
  plan [261022f](../plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md);
  [glossary.md § A long piece, and a name met once](glossary.md#a-long-piece-and-a-name-met-once)).
  The miss had two causes. One was a cap: one pass of 20 terms whatever the length, so a
  38,000-word book got 21 entries. The other was a rule that left out names the argument does not
  rest on. Now the count follows the length, a long piece is worked through part by part, and a
  name named without introduction earns an entry even if it appears once. On that book a first run
  gives about 70 entries, Torricelli among them, and one *Find more* on the old list does the same.
  The cost of point 2 above is real: about half the book's blocks now carry an underline, against a
  quarter before.
- **Look up a term**: a reader can type any word into the Glossary band and get a streamed answer.
  The model may search the web on its own judgment, and the answer is added to the list
  ([glossary.md § Looking a term up](glossary.md#looking-a-term-up)). It only helps a reader who knows
  the box is there.
- **Explain a selection**: select a passage and press *Ask AI* with nothing typed, and it asks
  *"Explain this passage."* in a chat anchored to it ([comments.md](comments.md)). This is the
  reader-initiated version of the last row.

## The next steps, simplest first

None of these is built, and each is queued rather than promised.

1. **Select a short phrase → "Look up".** When a selection is a few words long, offer the glossary's
   own *Look up* beside *Ask AI*. It adds no marks, the reader starts it, and it covers whatever the
   list missed, which point 3 says any list will. It mostly reuses `term-lookup.ts` and the selection
   box.
2. **Say that the list is not everything.** One line on the card or in the band, along the lines of
   *select any other word to look it up*, so a missing underline is not read as "nothing to know
   here" (point 3).
3. **A fainter underline for a name the argument does not rest on.** Since 2026-10-22 a book's
   passing names are underlined like its key terms, and the evidence (point 2) says that lifts side
   examples to the level of the argument. A quieter mark for a low-centrality entry would keep them
   one point away without that claim. It is a small CSS and `termMarks` change, and the threshold
   that would decide "low" already exists.
4. **A citation's card says why it is cited here.** That is Greg's *"what does it say? Help me
   understand why it's referenced"*, on the card that already exists.
5. **Search when the name is obscure.** For the batch, only if a long list shows wrong background on
   obscure names; the evidence says retrieval pays off on rare entities and not on famous ones. The
   reader's own *Look up* already searches.
6. **Candidates underlined, explanations written ahead of the reader.** This is Greg's two-stage
   idea: find many cheaply, and write the entries for the next stretch as the reader approaches. It
   is the right shape if a long piece is still thin after the 2026-10-22 change, and the evidence says to write
   *ahead* rather than on click, because a wait at the moment of need breaks the reading. But a cheap
   first pass either underlines too much or misses too much (Reading.help: 18–38% of its underlines
   were right). It is also several stages of work: a new entry state, a second underline, streaming
   into the card, a prefetch scheduler, and an allowance so a stranger's clicks cannot spend without
   limit.
7. **"Explain this sentence", underlined.** The reader-initiated version exists (above). A version
   where the model underlines the sentences it thinks are hard is the one the evidence and the
   principles are most against, because it takes away the reader's own confusion signal, which
   [vision.md](vision.md#where-this-goes-after-granularity-zoom) calls the most valuable input we
   have. If it is ever built, it should sit **beside** the author's sentence, never replace it, and it
   could offer *what do you think it means?* first (the self-explanation evidence).

   **Greg asked for it on 2026-10-28** (spya-nkq6rj: *"what I'd love is if it did it proactively, in
   much the same way that the glossary is proactive"*), and the first part is built as
   [explanations.md](explanations.md): the few places a reader would get stuck, each explained
   beside the author's words, in the margin and a mode under *More*, experimental and owner-only.
   It answers this step's caution by a cap (one per six paragraphs, at most fifteen), *Not sure* and
   *Draws on AI memory, unchecked* labels, and explanations of the missing piece rather than
   paraphrases. The underline in the prose and the *what do you think it means?* prompt are not
   built.
