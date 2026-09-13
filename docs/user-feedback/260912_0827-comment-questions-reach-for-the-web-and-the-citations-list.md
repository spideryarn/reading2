# A question about a passage reaches for the web, and can read the citations list

**SPIDERYARN-READING2-3D** (2026-09-12 08:27Z) and **SPIDERYARN-READING2-3F** (08:31Z), Greg, on an
iPad in production (`build_commit 607b57a0`), on `entropy-24-00930-spya-bmvfyb`. Two reports, one
piece of ground, one job. Overseer queue item `qi-xmdhbc5a`.

**Ending: shipped** — on `dev`, 2026-09-13. (One follow-up proposal, making provenance enforced
rather than likely, is in [awaiting-approval.md](awaiting-approval.md); it does not hold this report
open.)

> I asked a question and, you know, clicked on the block and clicked on the question mark and added
> something to the comment box. And then it gave me a response only from the article, so it searched
> within the article. That's fine, but I think for that question I was kind of hoping for a broader
> sense of things from the web. And so I think we want to enable, even when asking a question about a
> block, enable it to search the web as a tool. And I guess the LLM can use its judgment about how much
> to search the web. And of course then it should be very, very clear about what's from the article and
> what's from the web, and wherever possible provide block citations to the article and links to stuff
> on the web. I think Chat already kind of does this, and I'm hoping we can reuse all of that machinery.
> So, in other words, asking a question with the comments panel has the full power of Chat, but is
> really crystal clear about what is and what is not from the article and always provides sort of
> evidentiary links back.
>
> — Greg, 2026-09-12 (3D)

> In a previous feedback message, I suggested that we create a citations mode, and I guess we should
> add a tool to chat and comments that enables it to specifically access that citations metadata, so
> that, because that might inform web searching. So if it knows from the citations metadata that, you
> know, there's a particular article that seems relevant, so it could search the citations for
> articles, you know, based on their summary that seem to be about the thing being discussed, and then
> that could inform the web searches. So we could spend more time searching that author's, you know,
> stuff. We don't want to overemphasize this. It's just one more tool that potentially the LLM could
> make use of, and we want to kind of enable it to ask to search the citations as a tool. And perhaps
> maybe even as part of the citations mode, there'd be a thing to find out more about a particular
> paper or author, and it could also make use of that too.
>
> — Greg, 2026-09-12 (3F)

## What we did

The comments panel and the "?" already had Chat's full toolset, web search included; the model was
declining it for "broader sense" questions (0 of 12 in a local baseline). So chat's prompt now treats
*where a passage stands* as a question about the world, marks every claim with where it came from
(article → block id, web → link, library → named article, background → said so, inference → said
so), with a one-line reminder beside the question; the sources list is headed *From the web*; and
chat gained `article_citations`, which reads the Citations list. Measured after: wider-debate
questions search 6 of 6; the "?" answers mark what is not from the article 6 of 6. Marking is far
more likely, not enforced. The plan, every measurement and what was deferred are in
[260913b](../plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md).
