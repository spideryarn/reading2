# Building a dashboard for a fleet of coding agents

Not project-specific. What to know before you build a web page that watches — and eventually
steers — a lot of coding agents running on one machine.

Written 2026-09-08, after a day of finding out which of the obvious approaches actually work. Most
of the cost was in two places: **a message channel that reported success and delivered nothing**, and
**a data source that is fast, first-party, and quietly incomplete**. Both are below.

This repo's own instance is [orchestrator-direction.md](../project/orchestrator-direction.md), which
holds the decisions; this file holds the parts that travel.

## Why you would build one at all

If you run one or two agents, you do not need this: the CLI prints a table and the agent's own UI is
right in front of you. It starts to pay when you have **fifteen or more sessions across several
worktrees and repos**, because three questions stop being answerable at a glance:

- Which of these is blocked on *me*, right now?
- Which of these has been "working" for six hours and has committed nothing?
- What did they decide without asking?

Only the first is something an agent's own UI shows you, and it shows it one session at a time. The
fleet view is the product. **Check first whether your harness already gives you a phone client** —
Claude Code's Remote Control does, and most sessions here had it switched on without anyone asking.
If one-at-a-time is enough, stop; you have just saved a week.

## The shape that works

Four pieces, and the middle two are the ones people skip:

1. **A collector** that asks the machine what is running.
2. **A cache**, refreshed on a timer, because collection is slow.
3. **A tiny server** bound to a private interface, serving the cached snapshot.
4. **A page** that always says how old its data is.

**The cache is not an optimisation, it is the design.** Our collection takes about twelve seconds,
because the underlying script greps whole transcripts — tens of megabytes each, times forty
sessions — for the agent's own title. No request can wait for that, and the machine must not run it
once per viewer. So a background loop refreshes and every request is served instantly from the last
good snapshot.

**A failed refresh must keep the previous snapshot and mark it stale**, never blank the page. An
empty fleet is the reading least likely to make anyone look, and a page that has silently stopped
updating is indistinguishable from a quiet morning. Put the age on the page, in words, always.

## Seeing the fleet: the trap

Your harness probably has a fast machine-readable listing. Claude Code has `claude agents --json`:
about a second, spans every repo on the box, gives busy/idle/waiting per session. It is the obvious
data source and it is **not sufficient on its own**.

> being absent from it does not mean not running

Measured twice: a live session was missing from that listing for 35+ seconds after starting. If you
trust it alone, a running agent renders as "gone" — and "gone" is the one status nobody
double-checks.

**So join two sources: the harness's own listing, and the process table.** The listing is the only
thing that can tell busy from idle from parked-on-a-question; the process table is what stops an
unlisted session being reported dead. And keep a distinct **"could not ask"** status: folding it into
"nothing is happening" produces a screenful of confident wrong answers that looks exactly like a
quiet machine.

If something in your codebase already does this join, call it rather than writing a second one. Ours
had solved it months earlier, in a file with a long comment explaining every clause, and the first
draft of the dashboard reinvented it worse.

## Talking to a session: what actually works

This is where a day went. **Test delivery with a nonce, not with a string you typed.**

We found a documented inbox socket, connected to it from an outside process, sent the documented auth
and message frames, got no error, and then found the test string in the target's transcript. It
looked like a clean success. It was **the sender's own command text**, echoed into the transcript by
the harness. Nothing had been delivered.

Two controls settled it: a nonce generated *inside* the sending script and written only to a file —
so it could never appear in a command — produced zero hits; and a separate idle session, sent three
frames, displayed nothing. Correct token, wrong token, and no auth line at all all behaved
identically: connection accepted, no error, no delivery.

The general rules, which are worth more than the specific finding:

- **A socket write that cannot fail tells you nothing.** Treat "no error" as no information.
- **Never verify delivery by grepping for a string you typed**, anywhere the harness records your
  own commands. Generate the token inside the process under test and pass it out of band.
- **Verify on the receiver**, not the sender.

What *did* work was the crude thing: **sending keystrokes to the terminal multiplexer pane**. Two
keys answered a real modal dialog. That is the channel to build on until something better is proven.

But it is not universal, and pretending otherwise produces a UI that lies:

