Yes—but frame attachments as “bring a second text into this reading task,” not generic file chat.

### 1. Product fit

The strongest uses support Spideryarn’s aim of forming a richer internal representation:

- **Related paper, reply, or replication:** compare claims, evidence, methods, and disagreements while keeping article X primary. Strong fit.
- **Journal guidelines or a review rubric:** apply explicit criteria in Referee/Candidates while leaving the judgment to the reader. Strong fit.
- **The reader’s own draft:** find where article X supports, challenges, or complicates their thinking. Good fit, but highly sensitive and most liable to become a generic rewriting chatbot.
- **Appendix, supplement, or technical specification:** reconstruct methods without repeatedly switching documents. Good fit.

“Summarise this PDF” or arbitrary document QA should remain out of scope. Chat’s defence against the anti-goal is still that it routes readers back to inspectable prose ([vision.md](/var/tmp/spideryarn-worktrees/fbskpxw2-chat-attachments/docs/project/vision.md:17), [chat plan](/var/tmp/spideryarn-worktrees/fbskpxw2-chat-attachments/docs/plans/260826a-chat-mode.md:73)).

One important correction: shelf tools expose another article’s block IDs internally, but answers deliberately must **not** cite them because citation chips only resolve in the open article; the model names the other article instead ([chat-tools.ts](/var/tmp/spideryarn-worktrees/fbskpxw2-chat-attachments/src/chat-tools.ts:1491)). So option A currently has source attribution, not one-click passage provenance.

### 2. Build first

Build **A′: attach a shelf source**, initially in typed Chat only.

An afternoon-sized v1:

- Paperclip labelled **Add a source**.
- Choose one ready article from the shelf; offer **Upload a new source…** through the existing importer.
- State before upload: it becomes a shelf article, costs one slot, and a PDF may take minutes.
- Store the selected article on the thread and validate ownership server-side.
- Add an exact-slug scope to library search, then reuse `read_library_passage`.
- Show a persistent source chip linking to that article; require answers to name it.

Defer Live, Learn/Tutorial/Guide integration, multiple attachments, raw chat-only storage, OCR/images, native PDF parts, and automatic shelf cleanup. The most valuable follow-up is cross-article citation chips containing both slug and block ID.

### 3. Holes and mitigations

Necessary:

- **Outbound leakage:** the 256-character cap covers only query plus fragment; URL paths can still carry data up to the 2,048-character whole-URL cap. Disabling only `read_web_page` is also insufficient: OpenRouter web search is available every non-Guide round, and Spideryarn cannot see its query. Any feature advertised for private drafts must disable both outbound mechanisms, or implement a real allowlist.
- **Source separation:** answers must visibly distinguish article X, the attached source, the web, and inference. Otherwise the attachment weakens the provenance contract.
- **Ownership:** never accept a client/model-provided slug without checking that the current reader owns it and that it is the thread’s attached source.
- **No silent loss:** 40k characters may be a refusal limit, never truncation. “Ephemeral” is misleading if the file is retained for history; preserve the original or explicitly refuse it.
- **Lifecycle:** raw attachments would need privacy wording, export coverage, article/account deletion, attachment replacement/edit semantics, private-bucket storage, and safe filename/content-type handling.
- **Spend:** `search_article_meaning` already buys another model call, and every tool round resends context. Native C could make a 250-page PDF roughly 750k input tokens—about $1.50 cold on Sonnet or $3 on Opus before cache premiums—without any typed-chat allowance. It needs page/token/attachment limits and a per-reader spend fuse.

Nice later: malware scanning, thumbnails, attachment-only deletion, image understanding, and preserving web access through a proper allowlist rather than disabling it.

### Recommendation

Build shelf-linked sources first: an attachment should be a durable text the reader can open and read, selected from or added to the shelf, while chat searches bounded passages and keeps the current article visible. This enables comparison, integration, and refereeing without creating a second storage/privacy/export system or resending whole PDFs. Describe v1 honestly: one text-based source, possibly slow to ingest, costing a slot, attributed by linked title rather than exact passage. Do not build ephemeral or native attachments until confidential-file isolation and spend limits exist.

**Question for Greg:** Is the essential need “bring another source I’m willing to keep on my shelf into this conversation,” or “privately use a draft/guidelines file that I would never put on my shelf”? The former is an afternoon feature; the latter is a materially larger security and privacy product.