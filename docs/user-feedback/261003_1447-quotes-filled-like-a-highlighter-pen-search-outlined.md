---
reports: spya-xrgste
ending: shipped
---
# Quotes filled like a highlighter pen, search hits outlined

Report `spya-xrgste` (SPIDERYARN-READING2-B7), a suggestion, from Greg (admin, production row
proven), 2026-10-03 14:47 UTC, from Structure mode on
`/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, relayed by the Overseer:

> I think right now the quotes show an outline, and the search results show a highlighter filled in,
> like as if with a highlighter pen. Let's switch this round. I think the quotes should be like with
> a highlighter pen, so filled in, and the searches should have an outline.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261003l](../plans/261003l-quotes-filled-like-a-highlighter-pen-and-search-hits-outlined.md). It
reverses his own decision on report 1Z
([260905_1754](260905_1754-quotes-marked-in-the-prose.md)); the reasoning now lives in
[quotes.md § A highlighter pen](../project/quotes.md#a-highlighter-pen-which-is-how-a-quote-says-how-much-it-matters)
and [search.md § An outline](../project/search.md#an-outline-since-2026-10-03).

## What changed

- **A quote is a filled mark**, in every mode. A more important or more striking quote has a
  stronger fill; it used to have a thicker, brighter outline.
- **The quote colour is purple, not green.** Your own highlights, which shipped the same day, are
  fills in yellow, green, blue and pink, and the quote's green as a fill was the same colour as your
  green highlight. The strip down the left of the spine is purple too. Where your highlight covers
  a quote's words, yours shows.
- **A search hit is an outline**: a box round the words in the search's own colour, with the
  coloured line that was always under the words as its bottom edge. This is the thorough search,
  the word search, and Referee's criteria. A quick search still paints nothing on the words.
- **How sure the model was** used to be how deep the fill was. It is now how solid the top and ends
  of the box are: a hedged hit looks like an underline with a faint box.
- **The quote you pressed, and Skim's current stop**, keep their fill and gain a thin ring (white on
  the dark page, black on the light one).
- Help and `/design` say the new thing.

Two older faults showed up once a quote was a fill. A phrase a conversation was started from had
black text on the dark `/design` page, fixed here. A cited phrase inside a quote had a thin gap in
the fill either side of it; a sibling session fixed its cause the same hour (`spya-trg9kz`, the
chips' class was leaking onto the citation mark), so this change carries no fix of its own for it.

## What was checked

`tests/quote-fill.test.ts` computes, from the real colours in both themes: the article's text and
its softer text stay readable on the strongest fill (4.5:1), a link inside a quote stays at 3:1 or
better, the faintest fill still differs from the page, heavy differs from light, and the purple
stays about 40 degrees of hue from each of your four highlight colours. A browser check in Chrome
(desktop, phone width, dark and light) and WebKit looked at `/design`, a real article in Quotes,
Search (word search) and Skim, and all four highlight colours beside a quote. GPT Sol reviewed the
plan and the code.

**Not checked**: Firefox (not on the box); a thorough search and Referee's marks in a real article
(same code path as the word search, but nobody looked); a real article at iPad width (only
`/design` was); a right-to-left article (there is none).

## Questions for Greg

### [Q-quote-fill-colour] Is purple right for quotes?

Background: a quote and your own highlight are now both fills, so colour is what tells the model's
choice from yours. Your four are yellow, green, blue and pink.

- **A. Purple (built).** Sits between your blue and your pink. In the light theme all five are easy
  to tell apart. In the dark theme your blue is the closest to it: tellable side by side, not at a
  glance.
- **B. Keep the old green.** Familiar, and the spine strip stays green. A quote and your green
  highlight would look the same.
- **C. Yellow**, the "fluorescent-yellow highlighter" you named on 2026-09-06. The most
  highlighter-like. It is your yellow highlight, so one of the two would have to move.
- **D. Purple, and move your blue highlight** further from it (towards cyan). One token edit.

Recommendation: **A**, and **D** as well if the dark theme bothers you. Pick B or C only if you would
rather quotes look like highlighter than be told apart from yours.

### [Q-quote-fill-strength] Are the quotes strong enough?

The fill is deliberately gentle (a light quote is the faintest mark on the dark page). It cannot go
much stronger without making a **link inside a quote** hard to read: on the light page a link is
already only 5.7:1 on bare paper, and at the first strength tried it fell to 2.9:1.

- **A. As built**: gentle, links stay readable.
- **B. Stronger, and a link inside a quote takes the article's text colour** (keeps its underline).
  More highlighter-like; a link in a quote is less obviously a link.

Recommendation: **A** until you have looked at it on a real article.

### [Q-search-outline-colour] Should the box be in the search's colour, or grey?

- **A. The search's own colour (built).** One search's hit is a box in that search's colour. Where
  two searches cover the same words, the box takes the first one's colour and both colours still
  show as lines underneath.
- **B. Grey top and ends, colour only underneath.** GPT Sol's suggestion. Nothing arbitrary about
  the two-search case, and less colour on the page; a single hit is a grey box with a coloured foot.

Recommendation: **A**. You asked the same morning for it to be more obvious which colour is which
search.
