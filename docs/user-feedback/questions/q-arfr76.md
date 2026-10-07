---
id: q-arfr76
report: spya-bkkjzy
status: answered
asked: 2026-10-07
title: The MCP server: Cowork on the web, a private link's key, every reader's address?
refs: SPIDERYARN-READING2-EE · qi-n9ntngfq · qi-2a8nh33e · docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md § Questions for Greg · docs/user-feedback/261006_2227-mcp-server-for-spideryarn.md · docs/project/mcp.md
---
Background. Your report asking for an MCP server shipped as a local one. Claude Desktop, Cowork on the desktop or Claude Code runs it on your Mac. It signs in as you once, with your email and password, and then does exactly what your account can do: list and search articles, tags, import a URL, the run-modes-on-import switch, public or private, and gift vouchers. Anything that sends an email or publishes opens a dialog on your Mac first, because an agent that reads your email can be steered by what an email says, and the model cannot press that button. Before any of the questions below: sign in once (docs/project/mcp.md says how) and say whether it worked. An account that has only ever used Google may need Forgot password on the sign-in page to get a password.

Question 1. Should it also work away from your Mac, from Cowork on the web or phone? That needs Spideryarn itself to answer at an address, which changes the sign-in gate.

A. Stay local. Nothing more to build. Mac only.

B. A fixed key for you alone. Your profile page gets "Create an MCP key", and you paste it into a Claude connector's settings. About half a day. In a Team or Enterprise organisation one key is shared by everyone who uses that connector, so it suits you and not other readers, and it is a long-lived credential you must be able to revoke.

C. The sign-in you described. You add Spideryarn as a connector, a Spideryarn page asks "Claude wants to act as you — Allow?", and you are back in Cowork. Works for every reader. A day or two, through Supabase's OAuth feature, which is in beta and which you switch on in the Supabase dashboard.

What would decide it: A until you want it away from the Mac; B if it is only ever you; C when other readers should have it.

Recommended: A for now.

Question 2. May the agent hold a private link's key? The private link (/read/…?key=…) is a credential: whoever has it reads the article. Letting the agent fetch it puts the key in the AI conversation and the agent's notes, the same as pasting it into a gift note by hand.

A. Yes. One more tool, which asks you on your Mac before turning a link on.

B. No. The agent can still make an article public, which needs no key, with your approval each time.

Recommended: your call; B is the cautious default.

Question 3. May the agent list every reader's email address? You asked for this, and it is one tool. The cost: every reader's address goes into the AI provider's conversation and the agent's notes, which the privacy page does not cover today, and an agent reading untrusted email could be talked into passing the list on through its other tools.

A. Yes, and the privacy page gets a line saying so.

B. No. The agent keeps the vouchers list, which holds only addresses you typed yourself.

Recommended: B, unless you need it for a specific job.

## Greg's answer, 2026-10-07 (in chat, relayed by the Overseer)

> I can live with it being something simple (e.g. fixed-key), but I'd prefer Google OAuth or similar if possible

> re making private links - if the agent is authenticated to the site, can't it just instruct the site to do it?

> yes, I want user email addresses and activity to be queryable via MCP

Settled: OAuth first (fixed key only as fallback), a private-link tool behind the Approve dialog, and admin-only user tools with the privacy page updated. qi-n9ntngfq, qi-2a8nh33e.
