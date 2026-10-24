# Multi-page judge eval, evals/multi-page/results/2026-10-24-v2 rescored

Gold: `evals/multi-page/gold.json`.

## deepseek (deepseek/deepseek-v4.1-flash)

- decision right: 66/72; false follows (single → followed): 2; missed (multi → not followed): 3; errors: 2
- pages, over 27 runs of 9 `multi` cases: recall 161/180 (89%); precision (complete gold only) 156/157 (99%); all gold pages picked 23/27 (85%); exactly the gold pages in gold order (complete gold only) 21/24 (88%); picks in gold order 24/24 (100%)
- cost per call: median $0.0009, max $0.0027; total $0.092
- latency: median 6329 ms, max 36218 ms

Pages per `multi` case:

| case | gold complete | runs | recall | precision | all gold | exact | in order | gold pages missed (runs) |
|---|---|---|---|---|---|---|---|---|
| aisafety-dance | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |
| compendium | false | 3 | 5/9 (56%) | – | 1/3 | – | 2/2 | /summary (1) /introduction (1) /the-state-of-ai-today (2) |
| govuk-uc | true | 3 | 18/27 (67%) | 18/18 (100%) | 2/3 | 2/3 | 2/2 | /universal-credit/eligibility (1) /universal-credit/what-youll-get (1) /universal-credit/how-your-wages-affect-your-payments (1) /universal-credit/how-youre-paid (1) /universal-credit/how-to-claim (1) /universal-credit/your-claimant-commitment (1) /universal-credit/get-advance-or-financial-support (1) /universal-credit/changes-of-circumstances (1) /universal-credit/contact-universal-credit (1) |
| gradual-disempowerment | true | 3 | 21/21 (100%) | 21/21 (100%) | 3/3 | 3/3 | 3/3 | – |
| intelligence-curse | true | 3 | 12/18 (67%) | 12/13 (92%) | 2/3 | 1/3 | 2/2 | /pyramid (1) /capital (1) /defining (1) /shaping (1) /breaking (1) /history (1) |
| realhw-ryzen | true | 3 | 48/48 (100%) | 48/48 (100%) | 3/3 | 3/3 | 3/3 | – |
| situational-awareness | true | 3 | 24/24 (100%) | 24/24 (100%) | 3/3 | 3/3 | 3/3 | – |
| superdark | true | 3 | 9/9 (100%) | 9/9 (100%) | 3/3 | 3/3 | 3/3 | – |
| toms-hw | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |

