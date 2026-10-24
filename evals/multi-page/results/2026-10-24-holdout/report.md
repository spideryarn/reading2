# Multi-page judge eval

Gold: `evals/multi-page/holdout-gold.json`.

## haiku (anthropic/claude-haiku-5.5)

- decision right: 34/39; false follows (single → followed): 0; missed (multi → not followed): 5; errors: 0
- pages, over 18 runs of 6 `multi` cases: recall 57/69 (83%); precision (complete gold only) 57/57 (100%); all gold pages picked 11/18 (61%); exactly the gold pages in gold order (complete gold only) 11/15 (73%); picks in gold order 11/11 (100%)
- cost per call: median $0.0005, max $0.0011; total $0.022
- latency: median 3138 ms, max 9337 ms

Pages per `multi` case:

| case | gold complete | runs | recall | precision | all gold | exact | in order | gold pages missed (runs) |
|---|---|---|---|---|---|---|---|---|
| arch-forum-thread | true | 3 | 0/3 (0%) | – | 0/3 | 0/3 | – | /viewtopic.php?id=314887&p=2 (3) |
| explained-gradient-boosting | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |
| guru3d-nzxt | true | 3 | 21/21 (100%) | 21/21 (100%) | 3/3 | 3/3 | 3/3 | – |
| kfh-chain | false | 3 | 0/3 (0%) | – | 0/3 | – | – | /essay/ (3) |
| narrowpath | true | 3 | 12/18 (67%) | 12/12 (100%) | 2/3 | 2/3 | 2/2 | /introduction (1) /phase-0 (1) /phase-1 (1) /phase-2 (1) /what-success-looks-like (1) /annexes (1) |
| president-loan | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |

