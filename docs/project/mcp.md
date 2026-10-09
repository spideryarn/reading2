# The MCP server: letting an AI agent drive Spideryarn as you

Up: [architecture.md](architecture.md)

An **MCP server** gives an AI app (Claude Desktop, Cowork, Claude Code, or any MCP client) a set of
named tools it may call. Spideryarn's runs **on your own computer**, signs in to Spideryarn as you,
and calls the same `/api/…` routes the web app calls, so **it can do exactly what you can do and
nothing more**: an admin's voucher tools work, anybody else's get the server's own 403. Since
2026-10-07 the same tools can also be served from the site itself, for Claude on the web or a phone;
that version is built but switched off (§ From Claude on the web or a phone). Built for report
`spya-bkkjzy`, Greg's:

> I'd give it to Claude Co-work, and Claude Co-work would prompt an authentication into Spideryarn
> … what would be even better would be if actually the MCP allows you to do whatever you were
> already allowed to do.
>
> — Greg, 2026-10-06

The reasoning, the two reviews and the options not taken are in
[261007j](../plans/261007j-mcp-server-for-spideryarn-admins-first.md).

## Setting it up

You need a checkout of this repo with `npm install` done, and a **password** on your Spideryarn
account (an account that has only used Google can set one with *Forgot password* on `/login`).

**1. Sign in, once.** From the repo:

```
npx tsx scripts/spideryarn-mcp.ts login --site https://www.spideryarn.com --env-file .env.prod
npx tsx scripts/spideryarn-mcp.ts whoami --site https://www.spideryarn.com
```

The password is asked for without echo and used once. `--env-file` is only where the program reads
Supabase's address and public key (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` or
`SUPABASE_ANON_KEY`); no secret in it is read. The session is saved to
`~/.config/spideryarn-mcp/<host>.json`. For the local stack, use `--site http://localhost:<port>`
and the default `.env.local`.

**2. Tell the AI app to run it.** This prints both configs, with this checkout's real paths:

```
npx tsx scripts/spideryarn-mcp.ts config --site https://www.spideryarn.com
```

- **Claude Desktop**: merge its JSON into
  *Settings → Developer → Edit Config*, i.e. `~/Library/Application Support/Claude/claude_desktop_config.json`,
  then quit and reopen the app. The paths are absolute and `PATH` names `node`'s directory, because
  the app starts servers from no particular directory and with a short `PATH`.
- **Claude Code**: run the `claude mcp add --scope user …` line it prints. `claude mcp get spideryarn`
  should then say `✔ Connected`. The line sets the same `PATH` with `--env`; *Connected* checks
  the MCP connection, not whether the saved Spideryarn sign-in works (call `whoami` below).

On Greg's Mac both are set up (2026-10-09) against the primary checkout,
`/Users/greg/dev/spideryarn/reading2`, and production. Desktop's previous config is beside it as
`claude_desktop_config.json.bak-261009-spideryarn`.

