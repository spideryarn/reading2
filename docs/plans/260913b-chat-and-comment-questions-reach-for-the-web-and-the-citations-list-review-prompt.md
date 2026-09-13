# Review: a plan to make passage questions reach for the web, mark their sources, and read the citations list

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations, branch
worktree-fb3d-3f-chat-tools-web-and-citations. TypeScript + ESM, React client, Node server, OpenRouter
for model calls. A reading app: the article is split into blocks with stable ids (`spya-xxxxxx`), and
chat answers cite them.

## The candidate

Live pre-commit: base = current HEAD of this worktree; the one file under review is untracked:
`docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md`.
(Not durable — I will record the commit SHA here once it lands.)

Start with the plan, then the code it makes claims about: `src/converse.ts` (`SYSTEM`,
`helpSection`, `webSearchTool`, `WEB_LINKS`, the round loop around `withTools`), `src/chat-tools.ts`
(`CHAT_TOOLS`, `readGlossary`, `readArticleLinks`, `untrusted`, `runTool`), `src/web/ChatDialog.tsx`
(how the "?" press sends), `src/web/ChatPanel.tsx` (`.chat-sources`, `ToolStrip`),
`src/store/pg.ts § loadCitations`, `src/types.ts § CitedWork`. Background docs:
`docs/project/chat-tools.md`, `docs/project/comments.md`, `docs/project/citations.md`,
`docs/project/security-map.md`. This is where to begin, not the limit of scope.

## What it is meant to do

Two admin feedback reports (quoted in the plan). (1) A question asked about a passage — the gutter
"?" or a typed follow-up — was answered only from the article, when the reader wanted a broader,
web-informed answer; it must be unmistakable which claims came from the article (block ids) and which
from the web (links). (2) Add a chat tool that reads the article's stored citations list, so the
model can use it to aim web searches — "one more tool", not a centre of gravity.

The plan's central claim is a diagnosis: **nothing is missing on the wire** — both passage-question
paths already go through `converse`, which offers web search every round — so the fix is prompt
(a new search trigger + a provenance rule) plus a "From the web" heading, then a small read-only
tool. It must not break: the cached-prefix byte identity between help and ordinary turns; the rule
that `SYSTEM`, not `helpSection`, owns search encouragement; the "do not look up what a paragraph
plainly says" counter-pressure; the untrusted-fence conventions; and it must not edit a defence
(`isSlug`, URL caps, `fetchDocument`).

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, not even loopback, so anything needing Postgres or a local service will skip.

## Attack it

Independently, before you read my questions below. Above all: **is the diagnosis true?** Find any
path by which a passage question from the comments panel or the "?" reaches the model *without* web
search, or with a prompt that differs from what the plan says. Then: will the stage-1 prompt changes
plausibly change behaviour without making every question search; is the measurement design able to
tell a fix from a bigger hammer; is the stage-2 tool's shape (caps, fence, 404 handling, query) right,
and does anything in it touch a defence or leak across owners; is anything cheaper that gets most of
the value.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording where it is prose
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with a one-line verdict:
"proceed", "proceed with changes F…", or "stop: F…".

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether a typed follow-up on a help thread carries `help` (I believe it does not: `help` is read off
  the stored user row per turn).
- Whether the "never mix a web claim and an article claim in one sentence" rule will make answers
  stilted or push the model to drop block ids.
- Whether the citations tool's `why` field, being model-written from the article, needs the fence at
  all, and whether the tool should be hidden when Citations mode is off (it is behind the
  experimental switch, but chat is not).

Do not change any file.
