---
id: q-v03wmh
report: spya-vqmfrs
status: answered
asked: 2026-10-31
title: Sources digest: two principles to write down, and a few small design choices
refs: qi-rc3k5z2t · qi-xgnn5fpb · qi-eerykqdn · qi-dykn3xjh · docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md · docs/research/261030a-sources-digest-how-others-show-a-papers-citations.md · docs/plans/261031d-sources-digest-acting-on-greg-s-answers-principles-readers-that-search-again-layout-choices.md
acted: spya-dvq5b4
---
The Sources digest is built, behind the experimental switch: Sources › Digest. Pressing the chip writes it (about $1, once). Three questions; answer like "1A, 2A, 3a-A 3b-B 3c-A".

1. Write your two principles into principles.md with this wording?
   Progressive disclosure: start clean, and always a way further. The first thing a reader meets is short and uncluttered; everything has more one press away: an (i) saying what it is and how it was made, a More that opens the detail, the sources, and finally a chat.
   Build a version, then ask in small pieces: when the right design is unclear, build the simplest good version for Greg to play with, and alongside it show the alternatives as ASCII sketches, broken into several small questions he can mix and match rather than one big A/B/C.
   A. Yes, as written. (recommended)
   B. Yes, with your edits (reply with them).
   C. Not yet.

2. Should the digest's readers be allowed to search again after reading a page?
   A. No, as built: every search is planned from the article alone before anything is read; a reader's "worth digging into" is shown as words, and the chat is how you dig. (recommended)
   B. Yes, one extra search per reader, at roughly +$0.30 a run, once a security design for it has been reviewed on its own.
   The risk in B: a hostile web page could steer what we search for and spend.

3. Three small layout choices, each built as option A so you can try it:
   3a. The ask box: A under the whole digest, plus a chat button on each paragraph; B only the per-paragraph buttons.
   3b. Length: A one level, short paragraphs with More; B Brief and Fuller levels like Summary.
   3c. After you ask: A the chat opens in Chat's band and the box turns into "Continue the conversation"; B the chat opens inline under the box.

Details

What you asked (spya-vqmfrs, 30 October): a new Sources sub-mode, a digest: one readable text about what the piece cites and links to, who cites it, what it should have cited and did not, and what it cites that does not say what it claims. Built from many web searches read by small models and written by a big one, tied to the prose like Summary's Fuller (sentences light up as you scroll, and jump on a press), with short paragraphs that open for more and a way to ask further. A text box under the digest and under Summaries to continue the conversation, each its own kind of chat in the chat list. And two principles written up.

What was built:
- Plan: up to 16 questions about the piece, in four kinds (what it cites, who cites it, what it missed, citations to check), each with one or two web searches.
- Search: those searches (Exa), plus the papers that cite it (OpenAlex, free).
- Read: one Haiku reader per question, reading up to 8 pages, returning a verdict and exact quotes. The code keeps a quote only if it finds it word for word on the page.
- Write: Opus writes the digest from the checked quotes only, for your profile.

```
 Where it sits | Digest | Bibliography 42 | Links 61      (i)
 What its sources say · a piece from 1998
 Two or three sentences of overview, each a link to its passage.
 WHAT IT BUILDS ON (i)
   Short paragraph.          spya-k3m9qt  > More  [chat]
     More: the detail, then each source with its checked quote
 WHO HAS TAKEN IT UP (i)
 WHAT IT MAY HAVE MISSED (i)
 WORTH CHECKING: CITATIONS THAT MAY NOT SAY THAT (i)
 > What was searched (14 questions, 28 searches)
 [ Ask about this digest...                        Send ]
```

Summary's Brief and Fuller each get the same box underneath. Each chat is listed in Chat as "Started from the digest" or "Started from Summary > Fuller", with a way back.

Decided without asking, say if you disagree:
- Owner only. It is written for your profile, and it quotes strangers' pages your press fetched, so a visitor never sees it and a shared link shows Bibliography. An admin's "view as" sees it, as with every mode.
- Stays behind the experimental switch until a real run has been measured.

On 2, why A for now: the existing Where it sits search has a rule that no search is ever written after reading a web page, because a page could plant instructions. GPT Sol's review of the plan held the digest to the same rule.

Not yet measured: the OpenRouter key is at its monthly limit until 1 November, so no live run on a real article has happened. Expected about $0.85 a run, worst case about $1.80, up to about 11 minutes. Measuring cost, time and quality on three or four articles is queued for after the reset.

Greg's reply, 2026-10-31 (spya-dvq5b4, in the Feedback dialog):

> 1 A
> 2 not sure, maybe B? what do you think is best for the user?
> 3 I don't really understand what you're asking. It's too hard to make sense of it without either an example or an ASCII diagram or something. So maybe try and build it yourself. Try and take screenshots to see what you think. Ask other agents that are taking on the role of being the user or expert product manager and UI and UX designer. And I guess you know we'll probably continue to tweak it.

Acted on 2026-10-31 (queue item qi-qgqzgq6v, plan 261031d):
1. Both principles are in principles.md as 2 and 3, worded as above.
2. A for now; Opus and GPT Sol agreed. The gain is unmeasured (no live run yet), it adds about 30% to every run, and a page could steer what we search. If real runs show leads failing for want of one search, a narrow version follows, its search words written by code, never by a model.
3. A, A, A. From screenshots of a realistic digest, a reader, a product manager and a UI/UX designer each chose A on all three. Changed: the four sections are now parted by a rule and space, so they no longer read as one long run of paragraphs; and the writer is told a citation that checks out does not go under "Worth checking". Correction to the question: after you ask, the box becomes the chat's usual mark (its count and gist), not "Continue the conversation".
Tweak it whenever you like.