- A **batch/non-interactive agent process** may be spawned with stdin explicitly closed — ours are,
  deliberately, as an anti-hang guarantee — so it can never receive a keystroke.
- A **bare shell** will *execute* what you send it as a command.

So the per-harness capability is a real distinction, and the honest UI shows those rows as read-only
rather than offering a text box that quietly does nothing or something terrible.

## "Needs you" is usually a menu, not a prompt

The thing that reframes the product. We assumed a blocked agent wanted a message. Captured live, a
blocked session looked like this:

```
│ This loop stops when you close this session. Set it up as a cloud schedule instead?
❯ 1. Cloud schedule (recommended)
  2. This session only
  3. Type something.
Enter to select · ↑/↓ to navigate · Esc to cancel
```

**A numbered modal dialog cannot be answered by a message.** It is answered by a digit. So the
highest-value thing the page can do is not a chat box — it is *show the question and its options, and
send one keystroke*. That is also far safer than typing prose into an unknown UI state, because you
can see the menu before you answer it.

Watch for the false positive, which is the dangerous direction: an agent writing a numbered list in
ordinary output must not be read as a menu, or you will invite someone to send a keystroke into a
session that is mid-task.

## Access without writing auth

You are building something that can run arbitrary code on a machine holding source and credentials.
The best move is to write **no authentication at all**, and let the network decide who gets to knock.

Ranked by blast radius, smallest first:

- **A private network overlay** (Tailscale and friends): the server binds the overlay interface and
  there is no public listener. Reachability is the access control. Costs a client on the phone.
- **An identity-aware tunnel** (Cloudflare Tunnel + Access): outbound-only from the machine, so no
  inbound firewall hole, and a real login you did not write. Costs a domain in their DNS and a few
  clicks. **If you take this route, verify the signed assertion (the JWT) — never trust the plain
  identity header.** A private-network IP is unforgeable at the network layer; an HTTP header is not,
  and a valid identity cookie still does not prove a human pressed your button, so you need CSRF
  protection too.
- **An ssh port-forward**: nothing to set up, nothing exposed, and no phone.
- **Auth you wrote yourself on a public port**: the largest blast radius of the credible options, and
  the one where a single logic bug is a full compromise.
- **An unauthenticated public tunnel** of any kind: disqualifying. Not "risky" — disqualifying.

Keep the ssh forward working whatever else you add. It is the fallback that depends on nothing.

## Scheduling: check what you already have

"Nudge an agent every three hours" sounds like a cron job and usually is not one you should write.
Check the harness first, and check *where* its scheduler runs: ours offers a durable cloud schedule
and a session-local one. The cloud schedule survives the session but **executes somewhere else**, so
it cannot touch the machine's working directories; the session-local one dies with its session,
silently, leaving a gap in a log as the only evidence.

If you do build one, the hard part is the target, not the timer. A schedule pointing at a session
that has died must not deliver to whatever took its process id — and "the right text to the right
session at the wrong time" is a real failure: three hours later the agent may be mid-task, finished,
or on something else entirely.

## Rules that earned their place

- **Address a session by its multiplexer pane handle plus an execution generation, never by name.**
  Names get reassigned when a session dies and another takes it. Two independent systems here learned
  this the same way, one of them after an hour of messages going to a stale name.
- **Read-only until a channel is proven.** A write path that silently does nothing is worse than no
  write path, because it looks like it worked.
- **Every field on that page is text an agent wrote.** Titles, branches, directories. Escape all of
  it: a title containing markup runs as script in the one browser session that can see the whole
  fleet.
- **Keep the module importable.** Ours put the HTML escaper next to `server.listen()`, so importing it
  from a test bound a port as a side effect of asking whether a `<` came out escaped.
- **Deploy from source control and put the revision on the page.** The system we took inspiration from
  reported that its served dashboard had drifted from its repository, which is the most quietly
  expensive bug available here.

## What to build first

A read-only list. No status, no colours, no actions, no auth. Get it in front of the person who asked
for it, on the device they asked for, and only then decide what the second thing is — because the
first version answered a question we had not thought to ask, and the second version we had planned
turned out to be the wrong one twice.
