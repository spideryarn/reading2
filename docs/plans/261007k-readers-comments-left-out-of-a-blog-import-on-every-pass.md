# Readers' comments left out of a blog import, on every pass

Stage 2 — [content-extraction.md](../project/content-extraction.md). Report `spya-eqjfgv`
(Sentry SPIDERYARN-READING2-EJ), queue item `qi-7j766kvb`, from Greg (admin), 2026-10-07:

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

## What we found: the comments are already left out, except on a short post

**On an ordinary post, yes, already.** Readability's first pass deletes every element whose class
or id contains `comment`, `disqus` or `replies`, unless it also contains `article`, `body`,
`column`, `content`, `main`, `and` or `shadow` (`unlikelyCandidates` / `okMaybeItsACandidate`,
`Readability.js` 0.6.0). Every blog engine we tried marks its thread up that way.

Measured with `evals/extraction/comments-probe.mts`, which takes each comment's body in the source
(WordPress, Blogger, Drupal and LWN markup) and asks whether a 60-character run of it reaches the
article — not counting a comment that quotes the post, whose run is also on the page outside the
comments:

| page | engine | comments in the HTML | checked (80+ characters) | reached the article |
|---|---|---|---|---|
| Greg's, xenaproject | wordpress.com | 48 | 46 | 0 |
| Slate Star Codex, *Meditations on Moloch* | WordPress (custom) | 736, with pingbacks | 628 | 0 |
| Computational Complexity ×2 | Blogger | | 4, 4 | 0 |
| Lemire | WordPress | 5 | 3 | 0 |
| Terry Tao, *Hexagon* | wordpress.com | | 1 | 0 |
| 4 gravitons | wordpress.com | | 1 | 0 |
| Language Log | WordPress (old theme, `commentlist`) | 2 | by hand | 0 |
| `aaronson.html` (corpus) | WordPress | 275 | not by this probe (`commentbody`) | 0 |
| Hacker News item | HN | | 59 | 49 — the thread *is* the page |

The pages checked from several engines never put the thread in the article DOM at all: Substack,
Medium, Ghost, Disqus, giscus and LessWrong loaded it with JavaScript; the n-Category Café put
comments on a separate page, and LWN behind a button. Stage 1 does not run JavaScript
([fetching.md](../project/fetching.md)), so those pages give stage 2 no thread to remove.

**The gap is Readability's retry.** If the first pass finds fewer than 500 characters, Readability
parses again with that deletion switched off, then with class weighting off, then with conditional
cleaning off. If every attempt stays short, it returns **the longest** of them. On a short post with
a long thread, the longest is the thread. `evals/extraction/comments-short-post.mts` cuts a real
page's post body to *n* characters:

| page, post cut to | what came back |
|---|---|
| Lemire, 150 or 400 | *"5 thoughts on 'Faster software linking with mold' — Clearly, these link times are without LTO…"*: the comments, and no post |
| Slate Star Codex, 150 or 400 | *"Pingback: Outside in …"*: the pingbacks, and no post |
| Greg's page, 150 | 44,373 characters: the post's 150, then the sidebar and the rest of the page |
| any of them, 700+ | the post, correctly |

Short posts with long threads are a real shape on a blog: an open thread, a link post, an
announcement, a poem.

## The fix

[`src/reader-comments.ts`](../../src/reader-comments.ts) § `removeReaderComments`: before
Readability, delete **the comment-thread containers blog engines generate, by exact id or whole
class token**: WordPress's `.comments-area`, `.comment-list` / `.commentlist` and old themes'
`#commentlist`; Blogger's `.comment-thread.toplevel-thread`; Disqus's `#disqus_thread`. Each shape
was seen in the pages measured below. The generic outer `#comments`, reply-form `#respond`, and
`.comment-thread` on its own are deliberately not rules: RFC 9110 uses `#comments` for authored
prose, `respond` is an ordinary word, and a generic thread can be the page's content. A theme can
also put an unmarked post and a specific inner comment list under the same `#comments` wrapper. The
list goes; the wrapper and post stay. A specific container with an `<h1>`, a `<main>`,
`[itemprop=articleBody]`, `.entry-content`, `.post-body` or `.post-content` inside it is also left to
Readability.

