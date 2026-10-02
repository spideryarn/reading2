---
reports: spya-chhzxv, spya-eym66s
ending: shipped
---

# Bulk import of many papers, cheaply

Report `spya-chhzxv`, a suggestion from Greg (admin: its production row was proved by
`scripts/feedback-reporter.ts`), filed 2026-09-30 07:21 UTC from the shelf. No Sentry issue was
found for it by report id. A second report of Greg's, `spya-eym66s` (2026-10-01 16:37 UTC, from
`/changelog`), asked for the same thing and was folded in by the Overseer; its words are below.

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

> I suppose the thing I was going to say was, if you upload multiple PDFs at the same time,
> ideally it would be possible to do that. … by default, maybe it wouldn't run AI processing when
> you do that, only when you open each of them for the first time. Whereas if you upload just one at
> a time or import one at a time, then it would automatically trigger at least some of the AI
> processing, much as it does now. … In conclusion: let's look for an 80-20 v1 for a) allowing
> uploading multiple at the same time; and b) when uploading multiple at a time, minimise the AI
> processing on them until they're opened for the first time.
>
> — Greg, 2026-10-01 (`spya-eym66s`)

**Ending: shipped**, on `dev` (the last code commit is `2a9956b0e`, stages 1–4 are the `261001m` commits before it), not yet deployed (the Overseer deploys; the
migration is `20261001211225_bulk_import_minimal`). Built after Greg answered the plan's four
questions on 2026-10-01. His words, and everything below, are in
[261001m](../plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md).

- **Drop or choose two or more files on the shelf**, PDFs and HTML mixed. Each is stored, gets its
  title, authors, abstract and DOI read by DeepSeek v4.1 Flash on zero-data-retention providers
  (Fireworks first), and lands on the shelf marked *Not AI-processed yet*. It runs three at a
  time, skips anything already on the shelf (archived too), and costs **0.01 of an article**, so
  1,000 papers are 10. One file at a time is today's full import, unchanged.
- **Read this** on a paper's card or page runs the full import over the stored file, for the
  other 0.99, so a paper never costs more than one article. Opening a paper shows its title,
  authors and abstract, with *Read this* one click away. It does not start the import by itself,
  because that would spend 0.99 on a click that did not say so. That is the one place where this
  differs from `spya-eym66s`'s "until they're opened".
- **For Greg to know:**
  - **The model.** DeepSeek was level with Luna on authors, abstracts and DOIs, and perfect on the
    production route. On the matched comparison it kept the byline in one catalogue-style scan's
    title, which did not recur on the final prompt. Switching to Luna is one constant
    ([the eval](../../evals/results/paper-metadata-2026-10-01.md)).
  - **The providers.** Fireworks' shared pool alone refused about half the calls at two in
    flight, so DeepInfra and Together are zero-retention fallbacks behind it. A BYOK Fireworks key
    on OpenRouter would give the account its own limit, if you want only Fireworks.
  - **What is deferred.** The free-allowance box is not re-read when a batch finishes. Searching
    the abstracts, and the reader profile reading them, are also deferred. All three are in the
    plan's § Deferred.
- **Privacy:** nothing changed, as Greg said. `/privacy` already says an uploaded file is kept, and
  any article can be deleted. The page's model list gained DeepSeek.
