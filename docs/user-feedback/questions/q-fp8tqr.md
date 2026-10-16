---
id: q-fp8tqr
report: spya-x5e966
status: open
asked: 2026-10-15
title: When a site turns Spideryarn away, should we look for a free copy, or take the page from your browser?
refs: SPIDERYARN-READING2-J0 · SPIDERYARN-READING2-J2 · spya-tqsw3u · docs/plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md · docs/research/261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md · docs/user-feedback/261015_1711-cell-com-refused-the-app-a-better-way-round-and-a-question.md
---
Short version: the cell.com article you tried turned our server away, though your browser got through. I have made the way round easier. When an import fails like this, the add page now has an Upload button right under the message, and the message suggests the site's own Download PDF. The bigger fixes each need your decision. Which should we pursue next?

A. Look for a free copy automatically (recommended first step: measure it, not build it yet). That article is open access, and a free full text exists. When a site refuses us, we would look the paper up in the catalogues we already use (Crossref, OpenAlex) and import the free copy instead. The catch: for this paper the only copy our server can read is Europe PMC's XML feed. So it needs a converter for that format and a new outside service (Europe PMC). We would build the address ourselves from the paper's id rather than follow a link a catalogue gave us. It only helps papers with a free copy, and sometimes that copy is the author's manuscript rather than the published version, which we would say. First step: try twenty real refused links and count how many it would have saved. About an hour; nothing built.

B. A bookmarklet. A bookmark you click while on the page, which sends the page your browser is showing to Spideryarn. This is how Instapaper got round paywalls, and it works on any site you can read. The catch: some sites' security settings block bookmarklets, and that is untested. It is fiddly to install on an iPhone. And it cannot simply send the page to us, because the app deliberately refuses requests from other sites. The bookmarklet would open a Spideryarn window and hand the page to it, and that window uploads it. First step: a prototype tried on cell.com in Chrome, Firefox and Safari.

C. A browser extension. Readwise Reader and Zotero do this; it is the most reliable. The catch: the most work, store review on each browser, and a second piece of software to keep up. It need only ask to see the tab you click it on, not every site.

D. Nothing more for now. Downloading the PDF and using the new Upload button is the answer.

Recommendation: A's measurement now, since it costs an hour and decides whether A is worth building. Then B, if A saves few links. Not recommended at all: paying a scraping service to solve the human check for us. That is getting round the publisher's check rather than reading what you can read.

Details

What you reported, 15 October: importing https://www.cell.com/fulltext/S1364-6613(15)00180-1 failed with "The site refused to give this app the page". You could open it in your browser after a human check. You asked what we can do going forwards: a browser extension, or something else. You sent a shorter repeat later the same evening (spya-tqsw3u), from the article itself once it was on your shelf.

What we found. cell.com answers our server with "forbidden" (403). Every other public copy turns us away too: the PDF link, PubMed Central (a reCAPTCHA page) and Europe PMC's site (403). The article is Mental Imagery: Functional Mechanisms and Clinical Applications, Trends in Cognitive Sciences 2015, CC BY. Only Europe PMC's programming interface hands our server the full text, and it comes as XML in the format journals use (JATS), which Spideryarn cannot read yet.

What other tools do. The tools that get past these checks all take the page from your own browser, where you have already passed the check: the Readwise Reader extension, Zotero's Connector, Instapaper's bookmarklet. The ones that fetch from their own servers hit the same wall we do. Raindrop.io refuses to take the page from your browser on privacy grounds, because the page can carry whatever your browser showed, signed-in details included.

What was built (on dev, not yet deployed). The failure message now says: use the page's Download PDF button if it has one, otherwise save the page as a PDF, then upload that file. The add page shows an Upload button under that message, for every failure whose message suggests uploading. Previously you had to go back to the shelf to find the File button.

What would decide it. A: whether the twenty-link sample finds free copies for a good share of refused papers. B and C: how often you, or readers, hit walls on pages that are not papers (news sites, blogs), where no free copy exists to find.