It runs straight after the furniture pass and **before** `protectAuthoredStructure`, so both arms of
protect's fallback see the same page and `ExtractResult.removed` (where the count goes, under
`comment-thread containers`) is the same in both.

Greg's words are the licence: *"Probably the simplest thing to do would be to exclude them."* It is
not [`src/furniture.ts`](../../src/furniture.ts), whose licence is controls with no block-level
content; a thread is the opposite, and gets its own module.

### What the plan review changed

The first version mirrored Readability's own rule: anything whose class or id *contains* `comment`,
`disqus` or `replies`. GPT Sol's plan review (§ Reviews) said **RETHINK**, and was right on four
counts:

1. **Too broad.** A page whose real text sits in `div.commentary`, and is short enough to need the
   retry, is rescued by that retry today. The substring rule deleted it before Readability ran. The
   same rule refused a short GitHub issue (`react-comments-container`).
2. **Not an exact mirror.** Readability tests the byline and a duplicate title on a node *before*
   its unlikely-candidate test, unwraps `<noscript>` images and rewrites `<br>`s first. A sweep up
   front changes all four. The "nothing changes when the first pass succeeds" claim could not rest on
   being a mirror.
3. **The test was negative-only.** An empty article contains no comments either.
4. **The measurement compared too little**: a fake URL for every page, and only the content, title,
   byline and refusal.

So the rule became a short list of whole names with a guard, every test asserts the post is there
as well as that the thread is not, and the comparison now covers everything `readArticle` returns,
with each page's real URL.

### Simpler options passed over

- **Do nothing.** Right on every ordinary post. Passed over because the short-post failure is not a
  little junk: the reader's article *is* somebody else's comments, and nothing says so.
- **Readability's own substring rule, run up front.** Fewer names to keep, but it deletes real
  articles (above).
- **Detecting the retry and refusing the page.** Would also turn away a short post with no comments,
  which the retry exists to rescue.

### Not done: comments imported behind a folded heading

Greg's alternative. Not built, and brought back to him as a question
([q-hhbddw](../user-feedback/questions/q-hhbddw.md)), because it is not a small add-on to stage 2.
The rest of the pipeline treats everything in `article.html` as the author's:

- every block gets an id and feeds Structure, summaries, glossary, quotes, ideas, quiz, FAQ, Skim,
  tweets, citations, cross-references and search. Each would have to learn to skip comments, or
  would summarise and quote the commenters as the author;
- Readability throws the thread away, so we would need a per-engine reader of it (author, date,
  permalink, nesting);
- the threads that matter most are often not in the HTML at all (Substack, Disqus, Medium).

The cleaner shape, if wanted, is **a separate discussion artefact beside the article**: one entry
per comment with its author, date, permalink and parent, possibly its own blocks inside, and read by
no article mode unless asked. A folded section at the end or its own mode could show it.
[Debate](../project/debate.md) is the nearest existing reader of other people's responses, though a
blog's own thread is not quite "the rest of the web". Queued as a proposal waiting on Greg:
`qi-e69nfvkx`.

## Measurement

**Nothing changes on a page that is not short.** `evals/extraction/comments-arms.mts` runs stage 2
from `dev` (a `git archive` of `src/`) and from this change on the same HTML with the page's real
URL, and compares everything `readArticle` returns except this pass's one new `removed` key (the old
removal keys are compared too). It refuses zero inputs and exits non-zero on a difference. On the 39
corpus fixtures (the two added here among them) and the 27 live pages in
[`evals/extraction/comments/pages.tsv`](../../evals/extraction/comments/pages.tsv), **66 of 66 are
identical**, and the pass removed a container on 13. That includes all ten pages where the
discussion is the content: two Discourse topics, two GitHub issues, old Reddit, Stack Overflow, a
Python mailing-list thread, LKML, LWN and a Guardian *Comment is free* piece. The same instrument
reported a difference on the first version (the short GitHub issue), so it can fail.

