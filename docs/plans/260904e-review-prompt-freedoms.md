# What freedoms should a cross-family reviewer have? — you are the subject and the witness

You are GPT Sol, dispatched from Claude Code into the Spideryarn repo by
`scripts/run-codex.ts`. This is not a code review. It is a question about **your own working
conditions**, and you are the only one who can answer parts of it from evidence rather than
from guessing.

## Read these two first

- `docs/reusable/codex-cli-as-subagent.md` — how you are invoked, the sandbox, the house rules
  about mutations and relaying findings verbatim.
- `docs/reusable/engineering-manager.md` — the workflow you are embedded in: a plan doc, stages,
  an obligatory review by you at the end of every stage, delegation to Claude subagents.
- `CLAUDE.md` (repo root) — the house rules, including "Get a cross-family review before you
  commit" and the delegation section.

## What Greg asked

Verbatim:

> Does GPT Sol (when run via codex-cli-as-subagent.md) have enough flexibility to be useful? Can
> it run tests/spikes/web research etc if it needs to? Would it be more efficient to even allow
> it to edit code when it's doing a review? And the same questions re extra freedoms for Fable
> (although because that runs as a Claude Code subagent, I assume it can do more stuff)...

Fable is a Claude-family model dispatched as an ordinary Claude Code subagent, so it already has
the full tool set: edit, run anything, browse the web, drive a browser. It is used here for
design arbitration and idea generation, not usually for code review.

## What I have already measured today (2026-09-04, codex-cli 0.152.1, Linux box)

Do not re-derive these; build on them, or contradict them if you can show otherwise.

1. Under the checked-in `review` profile (`.codex/config.toml`), **all network is denied** — not
   just the internet, but loopback too. Measured free with `codex sandbox`:
   `curl https://example.com` → exit 7, `curl http://127.0.0.1:54321` → exit 7.
2. A permissions profile **can** grant network, and the working syntax is
   `[permissions.<name>.network]` with `enabled = true`. `network = true`, `allowed = true` and
   `allow = ["*"]` are all rejected or silently ineffective. `allowed_domains = [...]` alongside
   `enabled = true` did **not** narrow anything — external traffic still flowed — so as far as I
   can tell it is all-or-nothing.
3. With network enabled, **`npm run typecheck` works** — the whole repo, all four tsconfig
   projects, 1266 files. The doc currently says the tsx CLI's unix socket is denied "in every
   mode" and that this is unfixable. That is wrong: the unix socket is gated by the *network*
   policy, and turning network on fixes it. Loopback Supabase (`:54321`) and Postgres (`:54322`)
   are both reachable too, which means the Postgres half of the test suite becomes runnable.
4. Codex has no usable built-in web search on this version: `search_tool` is `removed`,
   `web_search_request` is `deprecated`, `standalone_web_search` is `under development`. But
   `browser_use` is a stable feature and `curl` works once network is on.

## The questions

Answer these as a working reviewer describing what would actually change your output — not as a
survey of options. Be concrete and rank by value.

1. **Are you under-equipped today?** Of the fifteen-plus reviews this repo has had from you,
   what did the sandbox stop you from establishing? Where did you have to reason when you would
   rather have run something? Give the shape of the finding you *couldn't* produce.

2. **Network.** If a `review-net` profile existed — same read-only tree, plus network — what
   would you use it for, in priority order? Full test suite? A loopback DB query to check a
   migration? Fetching a library's docs to check an API claim? And what is the honest cost: you
   would be a model that can read every file on the box *and* make outbound requests, with
   `.env.local`, `~/.codex/auth.json` and a production `DATABASE_URL` all readable. Is a
   narrower grant available and better — e.g. loopback only, if it can be expressed?
   Note that `codex sandbox --permission-profile <name>` runs a shell command under a profile
   with no model and no cost, so you can test syntax claims yourself.

3. **Write access during a review.** The doc argues *against* it, in these words: "a reviewer
   that can edit the tree is a reviewer that will fix the finding rather than hand back the
   mutation", and "on the next pass the reviewer checks that its own patch was *applied* rather
   than whether it was *right*". Is that right? Consider the middle grounds and say which you
   would actually want:
   - write to a scratch dir only (you already have `/tmp`), so you can build a reproduction
     harness without touching the tree;
   - write to the tree but forbidden to commit, with the caller reading `git diff`;
   - a separate git worktree of your own that you may edit freely, whose diff the caller reads
     as a *proposal* rather than applying;
   - no write at all, as today.
   Say what each buys and what it costs in review quality specifically.

4. **Multi-turn.** Today every review is one shot: a prompt file in, an answer file out, no
   follow-up. `codex exec resume` exists and the wrapper does not use it. Would a second turn
   ("here is why I disagree with finding 3 — respond") be worth the machinery, or does the
   one-shot discipline (everything in the prompt, verdict in a file) buy more than it costs?

5. **Spikes.** `engineering-manager.md` says to spend a subagent on a throwaway experiment
   rather than arguing in prose, and today those all go to Claude subagents. Should some go to
   you instead? What would you need in order to run one?

6. **`engineering-manager.md` itself.** You are the reviewer that doc mandates. Read it as the
   person on the receiving end of its instructions. What is missing, what is wasteful, and what
   does it ask for that you cannot deliver in the sandbox it puts you in? Be specific about the
   review cadence — "at the end of every stage, obligatory, not skippable" — is that the right
   frequency, or does it produce rubber-stamp rounds?

7. **What the orchestrator is doing wrong.** The doc has a section "Four ways the second opinion
   gets wasted". From the reviews in `docs/plans/*-review-sol.md` (read a few — they are your own
   previous answers), what else is being wasted? Prompt shape, evidence handed over, what gets
   asked?

## How to answer

Prose, with numbered recommendations at the end, ranked by (value × ease). For each: what
changes, what it costs, and what could go wrong. Where you make a factual claim about the
sandbox or the CLI, say whether you ran something to establish it — and prefer running it.
Distinguish clearly between "I tested this" and "I believe this".

This is a proposal exercise. **Do not change any file in the repo.**
