# One click: putting Spideryarn's MCP server into Claude and ChatGPT

Up: [mcp.md](../project/mcp.md)

What it would take for a reader to add Spideryarn to Claude or ChatGPT in one click, app by app, and
what we found when we tested the server we already have. Researched and spiked 2026-10-09. The web
facts initially came from a Sonnet research subagent. The code review re-fetched the official
Claude connector and OpenAI authentication/setup docs on 2026-10-09; untested app flows remain
**medium confidence**. Expect these facts to age fast, because OpenAI in particular has renamed
this feature several times.

**Decision later on 2026-10-09:** Greg enabled production dynamic registration, accepting Sol F6
while remote MCP remains administrator-only. The gate now accepts `MCP_OAUTH_CLIENT_ID=*`;
[mcp.md](../project/mcp.md#from-chatgpt-claude-on-the-web-or-any-mcp-app-switching-on-2026-10-09)
owns the current setup. The observations below record the earlier investigation, before that decision.

> In my ideal world, it would be one click. I know that in the past it used to be one click to sort
> of set up the configuration for Cursor. There were buttons, so I feel like it should be possible to
> do that for Claude desktop app and ChatGPT desktop apps as well.
>
> — Greg, 2026-10-09

## The short answer

```
                     local server (runs on your Mac)      remote server (www.spideryarn.com/api/mcp)
                     ───────────────────────────────      ──────────────────────────────────────────
 Claude Desktop      works today (config file)            needs remote switched on
                     one-click possible: a .mcpb file
 claude.ai / phone   impossible                           needs remote switched on;
                                                          one-click = a prefill link
 Claude Code         works today (claude mcp add)         needs remote switched on
 ChatGPT             private stdio via Secure MCP Tunnel  needs remote switched on; static client,
                     (not tested here)                    CIMD or DCR; no documented prefill link
```

The existing hosted route would cover both apps without a local checkout. It is built and deployed
but switched off ([mcp.md § From ChatGPT, Claude on the web, or any MCP app](../project/mcp.md#from-chatgpt-claude-on-the-web-or-any-mcp-app-switching-on-2026-10-09)).
It is not the only installation route: Desktop extensions and ChatGPT tunnels are alternatives,
neither tested for Spideryarn.

## What the spike found (2026-10-09, against the local stack)

- **The local server works end to end.** I signed in with a throwaway local account, then used the
  MCP Inspector to list all 18 tools. `whoami`, `list_articles`, `search_library`, `list_tags` and
  `import_article` (Paul Graham's "How to Do Great Work") all returned real answers. `list_users`
  refused with `[admin-only]`, as it should for a non-admin. `claude -p --mcp-config <file>`
  (Haiku) then called `whoami` and `list_articles` through Claude Code itself.
- **Why it had not worked: the checkout's `node_modules` predated the MCP SDK.** The primary checkout
  had never had `npm install` run since the server landed. The server died on
  `ERR_MODULE_NOT_FOUND: @modelcontextprotocol/server` before it spoke, and an app reports that only
  as `Connection closed`. `npm install` fixed it. Any later dependency the server gains will do the
  same thing again.
- **The doc's example config named a checkout that does not exist** (`/Users/greg/code/spideryarn2`).
  `spideryarn-mcp.ts config` now prints the config with this checkout's real paths.
- **The Inspector's CLI mangles `--site`** when the server is given on its command line: either
  `Connection closed`, or the server is handed the Inspector's own flags. Give it a config file
  instead (`--config <file> --server spideryarn`). That has the advantage of testing exactly the
  JSON Claude Desktop will read.
- **Production, read-only:** `POST /api/mcp` answers `401` with the right `WWW-Authenticate`.
  `/.well-known/oauth-protected-resource/api/mcp` names `https://www.spideryarn.com/api/mcp` and
  Supabase's `/auth/v1`. Supabase answers `feature_disabled: OAuth server is disabled`. The remote
  half is deployed and correct as far as it can be without the OAuth server on.
- **Not tested:** the remote OAuth flow (it needs the shared local Supabase restarted with the OAuth
  server on, which the 261007p spike is still waiting on); whether Cowork sees a
  `claude_desktop_config.json` server; anything in ChatGPT.

## App by app

### Claude: custom connector (web, Desktop, phone all share it)

- **There is a prefill link**:
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Spideryarn&connectorUrl=https%3A%2F%2Fwww.spideryarn.com%2Fapi%2Fmcp`.
  It opens *Add custom connector* already filled in. The reader presses *Add*, then signs in. That
  is as close to one click as a third party gets.
  ([directory-vs-custom](https://claude.com/docs/connectors/building/directory-vs-custom),
  [add-unlisted](https://claude.com/docs/connectors/custom/add-unlisted))
- **Plans:** Free (one custom connector), Pro and Max add their own. On Team and Enterprise only an
  Owner, or an Enterprise member with a custom role allowing library management, can add one.
  ([add-unlisted](https://claude.com/docs/connectors/custom/add-unlisted))
- **Sign-in:** Claude tries CIMD (a published client identity) first, then dynamic client
  registration (DCR), then "use your own OAuth client" (an id and secret the reader types in). CIMD
  needs `client_id_metadata_document_supported: true` and `none` among the token endpoint's auth
  methods. **Supabase shows no sign of CIMD**, so for us it is DCR or a typed-in client.
  ([authentication](https://claude.com/docs/connectors/building/authentication))
- Its strict requirements (401 + `WWW-Authenticate`, `resource` equal to the URL, S256 PKCE, the
  callback `https://claude.ai/api/mcp/auth_callback`) are what 261007p already built to.

### Claude Desktop: a desktop extension (`.mcpb`)

- The reader double-clicks a `.mcpb` file, sees a dialog with any settings it asks for, and presses
  *Install*. Claude Desktop ships its own Node, so nothing else is needed. A `user_config` field can
  be `sensitive` (masked). Signing is optional. Built with `npx @anthropic-ai/mcpb pack`.
  ([mcpb README](https://github.com/modelcontextprotocol/mcpb/blob/main/README.md),
  [MANIFEST.md](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md),
  [building](https://claude.com/docs/connectors/building/mcpb))
- For us it would be the local server bundled up, with sign-in still to solve inside it. It works
  only on Desktop, and a remote connector would cover Desktop too. **Not worth building while the
  remote route is the plan.**

### ChatGPT

- **No direct launch of our local stdio command.** The current web setup is
  chatgpt.com/plugins → *Add custom MCP server*, with a public HTTPS URL or **Secure MCP Tunnel**.
  The tunnel can connect to a private stdio or HTTP server; we have not tested it here.
  **No prefill link is documented.**
  ([connect](https://developers.openai.com/plugins/deploy/connect-chatgpt),
  [tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels))
- **Access:** account/workspace permissions apply. We have not verified availability on Greg's
  account; conflicting older plan claims are not an acceptance test.
- **Sign-in for our account-bound tools:** OAuth 2.1 with S256 PKCE. ChatGPT also supports
  unauthenticated servers; OAuth is not universally required. Client registration can use CIMD,
  DCR, or a predefined static client. ChatGPT sends `resource` and expects the token's audience to
  match. [261007p § Revised](../plans/261007p-mcp-remote-sign-in-with-oauth.md#revised-after-sols-plan-review-rethink-before-any-code)
  already records Supabase issuing `aud: "authenticated"` rather than binding it to `resource`.
  Whether ChatGPT accepts our issuer is unconfirmed and belongs in a real ChatGPT spike.
  ([auth](https://developers.openai.com/plugins/build/auth),
  [static-client setup](https://developers.openai.com/api/docs/guides/custom-mcp-server))

### Cursor and VS Code, for reference

Cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 JSON>`
([install links](https://cursor.com/docs/context/mcp/install-links)). VS Code:
`vscode:mcp/install?<url-encoded JSON>`
([guide](https://code.visualstudio.com/api/extension-guides/ai/mcp)). Both work because those
apps take a local command through those links; Claude's prefill link instead names a remote URL.

### Claude Code

`claude mcp add --transport http spideryarn https://www.spideryarn.com/api/mcp`, then `/mcp` to sign
in. Claude Code uses its own CIMD and a `localhost` callback on any port, so with Supabase it too
falls back to DCR or `--client-id`/`--client-secret`
([docs](https://code.claude.com/docs/en/mcp)).

## The decision as it stood before Greg enabled dynamic registration

At the time of this investigation, switching on was still Greg's decision after the real OAuth spike in
[261007p § What landed](../plans/261007p-mcp-remote-sign-in-with-oauth.md#what-landed-stage-1).
That plan deliberately chose one preregistered client and DCR off: Sol's **F6** concerned a client
named "Claude" with an attacker's callback; **F1** concerned what any approved token can do at
Supabase itself. Disabling DCR reduces phishing exposure; it does not narrow an approved token's
Supabase powers or settle the remaining production decision.

The then-current custom-connector setup required credentials that Claude's prefill link does not carry.
Both Claude and ChatGPT support static clients, so supporting both does not require DCR. Separate
static clients needed a revised allowlist: the original [`remote.ts`](../../src/mcp/remote.ts) compared
`client_id` with exactly one `MCP_OAUTH_CLIENT_ID`. **Turning DCR on alone could not work**:
new client ids would fail that comparison. Easier automatic registration needed a new client
trust policy and gate, not just a dashboard switch. Desktop packaging and ChatGPT tunnels are
other untested options; none resolves the hosted route's admin-only gate or pending OAuth spike.
The choice belongs in [mcp.md](../project/mcp.md).

**Decided, 2026-10-09:** Greg turned dynamic registration on in production, and the gate now
accepts `MCP_OAUTH_CLIENT_ID=*` (any app Supabase registered) alongside a list. The route stays
administrator-only; [mcp.md](../project/mcp.md) is the current setup.

**Token-boundary review, 2026-10-09:** Supabase's default access-token issuance sets top-level
`client_id` from the OAuth-server client, not user metadata; refresh refuses adding a client to a
non-OAuth session. Its ID tokens also carry `client_id`, but lack the `authenticated` role that
Spideryarn's `personFrom` requires. Source: Supabase's
[`GenerateAccessToken`, `GenerateIDToken` and refresh grant](https://github.com/supabase/auth/blob/master/internal/tokens/service.go).
A trusted Custom Access Token Hook can change claims; it is disabled in local config, and production
hook settings were not verified. `tests/mcp-remote.test.ts` covers the route's rejection of ID-token
claims and nested metadata, including with `*` mixed into an explicit list.
