# A shared team box: one Overseer, several people, several Claude accounts

**Status:** research, 2026-09-09. A proposal and a set of questions for Greg; nothing here is
decided or built. The question was put to GPT 6 Astra (prompt:
[260909b-team-box-review-astra-prompt.md](../plans/260909b-team-box-review-astra-prompt.md), answer:
[260909b-team-box-review-astra.md](../plans/260909b-team-box-review-astra.md)); its input is folded
in below and marked.

**Superseded in part by the plan, 2026-09-09.** Greg answered the questions at the end of this doc
the same evening, and the biggest answer — *a separate team, box and product, not Spideryarn's* —
removed most of the compatibility constraints below. What we would build is
[260909i](../plans/260909i-a-team-box-for-a-separate-product-one-overseer-that-carries-each-person-s-authority.md);
this doc stays as the working and the options weighed.

Greg, 2026-09-09:

> I'm contemplating renting a much bigger remote box, and making it available to my whole team.
> Perhaps we'd all share the same Overseer? There might be multiple Claude accounts. Perhaps each
> person would have the Tailscale setup to authorise their access, but would we still need some
> authentication mechanism (ideally Google SSO, but really easy to setup)? Or just ask them to input
> their email address and trust them? Would we restrict it so that any accounts they set up use only
> their Claude account-subscriptions? Can they view/edit other agents that other people set up? I'm
> leaning yes. Or maybe they can only affect things via the Overseer? Shared Overseer or one per
> person? Any other questions?
>
> In an ideal world/long-term, maybe each person has their own box, but somehow the
> agents/boxes/overseers communicate/coordinate with one another. That seems tricky, so I'm leaning
> towards just putting everyone on one box. Downsides/tradeoffs, or any even better solution?

## Jargon, once

