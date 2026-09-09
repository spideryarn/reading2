**I would start with one shared box and one operational Overseer, with named people, explicit paying accounts, and a clear owner for each task.** I would test that arrangement with two colleagues before renting a substantially bigger machine.

One box per person is a useful alternative, but it is not automatically the better long-term destination. The right division is likely to follow **projects, credentials, and operational independence**, rather than headcount.

The biggest decision is this: **does “trusted colleague” mean “may effectively administer the box, use its credentials, and affect production”?** Today, that is what unrestricted access to this fleet amounts to—even through a browser.

I reviewed revision `51e3df60`, including the requested runbook, direction, account plan, collaboration rules, and relevant dashboard and launcher paths. Nothing was changed, launched, or sent to another session.

**Sharing a machine buys useful simplicity, but does not remove coordination problems.**

| Arrangement | What it looks like in use | What it buys | What it costs or gives up |
|---|---|---|---|
| **One shared box** | Alice starts a task; Bob reads its progress and helps; one Overseer sees the whole workload. | Easiest collaboration, shared spare capacity, one installation and recovery procedure. | An overload, reboot, bad configuration change, or credential incident affects everyone. |
| **One box, separate Unix users** | Everyone uses the same dashboard, but Alice’s processes and credentials belong to Alice. | Some separation without duplicating the machines. | Existing session discovery, steering, paths, and shared state need adaptation. |
| **One box per person, shared queue** | Alice claims a task, runs it locally, and publishes a branch and handoff. | Independent maintenance and resource use; clearer credential ownership. | Repeated setup, unused capacity on one box while another is busy, less immediate access to unfinished work. |
| **One shared development box plus isolated workers** | Most work stays together; expensive tests or a sensitive project run elsewhere. | Separation where it earns its cost; avoids making every task distributed. | Another environment to maintain, plus explicit artifact transfer. |

For three to six people working on Spideryarn, the first arrangement is the strongest starting point. If colleagues bring unrelated client work or private credentials, the second or third becomes considerably more attractive.

A larger box will help with simultaneous tests, browsers, dependency installs, and resident memory. It will not fix competing edits, incompatible database migrations, exhausted subscriptions, or contradictory instructions. The [worktree documentation](/home/greg/code/spideryarn2/docs/project/worktrees.md) already demonstrates that separate working directories still share consequential state.

I would therefore size the next machine from **measured peak memory and concurrent heavy jobs**, not “Greg has 30 sessions, so six people need 180.” Admission limits—deciding when another expensive job may start—remain valuable on a large machine.

“Boxes coordinate” can mean three increasingly expensive things:

- **Share tasks and results:** one queue, named claims, Git branches, review results, and handoff notes. This is mostly ordinary engineering.
- **Share live visibility and remote actions:** every session needs a box identifier, stable identity, fresh status, and a way to report whether a command arrived. Manageable, but disconnected machines must appear as unknown, not empty.
- **Automatically move and rebalance live work:** now you must handle uncommitted files, credentials, transcripts, local databases, interrupted commands, and two machines believing they own the same task. This is genuinely difficult.

The tricky case is “Alice’s box disappeared: may Bob restart her task?” A lost connection does not prove Alice stopped. Automatic reassignment needs protection against two workers continuing the same job. Initially, leave uncertain tasks claimed until a person resolves them.

To preserve the option of several boxes, add box identity to durable task/session references and exchange committed artifacts. **Do not build live migration or synchronise whole home directories.**

**A5 reopens now; A7 becomes an explicit team decision.**

The [direction doc’s closure of A5](/home/greg/code/spideryarn2/docs/project/overseer-direction.md:1355) rested on two devices, both Greg’s, and a loopback dashboard. Colleagues are precisely the additional parties that argument said did not yet exist.

That does **not** mean Google login fixes the architecture. It means access can no longer silently imply Greg’s identity and authority.

A **boundary** prevents an actor from doing something through the available routes. **Attribution** records who apparently did it. Both are useful; they are different promises.

