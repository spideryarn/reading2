---
id: q-bmt755
report: spya-rvbmss
status: open
asked: 2026-10-06
title: Two public copies of one article: one card or two, and whose copy Citations links?
refs: SPIDERYARN-READING2-E4 · qi-a8wyhr67 · docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md § Questions for Greg · docs/user-feedback/261006_2135-two-readers-import-the-same-article.md
---
Background. Your report about two readers importing the same article shipped: two readers' copies of one article are now tested end to end. This is the half that was left for you: two small design questions, neither of which blocks anything.

Question 1. The public shelf is the page a stranger sees. Each card shows a title, a date and a few words, and says nothing about who shared it or how it was processed. If two readers both share the same article, a visitor sees the same title twice and cannot tell which to open. This has not happened yet in production: no cases among 16 public articles.

A. Leave it: two cards. Costs nothing. Odd only when it happens, and it has not.

B. One card per article. The shelf groups cards by the article's source address and shows the earliest-shared one; the others stay reachable by their own links. A visitor sees a tidy shelf. Costs: a rule for "same article", when one paper can have several addresses (publisher page, arXiv, a PDF); and somebody's shared copy silently not appearing, which they may mind.

C. Two cards, each saying what differs, for example "written for a reader in neuroscience" when the sharer had a profile. Costs: it reveals something about the sharer, which changes a privacy promise, so it is the costliest.

D. One card that opens to its versions. The card says "2 public versions" and opens to list them; nobody's copy is hidden and nothing about a sharer is shown. Grouped only when we are sure it is the same work (a DOI or arXiv id agrees); anything less sure stays as two cards. The cleanest to look at, and the most to build: a grouped card is a new kind of card on three pages.

What would decide it: whether you expect many readers to share the same well-known papers. If so, D (or B) becomes worth building. Until it happens once, A.

Recommended: A.

Question 2. In Citations, a cited work that is already in Spideryarn gets a link to it. We look on your shelf and on the public shelf. When both have it, the surest match wins (a DOI or arXiv id beats a title), and between equally sure matches your own copy wins. So the one case where the link goes to a stranger's copy is when yours could only be matched by title (an upload with no identifier found, say) and theirs was matched by DOI.

A. Leave it. A title match is occasionally the wrong paper and a DOI match never is, so the rule sends you to a certainly-right article over a probably-right one. Gives up: in that one case you land on somebody else's copy rather than your own.

B. Show both when this happens: "On your shelf (matched by title)" and "On the public shelf". Honest. Costs: a second link on a row that is already busy.

What would decide it: only whether you have been sent to somebody else's copy and minded.

Recommended: A.
