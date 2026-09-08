# A check asserted registration, not behaviour

From 2026-08-31 to 2026-09-08, the `chrome-devtools` MCP server on the Hetzner box could be used by
exactly one agent session at a time. The box exists to run many sessions at once. The second agent to
reach for it got a hard failure:

```
The browser is already running for /home/greg/.cache/chrome-devtools-mcp/chrome-profile.
Use --isolated to run multiple browser instances.
```

Nothing reached a reader — this is agent tooling on the remote box, not the app. What it cost is
eight days of agents intermittently unable to use a tool that every check said was fine, and however
many hours were spent by whoever hit it and concluded the box was flaky.

Fixed in `a2bc3c41`, reproduced first: two `chrome-devtools-mcp@1.8.0` servers started concurrently,
the second dies without `--isolated`, both pass with it.

## What happened

[`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh) registers both browser MCP servers
at user scope. Above **both** registrations sat this comment:

> `--isolated`, because one persistent profile supports exactly one browser process and the whole
> point of this box is parallel sessions.

Only the `playwright` line carried the flag:

```sh
add_mcp playwright       "npx -y @playwright/mcp@$PW_MCP --headless --isolated …"
add_mcp chrome-devtools  "npx -y chrome-devtools-mcp@$CDT_MCP --headless"
```

The comment is not wrong. It is a correct statement of a rule that governs two lines, and one of them
implements it.

## The class: a check that asserts registration, not behaviour

**Three checks were green over this the whole time, and not one of them ever asked a registered MCP
server to open a page.** They form a ladder of apparently increasing fidelity, and each rung stops
one short of the thing that could fail:

| The check | What it actually proves | Subject of that sentence |
|---|---|---|
| `check "devtools mcp"` in provisioning — `claude mcp get chrome-devtools \| grep -q max-old-space-size` | the registration **text** contains a substring | a string in a config file |
| `claude mcp list` → **✔ Connected** | the MCP **handshake** completed over stdio | a JSON-RPC transport |
| `gjd-remote doctor`'s `browser` check | `playwright-core`, imported directly, **launches Chrome** | ad-hoc Playwright |

Write out the sentence each check licenses and the class is visible immediately. Not one of them has
*a registered MCP server* as its subject and *opened a page* as its verb. The question was
**behaviour** — can two agents each drive a browser through this server? — and every answer on offer
was about **configuration**: is the right text present, does the process start, does some other thing
work.

Two sharpenings worth carrying:

**The most convincing check was the most misleading.** The `doctor` `browser` check is the one that
does real work: it starts a real Chrome, loads two pages, takes two screenshots, compares text before
and after a click. Every instinct says a check that expensive must be proving something. It is — about
a subject nobody asked about. **Fidelity is not the axis; subject is.** A cheap check aimed at the
right subject beats an elaborate one aimed at a neighbour, and an elaborate one aimed at a neighbour
is worse than no check at all, because it buys confidence.

**"Registered" reads as "working", and nothing in the vocabulary resists it.** `claude mcp add`
records a command; it installs nothing, launches nothing, and cannot fail for any reason the server
would later fail for. Somebody had already written exactly that in the same file — *"`claude mcp add`
only records a command — it installs nothing"* — and the three checks above still stood as the
evidence that the servers worked.

This is [silent-success.md](../reusable/silent-success.md) with a twist. The house pattern is
*something reports success while doing nothing*. Here everything genuinely did something; what went
wrong is that **the something was a different question from the one the green tick was read as
answering**. The generalisation: when a check goes green, say out loud what it proves and about
*what* — if the noun in that sentence is not the noun in the failure you are worried about, you have
no check.

The nearest already-named relative is
[260906f — a working transport mistaken for a working conversation](260906f-a-working-transport-mistaken-for-a-working-conversation.md).
That one is about a UI that hid the evidence; the handshake half of it is the same mistake as
`✔ Connected` here, and the phrase is worth reusing: **a working transport is not a working anything
else.**

### The rule was in the same file, twelve lines below, in the same commit

The docker check sits immediately under the three MCP checks, with this comment:

> Assert the EFFECT, not the artefact. `id -nG | grep docker` would pass on a box where the daemon is
> dead or the socket unreachable; running a container as $USER_NAME proves the daemon, the runtime and
> the group all work together.

Same file, same author, same commit (`74010873`). The principle was not unknown, unwritten, or
unavailable — it was stated correctly a dozen lines away and not applied to the block above it. That
is the strongest argument here for a mechanical check over a documented principle: knowing the rule
and noticing you are about to break it are different acts.

## The comment governed two lines and only one carried the consequence

**This is a second instance of a class already named today**, in
[260908f — a correct comment contradicted by the line beneath it](260908f-a-correct-comment-contradicted-by-the-line-beneath-it.md).
Don't rename it; that file has the class.

What this instance adds is a **distribution** mechanic rather than an adjacency one. In 260908f the
comment and the line that broke it were touching, so the drift was visible to anyone reading both.
Here one comment governed a **block** of two registrations, and the two are structurally different
enough — different package, different flag spellings (`--executable-path` versus `--executablePath`),
different tool names — that they never read as two instances of one thing. To see the bug you had to
hold the shared comment against *each* line beneath it and ask whether the consequence appeared in
both. Nobody does that; you read the comment, then read the line you came for.

So the recognisable signature is narrower than "comment and code disagree":

> **A reason stated once above several lines, where only some of them carry it.** The prose is the
> more convincing of the two artefacts, because it is written in the language of intent and the code
> is written in the language of flags.

The tell is grammatical, and it is cheap: **a comment whose subject is plural, above lines that are
not identical.** "Both of these", "each server", "they all" — when you write one of those above a
block, grep the block for the consequence before you move on.

There is a **third instance in the same block**, which is what turns this from a story into a
pattern. `provision.sh` said it pinned the MCP versions — *"Pin at provision time rather than
resolving @latest … Re-provision to move them"* — and implemented it as:

```sh
PW_MCP=$(npm view @playwright/mcp version)
CDT_MCP=$(npm view chrome-devtools-mcp version)
```

which installs whatever is newest on the day the box is rebuilt, with no diff in this repo recording
the move. The word "pin" was doing work the code never did. That mattered on the day: the two servers
were measured at length against `chrome-devtools-mcp@1.8.0`, and `1.9.0` shipped the same day — so a
rebuild would have silently changed the subject of every measurement in the commit that fixed this.
Now literal constants.

Three drifts, one comment block, one commit. The commit that introduced them all —
`74010873`, 2026-08-31 — is titled *"The grep matched, and the check reported failure anyway"*, which
is itself a postmortem-shaped title about a check that lied.

## A documented hole is a liability with a clock on it

[browser-control.md](../project/browser-control.md) had carried a section titled **"The known hole, on
the box"** since 2026-08-31, which said, correctly and in detail:

> **Nothing yet drives the MCPs as a check.** … `claude mcp list` saying ✔ Connected is the MCP
> handshake, not a browser … Driving them over stdio is the check that would close it. Until it
> exists, if you depend on an MCP there, open one page with it before you trust it.

Eight days later, the bug that section describes was found — sitting in exactly the hole it named,
and it had been there since the day the section was written. The paragraph even told the reader the
workaround ("open one page with it before you trust it") and predicted the fix ("driving them over
stdio").

This is [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md), and the
already-named class is
[260902e — a comment that named the latent hole, and left it latent](260902e-a-comment-that-named-the-latent-hole-and-left-it-latent.md).
What this instance adds is the **cost of the delay made concrete**: 260902e's hole was theoretical
when written and stayed theoretical until Sol found it. This one was already occupied. A written-down
hole is not a discharged duty; it is an open liability that starts accruing the day it is written, and
the more accurately it is described the more it reads as handled.

The practical form: **when you write "nothing checks X", put a date on it and treat it as a work item
with a deadline, not as documentation.** Eight days was the answer here and nobody chose it.

## What would have caught it, ranked by ease against value

1. **Drive the thing an agent actually uses, once, over stdio.** Done —
   [`scripts/remote-smoke-mcp-browser.mjs`](../../scripts/remote-smoke-mcp-browser.mjs), run by
   `gjd-remote doctor` as the **`browser mcp`** check, separate from `browser` so the two fail
   independently. Four things in it are load-bearing and each is a way it could have passed while the
   servers were broken: it calls a tool that **opens a page** rather than `tools/list`; it asserts a
   **marker string** out of the response rather than "no error came back"; it reads the argv out of
   `claude mcp get` so it tests **the registration that exists** rather than one retyped into the
   check; and it starts **two of each concurrently**, with **distinct markers**, so two servers that
   ended up sharing one browser fail rather than agreeing with each other. Seen red with the flag
   removed and green with it restored, and red again after the handler was refactored.
2. **Free, and it would have caught all three drifts: when a comment's subject is plural, grep the
   block for its consequence.** One `grep -c isolated` over the two `add_mcp` lines. Costs seconds,
   generalises to every shared-reason comment in the tree, and is the only item here that would also
   have caught the version pinning.
3. **Cheap: say what a green check licenses, as a sentence with a subject, before believing it.** The
   three green checks here survive that test for about four seconds each. Belongs beside the ladder
   table above rather than as a new rule doc.
4. **Build both registrations from one argv table rather than two hand-written strings**, so a flag
   that applies to both is written once. Worth doing when the block is next touched; not done now,
   because the two servers disagree on flag *spelling* (`--executable-path` versus `--executablePath`)
   and a shared string would need a per-server rename map — which is more machinery than two lines
   deserve until there is a third server.
5. **Done, but only as a regression guard, and it is not on this class's axis.** Provisioning now
   asserts `--isolated` on **each** server separately (`playwright mcp isolated`,
   `devtools mcp isolated`). Judged on the class it is the wrong move — a longer `grep` list is still
   a check on a string, still passes when the package cannot install, and risks making the block
   *look* better covered than it is. It is here for the narrower reason that this exact text has gone
   wrong once and provisioning is the only thing that runs on a rebuild. Two checks rather than one
   covering "the browser MCPs", deliberately: a single check would reproduce the original mistake of
   one assertion standing for two lines. **Do not read these as closing the hole** — the comment
   above them in `provision.sh` says so too.
6. **Rejected: pin the MCPs as repo dependencies and register a local path.** Removes the `npx`
   resolution entirely and would have made the version drift impossible. Too large for the problem,
   couples the box's tooling to this repo's `package.json`, and literal version constants plus item 1
   get most of it.

## The fix that is right for the long term, and the part still open

What shipped is right as far as it goes: a behavioural check, aimed at the real subject, run
concurrently, proved red before green.

**It is not yet where the class lives.** `gjd-remote doctor` is run by a person from the laptop, when
somebody suspects something. Provisioning — the thing that runs when the box is *built*, and the only
moment at which a misconfiguration is guaranteed to be looked at — still ends green on the same three
registration-text checks it always had. A rebuilt box with a broken MCP registration would provision
cleanly today. Closing that means provisioning running the smoke script itself, which is more than
this commit took on; until it does, **half of this class is still open at the place it entered.**

That comment block has been corrected — it said *"Nothing here or in `gjd-remote doctor` yet drives
the MCP itself … browser-control.md records it as the known hole"*, and both halves were false the
moment `browser mcp` landed. It now says which check owns the effect, why that check cannot live in
provisioning (it is a repo script; provisioning must work on a clean `/home` with no checkout), and
points at the docker check twelve lines below as the rule it is knowingly falling short of. **A
comment that describes a hole after the hole is filled is the same failure this postmortem is
about**, one artefact further out: prose asserting a state of the world that nobody re-checked.

## The thing I would tell myself

I read three green checks and treated them as three pieces of evidence. They were one piece of
evidence, repeated at three levels of expense, about a subject nobody had asked about — and the most
expensive of the three did the most damage, because *it launched a real browser* and that felt like
proof. The question I never asked was the trivial one: **which of these ever opened a page through the
thing I am about to depend on?** None. I knew the answer before I looked, because it was written down
in `browser-control.md` under a heading that said so, and I read that heading as a note about a
tidiness debt rather than as a live warning that the exact failure it described might already be
happening. It was.
