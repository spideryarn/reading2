---
reports: none
ending: shipped
comment: A citation's card in the prose now has "Does it say that?". It asks Chat whether the work says what that paragraph cites it for, and Chat can now read the cited paper's PDF to answer.
---
# Does the cited work say that? At the citing sentence

Not from a reader, so there is no Sentry id. Built from Greg's answer to
[q-fkq30v](questions/q-fkq30v.md) part 4 (reply `spya-dbfeqh`, 2026-10-10), Overseer queue item
`qi-sq25xqqf`, session `fbh5aypq-cited-work-says-that`:

> 4 all? Use your judgment based on that combination of ease and value.

This entry is 4B, the research's idea 2. 1B and 4A shipped as
[261011_0606](261011_0606-referee-claims-become-promises-and-starters-wait.md), 4D as
[261011_0253](261011_0253-referee-notes-sorted-major-and-minor.md); 4C has its own queue entry.

**Ending: Shipped**, to `dev`, not deployed. Plan
[261011w](../plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md). GPT Sol reviewed
the plan (BUILD WITH CHANGES, eight findings, all taken) and then the code.

- **Chat can read a cited paper.** Until now it could not read a PDF at all, so *Ask in chat* about a
  cited work answered from abstracts and search snippets. The new chat tool, `read_cited_work`,
  reads the paper's PDF from the DOI or arXiv link the article gives, checks by code that it is that
  work, and gives chat the abstract and the passages that bear on the claim, with a line saying what
  was read. Chat and Explore only. It is Dig deeper's paper reading, which had no button since
  2026-10-09, handed to chat.
- **At the citing sentence.** The citation's card in the prose has a new button, *Does it say
  that?*, when the card was opened from a paragraph that cites the work. It starts a fresh chat about
  that paragraph, asking whether the work says what the paragraph cites it for.
- **Measured before the button was built**, on four local articles: chat used the tool 4 of 4 times
  and read the paper 2 of 4. The other two said plainly that they had not read it (a publisher
  refused; a title the list holds as *Santoro et al 2016* could not be matched to page one). Both
  reads kept "the passages I was shown" apart from "the paper".
- **What it cannot do.** Paywalled and HTML-only works stay unread. Chat's quotes of the paper are
  told to come only from what it was shown, but code does not check them. A cited work that is
  already an article in Spideryarn is not read from there: that half is proposed as `qi-wnjqnta6`.
- **Next door:** `qi-8x3vrr8z` (Greg's report that *Ask in chat* on a citation should say how the
  article uses it and whether that is justified) is not this item, but its answers now have the paper
  to work from.
- **For Greg: one sentence in security-map.md is now wrong, and I was told not to edit that
  section.** Its `link-summary.ts` row says that file is *"the one place a stranger's page reaches a
  model"*. Chat's `read_web_page` already made that untrue, and now `read_cited_work` sends a
  stranger's PDF to chat too, whose model has tools. GPT Sol's code review (finding 1) proposes:
  drop *"the one place"* from that row, and add a row for `src/read-cited-work.ts`: the address is
  the stored row's DOI or arXiv link or a quick check's matched page, never the model's; code
  confirms the PDF is the work; the text is fenced; and a hostile PDF can still ask for a later
  `read_web_page`, the same risk as that tool. The detailed account is already in
  [security.md § Prompt injection](../project/security.md).
- **Your call, if you want it:** the button's words. *Does it say that?* was chosen; *Check the
  source* was the alternative.
