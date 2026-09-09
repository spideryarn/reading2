# A team box for a separate product, and one Overseer that carries each person's authority

**Status:** proposed, 2026-09-09. **Not to be built until the Overseer dispatches it** — Greg:
*"Don't implement - wait for instructions from the Overseer."* The research behind it, with GPT 6
Astra's review, is
[260909b](../research/260909b-a-shared-team-box-with-one-overseer-several-people-and-several-claude-accounts.md);
this plan is what changed once Greg answered its questions, and what we would build. **GPT Sol
reviewed it the same night** ([260909i-plan-review-sol.md](260909i-plan-review-sol.md)): no P0,
five P1s, all accepted — § Round 1 review says what each changed.

**It depends on [260909h](260909h-a-reusable-top-level-folder-that-can-become-its-own-repo.md)**,
the extraction of the Overseer, the dashboard and `gjd-remote` into their own repo, which Greg has
also held. Everything below is a change to *that* code, for *that* box; nothing here touches
Spideryarn's box, its readers or its production. Building it before the split lands would put every
edit in the way of the move, which is one reason the Overseer holds the dispatch.

## Greg's words

The question, 2026-09-09:

> I'm contemplating renting a much bigger remote box, and making it available to my whole team.
> Perhaps we'd all share the same Overseer? There might be multiple Claude accounts. … Would we
> restrict it so that any accounts they set up use only their Claude account-subscriptions? Can
> they view/edit other agents that other people set up? … Shared Overseer or one per person?

And his answers to the research doc's questions, same day, numbered as they were asked:

> 1 This will actually be a separate team, box, and product than Spideryarn, which is why another
> agent is working on separating out the reusable stuff from the Spideryarn-specific stuff.
>
> 2 I think probably we want to know who said what, and it seems conceptually simpler to say that
> each person can only control their own agents. But then how would that work if everyone can talk
> to the Overseer... I could just tell it to deploy using someone else's agents... this feels
> confusing. Can you see a clean approach?
>
> 3 Yeah, perhaps either, if it doesn't add too much complexity. The web dashboard will probably be
> primary.
>
> 4 Personal probably. Yes, this relates to 2... Dunno
>
> 5 Use queue priority
>
> 6 Every task through Overseer, I'm thinking. Though the issues with multiple agents controlled by
> multiple people make me wonder if there's one Overseer per person (which oversees just that
> person's agents), and perhaps also an overall Overseer? Though that sounds more complicated and
> less appealing.
>
> 7, 8 Don't know yet

Questions 7 and 8 were: how much intervention in each other's work feels helpful, and who is admin
and who operates the box when Greg is away. They stay open, in § Still Greg's, below.

## What this is for, in plain words

A second team, on a second product, gets its own rented box, running the same machinery this repo
built for Spideryarn: agents in tmux, a web dashboard, an Overseer that keeps them moving. Several
people use it at once, each with their own Claude subscription. Greg wants to know who did what, and
wants the simple rule that **you control your own agents and nobody else's** — but everybody talks
to the same Overseer, and he could not see how that rule survives the Overseer being asked to do
something to somebody else's agents.

The clean approach is one sentence: **the Overseer never has more authority than the person asking
it, plus a short fixed list of box-keeping powers it applies to everyone alike.**

## Jargon, once

