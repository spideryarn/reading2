**Verdict: approve with changes.**

- **P1 · F1 — Skips real text within a paragraph.** [Plan:53](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/docs/plans/261006f-chat-mark-latest-line-without-references-or-markdown.md:53): `[spya-k3m9qt]\nThe answer is yes.` parses as one paragraph. Testing only its first line returns `undefined`, so [OriginChat:111](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/src/web/OriginChat.tsx:111) says “No answer yet.” Search successive lines within each node.

- **P2 · F2 — Code blocks need an explicit rule.** [Plan:50](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/docs/plans/261006f-chat-mark-latest-line-without-references-or-markdown.md:50) mentions `inlineCode`, omitting `code`. A code-only answer has no text children but is visibly rendered by [Cited:367](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/src/web/Cited.tsx:367). Include its value; otherwise the card can fall back to an older answer.

- **P2 · F3 — Remove unopened hints before extraction.** [recall-hint:81](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/src/recall-hint.ts:81) already supplies `answerAsSeen`. Verified: `<div>\nWhich games?\n\nHint: Chess and Go.` has a recognised hidden hint. The proposed HTML skipping makes that hint the preview. Learn’s current display gates limit exposure, but `summarise` still includes Learn threads.

- **P2 · F4 — Bound the tree walk.** [Cited:249](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/src/web/Cited.tsx:249) documents this exact failure class; [the existing test:401](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/tests/chat-markdown-render.test.tsx:401) covers it. I reproduced stack overflow with an unrestricted recursive flatten. Use an iterative walk or depth limit.

- **P3 · F5 — The reader inventory overstates usage.** [Plan:28](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/docs/plans/261006f-chat-mark-latest-line-without-references-or-markdown.md:28): browser code copies `lastLine`; it doesn’t derive it. The gutter tooltip uses a count ([BlockGutter:666](/var/tmp/spideryarn-worktrees/chat-mark-latest-line-plain/src/web/BlockGutter.tsx:666)), and `AskedQuestion` carries an unused preview.

The producer claim otherwise holds. The pure-module move is safe: `urls.ts` has no imports, and `fromMarkdown` already runs on both sides through `Cited.tsx` and `citable.ts`.

No existing assertion requires raw preview Markdown. Tables remain pipe text because this parser has no GFM extension; unfinished Markdown can retain markers. Links and long paragraphs introduce no evident correctness regression.

The shared parser helper is the simplest sound design; keep it and tighten these rules.