You are reviewing a short investigation-and-proposal doc, READ-ONLY. Do not edit any files.

The doc: docs/plans/260928b-pdf-chunk-too-big-for-one-request.md
The code it is about: src/pdf-read.ts (planChunks ~line 529, chunkFrom ~599, MAX_CHUNK_BYTES ~216, MAX_ENCODED_BYTES ~347, the encode+check ~824), src/models.ts (PDF_READER_MODEL), src/messages.ts (pdfChunkTooBig).
The spike scripts are in data/spike-pdf-big/*.mts, and the successful live run log is logs/tmux-jobs/pdfbig-spike-0509-3040544.log.

The conclusion I most want checked: "The failure is the context page (page 6, 20 MB) riding along with page 7's chunk; build A (raise MAX_ENCODED_BYTES to 45 MB, next to PDF_READER_MODEL) + B (drop a context page heavier than MAX_CHUNK_BYTES) now; defer C (strip big XObjects) and D (rasterise)."

The finding I would least like to be wrong about: that OpenAI (via OpenRouter, native file passthrough) accepts up to 50 MB per request, so 45 MB of base64 is safe — one live run at ~32 MB succeeded, which does not prove 45 MB. Is 45 the right number, or should it be lower? Also: does B's planner accounting (bytes = shared + marginal(previous)) interact badly with dropping the context — e.g. would the chunk after a heavy page now be mis-sized, or would dropping context break something else that assumes chunk.context is set whenever chunks.length > 0 (instructionFor, scoring, the checkpoint cache key)?

Please answer: (1) is the root cause right, traced in the code; (2) any factual error in the doc; (3) is the ranking and recommendation right, or would you pick differently and why; (4) risks in A or B the doc misses. Be concrete, cite file:line. Under 600 words.
