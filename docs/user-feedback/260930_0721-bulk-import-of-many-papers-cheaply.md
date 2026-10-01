---
reports: spya-chhzxv
ending: awaiting
---

# Bulk import of many papers, cheaply

Report `spya-chhzxv`, a suggestion from Greg (admin: its production row was proved by
`scripts/feedback-reporter.ts`), filed 2026-09-30 07:21 UTC from the shelf. No Sentry issue was
found for it by report id.

> Increasingly, I'm getting feedback from people that they want the system to know them, to
> understand them and their needs and their background and their expertise and their interests and
> their gaps in their knowledge. And so I think most of that work can be done by a combination of
> the user profile and the article-specific, you know, why am I reading this text prompts. But I
> guess it would be cool if it could do it implicitly, and it would certainly be less work for the
> user. And one way to do this would be to make it easy for people to upload, you know, potentially
> thousands of papers, you know, as PDFs or whatever, and to then do really minimal processing on
> them and only go deep in the processing if they request it for particular ones. And we probably
> wouldn't charge them for most of those papers. So in other words, right now we charge people, you
> know, per month with a limit on the number of papers they can run AI processing on. I think what
> we'd say is you can upload as many as you like, but the limit only applies to the ones on which you
> do the AI processing. And so in an ideal world, we'd be able to get what we need in terms of
> metadata or whatever without any AI processing. Or perhaps we generate, you know, as we do a tiny
> amount, you know, to extract title, maybe authors, and maybe a summary. Or maybe we just pull out
> the abstract and use that as the, yeah. But even pulling out the abstract might need an LLM. So I
> guess in an ideal world, we'd be able to say process a paper without AI for a tenth of a penny. And
> so then a thousand papers would be a buck, which is affordable. Maybe, you know, it could be a
> little bit more expensive than that, but not more than an order of magnitude more expensive. I
> think this also has UI implications because then you need to be able to say during the import, is
> this a paper that I should run AI processing on? And I think we already have a tick box that we've
> recently added to say that whether you want to do enhanced AI processing, i.e. to run AI processing
> on all of the main modes. And so I suppose you could have three levels ranging from basically, you
> know, minimal AI processing. Saying a little bit, say just structure and summary, or quite a lot,
> i.e. all the main modes, and they could choose that on import. I think the other thing we'd need is
> a way to do batch imports so that you could upload a thousand papers in one go or whatever. And so
> there's an upload issue, so it would need to sort of queue and do things in parallel with whatever
> concurrency, perhaps adaptively, and be idempotent so you could just keep on uploading the same
> batch and it would only deal with the ones that haven't already been uploaded. So there might be
> UI and kind of browser queuing concurrency machinery that we'd want to consider there as well. I
> guess the key point is that we don't want to make this too complicated. So if you think this is
> really complicated and there's no sort of reasonably simple 80-20 solution, then stop and let's
> discuss. If you can see a way to do a decent job or at least a stepping stone that will get most of
> the way without too much complexity and that's a stepping stone in the right direction, then
> proceed autonomously.
>
> see third-party-library-selection.md
>
> — Greg, 2026-09-30

**Ending: awaiting Greg.** Researched, planned, reviewed, nothing built.

- **The cost question is answered:** a cheap model reading only the text of pages 1–2 got title and
  authors right on all 13 test PDFs, found every abstract, and costs about $0.0005 a paper (50p per
  thousand). Without a model the title is right about half the time. No new library is needed —
  pdf.js is already a dependency. Spikes in `evals/pdf/minimal-metadata/`.
- **No simple 80/20 was found, so this stopped, as the report asks.** Batch full-imports turned out
  to need an atomic claim, a server-side per-reader limit and more (GPT Sol: *rethink*), and would
  still import only a reader's remaining quota. The near-free "minimal" level is the real stepping
  stone, and it depends on the billing change, which is Greg's.
- Four questions for Greg, and the design they unblock:
  [261001m § Questions for Greg](../plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md).