| case | gold | run | follows | gold pages picked | extra | links | reason |
|---|---|---|---|---|---|---|---|
| 80k-career-guide | either | 1 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +13 | 108 | The page serves as a hub for a long-form guide, linking to numerous sub-sections that constitute the full piece. |
| 80k-career-guide | either | 2 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +13 | 108 | The page serves as a directory for a structured, multi-part guide ('How to find a fulfilling career') which is split into numerous sections. |
| 80k-career-guide | either | 3 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +13 | 108 | The page acts as an index for a comprehensive career guide, linking to many separate sections of the same long-form work. |
| aisafety-dance | multi | 1 | true | 4/4 |  | 5 | The text explicitly introduces a '3-part series' and provides links to Part 1, Part 2, Part 3, and a conclusion. |
| aisafety-dance | multi | 2 | true | 4/4 |  | 5 | The text explicitly introduces a 3-part series (plus a conclusion) and provides direct links to those subsequent parts. |
| aisafety-dance | multi | 3 | true | 4/4 |  | 5 | The text explicitly introduces itself as a '3-part series' and provides links to all the respective parts and a conclusion. |
| compendium | multi | 1 | false | 0/3 |  | 6 | The links provided are structural and navigational elements (summary, introduction) rather than clear indicators of sequential parts of a single, multi-page article. |
| compendium | multi | 2 | true | 3/3 |  | 6 | The landing page serves as an entry point, and the main topic is split across distinct informational links like 'Summary', 'Introduction', and 'the-state-of-ai-today'. |
| compendium | multi | 3 | true | 2/3 |  | 6 | The text functions as an introduction or overview that explicitly directs the reader to other pages to 'Start Reading'. |
| divepython | either | 1 | true | – | /your-first-python-program.html | 7 | The page includes a 'rel="next"' link (L6) indicating sequential content continues in the tutorial. |
| divepython | either | 2 | true | – | /your-first-python-program.html | 7 | The page contains a navigational link (Next) to another sequential chapter of the tutorial. |
| divepython | either | 3 | true | – | /case-study-porting-chardet-to-python-3.html /your-first-python-program.html | 7 | The text is part of a structured guide referencing later content in the book and sequential tutorial steps. |
| eloquentjs | either | 1 | true | 1/1 | /02_program_structure.html /03_functions.html /04_data.html /05_higher_order.html +15 | 23 | This page is an introduction to a structured book, and the links provided point to sequential chapters that make up the rest of the work. |
| eloquentjs | either | 2 | true | 1/1 | /02_program_structure.html /03_functions.html /04_data.html /05_higher_order.html +15 | 23 | This page is the introduction to a long-form textbook, and the links point to sequential chapters. |
| eloquentjs | either | 3 | true | 1/1 | /02_program_structure.html /03_functions.html /04_data.html /05_higher_order.html +15 | 23 | The page is the introduction to a structured book, linking to sequential chapters within the same work. |
| govuk-uc | multi | 1 | true | 9/9 |  | 67 | The page acts as an introduction to a comprehensive, multi-section guidance document with links to specific topics like eligibility and claiming. |
| govuk-uc | multi | 2 | true | 9/9 |  | 67 | The links strongly suggest a structured, multi-page guide or series of sequential chapters explaining Universal Credit. |
| govuk-uc | multi | 3 | false | 0/9 |  | 67 | This page acts as a high-level index for a comprehensive policy guide, not a single, continuous article. |
| gradual-disempowerment | multi | 1 | true | 7/7 |  | 7 | The links provided navigate to distinct chapters or sections of a unified academic paper titled 'Gradual Disempowerment'. |
| gradual-disempowerment | multi | 2 | true | 7/7 |  | 7 | The text acts as an introduction to a detailed report structured across multiple linked sections (e.g., Misaligned Economy, Mitigating the Risk, and Conclusion). |
| gradual-disempowerment | multi | 3 | true | 7/7 |  | 7 | The page acts as an introduction to a larger, structured piece of writing divided into thematic sections and a conclusion. |
| intelligence-curse | multi | 1 | true | 6/6 | /about/ | 7 | The page functions as a navigational index for distinct sections or chapters of a larger multi-part work. |
| intelligence-curse | multi | 2 | true | 6/6 |  | 7 | The content is presented as a multi-part long-form essay, with navigation links pointing to specific chapters or sections of the same work. |
| intelligence-curse | multi | 3 | false | 0/6 |  | 7 | This page functions as an index or table of contents, linking to separate, major sections of a single extensive work rather than representing a sequential continuation of the text. |
| neg-acx-substack | single | 1 | false | – |  | 1 | The text is a complete post and does not contain internal numbering or explicit links suggesting the article is split across multiple pages. |
| neg-acx-substack | single | 2 | false | – |  | 1 | The page contains a single cohesive blog post and lacks explicit numbering, chapter markers, or 'next page' indicators. |
| neg-acx-substack | single | 3 | false | – |  | 1 | The text appears to be a complete blog post or personal update, and there are no structural indicators (like numbered pages or 'read more' prompts) that it continues elsewhere. |
| neg-coldtakes-index | single | 1 | false | – |  | 23 | This page acts as a series index or hub, linking to multiple separate blog posts about the topic. |
| neg-coldtakes-index | single | 2 | false | – |  | 23 | The page is an introduction and index to a series of separate blog posts, not a continuous single article. |
| neg-coldtakes-index | single | 3 | true | – | /most-important-century-series-roadmap/ /roadmap-for-the-most-important-century-series/ /all-possible-views-about-humanitys-future-are-wild/ /this-cant-go-on/ +10 | 23 | The page is the index/introduction for a series of interconnected blog posts, and the text instructs the reader to proceed through the linked pieces. |
| neg-coldtakes-post | either | 1 | false | – |  | 20 | The content appears to be a self-contained post from a series, and the links provided point to related articles or previous pieces, not sequential pages of the current work. |
| neg-coldtakes-post | either | 2 | false | – |  | 20 | The article appears to be a complete standalone essay, and the provided links point to related series topics or other articles. |
| neg-coldtakes-post | either | 3 | false | – |  | 20 | The article appears to be a single, complete post, even though it is part of a larger thematic series. |
| neg-forethought-long | single | 1 | false | – |  | 20 | The provided links are navigational, relate to other research topics, or are utility links, and do not indicate structural continuation of the current article. |
| neg-forethought-long | single | 2 | false | – |  | 20 | The page does not contain explicit internal pagination links or 'next page' indicators for the article. |
| neg-forethought-long | single | 3 | false | – |  | 20 | The article appears to be a complete standalone piece, with links pointing to related topics, not sequential continuation pages. |
| neg-guardian | single | 1 | false | – |  | 105 | The text ends abruptly, but there are no explicit links suggesting a continuation of this specific article. |
| neg-guardian | single | 2 | false | – |  | 105 | There are no explicit links or textual cues suggesting this article is split across multiple pages. |
| neg-guardian | single | 3 | false | – |  | 105 | The page is a standard news report and contains no structural elements or explicit text indicating that the piece continues onto subsequent pages. |
| neg-gwern | single | 1 | false | – |  | 75 | The page appears to be a complete, self-contained article without explicit sequential pagination or 'next page' indicators. |
| neg-gwern | single | 2 | false | – |  | 75 | The page appears to be a single comprehensive article or review, and the links provided are mostly to citations, related topics, or internal site features, not subsequent parts of the main piece. |
| neg-gwern | single | 3 | false | – |  | 75 | The page contains detailed references and internal sections, but no links indicating sequential pagination or continuation onto another article part. |
| neg-hn-front | single | 1 | false | – |  | 162 | This page is a paginated list of independent news articles and does not constitute a single continuous work. |
| neg-hn-front | single | 2 | false | – |  | 162 | This page is a paginated index of multiple separate news items, not a single, continuous work. |
| neg-hn-front | single | 3 | false | – |  | 162 | The page is an index of separate news articles (Hacker News) and not a single multi-part work. |
| neg-hn-thread | single | 1 | false | – |  | 201 | The page is a discussion thread on Hacker News, which is a standalone piece of content without internal pagination. |
| neg-hn-thread | single | 2 | false | – |  | 201 | This page is a single article/discussion thread on Hacker News, and the provided links are for site navigation or other separate items. |
| neg-hn-thread | single | 3 | false | – |  | 201 | The content is a single discussion thread/item page typical of Hacker News, and all links point to site navigation or specific comments within this entry. |
| neg-joel-post | single | 1 | false | – |  | 19 | The text is a complete, self-contained article, and the provided links are for general site navigation or related posts. |
| neg-joel-post | single | 2 | false | – |  | 19 | The text is a single, self-contained article, and the links provided are to related articles or site navigation, not subsequent parts of the same piece. |
| neg-joel-post | single | 3 | false | – |  | 19 | The text is a single, self-contained article presenting a test and commentary without explicit continuation markers. |
| neg-lesswrong | single | 1 | false | – |  | 14 | The page contains only a short snippet and only provides general site navigation links, with no indications of sequential parts. |
| neg-lesswrong | single | 2 | false | – |  | 14 | No sequential pagination or internal links suggesting a multi-page work were found in the provided data. |
| neg-lesswrong | single | 3 | false | – |  | 14 | The provided text and navigational links do not indicate that the article is split into multiple pages or parts. |
| neg-nngroup | single | 1 | false | – |  | 49 | The page does not contain explicit signals such as numbered pages or 'next page' links indicating continuation of a single piece. |
| neg-nngroup | single | 2 | false | – |  | 49 | The article ends with related articles and a link to a downloadable full report, but there is no indication of sequential multi-page navigation within the text. |
| neg-nngroup | single | 3 | false | – |  | 49 | The text does not contain references to 'next page' or indicates that the article is split into parts. |
| neg-paulgraham | single | 1 | false | – |  | 1 | The text appears to be a single, complete essay, and the only linked page is the site index. |
| neg-paulgraham | single | 2 | false | – |  | 1 | The text does not contain any explicit indications or structural evidence that the article is split across multiple pages. |
| neg-paulgraham | single | 3 | false | – |  | 1 | The page does not contain typical continuation markers or links to subsequent parts of the same essay. |
| neg-python-howto | single | 1 | false | – |  | 25 | The page is a comprehensive technical HOWTO document, and there are no explicit indications (such as 'Part 2' or numbered pagination) that the piece is split across multiple linked pages. |
| neg-python-howto | single | 2 | false | – |  | 25 | This is a self-contained Python documentation HOWTO, and the 'next' link refers to the next sequential topic rather than a continuation of this specific article. |
| neg-python-howto | single | 3 | false | – |  | 25 | The page is a comprehensive technical HOWTO guide, and the linked pages represent other distinct HOWTO articles within the site rather than sequential parts of this specific piece. |
| neg-ssc-index | single | 1 | false | – |  | 139 | The provided links are standard blog navigation and do not contain explicit links to subsequent parts of the same article. |
| neg-ssc-index | single | 2 | false | – |  | 139 | The pagination refers to the index of various blog posts, not to a single serialized work. |
| neg-ssc-index | single | 3 | false | – |  | 139 | The URL structure and surrounding links indicate general blog pagination of archives rather than a continuous multi-page article. |
| neg-ssc-moloch | single | 1 | false | – |  | 118 | The content appears to be a standalone blog post, lacking internal pagination or explicit continuation cues. |
| neg-ssc-moloch | single | 2 | ERR TimeoutError: The operation was aborted due to timeout | – |  | 118 |  |
| neg-ssc-moloch | single | 3 | false | – |  | 118 | The page is a standalone blog post and the surrounding links are navigation to other separate articles on the site. |
| neg-wbw-ai | either | 1 | true | 1/1 |  | 48 | The text explicitly states that the piece is split into two parts, and a link to 'Part 2' is provided. |
| neg-wbw-ai | either | 2 | true | 1/1 |  | 48 | The text explicitly states that the piece is broken into two parts and provides a link to Part 2. |
| neg-wbw-ai | either | 3 | true | 1/1 |  | 48 | The extracted text explicitly states it is 'Part 1' and links to 'Part 2 of this post' via link L15. |
| neg-wikipedia | single | 1 | false | – |  | 250 | The page is a single Wikipedia article, which is structurally complete in itself and does not indicate sequential continuation across other web pages. |
| neg-wikipedia | single | 2 | true | – | /w/index.php?title=Transformer_(deep_learning)&action=edit&section=2 /w/index.php?title=Transformer_(deep_learning)&action=edit&section=3 /w/index.php?title=Transformer_(deep_learning)&action=edit&section=4 /w/index.php?title=Transformer_(deep_learning)&action=edit&section=5 +7 | 250 | The Wikipedia article is structured into numerous linked sections, and the provided text only covers the introduction and initial concepts. |
| neg-wikipedia | single | 3 | false | – |  | 250 | This is a standard Wikipedia article and does not appear to be split across multiple numbered pages or sequential parts. |
| progit | either | 1 | true | 1/1 | /book/en/v2/Getting-Started-What-is-Git%3F /book/en/v2/Getting-Started-The-Command-Line /book/en/v2/Getting-Started-Installing-Git /book/en/v2/Getting-Started-First-Time-Git-Setup +15 | 146 | The page is the introduction to a comprehensive chapter of a structured technical book. |
| progit | either | 2 | true | 1/1 | /book/en/v2/Getting-Started-What-is-Git%3F /book/en/v2/Getting-Started-The-Command-Line /book/en/v2/Getting-Started-Installing-Git /book/en/v2/Getting-Started-First-Time-Git-Setup +15 | 146 | The page is an introduction to a book chapter, and the links provided are the sequential sections of the entire work. |
| progit | either | 3 | true | 1/1 | /book/en/v2/Getting-Started-What-is-Git%3F /book/en/v2/Getting-Started-The-Command-Line /book/en/v2/Getting-Started-Installing-Git /book/en/v2/Getting-Started-First-Time-Git-Setup +15 | 146 | The page is an introductory section (Git Book), and the extensive Table of Contents links point to subsequent chapters that complete the work. |
| realhw-ryzen | multi | 1 | true | 16/16 |  | 64 | The article is split into sequentially numbered parts starting from page 2, such as '2. Specifications' and '3. AMD’s Zen'. |
| realhw-ryzen | multi | 2 | true | 16/16 |  | 64 | The article is broken into sequentially numbered parts, which are linked within the same topic. |
| realhw-ryzen | multi | 3 | true | 16/16 |  | 64 | The article is divided into a multi-part series, and subsequent sections are linked sequentially. |
| rust-book | either | 1 | true | 1/1 |  | 3 | The page is an introduction to a long-form instructional book and explicitly links to the next sequential chapter. |
| rust-book | either | 2 | true | 1/1 |  | 3 | The page is part of a structured book and provides a clear 'next' navigational link to the subsequent section. |
| rust-book | either | 3 | true | 1/1 | /book/ch00-00-introduction.html /book/print.html | 3 | This page is a chapter introduction linking to previous chapters and subsequent sections of the same book. |
| situational-awareness | multi | 1 | true | 8/8 |  | 9 | The page introduces a multi-part series, with links provided for each subsequent section in reading order. |
| situational-awareness | multi | 2 | true | 8/8 |  | 9 | The text explicitly mentions a series and provides links to subsequent numbered parts of the same long-form work. |
| situational-awareness | multi | 3 | true | 8/8 |  | 9 | The text is the introduction to a multi-part series and provides links to all subsequent chapters/sections. |
| superdark | multi | 1 | true | 3/3 |  | 3 | The page serves as an introduction to a multi-chapter work, providing direct links to subsequent chapters. |
| superdark | multi | 2 | true | 3/3 |  | 3 | The text introduces a series and links to subsequent chapters of the same work. |
| superdark | multi | 3 | true | 3/3 |  | 3 | The text is an introduction to a work explicitly divided into sequential chapters (I, II, and III) via the provided links. |
| toms-hw | multi | 1 | true | 4/4 |  | 214 | The text contains explicit links to the subsequent numbered pages of the review (Page 2 through Page 5). |
| toms-hw | multi | 2 | true | 4/4 |  | 214 | The page contains explicit links to sequential pages (Page 2, 3, 4, 5) of the same CPU review article. |
| toms-hw | multi | 3 | true | 4/4 |  | 214 | The review is split across numbered pages (2 through 5) with explicit 'next' and internal page links. |
| wikibooks | either | 1 | true | 0/1 | /wiki/Haskell/Variables_and_functions /wiki/Haskell/Truth_values /wiki/Haskell/Type_basics /wiki/Haskell/Lists_and_tuples +3 | 62 | The text explicitly introduces the next chapter where basic concepts will be covered and links to those sequential chapters. |
| wikibooks | either | 2 | true | 1/1 | /wiki/Haskell /wiki/Haskell/Variables_and_functions /wiki/Haskell/Truth_values /wiki/Haskell/Type_basics +15 | 62 | The text introduces a structured programming guide and contains extensive internal links to subsequent chapters of the Haskell book. |
| wikibooks | either | 3 | ERR MultiPageAnswerInvalid: multi-page answer refused: the answer did not finish normally | 0/1 |  | 62 |  |