**The server runs whatever code and `node_modules` that checkout has.** After a pull that changed
`package.json`, run `npm install` there, or the server dies before it speaks and the app says only
*Connection closed*. That is why it had never worked before 2026-10-09
([261009a § What the spike found](../research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md#what-the-spike-found-2026-10-09-against-the-local-stack)).

*Unverified*: whether a server in `claude_desktop_config.json` shows up inside Cowork, as well as in
an ordinary Claude Desktop chat. Cowork's documentation says local MCP servers work on the desktop
app.

**ChatGPT cannot directly launch this local stdio command.** It can connect to a remote server or
a private server through Secure MCP Tunnel; the tunnel has not been tested here. Claude Desktop
also supports installable local extensions (`.mcpb`), which we have not packaged. App-specific
setup options: [261009a](../research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md#app-by-app).

## Checking it works

Without any AI app, the MCP Inspector's CLI speaks to the server exactly as Claude Desktop would, from
the same JSON. Save the complete JSON object that `config` prints (including the outer
`{"mcpServers": …}` wrapper, without the surrounding instructions) as `mcp.json`, then:

```
npx @modelcontextprotocol/inspector --cli --config mcp.json --server spideryarn --method tools/list
npx @modelcontextprotocol/inspector --cli --config mcp.json --server spideryarn \
  --method tools/call --tool-name whoami
```

Give it the config file rather than the command: the Inspector takes the server's `--site` as one of
its own flags, and the result is a bare *Connection closed*. Through Claude Code itself, without
touching your settings:
`claude -p --strict-mcp-config --mcp-config mcp.json --allowedTools mcp__spideryarn__whoami "call whoami"`.

**When an app says *Connection closed*,** the server's stderr is in
`~/Library/Logs/Claude/mcp-server-spideryarn.log` (Desktop; connection failures also appear in
`mcp.log`), or run the `command` and `args` by hand from `/tmp`, with the JSON's `env.PATH` set.
Either shows the real error.

**To stop:** `npx tsx scripts/spideryarn-mcp.ts logout --site …` signs this session out (only
this one, not your browser) and deletes the file. A running server notices on its next call.

## The tools

| Tool | What it does |
|---|---|
| `whoami` | who it is signed in as, and whether modes run automatically on import |
| `list_articles` | your shelf (`archive`: active, archived or all), each with its link, tags and visibility |
| `search_library` | full-text search over your shelf |
| `list_tags`, `edit_tags` | your tags, and adding or removing them on an article |
| `import_article` | import a URL (uses a free article, as the web app does; one you already have answers that article, free — [261007k](../plans/261007k-repeat-paste-is-free-and-says-so.md); one somebody else has made public answers that copy, free, and `own_copy: true` imports the reader's own — [261009j](../plans/261009j-a-public-copy-offered-at-import.md)) |
| `get_import_status`, `list_imports` | how an import is going |
| `set_auto_modes` | the "run the main modes after import" switch |
| `make_article_private`, `make_article_public` | visibility; **public asks you first** |
| `create_private_link` | the article's private link, key and all, made only if none is on (an existing one is never replaced); **asks you first, every time** |
| `list_users` | admin: every account, most recently active first — address, sign-up, last sign-in, last read, article counts, plan |
| `user_activity` | admin: one account's counts and dates, by address or id; never which articles or what they wrote |
| `list_gift_vouchers` | admin: who you have sent gifts to, claimed or not (no note text) |
| `create_gift_voucher` | admin: **sends the gift email; asks you first** |
| `update_gift_voucher` | admin: edit or revoke; **changing the address re-sends, and asks you first** |
| `retry_gift_voucher_email` | admin: re-send a failed email; **asks you first** |

**"Asks you first" is a macOS dialog the MCP server itself opens**, naming the exact gift or
article, with *Approve* and *Cancel*. Nothing is sent unless you press *Approve* within two minutes.
It is there because an agent that reads your email can be steered by what is in an email, and the
model cannot press that button. (An agent you have also given *computer use* could, in principle;
that is a capability you grant separately.) Off macOS these tools refuse and point at the web page.

**A gift is sent once.** `create_gift_voucher` needs an `idempotency_key`, a short name for that
gift. Calling again with the same key and the same gift sends nothing; the same key with a different
gift is refused. A second gift to the same person needs a new key.

**The private link is a credential.** Anyone who has it can read the article, and once handed over
it sits in the AI app's conversation. Greg accepted that (2026-10-07);
[security-map.md](security-map.md#and-since-2026-10-05-there-is-a-second-way-in-which-is-a-key)
lists it among the places the key travels. **The reader tools put other people's addresses into
that conversation too**, which the privacy page says
([privacy.md](privacy.md#an-administrators-ai-assistant-can-look-up-accounts)). Both came with
[261007o](../plans/261007o-mcp-private-link-and-admin-user-tools.md).

## From Claude on the web or a phone (built, switched off)

The same tools are also served at `https://www.spideryarn.com/api/mcp`, for an AI app that cannot
start a program on your Mac. Claude signs in with OAuth: it sends you to `/oauth/consent`, you
press *Allow*, and it gets a token from Supabase's OAuth server for your account
([261007p](../plans/261007p-mcp-remote-sign-in-with-oauth.md)).

- **Off until Greg switches it on.** It accepts only the token of the one AI app whose id is in
  `MCP_OAUTH_CLIENT_ID`; unset, it refuses everyone. Before switching on, run the spike in
  [261007p § What landed](../plans/261007p-mcp-remote-sign-in-with-oauth.md#what-landed-stage-1)
  against the local stack: it has not been run against a real OAuth server. Switching on: Supabase dashboard,
  Authentication → OAuth Server on (dynamic registration **off**) and Authentication → OAuth Apps,
  one confidential app with redirect `https://claude.ai/api/mcp/auth_callback`; its id into Vercel
  as `MCP_OAUTH_CLIENT_ID`; deploy; then in Claude, Settings → Connectors → *Add custom connector*,
  the address above, *Use your own OAuth client*, its id and secret.
- **Administrator only**, for now.
- **Not one click, as designed.** Claude has a link that opens *Add custom connector* already filled
  in, but this setup also requires a client id and secret. `MCP_OAUTH_CLIENT_ID` accepts exactly one
  id; adding a separate ChatGPT client or using dynamically registered clients needs a change to
  that gate, not just a Supabase setting. Both apps support static clients, so dynamic registration
  is an option for easier setup, not a requirement for supporting both:
  [261009a § The decision this leaves](../research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md#the-decision-this-leaves-gregs).
- **The asking tools refuse there**: no dialog can be shown on your Mac from a server, so gifts,
  publishing and private links are done in the Mac app or on the site.
- **What the token can do at Supabase** is more than the tools, and is written up in
  [security-map.md](security-map.md#and-since-2026-10-07-an-ai-apps-token-which-opens-one-route).

The code is [`src/mcp/remote.ts`](../../src/mcp/remote.ts) (the route, the per-request server, the
in-process API) and [`src/web/OAuthConsentPage.tsx`](../../src/web/OAuthConsentPage.tsx). It must
stay out of the local server's imports: `tests/mcp-remote-import-graph.test.ts`.

## Where the code is

| | |
|---|---|
| [`scripts/spideryarn-mcp.ts`](../../scripts/spideryarn-mcp.ts) | the command: `login`, `logout`, `whoami`, `serve`, `config` |
| [`src/mcp/tools.ts`](../../src/mcp/tools.ts) | the tools, as a list that knows nothing about stdio |
| [`src/mcp/server.ts`](../../src/mcp/server.ts) | the list served as MCP; asks before any asking tool runs |
| [`src/mcp/approve.ts`](../../src/mcp/approve.ts) | the macOS dialog |
| [`src/mcp/session.ts`](../../src/mcp/session.ts) | the saved session: permissions, the lock, refresh, and one reader per server |
| [`src/mcp/api.ts`](../../src/mcp/api.ts) | the API caller |

**Adding a tool** is a row in `TOOLS` that calls an existing route; the server's checks do the
rest. A tool that sends mail, publishes, or otherwise reaches the outside world gets an `ask`, and a
test that a *Cancel* sends nothing.

**Two things not to break.** `serve` speaks MCP on stdout, so nothing else may ever write there; a
stray `console.log` corrupts the connection (`tests/mcp-stdio.test.ts` spawns the real thing and
checks every line). And the tokens stay in the session file and the `Authorization` header, never
in a result, an error or stderr.
