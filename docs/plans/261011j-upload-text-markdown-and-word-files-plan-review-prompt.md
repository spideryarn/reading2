You are reviewing a plan before it is built, in the Spideryarn repo (read AGENTS.md / CLAUDE.md for house rules). Read-only: do not edit files.

The plan: docs/plans/261011j-upload-text-markdown-and-word-files.md — accept .txt/.md/.docx uploads by converting them to HTML in stage 1 (`acquireUpload`, src/pipeline.ts) and storing them as an uploaded web page.

Read the plan, then the code it touches: src/uploads.ts, src/fetch.ts (`uploadedDocumentKind`, `classify`, `documentEvidence`), src/pipeline.ts § acquireUpload, scripts/stage.ts § ingestFile, src/store/blobs.ts § CONTENT_TYPE, src/web/UploadPicker.tsx, src/routes.ts around `uploadProblem` (~line 7200), supabase/config.toml's sources bucket, scripts/deploy-checks.ts § bucketDrift, and the precedent docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md. Also docs/project/security-map.md.

Questions I most want answered, beyond any defect you find:
1. Is "convert to HTML in stage 1, store as kind html" sound, or does anything downstream (export, feedback attachment, re-extraction/Refetch & rebuild for uploaded articles, injection-scan, masthead/metadata cameOffADisk, slug from filename, the CLI) break or mislead with a converted page?
2. The zip-bomb guard: fflate unzipSync with a filter on declared sizes, inflate into declared-size buffers, re-zip, hand to mammoth. Is fflate's behaviour as claimed (bounded by declared originalSize)? Any hole (central vs local header disagreement, ZIP64, data descriptors, stored entries)? Is there a simpler sound guard?
3. mammoth / @xmldom/xmldom: is internal-entity expansion (billion laughs) or any other XML amplification reachable? Is the external-file CVE handled by version alone?
4. The bucket allowlist change and the deploy: anything wrong with labelling .md and .txt PUTs as text/plain?
5. Anything the plan should cut (simpler) or is missing.

Write your findings as a numbered list, each with severity (high/medium/low), the evidence (file:line), and the fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
