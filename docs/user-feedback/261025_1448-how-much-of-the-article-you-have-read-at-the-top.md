---
reports: spya-e5477u
ending: shipped
comment: Shipped: a small pie after the read time says started, about half, most or finished. You said yes to the shelf too, and each card on your shelf now shows it.
---
# How much of the article you have read, at the top

Report `spya-e5477u` (#706), from Greg (`feedback-reporter.ts` exit 0, no addenda when re-read
before this note), sent from Learn on `entropy-26-00481-with-cover-from-taylor-beck-spya-naz564` on
2026-10-25. Session `fbe5477u-how-much-read`.

> At the top of the article, could you somehow give a quick visual indication of roughly how much of
> it has been read? And I realize that's not going to be exact, and it's complicated because it may
> be I didn't choose to read every single word, but, like, sort of try and broadly estimate: have I
> finished the article? It could be a pie chart or something like that, or something that is a bit
> less like— basically, I don't want to see a whole bunch of indications that I'm 97% finished
> because I read most of the paragraphs but chose to skip some, or because I read basically all of
> it but skipped the final section that's, like, not that interesting for some reason. So, yeah, it
> can be a coarse estimate, basically, is what I'm saying.

**Ending: Shipped.** On `dev`, not deployed.

## What we did

[Plan 261025j](../plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md), with Opus
consulted while planning and GPT Sol reviews of the plan and the code.

- **A small pie right after "~12 min"** in the masthead, owner only. It shows a quarter for
  *started*, half for *about half*, three quarters for *most of it*, and a full disc for *finished*.
  Nothing is drawn under 5%, or before the reading time has loaded. **Finished starts at 80%** of
  the counted words, so a skipped dull section or a few skipped paragraphs still say finished. The
  card says so in words and never shows a percentage.
- It is built from the reading time already recorded per block, by the quiz's rule for "read". The
  front and back matter folded on arrival doesn't count, read or not, and the quiz's share now
  leaves it out too, so the two agree. The chats' rough phrase moved onto the same cut points.

**Then the shelf, on Greg's answer** to [q-y78eth](questions/q-y78eth.md) (A, yes):
[plan 261025l](../plans/261025l-shelf-cards-show-the-how-much-read-pie.md), again with Opus
consulted and GPT Sol reviews of the plan and the code. Every card and table row on the owner's own
shelf shows the same pie after "~N min", from the masthead's own rules; one extra query per shelf
load, from a cache written when reading time is saved. Never a visitor, the public shelf,
view-as, MCP or the kept offline shelf. On `dev`, not deployed; after the deploy,
`npx tsx scripts/read-so-far-backfill.ts --prod --write` fills in the articles read before it.
