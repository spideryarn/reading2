---
keywords: references bibliography sources works cited papers links doi arxiv scholar footnotes influence relevance
related: mode-debate, faq-beyond-the-article
---

## When to use it

For an academic paper or a report, where the question is “what is this built on, and where do I find
it?” Making the list and **Dig deeper** are for whoever added the article; visitors to a shared
article see the stored list.

## Reading it

![The Citations panel: a threshold slider hiding 7 of 58 citations, then two works, each with its bars, Dig deeper and Ask in chat](../images/mode-citations.png "Citations, prioritised: each work with what we have read of it, its two bars, and where the piece first cites it.")

- Each row says what we have read of the work, which is usually nothing: the sentence on what the
  piece uses it for is written from the article, not from the cited work.
- Two small bars: **relevance** to this piece, and **influence** in its field. Influence is the
  model’s memory of the work, not a citation count. New lists give a number only when the model is
  confident it knows the work; a low number then means a work it knows and thinks minor. If
  relevance was scored but influence has no usable score, the row says *influence unknown*. Older
  lists keep their numbers, including low scores that could mean the model did not know the work,
  until regenerated from Metadata.
- **Dig deeper** also looks for a work’s influence on the web. When one of the pages its search
  finds is about the work and says how well known it is, the row’s influence bar is drawn from that
  and marked *from the web*; point at those words, or tap them, to see the site, the day and the
  page’s own words. It is an AI estimate from web evidence, not a citation count, and the page’s
  words may be about something else on that page. Often no page says, and the row stays as it was.
- Some rows also say something like *cited 357 times · Crossref*. That one is a real count, not the
  model’s view: Crossref is the registry that issues most DOIs, and where the article gives a DOI
  that Crossref holds, this is its own number for the work. Point at the words, or tap them, for the
  day we read it; it is not refreshed after that. Crossref only counts citations from works whose
  publishers have sent it their reference lists, so the number is usually lower than Google
  Scholar’s, and it should not be compared across fields or between an old work and a new one. *no
  citations recorded* means Crossref has none on file, not that nobody has cited the work. Most rows
  have no count, because most works are cited without a DOI. It sits beside influence and does not
  change the order or what the slider hides.
- **Ask in chat**, beside **Dig deeper**, opens a new conversation in [Chat](/help/mode-chat) and
  asks a question about the work straight away, with the work named. Use it to go back and forth
  about a work; **Dig deeper** gives one researched reading and keeps it on the row. Once you have
  asked, a line under the row shows how the chat’s latest answer begins; press it to open that
  conversation again beside Citations. The conversation is also in Chat’s list, marked with
  Citations’ icon. Only whoever added the article has this.
- **first cited** jumps to where the article first cites it. *only in the references* means the
  article lists it but never cites it in the text.
- **In your library** or **On the public shelf** means the work is already an article here, and
  links straight to it.
- Once the list exists, the places a work is cited are underlined with a dashed line in the text, in
  every mode. Point at one, or tap it, to see the work.

Orders: **prioritised** (the default, with a slider), **first cited**, **relevance** and
**influence**. The slider hides the works that score lowest on relevance and influence together,
relevance counting double; a work whose influence is unknown is judged on its relevance alone when
available. Ordered by influence, the unknown ones come last, the most relevant first.
