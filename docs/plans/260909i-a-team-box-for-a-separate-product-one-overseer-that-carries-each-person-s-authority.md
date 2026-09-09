# A team box for a separate product, and one Overseer that carries each person's authority

**Status:** proposed, 2026-09-09. **Not to be built until the Overseer dispatches it** — Greg:
*"Don't implement - wait for instructions from the Overseer."* The research behind it, with GPT 6
Astra's review, is
[260909b](../research/260909b-a-shared-team-box-with-one-overseer-several-people-and-several-claude-accounts.md);
this plan is what changed once Greg answered its questions, and what we would build.

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

The rules, each one a line a program can check:

1. **Authority lives in the task, not in the agent and not in the Overseer.** Every task has one
   owner. An agent's owner is its task's owner. Ownership moves only by the owner handing it over
   (or adding a helper, if § Still Greg's decides helpers exist).
2. **A person acting directly** — from the dashboard, or from `gjd-remote` — may act on their own
   tasks. On anyone else's, the dashboard shows the row and refuses the write. *See all, steer own.*
3. **The Overseer acting for a person carries that person's authority and nothing more.** When
   Alice tells it something, it evaluates the request as Alice: her tasks, her accounts. What Alice
   could not do herself, the Overseer cannot do for her. It does not hold a pool of everyone's
   authority to be spent on request.
4. **The Overseer's own authority is the operator list, and it is uniform.** Under standing policy
   it may pause, resume, compact, kill a wedged shell, close out a finished agent, remove a checked
   worktree — for anyone's agents, the same way, and logged. None of these changes what a task does.
   That is the existing gate 3 list with an owner column.
5. **Product authority is never the Overseer's**, whoever asks. Gate 3 already says so; a team
   changes nothing here except that "Greg" becomes "the product owner", which for this product is
   Greg unless he delegates.
6. **A refusal is a proposal, not a dead end.** What the Overseer cannot do for Alice it can *put to
   the person who can*: a message in Bob's inbox, or the product owner's. Bob accepting makes it
   Bob's request, with Bob's authority. That is the whole hand-over mechanism and it is the same
   shape the Overseer already uses for Greg's vetoes.

**Why this dissolves Greg's confusion.** "I could just tell it to deploy using someone else's
agents" fails twice, mechanically: deploying needs product authority the Overseer never has (rule 5),
and someone else's agents need their owner's authority, which the asker does not carry (rule 3). The
Overseer does not have to *judge* who is allowed what; it looks up the task's owner and the action's
class and the answer falls out. Astra's version of the same principle: *"relaying through the
Overseer must not increase the requester's authority."*

**Why one Overseer and not one per person.** A per-person Overseer is what you build when authority
lives *in the Overseer*, so that each person's is small. Under rules 3 and 4 the one Overseer is
already "Alice's Overseer" when Alice is talking to it: it wears her authority and no one else's.
What is genuinely shared — load, the test-suite cap, file-set overlap, one page for the phone — must
be one process anyway, because two of them pause and resume each other's work. So: **one Overseer,
per-person views** (my tasks, my inbox, my decisions to review). Greg's instinct that the two-tier
version *"sounds more complicated and less appealing"* is right; it is also unnecessary.

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

- **A request without the header fails closed.** Tagged devices and ssh forwards carry none; a
  missing identity is *unknown*, never the product owner.
- **`gjd-remote` from a laptop** is the secondary route (Greg's answer 3: either, if cheap). One
  `authorized_keys` line per person carrying `environment="GJD_PRINCIPAL=<login>"`
  (`PermitUserEnvironment yes`), which the box-side launcher writes into the session's tmux metadata
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
the code in its own repo, and none touches the Spideryarn box.

- **Stage 1 — a `Person` in the wire.** `Speaker`, `QueueActor`, `DecisionWireActor` and the
  decision fold take a `Person` (a login string, validated) instead of `"greg"`. The dashboard
  server reads `Tailscale-User-Login`, refuses writes without it, and stamps every steer, launch,
  kill and broadcast. `owner` on sessions (tmux metadata), queue items and decisions.
- **Stage 2 — owned accounts and the launch rule.** `owner` in the accounts registry;
  `--account auto` restricted to the task owner's; no unflagged inheritance; the chosen account and
  owner recorded with the launch.
- **Stage 3 — the authority check.** One function classifying an action as owner, operator or
  product, one lookup of the task's owner, applied in the dashboard's write routes and in the
  Overseer's handling of a person's request. A refused request becomes a proposal in the right
  inbox. This is where rules 1–6 become code, and it is the stage to review hardest.
- **Stage 4 — per-person views.** My tasks, my inbox, my decisions to review; the existing
  Questions and Decisions modes filtered by `Person`.
- **Stage 5 — the box.** Provision from `infra/hetzner` under a neutral user; invite the team to
  the tailnet; `tailscale serve` in front of the dashboard; deploy credential kept off the box; two
  colleagues for a fortnight, measured as above.

## The simpler option passed over

**See all, steer all, with a name stamp** — what the research doc recommended and Astra endorsed.
It is less code (no ownership check, no proposals) and matches how a trusting team behaves. Greg
passed over it because *"it seems conceptually simpler to say that each person can only control
their own agents"*, and once the Overseer is in the picture that is true: a stamp says who did it,
but only ownership says what the Overseer may do on whose behalf, and without it every request to
the Overseer needs a judgement call. The ownership rule costs one lookup and buys a mechanical
answer.

**One Overseer per person plus an overall one** — Greg's own alternative in answer 6, passed over
because under the authority model it is the same thing with an extra process.

## Still Greg's

Ranked by how much the answer changes the stages above.

1. **Who may set priority?** Each person on their own items, with the product owner able to
   reorder everything; or the product owner alone? (Stage 3.)
2. **Whose account do the Overseer's own sessions spend?** A team-owned account, or Greg's. It
   needs an owner like any other. (Stage 2.)
3. **Helpers, or hand-over only?** Hand-over moves a task wholesale. A helper is a second person
   with owner authority over one task, added by the owner. Helpers are how "Bob rescues Alice's
   stalled task while she is away" happens without the Overseer; without them, it happens by Alice
   handing over first. Hand-over only is simpler; helpers are what answer 7 might want. (Stage 3.)
4. **Answer 7 — how much intervention feels helpful**: visibility of others' transcripts, suggestions
   into others' agents, cancellation, extra spend. Under the model each is a proposal to the owner
   unless the owner delegated it; the question is only whether any should be direct.
5. **Answer 8 — who is admin, and who operates the box when Greg is away**: sudo, a failed box, an
   expired login, a departing colleague. A policy statement until it is a Unix-user boundary.
6. **Is Greg the product owner for the new product**, and what is its production and who deploys
   it? Product authority needs a name.