## haiku (anthropic/claude-haiku-5.5)

- decision right: 72/72; false follows (single → followed): 0; missed (multi → not followed): 0; errors: 0
- pages, over 27 runs of 9 `multi` cases: recall 178/180 (99%); precision (complete gold only) 171/171 (100%); all gold pages picked 25/27 (93%); exactly the gold pages in gold order (complete gold only) 24/24 (100%); picks in gold order 27/27 (100%)
- cost per call: median $0.0005, max $0.0017; total $0.057
- latency: median 2123 ms, max 33654 ms

Pages per `multi` case:

| case | gold complete | runs | recall | precision | all gold | exact | in order | gold pages missed (runs) |
|---|---|---|---|---|---|---|---|---|
| aisafety-dance | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |
| compendium | false | 3 | 7/9 (78%) | – | 1/3 | – | 3/3 | /summary (2) |
| govuk-uc | true | 3 | 27/27 (100%) | 27/27 (100%) | 3/3 | 3/3 | 3/3 | – |
| gradual-disempowerment | true | 3 | 21/21 (100%) | 21/21 (100%) | 3/3 | 3/3 | 3/3 | – |
| intelligence-curse | true | 3 | 18/18 (100%) | 18/18 (100%) | 3/3 | 3/3 | 3/3 | – |
| realhw-ryzen | true | 3 | 48/48 (100%) | 48/48 (100%) | 3/3 | 3/3 | 3/3 | – |
| situational-awareness | true | 3 | 24/24 (100%) | 24/24 (100%) | 3/3 | 3/3 | 3/3 | – |
| superdark | true | 3 | 9/9 (100%) | 9/9 (100%) | 3/3 | 3/3 | 3/3 | – |
| toms-hw | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |

