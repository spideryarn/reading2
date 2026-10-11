# Consultation: should Spideryarn's chat accept attachments (PDFs etc.)? — a design call, not a code review

You are advising, read-only. Do not edit files. Repo: Spideryarn, an AI-assisted reading app whose
vision (docs/project/vision.md) is "augments human cognition, doesn't replace it"; its anti-goals
start with "A chatbot with the article stuffed in the context window" (chat was built anyway, and
defended because every claim cites a block id of the article on screen — docs/plans/260826a-chat-mode.md).

## The request (from Greg, the owner, via the Feedback button, 2026-10-11)

> It would be nice if the various chat modes could accept attachments, PDFs, etc. There may be
> protections that you need to put in place to make this secure, or if you think it's a terrible
> idea (e.g. because of complexity/security/etc), push back.

## Facts established from the code (verify any you rely on)

- Chat surfaces: one route `POST /api/chat/:slug` (src/routes.ts streamChat) serves chat, learn,
  tutorial, explore, guide, candidates (referee), and Ask-in-chat. JSON body, 64 KiB cap, question
  4k chars (learn 20k). Live conversation is WebRTC straight to OpenAI (no server in the loop).
- Prompt (src/converse.ts buildConverseMessages): system; the whole article with a cache breakpoint;
  last 20 turns of history (text only — `recentHistory` maps m.text); final user message. Message
  content type is text-only (src/article-prompt.ts TextPart). Model Sonnet 5.5 ($2/$10 per M) via
  OpenRouter pinned to Anthropic; Opus when high-powered.
- Tools (src/chat-tools.ts, a listed DEFENCE in docs/project/security-map.md): search_article_*,
  search_library + read_library_passage (the reader's OTHER saved articles, whole shelf),
  read_web_page (arbitrary URL, query capped at 256 chars as an exfiltration limit),
  article_links/glossary/citations, reader_notes. Third-party text is fenced by `untrusted()`
  (src/untrusted-fence.ts); docs/project/chat-tools.md § Security says the fence is a mitigation, not
  a fix, and that a hostile page can trickle data out via read_web_page URLs. Nothing chat calls
  writes, deletes or spends.
- No per-reader allowance on typed chat spend; the only quota is ingest slots (Free 3 lifetime,
  Reader 20/month). Every model call is logged to ai_calls.
- Upload machinery already exists to make an ARTICLE from a file: PDF (pdf.js text layer pass 0,
  then gpt-6-luna transcription ~ $0.0014/page, minutes for a long PDF), HTML, and since today
  .txt/.md/.docx converted to HTML at the door (src/upload-convert.ts, mammoth, zip-bomb guard).
  50 MiB, 250 pages. Files stored in a private Supabase bucket, content-addressed. The gateway can
  already send `type:"file"` PDFs and `image_url` parts to models.
- An uploaded article costs one slot; a "minimal paper" (bulk import: title/authors/abstract only)
  costs 1/100 of a slot.
- Privacy page (src/web/PrivacyPage.tsx) lists what is kept; chat is kept and deleted with the
  article; export (docs/project/export.md) has an exhaustive table-coverage list. Principle 6: never
  lose what the reader gave us. Rule: a feature that falsifies a sentence on the privacy page is
  not done.

## The options as I see them

A. **Redirect to the shelf**: attaching = add the file to your shelf (exists), and chat already
   reads the shelf via search_library/read_library_passage, with block-id provenance. Possibly a
   tiny v1: an "attach" button in chat that runs the existing upload, then tells this conversation
   the new article's slug so the model reads it with read_library_passage. Reuses every defence,
   privacy already true. Cost: a slot each; PDFs take minutes before usable; clutters the shelf.
B. **Ephemeral text attachment**: extract text in-request (txt/md/docx via mammoth raw text, PDF
   via the free pdf.js text layer; no OCR, no images), cap (say 40k chars), fence with untrusted(),
   store with the message (new column or table) so history re-sends it, place below the article
   cache breakpoint with its own breakpoint. New storage, export coverage, privacy sentence,
   delete cascade. Risk: an injected ARTICLE can now steer read_web_page to trickle out the
   attached file (likely the reader's most sensitive text: an unpublished draft) — so maybe
   withhold read_web_page in a conversation with an attachment (a defence edit → Greg's call).
C. **Native PDF/image parts to Anthropic**: highest fidelity (figures, scans), ~3k tokens/page,
   re-sent each turn (cache helps), needs a spend cap that chat doesn't have, bytes in storage.

## What I want from you

1. Is this a good idea for THIS product, given the vision? What are the real use cases while
   reading article X (e.g. compare with my own draft; I'm refereeing and have the journal's
   guidelines; a related paper), and does each fit "help the reader form their own rich internal
   representation"?
2. Which option (or another) would you build first, and what is the afternoon-sized v1? Name what
   you'd defer.
3. The security/privacy/cost holes I've missed, and which mitigation is necessary vs nice.
4. Your recommendation in one paragraph, and the one question you'd put to Greg.

Be concrete and brief (under 900 words).
