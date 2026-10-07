---
reports: spya-eqjfgv
ending: shipped
comment: Comments were already left out; the one gap, a short post, is fixed. Keeping them folded away instead is a question for you: comments inside the article would be read by every mode as the author's.
---

# Readers' comments left out of a blog import

A suggestion from Greg (admin; `feedback-reporter.ts` exit 0 on the production row), 2026-10-07
10:08 UTC, from the homepage. Sentry SPIDERYARN-READING2-EJ. Queue item `qi-7j766kvb`.

> I want to import something like https://xenaproject.wordpress.com/2026/10/01/to-grieve-or-not-to-grieve/
>
> I'm trying to figure out what to do with the comments from readers. Probably the simplest thing to
> do would be to exclude them. Test whether this happens automatically with our current HTML import
> process, and if not, what would a simple, clean, general, robust approach be, not just for this
> exact page, but for other blog posts etc.
>
> The only alternative I considered would be to import the comments too, but put them behind a
> heading that's default-collapsed. That would be kind of neat, because it gives the user options
> (sometimes they're really valuable, and might inform thinking about the article), as long as it
> doesn't add too much complexity (in implementation or UI design or reading experience).
>
> And after you have implemented the 80-20 v1, if you think this has implications for how we do
> anything else, let's discuss.

**Shipped**, in [261007k](../plans/261007k-readers-comments-left-out-of-a-blog-import-on-every-pass.md).

- **They were already left out.** On the xenaproject page and eight other posts with comments in the
  HTML, not one comment reached the article. Readability's own rule does it, and the sampled
  Substack, Medium, Ghost and Disqus pages did not send comments in the page at all.
- **The gap, fixed:** on a short post, Readability's retry could return the comment thread as the
  article. [`src/reader-comments.ts`](../../src/reader-comments.ts) now takes the thread out first,
  by the name the blog engine gives its container. Apart from the new removal audit count,
  everything stage 2 returns is unchanged on 66 pages, ten of them discussion pages (GitHub,
  Discourse, Stack Overflow); a short post is now refused as too short instead of arriving as its
  comments.
- **Keeping them folded away** is put to Greg as
  [q-hhbddw](questions/q-hhbddw.md), with the implication: everything inside an article is read by
  every mode as the author's words, so comments belong beside the article, not in it. Queued as a
  proposal waiting on that answer: `qi-e69nfvkx`.
