# Search, semantic search, and chat

Three features grouped because they answer the same reader question — *where in here is the thing I
want?* — and because one of them is the feature we should be most careful about.

## Text search

Reference doc: `docs/reference/TOOL_SEARCH_TEXT.md`.

Plain client-side search across the rendered document, using Mark.js. Matches get a short context
snippet (30–50 characters) in the results list and a longer one (up to 500) in a hover tooltip. A
`type=semantic` URL parameter switches the same UI over to the model-backed endpoint described in
[highlighting.md](highlighting.md).

No AI in the basic path, and that is the right call. There is nothing to rebuild here beyond noting
two details worth copying when we get to it:

- **Two snippet lengths, not one.** Short in the list so the results stay scannable, long on hover
  so you can judge a hit without leaving the list. Cheap, and it is the difference between a results
  list you can skim and one you have to click through.
- **The same UI serves both literal and semantic search**, switched by a URL parameter. That is the
  right relationship between the two: one place to look for things, two ways of matching.

The Mark.js dependency is the part not to copy — see
[highlighting.md § The technical wall](highlighting.md#the-technical-wall-highlights-cant-overlap).
Search results are the third layer of marks over the same prose, and they will collide with
comments and any other highlight the moment both exist.

## Semantic search

The endpoint behind the criterion-highlighting tool, reused. Covered in
[highlighting.md](highlighting.md).

Worth noting for us: their semantic hits are addressed by **element id**, which is the same
contract as our [block ids](../block-ids.md). Every model-produced assertion in that app that
survived reload did so because it pointed at an id. That is one more piece of evidence for
[the one contract](../../../AGENTS.md).

## Chat: the one to be suspicious of

A full chat pane built on `@assistant-ui/react`, with login-gated multi-thread persistence and
streaming. The architecture was redesigned at least twice — `250605a_chat_database_integration`,
`250608a_simplify_chat_persistence`, `250629a_chat_architecture_database_first_redesign` — all of it
churn about *where the threads live*, none of it about whether the chat was any good.

That absence is itself the finding. There is no doc anywhere in that repo assessing whether the chat
pane helped anyone read better. A year of work, several persistence rewrites, and no evidence.

**This is our named anti-goal.** [vision.md § Anti-goals](../vision.md#anti-goals) opens with "a
chatbot with the article stuffed in the context window", and this is what that looks like when it is
built well: a good implementation of the wrong thing. A chat box beside an article invites the
reader to ask the document questions **instead of** reading it, which is precisely the substitution
[vision.md](../vision.md) exists to refuse.

### What we do instead, and why it's different

[comments.md](../comments.md) — select a passage, and the model explains **that passage**. The
differences are not cosmetic:

| | Their chat | Our comments |
|---|---|---|
| What you address | the whole document | a span you selected |
| Where the answer lives | a thread beside the text | anchored to the text, at the point of confusion |
| What it encourages | asking instead of reading | reading, and asking where you got stuck |
| Provenance | a conversation | a block id and a quote |

The scoping is the whole point. A question that has to be *about something you're looking at* can't
become a substitute for looking.

If chat ever does arrive here, the constraint to hold is that it must be **rooted in a selection**
and must cite block ids back. That keeps it on the augment side of the line — an interlocutor about
the passage, not an oracle about the article.

## Built, 2026-08-26

[../search.md](../search.md). Both details this file said were worth copying were copied:

- **Two snippet lengths, not one** — short in the row, longer on hover. And capped, so the hover
  card is enough to *judge* a hit and never enough to read it instead of the article.
- **The same UI serves both literal and semantic search.** One box, one results list, one kind of
  mark; a toggle says which matcher runs. The two meet in one file and nothing downstream of it
  knows which one ran.

The Mark.js dependency was not copied, as this file advised — though not for the reason it gave.
See [highlighting.md § Built](highlighting.md#built-2026-08-26-and-how-much-of-this-survived-contact).

## See also

- [../search.md](../search.md) — what got built from this
- [overview.md](overview.md) — the map to that codebase
- [../vision.md#anti-goals](../vision.md#anti-goals) — why chat is the one to be suspicious of
- [../comments.md](../comments.md) — what we built instead, and how it is scoped
- [highlighting.md](highlighting.md) — the semantic endpoint, and the overlapping-marks problem all three share