| case | gold | run | follows | gold pages picked | extra | links | reason |
|---|---|---|---|---|---|---|---|
| arch-forum-thread | multi | 1 | false | 0/1 |  | 36 | This is a forum thread whose next page is just more replies in the discussion, not one continuous work split across addresses. |
| arch-forum-thread | multi | 2 | false | 0/1 |  | 36 | This is a forum thread of separate user posts, and its next-page link is forum pagination of a discussion rather than one continuous work. |
| arch-forum-thread | multi | 3 | false | 0/1 |  | 36 | This is a forum discussion thread, and its rel=next link is just pagination of replies rather than a single piece of writing split across pages. |
| explained-gradient-boosting | multi | 1 | true | 4/4 |  | 5 | This is the front page of a multi-part article, and its contents list links L1 to L3 and the FAQ L4 as its other chapters, while L5 is a separate work. |
| explained-gradient-boosting | multi | 2 | true | 4/4 |  | 5 | This is the front page of a multi-part gradient boosting article whose contents list links to its chapters (L1-L3) and its FAQ (L4), while the matrix calculus link (L5) is a separate work. |
| explained-gradient-boosting | multi | 3 | true | 4/4 |  | 5 | This front page holds the introduction and contents of one multi-part explainer, and the in-text contents list links to its other parts (L1-L3) and its FAQ (L4), while L5 is a separate matrix calculus article. |
| guru3d-nzxt | multi | 1 | true | 7/7 |  | 57 | This is a multi-page review whose table of contents (page-2 through page-8, with 'Next Page') links the numbered parts of the same work. |
| guru3d-nzxt | multi | 2 | true | 7/7 |  | 57 | This is the first page of an eight-page review, and the table-of-contents menu links pages 2 through 8 as parts of the same piece. |
| guru3d-nzxt | multi | 3 | true | 7/7 |  | 57 | The review is split into numbered pages 1 through 8 (the table of contents links pages 2 to 8 as parts of this same review), and this page is the first part, so the piece continues. |
| kfh-chain | multi | 1 | true | 0/1 | /chapter-4-what-are-agi-and-superintelligence/ /chapter-8-how-to-not-build-agi/ | 5 | This home page is the front page of the essay Keep The Future Human, which is split into chapters, and it links to Chapter 4 and Chapter 8 as parts of the same work. |
| kfh-chain | multi | 2 | true | 0/1 | /chapter-4-what-are-agi-and-superintelligence/ /chapter-8-how-to-not-build-agi/ | 5 | This is the front page of an essay split into chapters, and it links Chapter 4 and Chapter 8 as parts of the same work. |
| kfh-chain | multi | 3 | false | 0/1 |  | 5 | This is a promotional landing page for the book, and its chapters and full essay are reachable by links rather than forming the continuation of this page's own text, so it is not confidently one piece split across pages. |
| narrowpath | multi | 1 | true | 6/6 |  | 10 | The homepage is the front page of a single policy plan split into an introduction, three phases, a success section and annexes, and it links to those parts as the same document. |
| narrowpath | multi | 2 | true | 6/6 |  | 10 | This landing page introduces the single policy document A Narrow Path, whose introduction, three phases, success criteria and annexes are separate pages linked from its navigation. |
| narrowpath | multi | 3 | false | 0/6 |  | 10 | The home page is a landing page for a policy plan whose full text sits on separate pages, but its own text and navigation present the work as split into a main document plus phases and annexes, which is ambiguous; the landing page itself is a standalone summary, so the reader gets this page as is. |
| neg-ars-yosemite | single | 1 | false | – |  | 38 | The extracted text runs from the opening to the author bio and comment count, and the links include no numbered page or next-part links, only separate stories and site navigation. |
| neg-ars-yosemite | single | 2 | false | – |  | 38 | The page's text ends with the article's closing lines and author bio, and its only navigation to other pages is the 'Prev story' and 'Next story' links to separate articles, with no numbered or 'next page' links to parts of this review. |
| neg-ars-yosemite | single | 3 | false | – |  | 38 | The extracted text runs to the article's conclusion and the page links only to separate stories (Prev/Next story), with no numbered or continuation links to other parts of this review. |
| neg-diplomat-rohingya | single | 1 | false | – |  | 87 | The page is a single self-contained article; the other links are section navigation, related stories, tags and unrelated pieces, with no page-split or continuation marker in the text. |
| neg-diplomat-rohingya | single | 2 | false | – |  | 87 | The text is a single self-contained article, and the other links are site navigation, related stories, and category or tag pages rather than parts of this piece. |
| neg-diplomat-rohingya | single | 3 | false | – |  | 87 | The page is a self-contained article whose text reads to a complete ending, and its links are navigation, category, tag, and other separate articles with no next-page or part links to this piece. |
| neg-fowler-microservices | single | 1 | false | – |  | 37 | The extracted text is the full single-page article with its sections all on this page; the only linked continuation, "Microservice Trade-Offs", is a separate article. |
| neg-fowler-microservices | single | 2 | false | – |  | 37 | The page is a single long-form article; its other links are navigation, tags, sidebars, and a separate related article (Microservice Trade-Offs), not parts of this piece. |
| neg-fowler-microservices | single | 3 | false | – |  | 37 | This is a single long-form article with all its sections on one page; the 'Microservice Trade-Offs' link is a separate follow-on article, not another part of this piece. |
| neg-githubio-karpathy | single | 1 | false | – |  | 2 | The extracted text is one complete long-form article that ends with its conclusion, and the only links are site header and navigation links. |
| neg-githubio-karpathy | single | 2 | false | – |  | 2 | The text is a single self-contained blog post whose start and end form a complete piece, and the only links are site navigation (home and about) rather than parts of the same work. |
| neg-githubio-karpathy | single | 3 | false | – |  | 2 | The text runs from the introduction to the conclusion ending in "Good luck!", and the only other links are the blog home and About page, so the piece is complete on this page. |
| neg-kitguru-warthog | single | 1 | false | – |  | 34 | The review is a single-page article; the other links are previous/next news posts, related articles, sidebar items and site navigation, not further parts of this review. |
| neg-kitguru-warthog | single | 2 | false | – |  | 34 | This is a single review article with no page-split links; the other links are navigation, previous/next news posts, related articles, and sidebar items. |
| neg-kitguru-warthog | single | 3 | false | – |  | 34 | This is a single review article whose text is complete; the other links are previous/next news posts, related articles, categories and sidebar items, not continuation pages of this review. |
| neg-mdn-fetch | single | 1 | false | – |  | 158 | This is a single MDN reference article; the other linked pages are separate articles, navigation, or related API docs rather than numbered or split parts of this same piece. |
| neg-mdn-fetch | single | 2 | false | – |  | 158 | This MDN reference page is a single self-contained article; the other links are navigation, related APIs, and footer pages rather than numbered parts of the same piece. |
| neg-mdn-fetch | single | 3 | false | – |  | 158 | This is a single MDN reference article; the other linked pages are navigation, related docs, or separate articles, not numbered parts of this piece. |
| neg-substack-marcus | single | 1 | false | – |  | 7 | This is a single standalone Substack newsletter post; the links are to comments, profiles, the homepage, and another post, not to further parts of the same piece. |
| neg-substack-marcus | single | 2 | false | – |  | 7 | This is a single short Substack newsletter post; its other links are comments, profiles, and a related post, not continuation pages of the same piece. |
| neg-substack-marcus | single | 3 | false | – |  | 7 | This is a single short newsletter post whose text is complete; the other links are comments, profiles, and a related post, not continuation pages of the same piece. |
| president-loan | multi | 1 | true | 4/4 |  | 93 | The article is split into numbered pages (2 / 次ページ, 3, 4, 5) and the text ends mid-argument with 'では、毎月の返済額…いくらまで借りられるのでしょうか', so it continues on the same site's ?page= URLs. |
| president-loan | multi | 2 | true | 4/4 |  | 93 | The article is split into numbered pages (2 / 次ページ, 3, 4, 5 via ?page=N) and the text ends mid-argument ("では…いくらまで借りられるのでしょうか"), so it continues on the other pages of the same piece. |
| president-loan | multi | 3 | true | 4/4 |  | 93 | The article is split into numbered pages (2 / 次ページ, 3, 4, 5) linked from the article body, and the text ends mid-argument ("では…いくらまで借りられるのでしょうか"), so it continues on those pages of the same piece. |
