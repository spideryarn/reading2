# The MCP server: letting an AI agent drive Spideryarn as you

Up: [architecture.md](architecture.md)

An **MCP server** gives an AI app (Claude Desktop, Cowork, Claude Code, or any MCP client) a set of
named tools it may call. Spideryarn's runs **on your own computer**, signs in to Spideryarn as you,
and calls the same `/api/…` routes the web app calls, so **it can do exactly what you can do and
nothing more**: an admin's voucher tools work, anybody else's get the server's own 403. It changes
nothing on the server. Built for report `spya-bkkjzy`, Greg's:

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

**2. Tell the AI app to run it.** In Claude Desktop (which Cowork on the desktop shares) this goes in
*Settings → Developer → Edit Config*, i.e. `claude_desktop_config.json`. Use absolute paths, because
the app starts servers from no particular directory and with a short `PATH`:

```json
{
  "mcpServers": {
    "spideryarn": {
      "command": "/Users/greg/code/spideryarn2/node_modules/.bin/tsx",
      "args": ["/Users/greg/code/spideryarn2/scripts/spideryarn-mcp.ts", "serve",
               "--site", "https://www.spideryarn.com"],
      "env": { "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }
    }
  }
}
```

The `PATH` must include the directory holding `node`. In Claude Code:
`claude mcp add spideryarn -- <the same command and args>`.

*Unverified on 2026-10-07*: whether a server in `claude_desktop_config.json` shows up inside
Cowork, as well as in an ordinary Claude Desktop chat. Cowork's documentation says local MCP servers
work on the desktop app.

**To stop:** `npx tsx scripts/spideryarn-mcp.ts logout --site …` signs this session out (only
this one, not your browser) and deletes the file. A running server notices on its next call.

## The tools

| Tool | What it does |
|---|---|
| `whoami` | who it is signed in as, and whether modes run automatically on import |
| `list_articles` | your shelf (`archive`: active, archived or all), each with its link, tags and visibility |
| `search_library` | full-text search over your shelf |
| `list_tags`, `edit_tags` | your tags, and adding or removing them on an article |
| `import_article` | import a URL (uses a free article, as the web app does) |
| `get_import_status`, `list_imports` | how an import is going |
| `set_auto_modes` | the "run the main modes after import" switch |
| `make_article_private`, `make_article_public` | visibility; **public asks you first** |
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

**Not there yet, and why** (each is a question for Greg in the plan): every reader's address
(`list_users`), the private link with its key, and signing in from Cowork on the web or phone.

## Where the code is

| | |
|---|---|
| [`scripts/spideryarn-mcp.ts`](../../scripts/spideryarn-mcp.ts) | the command: `login`, `logout`, `whoami`, `serve` |
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
