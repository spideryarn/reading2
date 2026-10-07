# An MCP server for Spideryarn, so an agent can drive it as you

**Status as of 2026-10-07: the local MCP server is built, reviewed and on `dev` (not deployed; it
needs no deploy, since it changes nothing on the server). Signing in to production is Greg's to
try first; the remote version, the private link and `list_users` wait on his answers (question
`q-arfr76`; queue items `qi-n9ntngfq`, `qi-2a8nh33e`).** Report `spya-bkkjzy` (SPIDERYARN-READING2-EE),
Greg's (admin, proved by `feedback-reporter.ts` exit 0 on the production row). Queue item
`qi-8nzqtx7h`.

## What Greg asked for

The full words are in the note,
[261006_2227-mcp-server-for-spideryarn.md](../user-feedback/261006_2227-mcp-server-for-spideryarn.md).
The parts that shape the design:

> I'm going to need to capture big lists of people and why and who and what they might, you know,
> which articles they might be interested in seeing in Spideryarn … that's probably best done within
> an agentic interface like Claude CoWork or similar. And so I think probably the most useful thing
> would be if Spideryarn had an MCP that that agentic interface could query and drive.

> what would be even better would be if actually the MCP allows you to do whatever you were already
> allowed to do. So if you're an admin, you can create gift vouchers. If you're not an admin, you
> can't create gift vouchers. … If that's too complicated, well, let's make a note of that as the
> dream, and the V1 would just be for admins.

> In an ideal world … I'd give it to Claude Co-work, and Claude Co-work would prompt an
> authentication into Spideryarn, which would then, you know, reopen Claude Co-work or something
> like that. I don't want it to be Claude Co-work specific, but it's a good example.

> try and just get something working first, if you possibly can. And then, you know, obviously run
> spikes to test this MCP.
>
> — Greg, 2026-10-06 (`spya-bkkjzy`)

## Background, in plain words

**MCP** (Model Context Protocol) is the standard way an AI app such as Claude Desktop, Cowork or
Claude Code is given *tools*: named actions with typed inputs, such as `list_articles` or
`create_gift_voucher`, which the model may call. An **MCP server** is the program that provides
those tools. It runs in one of two ways:

```
LOCAL (stdio)                                   REMOTE (Streamable HTTP)
┌───────────────┐  stdin/stdout  ┌──────────┐   ┌───────────────┐  HTTPS + OAuth  ┌─────────────┐
│ Cowork/Claude │ ─────────────▶ │ our MCP  │   │ Cowork/Claude │ ──────────────▶ │ spideryarn  │
│ Desktop/Code  │                │ program, │   │ (any device)  │                 │ .com/api/mcp│
└───────────────┘                │ on your  │   └───────────────┘                 └─────────────┘
                                 │ Mac      │── HTTPS + your session ──▶ spideryarn.com/api/…
                                 └──────────┘
```

- **Local**: the AI app starts our program on your own computer and talks to it over stdin and
  stdout. Our program signs in to Spideryarn as you and calls the same `/api/…` addresses the web
  app calls. Nothing on the server changes.