| case | gold | run | follows | gold pages picked | extra | links | reason |
|---|---|---|---|---|---|---|---|
| 80k-career-guide | either | 1 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +12 | 108 | This is the front page of a single multi-part guide, and it links each of its chapters in order under 'career-guide-parts'. |
| 80k-career-guide | either | 2 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +12 | 108 | This is the front page of the 80,000 Hours career guide, a single long-form work whose chapters are listed as parts of the guide in its career-guide-parts section. |
| 80k-career-guide | either | 3 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +12 | 108 | This is the front page of the 80,000 Hours career guide, which links its chapters as parts of the same work in the 'career-guide-parts' section. |
| aisafety-dance | multi | 1 | true | 4/4 |  | 5 | The front page is the introduction to a single three-part series, with links to Part 1, Part 2, Part 3 and the conclusion as parts of the same work, so the piece continues on those pages. |
| aisafety-dance | multi | 2 | true | 4/4 |  | 5 | The front page is the introduction to a single three-part series (Parts 1–3) plus a conclusion, which are chapters of the same work, so the piece continues on those pages; the supporters thank-you page is not part of the piece. |
| aisafety-dance | multi | 3 | true | 4/4 |  | 5 | The front page introduces a single 3-part series, with links to Part 1, Part 2, Part 3 and the conclusion, which are parts of the same work rather than separate articles. |
| compendium | multi | 1 | true | 2/3 |  | 6 | This landing page introduces The Compendium, a long-form work split into chapters, and its Start Reading link points to the introduction, with the state-of-AI chapter linked alongside. |
| compendium | multi | 2 | true | 3/3 |  | 6 | This landing page introduces The Compendium, a single long-form work split into chapters, and links to its summary, introduction and first chapter. |
| compendium | multi | 3 | true | 2/3 |  | 6 | This homepage is the front page of The Compendium, a multi-part work whose chapters, the introduction and 'The State of AI Today', are linked as its parts. |
| divepython | either | 1 | false | – |  | 7 | This is one self-contained chapter of a book whose text ends with the page footer; the next chapter is a separate page, not a continuation of this piece. |
| divepython | either | 2 | false | – |  | 7 | This page is one self-contained chapter of a multi-chapter book, and the links to other chapters are navigation to separate chapters rather than parts of this page's text. |
| divepython | either | 3 | false | – |  | 7 | This is a single chapter of a book, reached through prev/next navigation links, and the page does not say the piece continues, so the reader gets just this page. |
| eloquentjs | either | 1 | false | 0/1 |  | 23 | This introduction is a self-contained chapter of a book; its other links are to other chapters and in-text references, and the page itself is the complete introduction rather than a split piece, so the reader gets this page alone. |
| eloquentjs | either | 2 | false | 0/1 |  | 23 | This is the introduction page of a book whose chapters are separate pages, but the links are in-text cross-references to other chapters and the page is a self-contained introduction rather than a numbered or continued piece of one article. |
| eloquentjs | either | 3 | false | 0/1 |  | 23 | This is the introduction page of a book whose chapters are separate pages, but the links are mostly in-text cross-references and the navigation links only to the previous and next chapters, so the introduction is a self-contained piece that the reader would not expect to continue on other pages. |
| govuk-uc | multi | 1 | true | 9/9 |  | 67 | This is the introduction to a multi-part GOV.UK guide, and its contents list links to the guide's other chapters in reading order. |
| govuk-uc | multi | 2 | true | 9/9 |  | 67 | This is the introduction of a GOV.UK guide whose parts are listed in its contents navigation (Eligibility through Contact Universal Credit), so the piece continues on those pages. |
| govuk-uc | multi | 3 | true | 9/9 |  | 67 | This is the introduction to a multi-part GOV.UK guide, and its contents list links every chapter of the same Universal Credit guide in reading order. |
| gradual-disempowerment | multi | 1 | true | 7/7 |  | 7 | This is the introduction of a multi-part essay, and its sidebar links all point to the chapters of the same work (economy, culture, states, mutual reinforcement, mitigation, related work, conclusion). |
| gradual-disempowerment | multi | 2 | true | 7/7 |  | 7 | The front page is the introduction of a single multi-part essay, and its sidebar links to its sequential sections (Misaligned Economy, Culture, States, Mutual Reinforcement, Mitigating the Risk, Related Work, Conclusion) as parts of the same work. |
| gradual-disempowerment | multi | 3 | true | 7/7 |  | 7 | This is the introduction of a single essay whose chapters (economy, culture, states, mitigation, conclusion) are linked as parts of the same work in the sidebar navigation. |
| intelligence-curse | multi | 1 | true | 6/6 |  | 7 | The front page is the introduction of one essay, The Intelligence Curse, whose chapters are linked as its in-text table of contents sections on the same site. |
| intelligence-curse | multi | 2 | true | 6/6 |  | 7 | The page is the front page of a single long-form essay, The Intelligence Curse, whose parts (Pyramid Replacement through History is Yours to Write) are linked in its table of contents as chapters of the same work. |
| intelligence-curse | multi | 3 | true | 6/6 |  | 7 | The page is the front page of a single long-form essay split into parts (Pyramid Replacement, Capital, Defining, Shaping, Breaking, History), listed in its table of contents, so the piece continues across those pages. |
| neg-acx-substack | single | 1 | false | – |  | 1 | This is a standalone Substack announcement post; its only same-site link is to the homepage, so there is no multi-page piece to continue. |
| neg-acx-substack | single | 2 | false | – |  | 1 | This is a standalone Substack announcement post; its only same-site link is to the homepage, so it does not continue on other pages. |
| neg-acx-substack | single | 3 | false | – |  | 1 | This is a standalone Substack announcement post; its only same-site link is the homepage, so there are no other pages of the same piece. |
| neg-coldtakes-index | single | 1 | false | – |  | 23 | This is a summary and landing page for a blog post series, which lists each post as a separate article on a blog that publishes many pieces, so the reader gets this page alone. |
| neg-coldtakes-index | single | 2 | false | – |  | 23 | This page introduces and summarises a blog series whose posts are separate articles on a site that publishes many pieces, so it does not continue as a single work. |
| neg-coldtakes-index | single | 3 | false | – |  | 23 | This page introduces and summarises a series whose parts were each published as standalone blog posts, so it is not itself a split piece of one work. |
| neg-coldtakes-post | either | 1 | false | – |  | 20 | This is a standalone Cold Takes post; its links are series navigation, related posts, tags, and cited sources rather than numbered or continued parts of this same piece. |
| neg-coldtakes-post | either | 2 | false | – |  | 20 | This is a standalone Cold Takes post; its links are to series roadmap, related posts, tags and footers rather than numbered or continued parts of this same piece. |
| neg-coldtakes-post | either | 3 | false | – |  | 20 | This is a standalone Cold Takes post; its links are to other series pieces, related posts, tags and navigation rather than numbered or continued parts of this same piece. |
| neg-forethought-long | single | 1 | false | – |  | 20 | The page holds the full long-form report in one address; its other links are separate research pieces, navigation, or in-text references, not numbered or split parts of this work. |
| neg-forethought-long | single | 2 | false | – |  | 20 | The extracted text is one complete long-form report with its own introduction and footnotes; the other links are in-site research pages cited in the text, related reading, or navigation, not parts of this same work. |
| neg-forethought-long | single | 3 | false | – |  | 20 | The extracted text is one complete long-form report with its full body and footnotes; the linked pages are other research pieces and navigation, not parts of this work. |
| neg-guardian | single | 1 | false | – |  | 105 | This is a single Guardian news article; the other links are site navigation, related stories, and standalone articles rather than parts of the same piece. |
| neg-guardian | single | 2 | false | – |  | 105 | This is a single news article; the other links are related stories, navigation, and footer links rather than parts of the same piece. |
| neg-guardian | single | 3 | false | – |  | 105 | This is a single news article; the other links are navigation, related stories, and unrelated articles rather than parts of the same piece. |
| neg-gwern | single | 1 | false | – |  | 75 | The Scaling Hypothesis is a single long essay on one page; the links to other pages are cited sources, related essays, site navigation, or backlinks rather than numbered or continued parts of this piece. |
| neg-gwern | single | 2 | false | – |  | 75 | The page is a single long-form essay with its full text extracted, and its links are to sidenotes, tags, related essays, and references rather than to numbered or continued parts of this same piece. |
| neg-gwern | single | 3 | false | – |  | 75 | The Scaling Hypothesis is a single long essay on one page, and the other links are sidebar, backlinks, related-work citations, or references rather than numbered or continued parts of this piece. |
| neg-hn-front | single | 1 | false | – |  | 162 | This is a Hacker News index page listing many separate stories, so it is not a single piece split across pages. |
| neg-hn-front | single | 2 | false | – |  | 162 | This is a Hacker News index page listing many separate stories, so it is not a single piece split across pages; the 'More' link is index pagination. |
| neg-hn-front | single | 3 | false | – |  | 162 | This is a Hacker News index page listing many separate stories, so it is not a single piece split across pages. |
| neg-hn-thread | single | 1 | false | – |  | 201 | This is a Hacker News discussion thread with comments, not a single piece of writing split across pages; the other links are to separate comments, user pages and site navigation. |
| neg-hn-thread | single | 2 | false | – |  | 201 | This is a Hacker News discussion thread with comments, not a single work split across pages; the other links are comment permalinks and user or navigation links. |
| neg-hn-thread | single | 3 | false | – |  | 201 | This is a Hacker News discussion thread with comments, not a single piece of writing split across pages; the other links are separate comment items and user pages. |
| neg-joel-post | single | 1 | false | – |  | 19 | This is a standalone blog post; the other linked pages are related articles and adjacent posts (previous/next post navigation), which are separate works rather than parts of this piece. |
| neg-joel-post | single | 2 | false | – |  | 19 | This is a standalone blog post; the other linked pages are separate articles and previous/next posts, not parts of the same piece. |
| neg-joel-post | single | 3 | false | – |  | 19 | The Joel Test is a single standalone blog post; the other linked pages are related articles, sidebar links, and previous/next posts, which are separate works rather than parts of this piece. |
| neg-lesswrong | single | 1 | false | – |  | 14 | This is a LessWrong discussion post (a link post with comments), and its links are user profiles, navigation and moderation pages rather than other parts of one piece of writing. |
| neg-lesswrong | single | 2 | false | – |  | 14 | This is a LessWrong discussion post (a link post with comments) and its links are author pages, community tags and site navigation, not other parts of one piece of writing. |
| neg-lesswrong | single | 3 | false | – |  | 14 | The page is a LessWrong link post with comments and navigation links to users and site pages, not split parts of one piece. |
| neg-nngroup | single | 1 | false | – |  | 49 | The page is a single standalone NN/g article; its other links are related articles, courses, site navigation, and a separate full report, not continuation pages of this piece. |
| neg-nngroup | single | 2 | false | – |  | 49 | This is a single standalone NN/g article; the other linked pages are related articles, courses, and site navigation, not parts of the same piece. |
| neg-nngroup | single | 3 | false | – |  | 49 | This is a single standalone NN/g article; the other linked pages are related articles, courses, and site navigation, not parts of the same piece. |
| neg-paulgraham | single | 1 | false | – |  | 1 | This is a single essay whose full text is on one page, ending with acknowledgements; the only other link is to the site index, not to further parts of the piece. |
| neg-paulgraham | single | 2 | false | – |  | 1 | This is a single essay whose text runs from start to finish with its footnotes and acknowledgments, and the only same-site link is to the index page. |
| neg-paulgraham | single | 3 | false | – |  | 1 | This is a single essay whose text runs from start to finish, and the only other link is to the site index, so it does not continue on other pages. |
| neg-python-howto | single | 1 | false | – |  | 25 | This is a single self-contained HOWTO document; the linked next and previous pages are separate HOWTOs, and the rest of the links are navigation or in-text references. |
| neg-python-howto | single | 2 | false | – |  | 25 | This is a single self-contained HOWTO document, and the other links are navigation to separate HOWTOs, modules and site sections rather than continuations of this piece. |
| neg-python-howto | single | 3 | false | – |  | 25 | The Functional Programming HOWTO is a single self-contained document; its prev/next links point to separate HOWTOs (Logging, Enum) and the rest are reference, navigation, or in-text links. |
| neg-ssc-index | single | 1 | false | – |  | 139 | This is a blog's index page (page 2 of the post list) containing many separate posts, so it is not a single piece split across pages. |
| neg-ssc-index | single | 2 | false | – |  | 139 | This is a blog index page (page 2 of the site's post list) containing many separate posts, so it does not hold a single piece split across pages. |
| neg-ssc-index | single | 3 | false | – |  | 139 | This is a blog's index page listing many separate posts (the Problems With Paywalls essay is one standalone post among many), so it does not continue onto other pages of one work. |
| neg-ssc-moloch | single | 1 | false | – |  | 118 | This is a single standalone post; the linked 'Misperceptions On Moloch' with rel=next is a separate article, and the text reaches the poem's end without indicating continuation. |
| neg-ssc-moloch | single | 2 | false | – |  | 118 | This is a single standalone post; the linked 'Misperceptions On Moloch' is a separate next post, and the other links are archives, tags, comments, or in-text citations. |
| neg-ssc-moloch | single | 3 | false | – |  | 118 | The essay is a single post on one page, and the linked 'prev' and 'next' items are separate posts (Weird Psychiatric Ads, Misperceptions On Moloch), not parts of this piece. |
| neg-wbw-ai | either | 1 | true | 1/1 |  | 48 | This is Part 1 of a two-part article split across addresses, and the page explicitly says Part 2 continues the piece, linked as 'Part 2 of this post'. |
| neg-wbw-ai | either | 2 | true | 1/1 |  | 48 | This is Part 1 of a two-part essay explicitly split across pages, and the text says Part 2 is linked here, so it is one work continued on another address. |
| neg-wbw-ai | either | 3 | true | 1/1 |  | 48 | This is Part 1 of a two-part essay split across addresses, and Part 2 is linked in the text as the continuation of the same work. |
| neg-wikipedia | single | 1 | false | – |  | 250 | This is a Wikipedia encyclopedia article on one topic, and its links are navigation, related topics, and in-text references rather than numbered or continued parts of the same piece. |
| neg-wikipedia | single | 2 | false | – |  | 250 | This is a Wikipedia encyclopedia article on one topic; its other links are navigation, related topics, and sources rather than numbered or split parts of the same work. |
| neg-wikipedia | single | 3 | false | – |  | 250 | This is a Wikipedia encyclopedia article, a single work whose links are navigation, related topics and citations rather than numbered parts or continuation pages of the same piece. |
| progit | either | 1 | false | 0/1 |  | 146 | This page is a self-contained first section of the Pro Git book's table of contents; the other links are chapter navigation and translations, and the page does not split this section's text across numbered pages. |
| progit | either | 2 | false | 0/1 |  | 146 | This is one section of a multi-section book whose sections are separate standalone pages, and the page's own text does not say it continues; the book's table of contents is a navigation index, not a continuation of this piece. |
| progit | either | 3 | false | 0/1 |  | 146 | This Pro Git book page is one chapter of a book; its other pages are separate chapters listed in the table of contents, and the page does not show a 'next page' pagination of this one piece, so the reader gets this chapter alone. |
| realhw-ryzen | multi | 1 | true | 16/16 |  | 64 | This is page 1 of a 17-part split review, with a jeg_splitpost_nav listing all subsequent parts 2 through 17 as chapters of the same work. |
| realhw-ryzen | multi | 2 | true | 16/16 |  | 64 | The article is split across numbered pages 2 to 17, listed in a split-post navigation block, so this first page is only part of one review. |
| realhw-ryzen | multi | 3 | true | 16/16 |  | 64 | This page is the first part of a single review split into 17 numbered chapters via a split-post navigation, so the other chapters are the rest of the same work. |
| rust-book | either | 1 | false | 0/1 |  | 3 | This is the introductory page of a multi-chapter book, and its next and previous links are navigation to separate chapters rather than numbered pages of one piece; the page's own text is a complete chapter opener, so the reader gets this page. |
| rust-book | either | 2 | false | 0/1 |  | 3 | This is the introduction page of a chapter in a multi-chapter book, and the next links are separate chapter pages navigated via prev/next, not parts of this single page's text. |
| rust-book | either | 3 | false | 0/1 |  | 3 | This is the introductory page of a multi-chapter book, and its next and previous links are navigation to separate chapters rather than numbered pages of one piece, so the page is treated as standing alone. |
| situational-awareness | multi | 1 | true | 8/8 |  | 9 | This is the introduction to the single multi-part essay Situational Awareness, and the site's menu links its numbered chapters I through V, which are parts of the same work. |
| situational-awareness | multi | 2 | true | 8/8 |  | 9 | This is the introduction to the multi-part essay Situational Awareness, and the site navigation links its numbered chapters I through V, including IIIa-IIId, as parts of the same work. |
| situational-awareness | multi | 3 | true | 8/8 |  | 9 | This is the introduction to the multi-part essay Situational Awareness, and the site's navigation links all its numbered chapters I through V in reading order. |
| superdark | multi | 1 | true | 3/3 |  | 3 | This is the front page of a multi-chapter essay, and its chapter navigation links to Chapters I, II and III as parts of the same work. |
| superdark | multi | 2 | true | 3/3 |  | 3 | This is the front page of a multi-chapter essay, with chapter navigation linking to Chapters I, II and III as parts of the same work, and the text ends mid-argument with a 'Next chapter' link. |
| superdark | multi | 3 | true | 3/3 |  | 3 | This is the front page of a multi-chapter essay, with chapter navigation linking the numbered chapters I, II and III as parts of the same work and a 'Next chapter' link. |
| toms-hw | multi | 1 | true | 4/4 |  | 214 | This Tom's Hardware review is split into numbered pages (Page 2 through Page 5, linked via rel=next and the pages list), so it is one work continuing on other addresses. |
| toms-hw | multi | 2 | true | 4/4 |  | 214 | This is a multi-page review split into numbered pages (Page 2 through Page 5 of the same review), so the piece continues on those pages. |
| toms-hw | multi | 3 | true | 4/4 |  | 214 | This Tom's Hardware review is split into numbered pages (Page 2 through Page 5 are linked as parts of the same review), so the piece continues on those pages. |
| wikibooks | either | 1 | false | 0/1 |  | 62 | This Wikibooks chapter is a self-contained page; the links to other chapters are navigation and book structure, not continuations of this same text. |
| wikibooks | either | 2 | false | 0/1 |  | 62 | This is a self-contained Wikibooks chapter; the links to other chapters and Haskell/Packaging are book navigation or in-text references, not continuations of this piece. |
| wikibooks | either | 3 | false | 0/1 |  | 62 | This Wikibooks chapter is self-contained on one page; its links to other chapters are navigation and book structure, not continuation pages of the same piece. |

## luna (openai/gpt-6-luna)

- decision right: 72/72; false follows (single → followed): 0; missed (multi → not followed): 0; errors: 0
- pages, over 27 runs of 9 `multi` cases: recall 180/180 (100%); precision (complete gold only) 171/171 (100%); all gold pages picked 27/27 (100%); exactly the gold pages in gold order (complete gold only) 24/24 (100%); picks in gold order 27/27 (100%)
- cost per call: median $0.0002, max $0.0013; total $0.027
- latency: median 3409 ms, max 21950 ms

Pages per `multi` case:

| case | gold complete | runs | recall | precision | all gold | exact | in order | gold pages missed (runs) |
|---|---|---|---|---|---|---|---|---|
| aisafety-dance | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |
| compendium | false | 3 | 9/9 (100%) | – | 3/3 | – | 3/3 | – |
| govuk-uc | true | 3 | 27/27 (100%) | 27/27 (100%) | 3/3 | 3/3 | 3/3 | – |
| gradual-disempowerment | true | 3 | 21/21 (100%) | 21/21 (100%) | 3/3 | 3/3 | 3/3 | – |
| intelligence-curse | true | 3 | 18/18 (100%) | 18/18 (100%) | 3/3 | 3/3 | 3/3 | – |
| realhw-ryzen | true | 3 | 48/48 (100%) | 48/48 (100%) | 3/3 | 3/3 | 3/3 | – |
| situational-awareness | true | 3 | 24/24 (100%) | 24/24 (100%) | 3/3 | 3/3 | 3/3 | – |
| superdark | true | 3 | 9/9 (100%) | 9/9 (100%) | 3/3 | 3/3 | 3/3 | – |
| toms-hw | true | 3 | 12/12 (100%) | 12/12 (100%) | 3/3 | 3/3 | 3/3 | – |

| case | gold | run | follows | gold pages picked | extra | links | reason |
|---|---|---|---|---|---|---|---|
| 80k-career-guide | either | 1 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +12 | 108 | This page is the overview for a career guide whose linked chapters continue the same work. |
| 80k-career-guide | either | 2 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +12 | 108 | This page is the front page for a career guide whose linked chapters form one work. |
| 80k-career-guide | either | 3 | true | 3/3 | /career-guide/can-one-person-make-a-difference/ /career-guide/how-anyone-can-have-an-impact/ /career-guide/choosing-a-world-problem/ /career-guide/world-problems/ +12 | 108 | This is the hub page for a single career guide whose linked sections make up the rest of the work. |
| aisafety-dance | multi | 1 | true | 4/4 |  | 5 | The page presents a cohesive multi-part tour, and its linked parts and conclusion are explicitly labeled as sections of that work. |
| aisafety-dance | multi | 2 | true | 4/4 |  | 5 | This is the introduction to a three-part guide, with the remaining parts and conclusion linked as sections of the same work. |
| aisafety-dance | multi | 3 | true | 4/4 |  | 5 | The page presents a three-part work and links to its parts and conclusion as the continuation. |
| compendium | multi | 1 | true | 3/3 |  | 6 | This is the landing page for a compendium whose linked summary and topic pages form one larger work. |
| compendium | multi | 2 | true | 3/3 |  | 6 | This is the landing page for a single compendium, and its linked summary and reading sections form the work. |
| compendium | multi | 3 | true | 3/3 |  | 6 | The homepage introduces the compendium and links to its summary and reading sections as parts of the same work. |
| divepython | either | 1 | false | – |  | 7 | This is a complete chapter, not the book’s front page, introduction, or first chapter. |
| divepython | either | 2 | false | – |  | 7 | This is a complete chapter; the adjacent links navigate to separate chapters of the book. |
| divepython | either | 3 | true | – | /your-first-python-program.html | 7 | This is the book’s opening chapter, and its next-chapter link continues the same work. |
| eloquentjs | either | 1 | true | 1/1 |  | 23 | This is the book’s introduction, and its next-page link leads directly to Chapter 1. |
| eloquentjs | either | 2 | true | 1/1 | /02_program_structure.html /03_functions.html /04_data.html /05_higher_order.html +15 | 23 | This introduction belongs to a single book whose remaining chapters are linked from the page. |
| eloquentjs | either | 3 | true | 1/1 | /02_program_structure.html /03_functions.html /04_data.html /05_higher_order.html +15 | 23 | This introduction belongs to a book whose chapters are split across separate pages. |
| govuk-uc | multi | 1 | true | 9/9 |  | 67 | This is the introduction to a multi-page Universal Credit guide, and the linked contents list its remaining sections. |
| govuk-uc | multi | 2 | true | 9/9 |  | 67 | This is the opening page of a GOV.UK guide, with its remaining sections linked in the guide contents. |
| govuk-uc | multi | 3 | true | 9/9 |  | 67 | This is the opening page of a multi-page Universal Credit guide, and its contents list links to the guide’s remaining sections. |
| gradual-disempowerment | multi | 1 | true | 7/7 |  | 7 | The sidebar links to the remaining sections of the same article, beginning with an explicit “Continue” link. |
| gradual-disempowerment | multi | 2 | true | 7/7 |  | 7 | This is the opening page of a single article whose sidebar links to its subsequent sections. |
| gradual-disempowerment | multi | 3 | true | 7/7 |  | 7 | This is the opening page of a single paper whose sections are split across the linked pages. |
| intelligence-curse | multi | 1 | true | 6/6 |  | 7 | The table of contents links to separate chapters of this same report. |
| intelligence-curse | multi | 2 | true | 6/6 |  | 7 | The table of contents links to titled sections that appear to be parts of the same long-form work. |
| intelligence-curse | multi | 3 | true | 6/6 |  | 7 | The table of contents links to separate chapters of this same work. |
| neg-acx-substack | single | 1 | false | – |  | 1 | This is a complete logistics announcement, and its only listed link is to the site home page. |
| neg-acx-substack | single | 2 | false | – |  | 1 | This is a complete standalone announcement, and its only listed link is the site homepage. |
| neg-acx-substack | single | 3 | false | – |  | 1 | This is a complete standalone announcement, and its only listed link is to the site homepage. |
| neg-coldtakes-index | single | 1 | false | – |  | 23 | This page introduces and summarizes a series of separate blog posts rather than continuing as one split work. |
| neg-coldtakes-index | single | 2 | false | – |  | 23 | This page introduces and summarizes a series of separate blog posts rather than continuing as one split piece. |
| neg-coldtakes-index | single | 3 | false | – |  | 23 | This page summarizes and links to a series of standalone blog posts rather than continuing as one split work. |
| neg-coldtakes-post | either | 1 | false | – |  | 20 | This is a complete standalone article; its links to other pieces are references or related posts, not pages of this work. |
| neg-coldtakes-post | either | 2 | false | – |  | 20 | This is a complete standalone post; the linked series and related articles are separate works. |
| neg-coldtakes-post | either | 3 | false | – |  | 20 | This is a complete standalone article; links to the series roadmap and other posts do not indicate that this piece continues elsewhere. |
| neg-forethought-long | single | 1 | false | – |  | 20 | The page contains the full article, ending with its references and footnotes; the other links are separate works or site pages. |
| neg-forethought-long | single | 2 | false | – |  | 20 | The extracted text runs from the abstract through the references and footnotes, with no indication that the work continues on another page. |
| neg-forethought-long | single | 3 | false | – |  | 20 | The page contains the complete article, and its links point to related works rather than additional pages of this piece. |
| neg-guardian | single | 1 | false | – |  | 105 | This is a complete Guardian news article, and none of its links point to another page of the same piece. |
| neg-guardian | single | 2 | false | – |  | 105 | This is a complete Guardian news article, and none of its links point to another page of the same piece. |
| neg-guardian | single | 3 | false | – |  | 105 | This is a complete Guardian article; the other article links are related stories, not pages of the same piece. |
| neg-gwern | single | 1 | false | – |  | 75 | This is a complete long-form article, and its links point to references or separate works rather than pages continuing this piece. |
| neg-gwern | single | 2 | false | – |  | 75 | This is a complete standalone essay; its links are citations and related pages, not subsequent parts of the piece. |
| neg-gwern | single | 3 | false | – |  | 75 | The page contains the complete article, including its ending and footnotes; the other links are references or separate works. |
| neg-hn-front | single | 1 | false | – |  | 162 | This is a paginated Hacker News listing of separate stories, not one piece split across pages. |
| neg-hn-front | single | 2 | false | – |  | 162 | This is a Hacker News listing page; “More” leads to the next page of separate stories, not a continuation of one piece. |
| neg-hn-front | single | 3 | false | – |  | 162 | This is a paginated Hacker News listing of separate stories, not one piece continued across pages. |
| neg-hn-thread | single | 1 | false | – |  | 201 | This is a complete Hacker News discussion thread; the linked comment pages are separate replies, not parts of a paginated work. |
| neg-hn-thread | single | 2 | false | – |  | 201 | This is a single Hacker News discussion thread, not a work split across pages. |
| neg-hn-thread | single | 3 | false | – |  | 201 | This is a Hacker News discussion thread, not a work split across pages; the linked item pages are individual comments. |
| neg-joel-post | single | 1 | false | – |  | 19 | This is a complete standalone article; its links point to related articles and resources, not continuation pages. |
| neg-joel-post | single | 2 | false | – |  | 19 | This is a complete standalone article; its in-text links lead to other works, not pages of this piece. |
| neg-joel-post | single | 3 | false | – |  | 19 | The extracted text is a complete article, and its links point to other articles or posts rather than pages of this piece. |
| neg-lesswrong | single | 1 | false | – |  | 14 | This is a standalone link post, and no linked pages indicate that the same piece continues elsewhere. |
| neg-lesswrong | single | 2 | false | – |  | 14 | This is a standalone link post, not a paginated piece. |
| neg-lesswrong | single | 3 | false | – |  | 14 | This is a standalone link post, not one page of a work split across multiple addresses. |
| neg-nngroup | single | 1 | false | – |  | 49 | The article appears complete on this page; the linked report and related articles are separate works. |
| neg-nngroup | single | 2 | false | – |  | 49 | This is a complete article; the linked full report and related articles are separate works. |
| neg-nngroup | single | 3 | false | – |  | 49 | The article is presented as a complete piece; its report and related-article links are separate resources, not continuation pages. |
| neg-paulgraham | single | 1 | false | – |  | 1 | The extracted text appears to contain the complete essay, and the only listed link is to the site index. |
| neg-paulgraham | single | 2 | false | – |  | 1 | The page contains the complete essay, ending with acknowledgments, and links only to the site index. |
| neg-paulgraham | single | 3 | false | – |  | 1 | The page contains the essay from its opening through its acknowledgments, with no links to additional parts. |
| neg-python-howto | single | 1 | false | – |  | 25 | This is a complete Python HOWTO; the next and previous links lead to separate documentation pages. |
| neg-python-howto | single | 2 | false | – |  | 25 | This is a complete Python HOWTO; the next-page link goes to a separate HOWTO, not a continuation. |
| neg-python-howto | single | 3 | false | – |  | 25 | This is a complete standalone HOWTO; the next and previous links lead to separate documentation pages. |
| neg-ssc-index | single | 1 | false | – |  | 139 | This is a blog index page with multiple standalone posts; “Older posts” links to another index page, not a continuation of one work. |
| neg-ssc-index | single | 2 | false | – |  | 139 | This is a blog index page containing multiple separate posts, not one work split across pages. |
| neg-ssc-index | single | 3 | false | – |  | 139 | This is a blog index listing separate posts, and its pagination links to older or newer posts rather than pages of one work. |
| neg-ssc-moloch | single | 1 | false | – |  | 118 | The text is a complete standalone post; the linked Moloch post is a separate article, not another page of this piece. |
| neg-ssc-moloch | single | 2 | false | – |  | 118 | The full essay is contained on this page; the linked Moloch post is a separate article, not a continuation. |
| neg-ssc-moloch | single | 3 | false | – |  | 118 | The long article appears complete, and the linked Moloch post is a separate work rather than a continuation. |
| neg-wbw-ai | either | 1 | true | 1/1 |  | 48 | The text explicitly says this is Part 1 and links to Part 2 of the same post. |
| neg-wbw-ai | either | 2 | true | 1/1 |  | 48 | The text explicitly says it was broken into two parts and links to Part 2. |
| neg-wbw-ai | either | 3 | true | 1/1 |  | 48 | The text explicitly says this is Part 1 and links to Part 2 of the same post. |
| neg-wikipedia | single | 1 | false | – |  | 250 | This is a complete Wikipedia article on one page, with no links indicating that it continues elsewhere. |
| neg-wikipedia | single | 2 | false | – |  | 250 | This is a complete Wikipedia article, not a piece split across multiple pages. |
| neg-wikipedia | single | 3 | false | – |  | 250 | This is a complete Wikipedia article on one page, with no links to split-off parts. |
| progit | either | 1 | true | 1/1 | /book/en/v2/Getting-Started-What-is-Git%3F /book/en/v2/Getting-Started-The-Command-Line /book/en/v2/Getting-Started-Installing-Git /book/en/v2/Getting-Started-First-Time-Git-Setup +2 | 146 | This is the opening section of the book’s Getting Started chapter, whose remaining sections are linked as parts of the same chapter. |
| progit | either | 2 | false | 0/1 |  | 146 | This page contains the complete “About Version Control” section; the linked pages are other sections of the book, not continuations of this section. |
| progit | either | 3 | true | 1/1 | /book/en/v2/Getting-Started-What-is-Git%3F /book/en/v2/Getting-Started-The-Command-Line /book/en/v2/Getting-Started-Installing-Git /book/en/v2/Getting-Started-First-Time-Git-Setup +2 | 146 | This is the opening section of the Getting Started chapter, whose remaining sections through Summary are linked separately. |
| realhw-ryzen | multi | 1 | true | 16/16 |  | 64 | The numbered split-post navigation links to the remaining pages of this same review, through its closing statement. |
| realhw-ryzen | multi | 2 | true | 16/16 |  | 64 | The numbered navigation links to successive sections of this same review, split across pages 2–17. |
| realhw-ryzen | multi | 3 | true | 16/16 |  | 64 | The numbered split-post navigation links to the remaining pages of this review. |
| rust-book | either | 1 | true | 1/1 |  | 3 | This is the introduction to a chapter, and its next-page link leads to the chapter’s first section. |
| rust-book | either | 2 | true | 1/1 |  | 3 | This is the introduction to a chapter that continues on the linked installation page. |
| rust-book | either | 3 | true | 1/1 |  | 3 | This is the opening page of the book’s Getting Started chapter, and its next link leads to the chapter’s first section. |
| situational-awareness | multi | 1 | true | 8/8 |  | 9 | This introduction links to the numbered sections of the same report, which continues across those pages. |
| situational-awareness | multi | 2 | true | 8/8 |  | 9 | This introduction links to the numbered chapters and closing section of the same work. |
| situational-awareness | multi | 3 | true | 8/8 |  | 9 | This is the introduction to a single report whose numbered sections are linked as its chapters. |
| superdark | multi | 1 | true | 3/3 |  | 3 | This is the introduction to a work with separately linked chapters. |
| superdark | multi | 2 | true | 3/3 |  | 3 | This is the introduction to a single work, and its chapter navigation links to the work’s following chapters. |
| superdark | multi | 3 | true | 3/3 |  | 3 | This is the introduction to a work explicitly divided into linked chapters. |
| toms-hw | multi | 1 | true | 4/4 |  | 214 | The review is explicitly split into numbered pages, with links to its remaining sections. |
| toms-hw | multi | 2 | true | 4/4 |  | 214 | The review is explicitly divided into numbered pages, with links to pages 2 through 5. |
| toms-hw | multi | 3 | true | 4/4 |  | 214 | The review is explicitly paginated, with linked pages 2 through 5 covering parts of the same review. |
| wikibooks | either | 1 | true | 1/1 | /wiki/Haskell/Variables_and_functions /wiki/Haskell/Truth_values /wiki/Haskell/Type_basics /wiki/Haskell/Lists_and_tuples +3 | 62 | This is the setup chapter of the Haskell book, and it ends by directing readers to the next chapter in the same work. |
| wikibooks | either | 2 | true | 1/1 | /wiki/Haskell/Variables_and_functions /wiki/Haskell/Truth_values /wiki/Haskell/Type_basics /wiki/Haskell/Lists_and_tuples +3 | 62 | This is the opening chapter of a Wikibook and explicitly points readers to the next chapter; the linked chapters continue the same work. |
| wikibooks | either | 3 | false | 0/1 |  | 62 | This page is a complete setup chapter; it points readers to the next chapter of the book, not a continuation of this chapter. |
