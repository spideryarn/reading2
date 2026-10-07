---
id: q-hhbddw
report: spya-eqjfgv
status: open
asked: 2026-10-07
title: Should a blog post's reader comments be kept, folded away, instead of left out?
refs: SPIDERYARN-READING2-EJ · qi-7j766kvb · qi-e69nfvkx · docs/plans/261007k-readers-comments-left-out-of-a-blog-import-on-every-pass.md · docs/user-feedback/261007_1008-readers-comments-left-out-of-a-blog-import.md
---
Background. You asked whether importing a blog post brings the readers' comments with it. It does not, and it already didn't: on your xenaproject page and eight other posts with comments (WordPress, Blogger, Slate Star Codex with 736 comments), not one comment reached the article. The one hole was a very short post, where the comments could come back as the whole article. That is now fixed and on dev. The Substack, Medium, Ghost and Disqus pages we checked did not send their comments to us at all, because they loaded them with JavaScript after the page arrived.

You also floated keeping the comments behind a heading that starts folded. This is the implication worth discussing. Everything in an imported article is treated as the author's words: summaries, quotes, ideas, quiz, glossary, Skim, tweets, search and chat all read it. Comments placed inside the article would be summarised and quoted as if the author wrote them.

Question 1. What should happen to readers' comments?

A. Leave them out, as now. Nothing to build. Gives up: the occasional thread worth reading. You can still open the original page.

B. Keep them beside the article, not inside it. They are stored separately and shown in their own folded section at the end, or in their own mode. No other mode reads them unless asked (Debate, which collects what the rest of the web says about a piece, would be the natural one). Costs: a reader of comment threads for each blog engine (WordPress and Blogger cover most of what we would actually get), a new stored piece per article, and a small panel. Roughly two or three days. Only works for pages that put comments in the initial HTML; the sampled Substack, Medium and Disqus pages did not.

C. Keep them inside the article under a folded Comments heading. Looks the simplest, but it is not: every mode listed above would have to learn to skip them, or each would treat commenters as the author. Not recommended.

Recommendation: A for now, and B if you find yourself wanting a thread more than once. Which blogs do you read where the comments are worth having? That would decide whether B covers them.
