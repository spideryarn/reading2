---
id: q-jpamyd
report: spya-x9gn3d
status: answered
asked: 2026-10-19
acted: spya-kgdjwn
title: Should PDF imports recover uncaptioned diagrams by their position on the page?
refs: qi-kwn2p7gh · qi-s63n3xxs · qi-ab5x79na · qi-vq9rwkyy · docs/plans/261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md · SPIDERYARN-READING2-K2 · docs/plans/261019e-uncaptioned-pdf-figures-are-kept.md · docs/user-feedback/261018_2343-uncaptioned-pdf-diagrams-were-dropped.md · docs/postmortems/261019b-a-figure-without-the-usual-evidence-was-treated-as-no-figure.md
---
A PDF's diagrams with no printed caption now show a "We couldn't recover this figure" note instead of vanishing. Should we go further and recover their pictures?

A. Build it (recommended). Attach a picture to an uncaptioned diagram only when, on that page, the sentence before the diagram sits above the picture and the sentence after it sits below. On Rovelli's book that brings back up to 18 of the 27 lost diagrams, including the cones right after the passage you reported. Cost: a day or so of agent work, and more machinery in the check whose only job is never to show the wrong picture.

B. Stop here. Uncaptioned diagrams keep the note and the "View the original" link to that PDF page. Nothing more to maintain, but books like Rovelli's stay missing most of their diagrams.

C. Build A, and also pair two uncaptioned diagrams on the same page top to bottom. That would bring back most of the other 9 on this book (pages with two stacked diagrams). Slightly more risk of swapping two neighbouring diagrams.

Details

You reported on 18 October that Rovelli's The Order of Time referred to a diagram ("Those of Leonidas are shown below, alongside Gorgo's:") that wasn't there, and asked how we lost it.

It was in the PDF, and the model that reads the PDF saw it. But the book prints no caption under its diagrams, and our code dropped every figure without a caption: 27 of the 33 figures in that book, with nothing recorded anywhere. The 6 captioned ones all imported fine.

Why we dropped them: the only way we prove that a picture on a page belongs to a particular figure is by finding that figure's caption printed on the same page. That check exists because we once put the wrong picture under a figure, when a tall picture had been pushed onto the next page. With no caption there was nothing to check, so the figure was thrown away.

What is done (on dev, not yet deployed): an uncaptioned figure is now kept. Where the picture can't be proved, the reader sees "We couldn't recover this figure" and, for you, a link to that page of the original. This only applies to PDFs imported or re-extracted from now on; your Rovelli article is unchanged until it is re-extracted, which I have not done.

What A adds: a different proof for uncaptioned figures, using position on the page instead of the caption. A simpler version, "the sentences around the figure are printed on this page", was checked by GPT and turned down: it would have allowed exactly the wrong-picture mistake the caption check was built to stop. Position is what tells the two cases apart.

If you choose A or C, re-extracting the Rovelli article afterwards should bring the pictures back without new model calls, from the reading we already have stored.

Reply spya-kgdjwn, Greg, 2026-10-19:

> We ideally don't want to ever miss a diagram/figure/table, even if it doesn't have a caption. We can either add a caption for it (saying uncaptioned), or give it a unique random figure ID of our own, or generate all the captions with an LLM (and mark as AI-generated) - whatever you think is best. I don't really care too much about the details, but we do want to include all of the figures and diagrams and tables if we can. If there's a reason why this is really hard or really complex, then please explain. Get help from GPT Sol. And I guess it would be helpful to check that this is working. So perhaps you could re-import the Carlo Revelli piece that was missing all the diagrams. If you're able to preserve my existing bookmarks and input, great. But if not, that's okay too. I don't mind losing whatever I've added to the article if you have to reset it. I would like to verify that it's working.

Acted on 2026-10-19 (queue qi-ab5x79na, plan 261019j, on dev, not yet deployed). Neither A nor C as written: the position check alone could only prove up to 18 of the 27. Instead an uncaptioned figure is now found the way a captioned one already could be when the page alone could not prove it: a vision model is shown the page and asked for the figure between the sentence before it and the sentence after it, and its answer is kept only if it points at exactly one picture that nothing else claims and that sits below the sentence before and above the sentence after. Our own figure id stays the figure's identity; the picture gets the alt text "Figure without a caption". No captions are invented. Tables already showed. On Rovelli, run locally against the stored reading of the book (production was only read): 25 of the 28 uncaptioned figures we could test came back, every one the right picture by eye, in 76 seconds for about 6 cents. The other 3 (pages 67 and 68) keep "We couldn't recover this figure", because the reading of those pages does not match the pictures on them, so the check refused rather than guess. Still not recovered: an uncaptioned drawing made of lines rather than one embedded image, and a figure the reading missed altogether (one on page 34). Your Rovelli article is not re-imported yet: that is a production write, and the code is not deployed. It is queued for after the deploy as qi-vq9rwkyy, waiting for your go-ahead, with a cost check first, because the stored reading of the book was made by an older model and a re-import may re-read the whole book. Investigation 261019a has the numbers.
