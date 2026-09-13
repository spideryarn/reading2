# Review: Stages 1 and 2 — passage questions reach for the web, every claim says where it came from, and chat can read the citations list

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations, branch
worktree-fb3d-3f-chat-tools-web-and-citations. TypeScript + ESM, React client, Node server, OpenRouter
for model calls. A reading app: the article is split into blocks with stable ids (`spya-xxxxxx`), and
chat answers cite them.

## The candidate

Committed: four commits, in order — `ae260da5` (Stage 1), `713fcc99` (Stage 2), `90f86c5e`
(Stage 1's first follow-up after the measurement: background knowledge as an origin), `d861f4df`
(the second: `provenanceLine`, a one-line reminder in the final user message). `git diff
aed9d820..d861f4df` is the whole candidate; `aed9d820` is the plan commit before it.
`git show --stat <sha>` for each prints the complete list of changed paths. One review covers both
stages, because a write-capable reviewer per stage would edit `src/converse.ts` and
`src/web/ChatPanel.tsx` in the same tree at once.

Start with: `src/converse.ts` (`SYSTEM`, `WEB_LINKS`, `helpSection`, `provenanceLine`,
`buildConverseMessages`), `src/chat-tools.ts`
(`article_citations`, `citationRows`, `citationsResult`, `readCitations`), `src/web/ChatPanel.tsx`
(`WebSources`, `ToolIcon`), and the tests in the commits. This is where to begin, not the limit — the
commits' path lists are.

## What it is meant to do

The plan is `docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md`,
and your own plan review is beside it (`…-review-sol.md`); its findings F1–F11 were all accepted and
its § Progress says where each went.

**Stage 1.** A question about a passage — the gutter "?" or a typed follow-up — should reach for the
web when the reader wants a broader sense of how the passage sits in the world, and every claim in the
answer should be marked with where it came from (article → block id; web → link; reader's library →
named article; the model's own inference → said so; no unlinked factual memory). A "From the web"
label sits over the sources list, only when there is at least one web source. Invariants:
`helpSection` byte-for-byte unchanged; the cached prefix byte-identical between help and ordinary
turns; the existing search encouragement and the "what a paragraph plainly says" counter-pressure
unchanged.

**Stage 2.** `article_citations`, an eighth chat tool: reads the stored citations list and never
makes one; only a 404 means "no list"; a stale list shows no rows; outdated is announced; a capped list
is counted as the stored list, never the article's total; a bibliography-only work cites its reference
block; rows fenced with `untrusted()`, our sentences outside; available in Chat, Remember, Candidates
and Live deliberately. It must not touch `isSlug`, `read_web_page`, the URL caps or `fetchDocument`
(defences, `docs/project/security-map.md`).

**Measured result** — see the plan's § Progress for the full table. Web searches out of three runs,
before → after, on two articles: "how does this fit the wider debate?" 0/3, 0/3 → 2/3, 3/3 (pass);
bare "?" press 0/3, 0/3 → 0/3, 1/3 (missed the threshold); controls 0 before and after (pass); links
in the text of "what has happened since?" answers 1 in 6 → 6 in 6. The "?" miss was arbitrated by
Fable and kept as measured (the threshold was wrong: the "?" and the plain-meaning control share one
passage, so a trigger separating them would pull the control in). Fable also found that every "?"
answer stated recalled background unmarked, and one searched twice and linked nothing — so
`90f86c5e` adds background knowledge as an origin, and **partly overrules your F3**: specific
checkable claims must still be linked or called unverified, but well-known background may be stated
from memory if the sentence says it is not from the article. The plan's § Progress has the
reasoning; judge it. **And a hand-read of the first after-run failed the provenance criterion**:
of 12 answers that searched, 2 fully pass; every "?" answer states specific facts from memory
unmarked; "My inference" and "unverified" appear in none of the 30 answers. So the claim *"an answer
cannot present a web or remembered fact as if it came from the article"* is, on that evidence, not
yet true — tell me whether what is in the tree now can make it true, and if a prompt cannot, what the
smallest mechanism is. A re-run of `90f86c5e` (`evals/results/chat-web-reach-after-background-*.json`)
moved answers that mark something as not from the article to 3 / 6 on "?" turns and 3 / 6 on "wider
debate" — half. So `d861f4df` adds `provenanceLine` (Fable's recommendation; the alternatives it
weighed are in the plan's § Progress), and its three-run eval is running as you read this, landing
under `evals/results/chat-web-reach-after-reminder-*.json`. Judge whether the line is placed and worded
so it can work, and whether it breaks anything the help and cache tests are there to hold.

On the way, `tests/chat-web-links-prompt.test.ts` turned out to have been red since `ae260da5` — the
new section names LINKING TO THE WEB before the heading, and the test's `indexOf` found the mention.
Fixed in `d861f4df` by anchoring on the heading; check that fix still proves what it was for.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside these two stages — each finding red-first, with the
test that reproduces it — and leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

/tmp and the node_modules caches are writable. You can run one test file at a time
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, not even loopback: the eval makes live model calls and cannot run in your sandbox — its raw
results are the JSON files under `evals/results/chat-web-reach-*`. The full suite I run myself —
it is running now against these commits, and I will re-run anything your fixes touch.

## Attack it

Independently, before you read my questions below. The claims to break:

1. **The prompt now makes a broader-context question about a passage search the web without making
   ordinary passage questions search, and an answer cannot present a web or remembered fact as if it
   came from the article.** Read the prompt as the model will. Look for contradictions between the new
   section and the rest of `SYSTEM`, `WEB_LINKS`, `NO_UNRUN_TOOL_CLAIMS`, `PROFILE_RULES` and
   `REMEMBER_SYSTEM` (which shares `WEB_LINKS`); for anything that pushes the model to drop block ids;
   for a rendering path where the heading can lie; and for whether the measurement supports the claim.
2. **`article_citations` never tells the model something false about the list** — a count, an
   absence, a location, a link's provenance — and never lets a publisher's or a model's words out of
   the fence. Try: a 404 that is not the store's 404; a list whose every row exceeds the character
   cap; a `query` of whitespace; a work with `citedInBody` true and `citedAt` empty; a `why` holding
   the fence's own delimiter; the stale branch when the list is also capped.

For each finding give:
  - an ID — **numbered from F12 upwards**, since F1–F11 were used by the plan review
  - a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input or mutation I can run that shows it fails its own claim
  - (b) the smallest change that closes it — a code block or exact replacement wording
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with a one-line verdict:
"land", "land after my fixes F…", or "stop: F…".

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether "no unlinked factual memory" is enforceable by a prompt at all, or whether it will just
  make the model hedge everything it knows.
- Whether the `WEB_LINKS` rewording changes Remember answers in a way nobody measured.
- Whether `citationRows`' character cap can let one enormous first row through (the `article_links`
  bug the chat-tools.md doc describes), since the first row is always admitted.
