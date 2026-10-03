---
reports: spya-ma5h9b
ending: shipped
---
# Highlighting on an iPad did nothing, and should highlights appear in Quotes?

Report `spya-ma5h9b`, a problem, from Greg (admin), 2026-10-03 09:29 UTC, from his iPad, relayed by
the Overseer, on
`https://www.spideryarn.com/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564?…&mode=search…`:

> I thought I had read in the changelog that the ability to highlight sentences was now available. I
> tried highlighting a few words on my iPad and it didn't seem to work. It just flashed up the usual
> iPad context menu.
>
> Maybe this needs further discussion because I'm not exactly sure how it should even work, whether
> it should add them to the quotes mode with a special indicator to say that the user added them or
> what.

**Ending: Shipped**, on `dev` (`fb5738446`, `ea5b970d0`). It is the touch half of plan
[261003e](../plans/261003e-span-highlights-with-a-colour.md), whose stage 1 (the colours) was
already live when he tried it. The earlier reports are `spya-rze8qh` and `spya-xhvxue`, which stay
open until the menu question is answered.

## What was wrong

The changelog was right and so was he. Highlighting had shipped, but only for a mouse. The box that
offers a colour opens when a mouse button is released, and an iPad's long-press selection never
sends that event. So a finger's selection reached nothing of ours, and the iPad's own menu was all
that appeared. The plan listed touch as "deferred, untested"; it should have said "does not work".

## How to highlight on an iPad now

1. Long-press a word in the article and drag the handles over the words you want, as usual. The
   iPad's own menu appears above them; ignore it.
2. About a third of a second after the handles stop, a button appears just **below** the selected
   words: **Highlight or comment**.
3. Tap it. The same box opens that a mouse gets: the words quoted, a row of colour dots (none,
   yellow, green, blue, pink), a place for a note, and the Ask AI tick-box.
4. Pick a colour and Save. Tap a highlight later to recolour it, remove the colour, or delete it.

One paragraph at a time: a selection that runs into the next paragraph keeps only the first.

**This has not been tried on a physical iPad.** It was built and checked in tests and in Playwright
with an iPad profile (WebKit and Chrome). That check found two real faults, both fixed: the tap
did nothing in WebKit, and the button could float at the screen edge after the words scrolled away.
What only a real iPad can show is listed in
[touch.md § A finger's selection gets a button](../project/touch.md): chiefly whether the button
sits clear of the lower selection handle, and whether it flickers while the handles are dragged.
**Greg, when it is deployed, please try it and say what it does.**

GPT Sol reviewed the code and fixed five things in it
([review](../plans/261003e-touch-chip-code-review-sol.md)).

## [Q-highlights-in-quotes] Should your highlights appear in Quotes mode?

Background: Quotes mode is the band of "lines worth keeping", chosen by a model, each one the
article's own words and each outlined in the prose. Your highlights are also the article's own
words, chosen by you. Today a highlight shows in the prose and in the comments drawer (as
"Highlight", with a coloured dot), and nowhere else.

- **A. Yes: your highlights become rows in Quotes, marked as yours.**

  ```
   ❝ Quotes  14 + 3 yours
   ─────────────────────────────────────
   ● you   "the variance of the estimator falls…"      ← your yellow highlight
     ❝     "Entropy is not disorder; it is…"            ← the model's pick
   ● you   "which is why the bound is tight"            ← your pink highlight
     ❝     "The second law, read this way, says…"
  ```

  In reading order they interleave with the model's. They ignore the threshold bar (you chose them,
  so they are never filtered out), and in "by importance" order they sit in a group of their own at
  the top. Pressing one goes to the passage, as any quote does. Cost: about a day, mostly the two
  sort orders and the count. It gives you one place to review everything worth keeping, yours and
  the model's. It gives up Quotes being purely the model's reading of the piece.

- **B. No: highlights stay where they are** (the prose and the comments drawer). Nothing to build.
  Quotes stays one voice. It gives up the single review list; to see your highlights together you
  open the drawer.

- **C. A filter in the drawer instead**: a "Highlights" toggle on the comments drawer that shows
  only your highlights, grouped by colour. About half a day. It keeps Quotes untouched, but the
  drawer is a smaller, plainer surface than the Quotes band.

**Recommendation: A**, after the menu question `[Q-highlight-menu]` is settled. A highlight is
exactly a line you thought worth keeping, and it meets the one promise Quotes makes (the article's
own words, verbatim). What would make
B right: if you use Quotes to see what *the model* thought mattered and would find your own lines in
it a distraction.

### Answered and built, 2026-10-03

Greg, relayed by the Overseer (queue item `qi-xafwewcr`):

> A yeah that sounds good. The only hesitation I have is that one might want to highlight the text
> and add a comment or something. I don't know if there's a way for them to show up in both, or
> maybe we keep it simple and just say that comments are block level and highlights show up
> alongside quotes. They should obviously have a different color if it's from me, and they should
> have a tooltip. Actually, quotes should as well, maybe saying when it was applied and whether it's
> AI generated or human highlights. Use your judgment. Let's try and avoid making things too complex.

**Shipped on `dev`** (`b8e634928`, `bab13e129`), plan
[261003h](../plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md):

- **Your highlights are rows in Quotes**, in reading order among the AI's, each with a bar in its
  own colour and the word *yours*. The threshold bar never hides them, and the count reads
  `48 quotes + 3 yours`. Under *most important* and *most striking* they come first.
- **Every row has a tooltip (the ⓘ) saying who and when**: *Chosen by the AI · {date}* or *Your
  highlight · saved {date}*. The card on a quote in the prose says the same. Quotes found before
  today have no time of their own, so theirs reads *on or before* the date the list was last
  updated; quotes found from now on carry their own.
- **The highlight-plus-comment case: it shows in both, and nothing about comments changed.** Not
  the "comments are block level" default. A highlight has been a comment with a colour since this
  morning, so the same thing is already a row in Quotes (because it has a colour) and in the
  comments drawer and margin (because it has words). Its Quotes row has a small pencil, its tooltip
  shows the note, and pressing the row opens the comment. Making comments block-only would have
  been the bigger change: span comments have existed since August and readers have them.
- Only a highlight counts: a comment on selected words **with a colour**. Give an old comment a
  colour and it joins Quotes; remove the colour and it leaves.

Left out, by name: stepping (‹ ›) through your highlights as well as the AI's; a visitor on a
shared link seeing your highlights in Quotes; the time a colour was *changed* (the date shown is
when the highlight was first saved). Within one paragraph, your highlights are listed before the
AI's quotes even where the AI's comes first on the page.
