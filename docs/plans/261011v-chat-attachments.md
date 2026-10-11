# Chat attachments: a second text, not a file in the context window

**Status:** planned, nothing built — awaiting Greg's answer to
[q-jzx20h](../user-feedback/questions/q-jzx20h.md). 2026-10-11.
**Why:** feedback report `spya-skpxw2` (#561, `SPIDERYARN-READING2-HA`), from Greg — proven an
admin's by `feedback-reporter.ts` (exit 0). Queue item `qi-ghnqkf5v`.

> It would be nice if the various chat modes could accept attachments, PDFs, etc. There may be
> protections that you need to put in place to make this secure, or if you think it's a terrible
> idea (e.g. because of complexity/security/etc), push back.
>
> — Greg, via Feedback, 2026-10-11 01:41 UTC

Advice taken while thinking, both read-only: Opus (product call) and GPT Sol
([consult prompt](261011v-chat-attachments-consult-prompt.md),
[Sol's answer](261011v-chat-attachments-consult-sol.md)). They agreed on the shape without seeing
each other's answers. Sol's review of this plan: [261011v-chat-attachments-plan-review-sol.md](261011v-chat-attachments-plan-review-sol.md).
Its verdict was *sound with fixes*. All eleven findings were checked against the code and folded
in below. The two that changed the plan:

- cross-article citation chips moved from deferred into v1, because without them the shape fails
  its own provenance argument;
- "no new defence" was wrong. A′ opens no new outbound channel, but it edits two listed defences.

## The push-back, in one paragraph

**Not a terrible idea, but only in one shape.** Chat here is defensible because it is grounded in
the article on screen and every claim carries a block id back into it
([260826a § Say the awkward thing first](260826a-chat-mode.md#say-the-awkward-thing-first)). That
plan already left attachments out for this reason: *"a panel that accepts arbitrary files is a
general chatbot that happens to be next to an article"*, worth revisiting *"for a specific need"*.
The specific need is real. Greg's own list of what reading deeply means includes *"seeing
connections, perhaps to your own work, being a referee for a journal"*
([vision.md § Deeply and efficiently](../project/vision.md#deeply-and-efficiently)). The good
uses all bring **a second text to hold against this one**:

- a related paper, a reply, or a replication
- the reader's own draft
- a journal's reviewing guidelines
- an appendix or supplement

What fails the vision is a file dropped into the context window with no way back to its passages:
"summarise this PDF" beside an article. That is the first anti-goal.

## The three shapes weighed

```
 A  attach = a shelf article        B  text in the conversation       C  raw PDF/image to the model
 ┌──────────┐  reads by tool   ┌───┐ ┌──────────┐ extracted text  ┌───┐ ┌──────────┐ every turn  ┌───┐
 │ shelf    │ ───────────────▶ │ M │ │ chat row │ ───────────────▶│ M │ │ bucket   │ ──────────▶ │ M │
 │ article  │  passage + id    └───┘ │ + file   │ fenced, re-sent └───┘ │ object   │ ~3-5k tok/pg └───┘
 └──────────┘                        └──────────┘                       └──────────┘
 storage, privacy, export,           new storage, export rows,          all of B, plus a spend
 delete, defences: all exist         delete cascade, privacy text       fuse chat does not have
```


- **A: an attachment is an article on the shelf, and the conversation is pointed at it.**
  - **What it reuses:**
    - the importer, `sanitize.ts`, and the private bucket;
    - delete, the reader's export, and the privacy page's existing sentences;
    - chat's existing `search_library` and `read_library_passage` tools, which already read the
      reader's other articles.
  - **Costs:** one article slot for each new file that imports successfully (failures are free,
    admins exempt; [billing.md](../project/billing.md#the-quota-and-the-one-thing-it-has-to-survive)).
    Picking an article already on the shelf is free. A PDF takes minutes before it can be read.
  - **What it lacks today:** a claim about another article may only name its title. Citation chips
    resolve only in the open article, so `read_library_passage` forbids citing another article's
    block ids ([`src/chat-tools.ts`](../../src/chat-tools.ts) § `readLibraryPassage`). That breaks
    principle 4, legible provenance, so **A′ below has to fix it, not defer it** (plan review
    finding 1).
- **B: the file's text kept only with the conversation.**
  - **What it needs:** extraction at send time, and a new column or table so later turns re-send
    the text.
  - **What it touches:** export coverage, the delete cascade, a new privacy sentence, and a
    refusal rather than a cut at the cap (principle 6).
  - **Provenance:** none. The text has no block ids, so every claim about it has no path back.
  - **Verdict:** declined as a general feature.
- **C: the PDF or image is sent to the model as is.**
  - **What it costs:** everything B costs, plus roughly 2,500–5,000 tokens a page, text and page
    image together, on every turn. That figure is unmeasured
    ([260826a-pdf-parsing-options.md](../research/260826a-pdf-parsing-options.md)). A 250-page PDF
    is of the order of a million input tokens, a few dollars cold on Sonnet.
  - **Typed chat has no per-reader spend cap;** only ingest slots are metered.
  - **Verdict:** declined until a chat spend fuse exists, and even then only for a figure or a
    screenshot.

**The simpler option passed over** is doing nothing beyond telling the reader that chat can
already search their shelf. That is true, but `search_library` searches every other unarchived
article by word stems. So "compare with the paper I just added" depends on the model choosing
words that are in it, and answers about it cannot be checked passage by passage. Pointing the
conversation at one article is the smallest change that makes the request work.

## The question that decides the build

Shelf articles are already private to their reader, so "shelf versus private" is not the
distinction (plan review finding 11). The real choice:

- **A′, an ordinary article attached as a source:** normal article lifecycle, and chat keeps its
  web access.
  - It opens **no new outbound channel**. The article is already reachable by `search_library`
    today.
  - It **does change existing defences**: an ownership-checked route in `src/routes.ts`, and a
    scope on chat's library tools in `src/chat-tools.ts`. Both are listed in
    [security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live).
    So an unattended agent may not build it without Greg's go-ahead.
- **B′, a file kept only with the conversation, with web access cut off:** a materially larger
  security and privacy product.
  1. A reader's unpublished draft, or a confidential manuscript under review, is the most
     valuable thing an injected page could try to leak.
  2. Chat has **two** outbound channels a hostile article could steer:
     - `read_web_page`, capped at 256 characters of query plus fragment and 2,048 characters of
       URL, so the path carries more than the query cap suggests;
     - OpenRouter's server-side web search, offered on every non-guide round, whose queries we
       cannot see.
     [chat-tools.md § Security](../project/chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)
     already says the cap stops bulk exfiltration and not a determined trickle.
  3. A conversation holding such a file needs both channels off, or a real allowlist. That is a
     defence edit, plus the whole lifecycle B needs.

## A′: what would be built (the recommendation)

The design converged on by Opus and Sol, with Sol's plan review folded in. Typed Chat only at
first. Not estimated until the upload return (point 3) and the citation work (point 6) are
scoped; it is more than a day.

1. **A source on the thread.**
   - A nullable `chat_threads.source_article_id`: a foreign key to the article, not its slug,
     because slugs can be reused and articles can change owner. Set with
     `source_attached_at`.
   - `ON DELETE SET NULL`. The old answers keep their text, and the chip says *source deleted*.
     A deleted source is never resolved again by a reused slug.
   - Ownership is checked when the source is attached **and on every turn that uses it**. After a
     transfer of ownership the source is unavailable, said so on the chip.
   - One source per conversation. It may be replaced or removed. Earlier answers keep what they
     said, and the change is ordered against a streaming answer the way an edit already is.
2. **Which article may be a source.**
   - Any ready article the reader owns, except the open one, which is already in the prompt; the
     picker leaves it out and the route refuses it.
   - An archived source stays readable through this conversation, with an *Archived* mark,
     consistent with direct links. It is never a silent "nothing found".
   - An article still importing cannot be picked yet.
3. **Adding one: the simplest v1.**
   - "Add a source" picks from the shelf.
   - "Upload a new file…" says the file becomes an article, costs a slot, and a PDF may take
     minutes. It then uses the existing upload flow, which navigates to `/add/upload/<id>`.
   - The reader comes back and picks the article once it is ready. Attaching automatically on
     publication, across navigation and failed or retried jobs, is deferred.
4. **The model is told about the source** in the per-turn user message, after the article's cache
   breakpoint. It is rebuilt each turn from the stored thread, never taken from the request, and
   sends, retries and edits all read it the same way. The source's title is written by its author,
   so it is fenced with `untrusted()`.
5. **Tool scope the model cannot choose.** `search_library` and `read_library_passage` gain a
   fixed `scope: "attached_source"` argument, resolved from the thread through `ToolContext`. The
   model never supplies the slug that decides what the scope is. Passages and titles from the
   source are fenced as untrusted, because a PDF the reader chose was still written by somebody
   else, and the injection scan does not read PDFs.
6. **Provenance, in v1:**
   - **Cross-article citations:** a chip carries the article and the block id, and pressing it
     opens that passage in the source.
   - **The system prompt** asks the model to keep the article, the source, the web and its own
     inference visibly apart. Wording follows [prompting-guide.md](../project/prompting-guide.md).
   - **A chip above the conversation** names the source and links to it, so what chat can read is
     always visible.
7. **Export.**
   - The reader's ZIP carries the new column automatically, because the bundle spreads the whole
     row. That records the reference, not the source's content.
   - The rollback export uses hand-written field lists ([export.md](../project/export.md)), so the
     column is added there with a round-trip test.
8. **Docs:**
   - [security-map.md](../project/security-map.md) and
     [chat-tools.md § Security](../project/chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)
     say what changed.
   - The stale `search_library` description ("literal") is corrected.

Tests, each seen red first where it is a guard:

- the route refuses another reader's article, the open article, and an importing one;
- ownership is re-checked per turn;
- scoped search returns only the source's passages;
- a source title written as an instruction arrives fenced;
- attaching or changing a source changes only the part of the prompt after the cache breakpoint;
- retry and edit read the source from the thread;
- delete and archive behave as described in point 2;
- the rollback export round-trips the column;
- one browser pass.

## Deferred, each to its own queue entry once Greg answers

- **A "reference" ingest:** stages 1–3 only, priced like a minimal paper, and usable from the
  pdf.js text layer while transcription finishes. Opus's idea. It is a price, so it is Greg's.
- **Attach automatically on publication** after an upload, rather than coming back to pick.
- **B′, the conversation-only file:** both outbound channels off or allowlisted, then storage,
  export, delete and privacy for a file that is not an article.
- **Other surfaces:** Learn, Tutorial, Explore, the guide, and Candidates. Live conversation is
  excluded, because it has no server in the loop.
- **Images and figures:** the screenshot-of-a-chart case. Needs C's spend fuse.
- **A per-reader spend fuse on typed chat:** independent of attachments, and recorded here so it is
  not lost.