- **Remote**: Spideryarn itself answers MCP at an address such as `https://www.spideryarn.com/api/mcp`.
  The AI app sends you through an OAuth sign-in ("Connect Spideryarn → sign in → Allow → back to
  Cowork"), which is the flow Greg described as ideal. That needs Spideryarn to act as an OAuth
  server, which means changes to sign-in, a listed defence.

## What the research found

Checked 2026-10-07 by a research subagent, with sources; the uncertain points are marked.

- **The whole of what Greg listed already exists as authenticated API routes**, all behind the one
  gate (`requireUser`) and, for vouchers and users, the admin prefix gate. Listing articles, tags,
  jobs, vouchers and users; importing a URL; adding a tag; creating, editing, revoking and re-sending
  a voucher (with its name, its note to them, and its private note); turning a private link on;
  making an article public; and turning on "run the main modes after import" (`autoModes` on
  `/api/reader`, which is what "which modes should be default imported" is today: one on/off switch
  for seven modes, not a per-mode choice).
- **No route checks anything but the Bearer token**: no Origin header, no CSRF token. A Node program
  holding a Supabase access token is indistinguishable from the browser
  (`src/auth.ts` § `requireUser`, `src/web/lib/api.ts` § `apiFetch`).
- **Cowork runs local MCP servers, on the desktop app only** (Mac and Windows), and remote custom
  connectors everywhere ([support article 14680753](https://support.claude.com/en/articles/14680753),
  [connectors docs](https://claude.com/docs/connectors)). *Unverified*: whether a server added to
  `claude_desktop_config.json` shows up inside Cowork, as against one packaged as a Desktop
  Extension or a plugin. Greg is the one who can check that.
- **Remote connectors need OAuth for per-person identity.** A fixed API-key header exists only as a
  limited beta, set by an org owner for every member
  ([authentication docs](https://claude.com/docs/connectors/building/authentication)).
- **Supabase can be that OAuth server**, in beta: switch it on in the dashboard, host a consent page,
  and Supabase issues ordinary Supabase JWTs carrying a `client_id` claim, signed by the project's
  keys, so our existing JWKS check would very probably accept them
  ([oauth-server](https://supabase.com/docs/guides/auth/oauth-server),
  [mcp-authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)).
  *Unverified*: how it treats the `resource` parameter (audience binding, which the MCP spec
  requires), and whether it works end to end with Claude's connector flow.

## The decision: local first, remote as the next step for Greg

**V1 is a local (stdio) MCP server that signs in as you and calls the existing API.** Reasons:

1. **It is the dream, for free.** Every tool is a call to a route that already decides what *this*
   person may do. An admin's `create_gift_voucher` works; a reader's gets the server's own 403. A
   reader's `import_article` spends their free allowance and gets the 402 when it is gone. Nothing
   in the MCP layer decides permissions, so it cannot get them wrong.
2. **No server change, so no deploy and no defence edit.** It works against production the day Greg
   signs in, and an unattended run may build and test all of it.
3. **The tools are written once.** They take an "API caller" and know nothing about stdio, so the
   remote server later wraps the same list (§ Deferred).

**The simpler option passed over: a hand-written JSON-RPC loop instead of the MCP SDK.** MCP over
stdio is a handful of message types and would be ~150 lines. Passed over because the protocol is
still moving (spec revisions 2025-06, 2025-11, 2026-07) and a hand-rolled copy would rot quietly;
the official SDK is the boring choice.
**That is new dependencies: `@modelcontextprotocol/server` 2.x and `zod` 4, plus
`@modelcontextprotocol/client` 2.x as a dev dependency for the tests and spikes** — named here so
they are decided, not inherited. 2.x rather than the long-standing 1.x line
(`@modelcontextprotocol/sdk`) on measurement: installing 1.32.1 added **80 packages** to the
lockfile (Express, Hono, CORS, rate-limit middleware and their trees, for HTTP servers a stdio
program never starts); 2.x split the server into its own package, whose only dependencies are its
`core` and `zod`, **+147 lockfile lines** in all. 2.x is the line the SDK calls stable and targets
spec 2026-07-28.

### How you sign in, locally

Greg signs in to production with Google, and a local program cannot ride a browser's Google
session without either a change to Supabase's allowed redirect addresses (production config) or
copying the browser's refresh token (which would sign the browser out, because Supabase rotates
it and treats reuse as theft). So V1 uses **email and password**, which production already
supports:

```
npx tsx scripts/spideryarn-mcp.ts login --site https://www.spideryarn.com
  Email: greg@…          Password: (not echoed, not stored)
  ✓ signed in as greg@… (admin) — session saved to ~/.config/spideryarn-mcp/www.spideryarn.com.json (0600)
```

The password is used once and forgotten. For an account that has only ever used Google,
*Forgot password* on `/login` sets one (plan 261001i); *unverified* that Supabase allows this on
a Google-only account in our project (the production database role cannot read `auth.identities`,
checked 2026-10-07). **Signing in to production and making one read-only call is Greg's first
step, and the only proof that matters** (Sol F6).

**The session file is a new piece of authentication, and is built as one** (Sol F3). It holds an
access token and a refresh token. Supabase *rotates* the refresh token on every use and treats
reuse of an old one (outside a short grace window) as theft, revoking the session. An AI app may
start several copies of the server at once, so:

- `~/.config/spideryarn-mcp/` is created `0700`, the file `0600`; a file that is not a regular
  file owned by us, or is readable by others, is refused rather than used.
- Written whole, by write-to-temp then `rename`, so a crash never leaves half a file.
- **Refreshed under a lock** (an exclusive lock file, stale after 30 seconds): take the lock,
  re-read the file, refresh only if the token *in the file* still needs it, write, release. A copy
  that waited finds the fresh token and does not refresh again.
- No Supabase client library: three plain calls to the Supabase Auth REST API (password grant,
  refresh grant, logout), so the token handling is all in one small file.
- **The tokens never leave that file and the `Authorization` header**: not stdout, stderr, a tool
  result or an error message. Tests plant sentinel tokens and look for them everywhere.
- `logout` revokes the session at Supabase and deletes the file.

The Supabase address and publishable key the program needs are public (they are baked into every
page's JavaScript). `login` reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (else
`SUPABASE_ANON_KEY`, the server's own fallback) from an env file (`--env-file .env.prod` for
production; `.env.local` by default, for the local stack) and writes them into the session file,
so `serve`, which is what the AI app runs, needs only `--site`. No secret is read: not the
service-role key, not the database URL.

## The tools (V1)

"Admin" means the server refuses everybody else with 403. Most tools are one route.

| Tool | Route | Notes |
|---|---|---|
| `whoami` | token claims + `GET /api/reader` | who you are, whether auto-modes is on |
| `list_articles` | `GET /api/library` (twice for `all`) | `archive`: `active`, `archived` or `all` (Sol F9); trimmed to slug, title, url, link, added, tags, words, visibility, private link on/off |
| `search_library` | `GET /api/library/search` | full-text over your shelf |
| `list_tags` | `GET /api/library/tags` | |
| `edit_tags` | `PATCH /api/library/:slug/tags` | `add`, `remove` |
| `import_article` | `POST /api/jobs` `{url}` | uses an allowance slot (admin exempt); returns the job |
| `get_import_status` / `list_imports` | `GET /api/jobs/:id`, `GET /api/jobs` | |
| `set_auto_modes` | `PATCH /api/reader` `{autoModes}` | the "default modes on import" switch |
| `make_article_private` | `PUT /api/article/:slug/visibility` `{visibility:"private"}` | |
| `make_article_public` | the same, `{visibility:"public", rightsConfirmed:true}` | **asks the human** (below) |
| `list_gift_vouchers` | `GET /api/admin/vouchers` | admin. Trimmed (Sol F17): id, address, name, count, created, claimed, revoked, email status, whether there is a note; not the notes' text or the claimant's usage |
| `create_gift_voucher` | `POST /api/admin/vouchers` | admin. **Sends the gift email; asks the human** |
| `update_gift_voucher` | `PATCH /api/admin/vouchers/:id` | admin. Changing the *email* re-sends, so that change **asks the human**; name, notes, count and revoke send nothing and do not ask |
| `retry_gift_voucher_email` | `POST /api/admin/voucher-emails/:id/retry` | admin. **Sends; asks the human** |

Every article in a result carries its link (`https://<site>/read/<slug>`), because the agent will
want to put it in a message.

### Sending mail and publishing ask the human, in a dialog the model cannot reach (Sol F1, F12)

The agent Greg describes reads his email, and an email can contain instructions. Tool annotations
(`destructiveHint`) are hints a client may ignore, and a `confirm: true` argument is something the
model can simply supply. So the tools that send mail, and the one that publishes, **open a native
macOS dialog on Greg's screen**, from the MCP server itself, naming the exact operation, and send
nothing unless he presses *Approve* within two minutes:

```
┌ Spideryarn: send a gift email? ───────────────────────┐
│ To: ada@example.com  (Dear Ada,)                      │
│ 20 free articles, on www.spideryarn.com               │
│ Note to them: "I thought you'd enjoy …"               │
│                                    [Cancel] [Approve] │
└───────────────────────────────────────────────────────┘
```

Publishing asks the same way, and the dialog carries the rights sentence from the article's card,
because `rightsConfirmed` is the owner's attestation, not the agent's (Sol F7). **Not on macOS,
those tools refuse** and say to use `/admin/vouchers`. The dialog's text reaches `osascript` as
arguments, never inside the script, so an address or a note cannot inject AppleScript.

**How this was decided.** The first revision used MCP *elicitation* (the server asks the host app to
put a question to the person) plus a `--allow-without-asking` flag for hosts without it. Sol's
round 2 (F12) objected that an elicitation answer is whatever the client sends back, so nothing
proves a person gave it, and that the flag silently restored the injection path. Opus arbitrated:
under MCP's threat model the host is Greg's own app and the attacker controls only the model's
words, so elicitation is sound *in principle*; but which hosts render it to a person is unverified,
the flag was a footgun, and a page in a browser the agent drives (Cowork drives Chrome) would not
be out of band either. The native dialog is out of band, works in every host, and needs no
protocol machinery (it also removes Sol's F16, the signed request state elicitation would have
needed). **Sol's F12 objection to the flag is accepted. Its wider point, that elicitation proves no
human, is moot because elicitation is no longer used.** One limit, written down: an agent with
*computer use* switched on could in principle click the dialog itself; that is a separate
capability Greg grants explicitly, and the doc says so.

### A retry sends one gift, not two (Sol F2, F13)

The voucher id is derived from **the site, the signed-in user and a required `idempotency_key`
alone** (a name-based UUID), never from the gift's contents. An agent that retries with the same key
and the same gift reaches the server's existing replay path (`200 replayed`, nothing sent); the
same key with a *changed* gift reaches the server's existing `409`, rather than quietly making a
second voucher. A genuinely second gift needs a new key, and the tool's description says so.

### One reader per server (Sol F14, F15)

A running server is bound to the account it started as. It re-reads the session file before every
call and after every refresh, and refuses the call if the file is gone (`logout`) or now holds a
different account (`login` as somebody else); a 401 is never retried as anybody else. Login,
refresh and logout all take the same owner-tagged lock, a refresh has a 10-second timeout under a
30-second stale threshold, and logout signs out **this session only** (`scope=local`), not every
device.

**Not in V1, and why:**

- **`get_allowance`** (Sol F17). Reading the allowance claims gift vouchers addressed to you and can
  send the claim notice, so it is not a read; and the admin has no allowance to read.
- **`list_users`** (every reader's address). Greg asked for *"lists of user email addresses"*,
  and it is one tool. Left out until he says yes, because it puts other readers' addresses into an
  AI provider's conversation, which `privacy.md` does not mention, and an agent reading untrusted
  email is exactly the thing that could be talked into passing them on. **Question 3.** Creating a
  voucher does not need it: the server already knows whether the recipient has an account.
- **The private (key) link.** Greg asked for "create a shareable link". The private link's key is a
  credential, and
  [security-map.md § a second way in, which is a key](../project/security-map.md#and-since-2026-10-05-there-is-a-second-way-in-which-is-a-key)
  lists exactly where it may travel; *into an AI model's context and conversation history* is not
  one of them. **Question 2.** `make_article_public` gives a shareable link with no key, with
  Greg's approval each time.
- **Choosing which modes run on import, one by one.** Today it is one switch for seven modes. A
  per-mode choice is a product change to the add page and the reader profile, not MCP work.
- **A people list inside Spideryarn** (who, why, how you know them, which articles). Greg's agent
  keeps that list in its own notes or a spreadsheet; Spideryarn holds only what it acts on
  (vouchers, with their name and notes).
- **Remote MCP with the Cowork sign-in flow.** § Deferred.

## Stages

1. **The tool layer and the stdio server, against a fake API.** `src/mcp/`: the session (sign-in,
   the locked and atomic file, refresh), an API caller (the Bearer token, the server's `{error}`
   turned into a tool error), and the tools as a list that knows nothing about stdio.
   `scripts/spideryarn-mcp.ts` with `login`, `logout`, `whoami`, and `serve` (the default, what an
   app runs). Tests with a fake `fetch` and the SDK's in-memory client: each tool calls the route it
   claims with the body it claims; a 403 and a 402 come back as readable tool errors; the asking
   tools call the approver and make no request on *Cancel*, and no argument can stand in for it;
   the `osascript` arguments never carry the dialog text inside the script; two
   refreshes racing produce one refresh call; sentinel tokens appear in no output; nothing but
   protocol reaches stdout. **Done when** `npm test` and `npm run typecheck` pass.
2. **Spikes against the real local stack** (Sol F6). Signs in as the local admin and as
   `dev-reader-b`, runs the real server over stdio with the SDK's client, and checks *presence and
   absence*: the admin tags one of their articles with a fresh canary tag; reader-b's
   `list_articles`, `list_tags` and `search_library` must not contain it, and reader-b's
   `edit_tags` on that slug must be refused. Every admin tool under both identities (reader-b
   refused each time; the admin succeeding is the positive control). A voucher to an
   `@example.com` address (local never sends mail, `email.md`), sent twice, gives one voucher;
   then revoked. The asking tools run with an approver stubbed to *approve* (the box is not a Mac), and
   once with the real default approver to see it refuse. Then one deliberate break, to watch the
   spike fail: give reader-b's run the admin's session and see the absence check go red. Production, read-only and with no
   credentials: the 401 the client expects. **Done when** the output is pasted here.
3. **Docs and hand-off.** `docs/project/mcp.md` (how to install it in Claude Desktop, Cowork and
   Claude Code; what each tool does; how sign-in works; the safety rule), its line under
   `architecture.md`, the questions below, overseer-queue entries for each deferred half, the
   note.

## What landed

**Stage 1** (commit after `Plan 261007j: …`): `src/mcp/` and `scripts/spideryarn-mcp.ts`, 67
tests in `tests/mcp-{tools,session,stdio}.test.ts`, built by an Opus subagent. Red then green, each
break reverted: ignoring the approver's answer (4 red), skipping the re-read under the lock (2),
a no-op lock (4), the session binding off (3), one `process.stdout.write` in `serve` (1). Decided
while building: `retry_gift_voucher_email` takes the voucher id and which email (`gift` or
`claimed`) rather than the email row's id, so the dialog can name the address; all CLI output goes
to stderr; an existing session directory that others can merely read is tightened to 0700 rather
than refused.

**Stage 2, the spike** (`scripts/spikes/261007j-mcp-local-spike.ts`, 2026-10-07, against the shared
local stack on port 5273): **30/30**, by a Sonnet subagent.

- Both readers signed in by `login`; the real server over stdio listed 15 tools, `whoami` right for
  each.
- The real approver on this Linux box refused `create_gift_voucher`: *"Sending mail and publishing
  need a confirmation dialog, which this server can only show on macOS … Nothing was done."*
- Presence and absence: the admin's canary tag on `john-von-neumann-spya-yx9t8u` showed in the
  admin's `list_tags` and `list_articles` and in neither of reader-b's; reader-b's search had
  `hits: []`; reader-b's `edit_tags` on that slug got the server's 404 (*"No article artefacts
  for …"*), which does not confirm the slug exists. Canary removed. **Search proves less than
  it looks** (Sol's C10): it does not index tags, so the canary cannot appear in anybody's search,
  and reader-b's empty `hits` show only that the admin's slug was not among them, with no positive
  control. The isolation claim rests on `list_articles`, `list_tags` and `edit_tags`.
- All four admin tools under reader-b: *"Spideryarn refused: That page is for the site's
  administrator. [admin-only]"*.
- Admin, approver stubbed to approve: a voucher to an `@example.com` address `queued`; the same call
  again `replayed`, one voucher; the same key with 2 articles refused (*"That idempotency_key was
  already used for a different gift; nothing was sent"*), still one; then revoked.
- Deliberate break: the absence check run on the admin's session went red
  (`{"articles":true,"tags":true,"search":false}`): the two list checks can fail; search, as
  above, could not.
- Production, no credentials: `GET /api/library` → 401; `whoami` with no session → one line,
  exit 1, no stack trace. No production sign-in was attempted.
- Not exercised: `import_article` for real (it spends model money on the shared box); the tool's
  own URL check refused `not a url` before the server saw it.
- Found: `set_auto_modes` returned the whole reader profile, profile text included, into the
  model's context. Trimmed to `{ autoModes }` in the code review stage.

**Still unproven, and only Greg can prove it:** signing in to production (does *Forgot password*
give a Google account a password?), the dialog on a real Mac, and whether Cowork sees a server from
`claude_desktop_config.json`. [mcp.md](../project/mcp.md) is the set-up.

## Deferred, with queue entries

- **Remote MCP (the Cowork sign-in flow), once Greg answers Question 1.** Not a routing detail
  (Sol F5): an OAuth token issued for the MCP must be bound to `/api/mcp` and must not be replayed
  to the rest of `/api/*`, which the MCP spec forbids and which would give a connector more than its
  tools. So the remote server is one audience-checked route that runs the same tool list against
  the already-verified user, calling the operations beneath the routes directly rather than over
  HTTP; and scopes are decided before Supabase OAuth is offered to anyone but Greg. Touches
  `src/routes.ts` and `src/auth.ts`, two listed defences.
- **`list_users`, if Greg says yes to Question 3.** One tool.
- **The private link, if Greg says yes to Question 2.** One tool.

## Questions for Greg

**Question 1: should it also work from Cowork on the web or phone, and how should it sign in?**
On your Mac the local server already works, in Claude Desktop, Cowork-on-desktop and Claude Code.
This is only about using it from elsewhere, or by other people.

- **A. Stay local (recommended for now).** Nothing more to build. Mac only.
- **B. A fixed key, for you alone.** `/profile` gets *"Create an MCP key"*; you paste it into a
  custom connector's settings in Claude, which supports fixed request headers. About half a day.
  The simplest remote option, but in a Team or Enterprise organisation one key is shared by
  everyone who uses that connector, so it suits one trusted admin and not other readers; and it is
  a long-lived credential we must let you revoke.
- **C. OAuth, through Supabase's OAuth server.** You add Spideryarn as a connector by address; it
  opens a Spideryarn page saying *"Claude wants to act as you on Spideryarn — Allow?"*; you are
  back in Cowork. The flow you described, and the only one that works per reader. A day or two:
  Supabase's feature is in beta, you switch it on in the dashboard, and the consent page, audience
  checks and scopes are all new sign-in code.

What decides it: A until you find yourself wanting it away from the Mac; B if that is only ever
you; C when other readers should have it.

**Question 2: may an agent hold a private link's key?** The private link (`/read/<slug>?key=…`) is
a credential. Letting the MCP fetch it means the key passes through the AI model and sits in the
agent's conversation and notes, the same as pasting it into the gift note by hand (which plan
261007f asked you about). **Yes** adds one tool (`get_private_link`, turning it on if it is off,
asking you first). **No** leaves the agent with *make it public*.

**Question 3: may the agent list every reader's email address?** You asked for it, and it is one
tool over `/admin/users`. The cost: every reader's address goes into the AI provider's
conversation and the agent's notes, which the privacy page does not cover today, and an agent
reading untrusted email could be talked into passing the list on (it would still need your
approval to *send* anything through Spideryarn, but not through its other tools). **Yes** adds it,
and the privacy page gets a line. **No** leaves the agent with the vouchers list, which holds only
addresses you typed yourself.

## Review

**Plan review, round 1 (GPT Sol, 2026-10-07):** `VERDICT: rethink`, eleven findings,
[261007j-mcp-server-plan-review-sol.md](261007j-mcp-server-plan-review-sol.md). All taken: F1
(annotations are not a gate) → elicitation, § Sending mail and publishing ask the human; F2 →
content-derived voucher ids; F3 → the session file built as a defence; F4 → SDK 2.x (already
switched, on measurement); F5 → remote MCP reframed in § Deferred; F6 → presence-and-absence spike
with a deliberate break; F7 → `rightsConfirmed`, asked of the human; F8 → `get_allowance` described
honestly, `list_users` out pending Question 3; F9 → `archive` input; F10 → Question 1 rewritten;
F11 → the note is written with the plan. Sol agreed the private-link deferral is right.

**Plan review, round 2 (GPT Sol, 2026-10-07):** `VERDICT: rethink`, seven findings,
[261007j-mcp-server-plan-review-2-sol.md](261007j-mcp-server-plan-review-2-sol.md). Discovery
closes here (two rounds). Taken: F13 → the id from the key alone, § A retry sends one gift, not
two; F14, F15 → § One reader per server; F16 → moot, elicitation dropped; F17 → `get_allowance`
dropped, the voucher list trimmed; F18 → the note exists. F12 went to Opus as an overruled-in-part
P0, § Sending mail and publishing ask the human: *Sol still objects that an elicitation result is
client-supplied and so does not prove a human decided; overruled because MCP's threat model trusts
the host and our adversary controls only the model's output, and the gate is now a native dialog
outside the host altogether. Sol's objection to `--allow-without-asking` is accepted; the flag is
gone.*

**Code review, round 1 (GPT Sol, 2026-10-07, write-capable, on `33c268b00`):** `VERDICT: not
ready`, ten findings,
[261007j-mcp-server-code-review-sol.md](261007j-mcp-server-code-review-sol.md). Sol fixed eight,
each red first: C1 two simultaneous stale-lock takeovers (a short gate now serialises them); C2 a
token without `sub`/`session_id`, or with a `sub` the file disagreed with, was bound; C3 an asking
tool could open its dialog unbound and run after another reader signed in; C4 a retry re-read the
voucher after approval and could send a different delivery; **C5 (P0) a token could reach a result
or an error after a refresh, now scrubbed from every response**; C7 `set_auto_modes` returned the
reader's profile text; C8 argument parsing; C9 a stdio test that hung when it could not listen.
Reported, and settled here: **C6** the retry dialog showed the voucher's *current* name, count and
note, but a retry re-sends the email as first written. Fixed by the orchestrator without touching
the route: the dialog now names only the address and says the email goes exactly as first written,
with a test that it holds none of today's fields. **C10** the spike's search check proves less than
it claimed; § What landed now says so. Gates after the fixes: the three MCP suites 80/80,
typecheck green, biome clean. The not-ready verdict rested on C6, which is fixed. A second round
was not run: the fixes are narrow, and each has its own red-first test.