**On a short post, the thread no longer comes back** (`comments-short-post.mts`, which cuts the
post's text to *n* characters; dev → this change):

| page, post cut to | dev | with this change |
|---|---|---|
| Lemire, 150 | the comments, 747 characters | refused: *too little text to read* |
| Lemire, 400 | the comments | refused: the post's 428 characters, under `MIN_ARTICLE_CHARS` |
| 4 gravitons, 150 / 400 | "7 Replies …" and the thread, 1,097 / 1,347 | refused |
| Computational Complexity (Blogger), 150 / 400 | a comment, 818 characters | refused / the post with its dateline, 574 |
| Slate Star Codex, 150 / 400 | the pingbacks | a sidebar notice, 3,154 characters |
| Greg's page, 150 | 44,373 characters: post, sidebar, the rest of the page | 658: the post, then the start of the sidebar |
| radimentary, 150 / 400 | refused / the post with the blog's header | the same |

A refusal is the right answer for a post under 500 characters: stage 2 refuses those anyway
(`MIN_ARTICLE_CHARS`) and accepted these only because the comments made them long enough.

**What it does not fix: the retry returns the longest attempt, and comments were only one kind of
junk.** On Slate Star Codex the short post now comes back as a sidebar notice. That is the same
Readability behaviour with different furniture, and the fix for it is a different change: treat
"Readability needed its retry" as a sign the extraction is suspect. Written down here, not built.

**Before that, the claim that comments were already left out** (`comments-probe.mts`, the table at
the top) counts one body per comment and ignores a comment that quotes the post. It matches on a
60-character run of each comment, so a comment shorter than 80 characters is not checked; the two
fixture tests below check named comments on real pages instead. The probe refuses an invocation that
recognises no checkable body, and the short-post instrument refuses an `n` longer than the selected
post, so neither can label an empty measurement as a result.

The regression test is
[`tests/extract-reader-comments.test.ts`](../../tests/extract-reader-comments.test.ts), on the two
new fixtures: Greg's page arrives whole (first and last sentence) with no comment; Lemire's cut to
150 characters is refused as too short, and is not the thread; cut to 700 it is the post and no
comment. Watched red with the pass switched off (*"5 thoughts on 'Faster software linking with
mold' …"*). Plus the shapes that must be left alone: Sol's `div.commentary` article, RFC 9110's
authored `#comments` section, an unmarked post sharing that wrapper with a removable list, authored
`#respond`, names that only contain the word, and Hacker News.

## Reviews

**Plan, GPT Sol (`gpt-5.6-sol`, high, read-only), 2026-10-07: RETHINK.** Seven findings. 1–4 are
above and were all taken. 5: the first version ran after protect, so the two arms of protect's
fallback deleted different things; taken (it runs before protect now). 6: the probes' silent-success
paths; the short-post probe now sets text rather than reparsing it, and the fixture tests carry the
weight the probes cannot. 7: comments as a separate artefact is right, but "not blocks" is too
absolute, since a deep thread needs its own entries and ids; taken into the question to Greg.

**Code review, GPT Sol (`gpt-5.6-sol`, high, workspace-write), 2026-10-07: SHIP WITH FIXES (made by the reviewer).** The corpus itself contradicted the guard:
RFC 9110's authored section 5.6.5 is `<div id="comments">`, with none of the six post markers. The
66/66 comparison stayed green because Readability independently drops the same id, and the
instrument omitted the whole removal audit; it also accepted zero inputs and printed differences
without a failing exit. Fixed red-first: generic `#comments`, `#respond` and bare `.comment-thread`
are no longer rules, while the old WordPress `#commentlist` and Blogger's measured two-token shape
are; the adversaries above are tests; and the instruments now refuse empty or degenerate inputs,
while the arms comparison checks every old audit key and fails on any difference. The class is
[261007o](../postmortems/261007o-baseline-parity-can-hide-the-same-loss-on-both-sides.md).

