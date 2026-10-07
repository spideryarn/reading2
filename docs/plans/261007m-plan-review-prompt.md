# Plan review: 261007m, five design-consistency follow-ups

You are reviewing a PLAN (read-only), in the Spideryarn repo at this worktree. Base commit: 2cb3f60a7
(HEAD). The candidate is one untracked file:
docs/plans/261007m-design-consistency-follow-ups-five-queued-items.md

Context: it builds five items left over by docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md
(see its § Left, and § What GPT Sol's plan review changed, R20). Start with the plan, then read the code it
names: src/web/modes/conversation/ConversationModes.tsx (resetting, onDelete), src/web/ChatPanel.tsx
(ChatListLoading, Composer near the DictationButton/LiveButton), src/web/BandWaiting.tsx,
src/web/OriginChat.tsx (AskInChatButton), src/web/GlossaryPanel.tsx and src/web/CitationsPanel.tsx at their
AskInChatButton callers, src/web/components/ui/button.tsx, src/web/DiagramPanel.tsx (.diag-step),
src/web/styles/diagram.css, quotes.css § the stepper, tokens.css (shadow tokens, both theme blocks),
and the six shadow sites the plan names. docs/project/loading-spinner.md and docs/project/controls.md.
Those files are a starting point, not a limit on scope.

Attack independently: is each change correct, is anything missed (other callers, other states, a theme
or width where it breaks), is a simpler version available, is any item wrong or not worth doing?
Specifically judge S4's `--shadow-strength` factor (calc inside rgb()/oklch() alpha) against
alternatives, and whether dark stays pixel-identical. And S3's trade-off (≈160x44 to 44x44).

Severity: P0 breaks readers or data; P1 wrong behaviour a reader would hit; P2 worth fixing; P3 nit.
Give each finding an ID (M1, M2, ...), the file/line, and the fix. End with a verdict line:
READY, READY WITH CHANGES, or NOT READY.

My own suspicions (worth less; spend most of the run elsewhere): S1 — after DELETE lands, `resetting`
goes idle before the fresh conversation is begun by an effect; is there a beat where "Fetching your
Learn conversation…" still shows? S2 — does `.gloss-btn` CSS fight shadcn's Button classes?