| Surface | What authentication would accomplish | What remains with everyone running as `greg` |
|---|---|---|
| **SSH** | Individual keys or Tailscale identities control entry and allow individual access to be revoked. | After login, everyone has the same filesystem and process authority. Connection identity does not reliably identify every later action. |
| **Dashboard reads** | Restricts who can see transcripts, prompts, decisions, and account metadata. | Local processes can read the underlying files or reach the backend. |
| **Dashboard writes** | Identifies browser callers and can enforce permissions on that route. | Anyone with the shared shell can bypass it through files, tmux, or direct requests. |
| **Session launch** | Associates a launch with a requester and selects their permitted accounts. | An unrestricted worker can start other processes or read another account’s credentials. |
| **`git push`** | GitHub authenticates the credential performing the push. | Dashboard login has no effect. Shared Git credentials remain shared authority; commit author names are only attribution. |

**Use Tailscale identity for the first team interface.** People already need Tailscale, and it supports Google sign-in. This can avoid maintaining a second login flow. [Tailscale’s Google setup](https://tailscale.com/docs/integrations/identity/google-sso).

Put the dashboard behind Tailscale Serve, keep the backend on loopback, and allow named team members. Serve supplies identity headers and removes incoming spoofed copies. Those headers are absent for tagged clients, so missing identity must not become “Greg.” Direct local requests remain forgeable: loopback limits that problem to the box; it does not eliminate it. [Tailscale Serve identity documentation](https://tailscale.com/docs/features/tailscale-serve).

An SSH forward does not carry the original person’s Tailscale web identity. Keep that route explicitly administrative or separately authenticated; do not infer a person from `localhost`.

Google login directly in the dashboard is worthwhile if installing Tailscale becomes a barrier, or if you need browser authentication independent of device membership. It adds session handling and recovery work. **Typed email is an acceptable name badge for a demonstration, but cannot authorise spending, reviews, or privileges.**

Keep the existing browser protections alongside authentication. Origin checks prevent certain unwanted browser requests; they do not identify a person. Likewise, `FLEET_ACT_ENABLED` and `confirm: true` make particular actions deliberate, not authenticated. Authentication must cover the whole interface, including its streams and separate write routes.

A7 remains technically unchanged: a shared user with passwordless sudo offers no containment between workers. What changes is whether everyone understands and accepts that arrangement.

**Separate Unix users are the honest answer if personal credentials must be protected from other workers.** They only help if ordinary workers lack broad sudo, private directories remain private, and control services cannot be rewritten by those workers.

That would require real adaptation:

- Separate users normally have separate tmux sockets. `gjd-remote ls` would need aggregation, and cross-user steering would need a controlled service.
- Sharing a writable Git common directory would weaken the separation. Prefer one clone per person, with worktrees within each clone.
- The shared `~/.claude/projects/` arrangement becomes a deliberate shared-data choice. You could share Spideryarn memory and selected transcripts while keeping credentials and unrelated histories private.
- The Overseer would request operations through those services. Giving its model unrestricted root access would restore the authority you were trying to separate.

That effort is justified by a real isolation requirement. It is not necessary merely to put names on a trusted team’s work.

**Protecting production is a separate, higher-value boundary than protecting colleagues’ work from one another.**

The [current production rule](/home/greg/code/spideryarn2/docs/project/version-control.md:58) is prose: any pane can push `main`. My preferred lasting arrangement would let routine workers push development work while keeping production deployment and powerful production credentials outside their reach.

Server-side GitHub rules can restrict updates to `main`, but the credentials allowed to bypass those rules must also be unavailable to ordinary workers. A local hook is useful accident prevention, not that boundary. Exact options depend on the repository’s ownership and GitHub plan. [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).

**Pin new work to the requester’s accounts by default. Make borrowing explicit.**

The latest mechanism decision in [260909g](/home/greg/code/spideryarn2/docs/plans/260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md:389) is sound for this: separate Claude config directories, shared `projects/`, and account-specific usage reads. Earlier sections still describe the superseded token mechanism, so they should not be treated as one consistent final specification.

The registry needs to distinguish:

- the provider account and its owner;
- who may use it;
- whether it is personal, explicitly shared, or reserved for coordination.

`--account auto` should mean **“choose among accounts permitted for this task,”** never “choose whichever account on the box has room.”

The cheapest reliable launch path would:

1. Resolve the task owner and permitted paying accounts.
2. Select an explicit config directory and remove conflicting authentication overrides.
3. Verify the credential’s provider identity against the registered account—not merely trust the directory name or cached email.
4. Record the account identity with the launch.
5. Preserve that selection through child jobs and resume paths; refuse ambiguous routing.

Unflagged team launches must not silently inherit Greg’s account. The plan’s backward-compatible default makes sense for Greg alone and needs reconsidering here. Account registration should add a new identity, not silently replace an existing account’s credential.

This establishes **correct routing through supported launchers**. It cannot guarantee exclusive use while every worker can read every credential. A launch record also proves the account selected then, not every later call if someone changes authentication.

There is another tension: **unrestricted steering of Bob’s agent lets Alice cause spending on Bob’s subscription**, even without seeing its token. “Everyone may steer everyone” and “nobody may spend anyone else’s allowance” cannot both be absolute promises. Decide whether the latter means own-account launches or all expenditure.

Codex needs the same ownership policy but its own implementation. `CODEX_HOME` separates stored credentials and configuration. The current [Codex wrapper](/home/greg/code/spideryarn2/scripts/run-codex.ts:101) defaults to subscription-first and can retry against an API key; use subscription-only for a policy that promises subscription-only spending. [Official authentication documentation](https://learn.chatgpt.com/docs/auth).

Do not copy Claude’s shared-state arrangement wholesale to Codex. OpenAI’s runner guidance warns against concurrent jobs or machines sharing the same mutable authentication file. Resolve credential refresh and supported concurrency before expanding that pool. [Codex runner authentication](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

**I favour see-all, help-all, with one accountable owner per task.**

Your leaning towards collaboration is sensible. The main everyday risk is two helpful people giving incompatible instructions.

A cheap first version would show the task owner, current helper, paying accounts, and recent steering. Anyone may contribute suggestions; changing scope, taking over, or initiating substantial additional work is made explicit and visible to the owner. A claim column is attribution and coordination unless enforced elsewhere.

A stricter version—see-all, steer-own, request help for the rest—fits a team that wants firmer personal spending limits. It costs more routing and waiting, but prevents ordinary accidental interference through the dashboard.

“Only via the Overseer” centralises coordination, but adds model latency, quota cost, and a bottleneck when the Overseer is unavailable. It also does not establish security while that Overseer can be asked to control unrestricted workers. I would offer it as a convenient interface, not require it for every interaction.

Gate 1 needs more than replacing “Greg” with a name. Each consequential action should preserve:

- who requested it;
- who authorised it, or which standing policy did;
- whether the Overseer changed or inferred anything;
- which task and session received it;
- delivery outcome and the person responsible for reviewing the decision.

For example: “Alice requested investigation. The Overseer selected this diagnostic step under the team policy. Bob owns the task. Product changes still require Greg.”

The [current speaker handling](/home/greg/code/spideryarn2/tools/fleet/routes-steer.ts:426) accepts a caller’s declaration of Greg or Overseer. That was honest self-attribution for the previous arrangement. Authenticated browser identity should now supply the human name; relaying through the Overseer must not increase the requester’s authority.

The decision log remains operational bookkeeping, not tamper-resistant evidence, while the same shared user can rewrite it.

**Keep one operational Overseer, with personal views and explicit delegated authority.**

One box still needs one owner of scheduling, resource admission, and fleet-wide pause/resume. Several personal Overseers independently doing those jobs would compete: one resumes what another paused, or each reserves capacity the others believe is free.

People can nevertheless have their own conversation with the shared Overseer and their own “needs me” view. Its durable task records—not its conversational memory—must keep their intentions separate.

Its responsibilities would become:

| Responsibility | Recommended team rule |
|---|---|
| **Work authorisation** | Anyone may propose work. People may authorise work within explicitly delegated scope; proposal is not authorisation. |
| **Queue selection** | One queue with owners, project, priority, and paying accounts. Round-robin eligible owners within a priority level. |
| **Product defaults** | Project policy, with Greg retaining Spideryarn decisions unless he delegates them. Personal preferences do not silently become team policy. |
| **Machine capacity** | One shared limit, including tests, browsers, and child processes. Reserve enough capacity for the dashboard and administration. |
| **Subscriptions** | Separate budgets per provider account, plus an explicit coordination reserve. Account exhaustion holds affected work, not automatically everybody. |
| **Review** | Task owners review task decisions; Greg reviews product decisions; a named operator reviews fleet-wide decisions. |

The global-budget principle survives, but **global means all consumers are counted**, not that unrelated subscriptions become one interchangeable balance. Percentages across accounts should not be added. Usage outside this box also consumes a person’s subscription.

Because both model families are required, a task needs a permitted path to both. Alice’s Claude capacity is insufficient if her required Codex review cannot run. Reserve review capacity before launching more implementation work.

The runbook explicitly says its shared model-call reservation is [not built](/home/greg/code/spideryarn2/docs/project/overseer.md:195). A larger team makes that gap more consequential. More personal Overseers would multiply it.

If people later have separate boxes, each can have a local resource coordinator while sharing task claims and product policy. An account used on several boxes still needs account-wide rationing.

**These are the questions I would put to you first, ranked by how much the answer changes the design.**

1. **What work will colleagues actually do?** If everyone builds Spideryarn, shared context and one product authority are valuable. If someone also brings confidential client work, sharing all transcripts and credentials becomes inappropriate. If people mostly propose ideas and inspect results, a browser interface may remove any need for shell access.

2. **What must a colleague—or their mistaken agent—be unable to do?** “We trust everyone with this whole environment” makes a shared-user pilot reasonable and cheap. “They may help with code but must not access my credentials or production” requires actual separation. The latter buys containment and costs changes to the existing tooling.

3. **Who can commit the team to work and make product decisions?** Requiring your approval for every task preserves control but may turn you into the team’s bottleneck. Delegating a bounded area—“Alice owns library usability within these constraints”—lets the Overseer proceed while retaining clear escalation points.

4. **Are subscriptions personal allowances or team resources?** Personal allowances give predictable ownership: Alice stops when hers is exhausted. Explicitly shared capacity improves utilisation but needs consent, limits, and a rule for withdrawal. Either choice must account for required cross-family reviews and the Overseer itself.

5. **What should happen when one person’s agents crowd out another’s?** First-come-first-served is cheap but rewards whoever launches early. A modest guaranteed share per active person, with borrowing of idle capacity, is fairer but needs scheduling. I recommend the latter, with explicit priority for agreed urgent work.

6. **How much intervention and sharing feels helpful?** Bob rescuing Alice’s stalled task may be welcome; Bob changing its direction while she is away may not. Agree separately on visibility, suggestions, takeovers, cancellation, and additional spend. Include whether historical personal transcripts belong in the shared view.

7. **Who operates this when you are absent?** Someone must handle a failed box, expired login, disputed priority, and departing colleague. A shared machine saves repeated administration only if that work does not all return to you.

**The smallest worthwhile experiment is a short, limited team trial—not a hardened platform.**

I would invite two colleagues for a week, on one product, with a modest agreed concurrency cap. Use named access, explicit account selection, visible task ownership, attributed steering, and one shared queue. Let them try starting work, helping someone else, handing a task over, and recovering from a quota hold.

Keep the shared Unix user for that trial only if its full authority and transcript visibility are accepted. Otherwise use separate users or a disposable trial environment without production credentials; adding a name badge would not answer that requirement.

Judge success by whether colleagues can work without Greg’s terminal help, whether handoffs save time, whether account ownership stays understandable, and whether Greg spends less time coordinating. Session count is not the success measure.

| Recommendation | Value here | Effort |
|---|---|---|
| Limited team trial before a major hardware commitment | High | Small |
| Named Tailscale access and attributed actions | High | Small–medium |
| Task ownership and delegated decision scope | Very high | Small–medium |
| Account-specific routing through launches, children, and resumes | Very high | Medium |
| Fair admission and protected coordination/review capacity | High | Medium |
| Production credentials and deployment separated from ordinary workers | Very high | Medium, potentially larger |
| Separate Unix users | High if isolation is required | Medium–large |
| Personal views over one Overseer | High | Small–medium |
| Automatic multi-box scheduling or live task migration | Low at present | Large |

One potentially better division is **a shared collaboration environment with production authority held elsewhere**. Another is boxes per project rather than per person. Both preserve teamwork while separating things whose failures or credentials should not travel together.

I did not verify live firewall/tailnet settings, deployed dashboard configuration, actual resource demand, credential contents, provider permission for cross-person subscription pooling, or subscription concurrency on this box. The account spike results are evidence reported by the plan, not experiments I repeated. I checked current official Tailscale, GitHub, and Codex documentation for the relevant mechanisms; no hardware sizing or pricing recommendation is implied.