| Word | What it means here |
|---|---|
| **person** | a human on the team, identified by their Tailscale login (which is their Google sign-in). The code will spell this `Person`; today it spells it `"greg"` |
| **task** | one piece of work in the queue, with an owner. Agents belong to tasks |
| **owner** | the person a task belongs to. Owner authority is the right to steer, stop, redirect and hand over that task's agents, and to spend the owner's accounts on them |
| **operator authority** | a short list of box-keeping actions that never change what a task *does*: pause or resume for load, compact, kill a wedged shell, close out a finished agent. Uniform across everyone's agents, always logged |
| **product authority** | anything that outlives a branch — a schema, a prompt, a published sentence, a deploy. The product owner's; never the Overseer's ([overseer.md gate 3](../project/overseer.md#3-never-the-irreversible-and-never-work-of-your-own-devising)) |
| **account** | one Claude or ChatGPT subscription, with an owner. [260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md) is the registry |
| **inbox** | a person's view of what needs them: their agents' questions, proposals addressed to them, decisions taken on their tasks to review |

## The authority model, which is the whole design

```
   who asks         what of                 whose authority is needed      result
   ───────────────  ──────────────────────  ────────────────────────────  ─────────────────────────
   Alice ──▶ Ovsr   steer Alice's agent     Alice's (owner)                done, stamped "alice via overseer"
   Alice ──▶ Ovsr   steer Bob's agent       Bob's (owner)                  refused → a PROPOSAL in Bob's inbox
   Alice ──▶ Ovsr   deploy, using anyone    product owner's               refused, gate 3 → a proposal to the product owner
   policy ─▶ Ovsr   pause everyone at load  operator (its own)             done, uniformly, logged
   Bob ────▶ Ovsr   hand task T to Alice    Bob's (owner)                  done; Alice now owns T
```

The rules, each one a line a program can check. **An action needs a *set* of grants, not a
class** — Sol's first finding, and it changed rules 4 and 5: "deploy Alice's task" needs the
product owner's grant *and* Alice's, and "pause Bob" is operator authority only when a standing
policy is the reason. So every request the Overseer handles is an envelope: *who asked, what
task, which action, which grants that action requires, which policy if any*. The Overseer holds
the asker's grants and its own policy grants, and the action goes ahead only if the required set
is covered.

1. **Anyone may originate a task they will own.** Creating and dispatching an investigation is
   neither owner, operator nor product authority — Sol's gap between the classes — so it is its own
   grant: every person has it, for work at their own priority, within the queue's caps. The task's
   owner is its author. What priority they may claim is § Still Greg's.

2. **Authority lives in the task, not in the agent and not in the Overseer.** Every task has one
   owner and an **ownership version** that increments on every hand-over. An agent's owner is its
   task's owner. Ownership moves only by the owner handing it over (or adding a helper, if § Still
   Greg's decides helpers exist), or by the administrator reassigning an orphaned task with an
   audit record. **Every queued effect carries the `taskId` and is re-checked against the current
   owner at delivery, not only when it was queued** — otherwise Bob's message, queued before he
   handed the task to Alice, still lands in Alice's agent under Bob's authority.
3. **A person acting directly** — from the dashboard, or from `gjd-remote` — may act on their own
   tasks. On anyone else's, the dashboard shows the row and refuses the write. *See all, steer own.*
4. **The Overseer acting for a person carries that person's grants and nothing more.** When
   Alice tells it something, it evaluates the request as Alice: her tasks, her accounts. What Alice
   could not do herself, the Overseer cannot do for her. It does not hold a pool of everyone's
   authority to be spent on request. **Free text always requires the target task's owner grant**:
   a sentence typed into an agent is not classifiable, so it is never an operator action however it
   is worded.
5. **The Overseer's own grants are the operator list, each tied to a standing policy, and uniform.**
   Under a named policy it may pause, resume, compact, kill a wedged shell, close out a finished
   agent, remove a checked worktree — for anyone's agents, the same way, and logged with the policy
   id. The same verb without a policy behind it ("pause Bob so my task runs first") is an owner
   request on Bob's task and is refused into a proposal. **Holds have causes**: an operator hold for
   load and an owner's own pause are two holds on one agent, and lifting one does not lift the
   other.
6. **Product authority is never the Overseer's**, whoever asks. Gate 3 already says so; a team
   changes nothing here except that "Greg" becomes "the product owner", which for this product is
   Greg unless he delegates.
7. **A refusal is a proposal, not a dead end.** What the Overseer cannot do for Alice it can *put to
   the person who can*: a message in Bob's inbox, or the product owner's. Bob accepting makes it
   Bob's request, with Bob's authority. That is the whole hand-over mechanism and it is the same
   shape the Overseer already uses for Greg's vetoes.

**Why this dissolves Greg's confusion.** "I could just tell it to deploy using someone else's
agents" fails twice, mechanically: deploying needs product authority the Overseer never has (rule 6),
and someone else's agents need their owner's grant, which the asker does not carry (rule 4). The
Overseer does not have to *judge* who is allowed what; it looks up the task's owner and the action's
required grants and the answer falls out. Astra's version of the same principle: *"relaying through the
Overseer must not increase the requester's authority."*

**When the owner is not there.** An owner asleep for a week, or gone from the team, would block
every proposal and be the only person able to hand over. So a task has an explicit
**owner-unavailable** state: the Overseer's operator grants still apply (it can safe-stop the
agents: commit, push, pause), nothing else proceeds, and the **administrator** (answer 8, still
open) may reassign it with an audit record. Abandoned work never defaults silently to Greg.

**Why one Overseer and not one per person — and where Greg's instinct was half right.** A per-person Overseer is what you build when authority
lives *in the Overseer*, so that each person's is small. Under rules 4 and 5 the one Overseer is
already "Alice's Overseer" when Alice is talking to it: it wears her authority and no one else's.
What is genuinely shared — load, the test-suite cap, file-set overlap, one page for the phone — must
be one process anyway, because two of them pause and resume each other's work.

But Sol separated two things the word "Overseer" runs together, and the split matters. **One
operational coordinator** is settled: the daemon and its store, deterministic, box-wide. **One
model conversation is not**: today the Overseer is one long-lived context, and per-person views do
nothing to stop Alice's corrections and preferences colouring what it says to Bob. So the shape is
one coordinator with **one conversation thread per person** (or per task) feeding it, each carrying
its own envelope — which is Greg's "one Overseer per person, plus an overall one" after all, as
*conversations* rather than as *authorities*. The two-tier version he found *"more complicated and
less appealing"* is right to reject as two coordinators, and right to keep as threads.

**And it settles question 4 with question 2.** If only Alice (or the Overseer as Alice) can steer
Alice's agents, then only Alice's accounts are ever spent by them. "Personal accounts" and "control
only your own agents" are one rule, not two in tension. The exception is the Overseer's own
sessions, which need an account with an owner — § Still Greg's.

## What changes because it is a separate box and product

The research doc assumed colleagues joining Spideryarn's box. Greg's answer 1 removes most of its
hard parts:

- **No backwards compatibility.** `Speaker = "greg" | "overseer" | "dashboard"`,
  `QueueActor`, `DecisionWireActor` and the decision fold that counts only Greg's reviews can become
  `Person`-typed in the extracted code without a migration, because the new box starts empty.
- **No production to protect on day one**, so the production boundary is a design rule rather than
  a retrofit: **the deploy credential never lives on the box**, the box's git credential cannot
  write the production branch, and deploying stays a human act from a machine that holds the
  credential. Cheap to keep when there is nothing to move.
- **No shared memory to preserve.** The 83 auto-memory files that pushed 260909g towards shared
  `projects/` are Spideryarn's agents'. A fresh box starts with none, so per-account config dirs
  with a shared `projects/` is the right mechanism here too but for a simpler reason: one memory per
  repo, whoever's account the session is on.
- **The Unix user is not `greg`.** Provision it as a neutral service user. Still one user for
  everybody (Astra and the research doc agree separate users are for a real isolation requirement,
  which a trusted team on one product does not have), but the name should not claim an identity the
  processes do not have.
- **Rent modest, not "much bigger".** The existing design already makes resizing cheap — *the
  server is disposable and the volume is not* ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#the-shape-in-one-paragraph)).
  Astra: size from measured peak memory and concurrent heavy jobs, not from headcount times thirty.
  Start with something like today's box and grow it after a fortnight of real use.
- **The trial is the launch.** There is no existing box to trial on, so the first fortnight with
  two colleagues *is* the trial, and the success measures are Astra's: could they work without Greg
  at a terminal, did hand-overs save time, did "whose account" stay answerable, did Greg coordinate
  less.

## Identity: the dashboard is primary, so Tailscale is the login

Each person is invited as a **Tailscale user** (they sign in with Google). The dashboard binds
loopback and is published with `tailscale serve`, which stamps `Tailscale-User-Login` on every
request and strips any spoofed copy. That header is the `Person`. It is the mechanism the direction
doc already prescribes as the precondition for widening the bind
([overseer-direction.md § A5](../project/overseer-direction.md#the-backlog-after-the-wide-review)),
and it is Google SSO in effect with no login page, cookie or CSRF work of our own.

- **The header is checked against an allowlist of active people, on every route.** Tailscale's
  own docs say an external user given a shared device receives valid identity headers, so a
  well-formed login is not membership; the people registry is. And **reads and streams are
  authenticated too, not only writes** — `/api/live`, `/api/state`, the recent-messages feed, the
  queue and the decisions are unauthenticated reads today (`server.ts`), and they carry
  transcripts. Funnel stays off. Sol's fifth finding, both halves.
- **A request without the header fails closed.** Tagged devices and ssh forwards carry none; a
  missing identity is *unknown*, never the product owner. A loopback caller can forge the header,
  which Tailscale acknowledges: on one shared Unix user this is enforcement on the supported remote
  routes, and the next bullet says so.
- **`gjd-remote` from a laptop** is the secondary route (Greg's answer 3: either, if cheap). One
  `authorized_keys` line per person carrying `environment="GJD_PRINCIPAL=<login>"`, enabled with
  the **narrow pattern form `PermitUserEnvironment GJD_PRINCIPAL`** rather than `yes` — `yes` also
  enables the shared user's `~/.ssh/environment` and arbitrary variables such as `LD_PRELOAD`,
  which OpenSSH's own man page warns about — with the key file root-owned. The box-side launcher
  writes it into the session's tmux metadata
  beside `CLAUDE_SESSION_ID` and the account. It is not inherited automatically — a tmux session
  gets the tmux server's environment, not the ssh session's.
- **It is attribution, not a boundary.** Everyone is one Unix user; a colleague's agent can read
  anything on the box. The team is told that in writing before they join.

## Accounts: personal, owned, chosen by the task

Extends the 260909g registry with an `owner` per account. At launch, `--account auto` chooses only
among the **task owner's** accounts. There is no unflagged fallback to anybody's account: a launch
whose principal has no registered account is refused with the sentence that says so. Codex accounts
follow the same rule with `CODEX_HOME` per account, once OpenAI's concurrency caveat on shared auth
files is resolved. Pooling (an owner marking an account `shared`) is not built until somebody asks.

**The payer is fixed per execution and is not the owner** — Sol's fourth finding. A running
session keeps spending the account it was launched on; ownership can move, the payer cannot. So a
hand-over either keeps the old payer with their explicit consent, or safe-stops and relaunches
under the new owner's account. Every child of a session — the Codex review a stage ends in, a
`claude --resume` after a reboot, a helper's launch — inherits `{taskId, accountId, payer grant
version}` from its parent and refuses to start if any is missing. A task whose owner has Claude
capacity but no permitted Codex account cannot finish a stage, so the launcher checks *both*
families are reachable before dispatching. And the Overseer's own coordination, recovery and review
sessions need a **reserved account with an owner** before Stage 2 can be built, not after — it
moves from § Still Greg's to the first question there.

## The queue: every task through the Overseer, ordered by priority

Greg's answers 5 and 6. A new task is a queue item with an owner (the author) and a priority. The
Overseer dispatches by priority, then by age, within the box's caps. Direct steering of one's own
agents from the dashboard **stays available** as the fallback for when the Overseer is paused or its
account is exhausted — "every task through the Overseer" is about how work *starts*, not a ban on a
person talking to their own agent. Who may set a priority above their own items is in § Still
Greg's.

## The stages, when the Overseer dispatches them

Each ends in a GPT Sol review and a commit, per the house workflow. None starts before
[260909h](260909h-a-reusable-top-level-folder-that-can-become-its-own-repo.md) Stage 2 has landed
the code in its own repo, and none touches the Spideryarn box. **Ordered around invariants rather
than fields**, after Sol's P2: each stage makes one thing true that the next relies on, and the
first one is decisions, not code.

- **Stage 0 — the decisions.** Everything in § Still Greg's that Stages 2 and 4 depend on:
  the Overseer's reserved account, who sets priority, the administrator, helpers or hand-over
  only. Written into this plan before anything is built.
- **Stage 1 — people and authentication, on every route.** A people registry (the allowlist);
  one middleware that reads `Tailscale-User-Login`, maps it to a `Person`, and fails closed on
  every read, stream and write; `Speaker`, `QueueActor` and `DecisionWireActor` become
  `Person`-typed. Nothing about tasks yet.
- **Stage 2 — durable tasks.** A task record with owner, ownership version, priority, state
  (including owner-unavailable); `taskId` on sessions (tmux metadata), queue items, steering
  envelopes and decisions, joined rather than copied; delivery-time re-check of ownership.
- **Stage 3 — grants and proposals.** The required-grant set per action, the standing-policy id
  on operator actions, multi-cause holds, free text bound to the owner grant, and the proposal
  store and inbox a refusal turns into. Hand-over and the administrator's reassign live here.
  **This is the stage to review hardest, and Sol was right that it is several things**: the
  grant engine, the proposal lifecycle and the per-route enforcement should land as three
  reviewed commits.
- **Stage 4 — payer propagation.** `owner` on accounts; `--account auto` from the task owner's;
  payer fixed per execution; children, resumes and Codex reviews inherit
  `{taskId, accountId, payer grant version}`; both families checked before dispatch; the
  reserved coordination account.
- **Stage 5 — per-person views and threads.** My tasks, my inbox, my decisions; one conversation
  thread per person feeding the one coordinator.
- **Stage 6 — the box.** Provision from `infra/hetzner` under a neutral user; invite the team to
  the tailnet; `tailscale serve` (HTTPS enabled) in front of the dashboard; deploy credential kept
  off the box; then, **as its own rollout**, two colleagues for a fortnight measured as above.

## The simpler option passed over

**See all, steer all, with a name stamp** — what the research doc recommended and Astra endorsed.
It is less code — no ownership lookup, no hand-over, no proposals, no orphan state, no
delivery-time re-check — and Sol is right that it stays mechanical with the Overseer in the
picture: *"any authenticated team member may steer any task, with attribution; product and
box-admin actions keep their separate gates"* needs no judgement call either. An earlier draft of
this plan called ownership the simpler option; it is not. **It is the preferred policy, and it
costs more.** Greg chose it because *"it seems conceptually simpler to say that each person can
only control their own agents"* — simpler for the people, not for the code — and because it is
what makes "your agents spend only your subscription" true rather than hoped. What it buys is that
Alice cannot cause spend on Bob's running account or redirect his work without his say-so. **If
Stage 3 turns out to cost more than the team's trust is worth, the stamp-only option is the
fallback**, and Stages 1, 2 and 4 are still wanted under it.

**One Overseer per person plus an overall one** — Greg's own alternative in answer 6, passed over
because under the authority model it is the same thing with an extra process.

## Still Greg's

Ranked by how much the answer changes the stages above; the first four are Stage 0.

1. **Whose account do the Overseer's own sessions spend?** A reserved team account, or Greg's. Sol:
   Stage 4 cannot be built while this is open, because every stage ends in a review that has to
   bill somebody.
2. **Who may set priority?** Each person on their own items, with the product owner able to
   reorder everything; or the product owner alone?
3. **Who is the administrator** — the person who may reassign an orphaned task, and who operates
   the box when Greg is away (answer 8): sudo, a failed box, an expired login, a departing
   colleague. Until Unix users exist this is a name in the registry, not a boundary.
4. **Helpers, or hand-over only?** Hand-over moves a task wholesale and changes the payer (or
   relaunches). A helper is a second person with the owner grant on one task, added by the owner,
   spending the owner's account with the owner's consent. Helpers are how "Bob rescues Alice's
   stalled task while she is away" happens without her handing over first. Hand-over only is
   simpler.
5. **Answer 7 — how much intervention feels helpful**: visibility of others' transcripts,
   suggestions into others' agents, cancellation, extra spend. Under the model each is a proposal
   to the owner unless the owner delegated it; the question is only whether any should be direct.
6. **Is Greg the product owner for the new product**, and what is its production and who deploys
   it? Product authority needs a name.

## Round 1 review: GPT Sol, 2026-09-09

Read-only, at `7e6cd14a`; the full text is [260909i-plan-review-sol.md](260909i-plan-review-sol.md).
No P0; five P1s and two P2s, every one accepted after checking it against the code:

- **Three classes are neither exhaustive nor exclusive.** Origination fell between them; "deploy
  Alice's task" needs two grants; "pause" is operator only when a policy is the reason; free text
  is unclassifiable. → required-grant sets, rule 1 (origination), policy ids on operator actions, free text bound
  to the owner grant.
- **Owner copied onto records goes stale.** Steering envelopes carry session ids and no task id
  (`wire.ts`), so a hand-over would not reach a queued message. → `taskId` joined not copied, an
  ownership version, re-check at delivery, an owner-unavailable state and an administrator.
- **One coordinator is settled; one conversation is not.** → threads per person feeding one
  coordinator; multi-cause holds; the envelope keeps requester, authoriser or policy, relay, scope
  and reviewer.
- **Account choice was incomplete across hand-over, children, resume and Codex.** → payer fixed per
  execution, inherited by every child, both families checked before dispatch, the reserved account
  promoted to question 1.
- **Identity: a header is not membership, reads were unauthenticated, `PermitUserEnvironment yes`
  is too broad.** → allowlist, every route, the narrow pattern form.
- **Stages ordered around fields, and each hid several changes.** → reordered around invariants,
  Stage 0 is decisions, Stage 3 lands as three commits.
- **See-all-steer-all is the simpler option, not the harder one.** → the plan now says so and
  names it as the fallback.

Sol did not verify the future box's tailnet policy, HTTPS enablement, OpenSSH version, provider
terms, or anything in the extracted repo, which does not yet exist.