| Word | What it means here |
|---|---|
| **box** | one rented Linux server running many Claude/Codex sessions in tmux — today `spideryarn-box`, [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) |
| **Unix user** | the operating-system login a process runs as. Today *everything* on the box runs as `greg`, with passwordless `sudo` (root on request) |
| **tailnet** | the private Tailscale network. Today it has two devices, the box and Greg's phone, and one Tailscale user, Greg |
| **boundary** | a control that *stops* somebody doing something. **Attribution** only *records who did it*. The direction doc established that on a shared Unix user nothing the dashboard checks can be a boundary — [overseer-direction.md § Appendix](../project/overseer-direction.md#appendix-security-and-hardening-deferred) |
| **principal** | the person an action is done by or for — the thing the code currently spells `"greg"` |
| **account** | one Claude (or ChatGPT) subscription; [260909g](../plans/260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md) is building the registry of them |
| **Overseer** | the one supervising session per box, [overseer.md](../project/overseer.md) |

## What is true today, and bears on this

Measured or read on 2026-09-09 at `51e3df60`; each of these shapes the proposal.

1. **The dashboard's idea of a person is a string literal.** `tools/fleet/wire.ts:65` has
   `type Speaker = "greg" | "overseer" | "dashboard"`, and `QueueActor` and `DecisionWireActor`
   are `"greg" | "overseer"`. The decision log's fold counts only Greg's `reviewed`/`reversed`. The
   queue's `--by` is a self-declaration. So "who did this" is answered everywhere, but the answer
   is always one of two names. A team means that type gains real people, and the seam is small and
   already there.
2. **Reachability is the access control, and it was designed for a one-person tailnet.** The
   direction doc closed A5 on exactly that premise, and wrote down the failure it feared: *"months
   later a device joins for convenience — the Mac, a collaborator's laptop … and nobody re-reads the
   policy, because 'it's on the tailnet' has become the reason it is safe."* A team box is that
   sentence coming true on purpose. The doc also already states the precondition for widening:
   **`tailscale serve` in front of the loopback bind and an owner check on the
   `Tailscale-User-Login` header for every write**
   ([§ The backlog, A5](../project/overseer-direction.md#the-backlog-after-the-wide-review)).
3. **A token under the shared user is not a boundary (A7).** Every agent runs as `greg` with
   sudo, so anything the dashboard could check is readable by everything it would guard against.
   With colleagues on the box that stays true: *your colleague's agent can read your `.env.local`,
   your Claude credential, and can `git push origin HEAD:main`*. Nothing mechanical protects
   `main` ([version-control.md](../project/version-control.md#what-protects-main-and-what-does-not)).
4. **Accounts are becoming a registry with a launcher that picks one** (260909g): per-account
   config dirs with a shared `projects/`, `--account auto` on every unattended launch, the chosen
   account written into the session's tmux metadata. It has no notion of *whose* account any of
   them is, because so far they are all Greg's.
5. **The Overseer's budget is global by design** (gate 4) and its product defaults are Greg's
   (gate 2). Both assume one person's intent behind the whole fleet.
6. **The box is already full.** One person's fleet runs load 30–40 on 16 cores with 30 GB, and the
   Overseer caps test-running sessions at three because the suites share one local Supabase. A
   team on the *same* box is a team sharing that cap.
7. **`gjd-remote` already runs from a laptop that is not the box**, chooses the repo directory on
   the box, and names and claims sessions. A colleague with an ssh key can use it today, as `greg`.

## The options, in plain words

### 1. Where the agents run

```
 (A) one box, everyone on it            (B) one box per person, coordinated       (C) one box now, built so that
 ────────────────────────────           ────────────────────────────────────       a second box is a field
 ┌────────────────────────┐             ┌────────┐  ┌────────┐  ┌────────┐         ┌────────────┐   ┌────────────┐
 │ greg's sessions        │             │ greg   │  │ alice  │  │ bob    │         │ box 1       │   │ box 2      │
 │ alice's sessions       │             │ + ovsr │  │ + ovsr │  │ + ovsr │         │ greg, alice │   │ bob        │
 │ bob's sessions         │             └───┬────┘  └───┬────┘  └───┬────┘         │ one Overseer│   │ one Overseer│
 │ ONE Overseer, ONE dash │                 └───────────┼───────────┘               └──────┬─────┘   └──────┬─────┘
 └────────────────────────┘                 something shared: queue, claims,                 └──── git + shared ────┘
                                            file-set map, one view                                  claim register
```

**(A) One box.** What Greg leans to. One dashboard, one Overseer, one `gjd-remote ls` that shows
everything, one local Supabase, and the file-set overlap check the Overseer already does covers
everyone's agents because they are all in front of it. Cost: one blast radius. A colleague's test
suite at load 40 pauses Greg's agents; the OOM killer does not know whose process it is killing. And
the per-person things — whose subscription, whose queue, whose decisions — must be *added* as
fields, because today the code has one person in it.

**(B) One box each, coordinating.** Isolation for free: load, disk, credentials, blast radius. The
"coordination" is less mysterious than it sounds, because most of it already happens through git:
the trunk `dev` is the artefact every agent talks through. What is box-local and would need a
shared home is (i) the queue of authorised work, (ii) the claim register (`gjd-remote ls` is it
today — which session holds which slice), (iii) the file-set map the Overseer uses to keep two
agents off the same ground, and (iv) one view of everything for a phone. All four are a small
shared store, not a distributed system — but it is N boxes to provision and keep patched, N
dashboards, N Overseers each rationing against its own account, and nobody has one page. Greg's
horizon already tags multiple boxes **SOMEDAY MAYBE**.

**(C) One box now, designed so a box is a field.** Everything the team version adds — a principal
on sessions, queue items, decisions and steers; an owner on accounts — is data that is the same
whether there is one box or five. If every record carries `{principal, box}` from the start, the
second box is a second collector feeding the same dashboard rather than a rewrite. What it costs
now is one extra column nobody uses yet.

**Recommendation: (C)**, which is (A) with the `box` column written down — but **trial it on the
box we have before renting the bigger one.** Astra's point, and it is right: a bigger machine fixes
simultaneous tests, browsers and resident memory; it does not fix competing edits, migrations that
disagree, exhausted subscriptions or contradictory instructions, and those are the team problems.
Size the next box from measured peak memory and concurrent heavy jobs after a fortnight with two
colleagues, not from "Greg runs thirty sessions, so six people need a hundred and eighty". Do not
build cross-box anything until one person's load actually starves another's for a week.

### 2. Who somebody is: identity

The question splits into four surfaces, and the honest answer is different on each.

| Surface | What identifies you today | Boundary or attribution? | Cheapest team version |
|---|---|---|---|
| **ssh to the box** | Greg's key, in `authorized_keys`, landing as `greg` | boundary against strangers only | one `authorized_keys` line per person, each with `environment="GJD_PRINCIPAL=alice"` (`PermitUserEnvironment yes` in `sshd_config`). `gjd-remote`'s box-side half reads it and writes it into the new session's tmux metadata beside `CLAUDE_SESSION_ID` and the account — **not** inherited, because a tmux session gets the tmux *server's* environment, not the ssh session's |
| **dashboard, reading** | reaching it (ssh forward; tailnet once the bind widens) | none needed | Tailscale: invite each person as a Tailscale *user*; `tailscale serve` puts `Tailscale-User-Login` on every request. **This is Google SSO in effect** — Tailscale's own login is Google/GitHub/Microsoft — with no login page to build |
| **dashboard, writing** (steer, launch, kill, broadcast) | nothing | attribution only (A7) | read the same header, refuse a request without it, and stamp `speaker` with the login. The direction doc already prescribes this as the precondition for widening the bind |
| **`git push`, deploy, production DB** | the shared user's credentials | nothing; any pane can deploy | unchanged unless separate Unix users — see below |

**Why not a typed email box?** It is attribution with no evidence behind it; anyone can type
anyone. Tailscale's header is attribution *with* evidence (the network layer proves the device, the
Tailscale login proves the person on it), and it is free. A typed email is fine as the fallback for
the ssh-forward route, where no header exists, but it should be labelled as unverified in the log.

**Why not Google SSO on the dashboard?** It would prove the same thing the Tailscale header proves,
cost a login page, a session cookie, CSRF protection and JWKS handling (the direction doc's § Access
lists them), and still be attribution only, because the box behind it is one user. Build it only if
the dashboard is ever reachable from outside the tailnet.

**Separate Unix users per person — the only real boundary, and what it breaks.** A Unix user per
person gives each their own `~/.claude` (their own login and therefore their own subscription by
construction, their own memory and transcripts), their own home, and file permissions between
people. It stops being a boundary the moment they have passwordless sudo, so it means *no sudo for
colleagues*. What it costs: tmux servers are per user, so the dashboard, the Overseer and
`gjd-remote ls` would have to read N sockets (`tmux -S`) and steer across them; every worktree
today lives under Greg's checkout; the shared `projects/` memory the accounts plan protects would
be per person (which is arguably correct — auto-memory is *"for preferences and machine-local
state"*, AGENTS.md); and `provision.sh`'s `AS_USER` runs everything as one name. That is a week of
plumbing across `gjd-remote`, `tools/fleet` and `infra/`, for a boundary between colleagues on the
same product. **Recommendation: not now.** Write down the trigger instead (below). Astra concurs:
*"That effort is justified by a real isolation requirement. It is not necessary merely to put names
on a trusted team's work."*

**The boundary worth building instead: production.** Astra's strongest addition. Protecting
colleagues' work from one another is a lower-value boundary than protecting *production* from
everyone's agents, and today any pane on the box can `git push origin HEAD:main`, which deploys to
paying readers, and any pane can read the production credentials in `.env.local`. With one person
that is a rule in prose; with a team it is a rule five people's agents must all keep. The lasting
shape is: routine workers may push `dev` and may not reach `main` or production credentials. That
means a server-side rule on GitHub protecting `main`, **and** a git credential on the box that the
rule does not exempt — Greg's own token bypasses branch protection as an admin, so the box must not
be pushing as Greg's admin token — with `npm run deploy` run from somewhere that holds the deploy
credential and the box does not. `push-env` already builds the box's `.env.local` from an allowlist,
so the second half is a shorter list. Repo settings are Greg's to change; the box has no GitHub
credential of its own.

### 3. Whose subscription a session spends

**Pin by default, pool by consent.** Every account in the 260909g registry gets an `owner`
(principal). `--account auto` chooses only from accounts owned by the launching principal, or from
accounts whose owner has marked them `shared`. A person's sessions therefore bill their own
subscription unless they said otherwise, and "whose subscription is this session spending" is a
column in the session metadata rather than a hope — the accounts plan already writes the chosen
account there.

Two consequences Astra drew that the draft missed. **The backwards-compatible default in 260909g is
wrong for a team**: it says an unflagged launch keeps today's behaviour, which is Greg's account, so
a colleague's first plain `gjd-remote new-claude` would bill Greg. A launch by a principal with no
`--account` must resolve to *that principal's* accounts or refuse; only a launch with no principal
at all keeps the old default. And **"everyone may steer everyone" and "nobody spends anyone else's
allowance" cannot both be absolute**: Alice steering Bob's agent is Alice spending Bob's
subscription, without ever seeing his token. Greg has to say which promise wins (question 4 below).

Codex is the same policy with its own mechanism: `CODEX_HOME` per account. OpenAI's own guidance
warns against concurrent jobs sharing one mutable auth file, so credential refresh under
concurrency has to be established before Codex accounts are pooled at all.

Two things are Greg's, not the design's: **Anthropic's terms** on several people drawing on one
subscription (one person with several accounts is the question 260909g already flagged; several
people sharing one is a different and likelier problem); and whether a colleague's credential
sitting in files readable by every agent on the box (A7 again) is acceptable to that colleague.
Codex/ChatGPT accounts are the same shape and wait for Greg's signal, as 260909g says.

### 4. Who may touch whose agents

Three shapes:

- **See all, steer all, stamped.** Greg's lean. Every steer, launch and kill already carries a
  `speaker`; it becomes the person's login, and the pane prefix says *"alice (dashboard):"* rather
  than *"greg:"*. The risk is confusion, not malice: two people steering one agent, or somebody
  answering a dialog in a session they did not start (a `1` at a numbered menu is an approval —
  gate 3). Mitigation is a visible **owner** on every session row and a one-tap confirm when you
  steer a session you do not own.
- **See all, steer own, ask the Overseer for the rest.** Attribution stays; the Overseer becomes
  the only cross-person actor, and its gates already say what it may do. Costs a round trip through
  the Overseer's tick for anything urgent.
- **Only via the Overseer.** Nobody types into anything; everything is a queue item. Cleanest
  record, and unusable when the Overseer is paused or the account is exhausted, which is exactly
  when a person needs to reach in.

**Recommendation: the first, with the owner column and the confirm.** Astra lands in the same
place — *"see-all, help-all, with one accountable owner per task"* — and adds what gate 1 needs
beyond `Speaker` becoming a real name. Every consequential action should keep: who requested it,
who authorised it or which standing policy did, whether the Overseer changed or inferred anything,
which task and session received it, and who reviews it. Its example: *"Alice requested
investigation. The Overseer selected this diagnostic step under the team policy. Bob owns the
task. Product changes still require Greg."* Today `routes-steer.ts` accepts the caller's own
declaration of `greg` or `overseer`; the human name should come from the Tailscale header, and a
request relayed through the Overseer must never gain authority on the way. A request with no
identity header — a tagged device, an ssh forward — must fail closed rather than become Greg.

### 5. One Overseer or one each

**One per box, with a principal on everything it handles.** The things it rations — load, the
three-suite cap, the local Supabase, file-set overlap — are box-wide facts and cannot be rationed
by two Overseers without them talking. The things that are per person — which queue an item came
from, whose subscription is near its limit, whose product defaults apply, who reviews the decision
log — become fields on the records it already keeps: queue items carry `--by`, decisions carry
`--by`, sessions carry the account and (new) the principal. So:

- **Rationing** is per account, and the account has an owner; a pause for "alice's five-hour
  window" pauses alice's sessions. The global budget in gate 4 becomes "global per account".
- **Product defaults** stay Greg's, because Spideryarn is his product — *unless the answer to the
  first intent question below is that the team is working on several products*, in which case the
  default belongs to the queue item's owner.
- **The morning review** is per person: everyone reviews the assumptions taken on their own items;
  Greg reviews everything that outlives a branch.
- **Two Overseers** would each need the other's view of the box, which is the cross-box problem
  from option 1(B) landed on one machine. Astra: *"one resumes what another paused, or each
  reserves capacity the others believe is free."*
- **Fairness when the box is short.** Newest-first is what the tick does today; it rewards whoever
  launched early. Astra recommends a modest guaranteed share per active person, with borrowing of
  idle capacity and explicit priority for agreed urgent work. That is a scheduler, so it is a
  question (5 below) rather than a default.
- **Review capacity.** Every stage ends in a Codex review, so a person's Claude allowance is worth
  nothing if their Codex review cannot run; reserve review capacity before launching more
  implementation. The shared model-call reservation gate 4 admits is **not built** becomes more
  consequential with every person added.

## What Astra said

GPT 6 Astra, 2026-09-09, on the prompt above; the full text is
[260909b-team-box-review-astra.md](../plans/260909b-team-box-review-astra.md). Its verdict:

> I would start with one shared box and one operational Overseer, with named people, explicit
> paying accounts, and a clear owner for each task. I would test that arrangement with two
> colleagues before renting a substantially bigger machine.

And the sentence it put at the top, which is the question under all of Greg's:

> The biggest decision is this: does "trusted colleague" mean "may effectively administer the box,
> use its credentials, and affect production"? Today, that is what unrestricted access to this
> fleet amounts to — even through a browser.

Where it agreed with the draft: one box; Tailscale identity rather than a login page (*"Google login
directly in the dashboard is worthwhile if installing Tailscale becomes a barrier"*); a typed email
is *"an acceptable name badge for a demonstration"* and nothing more; separate Unix users only for a
real isolation requirement; see-all help-all with an owner; one operational Overseer with personal
views; pin accounts by default and borrow explicitly; add a box id to durable records and never
build live migration or home-directory sync.

Where it added something, each folded into the section it belongs to above: production authority
as the boundary worth building (§ 2); unflagged launches and steering-as-spending (§ 3); the five
fields gate 1 needs (§ 4); fairness, review capacity and the unbuilt reservation (§ 5); trial before
buying (§ 1). Its one "better division": *"a shared collaboration environment with production
authority held elsewhere"*, and boxes per **project** rather than per person if colleagues bring
unrelated or confidential work.

Not verified by it: live tailnet and firewall settings, real resource demand, provider terms on
pooling, and the account-plan measurements, which it took as reported.

## The smallest version worth building first

Before any of the above is hardened, and **before renting anything**, find out whether a colleague
on the box helps at all — on the box we have, with a concurrency cap agreed up front:

1. Add one or two colleagues' ssh keys with a `GJD_PRINCIPAL` environment line. They can run `gjd-remote`
   from their laptop today.
2. Register their Claude account in the 260909g registry with an `owner`; restrict `auto` to owned
   or shared accounts. That is the one code change that is not optional, because without it their
   first session bills Greg.
3. Widen the dashboard bind through `tailscale serve` with the header check the direction doc
   already requires, and make `Speaker` a login string. Invite them to the tailnet.
4. Show the owner on every session row. Nothing else changes: same Overseer, same queue, same
   trunk, same rules in AGENTS.md.
5. Only if question 3 below is answered "no": protect `main` and move the deploy credential off
   the box first. If it is "yes", write that acceptance down where the colleagues will read it.

Run that for two weeks. Judge it by whether the colleagues could work without Greg at a terminal,
whether hand-offs saved time, whether "whose account is this" stayed answerable, and whether Greg
coordinated less — not by how many sessions ran. The questions of Unix users, per-person Overseers and a second box all get
better answers from a fortnight of one colleague than from a design.

## Questions for Greg, ranked by how much the answer changes the design

1. **What is the team on the box for?** The same repo and product (then the Overseer's file-set
   coordination and Greg's product defaults carry over), or their own projects sharing the hardware
   (then it is co-tenancy: one Overseer per *repo*, not per person, and the shared thing is only the
   box's resources)?
2. **What would a colleague actually do?** Start agents from a laptop with `gjd-remote`, or only
   from the phone-sized dashboard? The second needs the new-session mode to be enough on its own
   and changes how much the terminal path matters.
3. **Is "your colleague's agent can read your credential and deploy to production" acceptable?**
   That is the box today, for anyone on it. If yes, say so and it becomes a written assumption; if
   no, separate Unix users without sudo is the work, and it goes before inviting anyone.
4. **Subscriptions: pinned or pooled?** Pinned is the safe default; pooling gets more out of the
   week's windows but needs each owner's consent and Anthropic's terms checked.
5. **When the box is short, whose agents wait?** Today: newest sessions first. With people:
   proportional per person, Greg first, or the queue's priority order?
6. **Who reviews the decision log?** Only Greg, or each person for their own items, with Greg over
   everything that outlives a branch?
7. **Who is admin?** Sudo, deploy, `main`, the production database — everyone, or Greg alone? Today
   nothing mechanical distinguishes, so this is a policy statement until Unix users exist.
8. **Who may commit the team to work?** If every task needs Greg's authorisation the queue makes
   him the bottleneck; a delegated scope (*"Alice owns library usability within these
   constraints"*) lets the Overseer proceed on her say-so with clear escalation.
9. **How much intervention feels helpful?** Rescuing a stalled task is welcome; redirecting it while
   its owner is away may not be. Visibility, suggestions, take-over, cancellation and extra spend
   are five separate permissions, and old personal transcripts in the shared view is a sixth.
10. **Who operates it when Greg is away?** A failed box, an expired login, a disputed priority, a
    departing colleague. A shared machine only saves administration if that work does not all come
    back to Greg.
