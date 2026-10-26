---
id: q-p6fvep
report: spya-kx8z6d
status: open
asked: 2026-10-26
title: Should the line saying the article's text goes to a model provider move into the (i) too?
refs: docs/plans/261026b-upload-limits-behind-an-info-button.md · docs/user-feedback/261025_2107-upload-limits-behind-an-info-button.md · docs/plans/260831an-referee-mode-for-peer-reviewers.md · spya-kx8z6d · SPIDERYARN-READING2-P6
---
You asked for the small print under the add box to move into an (i). I moved the file limits (50 MB, 250 pages, every 50 pages counts as one article) into an (i) beside the File button. I left the sentence "The article's text is sent to a third-party model provider for processing." visible, because we decided on 31 Aug that it should be. Should that sentence go into the (i) as well?

A. Keep it visible, as now. One short grey line stays under the add box. Everyone who adds an article has seen, before pressing Add, that the text leaves Spideryarn.

B. Move it into the same (i), alongside the limits. The add box loses its last line of small print. The cost: a reader who never opens the (i) is never told, before adding, that the text goes to a model provider. It would still be in the privacy policy and in Help.

Recommendation: A. It is one line, and it is what makes the Referee mode notice honest (see Details). If you would rather have the space, B is a one-line change.

Details

What you asked (spya-kx8z6d, 25 Oct): "Move this to an (i) tooltip", about both the limits and the provider sentence.

What is done and shipped to dev: the limits are now in an (i) card next to the File button. It opens on hover, on keyboard focus, and on a tap on a phone or iPad, and a screen reader reads the limits as part of the File button. The same (i) appears on "Upload a file instead", where a site turned us away.

Why the provider sentence was kept back: on 31 Aug, while building Referee mode (helping a peer reviewer), GPT Sol's most serious finding was that peer reviewers are often bound by confidentiality rules that count sending a manuscript to an AI service as a breach in itself. By the time anyone opens Referee mode the text has already gone, because adding the article sends it to a model. So we put one sentence at the point of adding, before anything is sent, with no checkbox, and the code says it must stay visible "or the promise is not made". Referee mode then says, in the past tense, that the text has already been sent, which is only fair because the reader was told before adding. Hiding the sentence behind an (i) means most readers would no longer see it before adding.

What would decide it: whether one line of space on the add box is worth more to you than everyone seeing that sentence before they add something.
