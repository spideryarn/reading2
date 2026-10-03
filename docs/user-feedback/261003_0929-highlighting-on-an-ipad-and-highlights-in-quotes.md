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

Nothing for this is built. The Overseer has been asked to put it in its queue as its own item,
waiting on Greg.
