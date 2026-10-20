---
reports: spya-p88dcx
ending: shipped
comment: On dev. Metadata › Export has "Download your notes and conversations": one Markdown file of everything you wrote on the article, also in the zip. Each conversation's header has "Copy this conversation as Markdown", to paste into another AI.
---
# Export your own words, and a whole chat, as Markdown

Report `spya-p88dcx` (#648), a suggestion from Greg (`feedback-reporter.ts` exit 0, no addenda
when re-read before this note), filed from Sources on `tinbergen1963onethology-spya-ks84se`.
Overseer queue item `qi-xbeptfxf`. Plan:
[261020w](../plans/261020w-export-your-own-words-and-a-chat-as-markdown.md).

> Provide a way to export the user's input/content from an article.
>
> Also, provide a way to export the whole of a chat (in a nice machine-readable and ideally also
> human-readable format that could be pasted into another AI).

**Shipped**, built on the existing article export rather than beside it
([export.md § Your words, and one conversation, as Markdown](../project/export.md#your-words-and-one-conversation-as-markdown)):

- **your-words.md**, one Markdown file with a small front-matter header: your title, purpose and
  tags; your comments, notes, highlights and bookmarks in article order, each under its passage;
  your quiz answers with their marks; and every conversation. Downloaded from Metadata › Export,
  and inside the zip.
- **Copy this conversation as Markdown**, in the chat header: the whole open conversation on the
  clipboard, block ids kept as provenance, spoken answers' passages and web citations listed.

Markdown was the format chosen for both halves: plain to read, and what every chat model reads
natively. The strictly machine-readable form stays the zip's JSON (`chat.json`, `comments.json`).

Deferred, named in the plan and queued as `qi-mvraxwz4`: the reader's searches, glossary
look-ups, referee criteria and Sources claim checks in your-words.md (they are in the zip as JSON),
and block ids resolved to the passage text in a copied chat. Two small older bugs the code review
found nearby are `qi-sxzqbvxr`.
